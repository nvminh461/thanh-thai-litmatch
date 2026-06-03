import { NextResponse } from "next/server";
import { getAdminSession } from "@/server/admin-auth";
import {
  createDirectAdminRecharge,
  type DirectRechargeListInput,
  listDirectAdminRecharges,
  PaymentNotFoundError,
  PaymentValidationError,
  updateDirectAdminRechargeNote,
} from "@/server/payment-repository";

function readDirectRechargeListInput(
  searchParams: URLSearchParams,
): DirectRechargeListInput {
  return {
    page: Number(searchParams.get("page") ?? 1),
    pageSize: 20,
    status: searchParams.get("status") as DirectRechargeListInput["status"],
    litmatchId: searchParams.get("litmatchId") ?? "",
    note: searchParams.get("note") ?? "",
    updatedFrom: searchParams.get("updatedFrom") ?? "",
    updatedTo: searchParams.get("updatedTo") ?? "",
  };
}

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
    data: await listDirectAdminRecharges(readDirectRechargeListInput(searchParams)),
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

export async function PATCH(request: Request) {
  const session = await getAdminSession();

  if (!session) {
    return NextResponse.json(
      { success: false, error: "Chưa đăng nhập." },
      { status: 401 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Dữ liệu yêu cầu không hợp lệ." },
      { status: 400 },
    );
  }

  const payload =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  try {
    return NextResponse.json({
      success: true,
      data: await updateDirectAdminRechargeNote({
        id: payload.id,
        note: payload.note,
      }),
    });
  } catch (error) {
    if (error instanceof PaymentNotFoundError) {
      return NextResponse.json(
        { success: false, error: "Không tìm thấy lịch sử nạp trực tiếp." },
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
      { success: false, error: "Không cập nhật được ghi chú." },
      { status: 502 },
    );
  }
}
