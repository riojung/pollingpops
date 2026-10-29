import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import type { Mailer } from "../src/mailer.js";
import { hashToken } from "../src/security.js";

class Inbox implements Mailer {
  readonly verifications: Array<{ email: string; url: string }> = [];
  readonly pins: Array<{ email: string; pin: string }> = [];
  failPin = false;
  pinDelivery: Promise<void> | null = null;
  async sendAccountVerification(email: string, url: string) {
    this.verifications.push({ email, url });
  }
  async sendSignInPin(email: string, pin: string) {
    this.pins.push({ email, pin });
    if (this.failPin) throw new Error("Synthetic SMTP failure");
    await this.pinDelivery;
  }
  async sendWorkspaceInvitation() {}
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.useRealTimers();
});
async function fixture(
  options: {
    repository?: MemoryRepository;
    cache?: MemorySessionCache;
    production?: boolean;
  } = {},
) {
  const repository = options.repository ?? new MemoryRepository();
  const cache = options.cache ?? new MemorySessionCache();
  const mailer = new Inbox();
  const config = ConfigSchema.parse({
    NODE_ENV: options.production ? "production" : "test",
    ...(options.production
      ? {
          DATABASE_URL: "postgresql://runtime:test-only@database.internal/openround",
          REDIS_URL: "rediss://cache.internal:6380",
          SMTP_URL: "smtp://mail.internal:2525",
          COOKIE_SECURE: "true",
          METRICS_ENABLED: "false",
        }
      : { ALLOW_IN_MEMORY: "true" }),
    COMMUNITY_MODE: "false",
    WEB_ORIGIN: options.production ? "https://app.example.ca" : "http://localhost:3000",
    PUBLIC_API_URL: options.production ? "https://api.example.ca" : "http://localhost:4000",
    LOG_LEVEL: "silent",
  });
  const { app } = await buildApp(config, { repository, cache, mailer });
  apps.push(app);
  const post = (url: string, payload: object) =>
    app.inject({
      method: "POST",
      url,
      payload,
      headers: { origin: config.WEB_ORIGIN },
    });
  const register = (email = "creator@example.com", returnTo?: string) =>
    post("/v1/auth/email-verification", {
      email,
      segment: "education",
      acceptPolicies: true,
      ...(returnTo ? { returnTo } : {}),
    });
  const verify = (index = mailer.verifications.length - 1) => {
    const url = new URL(mailer.verifications[index]!.url);
    return app.inject({ method: "GET", url: `${url.pathname}${url.search}` });
  };
  const requestPin = (email = "creator@example.com", returnTo?: string, workspaceId?: string) =>
    post("/v1/auth/pin/request", {
      email,
      acceptPolicies: true,
      ...(returnTo ? { returnTo } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    });
  const complete = (challengeId: string, pin = mailer.pins.at(-1)!.pin) =>
    post("/v1/auth/pin/verify", { challengeId, pin });
  return { app, repository, cache, mailer, config, post, register, verify, requestPin, complete };
}
function cookie(response: { headers: Record<string, unknown> }) {
  const value = response.headers["set-cookie"];
  return String(Array.isArray(value) ? value[0] : value).split(";")[0]!;
}
function wrongPin(pin: string) {
  return pin === "000000" ? "000001" : "000000";
}

describe("verified email followed by a separate sign-in PIN", () => {
  it("treats repeated signup of a verified mailbox as a generic no-op and leaves its requested PIN usable", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await fixture({ production: true });
    const initial = await f.register();
    expect(initial.statusCode).toBe(202);
    await f.verify();
    const identity = (await f.repository.getVerifiedEmailIdentity("creator@example.com"))!;
    f.repository.workspaces.get(identity.creator!.workspaceId)!.name = "Configured workspace";
    await f.repository.updateUserLocale(identity.user.userId, "ja-JP");
    const pin = await f.requestPin();
    const pending = structuredClone(
      f.repository.emailPinChallenges.get(hashToken(pin.json().challengeId)),
    );
    const profile = structuredClone(f.repository.users.get(identity.user.userId));
    const workspace = structuredClone(f.repository.workspaces.get(identity.creator!.workspaceId));
    const consent = structuredClone(f.repository.consents);
    const tokens = structuredClone(f.repository.magicTokens);
    for (const endpoint of ["/v1/auth/email-verification", "/v1/auth/magic-link"]) {
      vi.setSystemTime(Date.now() + 61000);
      const repeated = await f.post(endpoint, {
        email: " Creator@Example.com ",
        segment: "workplace",
        acceptPolicies: true,
        returnTo: "/customer/setup?accountType=organization",
      });
      expect(repeated.statusCode).toBe(202);
      expect(repeated.json()).toEqual(initial.json());
      expect(repeated.headers["set-cookie"]).toBeUndefined();
    }
    expect(f.mailer.verifications).toHaveLength(1);
    expect(f.mailer.pins).toHaveLength(1);
    expect(f.repository.magicTokens).toEqual(tokens);
    expect(f.repository.users.size).toBe(1);
    expect(f.repository.workspaces.size).toBe(1);
    expect(f.repository.users.get(identity.user.userId)).toEqual(profile);
    expect(f.repository.workspaces.get(identity.creator!.workspaceId)).toEqual(workspace);
    expect(f.repository.consents).toEqual(consent);
    expect(f.repository.emailPinChallenges.get(hashToken(pin.json().challengeId))).toEqual(pending);
    expect(f.repository.creatorSessions.size).toBe(0);
    expect((await f.complete(pin.json().challengeId)).statusCode).toBe(200);
  });

  it.each([undefined, "/organization?setup=team"])(
    "keeps unverified resends usable while acknowledging a later link without repeating onboarding (returnTo=%s)",
    async (returnTo) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const f = await fixture();
      expect((await f.register()).statusCode).toBe(202);
      const limited = await f.register();
      expect(limited.statusCode).toBe(429);
      expect(f.mailer.verifications).toHaveLength(1);
      vi.setSystemTime(Date.now() + 61000);
      const resent = await f.post("/v1/auth/email-verification", {
        email: " CREATOR@EXAMPLE.COM ",
        segment: "workplace",
        acceptPolicies: true,
        ...(returnTo ? { returnTo } : {}),
      });
      expect(resent.statusCode).toBe(202);
      expect(f.mailer.verifications).toHaveLength(2);
      const verified = await f.verify(0);
      expect(verified.statusCode).toBe(302);
      expect(new URL(verified.headers.location!).searchParams.get("returnTo")).toBe(
        "/home?welcome=1",
      );
      const profile = structuredClone([...f.repository.users.values()][0]!);
      const workspace = structuredClone([...f.repository.workspaces.values()][0]!);
      const consent = structuredClone(f.repository.consents);
      const acknowledged = await f.verify(1);
      expect(acknowledged.statusCode).toBe(302);
      expect(acknowledged.headers["set-cookie"]).toBeUndefined();
      const landing = new URL(acknowledged.headers.location!);
      expect(landing.pathname).toBe("/signin");
      expect(landing.searchParams.get("verified")).toBe("1");
      expect(landing.searchParams.get("returnTo")).toBe(returnTo ?? "/home");
      expect([...f.repository.users.values()]).toEqual([profile]);
      expect([...f.repository.workspaces.values()]).toEqual([workspace]);
      expect(f.repository.consents).toEqual(consent);
      expect(f.repository.creatorSessions.size).toBe(0);
      expect(f.repository.emailPinChallenges.size).toBe(0);
      expect(f.mailer.pins).toEqual([]);
      expect((await f.verify(1)).statusCode).toBe(400);
    },
  );

  it("creates no identity before verification and no session until the independently requested PIN succeeds", async () => {
    const f = await fixture();
    expect((await f.register(" Creator@Example.com ", "/library")).statusCode).toBe(202);
    expect(f.repository.users.size).toBe(0);
    expect(f.repository.workspaces.size).toBe(0);
    expect(f.mailer.verifications[0]!.email).toBe("creator@example.com");
    const verified = await f.verify();
    expect(verified.statusCode).toBe(302);
    expect(verified.headers["set-cookie"]).toBeUndefined();
    const landing = new URL(String(verified.headers.location));
    expect(landing.pathname).toBe("/signin");
    expect(landing.searchParams.get("verified")).toBe("1");
    expect(landing.searchParams.get("returnTo")).toBe("/library");
    expect(f.repository.creatorSessions.size).toBe(0);
    expect(f.repository.emailPinChallenges.size).toBe(0);
    expect(f.mailer.pins).toEqual([]);
    expect((await f.app.inject({ method: "GET", url: "/v1/auth/me" })).statusCode).toBe(401);
    expect(f.repository.users.size).toBe(1);
    expect(f.repository.workspaces.size).toBe(1);
    expect(f.repository.consents).toHaveLength(2);
    expect((await f.verify()).statusCode).toBe(400);
    const requested = await f.requestPin("creator@example.com", "/library");
    expect(requested.statusCode).toBe(202);
    const { challengeId } = requested.json();
    const pin = f.mailer.pins[0]!.pin;
    expect(pin).toMatch(/^\d{6}$/);
    const stored = f.repository.emailPinChallenges.get(hashToken(challengeId))!;
    expect(stored.pinHash).toBe(hashToken(`${challengeId}:${pin}`));
    expect(stored.pinHash).not.toBe(hashToken(pin));
    expect(stored).not.toHaveProperty("pin");
    expect(stored).not.toHaveProperty("challengeId");
    expect((await f.complete(challengeId, wrongPin(pin))).statusCode).toBe(401);
    expect(f.repository.creatorSessions.size).toBe(0);
    const completed = await f.complete(challengeId);
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toEqual({ redirectTo: "http://localhost:3000/library" });
    const me = await f.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: cookie(completed) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().creator).toMatchObject({
      email: "creator@example.com",
      plan: "free",
      segment: "education",
    });
    expect(f.repository.users.size).toBe(1);
    expect(f.repository.workspaces.size).toBe(1);
    expect((await f.complete(challengeId)).statusCode).toBe(401);
    expect(f.repository.creatorSessions.size).toBe(1);
  });

  it("does not deliver a PIN or provision unknown and unverified accounts", async () => {
    const f = await fixture();
    await f.register("unverified@example.com");
    for (const email of ["unknown@example.com", "unverified@example.com"]) {
      const response = await f.requestPin(email);
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({
        accepted: true,
        challengeId: expect.any(String),
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });
      expect((await f.complete(response.json().challengeId, "000000")).statusCode).toBe(401);
    }
    expect(f.mailer.pins).toEqual([]);
    expect(f.repository.users.size).toBe(0);
    expect(f.repository.creatorSessions.size).toBe(0);
  });

  it("keeps the delivered PIN usable when a resend is denied by the cooldown", async () => {
    const f = await fixture();
    await f.register();
    await f.verify();
    const requested = await f.requestPin();
    expect((await f.requestPin()).statusCode).toBe(429);
    expect(f.mailer.pins).toHaveLength(1);
    expect((await f.complete(requested.json().challengeId)).statusCode).toBe(200);
    expect(f.repository.creatorSessions.size).toBe(1);
  });

  it("keeps PIN and verification purposes separate and rejects malformed credentials", async () => {
    const f = await fixture();
    await f.register();
    const token = new URL(f.mailer.verifications[0]!.url).searchParams.get("token")!;
    expect((await f.complete(token, "000000")).statusCode).toBe(401);
    await f.verify();
    const pin = await f.requestPin();
    expect(
      (
        await f.app.inject({
          method: "GET",
          url: `/v1/auth/verify?token=${pin.json().challengeId}`,
        })
      ).statusCode,
    ).toBe(400);
    for (const value of ["12345", "1234567", "12a456", 123456]) {
      expect(
        (await f.post("/v1/auth/pin/verify", { challengeId: pin.json().challengeId, pin: value }))
          .statusCode,
      ).toBe(400);
    }
    expect((await f.complete(pin.json().challengeId)).statusCode).toBe(200);
  });

  it("locks after five wrong attempts and serializes concurrent successful completion", async () => {
    const f = await fixture();
    await f.register();
    await f.verify();
    const first = await f.requestPin();
    const id = first.json().challengeId;
    for (let attempt = 0; attempt < 5; attempt++)
      expect((await f.complete(id, wrongPin(f.mailer.pins[0]!.pin))).statusCode).toBe(401);
    expect((await f.complete(id)).statusCode).toBe(401);
    expect(f.repository.emailPinChallenges.get(hashToken(id))!.attempts).toBe(5);
    expect(f.repository.creatorSessions.size).toBe(0);
    // A different verified identity gets its own independently limited challenge.
    await f.register("other@example.com");
    await f.verify();
    const next = await f.requestPin("other@example.com");
    const results = await Promise.all([
      f.complete(next.json().challengeId),
      f.complete(next.json().challengeId),
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 401]);
    expect(f.repository.creatorSessions.size).toBe(1);
  });

  it("expires both credential purposes and revokes an older PIN when a new one is requested", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await fixture();
    await f.register();
    await f.verify();
    const first = await f.requestPin();
    const firstPin = f.mailer.pins[0]!.pin;
    vi.setSystemTime(Date.now() + 61_000);
    const second = await f.requestPin();
    expect(second.statusCode).toBe(202);
    expect((await f.complete(first.json().challengeId, firstPin)).statusCode).toBe(401);
    vi.setSystemTime(Date.now() + 600_001);
    expect((await f.complete(second.json().challengeId)).statusCode).toBe(401);
    await f.register("expired@example.com");
    vi.setSystemTime(Date.now() + 900_001);
    expect((await f.verify()).statusCode).toBe(400);
    expect(
      [...f.repository.users.values()].some((user) => user.email === "expired@example.com"),
    ).toBe(false);
    expect(f.repository.creatorSessions.size).toBe(0);
  });

  it("enforces email budgets across server instances without a test-mode bypass", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const repository = new MemoryRepository();
    const cache = new MemorySessionCache();
    const a = await fixture({ repository, cache });
    const b = await fixture({ repository, cache });
    await a.register();
    await a.verify();
    expect((await a.requestPin()).statusCode).toBe(202);
    for (let retry = 0; retry < 20; retry++) {
      const limited = await b.requestPin();
      expect(limited.statusCode).toBe(429);
      expect(limited.headers["retry-after"]).toBe("60");
      expect(limited.json().error.details.retryAfterSeconds).toBe(60);
    }
    vi.setSystemTime(Date.now() + 61_000);
    expect((await b.requestPin()).statusCode).toBe(202);
    vi.setSystemTime(Date.now() + 61_000);
    expect((await a.requestPin()).statusCode).toBe(202);
    vi.setSystemTime(Date.now() + 61_000);
    const exhausted = await b.requestPin();
    expect(exhausted.statusCode).toBe(429);
    expect(exhausted.json().error.retryAfterSeconds).toBeGreaterThan(60);
    expect(a.mailer.pins.length + b.mailer.pins.length).toBe(3);
    expect(
      [...repository.emailPinChallenges.values()].filter((challenge) => !challenge.consumedAt),
    ).toHaveLength(1);
  });

  it("reports the remaining shared IP window for PIN and verification requests", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.now();
    const f = await fixture();
    await f.register();
    await f.verify();
    // Registration already charged this IP once. Fill its existing fixed window
    // through the boolean cache API to model requests served by other processes.
    for (let request = 1; request < 300; request++)
      expect(await f.cache.consumeRateLimit("email-auth:request-ip:127.0.0.1", 300, 900_000)).toBe(
        true,
      );
    const endpoints = [
      "/v1/auth/pin/request",
      "/v1/auth/email-verification",
      "/v1/auth/magic-link",
    ];
    for (const remaining of [60, 30]) {
      vi.setSystemTime(startedAt + (900 - remaining) * 1_000);
      for (const url of endpoints) {
        const limited = await f.post(url, {
          email: "creator@example.com",
          acceptPolicies: true,
          ...(url === "/v1/auth/pin/request" ? {} : { segment: "education" }),
        });
        expect(limited.statusCode).toBe(429);
        expect(limited.headers["retry-after"]).toBe(String(remaining));
        expect(limited.json().error).toMatchObject({
          code: "RATE_LIMITED",
          retryAfterSeconds: remaining,
          details: { retryAfterSeconds: remaining },
        });
      }
    }
    expect(f.mailer.pins).toHaveLength(0);
    expect(f.mailer.verifications).toHaveLength(1);
    vi.setSystemTime(startedAt + 900_000);
    expect((await f.requestPin()).statusCode).toBe(202);
    expect((await f.register()).statusCode).toBe(202);
    expect(f.mailer.pins).toHaveLength(1);
    expect(f.mailer.verifications).toHaveLength(1);
  });

  it("requires explicit policy acceptance and rejects external return destinations", async () => {
    const f = await fixture();
    for (const url of ["/v1/auth/email-verification", "/v1/auth/pin/request"]) {
      expect((await f.post(url, { email: "creator@example.com" })).statusCode).toBe(400);
      expect(
        (
          await f.post(url, {
            email: "creator@example.com",
            acceptPolicies: true,
            returnTo: "https://evil.example",
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(f.mailer.verifications).toEqual([]);
    expect(f.mailer.pins).toEqual([]);
  });

  it("honors signup pauses at credential issuance and completion", async () => {
    const f = await fixture();
    await f.register();
    await f.verify();
    const challenge = await f.requestPin();
    await f.register("pending@example.com");
    await f.repository.updateOperationalFeatures({ signups: false }, "pause-email-auth");
    expect((await f.register("paused@example.com")).statusCode).toBe(503);
    expect((await f.verify()).statusCode).toBe(503);
    expect((await f.requestPin("creator@example.com")).statusCode).toBe(503);
    expect((await f.complete(challenge.json().challengeId)).statusCode).toBe(503);
    expect(f.repository.creatorSessions.size).toBe(0);
  });

  it("does not expose verification links or PINs in hosted responses and retains secure session cookies", async () => {
    const f = await fixture({ production: true });
    const registration = await f.register();
    expect(registration.json()).toEqual({ accepted: true });
    const verified = await f.verify();
    expect(verified.headers["set-cookie"]).toBeUndefined();
    const destination = new URL(verified.headers.location!);
    expect(destination.pathname).toBe("/signin");
    expect(destination.searchParams.get("returnTo")).toBe("/home?welcome=1");
    const requested = await f.requestPin();
    expect(requested.json()).not.toHaveProperty("debugPin");
    const completed = await f.complete(requested.json().challengeId);
    expect(completed.statusCode).toBe(200);
    expect(completed.headers["set-cookie"]).toEqual(expect.stringContaining("HttpOnly"));
    expect(completed.headers["set-cookie"]).toEqual(expect.stringContaining("Secure"));
    expect(completed.headers["set-cookie"]).toEqual(expect.stringContaining("SameSite=Lax"));
    expect(completed.json().redirectTo).toBe("https://app.example.ca/home");
  });

  it("revokes a challenge when SMTP fails and cannot authenticate a deleted identity", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await fixture();
    await f.register();
    await f.verify();
    f.mailer.failPin = true;
    const failed = await f.requestPin();
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error.code).toBe("EMAIL_DELIVERY_FAILED");
    expect(
      [...f.repository.emailPinChallenges.values()].every((challenge) => challenge.consumedAt),
    ).toBe(true);
    expect(f.repository.creatorSessions.size).toBe(0);
    f.mailer.failPin = false;
    vi.setSystemTime(Date.now() + 61_000);
    const pending = await f.requestPin();
    expect(pending.statusCode).toBe(202);
    const user = [...f.repository.users.values()][0]!;
    user.deletedAt = new Date();
    expect((await f.complete(pending.json().challengeId)).statusCode).toBe(401);
    vi.setSystemTime(Date.now() + 61_000);
    const delivered = f.mailer.pins.length;
    const deleted = await f.requestPin(user.email);
    expect(deleted.statusCode).toBe(202);
    expect(f.mailer.pins).toHaveLength(delivered);
    expect((await f.complete(deleted.json().challengeId, "000000")).statusCode).toBe(401);
    expect(f.repository.creatorSessions.size).toBe(0);
  });

  it("does not carry an unverified request cooldown into the first verified sign-in", async () => {
    const f = await fixture();
    expect((await f.requestPin()).statusCode).toBe(202);
    expect(f.mailer.pins).toHaveLength(0);
    await f.register();
    await f.verify();
    expect((await f.requestPin()).statusCode).toBe(202);
    expect(f.mailer.pins).toHaveLength(1);
    expect(f.repository.creatorSessions.size).toBe(0);
  });

  it("returns a server-issued challenge once SMTP accepts the PIN", async () => {
    const f = await fixture();
    await f.register();
    await f.verify();
    let release!: () => void;
    f.mailer.pinDelivery = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;
    const pending = f
      .post("/v1/auth/pin/request", {
        email: "creator@example.com",
        acceptPolicies: true,
      })
      .then((response) => {
        settled = true;
        return response;
      });
    try {
      await vi.waitFor(() => expect(f.mailer.pins).toHaveLength(1));
      expect(settled).toBe(false);
      expect(f.repository.creatorSessions.size).toBe(0);
    } finally {
      release();
      const requested = await pending;
      expect(requested.statusCode).toBe(202);
      expect((await f.complete(requested.json().challengeId)).statusCode).toBe(200);
    }
  });

  it("preserves an accepted invitation's workspace through a separate PIN sign-in", async () => {
    const f = await fixture();
    await f.register("member@example.com");
    await f.verify();
    await f.register("owner@example.com");
    await f.verify();
    const owner = (await f.repository.getVerifiedEmailIdentity("owner@example.com"))!.creator!;
    const token = "invitation-proof-only";
    await f.repository.createWorkspaceInvitation({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      email: "member@example.com",
      role: "viewer",
      tokenHash: hashToken(token),
      invitedBy: owner.userId,
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    });
    const accepted = await f.post("/v1/invitations/accept", { token, acceptPolicies: true });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers["set-cookie"]).toBeUndefined();
    expect(accepted.json().requiresSignIn).toBe(true);
    const destination = new URL(accepted.json().redirectTo);
    expect(destination.pathname).toBe("/signin");
    expect(destination.searchParams.get("returnTo")).toBe("/home?invitation=accepted");
    expect(destination.searchParams.get("workspaceId")).toBe(owner.workspaceId);
    const requested = await f.requestPin(
      "member@example.com",
      destination.searchParams.get("returnTo")!,
      destination.searchParams.get("workspaceId")!,
    );
    expect(requested.statusCode).toBe(202);
    expect(f.repository.creatorSessions.size).toBe(0);
    const signedIn = await f.complete(requested.json().challengeId);
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json().redirectTo).toBe("http://localhost:3000/home?invitation=accepted");
    const me = await f.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: cookie(signedIn) },
    });
    expect(me.json().creator).toMatchObject({
      email: "member@example.com",
      workspaceId: owner.workspaceId,
      role: "viewer",
    });
  });
});
