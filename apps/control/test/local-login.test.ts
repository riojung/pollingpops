import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { controlRuntime } from "../lib/runtime";
import { POST } from "../app/auth/local/route";
import { GET as start } from "../app/auth/start/route";
import { GET as callback } from "../app/auth/callback/route";

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
  OPERATOR_CREDENTIAL_KEY: Buffer.alloc(32, 17).toString("base64"),
};

describe("standalone operator sign-in boundaries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["local", "oidc", "password"])(
    "denies direct local provisioning in %s mode",
    async (mode) => {
      vi.stubEnv("CONTROL_AUTH_MODE", mode);
      const response = await POST();
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "STANDALONE_SIGN_IN_REQUIRED" },
      });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(controlRuntime).not.toHaveBeenCalled();
    },
  );

  it("rejects legacy local sign-in without redirecting to the customer product", async () => {
    const response = await start();
    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).not.toContain(environment.CONTROL_PRODUCT_ORIGIN);
    expect(controlRuntime).not.toHaveBeenCalled();
  });

  it("opens the dedicated console form in password mode without minting credentials on GET", async () => {
    vi.stubEnv("CONTROL_AUTH_MODE", "password");
    const response = await start();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/`);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(controlRuntime).not.toHaveBeenCalled();
  });

  it.each(["local", "password"])("denies an OIDC callback in %s mode", async (mode) => {
    vi.stubEnv("CONTROL_AUTH_MODE", mode);
    const response = await callback(new NextRequest(`${origin}/auth/callback?code=x&state=y`));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(controlRuntime).not.toHaveBeenCalled();
  });

  it("preserves managed OIDC redirects and browser binding cookies", async () => {
    vi.stubEnv("CONTROL_AUTH_MODE", "oidc");
    vi.stubEnv("CONTROL_PUBLIC_ORIGIN", "https://control.example.test");
    vi.stubEnv("CONTROL_PRODUCT_ORIGIN", "https://product.example.test");
    for (const [name, value] of Object.entries({
      OPERATOR_OIDC_ISSUER: "https://identity.example.test",
      OPERATOR_OIDC_CLIENT_ID: "synthetic-operator",
      OPERATOR_OIDC_CLIENT_SECRET: "synthetic-secret",
      OPERATOR_OIDC_MFA_POLICY_ENFORCED: "true",
      OPERATOR_OIDC_REQUIRED_AMR: "mfa",
    }))
      vi.stubEnv(name, value);
    const { loadControlConfig, operatorCookieNames } = await import("@openround/control-plane");
    const config = loadControlConfig();
    const names = operatorCookieNames(config);
    const authStart = vi.fn().mockResolvedValue({
      authorizationUrl: "https://identity.example.test/authorize",
      binding: "synthetic-binding",
    });
    vi.mocked(controlRuntime).mockResolvedValue({
      config,
      auth: { start: authStart },
    } as unknown as Awaited<ReturnType<typeof controlRuntime>>);
    const response = await start();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://identity.example.test/authorize");
    expect(response.cookies.get(names.binding)?.value).toBe("synthetic-binding");
    expect(response.cookies.get(names.session)).toBeUndefined();
  });
});
