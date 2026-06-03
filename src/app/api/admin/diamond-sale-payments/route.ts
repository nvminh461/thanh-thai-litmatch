import { NextResponse } from "next/server";
import type {
  AdminDiamondSalePaymentSource,
  AdminDiamondSalePaymentStatus,
} from "@/lib/admin-types";
import { getAdminSession } from "@/server/admin-auth";
import { listDiamondSalePayments } from "@/server/payment-repository";

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

  try {
    const data = await listDiamondSalePayments({
      page: Number(searchParams.get("page") ?? 1),
      status: (searchParams.get("status") ?? "all") as
        | AdminDiamondSalePaymentStatus
        | "all",
      source: (searchParams.get("source") ?? "all") as
        | AdminDiamondSalePaymentSource
        | "all",
      litmatchId: searchParams.get("litmatchId") ?? "",
      query: searchParams.get("query") ?? "",
      updatedFrom: searchParams.get("updatedFrom") ?? "",
      updatedTo: searchParams.get("updatedTo") ?? "",
    });

    return NextResponse.json({
      success: true,
      data,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Không tải được giao dịch kim cương xả.",
      },
      { status: 500 },
    );
  }
}
