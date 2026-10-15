import {
  productFeatureCatalog,
  type Entitlements,
  type Plan,
  type ProductFeatureKey,
  type ProductFeatureRules,
  type WorkspaceProductFeatures,
  productFeatureKeys,
} from "@openround/contracts";
import { createPlatformRepository, type Repository, type PlatformRoomType } from "@openround/db";
import type { AppConfig } from "./config.js";

type PolicyConfig = Partial<AppConfig> & Pick<AppConfig, "COMMUNITY_MODE">;
const entitlementFeatures = [
  "csvExport",
  "brandTheme",
  "followups",
  "cohosting",
  "passwordProtection",
  "recoveryTrails",
  "conceptHealth",
  "decisionReplay",
] as const;
const flagKeys: Partial<Record<ProductFeatureKey, keyof AppConfig>> = {
  roundExperiences: "FEATURE_ROUND_EXPERIENCES",
  audiencePulse: "FEATURE_AUDIENCE_PULSE",
  roomChat: "FEATURE_ROOM_CHAT",
  uxBeta: "FEATURE_UX_BETA",
  recoveryRehearsal: "FEATURE_RECOVERY_REHEARSAL",
  practiceAssignments: "FEATURE_PRACTICE_ASSIGNMENTS",
  workspaceShell: "FEATURE_WORKSPACE_SHELL",
  builderV2: "FEATURE_BUILDER_V2",
  presentations: "FEATURE_PRESENTATIONS",
  groups: "FEATURE_GROUPS",
  discover: "FEATURE_DISCOVER",
  presentationRealtime: "FEATURE_PRESENTATION_REALTIME",
  presentationCompanion: "FEATURE_PRESENTATION_COMPANION",
  liveFlexMode: "FEATURE_LIVE_FLEX_MODE",
  recoveryPacks: "FEATURE_RECOVERY_PACKS",
  recoveryPackLiveCards: "FEATURE_RECOVERY_PACK_LIVE_CARDS",
  questionHealth: "FEATURE_QUESTION_HEALTH",
  decisionReplay: "FEATURE_DECISION_REPLAY",
  recoveryTrails: "FEATURE_RECOVERY_TRAILS",
  conceptHealth: "FEATURE_CONCEPT_HEALTH",
  audienceScopes: "FEATURE_AUDIENCE_SCOPES",
  roundClientProtocol: "FEATURE_ROUND_CLIENT_PROTOCOL",
  feedbackRooms: "FEATURE_FEEDBACK_ROOMS",
  surveys: "FEATURE_SURVEYS",
  sessionSummaries: "FEATURE_SESSION_SUMMARIES",
};
const professional = new Set<ProductFeatureKey>([
  "uxBeta",
  "recoveryRehearsal",
  "practiceAssignments",
  "workspaceShell",
  "builderV2",
  "presentations",
  "groups",
  "discover",
]);
const evidence = new Set<ProductFeatureKey>([
  "presentationRealtime",
  "presentationCompanion",
  "liveFlexMode",
  "recoveryPacks",
  "recoveryPackLiveCards",
  "questionHealth",
  "decisionReplay",
  "recoveryTrails",
  "conceptHealth",
]);
const parity = new Set<ProductFeatureKey>([
  "audienceScopes",
  "roundClientProtocol",
  "feedbackRooms",
  "surveys",
  "sessionSummaries",
]);
const dependencies = new Map(
  productFeatureCatalog.map((feature) => [feature.key, feature.dependencies]),
);

/** A fresh durable policy read makes operator changes visible across API and job processes. */
export async function resolveWorkspaceFeatures(
  repository: Repository,
  config: PolicyConfig,
  workspaceId: string,
  planOverride?: Plan,
) {
  const [policy, storedPlan] = await Promise.all([
    createPlatformRepository(repository).getFeaturePolicy(),
    planOverride ? Promise.resolve(planOverride) : repository.getPlan(workspaceId),
  ]);
  const plan = config.COMMUNITY_MODE ? "team" : storedPlan;
  return featureResolver(policy?.features ?? {}, config, plan, workspaceId);
}

export function featureResolver(
  rules: ProductFeatureRules,
  config: PolicyConfig,
  plan: Plan,
  workspaceId?: string,
) {
  const legacy = (key: ProductFeatureKey) => {
    if (!flagKeys[key] && entitlementFeatures.includes(key as (typeof entitlementFeatures)[number]))
      return plan !== "free";
    const flag = flagKeys[key];
    if (!flag || !config[flag]) return false;
    if (!workspaceId) return true;
    if (professional.has(key))
      return config.UX_BETA_WORKSPACE_ALLOWLIST?.includes(workspaceId) === true;
    if (evidence.has(key))
      return config.EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST?.includes(workspaceId) === true;
    if (parity.has(key))
      return config.CORE_PARITY_WORKSPACE_ALLOWLIST?.includes(workspaceId) === true;
    const allowed = config.THEMED_INTERACTIONS_WORKSPACE_ALLOWLIST ?? [];
    return allowed.length === 0 || allowed.includes(workspaceId);
  };
  const enabled = (key: ProductFeatureKey): boolean => {
    const rule = rules[key];
    return (
      (rule ? rule.enabled && rule.plans.includes(plan) : legacy(key)) &&
      (dependencies.get(key) ?? []).every(enabled)
    );
  };
  return { plan, enabled, rules };
}

export async function workspaceFeatureEnabled(
  repository: Repository,
  config: PolicyConfig,
  workspaceId: string,
  key: ProductFeatureKey,
  planOverride?: Plan,
) {
  return (await resolveWorkspaceFeatures(repository, config, workspaceId, planOverride)).enabled(
    key,
  );
}

/** Launch previews and account flags share the same policy and emergency controls. */
export async function workspaceProductFeatures(
  repository: Repository,
  config: PolicyConfig,
  workspaceId: string,
  planOverride?: Plan,
): Promise<WorkspaceProductFeatures> {
  const [features, runtime] = await Promise.all([
    resolveWorkspaceFeatures(repository, config, workspaceId, planOverride),
    repository.getOperationalFeatures(),
  ]);
  return {
    multiSelectPolls: features.enabled("roundClientProtocol"),
    rankingPolls: features.enabled("roundClientProtocol"),
    openTextPolls: features.enabled("roundClientProtocol"),
    wordCloudPolls: features.enabled("roundClientProtocol"),
    roundExperiences: features.enabled("roundExperiences") && runtime.roundExperiences,
    audiencePulse: features.enabled("audiencePulse") && runtime.audiencePulse,
    roomChat: features.enabled("roomChat") && runtime.roomChat,
    uxBeta: features.enabled("uxBeta"),
    recoveryRehearsal: features.enabled("recoveryRehearsal"),
    practiceAssignments: features.enabled("practiceAssignments"),
    workspaceShell: features.enabled("workspaceShell"),
    builderV2: features.enabled("builderV2"),
    presentations: features.enabled("presentations"),
    presentationRealtime: features.enabled("presentationRealtime"),
    presentationCompanion: features.enabled("presentationCompanion"),
    liveFlexMode: features.enabled("liveFlexMode"),
    questionHealth: features.enabled("questionHealth"),
    recoveryPacks: features.enabled("recoveryPacks"),
    surveys: features.enabled("surveys"),
    groups: features.enabled("groups"),
    discover: features.enabled("discover"),
  };
}

/** Only new grants are changed; roomEntitlements returns retained coverage before this overlay. */
export async function applyFeatureEntitlements(
  repository: Repository,
  config: PolicyConfig,
  workspaceId: string,
  entitlements: Entitlements,
): Promise<Entitlements> {
  const resolver = await resolveWorkspaceFeatures(
    repository,
    config,
    workspaceId,
    entitlements.plan,
  );
  return featureEntitlements(resolver, config, entitlements);
}

function featureEntitlements(
  resolver: ReturnType<typeof featureResolver>,
  config: PolicyConfig,
  entitlements: Entitlements,
): Entitlements {
  const result = {
    ...entitlements,
    passwordProtection: entitlements.passwordProtection ?? entitlements.plan !== "free",
  };
  for (const key of entitlementFeatures) {
    if (resolver.rules[key]) result[key] = resolver.enabled(key);
  }
  if (resolver.rules.recoveryTrails && result.recoveryTrails && result.maxRecoveryStages === 0)
    result.maxRecoveryStages = 4;
  if (
    (resolver.rules.practiceAssignments || resolver.rules.followups) &&
    resolver.enabled("practiceAssignments") &&
    result.followups &&
    result.maxPracticePersonalLinks === 0
  )
    result.maxPracticePersonalLinks = Math.min(100, config.MAX_PRACTICE_PERSONAL_LINKS ?? 100);
  return result;
}

export async function publicProductFeatureEnabled(
  repository: Repository,
  config: PolicyConfig,
  key: ProductFeatureKey,
) {
  const policy = await createPlatformRepository(repository).getFeaturePolicy();
  return (["free", "pro", "team"] as const).some((plan) =>
    featureResolver(policy?.features ?? {}, config, plan).enabled(key),
  );
}

/** Freeze accepted room access independently of subsequent product rollout changes. */
export async function grantRoomFeatures(
  repository: Repository,
  config: PolicyConfig,
  workspaceId: string,
  entitlements: Entitlements,
): Promise<Entitlements> {
  const features = await resolveWorkspaceFeatures(
    repository,
    config,
    workspaceId,
    entitlements.plan,
  );
  return {
    ...featureEntitlements(features, config, entitlements),
    featureGrants: Object.fromEntries(
      productFeatureKeys.map((key) => [key, features.enabled(key)]),
    ),
  };
}

/** New room-specific writers use the room funding plan; active interactions can retain grants. */
export async function roomFeatureEnabled(
  repository: Repository,
  config: PolicyConfig,
  kind: PlatformRoomType,
  roomId: string,
  workspaceId: string,
  key: ProductFeatureKey,
  retainGrant = false,
) {
  const coverage = await createPlatformRepository(repository).getRoomCoverage(kind, roomId);
  const snapshot =
    coverage && !(config.COMMUNITY_MODE && coverage.funding === "legacy")
      ? coverage.snapshot
      : undefined;
  if (retainGrant && snapshot) {
    if (snapshot.featureGrants?.[key] !== undefined) return snapshot.featureGrants[key]!;
    // Older commercial coverage predates explicit feature grants. Keep its legacy rollout
    // baseline instead of applying an operator's first managed policy to an accepted room.
    return featureResolver({}, config, snapshot.plan, workspaceId).enabled(key);
  }
  return workspaceFeatureEnabled(repository, config, workspaceId, key, snapshot?.plan);
}
