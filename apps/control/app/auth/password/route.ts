import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { loadControlConfig, OperatorError } from "@openround/control-plane";
import { controlRuntime } from "../../../lib/runtime";
import {
  boundedBody,
  jsonResponse,
  operatorCookieNames,
  safeError,
  setOperatorSessionCookies,
} from "../../../lib/http";

export const runtime = "nodejs";

const credentials = z.strictObject({
  username: z.string().min(1).max(128),
  password: z
    .string()
    .min(1)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 1024),
  code: z.string().regex(/^[0-9]{6}$/),
});

export async function POST(request: NextRequest) {
  try {
    const config = loadControlConfig();
    if (!config.CONTROL_ENABLED || config.CONTROL_AUTH_MODE !== "password")
      throw new OperatorError(
        404,
        "PASSWORD_AUTH_DISABLED",
        "Operator password sign-in is unavailable",
      );
    if (
      request.headers.get("origin") !== config.CONTROL_PUBLIC_ORIGIN ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new OperatorError(403, "ORIGIN_REJECTED", "Same-origin operator sign-in is required");
    const input = credentials.parse(await boundedBody(request, 8192));
    const control = await controlRuntime();
    const names = operatorCookieNames(control.config);
    const result = await control.auth.passwordLogin({
      ...input,
      requestId: randomUUID(),
      previousToken: request.cookies.get(names.session)?.value,
    });
    const response = jsonResponse({ signedIn: true });
    setOperatorSessionCookies(response, control.config, result);
    return response;
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      (error instanceof OperatorError && [401, 422].includes(error.status))
    )
      return jsonResponse(
        {
          error: {
            code: "SIGN_IN_FAILED",
            message: "Check your username, password, and authenticator code and try again",
          },
        },
        error instanceof z.ZodError ? 422 : error.status,
      );
    return safeError(error);
  }
}

export function GET() {
  const response = jsonResponse(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Operator sign-in requires a JSON POST" } },
    405,
  );
  response.headers.set("allow", "POST");
  return response;
}
