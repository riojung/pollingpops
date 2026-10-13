import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createPlatformRepository, MemoryRepository } from "@openround/db";
import {
  LOCAL_OPERATOR_ISSUER,
  LOCAL_OPERATOR_SUBJECT,
  operatorCookieNames,
  tokenHash,
} from "@openround/control-plane";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema, isLocalProductAdminDevelopment } from "../src/config.js";
import { ConsoleMailer } from "../src/mailer.js";

const email = "admin@pollingpops.local";
const local = {
  NODE_ENV: "test",
  ALLOW_IN_MEMORY: "true",
  BUSINESS_PLATFORM_ENABLED: "true",
  LOG_LEVEL: "silent",
  WEB_ORIGIN: "http://192.168.1.142:3000",
  PUBLIC_API_URL: "http://192.168.1.142:4000",
  CONTROL_ENABLED: "true",
  CONTROL_AUTH_MODE: "local",
  CONTROL_LOCAL_DEVELOPMENT: "true",
  OPENROUND_DEPLOYMENT_ENVIRONMENT: "development",
  CONTROL_PUBLIC_ORIGIN: "http://localhost:3002",
  CONTROL_PRODUCT_ORIGIN: "http://localhost:3000",
  LOCAL_ADMIN_EMAIL: " ADMIN@PollingPops.Local ",
};
const headers = { host: "localhost:4000", origin: "http://localhost:3000" };
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

async function fixture(extra: Record<string, string | undefined> = {}) {
  vi.spyOn(ConsoleMailer.prototype, "sendMagicLink").mockResolvedValue();
  const config = ConfigSchema.parse({ ...local, ...extra });
  const repository = new MemoryRepository();
  const built = await buildApp(config, { repository, cache: new MemorySessionCache() });
  app = built.app;
  return {
    app: built.app,
    config,
    repository,
    platform: createPlatformRepository(repository),
    names: operatorCookieNames(config),
  };
}

function cookies(response: LightMyRequestResponse) {
  const raw = response.headers["set-cookie"];
  return typeof raw === "string" ? [raw] : (raw ?? []);
}
function cookieHeader(response: LightMyRequestResponse) {
  return cookies(response)
    .filter((cookie) => !cookie.includes("Expires=Thu, 01 Jan 1970"))
    .map((cookie) => cookie.split(";")[0]!)
    .join("; ");
}
function cookieToken(response: LightMyRequestResponse, name: string) {
  const values = cookies(response).filter((cookie) => cookie.startsWith(`${name}=`));
  return values
    .at(-1)
    ?.split(";")[0]
    ?.slice(name.length + 1);
}
async function requestLink(target: FastifyInstance, address = email, requestHeaders = headers) {
  return target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    headers: requestHeaders,
    payload: {
      email: address,
      segment: "workplace",
      acceptPolicies: true,
      returnTo: "/account?via=signin#profile",
    },
  });
}
async function verify(
  target: FastifyInstance,
  address = email,
  priorCookies?: string,
  requestHeaders = headers,
) {
  const magic = await requestLink(target, address, requestHeaders);
  expect(magic.statusCode).toBe(202);
  const url = new URL(magic.json().debugUrl);
  return target.inject({
    method: "GET",
    url: `${url.pathname}${url.search}`,
    headers: {
      ...requestHeaders,
      "x-request-id": "verified-local-login",
      ...(priorCookies ? { cookie: priorCookies } : {}),
    },
  });
}

describe("normal product sign-in for the configured local administrator", () => {
  it("binds only a verified normalized email to durable audited operator cookies, retaining native API port and loopback product redirect", async () => {
    const { app, platform, config, names } = await fixture();
    const magic = await requestLink(app, "ADMIN@POLLINGPOPS.LOCAL");
    expect(magic.json()).toMatchObject({ signInOrigin: "http://localhost:3000" });
    const url = new URL(magic.json().debugUrl);
    expect(url.origin).toBe("http://localhost:4000");
    expect(url.searchParams.get("returnTo")).toBe("/account?via=signin#profile");
    expect(await platform.listOperators()).toEqual([]);
    expect(await platform.listAuditEvents()).toEqual([]);
    expect(cookies(magic)).toEqual([]);
    const signed = await app.inject({
      method: "GET",
      url: `${url.pathname}${url.search}`,
      headers: { ...headers, "x-request-id": "verified-local-login" },
    });
    expect(signed.statusCode).toBe(302);
    expect(signed.headers.location).toBe("http://localhost:3000/account?via=signin#profile");
    const operatorToken = cookieToken(signed, names.session)!;
    const csrfToken = cookieToken(signed, names.csrf)!;
    const durable = await platform.getOperatorSession(tokenHash(operatorToken));
    expect(durable?.operator).toMatchObject({
      issuer: LOCAL_OPERATOR_ISSUER,
      subject: LOCAL_OPERATOR_SUBJECT,
      name: "Local admin",
      role: "founder",
      active: true,
    });
    expect(durable?.session.csrfHash).toBe(tokenHash(csrfToken));
    expect(durable?.session.tokenHash).not.toBe(operatorToken);
    for (const name of [names.session, names.csrf]) {
      const value = cookies(signed).find((cookie) => cookie.startsWith(`${name}=`))!;
      expect(value).toContain("Path=/");
      expect(value).toContain("HttpOnly");
      expect(value).toContain("SameSite=Lax");
      expect(value).toContain("Max-Age=28800");
      expect(value).not.toContain("Domain=");
      expect(value).not.toContain("Secure");
    }
    expect(await platform.listAuditEvents()).toMatchObject([
      {
        actorId: durable!.operator.id,
        action: "operator.login",
        requestId: "verified-local-login",
        after: { role: "founder", authMode: "local" },
      },
    ]);
    const navigation = await app.inject({
      method: "GET",
      url: "/v1/auth/navigation",
      headers: { ...headers, cookie: cookieHeader(signed) },
    });
    expect(navigation.json()).toMatchObject({
      user: { email },
      operatorConsoleOrigin: "http://localhost:3002",
    });
    expect(navigation.json()).not.toHaveProperty("operator");
    const features = await app.inject({ method: "GET", url: "/v1/features" });
    expect(JSON.stringify(features.json())).not.toContain(config.LOCAL_ADMIN_EMAIL!);
    expect(features.json().publicWebUrl).toBe(local.WEB_ORIGIN);
    expect(
      (await app.inject({ method: "GET", url: "/v1/auth/navigation", headers })).json()
        .operatorConsoleOrigin,
    ).toBeNull();
    expect(
      (await app.inject({ method: "GET", url: `${url.pathname}${url.search}`, headers }))
        .statusCode,
    ).toBe(400);
    expect(await platform.listOperators()).toHaveLength(1);
  });

  it("preserves explicit locale and return path on the loopback admin redirect", async () => {
    const { app, repository } = await fixture();
    const first = await verify(app);
    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { ...headers, cookie: cookieHeader(first) },
    });
    await repository.updateUserLocale(me.json().creator.userId, "ja-JP");
    const next = await verify(app, email, cookieHeader(first));
    const destination = new URL(next.headers.location!);
    expect(destination.origin).toBe("http://localhost:3000");
    expect(destination.pathname).toBe("/auth/locale");
    expect(destination.searchParams.get("locale")).toBe("ja-JP");
    expect(destination.searchParams.get("returnTo")).toBe("/account?via=signin#profile");
  });

  it("keeps ordinary customer URLs and entitlements unchanged and never provisions from customer ownership or payload fields", async () => {
    const { app, platform, names } = await fixture();
    const magic = await app.inject({
      method: "POST",
      url: "/v1/auth/magic-link",
      headers,
      payload: {
        email: "owner@example.test",
        segment: "workplace",
        acceptPolicies: true,
        role: "founder",
        localAdmin: true,
      },
    });
    expect(magic.json()).not.toHaveProperty("signInOrigin");
    expect(new URL(magic.json().debugUrl).origin).toBe("http://192.168.1.142:4000");
    const signed = await verify(app, "owner@example.test");
    expect(signed.headers.location).toBe("http://192.168.1.142:3000/account?via=signin#profile");
    expect(cookieToken(signed, names.session)).toBeUndefined();
    expect(await platform.listOperators()).toEqual([]);
    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { ...headers, cookie: cookieHeader(signed) },
    });
    expect(me.json()).toMatchObject({
      creator: { role: "owner", plan: "free" },
      businessManagementEnabled: true,
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/auth/navigation",
          headers: { ...headers, cookie: cookieHeader(signed) },
        })
      ).json().operatorConsoleOrigin,
    ).toBeNull();
  });

  it.each([
    { host: "192.168.1.142:4000", origin: "http://192.168.1.142:3000" },
    { host: "localhost.evil.test:4000", origin: "http://localhost:3000" },
    { host: "localhost:4999", origin: "http://localhost:3000" },
    { host: "localhost:4000", origin: "http://192.168.1.142:3000" },
    { ...headers, "x-forwarded-host": "192.168.1.142:4000" },
    { ...headers, "x-forwarded-proto": "https" },
  ])(
    "does not grant on a nonloopback or conflicting verification request %j",
    async (requestHeaders) => {
      const { app, platform, names } = await fixture();
      const signed = await verify(app, email, undefined, requestHeaders);
      expect(signed.statusCode).toBe(302);
      expect(cookieToken(signed, names.session)).toBe("");
      expect(await platform.listOperators()).toEqual([]);
    },
  );

  it("revokes the durable operator session and clears shared credentials when switching to an ordinary account", async () => {
    const { app, platform, names } = await fixture();
    const admin = await verify(app);
    const token = cookieToken(admin, names.session)!;
    const ordinary = await verify(app, "ordinary@example.test", cookieHeader(admin));
    expect(await platform.getOperatorSession(tokenHash(token))).toBeNull();
    for (const name of [names.session, names.csrf, names.binding])
      expect(cookieToken(ordinary, name)).toBe("");
    expect((await platform.listAuditEvents()).map((event) => event.action).sort()).toEqual([
      "operator.login",
      "operator.logout",
    ]);
    const navigation = await app.inject({
      method: "GET",
      url: "/v1/auth/navigation",
      headers: { ...headers, cookie: `${cookieHeader(ordinary)}; ${names.session}=${token}` },
    });
    expect(navigation.json()).toMatchObject({
      user: { email: "ordinary@example.test" },
      operatorConsoleOrigin: null,
    });
  });

  it("revokes active operator credentials and records a product logout audit", async () => {
    const { app, platform, names } = await fixture();
    const signed = await verify(app);
    const token = cookieToken(signed, names.session)!;
    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { ...headers, cookie: cookieHeader(signed) },
      payload: {},
    });
    expect(logout.statusCode).toBe(200);
    expect(await platform.getOperatorSession(tokenHash(token))).toBeNull();
    expect(cookieToken(logout, names.session)).toBe("");
    expect(await platform.listAuditEvents()).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "operator.logout" })]),
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/auth/navigation",
          headers: { ...headers, cookie: cookieHeader(signed) },
        })
      ).json().operatorConsoleOrigin,
    ).toBeNull();
  });

  it("honors disabled and demoted durable identities and revokes logout sessions even while disabled", async () => {
    const { app, platform, names } = await fixture();
    const first = await verify(app);
    const token = cookieToken(first, names.session)!;
    const operator = (await platform.listOperators())[0]!;
    await platform.provisionOperator({
      issuer: "https://id.example.test",
      subject: "other-founder",
      name: "Other founder",
      role: "founder",
      capabilities: [],
      active: true,
    });
    await platform.provisionOperator({ ...operator, role: "readonly" });
    const demoted = await verify(app, email, cookieHeader(first));
    expect(
      (await platform.getOperatorSession(tokenHash(cookieToken(demoted, names.session)!)))?.operator
        .role,
    ).toBe("readonly");
    const demotedToken = cookieToken(demoted, names.session)!;
    await platform.provisionOperator({ ...operator, role: "readonly", active: false });
    const blocked = await verify(app, email);
    expect(blocked.statusCode).toBe(302);
    expect(cookieToken(blocked, names.session)).toBe("");
    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { ...headers, cookie: cookieHeader(demoted) },
      payload: {},
    });
    expect(logout.statusCode).toBe(200);
    for (const name of [names.session, names.csrf, names.binding])
      expect(cookieToken(logout, name)).toBe("");
    expect((await platform.getOperator(operator.id))?.active).toBe(false);
    await platform.provisionOperator({ ...operator, role: "readonly", active: true });
    expect(await platform.getOperatorSession(tokenHash(token))).toBeNull();
    expect(await platform.getOperatorSession(tokenHash(demotedToken))).toBeNull();
  });

  it("keeps ordinary sign-in and logout usable during an operator service outage", async () => {
    const { app, platform, names } = await fixture();
    const admin = await verify(app);
    const operatorToken = cookieToken(admin, names.session)!;
    vi.spyOn(platform, "withOperatorTransaction").mockRejectedValue(
      new Error("operator service unavailable"),
    );
    const ordinary = await verify(app, "unaffected@example.test", cookieHeader(admin));
    expect(ordinary.statusCode).toBe(302);
    expect(cookieToken(ordinary, names.session)).toBe("");
    expect(ordinary.headers["x-local-operator-revocation"]).toBe("unavailable");
    // The response explicitly distinguishes clearing browser credentials from a durable
    // revocation that could not commit while the operator transaction service was down.
    expect(await platform.getOperatorSession(tokenHash(operatorToken))).not.toBeNull();
    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: {
        ...headers,
        cookie: `${cookieHeader(ordinary)}; ${names.session}=${operatorToken}`,
      },
      payload: {},
    });
    expect(logout.statusCode).toBe(200);
    expect(cookieToken(logout, names.session)).toBe("");
    expect(logout.json()).toEqual({ ok: true, operatorSessionRevoked: false });
    expect(logout.headers["x-local-operator-revocation"]).toBe("unavailable");
  });

  it.each(["false", "true"])(
    "preserves customer paid-plan and Community behavior with COMMUNITY_MODE=%s",
    async (communityMode) => {
      const { app, repository } = await fixture({ COMMUNITY_MODE: communityMode });
      const admin = await verify(app);
      const customer = await verify(app, "paid@example.test");
      const read = async (signed: LightMyRequestResponse) =>
        (
          await app.inject({
            method: "GET",
            url: "/v1/auth/me",
            headers: { ...headers, cookie: cookieHeader(signed) },
          })
        ).json();
      for (const signed of [admin, customer]) {
        const me = await read(signed);
        await repository.setPlan(me.creator.workspaceId, "pro");
      }
      const adminMe = await read(admin);
      const customerMe = await read(customer);
      expect(adminMe.creator.plan).toBe(communityMode === "true" ? "team" : "pro");
      expect(adminMe.entitlements).toEqual(customerMe.entitlements);
      expect(adminMe.businessManagementEnabled).toBe(communityMode === "false");
    },
  );
});

describe("local administrator configuration isolation", () => {
  it.each([
    { CONTROL_LOCAL_DEVELOPMENT: "false" },
    { OPENROUND_DEPLOYMENT_ENVIRONMENT: undefined },
    { OPENROUND_DEPLOYMENT_ENVIRONMENT: "staging" },
    { OPENROUND_DEPLOYMENT_ENVIRONMENT: "production" },
    { CONTROL_PRODUCT_ORIGIN: "http://192.168.1.142:3000" },
    { CONTROL_PUBLIC_ORIGIN: "https://control.example.test" },
    { CONTROL_PRODUCT_ORIGIN: "http://127.0.0.1:3000" },
    { CONTROL_PRODUCT_ORIGIN: "http://localhost:3002" },
    { LOCAL_ADMIN_EMAIL: "" },
  ])("rejects unsafe or incomplete opt-in %j", (extra) => {
    expect(ConfigSchema.safeParse({ ...local, ...extra }).success).toBe(false);
  });
  it.each([
    { CONTROL_ENABLED: "false" },
    { CONTROL_AUTH_MODE: "oidc", CONTROL_LOCAL_DEVELOPMENT: "false" },
  ])("never binds configured email when the opt-in is disabled %j", async (extra) => {
    const { app, platform, config, names } = await fixture(extra);
    expect(isLocalProductAdminDevelopment(config)).toBe(false);
    const signed = await verify(app, email, undefined, {
      host: "192.168.1.142:4000",
      origin: "http://192.168.1.142:3000",
    });
    expect(cookieToken(signed, names.session)).toBeUndefined();
    expect(signed.headers.location).toBe("http://192.168.1.142:3000/account?via=signin#profile");
    expect(await platform.listOperators()).toEqual([]);
  });
});
