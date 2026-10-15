import type { Entitlements } from "@openround/contracts";
import type { Plan, Repository } from "@openround/db";
import { applyFeatureEntitlements } from "./feature-policy.js";
import type { AppConfig } from "./config.js";

const millisecondsPerDay = 24 * 60 * 60 * 1_000;

export function entitlementsFor(
  plan: Plan,
  config: Pick<
    AppConfig,
    | "COMMUNITY_MODE"
    | "COMMUNITY_REPORT_RETENTION_DAYS"
    | "MAX_SESSION_PARTICIPANTS"
    | "MAX_PRACTICE_PERSONAL_LINKS"
  >,
): Entitlements {
  if (config.COMMUNITY_MODE) {
    return {
      plan: "team",
      maxParticipants: config.MAX_SESSION_PARTICIPANTS,
      maxPublishedQuizzes: null,
      reportRetentionDays: config.COMMUNITY_REPORT_RETENTION_DAYS,
      csvExport: true,
      brandTheme: true,
      followups: true,
      cohosting: true,

      maxPracticePersonalLinks: config.MAX_PRACTICE_PERSONAL_LINKS,
      recoveryTrails: true,
      maxRecoveryStages: 4,
      conceptHealth: true,
      decisionReplay: true,
      authoringJobsPerMonth: null,
    };
  }

  if (plan === "free") {
    return {
      plan,
      maxParticipants: Math.min(20, config.MAX_SESSION_PARTICIPANTS),
      maxPublishedQuizzes: 5,
      reportRetentionDays: 30,
      csvExport: false,
      brandTheme: false,
      followups: false,
      cohosting: false,

      maxPracticePersonalLinks: 0,
      recoveryTrails: false,
      maxRecoveryStages: 0,
      conceptHealth: false,
      decisionReplay: true,
      authoringJobsPerMonth: 3,
    };
  }

  return {
    plan,
    maxParticipants:
      plan === "pro"
        ? Math.min(100, config.MAX_SESSION_PARTICIPANTS)
        : config.MAX_SESSION_PARTICIPANTS,
    maxPublishedQuizzes: null,
    reportRetentionDays: 365,
    csvExport: true,
    brandTheme: true,
    followups: true,
    cohosting: true,

    maxPracticePersonalLinks:
      plan === "pro"
        ? Math.min(100, config.MAX_PRACTICE_PERSONAL_LINKS)
        : config.MAX_PRACTICE_PERSONAL_LINKS,
    recoveryTrails: true,
    maxRecoveryStages: 4,
    conceptHealth: true,
    decisionReplay: true,
    authoringJobsPerMonth: plan === "pro" ? 100 : null,
  };
}

export function retentionExpiry(now: Date, entitlements: Entitlements) {
  return new Date(now.getTime() + entitlements.reportRetentionDays * millisecondsPerDay);
}

export async function workspaceEntitlements(
  repository: Repository,
  config: Parameters<typeof entitlementsFor>[1],
  workspaceId: string,
  plan: Plan,
) {
  return applyFeatureEntitlements(repository, config, workspaceId, entitlementsFor(plan, config));
}

export function passwordProtectionAllowed(entitlements: Entitlements) {
  return entitlements.passwordProtection ?? entitlements.plan !== "free";
}
