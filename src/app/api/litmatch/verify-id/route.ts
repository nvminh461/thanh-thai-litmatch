import { NextResponse } from "next/server";
import { litmatchAgent, LitmatchAgentError } from "@/server/litmatch-agent";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { targetUid?: string };
    const targetUid = body.targetUid?.trim();

    if (!targetUid || !/^\d{5,20}$/.test(targetUid.replace(/\D/g, ""))) {
      return NextResponse.json(
        {
          success: false,
          error: "Vui lòng nhập ID Litmatch hợp lệ.",
        },
        { status: 400 },
      );
    }

    const data = await litmatchAgent.getTargetUserInfo(targetUid);

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    if (error instanceof LitmatchAgentError) {
      const status = error.code === "NOT_FOUND" ? 404 : 502;

      return NextResponse.json(
        {
          success: false,
          error: "Không xác minh được ID Litmatch.",
        },
        { status },
      );
    }

    if (error instanceof Error && error.message.includes("Missing Litmatch")) {
      return NextResponse.json(
        {
          success: false,
          error: "Thiếu cấu hình Litmatch agent trên server.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "Không xác minh được ID Litmatch.",
      },
      { status: 502 },
    );
  }
}
