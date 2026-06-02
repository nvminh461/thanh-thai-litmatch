export type TwoFASecretData = {
  type: string;
  label: string;
  secret: string;
  issuer: string | null;
  algorithm: string;
  digits: number;
  period: number;
  rawUri: string;
};

export function read2FASecretFromEnv(): TwoFASecretData {
  const secret = process.env.TOTP_SECRET;

  if (!secret) {
    throw new Error("TOTP_SECRET is not set in environment");
  }

  return {
    type: "totp",
    label: process.env.TOTP_LABEL ?? "",
    secret,
    issuer: process.env.TOTP_ISSUER ?? null,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    rawUri: "",
  };
}
