import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { loadControlConfig, OperatorError, operatorCookieNames } from "@openround/control-plane";
import { controlRuntime } from "../lib/runtime";
import { GET, POST } from "../app/auth/password/route";

vi.mock("server-only", () => ({}));
vi.mock("../lib/runtime", () => ({ controlRuntime: vi.fn() }));

const origin = "https://control.example.test";
const environment = {
  NODE_ENV: "test",
  CONTROL_ENABLED: "true",
  CONTROL_AUTH_MODE: "password",
  CONTROL_PUBLIC_ORIGIN: origin,
  CONTROL_DATABASE_URL: "postgresql://runtime@db/control",
  OPERATOR_CREDENTIAL_KEY: Buffer.alloc(32, 19).toString("base64"),
};
const input = {
  username: "synthetic-operator",
  password: "synthetic-test-password",
  code: "123456",
};
function fixture() {
  const config = loadControlConfig(environment);
  const passwordLogin = vi.fn().mockResolvedValue({
    token: "opaque-session",
    csrfToken: "opaque-csrf",
    operator: { id: "synthetic-operator" },
  });
  vi.mocked(controlRuntime).mockResolvedValue({
    config,
    auth: { passwordLogin },
  } as unknown as Awaited<ReturnType<typeof controlRuntime>>);
  return { passwordLogin, names: operatorCookieNames(config) };
}
function request(body: unknown = input, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/auth/password`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("dedicated password and authenticator HTTP sign-in", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("passes exact credentials to the auth service and returns only same-origin secure session cookies", async () => {
    const { passwordLogin, names } = fixture();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(passwordLogin).toHaveBeenCalledWith({
      ...input,
      requestId: expect.any(String),
      previousToken: undefined,
    });
    expect(passwordLogin.mock.calls[0]?.[0].requestId).toMatch(/^[\da-f-]{36}$/);
    expect(await response.json()).toEqual({ signedIn: true });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    for (const [name, value] of [
      [names.session, "opaque-session"],
      [names.csrf, "opaque-csrf"],
    ]) {
      expect(response.cookies.get(name!)).toMatchObject({
        value,
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      });
    }
    expect(response.cookies.get(names.binding)?.maxAge).toBe(0);
    expect(response.headers.get("location")).toBeNull();
  });

  it("forwards only the existing operator cookie for atomic replacement after verified sign-in", async () => {
    const { passwordLogin, names } = fixture();
    await POST(
      request(input, { cookie: `${names.session}=existing-operator-session; customer=unrelated` }),
    );
    expect(passwordLogin).toHaveBeenCalledWith(
      expect.objectContaining({ previousToken: "existing-operator-session" }),
    );
  });

  it("keeps passwords unmodified while allowing the backend to normalize a username", async () => {
    const { passwordLogin } = fixture();
    const exactInput = {
      ...input,
      username: " Synthetic.Operator ",
      password: " synthetic password ",
    };
    expect((await POST(request(exactInput))).status).toBe(200);
    expect(passwordLogin).toHaveBeenCalledWith(expect.objectContaining(exactInput));
  });

  it.each(["", "null", "https://product.example.test", `${origin}/`, `${origin}.evil.test`])(
    "rejects Origin %s before reaching credentials or the operator runtime",
    async (untrustedOrigin) => {
      const response = await POST(request(input, { origin: untrustedOrigin }));
      expect(response.status).toBe(403);
      expect(controlRuntime).not.toHaveBeenCalled();
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it("rejects a missing Origin and cross-site browser metadata", async () => {
    const missingOrigin = request();
    missingOrigin.headers.delete("origin");
    expect((await POST(missingOrigin)).status).toBe(403);
    expect((await POST(request(input, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(controlRuntime).not.toHaveBeenCalled();
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "application/jsonx", ""])(
    "rejects content type %s before authenticating",
    async (contentType) => {
      const response = await POST(request(input, { "content-type": contentType }));
      expect(response.status).toBe(415);
      expect(controlRuntime).not.toHaveBeenCalled();
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it("allows a JSON charset parameter", async () => {
    fixture();
    expect(
      (await POST(request(input, { "content-type": "application/json; charset=utf-8" }))).status,
    ).toBe(200);
  });

  it.each([
    null,
    [],
    {},
    { ...input, extra: true },
    { ...input, requestId: "untrusted" },
    { ...input, previousToken: "untrusted" },
    { ...input, username: "" },
    { ...input, username: "x".repeat(129) },
    { ...input, username: 123 },
    { ...input, password: "" },
    { ...input, password: "x".repeat(1025) },
    { ...input, password: "é".repeat(513) },
    { ...input, password: 123 },
    { ...input, code: "12345" },
    { ...input, code: "1234567" },
    { ...input, code: "１２３４５６" },
    { ...input, code: "123 56" },
    { ...input, code: 123456 },
  ])(
    "rejects an invalid or unexpected credential shape without authenticating: %j",
    async (body) => {
      const response = await POST(request(body));
      expect(response.status).toBe(422);
      expect(controlRuntime).not.toHaveBeenCalled();
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.text()).not.toContain(input.password);
    },
  );

  it("bounds both declared and streamed JSON body size before authentication", async () => {
    expect((await POST(request(input, { "content-length": "8193" }))).status).toBe(413);
    expect((await POST(request({ ...input, password: "x".repeat(8193) }))).status).toBe(413);
    expect(controlRuntime).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without returning submitted secrets", async () => {
    const response = await POST(request('{"password":"synthetic-private-value",'));
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain("synthetic-private-value");
    expect(controlRuntime).not.toHaveBeenCalled();
  });

  it.each(["UNKNOWN_USERNAME", "INVALID_PASSWORD", "INVALID_CODE", "CODE_REPLAYED"])(
    "returns the same generic error for %s and never replaces cookies on failure",
    async (code) => {
      const { passwordLogin, names } = fixture();
      passwordLogin.mockRejectedValue(new OperatorError(401, code, "synthetic-private-diagnostic"));
      const response = await POST(
        request(input, { cookie: `${names.session}=existing-operator-session` }),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: {
          code: "SIGN_IN_FAILED",
          message: "Check your username, password, and authenticator code and try again",
        },
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it("sanitizes unexpected runtime failures", async () => {
    vi.mocked(controlRuntime).mockRejectedValue(new Error("synthetic-private-database-secret"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("synthetic-private-database-secret");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each(["local", "oidc"])("does not accept passwords in %s mode", async (mode) => {
    vi.stubEnv("CONTROL_AUTH_MODE", mode);
    vi.stubEnv("CONTROL_LOCAL_DEVELOPMENT", "true");
    vi.stubEnv("OPENROUND_DEPLOYMENT_ENVIRONMENT", "development");
    if (mode === "local") vi.stubEnv("CONTROL_PUBLIC_ORIGIN", "http://127.0.0.1:3002");
    if (mode === "oidc") {
      vi.stubEnv("OPERATOR_OIDC_ISSUER", "https://identity.example.test");
      vi.stubEnv("OPERATOR_OIDC_CLIENT_ID", "synthetic-client");
      vi.stubEnv("OPERATOR_OIDC_CLIENT_SECRET", "synthetic-secret");
      vi.stubEnv("OPERATOR_OIDC_MFA_POLICY_ENFORCED", "true");
      vi.stubEnv("OPERATOR_OIDC_REQUIRED_AMR", "mfa");
    }
    expect((await POST(request())).status).toBe(404);
    expect(controlRuntime).not.toHaveBeenCalled();
  });

  it("does not accept passwords while the console is disabled", async () => {
    vi.stubEnv("CONTROL_ENABLED", "false");
    expect((await POST(request())).status).toBe(404);
    expect(controlRuntime).not.toHaveBeenCalled();
  });

  it("never authenticates or sets cookies on GET", async () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(controlRuntime).not.toHaveBeenCalled();
  });
});
