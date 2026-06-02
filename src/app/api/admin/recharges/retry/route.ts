import { NextResponse } from "next/server";
import { getAdminSession } from "@/server/admin-auth";
import {
  PaymentNotFoundError,
  PaymentValidationError,
  retryFailedPaymentRecharge,
} from "@/server/payment-repository";

export async function POST(request: Request) {
  const session = await getAdminSession();

  if (!session) {
    return NextResponse.json(
      { success: false, error: "Chưa đăng nhập." },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json()) as {
      type?: unknown;
      paymentId?: unknown;
    };

    return NextResponse.json({
      success: true,
      data: await retryFailedPaymentRecharge({
        ...body,
        adminUsername: session.username,
      }),
    });
  } catch (error) {
    if (error instanceof PaymentNotFoundError) {
      return NextResponse.json(
        { success: false, error: "Không tìm thấy giao dịch." },
        { status: 404 },
      );
    }

    if (error instanceof PaymentValidationError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { success: false, error: "Không nạp lại được giao dịch." },
      { status: 502 },
    );
  }
}
