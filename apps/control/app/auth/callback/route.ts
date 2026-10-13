import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { controlRuntime } from "../../../lib/runtime";
import { operatorCookieNames, safeError } from "../../../lib/http";
import { OperatorError } from "@openround/control-plane";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const control = await controlRuntime();
    const names = operatorCookieNames(control.config);
    const state = request.nextUrl.searchParams.get("state");
    const binding = request.cookies.get(names.binding)?.value;
    if (!state || state.length > 256 || !binding || binding.length > 256)
      throw new OperatorError(401, "OIDC_INVALID", "Operator login verification failed");
    const currentUrl = new URL("/auth/callback", control.config.CONTROL_PUBLIC_ORIGIN!);
    currentUrl.search = request.nextUrl.search;
    const result = await control.auth.callback(currentUrl, state, binding, randomUUID());
    const response = NextResponse.redirect(
      new URL("/", control.config.CONTROL_PUBLIC_ORIGIN!),
      303,
    );
    const options = {
      path: "/",
      httpOnly: true,
      secure: names.secure,
      sameSite: "lax" as const,
      maxAge: 8 * 60 * 60,
    };
    response.cookies.set(names.session, result.token, options);
    response.cookies.set(names.csrf, result.csrfToken, options);
    response.cookies.set(names.binding, "", { ...options, maxAge: 0 });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return safeError(error);
  }
}
