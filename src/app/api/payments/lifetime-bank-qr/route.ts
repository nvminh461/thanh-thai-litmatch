import { NextResponse } from "next/server";
import {
  createLifetimeBankQr,
  DuplicateLifetimeBankQrError,
  PaymentValidationError,
} from "@/server/payment-repository";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      litmatchId?: unknown;
      rewardType?: unknown;
      transferContent?: unknown;
      ctvCode?: unknown;
    };
    const data = await createLifetimeBankQr(body);

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    if (error instanceof DuplicateLifetimeBankQrError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          existingLifetimeQr: error.existingLifetimeQr,
        },
        { status: 400 },
      );
    }

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
        error: "Không tạo được QR trọn đời.",
      },
      { status: 500 },
    );
  }
}
