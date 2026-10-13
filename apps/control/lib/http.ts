import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  OperatorError,
  OPERATOR_BINDING_COOKIE,
  OPERATOR_SESSION_COOKIE,
  verifyMutationRequest,
  type ControlConfig,
} from "@openround/control-plane";
import { controlRuntime } from "./runtime";

export function operatorCookieNames(config: ControlConfig) {
  const secure = new URL(config.CONTROL_PUBLIC_ORIGIN!).protocol === "https:";
  return {
    secure,
    session: secure ? OPERATOR_SESSION_COOKIE : "pollingpops-operator-local",
    binding: secure ? OPERATOR_BINDING_COOKIE : "pollingpops-operator-login-local",
    csrf: secure ? "__Host-pollingpops-operator-csrf" : "pollingpops-operator-csrf-local",
  };
}
export function setOperatorSessionCookies(
  response: NextResponse,
  config: ControlConfig,
  session: { token: string; csrfToken: string },
) {
  const names = operatorCookieNames(config);
  const options = {
    path: "/",
    httpOnly: true,
    secure: names.secure,
    sameSite: "lax" as const,
    maxAge: 8 * 60 * 60,
  };
  response.cookies.set(names.session, session.token, options);
  response.cookies.set(names.csrf, session.csrfToken, options);
  response.cookies.set(names.binding, "", { ...options, maxAge: 0 });
}
export function jsonResponse(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "cache-control": "private, no-store" } });
}
export function safeError(error: unknown) {
  if (error instanceof OperatorError)
    return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof z.ZodError)
    return jsonResponse(
      { error: { code: "VALIDATION_ERROR", message: "Check the command fields and retry" } },
      422,
    );
  return jsonResponse(
    {
      error: {
        code: "UNAVAILABLE",
        message:
          "Operator service is unavailable. No provider credentials or customer data were returned.",
      },
    },
    503,
  );
}
export async function authenticatedRequest(request: NextRequest, mutation = false) {
  const runtime = await controlRuntime();
  const cookieNames = operatorCookieNames(runtime.config);
  const context = await runtime.auth.authenticate(request.cookies.get(cookieNames.session)?.value);
  if (mutation)
    verifyMutationRequest(
      context,
      request.headers.get("origin"),
      request.headers.get("x-operator-csrf"),
      runtime.config,
    );
  return { ...runtime, context, cookieNames, requestId: randomUUID() };
}
export async function boundedBody(request: NextRequest, maximum = 32_000): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maximum)
    throw new OperatorError(413, "BODY_TOO_LARGE", "Operator command exceeds the allowed size");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new OperatorError(415, "JSON_REQUIRED", "Operator commands require JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new OperatorError(422, "BODY_REQUIRED", "Operator command required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new OperatorError(413, "BODY_TOO_LARGE", "Operator command exceeds the allowed size");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new OperatorError(422, "INVALID_JSON", "Operator command is invalid JSON");
  }
}
