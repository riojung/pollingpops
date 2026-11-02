import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "@playwright/test";

const mocks = vi.hoisted(() => ({
  baseURL: "http://127.0.0.1:3200" as string | undefined,
  signInCreator: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
}));
vi.mock("../support/creator-auth", () => ({ signInCreator: mocks.signInCreator }));
vi.mock("@playwright/test", async () => {
  const { expect: assert } = await import("vitest");
  return {
    test: { info: () => ({ project: { use: { baseURL: mocks.baseURL } } }) },
    expect: (actual: unknown) => {
      if (actual && typeof actual === "object" && "url" in actual) {
        return {
          not: {
            toHaveURL: async (pattern: RegExp) => {
              assert((actual as Page).url()).not.toMatch(pattern);
            },
          },
        };
      }
      return assert(actual);
    },
  };
});

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
const completeSignIn = new WeakMap<Page, (email: string, returnTo: string) => void>();
let nextSession = 0;

function pageFixture({ cachedOk = true, cachedEmail = "creator@example.test" } = {}) {
  const baseURL = mocks.baseURL!;
  let currentUrl = "about:blank";
  let cookies: Cookies = [];
  let freshEmail: string | undefined;
  const context = {
    addCookies: vi.fn(async (saved: Cookies) => {
      cookies = saved;
    }),
    clearCookies: vi.fn(async () => {
      cookies = [];
    }),
    cookies: vi.fn(async () => cookies),
  };
  const get = vi.fn(async () => ({
    ok: () => Boolean(freshEmail) || cachedOk,
    json: async () => ({ creator: { email: freshEmail ?? cachedEmail } }),
  }));
  const goto = vi.fn(async (destination: string) => {
    currentUrl = new URL(destination, baseURL).href;
  });
  const page = {
    context: () => context,
    request: { get },
    goto,
    url: () => currentUrl,
  } as unknown as Page;
  completeSignIn.set(page, (email, returnTo) => {
    freshEmail = email;
    cookies = [
      {
        name: "openround_creator",
        value: `synthetic-session-${++nextSession}`,
        domain: new URL(baseURL).hostname,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ];
    currentUrl = new URL(returnTo, baseURL).href;
  });
  return { page, context, get, goto };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.baseURL = "http://127.0.0.1:3200";
  mocks.readFile.mockRejectedValue(
    Object.assign(new Error("Missing fixture cache"), { code: "ENOENT" }),
  );
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.signInCreator.mockImplementation(
    async (page: Page, email: string, options: { returnTo: string }) => {
      completeSignIn.get(page)!(email, options.returnTo);
    },
  );
  vi.stubEnv("BETA_E2E_API_PORT", "4200");
  vi.stubEnv("BETA_E2E_AUTH_CACHE_DIR", "");
  nextSession = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("beta session reuse without discarded documents", () => {
  it("lands fresh and cached sessions directly on Results without an intermediate dashboard", async () => {
    const { signInBeta } = await import("../beta-e2e/sign-in");
    const fresh = pageFixture();
    await signInBeta(fresh.page, "creator@example.test", { returnTo: "/results" });
    expect(mocks.signInCreator).toHaveBeenCalledExactlyOnceWith(
      fresh.page,
      "creator@example.test",
      {
        segment: "education",
        returnTo: "/results",
      },
    );
    expect(fresh.page.url()).toBe("http://127.0.0.1:3200/results");
    expect(fresh.goto).not.toHaveBeenCalled();

    const cached = pageFixture();
    await signInBeta(cached.page, "creator@example.test", { returnTo: "/results" });
    expect(cached.goto).toHaveBeenCalledExactlyOnceWith("/results", { waitUntil: "load" });
    expect(cached.get).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:4200/v1/auth/me");
    expect(cached.context.clearCookies).not.toHaveBeenCalled();
    expect(mocks.signInCreator).toHaveBeenCalledTimes(1);

    // Destination changes do not invalidate an otherwise identical, verified session cache.
    const defaultRoute = pageFixture();
    await signInBeta(defaultRoute.page, "creator@example.test");
    expect(defaultRoute.goto).toHaveBeenCalledExactlyOnceWith("/dashboard", { waitUntil: "load" });
    expect(mocks.signInCreator).toHaveBeenCalledTimes(1);
  });

  it("preserves the requested destination when a cached account fails validation", async () => {
    const { signInBeta } = await import("../beta-e2e/sign-in");
    await signInBeta(pageFixture().page, "creator@example.test");
    const wrongAccount = pageFixture({ cachedEmail: "other@example.test" });
    await signInBeta(wrongAccount.page, "creator@example.test", { returnTo: "/results" });
    expect(wrongAccount.context.clearCookies).toHaveBeenCalledExactlyOnceWith({
      name: "openround_creator",
    });
    expect(mocks.signInCreator).toHaveBeenLastCalledWith(
      wrongAccount.page,
      "creator@example.test",
      {
        segment: "education",
        returnTo: "/results",
      },
    );
    expect(wrongAccount.page.url()).toBe("http://127.0.0.1:3200/results");
    expect(wrongAccount.goto).not.toHaveBeenCalled();
  });

  it.each([
    "https://other.invalid/results",
    "//other.invalid/results",
    "/\\other.invalid/results",
    "/results\n",
  ])("rejects a nonlocal destination before accessing sessions", async (returnTo) => {
    const { signInBeta } = await import("../beta-e2e/sign-in");
    const fixture = pageFixture();
    await expect(signInBeta(fixture.page, "creator@example.test", { returnTo })).rejects.toThrow(
      "local return path",
    );
    expect(fixture.get).not.toHaveBeenCalled();
    expect(fixture.goto).not.toHaveBeenCalled();
    expect(fixture.context.addCookies).not.toHaveBeenCalled();
    expect(mocks.signInCreator).not.toHaveBeenCalled();
  });

  it("keeps cache misses on the real auth journey and navigates live cached sessions directly to the dashboard", async () => {
    const { signInBeta } = await import("../beta-e2e/sign-in");
    const first = pageFixture();
    await signInBeta(first.page, "creator@example.test");
    expect(first.goto).not.toHaveBeenCalled();
    expect(mocks.signInCreator).toHaveBeenCalledExactlyOnceWith(
      first.page,
      "creator@example.test",
      {
        segment: "education",
        returnTo: "/dashboard",
      },
    );

    const reused = pageFixture();
    await signInBeta(reused.page, "creator@example.test");
    expect(reused.context.addCookies).toHaveBeenCalledExactlyOnceWith(
      await first.context.cookies(),
    );
    expect(reused.get).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:4200/v1/auth/me");
    expect(reused.goto).toHaveBeenCalledExactlyOnceWith("/dashboard", { waitUntil: "load" });
    expect(reused.context.clearCookies).not.toHaveBeenCalled();
    expect(mocks.signInCreator).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "an expired session", cachedOk: false },
    { name: "a session for another account", cachedEmail: "other@example.test" },
  ])("replaces $name through the real auth journey", async (options) => {
    const { signInBeta } = await import("../beta-e2e/sign-in");
    await signInBeta(pageFixture().page, "creator@example.test");
    const stale = pageFixture(options);
    await signInBeta(stale.page, "creator@example.test");
    expect(stale.context.clearCookies).toHaveBeenCalledExactlyOnceWith({
      name: "openround_creator",
    });
    expect(stale.goto).not.toHaveBeenCalled();
    expect(mocks.signInCreator).toHaveBeenLastCalledWith(stale.page, "creator@example.test", {
      segment: "education",
      returnTo: "/dashboard",
    });
    expect(mocks.signInCreator).toHaveBeenCalledTimes(2);

    const recovered = pageFixture();
    await signInBeta(recovered.page, "creator@example.test");
    expect(recovered.context.addCookies).toHaveBeenCalledExactlyOnceWith(
      await stale.context.cookies(),
    );
    expect(mocks.signInCreator).toHaveBeenCalledTimes(2);
  });

  it.each(["web origin", "API origin", "account"])(
    "does not reuse cookies across a different %s",
    async (scope) => {
      const { signInBeta } = await import("../beta-e2e/sign-in");
      await signInBeta(pageFixture().page, "creator@example.test");
      if (scope === "web origin") mocks.baseURL = "http://127.0.0.1:3300";
      if (scope === "API origin") vi.stubEnv("BETA_E2E_API_PORT", "4300");
      const other = pageFixture();
      await signInBeta(
        other.page,
        scope === "account" ? "other@example.test" : "creator@example.test",
      );
      expect(other.context.addCookies).not.toHaveBeenCalled();
      expect(mocks.signInCreator).toHaveBeenCalledTimes(2);
      expect(other.goto).not.toHaveBeenCalled();
    },
  );

  it("uses the configured origin from a blank page and preserves private disk-cache writes", async () => {
    vi.stubEnv("BETA_E2E_AUTH_CACHE_DIR", "/synthetic-auth-cache");
    mocks.baseURL = "http://127.0.0.1:3300/nested/";
    const { signInBeta } = await import("../beta-e2e/sign-in");
    const first = pageFixture();
    expect(first.page.url()).toBe("about:blank");
    await signInBeta(first.page, "creator@example.test");
    expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^\/synthetic-auth-cache\/[a-f0-9]{64}\.json$/),
      JSON.stringify(await first.context.cookies()),
      { mode: 0o600 },
    );
    mocks.baseURL = "http://127.0.0.1:3300/another/";
    const reused = pageFixture();
    await signInBeta(reused.page, "creator@example.test");
    expect(reused.context.addCookies).toHaveBeenCalledTimes(1);
    expect(mocks.signInCreator).toHaveBeenCalledTimes(1);
  });

  it("fails before navigation or authentication when baseURL is missing", async () => {
    const { signInBeta } = await import("../beta-e2e/sign-in");
    const fixture = pageFixture();
    mocks.baseURL = undefined;
    await expect(signInBeta(fixture.page)).rejects.toThrow("configured Playwright baseURL");
    expect(fixture.goto).not.toHaveBeenCalled();
    expect(fixture.get).not.toHaveBeenCalled();
    expect(mocks.signInCreator).not.toHaveBeenCalled();
  });
});
