import { NextResponse } from "next/server";
import { getAdminSession } from "@/server/admin-auth";
import {
  createDirectAdminRecharge,
  listDirectAdminRecharges,
  PaymentValidationError,
} from "@/server/payment-repository";

export async function GET(request: Request) {
  const session = await getAdminSession();

  if (!session) {
    return NextResponse.json(
      { success: false, error: "Chưa đăng nhập." },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);

  return NextResponse.json({
    success: true,
    data: await listDirectAdminRecharges({
      page: Number(searchParams.get("page") ?? 1),
      pageSize: 20,
    }),
  });
}

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
      data: await createDirectAdminRecharge({
        ...(typeof body === "object" && body !== null ? body : {}),
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
      { success: false, error: "Không nạp trực tiếp được." },
      { status: 502 },
    );
  }
}
