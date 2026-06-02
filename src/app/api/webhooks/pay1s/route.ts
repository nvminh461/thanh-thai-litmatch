import { NextResponse } from "next/server";
import {
  PaymentValidationError,
  processPay1sWebhook,
} from "@/server/payment-repository";
import {
  verifyPay1sCallbackSignature,
  type Pay1sCallbackPayload,
} from "@/server/pay1s/client";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const payload = JSON.parse(rawBody) as Pay1sCallbackPayload;

    if (
      typeof payload.callback_sign !== "string" ||
      !verifyPay1sCallbackSignature(payload)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 },
      );
    }

    await processPay1sWebhook(payload, rawBody);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof PaymentValidationError || error instanceof SyntaxError) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid payload",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Webhook processing failed",
      },
      { status: 500 },
    );
  }
}
