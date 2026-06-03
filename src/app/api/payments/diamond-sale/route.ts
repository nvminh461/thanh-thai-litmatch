import { NextResponse } from "next/server";
import {
  createDiamondSalePayment,
  PaymentValidationError,
} from "@/server/payment-repository";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      litmatchId?: unknown;
      password?: unknown;
      amount?: unknown;
    };
    const data = await createDiamondSalePayment(body);

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
        error: "Không tạo được mã QR kim cương xả.",
      },
      { status: 500 },
    );
  }
}
