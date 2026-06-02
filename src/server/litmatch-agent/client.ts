import { get2FACode } from "@/lib/get-2fa-code";
import type { RewardType } from "@/lib/payment-config";
import { getLitmatchAgentConfig } from "./config";
import {
  LitmatchAgentError,
  type AgentLoginResponse,
  type TargetUserInfo,
  type TargetUserInfoResponse,
  type TransferAccountInput,
  type TransferAccountResponse,
  type TransferAssetType,
} from "./types";

const SESSION_TTL_MS = 25 * 60 * 1000;

type CachedSession = {
  session: string;
  expiresAt: number;
};

let cachedSession: CachedSession | null = null;

function buildAgentHeaders() {
  return {
    accept: "application/json",
    "accept-language": "en-GB,en;q=0.9,vi;q=0.8,en-US;q=0.7",
    "content-type": "application/json;charset=UTF-8",
    origin: "https://agent.litatom.com",
    referer:
      "https://agent.litatom.com/api/sns/v1/lit/activity/app/litmatch-agent-recharge",
    "user-agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1 Edg/148.0.0.0",
  };
}

function normalizeTargetUid(targetUid: string) {
  const normalized = targetUid.trim().replace(/\D/g, "");

  if (!normalized || normalized.length < 6 || normalized.length > 20) {
    throw new LitmatchAgentError("Invalid Litmatch ID format", "API");
  }

  return normalized;
}

function normalizeTransferNum(transferNum: number) {
  if (!Number.isInteger(transferNum) || transferNum <= 0) {
    throw new LitmatchAgentError("Invalid Litmatch transfer amount", "API");
  }

  return transferNum;
}

export function toTransferAssetType(rewardType: RewardType): TransferAssetType {
  return rewardType === "diamond" ? "diamonds" : "stars";
}

async function login(): Promise<string> {
  const config = await getLitmatchAgentConfig();
  const { code } = await get2FACode();

  const response = await fetch(
    `${config.baseUrl}/api/sns/v1/lit/agent/login`,
    {
      method: "POST",
      headers: buildAgentHeaders(),
      body: JSON.stringify({
        code,
        phone: config.phone,
        zone: config.zone,
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new LitmatchAgentError(
      `Login request failed with status ${response.status}`,
      "AUTH",
    );
  }

  const payload = (await response.json()) as AgentLoginResponse;

  if (!payload.success || payload.result !== 0 || !payload.data?.session) {
    throw new LitmatchAgentError("Litmatch login failed", "AUTH");
  }

  cachedSession = {
    session: payload.data.session,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  return cachedSession.session;
}

async function fetchTargetUserInfo(
  session: string,
  targetUid: string,
): Promise<TargetUserInfo> {
  const config = await getLitmatchAgentConfig();
  const params = new URLSearchParams({
    asid: `session.${session}`,
    target_uid: targetUid,
  });

  const response = await fetch(
    `${config.baseUrl}/api/sns/v1/lit/agent/target_user_info?${params.toString()}`,
    {
      method: "GET",
      headers: buildAgentHeaders(),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new LitmatchAgentError(
      `Target user lookup failed with status ${response.status}`,
      response.status === 401 || response.status === 403 ? "AUTH" : "API",
    );
  }

  const payload = (await response.json()) as TargetUserInfoResponse;

  if (!payload.success || payload.result !== 0 || !payload.data) {
    throw new LitmatchAgentError(
      "Litmatch ID could not be verified",
      "NOT_FOUND",
    );
  }

  const { avatar, bio, nickname } = payload.data;

  if (!nickname?.trim()) {
    throw new LitmatchAgentError(
      "Litmatch ID could not be verified",
      "NOT_FOUND",
    );
  }

  return {
    targetUid,
    avatar: avatar ?? "",
    bio: bio ?? "",
    nickname: nickname.trim(),
  };
}

async function transferAccountWithSession(
  session: string,
  input: TransferAccountInput,
): Promise<TransferAccountResponse> {
  const config = await getLitmatchAgentConfig();
  const targetUid = normalizeTargetUid(input.targetUid);
  const transferNum = normalizeTransferNum(input.transferNum);
  const params = new URLSearchParams({
    asid: `session.${session}`,
  });

  const response = await fetch(
    `${config.baseUrl}/api/sns/v1/lit/agent/transfer_accounts?${params.toString()}`,
    {
      method: "POST",
      headers: buildAgentHeaders(),
      body: JSON.stringify({
        target_uid: targetUid,
        transfer_num: transferNum,
        transfer_type: input.transferType,
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new LitmatchAgentError(
      `Litmatch transfer failed with status ${response.status}`,
      response.status === 401 || response.status === 403 ? "AUTH" : "API",
    );
  }

  const payload = (await response.json()) as TransferAccountResponse;

  if (!payload.success || payload.result !== 0) {
    throw new LitmatchAgentError(
      payload.message || "Litmatch transfer failed",
      "API",
    );
  }

  return payload;
}

export class LitmatchAgentClient {
  // Module-level cache is per serverless instance. Use KV for cross-instance sharing later.
  async getSession(forceRefresh = false): Promise<string> {
    if (
      !forceRefresh &&
      cachedSession &&
      Date.now() < cachedSession.expiresAt
    ) {
      return cachedSession.session;
    }

    return login();
  }

  async getTargetUserInfo(targetUid: string): Promise<TargetUserInfo> {
    const normalizedUid = normalizeTargetUid(targetUid);

    try {
      const session = await this.getSession();
      return await fetchTargetUserInfo(session, normalizedUid);
    } catch (error) {
      if (
        error instanceof LitmatchAgentError &&
        (error.code === "AUTH" || error.code === "NOT_FOUND")
      ) {
        const session = await this.getSession(true);
        return fetchTargetUserInfo(session, normalizedUid);
      }

      throw error;
    }
  }

  async transferAccount(input: {
    targetUid: string;
    rewardType: RewardType;
    transferNum: number;
  }): Promise<TransferAccountResponse> {
    const transferInput: TransferAccountInput = {
      targetUid: input.targetUid,
      transferNum: input.transferNum,
      transferType: toTransferAssetType(input.rewardType),
    };

    try {
      const session = await this.getSession();
      return await transferAccountWithSession(session, transferInput);
    } catch (error) {
      if (error instanceof LitmatchAgentError && error.code === "AUTH") {
        const session = await this.getSession(true);
        return transferAccountWithSession(session, transferInput);
      }

      throw error;
    }
  }
}

export const litmatchAgent = new LitmatchAgentClient();
