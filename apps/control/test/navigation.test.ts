import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  loadControlConfig,
  OperatorAuthService,
  OPERATOR_SESSION_COOKIE,
  type OperatorContext,
} from "@openround/control-plane";
import type { PlatformRepository } from "@openround/db";
import { controlRuntime } from "../lib/runtime";
import { GET } from "../app/api/navigation/route";

vi.mock("server-only", () => ({}));
vi.mock("../lib/runtime", () => ({ controlRuntime: vi.fn() }));

const productOrigin = "https://pollingpops.example";
const controlOrigin = "https://control.pollingpops.example";
const environment = {
  NODE_ENV: "test",
  CONTROL_ENABLED: "true",
  CONTROL_PUBLIC_ORIGIN: controlOrigin,
  CONTROL_PRODUCT_ORIGIN: productOrigin,
  CONTROL_DATABASE_URL: "postgresql://runtime@db/control",
  OPERATOR_OIDC_ISSUER: "https://identity.example",
  OPERATOR_OIDC_CLIENT_ID: "operator",
  OPERATOR_OIDC_CLIENT_SECRET: "PRIVATE_PROVIDER_SECRET",
  OPERATOR_OIDC_MFA_POLICY_ENFORCED: "true",
  OPERATOR_OIDC_REQUIRED_AMR: "mfa",
};
function request(origin: string | null = productOrigin, signedIn = true) {
  return new NextRequest(`${controlOrigin}/api/navigation`, {
    headers: {
      ...(origin ? { origin } : {}),
      ...(signedIn ? { cookie: `${OPERATOR_SESSION_COOKIE}=opaque-operator-token` } : {}),
    },
  });
}
function authenticateAs(
  role: OperatorContext["operator"]["role"] = "founder",
  capabilities: string[] = [],
) {
  const now = new Date();
  const current = {
    operator: {
      id: "operator-private-id",
      issuer: "private-issuer",
      subject: "private-subject",
      name: "Business administrator",
      role,
      active: true,
      capabilities,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: "private-session-id",
      tokenHash: "PRIVATE_TOKEN_HASH",
      csrfHash: "PRIVATE_CSRF_HASH",
      authenticatedAt: now,
      revokedAt: null,
      expiresAt: new Date(now.getTime() + 60_000),
    },
  };
  const touch = vi.fn().mockImplementation(async () => current);
  const config = loadControlConfig(environment);
  const auth = new OperatorAuthService(
    { touchOperatorSession: touch } as unknown as PlatformRepository,
    config,
    {} as never,
  );
  vi.mocked(controlRuntime).mockResolvedValue({
    config,
    auth,
  } as Awaited<ReturnType<typeof controlRuntime>>);
  return { current, touch };
}

describe("read-only operator navigation discovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns only current operator presentation and permitted absolute links", async () => {
    authenticateAs("founder");
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(productOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["operator", "links"]);
    expect(body.operator).toEqual({ name: "Business administrator", role: "founder" });
    expect(body.links.map((link: { id: string }) => link.id)).toEqual([
      "organizations",
      "billing",
      "credits",
      "operations",
      "support",
      "integrations",
      "audit",
    ]);
    for (const link of body.links) {
      expect(Object.keys(link)).toEqual(["id", "label", "href"]);
      expect(link.href).toBe(`${controlOrigin}/?view=${link.id}`);
    }
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE|csrf|session|subject|issuer/);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("filters each view from the current durable role and explicit capabilities", async () => {
    const { current, touch } = authenticateAs("support");
    expect(
      (await (await GET(request())).json()).links.map((link: { id: string }) => link.id),
    ).toEqual(["organizations", "support"]);
    current.operator.role = "operations";
    current.operator.capabilities = ["credits.read"];
    expect(
      (await (await GET(request())).json()).links.map((link: { id: string }) => link.id),
    ).toEqual(["organizations", "credits", "operations", "support", "integrations", "audit"]);
    expect(touch).toHaveBeenCalledTimes(2);
  });
  it("fails closed immediately after revocation without returning navigation", async () => {
    const { current } = authenticateAs();
    expect((await GET(request())).status).toBe(200);
    current.operator.active = false;
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe(productOrigin);
    expect(await response.json()).not.toHaveProperty("links");
  });
  it("does not accept customer sessions as operator authentication", async () => {
    const { touch } = authenticateAs();
    const response = await GET(
      new NextRequest(`${controlOrigin}/api/navigation`, {
        headers: { origin: productOrigin, cookie: "pollingpops-customer=session" },
      }),
    );
    expect(response.status).toBe(401);
    expect(touch).not.toHaveBeenCalled();
  });
  it.each(["https://evil.example", `${productOrigin}/`, "null", `${productOrigin}.evil.example`])(
    "rejects foreign Origin %s before touching the operator runtime",
    async (origin) => {
      authenticateAs();
      const response = await GET(request(origin));
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(controlRuntime).not.toHaveBeenCalled();
    },
  );
  it("allows same-console reads without enabling cross-origin writes", async () => {
    authenticateAs();
    const response = await GET(request(null));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-methods")).toBeNull();
    expect(response.headers.get("access-control-allow-headers")).toBeNull();
  });
  it("disables product discovery when no trusted product origin is configured", async () => {
    vi.stubEnv("CONTROL_PRODUCT_ORIGIN", "");
    authenticateAs();
    expect((await GET(request())).status).toBe(403);
  });
  it("returns a sanitized, readable unavailable result without credentials", async () => {
    vi.mocked(controlRuntime).mockRejectedValue(new Error("PRIVATE_DATABASE_SECRET"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe(productOrigin);
    expect(await response.text()).not.toContain("PRIVATE_DATABASE_SECRET");
  });
});
