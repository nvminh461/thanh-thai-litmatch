import { createHash } from "node:crypto";
import { timingSafeEqualString } from "@/server/crypto-utils";

export type Pay1sChargingRequest = {
  request_id: string;
  code: string;
  partner_id: string;
  serial: string;
  telco: string;
  amount: number;
  command: "charging";
  sign: string;
};

export type Pay1sChargingResponse = {
  status: number;
  message?: string;
  request_id?: string;
  declared_value?: number;
  value?: number;
  amount?: number;
  code?: string;
  serial?: string;
  telco?: string;
  chietkhau?: number;
  trans_id?: number | string;
  [key: string]: unknown;
};

export type Pay1sCallbackPayload = Pay1sChargingResponse & {
  callback_sign: string;
};

export class Pay1sClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Pay1sClientError";
  }
}

function getPay1sConfig() {
  const partnerId = process.env.PAY1S_PARTNER_ID?.trim() ?? "";
  const partnerKey = process.env.PAY1S_PARTNER_KEY?.trim() ?? "";
  const baseUrl =
    process.env.PAY1S_BASE_URL?.trim() || "https://doithe1s.vn/chargingws/v2";

  if (!partnerId || !partnerKey || !baseUrl) {
    throw new Pay1sClientError("Thiếu cấu hình PAY1S.");
  }

  return {
    partnerId,
    partnerKey,
    baseUrl,
  };
}

export function buildPay1sSignature({
  partnerKey,
  code,
  serial,
}: {
  partnerKey: string;
  code: string;
  serial: string;
}) {
  return createHash("md5").update(`${partnerKey}${code}${serial}`).digest("hex");
}

export function verifyPay1sCallbackSignature(payload: Pay1sCallbackPayload) {
  const { partnerKey } = getPay1sConfig();
  const expectedSignature = buildPay1sSignature({
    partnerKey,
    code: String(payload.code ?? ""),
    serial: String(payload.serial ?? ""),
  });

  return timingSafeEqualString(payload.callback_sign, expectedSignature);
}

export async function chargePay1sCard(input: {
  requestId: string;
  code: string;
  serial: string;
  telco: string;
  amount: number;
}) {
  const { partnerId, partnerKey, baseUrl } = getPay1sConfig();
  const request: Pay1sChargingRequest = {
    request_id: input.requestId,
    code: input.code,
    partner_id: partnerId,
    serial: input.serial,
    telco: input.telco,
    amount: input.amount,
    command: "charging",
    sign: buildPay1sSignature({
      partnerKey,
      code: input.code,
      serial: input.serial,
    }),
  };
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(
      Object.entries(request).map(([key, value]) => [key, String(value)]),
    ),
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Pay1sClientError(`PAY1S trả HTTP ${response.status}.`);
  }

  try {
    return {
      request,
      response: JSON.parse(responseText) as Pay1sChargingResponse,
    };
  } catch {
    throw new Pay1sClientError("PAY1S trả dữ liệu không hợp lệ.");
  }
}
