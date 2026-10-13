import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MemoryRepository, createPlatformRepository } from "@openround/db";
import { loadControlConfig, OperatorAuthService, tokenHash } from "@openround/control-plane";
import { controlRuntime } from "../lib/runtime";
import { POST } from "../app/auth/local/route";
import { GET as start } from "../app/auth/start/route";
import { GET as callback } from "../app/auth/callback/route";
import { POST as logout } from "../app/api/logout/route";
import { POST as command } from "../app/api/commands/route";
import { operatorCookieNames } from "../lib/http";

vi.mock("server-only", () => ({}));
vi.mock("../lib/runtime", () => ({ controlRuntime: vi.fn() }));

const origin = "http://127.0.0.1:3002";
const environment = {
  NODE_ENV: "test",
  CONTROL_ENABLED: "true",
  CONTROL_AUTH_MODE: "local",
  CONTROL_LOCAL_DEVELOPMENT: "true",
  OPENROUND_DEPLOYMENT_ENVIRONMENT: "development",
  CONTROL_PUBLIC_ORIGIN: origin,
  CONTROL_PRODUCT_ORIGIN: "http://127.0.0.1:8080",
  CONTROL_DATABASE_URL: "postgresql://runtime@127.0.0.1/control",
};
async function fixture() {
  const config = loadControlConfig(environment);
  const repository = new MemoryRepository();
  const platform = createPlatformRepository(repository);
  const auth = new OperatorAuthService(platform, config, {} as never);
  vi.mocked(controlRuntime).mockResolvedValue({
    config,
    repository,
    platform,
    auth,
  } as unknown as Awaited<ReturnType<typeof controlRuntime>>);
  return { auth, platform, config, names: operatorCookieNames(config) };
}

describe("local admin HTTP sign-in", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["local", "oidc"])("denies direct local provisioning in %s mode", async (mode) => {
    vi.stubEnv("CONTROL_AUTH_MODE", mode);
    const response = await POST();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "VERIFIED_SIGN_IN_REQUIRED" },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(vi.mocked(controlRuntime)).not.toHaveBeenCalled();
  });

  it("redirects local console sign-in to normal product sign-in and denies an OIDC callback", async () => {
    const response = await start();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${environment.CONTROL_PRODUCT_ORIGIN}/signin`);
    expect(response.headers.get("set-cookie")).toBeNull();
    const rejected = await callback(new NextRequest(`${origin}/auth/callback?code=x&state=y`));
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("set-cookie")).toBeNull();
    expect(vi.mocked(controlRuntime)).not.toHaveBeenCalled();
  });

  it("keeps command and logout CSRF checks and durably revokes confirmed logout", async () => {
    const { auth, platform, names } = await fixture();
    const { token, csrfToken: csrf } = await auth.localLogin("verified-product-sign-in-fixture");
    const cookie = `${names.session}=${token}; ${names.csrf}=${csrf}`;
    const rejectedCommand = await command(
      new NextRequest(`${origin}/api/commands`, {
        method: "POST",
        headers: { origin, cookie, "content-type": "application/json" },
        body: JSON.stringify({ action: "credits.grant" }),
      }),
    );
    expect(rejectedCommand.status).toBe(403);
    const rejectedLogout = await logout(
      new NextRequest(`${origin}/api/logout`, { method: "POST", headers: { origin, cookie } }),
    );
    expect(rejectedLogout.status).toBe(403);
    expect(rejectedLogout.headers.get("set-cookie")).toBeNull();
    await expect(auth.authenticate(token)).resolves.toBeTruthy();
    const signedOut = await logout(
      new NextRequest(`${origin}/api/logout`, {
        method: "POST",
        headers: { origin, cookie, "x-operator-csrf": csrf },
      }),
    );
    expect(signedOut.status).toBe(200);
    expect(signedOut.cookies.get(names.session)?.maxAge).toBe(0);
    expect(signedOut.cookies.get(names.csrf)?.maxAge).toBe(0);
    expect(await platform.getOperatorSession(tokenHash(token))).toBeNull();
    await expect(auth.authenticate(token)).rejects.toMatchObject({ status: 401 });
    expect((await platform.listAuditEvents()).map((event) => event.action)).toEqual([
      "operator.logout",
      "operator.login",
    ]);
  });
});
