import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MemoryRepository, createPlatformRepository } from "@openround/db";
import {
  loadControlConfig,
  OperatorAuthService,
  operatorCapabilities,
  tokenHash,
} from "@openround/control-plane";
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
function request(requestOrigin: string | null = origin) {
  return new NextRequest(`${origin}/auth/local`, {
    method: "POST",
    headers: requestOrigin ? { origin: requestOrigin } : {},
  });
}

describe("local admin HTTP sign-in", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("issues opaque cookies for a durable admin without any issuer configuration", async () => {
    const { auth, platform, names } = await fixture();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signedIn: true });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const token = response.cookies.get(names.session)!.value;
    const csrf = response.cookies.get(names.csrf)!.value;
    expect(token).toBeTruthy();
    expect(csrf).toBeTruthy();
    expect(token).not.toBe(csrf);
    const context = await auth.authenticate(token);
    expect(context.operator).toMatchObject({ name: "Local admin", role: "founder", active: true });
    expect(operatorCapabilities(context.operator)).toContain("organizations.write");
    expect(operatorCapabilities(context.operator)).toContain("billing.read");
    expect(context.session.tokenHash).toBe(tokenHash(token));
    expect(context.session.csrfHash).toBe(tokenHash(csrf));
    for (const name of [names.session, names.csrf])
      expect(response.cookies.get(name)).toMatchObject({
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
        maxAge: 8 * 60 * 60,
      });
    expect(response.cookies.get(names.binding)?.maxAge).toBe(0);
    expect((await platform.listAuditEvents()).map((event) => event.action)).toEqual([
      "operator.login",
    ]);
  });

  it.each([null, "null", "http://evil.example", `${origin}/`, "http://localhost:3002"])(
    "rejects missing or inexact Origin %s before initializing runtime",
    async (requestOrigin) => {
      const response = await POST(request(requestOrigin));
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(vi.mocked(controlRuntime)).not.toHaveBeenCalled();
    },
  );

  it("rejects local login when configured for managed identity", async () => {
    vi.stubEnv("CONTROL_AUTH_MODE", "oidc");
    vi.stubEnv("CONTROL_ALLOW_LOCAL_HTTP", "true");
    vi.stubEnv("OPERATOR_OIDC_ISSUER", "https://identity.example.test");
    vi.stubEnv("OPERATOR_OIDC_CLIENT_ID", "operator");
    vi.stubEnv("OPERATOR_OIDC_CLIENT_SECRET", "synthetic-secret");
    vi.stubEnv("OPERATOR_OIDC_MFA_POLICY_ENFORCED", "true");
    vi.stubEnv("OPERATOR_OIDC_REQUIRED_AMR", "mfa");
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(vi.mocked(controlRuntime)).not.toHaveBeenCalled();
  });

  it("uses GET only to show the local sign-in page and denies an OIDC callback", async () => {
    const response = await start();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/`);
    expect(response.headers.get("set-cookie")).toBeNull();
    const rejected = await callback(new NextRequest(`${origin}/auth/callback?code=x&state=y`));
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("set-cookie")).toBeNull();
    expect(vi.mocked(controlRuntime)).not.toHaveBeenCalled();
  });

  it("keeps command and logout CSRF checks and durably revokes confirmed logout", async () => {
    const { auth, platform, names } = await fixture();
    const response = await POST(request());
    const token = response.cookies.get(names.session)!.value;
    const csrf = response.cookies.get(names.csrf)!.value;
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
