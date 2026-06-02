const QR_PATH = "src/server/secrets/2fa-qr.png";

export type { TwoFASecretData } from "@/lib/totp-config";
export { read2FASecretFromEnv } from "@/lib/totp-config";

import { read2FASecretFromEnv, type TwoFASecretData } from "@/lib/totp-config";

function parseOtpAuthUri(qrText: string): TwoFASecretData {
  if (!qrText.startsWith("otpauth://")) {
    throw new Error("QR is not an otpauth:// 2FA code");
  }

  const url = new URL(qrText);
  const secret = url.searchParams.get("secret");

  if (!secret) {
    throw new Error("Secret not found in QR");
  }

  return {
    type: url.hostname,
    label: decodeURIComponent(url.pathname.replace(/^\//, "")),
    secret,
    issuer: url.searchParams.get("issuer"),
    algorithm: url.searchParams.get("algorithm") || "SHA1",
    digits: Number(url.searchParams.get("digits") || 6),
    period: Number(url.searchParams.get("period") || 30),
    rawUri: qrText,
  };
}

async function readQrText(imagePath: string): Promise<string> {
  const path = await import("node:path");
  const sharp = (await import("sharp")).default;
  const jsQR = (await import("jsqr")).default;

  const resolvedPath = path.isAbsolute(imagePath)
    ? imagePath
    : path.join(process.cwd(), imagePath);

  const { data, info } = await sharp(resolvedPath)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const qr = jsQR(new Uint8ClampedArray(data), info.width, info.height, {
    inversionAttempts: "attemptBoth",
  });

  if (!qr?.data) {
    throw new Error("Could not read QR code");
  }

  return qr.data;
}

export async function read2FASecretFromQrFile(
  imagePath: string = QR_PATH,
): Promise<TwoFASecretData> {
  const qrText = await readQrText(imagePath);
  return parseOtpAuthUri(qrText);
}

export async function read2FASecretFromQr(
  imagePath: string = QR_PATH,
): Promise<TwoFASecretData> {
  if (process.env.TOTP_SECRET) {
    return read2FASecretFromEnv();
  }

  return read2FASecretFromQrFile(imagePath);
}

export async function read2FASecret(): Promise<TwoFASecretData> {
  if (process.env.TOTP_SECRET) {
    return read2FASecretFromEnv();
  }

  return read2FASecretFromQrFile();
}
