import { NextResponse } from "next/server";
import {
  createAdminSessionToken,
  setAdminSessionCookie,
  verifyAdminLogin,
} from "@/server/admin-auth";

function redirectTo(path: string) {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: path,
    },
  });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    const isValidLogin = await verifyAdminLogin(username, password);

    if (!isValidLogin) {
      return redirectTo("/admin/login?error=invalid");
    }

    const response = redirectTo("/admin");
    setAdminSessionCookie(response, createAdminSessionToken(username.trim()));

    return response;
  } catch {
    return redirectTo("/admin/login?error=config");
  }
}
