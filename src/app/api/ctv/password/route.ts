import { NextResponse } from "next/server";
import { getCtvSession } from "@/server/ctv-auth";
import {
  changeCtvPassword,
  CtvNotFoundError,
  CtvValidationError,
} from "@/server/ctv-repository";

function getBodyObject(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export async function PATCH(request: Request) {
  const session = await getCtvSession();

  if (!session) {
    return NextResponse.json(
      { success: false, error: "Chưa đăng nhập." },
      { status: 401 },
    );
  }

  try {
    const body = getBodyObject(await request.json());

    await changeCtvPassword({
      ctvId: session.id,
      currentPassword: body.currentPassword,
      nextPassword: body.nextPassword,
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    if (error instanceof CtvNotFoundError) {
      return NextResponse.json(
        { success: false, error: "Không tìm thấy CTV." },
        { status: 404 },
      );
    }

    if (error instanceof CtvValidationError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { success: false, error: "Không đổi được mật khẩu." },
      { status: 500 },
    );
  }
}
