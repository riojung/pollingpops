import type { BoardLaunchUnavailableReason } from "@openround/contracts";
import { createPlatformRepository, type OrganizationRecord, type Repository } from "@openround/db";
import type { AppConfig } from "./config.js";

export function ideaBoardLaunchRequiresActiveOrganization(
  config: Pick<AppConfig, "COMMUNITY_MODE"> & Partial<Pick<AppConfig, "BUSINESS_PLATFORM_ENABLED">>,
) {
  return config.BUSINESS_PLATFORM_ENABLED === true && !config.COMMUNITY_MODE;
}

/** Call only with an authorized workspace. The account response can reuse its organization read. */
export async function boardLaunchOrganizationRestricted(
  repository: Repository,
  workspaceId: string,
  knownOrganization?: OrganizationRecord | null,
) {
  const platform = createPlatformRepository(repository);
  const organization =
    knownOrganization === undefined
      ? await platform.getOrganizationForWorkspace(workspaceId)
      : knownOrganization;
  if (organization?.status !== "active") return true;
  const workspace = await platform.getWorkspaceForOperator(workspaceId);
  return workspace?.organizationId !== organization.id || workspace.status !== "active";
}

export class BoardLaunchUnavailableError extends Error {
  constructor(
    readonly code: "ROOM_CLOSED" | "FORBIDDEN" | "NOT_FOUND",
    message: string,
    readonly reason: BoardLaunchUnavailableReason,
  ) {
    super(message);
  }
}
