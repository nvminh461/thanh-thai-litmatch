import { NextResponse } from "next/server";
import { getAdminSession } from "@/server/admin-auth";
import {
  listBankQrBlacklist,
  type BankQrBlacklistListInput,
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
  const input: BankQrBlacklistListInput = {
    page: Number(searchParams.get("page") ?? 1),
    pageSize: 20,
    status: searchParams.get("status") as BankQrBlacklistListInput["status"],
    litmatchId: searchParams.get("litmatchId") ?? "",
  };

  return NextResponse.json({
    success: true,
    data: await listBankQrBlacklist(input),
  });
}
