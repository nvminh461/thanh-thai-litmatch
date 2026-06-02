import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { verifyAdminCredentials } from "./admin-credentials";
import { timingSafeEqualString } from "./crypto-utils";

const ADMIN_SESSION_COOKIE = "litmatch_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

type AdminSessionPayload = {
  username: string;
  expiresAt: number;
  signature: string;
};

function getAdminSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim();

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_SESSION_SECRET is not set in environment");
  }

  return "litmatch-top-up-development-admin-session-secret";
}

function signSession(username: string, expiresAt: number) {
  return createHmac("sha256", getAdminSessionSecret())
    .update(`${username}.${expiresAt}`)
    .digest("hex");
}

function encodeSession(payload: AdminSessionPayload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeSession(value: string): AdminSessionPayload | null {
  try {
    const payload = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<AdminSessionPayload>;

    if (
      typeof payload.username !== "string" ||
      typeof payload.expiresAt !== "number" ||
      typeof payload.signature !== "string"
    ) {
      return null;
    }

    return payload as AdminSessionPayload;
  } catch {
    return null;
  }
}

export async function verifyAdminLogin(username: string, password: string) {
  return verifyAdminCredentials(username, password);
}

export function createAdminSessionToken(username: string) {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const signature = signSession(username, expiresAt);

  return encodeSession({ username, expiresAt, signature });
}

export async function getAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  const payload = decodeSession(token);

  if (!payload || payload.expiresAt < Date.now()) {
    return null;
  }

  const expectedSignature = signSession(payload.username, payload.expiresAt);

  if (!timingSafeEqualString(payload.signature, expectedSignature)) {
    return null;
  }

  return { username: payload.username };
}

export function setAdminSessionCookie(response: Response, token: string) {
  response.headers.append(
    "set-cookie",
    `${ADMIN_SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );
}

export function clearAdminSessionCookie(response: Response) {
  response.headers.append(
    "set-cookie",
    `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );
}
