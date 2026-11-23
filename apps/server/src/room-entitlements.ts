import { createHash } from "node:crypto";
import type { Entitlements, RoundCohostUnavailableReason } from "@openround/contracts";
import {
  createPlatformRepository,
  PlatformError,
  type Repository,
  type PlatformRoomType,
  type PlatformRoomCoverageInput,
} from "@openround/db";
import type { AppConfig } from "./config.js";
import {
  entitlementsFor,
  workspaceEntitlements,
  workspaceEntitlementsWithAvailability,
} from "./entitlements.js";
import { grantRoomFeatures } from "./feature-policy.js";

export type RoomEntitlementConfig = Parameters<typeof entitlementsFor>[1] &
  Partial<Pick<AppConfig, "BUSINESS_PLATFORM_ENABLED" | "BUSINESS_EVENT_CREDITS_ENABLED">>;

export async function roomCreationPolicy(
  repository: Repository,
  config: RoomEntitlementConfig,
  workspaceId: string,
  useEventCredit = false,
) {
  const plan = config.COMMUNITY_MODE ? "team" : await repository.getPlan(workspaceId);
  if (!config.BUSINESS_PLATFORM_ENABLED || config.COMMUNITY_MODE) {
    if (useEventCredit)
      throw new PlatformError("ENTITLEMENT_LIMIT", "Event credits are not enabled");
    const organization = config.COMMUNITY_MODE
      ? null
      : await createPlatformRepository(repository).getOrganizationForWorkspace(workspaceId);
    return {
      entitlements: await grantRoomFeatures(
        repository,
        config,
        workspaceId,
        entitlementsFor(plan, config),
      ),
      funding: organization ? ("legacy" as const) : null,
    };
  }
  if (useEventCredit && !config.BUSINESS_EVENT_CREDITS_ENABLED) {
    throw new PlatformError("ENTITLEMENT_LIMIT", "Event credits are not enabled");
  }
  const platform = createPlatformRepository(repository);
  const organization = await platform.getOrganizationForWorkspace(workspaceId);
  if (!organization || organization.status !== "active") {
    throw new PlatformError("CONFLICT", "New activity is paused for this organization");
  }
  const licensed = await platform.workspaceHasLicense(workspaceId);
  if (licensed) {
    const subscription = await platform.getSubscription(organization.id);
    const offer = subscription.offerId ? await platform.getOffer(subscription.offerId) : null;
    const entitlements =
      offer?.entitlements ?? entitlementsFor(plan === "free" ? "pro" : plan, config);
    return {
      entitlements: {
        ...(await grantRoomFeatures(repository, config, workspaceId, entitlements)),
        maxParticipants: Math.min(entitlements.maxParticipants, config.MAX_SESSION_PARTICIPANTS),
      },
      funding: "subscription" as const,
    };
  }
  return {
    entitlements: await grantRoomFeatures(
      repository,
      config,
      workspaceId,
      entitlementsFor(useEventCredit ? "pro" : "free", config),
    ),
    funding: useEventCredit ? ("credit" as const) : ("free" as const),
  };
}

export function coverageRequest(
  policy: Awaited<ReturnType<typeof roomCreationPolicy>>,
  input: Omit<PlatformRoomCoverageInput, "funding" | "snapshot">,
): PlatformRoomCoverageInput | undefined {
  return policy.funding
    ? { ...input, funding: policy.funding, snapshot: policy.entitlements }
    : undefined;
}

/** Retained coverage remains authoritative even when new commercial writers are disabled. */
async function retainedRoomEntitlements(
  repository: Repository,
  config: RoomEntitlementConfig,
  artifactType: PlatformRoomType,
  roomId: string,
) {
  const coverage = await createPlatformRepository(repository).getRoomCoverage(artifactType, roomId);
  return coverage && !(config.COMMUNITY_MODE && coverage.funding === "legacy")
    ? coverage.snapshot
    : null;
}

async function roomEntitlementsWithAvailability(
  repository: Repository,
  config: RoomEntitlementConfig,
  artifactType: PlatformRoomType,
  roomId: string,
  workspaceId: string,
  capability: "csvExport" | "cohosting",
) {
  const snapshot = await retainedRoomEntitlements(repository, config, artifactType, roomId);
  if (snapshot)
    return {
      entitlements: snapshot,
      unavailableReason: snapshot[capability] ? null : ("room_coverage" as const),
      fromCoverage: true,
    };
  const { entitlements, unavailableReason } = await workspaceEntitlementsWithAvailability(
    repository,
    config,
    workspaceId,
    config.COMMUNITY_MODE ? "team" : await repository.getPlan(workspaceId),
    capability,
  );
  return { entitlements, unavailableReason, fromCoverage: false };
}

export async function roomEntitlementsWithExportAvailability(
  repository: Repository,
  config: RoomEntitlementConfig,
  artifactType: PlatformRoomType,
  roomId: string,
  workspaceId: string,
) {
  const { entitlements, unavailableReason, fromCoverage } = await roomEntitlementsWithAvailability(
    repository,
    config,
    artifactType,
    roomId,
    workspaceId,
    "csvExport",
  );
  return { entitlements, csvExportUnavailableReason: unavailableReason, fromCoverage };
}

export async function roundCohostUnavailableReason(
  repository: Repository,
  config: RoomEntitlementConfig,
  roundId: string,
  workspaceId: string,
): Promise<RoundCohostUnavailableReason | null> {
  const { unavailableReason } = await roomEntitlementsWithAvailability(
    repository,
    config,
    "round",
    roundId,
    workspaceId,
    "cohosting",
  );
  return unavailableReason;
}

export async function roomEntitlements(
  repository: Repository,
  config: RoomEntitlementConfig,
  artifactType: PlatformRoomType,
  roomId: string,
  workspaceId: string,
): Promise<Entitlements> {
  const snapshot = await retainedRoomEntitlements(repository, config, artifactType, roomId);
  return (
    snapshot ??
    workspaceEntitlements(
      repository,
      config,
      workspaceId,
      config.COMMUNITY_MODE ? "team" : await repository.getPlan(workspaceId),
    )
  );
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

export function roomCreationIdentity(
  workspaceId: string,
  artifactType: PlatformRoomType,
  key: string | undefined,
  request: unknown,
) {
  if (!key) return null;
  if (key.length > 160 || key.trim().length === 0) {
    throw new PlatformError("VALIDATION_ERROR", "Invalid room idempotency key");
  }
  const digest = createHash("sha256").update(`${workspaceId}:${artifactType}:${key}`).digest("hex");
  const requestHash = createHash("sha256")
    .update(JSON.stringify(canonical(request)))
    .digest("hex");
  return {
    roomId: `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
    creationKey: `${digest}:${requestHash}`,
  };
}
