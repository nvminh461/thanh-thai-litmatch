import { NextResponse } from "next/server";
import { getAdminSession } from "@/server/admin-auth";
import {
  PaymentValidationError,
  unblockBankQrBlacklist,
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
    const body = (await request.json()) as { id?: unknown };

    return NextResponse.json({
      success: true,
      data: await unblockBankQrBlacklist({
        id: body.id,
        adminUsername: session.username,
      }),
    });
  } catch (error) {
    if (error instanceof PaymentValidationError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { success: false, error: "Không mở khóa được ID Litmatch." },
      { status: 500 },
    );
  }
}
