import * as OTPAuth from "otpauth";
import { getRuntimeConfig } from "@/server/runtime-config";

export async function get2FACode() {
  const runtimeConfig = await getRuntimeConfig();
  const data = runtimeConfig.totp;

  if (!data.secret) {
    throw new Error("TOTP_SECRET is not set in environment");
  }

  const totp = new OTPAuth.TOTP({
    issuer: data.issuer || undefined,
    label: data.label,
    algorithm: data.algorithm,
    digits: data.digits,
    period: data.period,
    secret: data.secret,
  });

  return {
    code: totp.generate(),
    remainingSeconds:
      data.period - (Math.floor(Date.now() / 1000) % data.period),
  };
}
