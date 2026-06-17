import { getEasyPosConfig } from "./config";
import {
  EasyPosClientError,
  type EasyPosBillPayload,
  type EasyPosCreateBillResult,
  type EasyPosLoginResponse,
} from "./types";

const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

type CachedToken = {
  token: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;

function normalizeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;

  return padding ? `${normalized}${"=".repeat(4 - padding)}` : normalized;
}

function decodeJwtExpiresAt(token: string) {
  const payload = token.split(".")[1];

  if (!payload) {
    return Date.now() + 15 * 60 * 1000;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(normalizeBase64Url(payload), "base64").toString("utf8"),
    ) as { exp?: unknown };

    return typeof parsed.exp === "number"
      ? parsed.exp * 1000
      : Date.now() + 15 * 60 * 1000;
  } catch {
    return Date.now() + 15 * 60 * 1000;
  }
}

function buildCommonHeaders(config: ReturnType<typeof getEasyPosConfig>) {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "vi",
    "content-type": "application/json",
    origin: config.appOrigin,
    referer: `${config.appOrigin}/`,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
    "x-device-id": config.deviceId,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new EasyPosClientError("EasyPos phản hồi quá thời gian.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonResponse(response: Response) {
  const responseText = await response.text();

  if (!responseText.trim()) {
    return null;
  }

  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    throw new EasyPosClientError("EasyPos trả dữ liệu không hợp lệ.");
  }
}

function getEasyPosFailureMessage(payload: unknown, fallback: string) {
  if (typeof payload !== "object" || payload === null) {
    return fallback;
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.reason === "string" && record.reason.trim()) {
    return record.reason.trim();
  }

  if (Array.isArray(record.message)) {
    const firstMessage = record.message.find(
      (item) => typeof item === "object" && item !== null,
    ) as Record<string, unknown> | undefined;
    const message = firstMessage?.message;

    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }

  return fallback;
}

function assertEasyPosSuccess(payload: unknown) {
  if (typeof payload !== "object" || payload === null) {
    return;
  }

  const status = (payload as Record<string, unknown>).status;

  if (status === false) {
    throw new EasyPosClientError(
      getEasyPosFailureMessage(payload, "EasyPos báo tạo đơn hàng thất bại."),
    );
  }
}

function sanitizeEasyPosData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeEasyPosData(item));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      const normalizedKey = key.toLowerCase();

      if (
        normalizedKey.includes("token") ||
        normalizedKey.includes("password") ||
        normalizedKey === "authorization"
      ) {
        return [key, "[redacted]"];
      }

      return [key, sanitizeEasyPosData(entry)];
    }),
  );
}

async function loginEasyPos(forceRefresh = false) {
  if (
    !forceRefresh &&
    cachedToken &&
    cachedToken.expiresAt - TOKEN_REFRESH_SKEW_MS > Date.now()
  ) {
    return cachedToken.token;
  }

  const config = getEasyPosConfig();
  const response = await fetchWithTimeout(
    `${config.apiBaseUrl}/api/client/common/authenticate`,
    {
      method: "POST",
      headers: buildCommonHeaders(config),
      body: JSON.stringify({
        username: config.username,
        password: config.password,
      }),
    },
    config.timeoutMs,
  );
  const payload = (await readJsonResponse(response)) as EasyPosLoginResponse;

  if (!response.ok) {
    throw new EasyPosClientError(
      `EasyPos login trả HTTP ${response.status}.`,
      response.status,
    );
  }

  if (!payload?.status || !payload.data?.id_token) {
    throw new EasyPosClientError(
      getEasyPosFailureMessage(payload, "EasyPos login thất bại."),
    );
  }

  cachedToken = {
    token: payload.data.id_token,
    expiresAt: decodeJwtExpiresAt(payload.data.id_token),
  };

  return cachedToken.token;
}

async function postEasyPosBill(payload: EasyPosBillPayload, token: string) {
  const config = getEasyPosConfig();
  const response = await fetchWithTimeout(
    `${config.apiBaseUrl}/api/client/page/bill/create`,
    {
      method: "POST",
      headers: {
        ...buildCommonHeaders(config),
        authorization: `Bearer ${token}`,
        platform: "web",
        "web-version": config.webVersion,
      },
      body: JSON.stringify(payload),
    },
    config.timeoutMs,
  );
  const responsePayload = await readJsonResponse(response);

  if (!response.ok) {
    throw new EasyPosClientError(
      `EasyPos tạo đơn hàng trả HTTP ${response.status}.`,
      response.status,
    );
  }

  assertEasyPosSuccess(responsePayload);

  return sanitizeEasyPosData(responsePayload);
}

export async function createEasyPosBill(
  request: EasyPosBillPayload,
): Promise<EasyPosCreateBillResult> {
  const token = await loginEasyPos();

  try {
    return {
      request,
      response: await postEasyPosBill(request, token),
    };
  } catch (error) {
    if (
      error instanceof EasyPosClientError &&
      (error.statusCode === 401 || error.statusCode === 403)
    ) {
      cachedToken = null;

      return {
        request,
        response: await postEasyPosBill(request, await loginEasyPos(true)),
      };
    }

    throw error;
  }
}
