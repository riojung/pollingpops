import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  isLocalControlDevelopment,
  loadControlConfig,
  OperatorError,
} from "@openround/control-plane";
import { controlRuntime } from "../../../lib/runtime";
import { jsonResponse, safeError, setOperatorSessionCookies } from "../../../lib/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const config = loadControlConfig();
    if (!isLocalControlDevelopment(config))
      throw new OperatorError(403, "LOCAL_AUTH_DISABLED", "Local admin sign-in is disabled");
    if (request.headers.get("origin") !== config.CONTROL_PUBLIC_ORIGIN)
      throw new OperatorError(403, "FORBIDDEN_ORIGIN", "Operator sign-in origin is not allowed");
    const control = await controlRuntime();
    const result = await control.auth.localLogin(randomUUID());
    const response = jsonResponse({ signedIn: true });
    setOperatorSessionCookies(response, control.config, result);
    return response;
  } catch (error) {
    return safeError(error);
  }
}
