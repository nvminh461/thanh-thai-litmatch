import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import {
  getActiveCtvProfile,
  verifyCtvCredentials,
  type CtvSessionProfile,
} from "./ctv-repository";
import { timingSafeEqualString } from "./crypto-utils";

const CTV_SESSION_COOKIE = "litmatch_ctv_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

type CtvSessionPayload = {
  ctvId: string;
  username: string;
  code: string;
  expiresAt: number;
  signature: string;
};

function getCtvSessionSecret() {
  const secret = process.env.CTV_SESSION_SECRET?.trim();

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("CTV_SESSION_SECRET is not set in environment");
  }

  return "litmatch-top-up-development-ctv-session-secret";
}

function signSession(payload: Omit<CtvSessionPayload, "signature">) {
  return createHmac("sha256", getCtvSessionSecret())
    .update(
      `${payload.ctvId}.${payload.username}.${payload.code}.${payload.expiresAt}`,
    )
    .digest("hex");
}

function encodeSession(payload: CtvSessionPayload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeSession(value: string): CtvSessionPayload | null {
  try {
    const payload = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<CtvSessionPayload>;

    if (
      typeof payload.ctvId !== "string" ||
      typeof payload.username !== "string" ||
      typeof payload.code !== "string" ||
      typeof payload.expiresAt !== "number" ||
      typeof payload.signature !== "string"
    ) {
      return null;
    }

    return payload as CtvSessionPayload;
  } catch {
    return null;
  }
}

export async function verifyCtvLogin(username: string, password: string) {
  return verifyCtvCredentials(username, password);
}

export function createCtvSessionToken(profile: CtvSessionProfile) {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = {
    ctvId: profile.id,
    username: profile.username,
    code: profile.code,
    expiresAt,
  };
  const signature = signSession(payload);

  return encodeSession({
    ...payload,
    signature,
  });
}

export async function getCtvSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(CTV_SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  const payload = decodeSession(token);

  if (!payload || payload.expiresAt < Date.now()) {
    return null;
  }

  const expectedSignature = signSession({
    ctvId: payload.ctvId,
    username: payload.username,
    code: payload.code,
    expiresAt: payload.expiresAt,
  });

  if (!timingSafeEqualString(payload.signature, expectedSignature)) {
    return null;
  }

  return getActiveCtvProfile(payload.ctvId);
}

export function setCtvSessionCookie(response: Response, token: string) {
  response.headers.append(
    "set-cookie",
    `${CTV_SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );
}

export function clearCtvSessionCookie(response: Response) {
  response.headers.append(
    "set-cookie",
    `${CTV_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );
}
