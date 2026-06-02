import { NextResponse } from "next/server";
import {
  getSePayWebhookHttpStatus,
  isSePayWebhookProcessSuccess,
  PaymentValidationError,
  processSePayWebhook,
  type SePayWebhookPayload,
  type SePayWebhookProcessResult,
} from "@/server/payment-repository";
import { timingSafeEqualString } from "@/server/crypto-utils";

function buildSePayWebhookResponse(result: SePayWebhookProcessResult) {
  const httpStatus = getSePayWebhookHttpStatus(result);

  if (isSePayWebhookProcessSuccess(result)) {
    return NextResponse.json(
      {
        success: true,
        status: result.status,
        sepayId: result.sepayId,
        message: result.message,
        paymentId: result.paymentId,
      },
      { status: httpStatus },
    );
  }

  return NextResponse.json(
    {
      success: false,
      status: result.status,
      sepayId: result.sepayId,
      message: result.message ?? "Webhook processing failed",
      paymentId: result.paymentId,
    },
    { status: httpStatus },
  );
}

function getWebhookApiKey() {
  return process.env.SEPAY_WEBHOOK_API_KEY?.trim() ?? "";
}

function isAuthorized(request: Request) {
  const expectedApiKey = getWebhookApiKey();
  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Apikey ";

  if (!expectedApiKey || !authorization.startsWith(prefix)) {
    return false;
  }

  return timingSafeEqualString(
    authorization.slice(prefix.length).trim(),
    expectedApiKey,
  );
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        success: false,
        message: "Unauthorized",
      },
      { status: 401 },
    );
  }

  let sepayId: number | undefined;

  try {
    const rawBody = await request.text();
    const payload = JSON.parse(rawBody) as SePayWebhookPayload;
    const parsedSepayId = Number(payload.id);

    if (Number.isInteger(parsedSepayId)) {
      sepayId = parsedSepayId;
    }

    const result = await processSePayWebhook(payload, rawBody);

    return buildSePayWebhookResponse(result);
  } catch (error) {
    if (error instanceof PaymentValidationError || error instanceof SyntaxError) {
      return NextResponse.json(
        {
          success: false,
          status: "invalid_payload",
          sepayId,
          message:
            error instanceof PaymentValidationError
              ? error.message
              : "Invalid JSON payload",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        status: "internal_error",
        message: "Webhook processing failed",
      },
      { status: 500 },
    );
  }
}
