import { randomUUID } from "node:crypto";
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
import { verifyEmailAndSignIn } from "./support/email-auth.js";

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
  vi.useRealTimers();
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
  return verifyEmailAndSignIn(target, `${url.pathname}${url.search}`, address, {
    ...requestHeaders,
    "x-request-id": "verified-local-login",
    ...(priorCookies ? { cookie: priorCookies } : {}),
  });
}

async function legacyOperatorSession(
  platform: ReturnType<typeof createPlatformRepository>,
  names: ReturnType<typeof operatorCookieNames>,
) {
  const operator = await platform.provisionOperator({
    issuer: LOCAL_OPERATOR_ISSUER,
    subject: LOCAL_OPERATOR_SUBJECT,
    name: "Local admin",
    role: "founder",
    capabilities: [],
    active: true,
  });
  const token = randomUUID();
  const csrf = randomUUID();
  await platform.createOperatorSession({
    id: randomUUID(),
    operatorId: operator.id,
    tokenHash: tokenHash(token),
    csrfHash: tokenHash(csrf),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60_000),
    revokedAt: null,
  });
  return {
    token,
    cookie: `${names.session}=${token}; ${names.csrf}=${csrf}; ${names.binding}=${randomUUID()}`,
    context: await platform.getOperatorSession(tokenHash(token)),
  };
}

describe("customer authentication stays separate from administrator authentication", () => {
  it("treats the formerly configured admin email as an ordinary customer using public product URLs", async () => {
    const { app, platform, config } = await fixture();
    const magic = await requestLink(app, "ADMIN@POLLINGPOPS.LOCAL");
    expect(magic.statusCode).toBe(202);
    expect(magic.json()).not.toHaveProperty("signInOrigin");
    const url = new URL(magic.json().debugUrl);
    expect(url.origin).toBe(local.PUBLIC_API_URL);
    expect(url.searchParams.get("returnTo")).toBe("/account?via=signin#profile");
    expect(ConsoleMailer.prototype.sendMagicLink).toHaveBeenCalledWith(email, url.href);
    expect(cookies(magic)).toEqual([]);
    const signed = await verifyEmailAndSignIn(app, `${url.pathname}${url.search}`, email, headers);
    expect(signed.statusCode).toBe(200);
    expect(signed.json().redirectTo).toBe(`${local.WEB_ORIGIN}/account?via=signin#profile`);
    expect(cookies(signed).map((cookie) => cookie.split("=")[0])).toEqual([config.COOKIE_NAME]);
    expect(cookies(signed)[0]).toContain("HttpOnly");
    expect(cookies(signed)[0]).toContain("SameSite=Lax");
    expect(cookies(signed)[0]).toContain("Max-Age=2592000");
    const authenticatedHeaders = { ...headers, cookie: cookieHeader(signed) };
    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: authenticatedHeaders,
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      creator: { email, role: "owner", plan: "free" },
      businessManagementEnabled: true,
    });
    const organization = (await platform.getOrganizationForWorkspace(
      me.json().creator.workspaceId,
    ))!;
    const navigation = await app.inject({
      method: "GET",
      url: "/v1/auth/navigation",
      headers: authenticatedHeaders,
    });
    expect(navigation.json()).toEqual({
      user: { userId: me.json().creator.userId, email },
      organizationManagementEnabled: true,
      organizations: [{ id: organization.id, name: organization.name, role: "owner" }],
      operatorConsoleOrigin: null,
    });
    expect(await platform.listOperators()).toEqual([]);
    expect(await platform.listAuditEvents()).toEqual([]);
    expect(
      (await app.inject({ method: "GET", url: `${url.pathname}${url.search}`, headers }))
        .statusCode,
    ).toBe(400);
    const features = await app.inject({ method: "GET", url: "/v1/features" });
    expect(JSON.stringify(features.json())).not.toContain(config.LOCAL_ADMIN_EMAIL!);
    expect(features.json().publicWebUrl).toBe(local.WEB_ORIGIN);
  });

  it("preserves explicit locale and return paths on the standard customer redirect", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { app, repository } = await fixture();
    const first = await verify(app);
    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { ...headers, cookie: cookieHeader(first) },
    });
    await repository.updateUserLocale(me.json().creator.userId, "ja-JP");
    // A subsequent sign-in remains subject to the real one-minute email cooldown.
    vi.advanceTimersByTime(61_000);
    const next = await verify(app, email, cookieHeader(first));
    const destination = new URL(next.json().redirectTo);
    expect(destination.origin).toBe(local.WEB_ORIGIN);
    expect(destination.pathname).toBe("/auth/locale");
    expect(destination.searchParams.get("locale")).toBe("ja-JP");
    expect(destination.searchParams.get("returnTo")).toBe("/account?via=signin#profile");
  });

  it("never provisions an operator from customer ownership or asserted payload fields", async () => {
    const { app, platform, config } = await fixture();
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
    expect(magic.statusCode).toBe(202);
    expect(magic.json()).not.toHaveProperty("signInOrigin");
    const url = new URL(magic.json().debugUrl);
    const signed = await verifyEmailAndSignIn(
      app,
      `${url.pathname}${url.search}`,
      "owner@example.test",
      headers,
    );
    expect(signed.statusCode).toBe(200);
    expect(cookies(signed).map((cookie) => cookie.split("=")[0])).toEqual([config.COOKIE_NAME]);
    expect(await platform.listOperators()).toEqual([]);
  });

  it.each([email, "ordinary@example.test"])(
    "neither reuses nor revokes or clears legacy operator credentials when signing in as %s",
    async (address) => {
      const { app, platform, config, names } = await fixture();
      const legacy = await legacyOperatorSession(platform, names);
      const signed = await verify(app, address, legacy.cookie);
      expect(signed.statusCode).toBe(200);
      expect(cookieToken(signed, config.COOKIE_NAME)).not.toBe(legacy.token);
      expect(cookies(signed).map((cookie) => cookie.split("=")[0])).toEqual([config.COOKIE_NAME]);
      expect(await platform.getOperatorSession(tokenHash(legacy.token))).toEqual(legacy.context);
      expect(await platform.listOperators()).toHaveLength(1);
      expect(await platform.listAuditEvents()).toEqual([]);
      expect(signed.headers["x-local-operator-revocation"]).toBeUndefined();
    },
  );

  it.each(["operator cookie", "customer cookie", "bearer header"])(
    "does not accept an operator token as customer authorization through the %s",
    async (placement) => {
      const { app, platform, config, names } = await fixture();
      const legacy = await legacyOperatorSession(platform, names);
      const authorization =
        placement === "bearer header"
          ? { authorization: `Bearer ${legacy.token}` }
          : {
              cookie:
                placement === "customer cookie"
                  ? `${config.COOKIE_NAME}=${legacy.token}`
                  : legacy.cookie,
            };
      const requestHeaders = { ...headers, ...authorization };
      for (const url of ["/v1/auth/me", "/v1/auth/user"]) {
        const response = await app.inject({ method: "GET", url, headers: requestHeaders });
        expect(response.statusCode).toBe(401);
        expect(cookies(response)).toEqual([]);
      }
      const navigation = await app.inject({
        method: "GET",
        url: "/v1/auth/navigation",
        headers: requestHeaders,
      });
      expect(navigation.json()).toEqual({
        user: null,
        organizationManagementEnabled: true,
        organizations: [],
        operatorConsoleOrigin: null,
      });
      expect(await platform.getOperatorSession(tokenHash(legacy.token))).toEqual(legacy.context);
    },
  );

  it.each([true, false])(
    "logout touches only the supplied customer session with customer cookie present=%s",
    async (includeCustomerCookie) => {
      const { app, platform, config, names } = await fixture();
      const legacy = await legacyOperatorSession(platform, names);
      const signed = await verify(app);
      const logout = await app.inject({
        method: "POST",
        url: "/v1/auth/logout",
        headers: {
          ...headers,
          cookie: `${includeCustomerCookie ? `${cookieHeader(signed)}; ` : ""}${legacy.cookie}`,
        },
        payload: {},
      });
      expect(logout.statusCode).toBe(200);
      expect(logout.json()).toEqual({ ok: true });
      expect(cookieToken(logout, config.COOKIE_NAME)).toBe("");
      expect(cookies(logout).map((cookie) => cookie.split("=")[0])).toEqual([config.COOKIE_NAME]);
      expect(await platform.getOperatorSession(tokenHash(legacy.token))).toEqual(legacy.context);
      expect(await platform.listAuditEvents()).toEqual([]);
      expect(logout.headers["x-local-operator-revocation"]).toBeUndefined();
      const customer = await app.inject({
        method: "GET",
        url: "/v1/auth/me",
        headers: { ...headers, cookie: cookieHeader(signed) },
      });
      expect(customer.statusCode).toBe(includeCustomerCookie ? 401 : 200);
    },
  );

  it("does not contact the operator service during customer sign-in or logout", async () => {
    const { app, platform, names } = await fixture();
    const legacy = await legacyOperatorSession(platform, names);
    const operatorTransaction = vi
      .spyOn(platform, "withOperatorTransaction")
      .mockRejectedValue(new Error("operator service unavailable"));
    const signed = await verify(app, email, legacy.cookie);
    expect(signed.statusCode).toBe(200);
    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { ...headers, cookie: `${cookieHeader(signed)}; ${legacy.cookie}` },
      payload: {},
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ ok: true });
    expect(operatorTransaction).not.toHaveBeenCalled();
    expect(await platform.getOperatorSession(tokenHash(legacy.token))).toEqual(legacy.context);
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

describe("deprecated local administrator configuration validation", () => {
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
    expect(signed.json().redirectTo).toBe("http://192.168.1.142:3000/account?via=signin#profile");
    expect(await platform.listOperators()).toEqual([]);
  });
});
