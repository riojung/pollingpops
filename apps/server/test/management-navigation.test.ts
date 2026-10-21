import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPlatformRepository, MemoryRepository } from "@openround/db";
import { ManagementNavigationSchema } from "@openround/contracts";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { ConsoleMailer } from "../src/mailer.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

async function fixture(extra: Record<string, string | undefined> = {}) {
  vi.spyOn(ConsoleMailer.prototype, "sendMagicLink").mockResolvedValue();
  const repository = new MemoryRepository();
  const { app: target } = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      BUSINESS_PLATFORM_ENABLED: "true",
      LOG_LEVEL: "silent",
      ...extra,
    }),
    { repository, cache: new MemorySessionCache() },
  );
  app = target;
  return { app: target, repository, platform: createPlatformRepository(repository) };
}

async function signIn(target: FastifyInstance) {
  const verifiedEmail = `navigation-${randomUUID()}@example.test`;
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: {
      email: verifiedEmail,
      segment: "workplace",
      acceptPolicies: true,
    },
  });
  const token = new URL(magic.json().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(
    target,
    `/v1/auth/verify?token=${token}`,
    verifiedEmail,
  );
  const cookies = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
  const identity = await target.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  return { cookie, creator: identity.json().creator as { userId: string; workspaceId: string } };
}

describe("authenticated management discovery", () => {
  it.each([{ BUSINESS_PLATFORM_ENABLED: "false" }, { COMMUNITY_MODE: "true" }])(
    "returns an explicit unavailable state without missing routes for %j",
    async (extra) => {
      const { app } = await fixture(extra);
      const response = await app.inject({ method: "GET", url: "/v1/auth/navigation" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(ManagementNavigationSchema.parse(response.json())).toEqual({
        user: null,
        organizationManagementEnabled: false,
        organizations: [],
        operatorConsoleOrigin: null,
      });
    },
  );

  it("keeps console discovery absent while signed out even with an operator origin configured", async () => {
    const { app } = await fixture({ CONTROL_PUBLIC_ORIGIN: "https://control.example.test/" });
    const providerRequest = vi.spyOn(globalThis, "fetch");
    const response = await app.inject({ method: "GET", url: "/v1/auth/navigation" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: null,
      organizationManagementEnabled: true,
      organizations: [],
      operatorConsoleOrigin: null,
    });
    expect(providerRequest).not.toHaveBeenCalled();
  });

  it("returns only local customer memberships and never grants an operator role to an organization owner", async () => {
    const { app, platform } = await fixture();
    const owner = await signIn(app);
    const other = await signIn(app);
    const organization = (await platform.getOrganizationForWorkspace(owner.creator.workspaceId))!;
    const response = await app.inject({
      method: "GET",
      url: "/v1/auth/navigation",
      headers: { cookie: owner.cookie },
    });
    const data = ManagementNavigationSchema.parse(response.json());
    expect(data.user?.userId).toBe(owner.creator.userId);
    expect(data.organizations).toEqual([
      { id: organization.id, name: organization.name, role: "owner" },
    ]);
    expect(data.organizations).not.toContainEqual(
      expect.objectContaining({ id: other.creator.workspaceId }),
    );
    expect(response.json()).not.toHaveProperty("operator");
    expect(response.json()).not.toHaveProperty("capabilities");
    expect(data.operatorConsoleOrigin).toBeNull();
  });

  it("supports billing-only identities and rechecks membership changes and session revocation", async () => {
    const { app, repository, platform } = await fixture();
    const owner = await signIn(app);
    const finance = await signIn(app);
    const organization = (await platform.getOrganizationForWorkspace(owner.creator.workspaceId))!;
    await platform.setOrganizationMember({
      organizationId: organization.id,
      actorId: owner.creator.userId,
      userId: finance.creator.userId,
      role: "billing",
    });
    for (const [id, member] of repository.workspaceMembers)
      if (member.userId === finance.creator.userId) repository.workspaceMembers.delete(id);
    const headers = { cookie: finance.cookie };
    expect((await app.inject({ method: "GET", url: "/v1/auth/me", headers })).statusCode).toBe(401);
    const read = async () =>
      ManagementNavigationSchema.parse(
        (
          await app.inject({
            method: "GET",
            url: "/v1/auth/navigation",
            headers,
          })
        ).json(),
      );
    expect((await read()).organizations).toContainEqual({
      id: organization.id,
      name: organization.name,
      role: "billing",
    });
    expect((await read()).operatorConsoleOrigin).toBeNull();
    await platform.setOrganizationMember({
      organizationId: organization.id,
      actorId: owner.creator.userId,
      userId: finance.creator.userId,
      role: "member",
    });
    expect((await read()).organizations).toContainEqual({
      id: organization.id,
      name: organization.name,
      role: "member",
    });
    await app.inject({ method: "POST", url: "/v1/auth/logout", headers, payload: {} });
    expect(await read()).toMatchObject({ user: null, organizations: [] });
  });
});
