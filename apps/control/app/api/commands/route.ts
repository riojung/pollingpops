import type { NextRequest } from "next/server";
import { authenticatedRequest, boundedBody, jsonResponse, safeError } from "../../../lib/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const { operators, context, requestId } = await authenticatedRequest(request, true);
    return jsonResponse({
      result: await operators.command(context, await boundedBody(request), requestId),
      requestId,
    });
  } catch (error) {
    return safeError(error);
  }
}
