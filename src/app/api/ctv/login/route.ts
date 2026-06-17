import { NextResponse } from "next/server";
import {
  createCtvSessionToken,
  setCtvSessionCookie,
  verifyCtvLogin,
} from "@/server/ctv-auth";

function redirectTo(pathname: string) {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: pathname,
    },
  });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");
    const profile = await verifyCtvLogin(username, password);

    if (!profile) {
      return redirectTo("/ctv/login?error=invalid");
    }

    const response = redirectTo("/ctv");
    setCtvSessionCookie(response, createCtvSessionToken(profile));

    return response;
  } catch {
    return redirectTo("/ctv/login?error=config");
  }
}
