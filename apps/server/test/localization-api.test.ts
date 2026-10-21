import { verifyEmailAndSignIn } from "./support/email-auth.js";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type CreatorContext } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;

async function verifySignIn(target: FastifyInstance, email: string) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  return verifyEmailAndSignIn(target, `/v1/auth/verify?token=${token}`, email);
}

async function signIn(target: FastifyInstance, email: string) {
  const verified = await verifySignIn(target, email);
  const setCookie = verified.headers["set-cookie"]!;
  return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
}

function setCookies(response: Awaited<ReturnType<FastifyInstance["inject"]>>) {
  const header = response.headers["set-cookie"];
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  vi.useRealTimers();
});

describe("account locale preference API", () => {
  it("persists a supported locale idempotently without changing another user", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        COOKIE_DOMAIN: "example.test",
        COOKIE_SECURE: "true",
        LOG_LEVEL: "silent",
      }),
      { repository: new MemoryRepository(), cache: new MemorySessionCache() },
    );
    app = built.app;

    const unauthenticated = await app.inject({
      method: "PUT",
      url: "/v1/account/locale",
      payload: { locale: "ja-JP" },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const firstVerification = await verifySignIn(app, "locale-first@example.com");
    expect(firstVerification.json().redirectTo).toBe("http://localhost:3000/home?welcome=1");
    expect(setCookies(firstVerification)).toHaveLength(1);
    expect(setCookies(firstVerification)[0]).not.toContain("openround-locale=");
    const firstCookie = setCookies(firstVerification)[0]!.split(";")[0]!;
    const secondCookie = await signIn(app, "locale-second@example.com");
    const initial = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: firstCookie },
    });
    expect(initial.json<{ creator: CreatorContext }>().creator).toMatchObject({
      locale: "en-CA",
      localePreferenceSet: false,
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const updated = await app.inject({
        method: "PUT",
        url: "/v1/account/locale",
        headers: { cookie: firstCookie },
        payload: { locale: "ja-JP" },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toEqual({ locale: "ja-JP" });
      expect(setCookies(updated)).toEqual([]);
    }

    const refreshed = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: firstCookie },
    });
    expect(refreshed.json<{ creator: CreatorContext }>().creator).toMatchObject({
      locale: "ja-JP",
      localePreferenceSet: true,
    });

    vi.advanceTimersByTime(61_000);
    const returningVerification = await verifySignIn(app, "locale-first@example.com");
    const returningCookies = setCookies(returningVerification);
    const sessionCookie = returningCookies.find((cookie) =>
      cookie.startsWith("openround_creator="),
    );
    expect(sessionCookie).toContain("Domain=example.test");
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("Max-Age=2592000");
    expect(returningCookies).toHaveLength(1);
    const localeBridge = new URL(returningVerification.json().redirectTo);
    expect(localeBridge.pathname).toBe("/auth/locale");
    expect(localeBridge.searchParams.get("locale")).toBe("ja-JP");
    expect(localeBridge.searchParams.get("returnTo")).toBe("/home?welcome=1");

    const otherUser = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: secondCookie },
    });
    expect(otherUser.json<{ creator: CreatorContext }>().creator).toMatchObject({
      locale: "en-CA",
      localePreferenceSet: false,
    });

    const unsupported = await app.inject({
      method: "PUT",
      url: "/v1/account/locale",
      headers: { cookie: firstCookie },
      payload: { locale: "en-US" },
    });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const afterRejectedUpdate = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: firstCookie },
    });
    expect(afterRejectedUpdate.json<{ creator: CreatorContext }>().creator.locale).toBe("ja-JP");
  });
});
