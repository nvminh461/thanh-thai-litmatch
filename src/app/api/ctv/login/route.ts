import { NextResponse } from "next/server";
import {
  createCtvSessionToken,
  setCtvSessionCookie,
  verifyCtvLogin,
} from "@/server/ctv-auth";

function redirectTo(request: Request, pathname: string) {
  return NextResponse.redirect(new URL(pathname, request.url));
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");
    const profile = await verifyCtvLogin(username, password);

    if (!profile) {
      return redirectTo(request, "/ctv/login?error=invalid");
    }

    const response = redirectTo(request, "/ctv");
    setCtvSessionCookie(response, createCtvSessionToken(profile));

    return response;
  } catch {
    return redirectTo(request, "/ctv/login?error=config");
  }
}
