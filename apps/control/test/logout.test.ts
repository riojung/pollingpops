import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MemoryRepository, createPlatformRepository } from "@openround/db";
import {
  loadControlConfig,
  OperatorAuthService,
  OPERATOR_SESSION_COOKIE,
  tokenHash,
} from "@openround/control-plane";
import { controlRuntime } from "../lib/runtime";
import { POST } from "../app/api/logout/route";

vi.mock("server-only", () => ({}));
vi.mock("../lib/runtime", () => ({ controlRuntime: vi.fn() }));

const origin = "https://control.example.test";
const freshToken = "new-tab-operator-session";
const freshCsrf = "new-tab-csrf";
const oldCsrf = "original-tab-csrf";
async function fixture() {
  const config = loadControlConfig({
    NODE_ENV: "test",
    CONTROL_ENABLED: "true",
    CONTROL_PUBLIC_ORIGIN: origin,
    CONTROL_DATABASE_URL: "postgresql://runtime@db/control",
    OPERATOR_OIDC_ISSUER: "https://identity.example.test",
    OPERATOR_OIDC_CLIENT_ID: "operator",
    OPERATOR_OIDC_CLIENT_SECRET: "synthetic-secret",
    OPERATOR_OIDC_MFA_POLICY_ENFORCED: "true",
    OPERATOR_OIDC_REQUIRED_AMR: "mfa",
  });
  const repository = new MemoryRepository();
  const platform = createPlatformRepository(repository);
  const now = new Date();
  const operator = await platform.provisionOperator({
    issuer: config.OPERATOR_OIDC_ISSUER!,
    subject: "synthetic-founder",
    name: "Synthetic founder",
    role: "founder",
    capabilities: [],
    active: true,
  });
  await platform.createOperatorSession({
    id: crypto.randomUUID(),
    operatorId: operator.id,
    tokenHash: tokenHash(freshToken),
    csrfHash: tokenHash(freshCsrf),
    authenticatedAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    revokedAt: null,
  });
  const auth = new OperatorAuthService(platform, config, {} as never);
  vi.mocked(controlRuntime).mockResolvedValue({
    config,
    repository,
    platform,
    auth,
  } as unknown as Awaited<ReturnType<typeof controlRuntime>>);
  return { platform };
}
function request(csrf: string, authenticated = true) {
  return new NextRequest(`${origin}/api/logout`, {
    method: "POST",
    headers: {
      origin,
      "x-operator-csrf": csrf,
      ...(authenticated ? { cookie: `${OPERATOR_SESSION_COOKIE}=${freshToken}` } : {}),
    },
  });
}

describe("operator logout confirmation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rejects a tab's stale CSRF without revoking the current browser session or cookies", async () => {
    const { platform } = await fixture();
    const response = await POST(request(oldCsrf));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await platform.getOperatorSession(tokenHash(freshToken))).not.toBeNull();
    expect(await platform.listAuditEvents()).toHaveLength(0);
  });

  it("confirms fresh-CSRF logout only after durable revocation and clears both operator cookies", async () => {
    const { platform } = await fixture();
    const response = await POST(request(freshCsrf));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signedOut: true });
    expect(await platform.getOperatorSession(tokenHash(freshToken))).toBeNull();
    expect(response.cookies.get(OPERATOR_SESSION_COOKIE)?.value).toBe("");
    expect(response.cookies.get("__Host-pollingpops-operator-csrf")?.value).toBe("");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await platform.listAuditEvents()).map((event) => event.action)).toEqual([
      "operator.logout",
    ]);
  });

  it("distinguishes an actually unauthenticated session from request verification rejection", async () => {
    const { platform } = await fixture();
    const response = await POST(request(freshCsrf, false));
    expect(response.status).toBe(401);
    expect(await platform.listAuditEvents()).toHaveLength(0);
  });
});
