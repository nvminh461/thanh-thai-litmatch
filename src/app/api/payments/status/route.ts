import { NextResponse } from "next/server";
import {
  getPublicLifetimeBankQrStatus,
  getPublicPaymentStatus,
  PaymentNotFoundError,
} from "@/server/payment-repository";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const id = searchParams.get("id") ?? "";

  if (
    type !== "bank" &&
    type !== "card" &&
    type !== "lifetime-bank-qr" &&
    type !== "diamond-sale"
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "Loại giao dịch không hợp lệ.",
      },
      { status: 400 },
    );
  }

  try {
    const data =
      type === "lifetime-bank-qr"
        ? await getPublicLifetimeBankQrStatus({ id })
        : await getPublicPaymentStatus({ type, id });

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    if (error instanceof PaymentNotFoundError) {
      return NextResponse.json(
        {
          success: false,
          error:
            type === "lifetime-bank-qr"
              ? "Chưa nhận giao dịch nào cho mã QR này."
              : "Không tìm thấy giao dịch.",
        },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "Không kiểm tra được trạng thái giao dịch.",
      },
      { status: 500 },
    );
  }
}
