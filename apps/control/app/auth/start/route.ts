import { NextResponse } from "next/server";
import { controlRuntime } from "../../../lib/runtime";
import { operatorCookieNames, safeError } from "../../../lib/http";
export const runtime = "nodejs";
export async function GET() {
  try {
    const control = await controlRuntime();
    const result = await control.auth.start();
    const names = operatorCookieNames(control.config);
    const response = NextResponse.redirect(result.authorizationUrl, 303);
    response.cookies.set(names.binding, result.binding, {
      path: "/",
      httpOnly: true,
      secure: names.secure,
      sameSite: "lax",
      maxAge: 300,
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return safeError(error);
  }
}
