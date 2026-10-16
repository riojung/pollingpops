import { NextResponse } from "next/server";
import { loadControlConfig, OperatorError } from "@openround/control-plane";
import { controlRuntime } from "../../../lib/runtime";
import { operatorCookieNames, safeError } from "../../../lib/http";
export const runtime = "nodejs";
export async function GET() {
  try {
    const config = loadControlConfig();
    if (!config.CONTROL_ENABLED)
      throw new OperatorError(404, "CONTROL_DISABLED", "Operator control is disabled");
    if (config.CONTROL_AUTH_MODE === "password") {
      const response = NextResponse.redirect(new URL("/", config.CONTROL_PUBLIC_ORIGIN!), 303);
      response.headers.set("cache-control", "private, no-store");
      return response;
    }
    if (config.CONTROL_AUTH_MODE !== "oidc")
      throw new OperatorError(
        403,
        "PASSWORD_CONFIGURATION_REQUIRED",
        "Configure standalone password and authenticator sign-in for this console",
      );
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
