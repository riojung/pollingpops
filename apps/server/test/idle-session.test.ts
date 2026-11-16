import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthSessionStateSchema } from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { ConfigSchema } from "../src/config.js";
import { MemorySessionCache } from "../src/cache.js";
import { hashToken } from "../src/security.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.useRealTimers();
});

async function fixture() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  const repository = new MemoryRepository();
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    BUSINESS_PLATFORM_ENABLED: "true",
    LOG_LEVEL: "silent",
  });
  const { app } = await buildApp(config, { repository, cache: new MemorySessionCache() });
  apps.push(app);
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `${randomUUID()}@example.test`,
    segment: "workplace",
    policyVersion: "test",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  const creator = (await repository.consumeMagicToken(tokenHash, new Date()))!;
  const token = randomUUID();
  const sessionId = randomUUID();
  await repository.createCreatorSession({
    id: sessionId,
    userId: creator.userId,
    tokenHash: hashToken(token),
    activeWorkspaceId: creator.workspaceId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  });
  const headers = { cookie: `${config.COOKIE_NAME}=${token}`, origin: config.WEB_ORIGIN };
  const activity = (intent: "activity" | "continue") =>
    app.inject({ method: "POST", url: "/v1/auth/session/activity", headers, payload: { intent } });
  return { app, repository, config, creator, token, sessionId, headers, activity };
}

describe("server-enforced login inactivity", () => {
  it("returns authoritative non-secret deadlines and never treats polling or unrelated API writes as activity", async () => {
    const f = await fixture();
    const response = await f.app.inject({ url: "/v1/auth/session", headers: f.headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const state = AuthSessionStateSchema.parse(response.json().session);
    expect(state).toMatchObject({
      sessionId: f.sessionId,
      workspaceId: f.creator.workspaceId,
      lastActivityAt: "2030-01-01T00:00:00.000Z",
      warningAt: "2030-01-01T00:05:00.000Z",
      expiresAt: "2030-01-01T00:06:00.000Z",
      absoluteExpiresAt: "2030-01-31T00:00:00.000Z",
      policy: { idleTimeoutMinutes: 5, warningDurationSeconds: 60 },
    });
    expect(JSON.stringify(state)).not.toContain(f.token);
    expect(JSON.stringify(state)).not.toContain(f.creator.email);
    vi.setSystemTime(new Date("2030-01-01T00:04:00Z"));
    expect((await f.app.inject({ url: "/v1/auth/me", headers: f.headers })).statusCode).toBe(200);
    expect(
      (
        await f.app.inject({
          method: "PUT",
          url: "/v1/account/locale",
          headers: f.headers,
          payload: { locale: "fr-FR" },
        })
      ).statusCode,
    ).toBe(200);
    vi.setSystemTime(new Date("2030-01-01T00:06:00Z"));
    for (const url of ["/v1/auth/session", "/v1/auth/me", "/v1/auth/user", "/v1/workspaces"]) {
      const expired = await f.app.inject({ url, headers: f.headers });
      expect(expired.statusCode, expired.body).toBe(401);
      expect(expired.json().error.code).toBe("SESSION_EXPIRED");
      expect(expired.headers["set-cookie"]).toBeUndefined();
    }
    const expiredWrite = await f.app.inject({
      method: "PUT",
      url: "/v1/account/locale",
      headers: f.headers,
      payload: { locale: "en-CA" },
    });
    expect(expiredWrite.statusCode).toBe(401);
    expect((await f.activity("continue")).statusCode).toBe(401);
    const logout = await f.app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: f.headers,
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers["set-cookie"]).toBeDefined();
  });

  it("only explicit continue dismisses a warning and renews the shared session before its deadline", async () => {
    const f = await fixture();
    vi.setSystemTime(new Date("2030-01-01T00:05:00Z"));
    const passive = await f.activity("activity");
    expect(passive.statusCode).toBe(200);
    expect(passive.json().session.expiresAt).toBe("2030-01-01T00:06:00.000Z");
    vi.setSystemTime(new Date("2030-01-01T00:05:30Z"));
    const continued = await f.activity("continue");
    expect(continued.statusCode).toBe(200);
    expect(continued.json().session).toMatchObject({
      sessionId: f.sessionId,
      lastActivityAt: "2030-01-01T00:05:30.000Z",
      warningAt: "2030-01-01T00:10:30.000Z",
      expiresAt: "2030-01-01T00:11:30.000Z",
      absoluteExpiresAt: "2030-01-31T00:00:00.000Z",
    });
    const otherTab = await f.app.inject({ url: "/v1/auth/session", headers: f.headers });
    expect(otherTab.json().session.expiresAt).toBe(continued.json().session.expiresAt);
    vi.setSystemTime(new Date("2030-01-01T00:11:30Z"));
    const expired = await f.activity("continue");
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe("SESSION_EXPIRED");
  });

  it("revokes a matching guarded logout without clearing a newer sign-in cookie", async () => {
    const f = await fixture();
    const newerToken = randomUUID();
    const newerSessionId = randomUUID();
    await f.repository.createCreatorSession({
      id: newerSessionId,
      userId: f.creator.userId,
      tokenHash: hashToken(newerToken),
      activeWorkspaceId: f.creator.workspaceId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const logout = await f.app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: f.headers,
      payload: { expectedSessionId: f.sessionId },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ ok: true });
    expect(logout.headers["cache-control"]).toBe("private, no-store");
    expect(logout.headers["set-cookie"]).toBeUndefined();
    expect(await f.repository.getCreatorSession(hashToken(f.token), new Date())).toBeNull();
    expect(await f.repository.getCreatorSession(hashToken(newerToken), new Date())).toMatchObject({
      id: newerSessionId,
    });
  });

  it("rejects an old logout intent sent with a newer live session without revoking either session", async () => {
    const f = await fixture();
    const newerToken = randomUUID();
    const newerSessionId = randomUUID();
    await f.repository.createCreatorSession({
      id: newerSessionId,
      userId: f.creator.userId,
      tokenHash: hashToken(newerToken),
      activeWorkspaceId: f.creator.workspaceId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const logout = await f.app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { ...f.headers, cookie: `${f.config.COOKIE_NAME}=${newerToken}` },
      payload: { expectedSessionId: f.sessionId },
    });
    expect(logout.statusCode).toBe(409);
    expect(logout.json().error.code).toBe("CONFLICT");
    expect(logout.headers["cache-control"]).toBe("private, no-store");
    expect(logout.headers["set-cookie"]).toBeUndefined();
    expect(await f.repository.getCreatorSession(hashToken(f.token), new Date())).toMatchObject({
      id: f.sessionId,
    });
    expect(await f.repository.getCreatorSession(hashToken(newerToken), new Date())).toMatchObject({
      id: newerSessionId,
    });
  });

  it("revokes a matching guarded logout even when a stale session snapshot would report no live session", async () => {
    const f = await fixture();
    const tokenHash = hashToken(f.token);
    expect(f.repository.creatorSessions.get(tokenHash)!.revoked).toBe(false);
    vi.spyOn(f.repository, "getCreatorSession").mockResolvedValueOnce(null);
    const logout = await f.app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: f.headers,
      payload: { expectedSessionId: f.sessionId },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ ok: true });
    expect(logout.headers["cache-control"]).toBe("private, no-store");
    expect(logout.headers["set-cookie"]).toBeUndefined();
    expect(f.repository.creatorSessions.get(tokenHash)!.revoked).toBe(true);
  });

  it.each(["expired", "missing"])(
    "makes guarded logout harmless with an %s session",
    async (kind) => {
      const f = await fixture();
      if (kind === "expired") vi.setSystemTime(new Date("2030-01-01T00:06:00Z"));
      const logout = await f.app.inject({
        method: "POST",
        url: "/v1/auth/logout",
        headers: kind === "missing" ? { origin: f.config.WEB_ORIGIN } : f.headers,
        payload: { expectedSessionId: f.sessionId },
      });
      expect(logout.statusCode).toBe(200);
      expect(logout.json()).toEqual({ ok: true });
      expect(logout.headers["cache-control"]).toBe("private, no-store");
      expect(logout.headers["set-cookie"]).toBeUndefined();
      expect(f.repository.creatorSessions.get(hashToken(f.token))!.revoked).toBe(
        kind === "expired",
      );
    },
  );

  it("preserves legacy empty-body logout revocation and cookie clearing", async () => {
    const f = await fixture();
    const logout = await f.app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: f.headers,
      payload: {},
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ ok: true });
    expect(logout.headers["set-cookie"]).toBeDefined();
    expect(await f.repository.getCreatorSession(hashToken(f.token), new Date())).toBeNull();
  });

  it("timestamps responses after repository latency and rejects sessions that expire while loading", async () => {
    const f = await fixture();
    const getSession = f.repository.getCreatorSession.bind(f.repository);
    vi.spyOn(f.repository, "getCreatorSession").mockImplementation(async (...args) => {
      const session = await getSession(...args);
      vi.setSystemTime(Date.now() + 1_500);
      return session;
    });
    const loaded = await f.app.inject({ url: "/v1/auth/session", headers: f.headers });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().session.serverNow).toBe("2030-01-01T00:00:01.500Z");
    vi.setSystemTime(new Date("2030-01-01T00:05:59Z"));
    const expired = await f.app.inject({ url: "/v1/auth/session", headers: f.headers });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe("SESSION_EXPIRED");
  });

  it("applies a persistent admin-only workspace policy and audits the duration", async () => {
    const f = await fixture();
    const update = await f.app.inject({
      method: "PATCH",
      url: "/v1/workspace/settings",
      headers: f.headers,
      payload: { sessionPolicy: { idleTimeoutMinutes: 1, warningDurationSeconds: 60 } },
    });
    expect(update.statusCode, update.body).toBe(200);
    expect(update.json().workspace.sessionPolicy).toEqual({
      idleTimeoutMinutes: 1,
      warningDurationSeconds: 60,
    });
    expect(
      (await f.app.inject({ url: "/v1/auth/me", headers: f.headers })).json().workspace
        .sessionPolicy.idleTimeoutMinutes,
    ).toBe(1);
    const state = (await f.app.inject({ url: "/v1/auth/session", headers: f.headers })).json()
      .session;
    expect(state.warningAt).toBe("2030-01-01T00:01:00.000Z");
    expect(state.expiresAt).toBe("2030-01-01T00:02:00.000Z");
    expect(f.repository.audits.at(-1)).toMatchObject({
      action: "workspace.settings.update",
      metadata: { idleTimeoutMinutes: 1, warningDurationSeconds: 60 },
    });
    const editorId = randomUUID();
    f.repository.users.set(editorId, {
      ...f.repository.users.get(f.creator.userId)!,
      userId: editorId,
      email: "editor@example.test",
      role: "editor",
    });
    f.repository.workspaceMembers.set(`${f.creator.workspaceId}:${editorId}`, {
      workspaceId: f.creator.workspaceId,
      userId: editorId,
      role: "editor",
      joinedAt: new Date(),
    });
    const editorToken = randomUUID();
    await f.repository.createCreatorSession({
      id: randomUUID(),
      userId: editorId,
      activeWorkspaceId: f.creator.workspaceId,
      tokenHash: hashToken(editorToken),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const forbidden = await f.app.inject({
      method: "PATCH",
      url: "/v1/workspace/settings",
      headers: { ...f.headers, cookie: `${f.config.COOKIE_NAME}=${editorToken}` },
      payload: { sessionPolicy: { idleTimeoutMinutes: 240, warningDurationSeconds: 60 } },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe("UNAUTHORIZED");
    expect(await f.repository.getWorkspaceSessionPolicy(f.creator.workspaceId)).toMatchObject({
      idleTimeoutMinutes: 1,
    });
  });

  it("bounds and validates workspace policy and retains origin protection", async () => {
    const f = await fixture();
    for (const payload of [
      {},
      { sessionPolicy: { idleTimeoutMinutes: 0 } },
      { sessionPolicy: { idleTimeoutMinutes: 241 } },
      { sessionPolicy: { idleTimeoutMinutes: 1.5 } },
      { sessionPolicy: { idleTimeoutMinutes: 5, warningDurationSeconds: 30 } },
    ]) {
      expect(
        (
          await f.app.inject({
            method: "PATCH",
            url: "/v1/workspace/settings",
            headers: f.headers,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    }
    const crossOrigin = await f.app.inject({
      method: "POST",
      url: "/v1/auth/session/activity",
      headers: { ...f.headers, origin: "https://untrusted.example" },
      payload: { intent: "continue" },
    });
    expect(crossOrigin.statusCode).toBe(403);
  });

  it("protects identity-only sessions with the default policy and no workspace", async () => {
    const f = await fixture();
    f.repository.workspaceMembers.delete(`${f.creator.workspaceId}:${f.creator.userId}`);
    const token = randomUUID();
    await f.repository.createCreatorSession({
      id: randomUUID(),
      userId: f.creator.userId,
      tokenHash: hashToken(token),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    });
    const headers = { ...f.headers, cookie: `${f.config.COOKIE_NAME}=${token}` };
    const state = await f.app.inject({ url: "/v1/auth/session", headers });
    expect(state.statusCode).toBe(200);
    expect(state.json().session).toMatchObject({
      workspaceId: null,
      policy: { idleTimeoutMinutes: 5, warningDurationSeconds: 60 },
    });
    expect((await f.app.inject({ url: "/v1/auth/user", headers })).statusCode).toBe(200);
    const noWorkspace = await f.app.inject({ url: "/v1/auth/me", headers });
    expect(noWorkspace.statusCode).toBe(401);
    expect(noWorkspace.json().error.code).toBe("UNAUTHORIZED");
    vi.setSystemTime(new Date("2030-01-01T00:06:00Z"));
    expect((await f.app.inject({ url: "/v1/auth/user", headers })).json().error.code).toBe(
      "SESSION_EXPIRED",
    );
  });

  it("keeps an unknown cookie distinct from an expired creator session", async () => {
    const f = await fixture();
    const headers = { ...f.headers, cookie: `${f.config.COOKIE_NAME}=unknown-credential` };
    for (const url of ["/v1/auth/session", "/v1/auth/me", "/v1/auth/user"]) {
      const response = await f.app.inject({ url, headers });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("UNAUTHORIZED");
    }
  });
});
