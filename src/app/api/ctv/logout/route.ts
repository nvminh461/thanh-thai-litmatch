import { NextResponse } from "next/server";
import { clearCtvSessionCookie } from "@/server/ctv-auth";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/ctv/login", request.url));
  clearCtvSessionCookie(response);

  return response;
}
