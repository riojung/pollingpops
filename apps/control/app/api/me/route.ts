import type { NextRequest } from "next/server";
import { operatorCapabilities, PASSWORD_OPERATOR_ISSUER } from "@openround/control-plane";
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
        ...(context.operator.issuer === PASSWORD_OPERATOR_ISSUER
          ? { username: context.operator.subject }
          : {}),
      },
      csrfToken: request.cookies.get(cookieNames.csrf)?.value ?? null,
    });
  } catch (error) {
    return safeError(error);
  }
}
