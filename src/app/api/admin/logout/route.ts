import { NextResponse } from "next/server";
import { clearAdminSessionCookie } from "@/server/admin-auth";

export async function POST() {
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      Location: "/admin/login",
    },
  });

  clearAdminSessionCookie(response);

  return response;
}
