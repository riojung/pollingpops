import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository, createPlatformRepository } from "@openround/db";
import { ConfigSchema } from "../src/config.js";
import {
  entitlementsFor,
  passwordProtectionAllowed,
  workspaceEntitlements,
} from "../src/entitlements.js";
import {
  applyFeatureEntitlements,
  resolveWorkspaceFeatures,
  workspaceFeatureEnabled,
  workspaceProductFeatures,
} from "../src/feature-policy.js";

function fixture(community = false) {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId, initialPlan: "free" });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: String(community),
  });
  return { workspaceId, repository, config, platform: createPlatformRepository(repository) };
}

describe("operator product feature policy", () => {
  it("keeps standalone boards independent of Survey dependencies and enforces assigned plans", async () => {
    const f = fixture();
    expect(await workspaceFeatureEnabled(f.repository, f.config, f.workspaceId, "ideaBoards")).toBe(
      false,
    );
    await f.platform.saveFeaturePolicy({
      expectedRevision: 0,
      features: { ideaBoards: { enabled: true, plans: ["pro"] } },
    });
    expect(await workspaceFeatureEnabled(f.repository, f.config, f.workspaceId, "ideaBoards")).toBe(
      false,
    );
    expect(
      (await workspaceProductFeatures(f.repository, f.config, f.workspaceId, "pro")).ideaBoards,
    ).toBe(true);
    expect(
      await workspaceFeatureEnabled(f.repository, f.config, f.workspaceId, "surveys", "pro"),
    ).toBe(false);
    await f.platform.saveFeaturePolicy({
      expectedRevision: 1,
      features: { ideaBoards: { enabled: false, plans: ["free", "pro", "team"] } },
    });
    expect(
      await workspaceFeatureEnabled(f.repository, f.config, f.workspaceId, "ideaBoards", "pro"),
    ).toBe(false);
  });

  it("uses the board flag and workspace allowlist only when no operator policy is saved", async () => {
    const f = fixture();
    f.config.FEATURE_IDEA_BOARDS = true;
    expect(await workspaceFeatureEnabled(f.repository, f.config, f.workspaceId, "ideaBoards")).toBe(
      false,
    );
    f.config.CORE_PARITY_WORKSPACE_ALLOWLIST = [f.workspaceId];
    expect((await workspaceProductFeatures(f.repository, f.config, f.workspaceId)).ideaBoards).toBe(
      true,
    );
  });

  it("keeps missing entries subject to their legacy flags and workspace rollout", async () => {
    const f = fixture();
    f.config.FEATURE_DECISION_REPLAY = true;
    f.config.FEATURE_RECOVERY_TRAILS = true;
    const before = await resolveWorkspaceFeatures(f.repository, f.config, f.workspaceId, "pro");
    expect(before.enabled("decisionReplay")).toBe(false);
    expect(before.enabled("recoveryTrails")).toBe(false);
    f.config.EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST = [f.workspaceId];
    const allowed = await resolveWorkspaceFeatures(f.repository, f.config, f.workspaceId, "pro");
    expect(allowed.enabled("decisionReplay")).toBe(true);
    expect(allowed.enabled("recoveryTrails")).toBe(true);
    expect(allowed.enabled("conceptHealth")).toBe(false);
  });

  it("applies durable policies immediately, overriding false env flags and empty allowlists", async () => {
    const f = fixture();
    expect(
      await workspaceFeatureEnabled(f.repository, f.config, f.workspaceId, "sessionSummaries"),
    ).toBe(false);
    await f.platform.saveFeaturePolicy({
      expectedRevision: 0,
      features: { sessionSummaries: { enabled: true, plans: ["free"] } },
    });
    expect(
      await workspaceFeatureEnabled(f.repository, f.config, f.workspaceId, "sessionSummaries"),
    ).toBe(true);
    await f.platform.saveFeaturePolicy({
      expectedRevision: 1,
      features: { sessionSummaries: { enabled: true, plans: ["pro"] } },
    });
    expect(
      await workspaceFeatureEnabled(f.repository, f.config, f.workspaceId, "sessionSummaries"),
    ).toBe(false);
    expect(
      await workspaceFeatureEnabled(
        f.repository,
        f.config,
        f.workspaceId,
        "sessionSummaries",
        "pro",
      ),
    ).toBe(true);
    await f.platform.saveFeaturePolicy({
      expectedRevision: 2,
      features: { sessionSummaries: { enabled: true, plans: [] } },
    });
    expect(
      await workspaceFeatureEnabled(
        f.repository,
        f.config,
        f.workspaceId,
        "sessionSummaries",
        "pro",
      ),
    ).toBe(false);
  });

  it("respects dependency plan access and keeps unrelated legacy settings unchanged", async () => {
    const f = fixture();
    await f.platform.saveFeaturePolicy({
      expectedRevision: 0,
      features: {
        audienceScopes: { enabled: true, plans: ["pro"] },
        feedbackRooms: { enabled: true, plans: ["free", "pro"] },
        surveys: { enabled: true, plans: ["free", "pro"] },
      },
    });
    expect(await workspaceFeatureEnabled(f.repository, f.config, f.workspaceId, "surveys")).toBe(
      false,
    );
    const paid = await resolveWorkspaceFeatures(f.repository, f.config, f.workspaceId, "pro");
    expect(paid.enabled("surveys")).toBe(true);
    expect(paid.enabled("presentations")).toBe(false);
  });

  it("resolves community workspaces as Team and event room grants against the funding plan", async () => {
    const f = fixture(true);
    await f.platform.saveFeaturePolicy({
      expectedRevision: 0,
      features: { sessionSummaries: { enabled: true, plans: ["team"] } },
    });
    const features = await resolveWorkspaceFeatures(f.repository, f.config, f.workspaceId, "pro");
    expect(features.plan).toBe("team");
    expect(features.enabled("sessionSummaries")).toBe(true);
    f.config.COMMUNITY_MODE = false;
    expect(
      await workspaceFeatureEnabled(
        f.repository,
        f.config,
        f.workspaceId,
        "sessionSummaries",
        "pro",
      ),
    ).toBe(false);
  });

  it("overlays plan capabilities without changing participant, publication or retention limits", async () => {
    const f = fixture();
    await f.platform.saveFeaturePolicy({
      expectedRevision: 0,
      features: {
        csvExport: { enabled: true, plans: ["free"] },
        brandTheme: { enabled: true, plans: ["free"] },
        followups: { enabled: true, plans: ["free"] },
        cohosting: { enabled: true, plans: ["free"] },
        passwordProtection: { enabled: true, plans: ["free"] },
        recoveryTrails: { enabled: true, plans: ["free"] },
        conceptHealth: { enabled: true, plans: ["free"] },
        decisionReplay: { enabled: false, plans: ["free"] },
        uxBeta: { enabled: true, plans: ["free"] },
        practiceAssignments: { enabled: true, plans: ["free"] },
      },
    });
    const entitlements = await workspaceEntitlements(f.repository, f.config, f.workspaceId, "free");
    expect(entitlements).toMatchObject({
      csvExport: true,
      brandTheme: true,
      followups: true,
      cohosting: true,
      passwordProtection: true,
      recoveryTrails: true,
      maxRecoveryStages: 4,
      conceptHealth: true,
      decisionReplay: false,
      maxPracticePersonalLinks: 100,
      maxParticipants: 20,
      maxPublishedQuizzes: 5,
      reportRetentionDays: 30,
    });
    expect(passwordProtectionAllowed(entitlements)).toBe(true);
    const paid = await applyFeatureEntitlements(
      f.repository,
      f.config,
      f.workspaceId,
      entitlementsFor("pro", f.config),
    );
    expect(paid).toMatchObject({
      csvExport: false,
      passwordProtection: false,
      maxParticipants: 100,
      reportRetentionDays: 365,
    });
    expect(passwordProtectionAllowed(entitlementsFor("pro", f.config))).toBe(true);
  });
});

it("registers group writers even when the deployment flag starts disabled", async () => {
  const f = fixture();
  f.config.LOG_LEVEL = "silent";
  const built = await buildApp(f.config, {
    repository: f.repository,
    cache: new MemorySessionCache(),
  });
  try {
    const magic = await built.app.inject({
      method: "POST",
      url: "/v1/auth/magic-link",
      payload: { email: "dynamic-groups@example.test", segment: "workplace", acceptPolicies: true },
    });
    const token = new URL(magic.json().debugUrl).searchParams.get("token");
    const verified = await verifyEmailAndSignIn(
      built.app,
      `/v1/auth/verify?token=${token}`,
      "dynamic-groups@example.test",
    );
    const cookie = String(verified.headers["set-cookie"]).split(";")[0]!;
    const create = () =>
      built.app.inject({
        method: "POST",
        url: "/v1/groups",
        headers: { cookie },
        payload: { name: "Dynamic group", description: "" },
      });
    expect((await create()).statusCode).toBe(404);
    await f.platform.saveFeaturePolicy({
      expectedRevision: 0,
      features: {
        uxBeta: { enabled: true, plans: ["free"] },
        groups: { enabled: true, plans: ["free"] },
      },
    });
    expect((await create()).statusCode).toBe(201);
    await f.platform.saveFeaturePolicy({
      expectedRevision: 1,
      features: {
        uxBeta: { enabled: true, plans: ["free"] },
        groups: { enabled: true, plans: ["pro"] },
      },
    });
    expect((await create()).statusCode).toBe(404);
  } finally {
    await built.app.close();
  }
});
