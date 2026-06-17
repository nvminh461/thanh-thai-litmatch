import { NextResponse } from "next/server";
import { clearCtvSessionCookie } from "@/server/ctv-auth";

export async function POST() {
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      Location: "/ctv/login",
    },
  });

  clearCtvSessionCookie(response);

  return response;
}
