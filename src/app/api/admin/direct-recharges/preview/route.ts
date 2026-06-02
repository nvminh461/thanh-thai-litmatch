import { NextResponse } from "next/server";
import { getAdminSession } from "@/server/admin-auth";
import {
  PaymentValidationError,
  previewDirectAdminRecharge,
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
    const body = await request.json();

    return NextResponse.json({
      success: true,
      data: await previewDirectAdminRecharge(body),
    });
  } catch (error) {
    if (error instanceof PaymentValidationError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { success: false, error: "Không xác minh được ID Litmatch." },
      { status: 502 },
    );
  }
}
