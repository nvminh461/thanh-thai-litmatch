import { NextResponse } from "next/server";
import {
  createAdminSessionToken,
  setAdminSessionCookie,
  verifyAdminLogin,
} from "@/server/admin-auth";

function redirectTo(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, request.url), { status: 303 });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    const isValidLogin = await verifyAdminLogin(username, password);

    if (!isValidLogin) {
      return redirectTo(request, "/admin/login?error=invalid");
    }

    const response = redirectTo(request, "/admin");
    setAdminSessionCookie(response, createAdminSessionToken(username.trim()));

    return response;
  } catch {
    return redirectTo(request, "/admin/login?error=config");
  }
}
