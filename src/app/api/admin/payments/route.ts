import { NextResponse } from "next/server";
import { getAdminSession } from "@/server/admin-auth";
import {
  deleteIncompleteBankPayments,
  deleteIncompleteCardPayments,
  listBankPayments,
  listCardPayments,
  type PaymentListInput,
} from "@/server/payment-repository";

function readPaymentListInput(searchParams: URLSearchParams): PaymentListInput {
  return {
    page: Number(searchParams.get("page") ?? 1),
    pageSize: 20,
    status: searchParams.get("status") as PaymentListInput["status"],
    litmatchId: searchParams.get("litmatchId") ?? "",
    transferContent: searchParams.get("transferContent") ?? "",
    updatedFrom: searchParams.get("updatedFrom") ?? "",
    updatedTo: searchParams.get("updatedTo") ?? "",
  };
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readPaymentListInputFromBody(value: unknown): PaymentListInput {
  const body =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const filters =
    typeof body.filters === "object" && body.filters !== null
      ? (body.filters as Record<string, unknown>)
      : {};

  return {
    status: readString(filters.status) as PaymentListInput["status"],
    litmatchId: readString(filters.litmatchId),
    transferContent: readString(filters.transferContent),
    updatedFrom: readString(filters.updatedFrom),
    updatedTo: readString(filters.updatedTo),
  };
}

export async function GET(request: Request) {
  const session = await getAdminSession();

  if (!session) {
    return NextResponse.json(
      {
        success: false,
        error: "Chưa đăng nhập.",
      },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const input = readPaymentListInput(searchParams);

  if (type === "bank") {
    return NextResponse.json({
      success: true,
      data: await listBankPayments(input),
    });
  }

  if (type === "card") {
    return NextResponse.json({
      success: true,
      data: await listCardPayments(input),
    });
  }

  return NextResponse.json(
    {
      success: false,
      error: "Loại giao dịch không hợp lệ.",
    },
    { status: 400 },
  );
}

export async function DELETE(request: Request) {
  const session = await getAdminSession();

  if (!session) {
    return NextResponse.json(
      {
        success: false,
        error: "Chưa đăng nhập.",
      },
      { status: 401 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Dữ liệu yêu cầu không hợp lệ.",
      },
      { status: 400 },
    );
  }

  const payload =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const type = readString(payload.type);

  if (payload.confirm !== "delete_incomplete") {
    return NextResponse.json(
      {
        success: false,
        error: "Thiếu xác nhận xóa giao dịch.",
      },
      { status: 400 },
    );
  }

  const input = readPaymentListInputFromBody(payload);

  if (type === "bank") {
    return NextResponse.json({
      success: true,
      data: await deleteIncompleteBankPayments(input),
    });
  }

  if (type === "card") {
    return NextResponse.json({
      success: true,
      data: await deleteIncompleteCardPayments(input),
    });
  }

  return NextResponse.json(
    {
      success: false,
      error: "Loại giao dịch không hợp lệ.",
    },
    { status: 400 },
  );
}
