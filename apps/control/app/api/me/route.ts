import type { NextRequest } from "next/server";
import { operatorCapabilities } from "@openround/control-plane";
import { authenticatedRequest, jsonResponse, safeError } from "../../../lib/http";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const { context, cookieNames } = await authenticatedRequest(request);
    return jsonResponse({
      operator: {
        id: context.operator.id,
        name: context.operator.name,
        role: context.operator.role,
        capabilities: operatorCapabilities(context.operator),
      },
      csrfToken: request.cookies.get(cookieNames.csrf)?.value ?? null,
    });
  } catch (error) {
    return safeError(error);
  }
}
