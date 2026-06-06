import { NextResponse } from "next/server";
import type { AdminCtvTransactionRow } from "@/lib/admin-types";
import { getAdminSession } from "@/server/admin-auth";
import {
  CtvNotFoundError,
  listCtvTransactions,
  type CtvTransactionListInput,
} from "@/server/ctv-repository";

function readInput(
  ctvId: string,
  searchParams: URLSearchParams,
): CtvTransactionListInput {
  return {
    ctvId,
    page: Number(searchParams.get("page") ?? 1),
    pageSize: 20,
    type: searchParams.get("type") as AdminCtvTransactionRow["type"] | "all",
    status: searchParams.get("status") as
      | AdminCtvTransactionRow["status"]
      | "all",
    litmatchId: searchParams.get("litmatchId") ?? "",
    updatedFrom: searchParams.get("updatedFrom") ?? "",
    updatedTo: searchParams.get("updatedTo") ?? "",
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();

  if (!session) {
    return NextResponse.json(
      { success: false, error: "Chưa đăng nhập." },
      { status: 401 },
    );
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);

  try {
    return NextResponse.json({
      success: true,
      data: await listCtvTransactions(readInput(id, searchParams)),
    });
  } catch (error) {
    if (error instanceof CtvNotFoundError) {
      return NextResponse.json(
        { success: false, error: "Không tìm thấy CTV." },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { success: false, error: "Không tải được giao dịch CTV." },
      { status: 500 },
    );
  }
}
