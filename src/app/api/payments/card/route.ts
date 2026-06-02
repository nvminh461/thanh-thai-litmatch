import { NextResponse } from "next/server";
import {
  createCardPayment,
  PaymentValidationError,
} from "@/server/payment-repository";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      litmatchId?: unknown;
      rewardType?: unknown;
      cardProvider?: unknown;
      cardDenomination?: unknown;
      cardCode?: unknown;
      cardSerial?: unknown;
    };
    const data = await createCardPayment(body);

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    if (error instanceof PaymentValidationError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "Không ghi nhận được thẻ cào.",
      },
      { status: 500 },
    );
  }
}
