import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceAccountContext } from "@openround/contracts";
import { createPlatformRepository, MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { ConfigSchema } from "../src/config.js";
import { MemorySessionCache } from "../src/cache.js";
import { entitlementsFor } from "../src/entitlements.js";
import { bootstrapPlatformCatalog } from "../src/platform-catalog.js";
import { verifyEmailAndSignIn } from "./support/email-auth.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});
const settings = (extra: Record<string, string> = {}) =>
  ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    BUSINESS_PLATFORM_ENABLED: "true",
    LOG_LEVEL: "silent",
    ...extra,
  });
const mutationHeaders = (cookie: string, key = randomUUID()) => ({
  cookie,
  "x-idempotency-key": key,
});
async function fixture(extra: Record<string, string> = {}) {
  const repository = new MemoryRepository();
  const config = settings(extra);
  const built = await buildApp(config, { repository, cache: new MemorySessionCache() });
  apps.push(built.app);
  return { app: built.app, repository, config, platform: createPlatformRepository(repository) };
}
async function signIn(app: FastifyInstance, email: string) {
  const requested = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  expect(requested.statusCode, requested.body).toBe(202);
  const url = new URL(requested.json<{ debugUrl: string }>().debugUrl);
  const verified = await verifyEmailAndSignIn(app, url.pathname + url.search, email);
  const raw = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(raw) ? raw[0]! : raw).split(";")[0]!;
  const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  expect(me.statusCode, me.body).toBe(200);
  return {
    cookie,
    ...me.json<{
      creator: { userId: string; workspaceId: string };
      workspace: WorkspaceAccountContext;
    }>(),
  };
}
async function setupOrganization(app: FastifyInstance, cookie: string, key = randomUUID()) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/customer/setup",
    headers: mutationHeaders(cookie, key),
    payload: {
      accountType: "organization",
      name: "ABC Company",
      workspaceName: "Alex's workspace",
      segment: "workplace",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{
    organization: { id: string; name: string; accountType: string; licenseUnit: string };
    workspace: { id: string };
    activeWorkspaceId: string;
  }>();
}
async function activateUserLicenses(
  f: Awaited<ReturnType<typeof fixture>>,
  organizationId: string,
  quantity: number,
) {
  const now = new Date();
  await f.platform.saveOffer({
    id: "team-creators",
    name: "Team creators",
    productKey: "pollingpops",
    kind: "workspace_subscription",
    licenseUnit: "user",
    version: 1,
    status: "published",
    stripePriceId: "price_creators",
    currency: "cad",
    amountMinor: 2000,
    interval: "month",
    creditQuantity: 0,
    entitlements: entitlementsFor("team", f.config),
    createdAt: now,
    updatedAt: now,
  });
  await f.platform.applySubscriptionSnapshot({
    organizationId,
    customerId: "cus_creators",
    subscriptionId: "sub_creators",
    status: "active",
    licenseQuantity: quantity,
    licenseUnit: "user",
    offerId: "team-creators",
    paidThrough: new Date(Date.now() + 86400000),
    graceUntil: null,
  });
}

describe("customer account ownership and workspace setup", () => {
  it("returns the real personal workspace name and keeps Free as a plan", async () => {
    const f = await fixture();
    const owner = await signIn(f.app, "personal-context@example.com");
    expect(owner.workspace).toMatchObject({
      id: owner.creator.workspaceId,
      accountType: "personal",
      organization: null,
      licenseUnit: "workspace",
      planSource: "free",
      permissions: { manageWorkspace: true },
    });
    expect(owner.workspace.name).toBe(f.repository.workspaces.get(owner.creator.workspaceId)?.name);
    const organizations = await f.app.inject({
      method: "GET",
      url: "/v1/organizations",
      headers: { cookie: owner.cookie },
    });
    expect(organizations.json()).toEqual({ organizations: [] });
    const renamed = await f.app.inject({
      method: "PATCH",
      url: "/v1/workspace/settings",
      headers: { cookie: owner.cookie },
      payload: { name: "My personal polls" },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({
      workspace: { name: "My personal polls", accountType: "personal" },
    });
  });

  it("lets a transferred legacy owner rename the workspace without gaining organization membership", async () => {
    const f = await fixture();
    const owner = await signIn(f.app, "legacy-rename-owner@example.com");
    const successor = await signIn(f.app, "legacy-rename-successor@example.com");
    const invited = await f.app.inject({
      method: "POST",
      url: "/v1/workspace/invitations",
      headers: { cookie: owner.cookie },
      payload: { email: "legacy-rename-successor@example.com", role: "editor" },
    });
    expect(invited.statusCode, invited.body).toBe(201);
    const token = new URL(invited.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
    const accepted = await f.app.inject({
      method: "POST",
      url: "/v1/invitations/accept",
      headers: { cookie: successor.cookie },
      payload: { token, acceptPolicies: true },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const organization = (await f.platform.getOrganizationForWorkspace(owner.creator.workspaceId))!;
    const transferred = await f.app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.id}/workspaces/${owner.creator.workspaceId}/ownership`,
      headers: mutationHeaders(owner.cookie),
      payload: { userId: successor.creator.userId },
    });
    expect(transferred.statusCode, transferred.body).toBe(200);
    expect(
      (await f.platform.listOrganizations(successor.creator.userId)).some(
        (candidate) => candidate.id === organization.id,
      ),
    ).toBe(false);
    const context = await f.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: successor.cookie },
    });
    expect(context.json()).toMatchObject({
      creator: { role: "owner", workspaceId: owner.creator.workspaceId },
      workspace: { permissions: { manageWorkspace: true, manageBilling: false } },
    });
    const payerContext = await f.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: owner.cookie },
    });
    expect(payerContext.json()).toMatchObject({
      creator: { role: "editor" },
      workspace: { permissions: { manageBilling: true } },
    });
    const payerBilling = await f.app.inject({
      method: "GET",
      url: "/v1/billing/status",
      headers: { cookie: owner.cookie },
    });
    expect(payerBilling.statusCode, payerBilling.body).toBe(200);
    const renamed = await f.app.inject({
      method: "PATCH",
      url: "/v1/workspace/settings",
      headers: { cookie: successor.cookie },
      payload: { name: "Transferred legacy workspace" },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({ workspace: { name: "Transferred legacy workspace" } });
  });

  it("labels Community access separately without inventing organization ownership", async () => {
    const f = await fixture({ COMMUNITY_MODE: "true" });
    const owner = await signIn(f.app, "community-context@example.com");
    expect(owner.workspace).toMatchObject({
      accountType: "personal",
      organization: null,
      planSource: "community",
    });
    const response = await f.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: owner.cookie },
    });
    expect(response.json()).toMatchObject({ entitlements: { plan: "team" } });
  });

  it("allows personal sign-in deletion while protecting organization ownership", async () => {
    const f = await fixture();
    const personal = await signIn(f.app, "personal-delete@example.com");
    const deleted = await f.app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: { cookie: personal.cookie },
      payload: { confirmation: "DELETE" },
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    const revoked = await f.app.inject({
      method: "GET",
      url: "/v1/auth/user",
      headers: { cookie: personal.cookie },
    });
    expect(revoked.statusCode).toBe(401);

    const owner = await signIn(f.app, "organization-delete@example.com");
    const setup = await setupOrganization(f.app, owner.cookie);
    const blocked = await f.app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: { cookie: owner.cookie },
      payload: { confirmation: "DELETE" },
    });
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json()).toMatchObject({
      error: { code: "CONFLICT", message: "Transfer organization ownership first" },
    });
    expect(
      await f.platform.getOrganization(setup.organization.id, owner.creator.userId),
    ).toMatchObject({
      status: "active",
    });
  });

  it.each([
    { BUSINESS_PLATFORM_ENABLED: "true", COMMUNITY_MODE: "false" },
    { BUSINESS_PLATFORM_ENABLED: "false", COMMUNITY_MODE: "false" },
    { BUSINESS_PLATFORM_ENABLED: "true", COMMUNITY_MODE: "true" },
  ])("keeps a personal payer signed in until subscription cancellation with %j", async (extra) => {
    const f = await fixture(extra);
    const owner = await signIn(f.app, "personal-subscribed-delete@example.com");
    const organization = (await f.platform.getOrganizationForWorkspace(owner.creator.workspaceId))!;
    const subscription = {
      organizationId: organization.id,
      customerId: "cus_personal_deletion",
      subscriptionId: "sub_personal_deletion",
      status: "active",
      licenseQuantity: 1,
      licenseUnit: "workspace" as const,
      offerId: null,
      legacyPlan: "pro" as const,
      paidThrough: new Date(Date.now() + 86_400_000),
      graceUntil: null,
    };
    await f.platform.applySubscriptionSnapshot(subscription);
    await f.platform.assignWorkspaceLicense(
      organization.id,
      owner.creator.userId,
      owner.creator.workspaceId,
      true,
    );
    const purge = vi.spyOn(f.repository, "deleteAccount");
    const removeIdentity = vi.spyOn(f.repository, "deleteUserIdentity");
    const claimMedia = vi.spyOn(f.repository, "claimWorkspaceMediaDeletion");
    const blocked = await f.app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: { cookie: owner.cookie },
      payload: { confirmation: "DELETE" },
    });
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json()).toMatchObject({
      error: { message: "Cancel the personal subscription before deleting your sign-in" },
    });
    expect(blocked.headers["set-cookie"]).toBeUndefined();
    expect(removeIdentity).not.toHaveBeenCalled();
    expect(purge).not.toHaveBeenCalled();
    expect(claimMedia).not.toHaveBeenCalled();
    expect(f.repository.workspaces.has(owner.creator.workspaceId)).toBe(true);
    expect(
      (
        await f.app.inject({
          method: "GET",
          url: "/v1/auth/user",
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(200);

    await f.platform.applySubscriptionSnapshot({ ...subscription, status: "canceled" });
    const deleted = await f.app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: { cookie: owner.cookie },
      payload: { confirmation: "DELETE" },
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    expect(
      (
        await f.app.inject({
          method: "GET",
          url: "/v1/auth/user",
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(401);
  });

  it.each([
    { BUSINESS_PLATFORM_ENABLED: "false", COMMUNITY_MODE: "false" },
    { BUSINESS_PLATFORM_ENABLED: "true", COMMUNITY_MODE: "true" },
  ])(
    "retains a member's organization workspace when deleting from a personal workspace with %j",
    async (extra) => {
      const f = await fixture(extra);
      const owner = await signIn(f.app, "retained-company-owner@example.com");
      const member = await signIn(f.app, "retained-company-member@example.com");
      const organization = await f.platform.createOrganization({
        name: "Retained company",
        actorId: owner.creator.userId,
        accountType: "organization",
        licenseUnit: "user",
      });
      await f.platform.createOrganizationWorkspace({
        organizationId: organization.id,
        actorId: owner.creator.userId,
        name: "Company owner's workspace",
        segment: "workplace",
      });
      await activateUserLicenses(f, organization.id, 2);
      await f.platform.setOrganizationMember({
        organizationId: organization.id,
        actorId: owner.creator.userId,
        userId: member.creator.userId,
        role: "member",
      });
      const seats = await f.platform.getOrganizationUserLicenses(
        organization.id,
        owner.creator.userId,
      );
      const assignedWorkspace = seats.assignments.find(
        (assignment) => assignment.userId === member.creator.userId,
      )!.workspaceId;
      const claimMedia = vi.spyOn(f.repository, "claimWorkspaceMediaDeletion");
      const purge = vi.spyOn(f.repository, "deleteAccount");
      const deletion = await f.app.inject({
        method: "DELETE",
        url: "/v1/account",
        headers: { cookie: member.cookie },
        payload: { confirmation: "DELETE" },
      });
      expect(deletion.statusCode, deletion.body).toBe(409);
      expect(deletion.json()).toMatchObject({
        error: { message: "Transfer workspace stewardship before deleting your identity" },
      });
      expect(claimMedia).not.toHaveBeenCalled();
      expect(purge).not.toHaveBeenCalled();
      expect(f.repository.workspaces.has(assignedWorkspace)).toBe(true);
      expect(f.repository.workspaces.has(member.creator.workspaceId)).toBe(true);
      expect(await f.repository.listWorkspaces(member.creator.userId)).toHaveLength(2);
    },
  );

  it("sets up an organization once, selects its named workspace, and preserves personal membership", async () => {
    const f = await fixture();
    const owner = await signIn(f.app, "setup-owner@example.com");
    const key = randomUUID();
    const created = await setupOrganization(f.app, owner.cookie, key);
    const repeated = await setupOrganization(f.app, owner.cookie, key);
    expect(repeated.organization.id).toBe(created.organization.id);
    expect(repeated.workspace.id).toBe(created.workspace.id);
    expect(created.organization).toMatchObject({
      accountType: "organization",
      licenseUnit: "user",
    });
    const me = await f.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: owner.cookie },
    });
    expect(me.json()).toMatchObject({
      workspace: {
        id: created.workspace.id,
        name: "Alex's workspace",
        accountType: "organization",
        organization: { id: created.organization.id, name: "ABC Company", role: "owner" },
        licenseUnit: "user",
      },
    });
    const list = await f.app.inject({
      method: "GET",
      url: "/v1/workspaces",
      headers: { cookie: owner.cookie },
    });
    expect(list.json<{ workspaces: unknown[] }>().workspaces).toHaveLength(2);
    const personal = await f.app.inject({
      method: "POST",
      url: "/v1/customer/setup",
      headers: mutationHeaders(owner.cookie),
      payload: { accountType: "personal" },
    });
    expect(personal.statusCode, personal.body).toBe(201);
    expect(personal.json()).toMatchObject({ activeWorkspaceId: owner.creator.workspaceId });
    expect(await f.repository.listWorkspaces(owner.creator.userId)).toHaveLength(2);
  });

  it("requires a stable setup key and deployment support for organization accounts", async () => {
    const f = await fixture({ BUSINESS_PLATFORM_ENABLED: "false" });
    const owner = await signIn(f.app, "setup-disabled@example.com");
    const denied = await f.app.inject({
      method: "POST",
      url: "/v1/customer/setup",
      headers: mutationHeaders(owner.cookie),
      payload: {
        accountType: "organization",
        name: "No business",
        workspaceName: "Owner",
        segment: "workplace",
      },
    });
    expect(denied.statusCode).toBe(403);
    const missingKey = await f.app.inject({
      method: "POST",
      url: "/v1/customer/setup",
      headers: { cookie: owner.cookie },
      payload: { accountType: "personal" },
    });
    expect(missingKey.statusCode).toBe(400);
    const personal = await f.app.inject({
      method: "POST",
      url: "/v1/customer/setup",
      headers: mutationHeaders(owner.cookie),
      payload: { accountType: "personal" },
    });
    expect(personal.statusCode, personal.body).toBe(201);
  });

  it("reserves licenses, provisions a distinct member workspace, and rejects membership bypasses", async () => {
    const f = await fixture();
    const owner = await signIn(f.app, "licensed-owner@example.com");
    const setup = await setupOrganization(f.app, owner.cookie);
    await activateUserLicenses(f, setup.organization.id, 2);
    const base = `/v1/organizations/${setup.organization.id}`;
    const pending = await f.app.inject({
      method: "POST",
      url: `${base}/invitations`,
      headers: mutationHeaders(owner.cookie),
      payload: {
        email: "licensed-member@example.com",
        role: "member",
        workspaceName: "Sales workspace",
      },
    });
    expect(pending.statusCode, pending.body).toBe(201);
    const seats = await f.app.inject({
      method: "GET",
      url: `${base}/seats`,
      headers: { cookie: owner.cookie },
    });
    expect(seats.json()).toMatchObject({ quantity: 2, assigned: 1, reserved: 1, available: 0 });
    const overLimit = await f.app.inject({
      method: "POST",
      url: `${base}/invitations`,
      headers: mutationHeaders(owner.cookie),
      payload: {
        email: "over-limit@example.com",
        role: "member",
        workspaceName: "Extra workspace",
      },
    });
    expect(overLimit.statusCode).toBe(409);
    const member = await signIn(f.app, "licensed-member@example.com");
    const token = new URL(pending.json<{ inviteUrl: string }>().inviteUrl).searchParams.get(
      "token",
    )!;
    const accepted = await f.app.inject({
      method: "POST",
      url: "/v1/organization-invitations/accept",
      headers: { cookie: member.cookie },
      payload: { token },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const assignedWorkspace = accepted.json<{ workspaceId: string }>().workspaceId;
    expect(assignedWorkspace).not.toBe(setup.workspace.id);
    expect(assignedWorkspace).not.toBe(member.creator.workspaceId);
    const me = await f.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: member.cookie },
    });
    expect(me.json()).toMatchObject({
      creator: { workspaceId: assignedWorkspace, role: "owner", plan: "team" },
      workspace: {
        name: "Sales workspace",
        organization: { id: setup.organization.id, role: "member" },
        permissions: { managePeople: false, manageBilling: false, manageIntegrations: false },
      },
    });
    const orgPeople = await f.app.inject({
      method: "GET",
      url: `${base}/members`,
      headers: { cookie: member.cookie },
    });
    expect(orgPeople.statusCode).toBe(403);
    const bypass = await f.app.inject({
      method: "POST",
      url: "/v1/workspace/invitations",
      headers: { cookie: member.cookie },
      payload: { email: "bypass@example.com", role: "editor" },
    });
    expect(bypass.statusCode).toBe(409);
    const otherWorkspace = await f.app.inject({
      method: "POST",
      url: `/v1/workspaces/${setup.workspace.id}/select`,
      headers: { cookie: member.cookie },
      payload: {},
    });
    expect(otherWorkspace.statusCode).toBe(404);
    const release = await f.app.inject({
      method: "PUT",
      url: `${base}/members/${member.creator.userId}/license`,
      headers: mutationHeaders(owner.cookie),
      payload: { assigned: false },
    });
    expect(release.statusCode, release.body).toBe(200);
    const revoked = await f.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: member.cookie },
    });
    expect(revoked.statusCode).toBe(401);
    const retained = await f.app.inject({
      method: "GET",
      url: "/v1/workspaces",
      headers: { cookie: member.cookie },
    });
    expect(retained.statusCode).toBe(200);
    expect(retained.json()).toMatchObject({ activeWorkspaceId: null });
    const staleWrite = await f.app.inject({
      method: "PATCH",
      url: "/v1/workspace/settings",
      headers: { cookie: member.cookie },
      payload: { name: "Must not rename personal workspace" },
    });
    expect(staleWrite.statusCode).toBe(401);
    const personal = await f.app.inject({
      method: "POST",
      url: `/v1/workspaces/${member.creator.workspaceId}/select`,
      headers: { cookie: member.cookie },
      payload: {},
    });
    expect(personal.statusCode).toBe(200);
    expect(f.repository.workspaces.get(assignedWorkspace)).toBeDefined();
  });

  it("versions the licensed unit instead of reinterpreting a published price", async () => {
    const f = await fixture();
    const offer = {
      id: "versioned-team",
      title: "Team",
      kind: "workspace_subscription",
      version: 1,
      published: false,
      interval: "month",
    };
    await bootstrapPlatformCatalog(
      f.platform,
      settings({ BUSINESS_CATALOG_JSON: JSON.stringify([offer]) }),
    );
    await expect(
      bootstrapPlatformCatalog(
        f.platform,
        settings({ BUSINESS_CATALOG_JSON: JSON.stringify([{ ...offer, licenseUnit: "user" }]) }),
      ),
    ).rejects.toThrow("new version");
    await bootstrapPlatformCatalog(
      f.platform,
      settings({
        BUSINESS_CATALOG_JSON: JSON.stringify([{ ...offer, version: 2, licenseUnit: "user" }]),
      }),
    );
    expect(await f.platform.getOffer(offer.id)).toMatchObject({
      version: 2,
      licenseUnit: "user",
      entitlements: { plan: "team" },
    });
  });
});
