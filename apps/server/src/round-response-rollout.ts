import { requiresExtendedRoundResponses } from "@openround/contracts";
import type { AppConfig } from "./config.js";

/** Creation and content writers only; frozen live rooms remain usable during rollback. */
export function richerRoundResponsesEnabled(
  config: Pick<AppConfig, "FEATURE_ROUND_CLIENT_PROTOCOL" | "CORE_PARITY_WORKSPACE_ALLOWLIST">,
  workspaceId: string,
) {
  return (
    config.FEATURE_ROUND_CLIENT_PROTOCOL &&
    config.CORE_PARITY_WORKSPACE_ALLOWLIST.includes(workspaceId)
  );
}

export const multiSelectPollsEnabled = richerRoundResponsesEnabled;

export function extendedRoundResponseWriteAllowed(
  config: Pick<AppConfig, "FEATURE_ROUND_CLIENT_PROTOCOL" | "CORE_PARITY_WORKSPACE_ALLOWLIST">,
  workspaceId: string,
  content: Parameters<typeof requiresExtendedRoundResponses>[0],
) {
  return (
    !requiresExtendedRoundResponses(content) || richerRoundResponsesEnabled(config, workspaceId)
  );
}

export const EXTENDED_ROUND_RESPONSE_UNAVAILABLE_MESSAGE =
  "These live response formats are not enabled for this workspace";
