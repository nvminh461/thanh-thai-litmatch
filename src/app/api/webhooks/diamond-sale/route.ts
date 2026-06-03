import { NextResponse } from "next/server";
import {
  processDiamondSaleProviderWebhook,
  PaymentValidationError,
  type DiamondSaleProviderWebhookPayload,
} from "@/server/payment-repository";
import { timingSafeEqualString } from "@/server/crypto-utils";

function getWebhookApiKey() {
  return process.env.DIAMOND_SALE_WEBHOOK_API_KEY?.trim() ?? "";
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

  try {
    const rawBody = await request.text();
    const payload = JSON.parse(rawBody) as DiamondSaleProviderWebhookPayload;
    const result = await processDiamondSaleProviderWebhook(payload, rawBody);

    return NextResponse.json({
      success: result.status !== "failed" && result.status !== "unmatched",
      status: result.status,
      paymentId: result.paymentId,
      message: result.message,
    });
  } catch (error) {
    if (error instanceof PaymentValidationError || error instanceof SyntaxError) {
      return NextResponse.json(
        {
          success: false,
          status: "invalid_payload",
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
