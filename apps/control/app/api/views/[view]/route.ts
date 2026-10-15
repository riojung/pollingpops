import type { NextRequest } from "next/server";
import { z } from "zod";
import { authenticatedRequest, jsonResponse, safeError } from "../../../../lib/http";
export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ view: string }> }) {
  try {
    const { operators, context: actor } = await authenticatedRequest(request);
    const view = z
      .enum([
        "organizations",
        "features",
        "billing",
        "credits",
        "operations",
        "support",
        "integrations",
        "audit",
      ])
      .parse((await context.params).view);
    const organizationId = z
      .string()
      .uuid()
      .optional()
      .parse(request.nextUrl.searchParams.get("organizationId") ?? undefined);
    return jsonResponse(await operators.view(actor, view, organizationId));
  } catch (error) {
    return safeError(error);
  }
}
