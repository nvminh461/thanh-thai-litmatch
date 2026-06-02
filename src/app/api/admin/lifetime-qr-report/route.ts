import { NextResponse } from "next/server";
import { getAdminSession } from "@/server/admin-auth";
import {
  cancelLifetimeQrReportExport,
  exportLifetimeQrReportPayments,
  getLifetimeQrReport,
  type LifetimeQrReportInput,
} from "@/server/payment-repository";

function readReportInput(searchParams: URLSearchParams): LifetimeQrReportInput {
  return {
    status: searchParams.get("status") as LifetimeQrReportInput["status"],
    litmatchId: searchParams.get("litmatchId") ?? "",
    transferContent: searchParams.get("transferContent") ?? "",
    updatedFrom: searchParams.get("updatedFrom") ?? "",
    updatedTo: searchParams.get("updatedTo") ?? "",
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

  return NextResponse.json({
    success: true,
    data: await getLifetimeQrReport(readReportInput(searchParams)),
  });
}

export async function POST(request: Request) {
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

  try {
    const action = payload.action === "cancel_export" ? "cancel_export" : "export";
    const data =
      action === "cancel_export"
        ? await cancelLifetimeQrReportExport({
            paymentIds: payload.paymentIds,
          })
        : await exportLifetimeQrReportPayments({
            paymentIds: payload.paymentIds,
          });

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    const action = payload.action === "cancel_export" ? "cancel_export" : "export";

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : action === "cancel_export"
              ? "Không hủy xuất được báo cáo."
              : "Không xuất được báo cáo.",
      },
      { status: 400 },
    );
  }
}
