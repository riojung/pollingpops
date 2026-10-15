import type { NextRequest } from "next/server";
import { loadControlConfig, OperatorError, operatorCapabilities } from "@openround/control-plane";
import { authenticatedRequest, jsonResponse, safeError } from "../../../lib/http";
import { allowedViews, viewDetails } from "../../console-views";

export const runtime = "nodejs";

// This is the only cross-origin operator endpoint. It exposes navigation metadata,
// never customer records or mutation credentials. Mutations keep their own Origin boundary.
export async function GET(request: NextRequest) {
  let productOrigin: string | undefined;
  let response;
  try {
    const config = loadControlConfig();
    const origin = request.headers.get("origin");
    if (origin) {
      if (origin !== config.CONTROL_PRODUCT_ORIGIN)
        throw new OperatorError(
          403,
          "FORBIDDEN_ORIGIN",
          "Operator navigation origin is not allowed",
        );
      productOrigin = origin;
    }
    const { context, config: currentConfig } = await authenticatedRequest(request);
    const capabilities = operatorCapabilities(context.operator);
    response = jsonResponse({
      operator: { name: context.operator.name, role: context.operator.role },
      links: allowedViews(capabilities).map((id) => ({
        id,
        label: viewDetails[id].title,
        href: new URL(`/?view=${id}`, currentConfig.CONTROL_PUBLIC_ORIGIN!).href,
      })),
    });
  } catch (error) {
    response = safeError(error);
  }
  response.headers.set("vary", "Origin");
  if (productOrigin) {
    response.headers.set("access-control-allow-origin", productOrigin);
    response.headers.set("access-control-allow-credentials", "true");
  }
  return response;
}
