import { NextResponse } from "next/server";
import type { AdminCtvTransactionRow } from "@/lib/admin-types";
import { getCtvSession } from "@/server/ctv-auth";
import { listCtvTransactions } from "@/server/ctv-repository";

export async function GET(request: Request) {
  const session = await getCtvSession();

  if (!session) {
    return NextResponse.json(
      { success: false, error: "Chưa đăng nhập." },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);

  return NextResponse.json({
    success: true,
    data: await listCtvTransactions({
      ctvId: session.id,
      page: Number(searchParams.get("page") ?? 1),
      pageSize: 20,
      type: searchParams.get("type") as AdminCtvTransactionRow["type"] | "all",
      status: searchParams.get("status") as
        | AdminCtvTransactionRow["status"]
        | "all",
      litmatchId: searchParams.get("litmatchId") ?? "",
      updatedFrom: searchParams.get("updatedFrom") ?? "",
      updatedTo: searchParams.get("updatedTo") ?? "",
    }),
  });
}
