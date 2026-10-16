import type { NextRequest } from "next/server";
import { loadControlConfig, OperatorError, operatorCapabilities } from "@openround/control-plane";
import { authenticatedRequest, jsonResponse, safeError } from "../../../lib/http";
import { allowedViews, viewDetails } from "../../console-views";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const config = loadControlConfig();
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if (
      (origin && origin !== config.CONTROL_PUBLIC_ORIGIN) ||
      (site && !["same-origin", "none"].includes(site))
    )
      throw new OperatorError(403, "FORBIDDEN_ORIGIN", "Operator navigation origin is not allowed");
    const { context, config: currentConfig } = await authenticatedRequest(request);
    const capabilities = operatorCapabilities(context.operator);
    return jsonResponse({
      operator: { name: context.operator.name, role: context.operator.role },
      links: allowedViews(capabilities).map((id) => ({
        id,
        label: viewDetails[id].title,
        href: new URL(`/?view=${id}`, currentConfig.CONTROL_PUBLIC_ORIGIN!).href,
      })),
    });
  } catch (error) {
    return safeError(error);
  }
}
