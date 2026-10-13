import { assertRestrictedRuntimeDatabasePrincipal } from "@openround/db";
import { loadControlConfig } from "@openround/control-plane";
import { jsonResponse } from "../../../../lib/http";
import { controlRuntime } from "../../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = loadControlConfig();
    if (!config.CONTROL_ENABLED)
      return jsonResponse(
        {
          status: config.NODE_ENV === "production" ? "unavailable" : "disabled",
          service: "pollingpops-control",
        },
        config.NODE_ENV === "production" ? 503 : 200,
      );
    const control = await controlRuntime();
    // Query on every readiness probe: a cached initialized runtime cannot conceal a
    // subsequently unavailable database or a changed, overly privileged principal.
    const principal = await control.repository.inspectRuntimeDatabasePrincipal();
    if (config.NODE_ENV === "production") assertRestrictedRuntimeDatabasePrincipal(principal);
    await control.platform.listOperators();
    return jsonResponse({ status: "ready", service: "pollingpops-control" });
  } catch {
    return jsonResponse({ status: "unavailable", service: "pollingpops-control" }, 503);
  }
}
