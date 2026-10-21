import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { PostgresRepository } from "@openround/db";
import { preparePostgresTestRuntime } from "../../../packages/db/test/support/postgres-test-runtime.js";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import type { Mailer } from "../src/mailer.js";

class CapturedInbox implements Mailer {
  readonly verifications: Array<{ email: string; url: string }> = [];
  readonly pins: Array<{ email: string; pin: string }> = [];
  readonly invitations: Array<{ email: string; url: string }> = [];
  async sendAccountVerification(email: string, url: string) {
    this.verifications.push({ email, url });
  }
  async sendSignInPin(email: string, pin: string) {
    this.pins.push({ email, pin });
  }
  async sendWorkspaceInvitation(email: string, url: string) {
    this.invitations.push({ email, url });
  }
}

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
const webOrigin = "http://localhost:3000";
const requestHeaders = { origin: webOrigin };

function sessionCookie(response: LightMyRequestResponse) {
  const value = response.headers["set-cookie"]!;
  return (Array.isArray(value) ? value[0]! : value).split(";")[0]!;
}

describe.skipIf(!(adminUrl && runtimeUrl))("PostgreSQL-backed email PIN API", () => {
  const databaseName = `email_pin_api_${randomUUID().replaceAll("-", "")}`;
  const apps: FastifyInstance[] = [];
  const repositories: PostgresRepository[] = [];
  const inbox = new CapturedInbox();
  let administrator: PostgresRepository | undefined;
  let databaseCreated = false;

  beforeAll(async () => {
    await preparePostgresTestRuntime(adminUrl!, runtimeUrl!);
    const cluster = new PostgresRepository(adminUrl!);
    try {
      await cluster.pool.query(`CREATE DATABASE "${databaseName}"`);
      databaseCreated = true;
    } finally {
      await cluster.close();
    }
    const admin = new URL(adminUrl!);
    const runtime = new URL(runtimeUrl!);
    admin.pathname = `/${databaseName}`;
    runtime.pathname = `/${databaseName}`;
    administrator = new PostgresRepository(admin.toString());
    await administrator.migrate();
    const cache = new MemorySessionCache();
    const config = ConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: runtime.toString(),
      BUSINESS_PLATFORM_ENABLED: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: webOrigin,
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
    });
    for (let index = 0; index < 2; index += 1) {
      const repository = new PostgresRepository(runtime.toString());
      repositories.push(repository);
      try {
        const { app } = await buildApp(config, { repository, cache, mailer: inbox });
        apps.push(app);
      } catch (error) {
        await repository.close();
        throw error;
      }
    }
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await administrator?.close();
    if (!databaseCreated) return;
    const cluster = new PostgresRepository(adminUrl!);
    try {
      await cluster.pool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    } finally {
      await cluster.close();
    }
  });

  const post = (app: FastifyInstance, url: string, payload: object, cookie?: string) =>
    app.inject({
      method: "POST",
      url,
      headers: { ...requestHeaders, ...(cookie ? { cookie } : {}) },
      payload,
    });

  async function verifyEmail(email: string) {
    const requested = await post(apps[0]!, "/v1/auth/email-verification", {
      email,
      segment: "education",
      acceptPolicies: true,
    });
    expect(requested.statusCode, requested.body).toBe(202);
    expect(requested.headers["set-cookie"]).toBeUndefined();
    const url = new URL(inbox.verifications.findLast((mail) => mail.email === email)!.url);
    const verified = await apps[1]!.inject({
      method: "GET",
      url: `${url.pathname}${url.search}`,
    });
    expect(verified.statusCode, verified.body).toBe(302);
    expect(verified.headers["set-cookie"]).toBeUndefined();
    expect(new URL(verified.headers.location!).pathname).toBe("/signin");
    expect(new URL(verified.headers.location!).searchParams.get("verified")).toBe("1");
    return (await repositories[0]!.getVerifiedEmailIdentity(email))!;
  }

  async function requestPin(email: string, workspaceId?: string) {
    const requested = await post(apps[0]!, "/v1/auth/pin/request", {
      email,
      acceptPolicies: true,
      ...(workspaceId ? { workspaceId } : {}),
    });
    expect(requested.statusCode, requested.body).toBe(202);
    expect(requested.headers["set-cookie"]).toBeUndefined();
    const pin = inbox.pins.findLast((mail) => mail.email === email)!.pin;
    expect(pin).toMatch(/^\d{6}$/);
    return { challengeId: requested.json<{ challengeId: string }>().challengeId, pin };
  }

  it("separates verification from a single-use PIN session across two restricted runtime apps", async () => {
    expect(await repositories[0]!.inspectRuntimeDatabasePrincipal()).toMatchObject({
      runtimeRoleMember: true,
      superuser: false,
      bypassRls: false,
      unexpectedRoleMember: false,
    });
    const email = "postgres-api-creator@example.test";
    const identity = await verifyEmail(email);
    expect(
      (
        await administrator!.pool.query("SELECT id FROM creator_sessions WHERE user_id = $1", [
          identity.user.userId,
        ])
      ).rows,
    ).toEqual([]);
    expect((await apps[0]!.inject({ url: "/v1/auth/me" })).statusCode).toBe(401);
    const pin = await requestPin(email);
    const responses = await Promise.all(apps.map((app) => post(app, "/v1/auth/pin/verify", pin)));
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401]);
    expect(responses.filter((response) => response.headers["set-cookie"])).toHaveLength(1);
    const signedIn = responses.find((response) => response.statusCode === 200)!;
    const cookie = sessionCookie(signedIn);
    for (const app of apps) {
      const me = await app.inject({ url: "/v1/auth/me", headers: { cookie } });
      expect(me.statusCode, me.body).toBe(200);
      expect(me.json()).toMatchObject({
        creator: {
          userId: identity.user.userId,
          workspaceId: identity.creator!.workspaceId,
          role: "owner",
        },
      });
    }
    const replay = await post(apps[1]!, "/v1/auth/pin/verify", pin);
    expect(replay.statusCode).toBe(401);
    expect(replay.headers["set-cookie"]).toBeUndefined();
    expect(
      (
        await administrator!.pool.query("SELECT id FROM creator_sessions WHERE user_id = $1", [
          identity.user.userId,
        ])
      ).rows,
    ).toHaveLength(1);
  });

  it("selects an existing creator's invited workspace after anonymous acceptance and a new PIN", async () => {
    const email = "postgres-api-existing-invitee@example.test";
    const existing = await verifyEmail(email);
    const ownerEmail = "postgres-api-invitation-owner@example.test";
    const owner = await verifyEmail(ownerEmail);
    const ownerSignedIn = await post(apps[1]!, "/v1/auth/pin/verify", await requestPin(ownerEmail));
    expect(ownerSignedIn.statusCode, ownerSignedIn.body).toBe(200);
    const invitation = await post(
      apps[0]!,
      "/v1/workspace/invitations",
      { email, role: "editor" },
      sessionCookie(ownerSignedIn),
    );
    expect(invitation.statusCode, invitation.body).toBe(201);
    const token = new URL(
      inbox.invitations.findLast((mail) => mail.email === email)!.url,
    ).searchParams.get("token");
    const accepted = await post(apps[1]!, "/v1/invitations/accept", {
      token,
      acceptPolicies: true,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.headers["set-cookie"]).toBeUndefined();
    expect(accepted.json()).toMatchObject({ requiresSignIn: true });
    expect((await repositories[0]!.getVerifiedEmailIdentity(email))!.creator!.workspaceId).toBe(
      existing.creator!.workspaceId,
    );
    const signedIn = await post(
      apps[0]!,
      "/v1/auth/pin/verify",
      await requestPin(email, owner.creator!.workspaceId),
    );
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    const me = await apps[1]!.inject({
      url: "/v1/auth/me",
      headers: { cookie: sessionCookie(signedIn) },
    });
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json()).toMatchObject({
      creator: {
        userId: existing.user.userId,
        workspaceId: owner.creator!.workspaceId,
        role: "editor",
      },
    });
  });
});
