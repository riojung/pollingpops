import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPlatformRepository, MemoryRepository, type PlatformRepository } from "@openround/db";
import { loadControlConfig } from "../src/config.js";
import { OperatorService } from "../src/operator-service.js";
import {
  LOCAL_OPERATOR_ISSUER,
  OperatorAuthService,
  type OperatorError,
  tokenHash,
} from "../src/auth.js";
import {
  generateOperatorTotpSecret,
  operatorTotpCode,
  PASSWORD_OPERATOR_ISSUER,
  provisionPasswordOperator,
} from "../src/password-auth.js";

const password = "synthetic-test-administrator-password";
const configuration = (key = randomBytes(32).toString("base64")) =>
  loadControlConfig({
    CONTROL_ENABLED: "true",
    CONTROL_AUTH_MODE: "password",
    CONTROL_PUBLIC_ORIGIN: "https://control.example.test",
    CONTROL_DATABASE_URL: "postgresql://runtime@db/control",
    OPERATOR_CREDENTIAL_KEY: key,
  });
const provider = () => ({ authorizationUrl: vi.fn(), exchange: vi.fn() });
async function fixture(role: "founder" | "support" = "founder") {
  const platform = createPlatformRepository(new MemoryRepository());
  const config = configuration();
  const provisioned = await provisionPasswordOperator(platform, config, {
    username: "Admin.Test",
    password,
    name: "Test administrator",
    role,
  });
  const auth = new OperatorAuthService(platform, config, provider());
  const now = new Date();
  const login = (overrides: Partial<Parameters<typeof auth.passwordLogin>[0]> = {}, at = now) =>
    auth.passwordLogin(
      {
        username: "ADMIN.test",
        password,
        code: operatorTotpCode(provisioned.totpSecret, at),
        requestId: randomUUID(),
        ...overrides,
      },
      at,
    );
  return { platform, config, provisioned, auth, now, login };
}

async function provisionLegacyFounder(platform: PlatformRepository) {
  return platform.provisionOperator({
    issuer: LOCAL_OPERATOR_ISSUER,
    subject: "local-admin",
    name: "Legacy local founder",
    role: "founder",
    capabilities: [],
    active: true,
  });
}

function withFailingAudit(platform: PlatformRepository): PlatformRepository {
  return new Proxy(platform, {
    get(target, property) {
      if (property === "withOperatorTransaction")
        return (work: (repository: PlatformRepository) => Promise<unknown>) =>
          target.withOperatorTransaction(async (repository) =>
            work(
              new Proxy(repository, {
                get(scoped, key) {
                  if (key === "appendAuditEvent")
                    return async () => {
                      throw new Error("audit unavailable");
                    };
                  return Reflect.get(scoped, key);
                },
              }),
            ),
          );
      return Reflect.get(target, property);
    },
  });
}

describe("standalone administrator password and authenticator authentication", () => {
  it("matches RFC 6238 SHA-1 vectors with six-digit truncation", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    for (const [seconds, expected] of [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
      [20000000000, "353130"],
    ] as const)
      expect(operatorTotpCode(secret, new Date(seconds * 1000))).toBe(expected);
  });
  it("provisions only offline with an explicit role and keeps verifier/seed out of public projections and audits", async () => {
    const { platform, provisioned, config } = await fixture();
    expect(provisioned.operator).toMatchObject({
      issuer: PASSWORD_OPERATOR_ISSUER,
      subject: "admin.test",
      role: "founder",
    });
    expect(provisioned.otpauthUri).toContain("otpauth://totp/");
    const credential = (await platform.getOperatorPasswordCredential("admin.test"))!;
    expect(credential.passwordVerifier).toMatchObject({
      algorithm: "scrypt",
      cost: 32768,
      blockSize: 8,
      parallelization: 3,
    });
    expect(credential.totpCiphertext).toMatch(/^v1\./);
    expect(credential.lastUsedCounter).toBeNull();
    for (const stored of [
      credential,
      await platform.listOperators(),
      await platform.listAuditEvents(),
    ]) {
      expect(JSON.stringify(stored)).not.toContain(password);
      expect(JSON.stringify(stored)).not.toContain(provisioned.totpSecret);
    }
    expect(JSON.stringify(await platform.listOperators())).not.toContain("passwordVerifier");
    await expect(
      provisionPasswordOperator(platform, config, {
        username: "admin.test",
        password,
        name: "Duplicate",
        role: "founder",
      }),
    ).rejects.toMatchObject({ code: "OPERATOR_EXISTS" });
    await expect(
      provisionPasswordOperator(platform, config, {
        username: "other.admin",
        password,
        name: "No role",
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_OPERATOR" });
  });
  it("issues a hashed durable session only after both factors and never invokes OIDC", async () => {
    const { login, auth, platform, now } = await fixture();
    const result = await login();
    expect((await auth.authenticate(result.token, now)).operator.id).toBe(result.operator.id);
    const durable = await platform.getOperatorSession(tokenHash(result.token), now);
    expect(durable?.session.csrfHash).toBe(tokenHash(result.csrfToken));
    expect(JSON.stringify(durable)).not.toContain(result.token);
    expect(
      (await platform.listAuditEvents()).filter((event) => event.action === "operator.login"),
    ).toHaveLength(1);
    await expect(auth.start()).rejects.toMatchObject({ code: "OIDC_DISABLED" });
    await expect(auth.localLogin("local")).rejects.toMatchObject({ code: "LOCAL_AUTH_DISABLED" });
  });
  it("gives the same failure for bad password, bad code, invalid username and nonexistent accounts without sessions", async () => {
    const { login, platform } = await fixture();
    const errors: unknown[] = [];
    for (const override of [
      { password: "incorrect" },
      { code: "00000x" },
      { username: "unknown" },
      { username: "invalid username" },
    ]) {
      errors.push(
        await login(override).catch((error: OperatorError) => ({
          message: error.message,
          code: error.code,
          status: error.status,
        })),
      );
    }
    expect(errors.every((error) => JSON.stringify(error) === JSON.stringify(errors[0]))).toBe(true);
    expect(
      (await platform.listAuditEvents()).filter((event) => event.action === "operator.login"),
    ).toHaveLength(0);
    expect(
      (await platform.getOperatorPasswordCredential("admin.test"))?.lastUsedCounter,
    ).toBeNull();
  });
  it("accepts one step of clock drift and durably rejects replay and older steps across service instances", async () => {
    const { config, login, platform, provisioned, now } = await fixture();
    const future = new Date(now.getTime() + 30_000);
    await login({ code: operatorTotpCode(provisioned.totpSecret, future) });
    const second = new OperatorAuthService(platform, config, provider());
    for (const at of [now, future])
      await expect(
        second.passwordLogin(
          {
            username: "admin.test",
            password,
            code: operatorTotpCode(provisioned.totpSecret, at),
            requestId: "replay",
          },
          now,
        ),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(login({}, new Date(now.getTime() + 60_000))).resolves.toHaveProperty("token");
  });
  it("commits exactly one session and audit for concurrent use of the same authenticator code", async () => {
    const { login, platform, config, provisioned, now } = await fixture();
    const auth2 = new OperatorAuthService(platform, config, provider());
    const results = await Promise.allSettled([
      login(),
      auth2.passwordLogin(
        {
          username: "admin.test",
          password,
          code: operatorTotpCode(provisioned.totpSecret, now),
          requestId: "second-process",
        },
        now,
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      (await platform.listAuditEvents()).filter((event) => event.action === "operator.login"),
    ).toHaveLength(1);
  });
  it("persists per-user lockouts across auth instances and recovers after expiry", async () => {
    const { login, config, platform, now, provisioned } = await fixture();
    for (let index = 0; index < 5; index++)
      await expect(login({ password: "incorrect" })).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
    const second = new OperatorAuthService(platform, config, provider());
    await expect(
      second.passwordLogin(
        {
          username: "admin.test",
          password,
          code: operatorTotpCode(provisioned.totpSecret, now),
          requestId: "locked",
        },
        now,
      ),
    ).rejects.toMatchObject({ status: 429, code: "LOGIN_RATE_LIMITED" });
    await expect(login({}, new Date(now.getTime() + 15 * 60_000 + 1))).resolves.toHaveProperty(
      "token",
    );
  });
  // Eleven real scrypt derivations retain both username paths and rate limits on shared CI CPUs.
  it("returns the same helpful rate-limit refusal for existing and nonexistent usernames", async () => {
    const { login } = await fixture();
    const errors: unknown[] = [];
    for (const username of ["admin.test", "unknown.admin"]) {
      for (let index = 0; index < 5; index++)
        await expect(login({ username, password: "incorrect" })).rejects.toMatchObject({
          status: 401,
          code: "INVALID_CREDENTIALS",
        });
      errors.push(
        await login({ username }).catch((error: OperatorError) => ({
          status: error.status,
          code: error.code,
          message: error.message,
        })),
      );
    }
    expect(errors).toEqual([
      {
        status: 429,
        code: "LOGIN_RATE_LIMITED",
        message:
          "Too many administrator sign-in attempts. Wait up to 15 minutes before trying again.",
      },
      errors[0],
    ]);
  }, 15_000);
  it("allows more than five successful reauthentications inside one username throttle window", async () => {
    const { login, auth, platform, now } = await fixture();
    let previousToken: string | undefined;
    for (let index = 0; index < 7; index++) {
      const at = new Date(now.getTime() + index * 30_000);
      const signedIn = await login({ previousToken }, at);
      await expect(auth.authenticate(signedIn.token, at)).resolves.toHaveProperty("operator");
      if (previousToken)
        await expect(auth.authenticate(previousToken, at)).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
      previousToken = signedIn.token;
    }
    expect(
      (await platform.listAuditEvents()).filter((event) => event.action === "operator.login"),
    ).toHaveLength(7);
  });
  // Eleven real scrypt derivations cover failed factors, successful sign-in and replay lockout.
  it("clears prior failed factors after success and still limits subsequent authenticator replays", async () => {
    const { login } = await fixture();
    for (const override of [
      { password: "incorrect" },
      { code: "00000x" },
      { password: "incorrect" },
      { code: "00000x" },
    ])
      await expect(login(override)).rejects.toMatchObject({
        status: 401,
        code: "INVALID_CREDENTIALS",
      });
    await expect(login()).resolves.toHaveProperty("token");
    for (let index = 0; index < 5; index++)
      await expect(login()).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    await expect(login()).rejects.toMatchObject({ status: 429, code: "LOGIN_RATE_LIMITED" });
  }, 15_000);
  it("preserves the global attempt budget after successful sign-in and offline credential reset", async () => {
    const { platform, config, login, now } = await fixture();
    const globalKey = tokenHash("operator-login-global");
    for (let index = 0; index < 99; index++)
      expect(
        await platform.recordOperatorPasswordAttempt(globalKey, now, {
          maxAttempts: 100,
          windowMs: 60_000,
        }),
      ).toBe(true);
    await expect(login()).resolves.toHaveProperty("token");
    const next = new Date(now.getTime() + 30_000);
    await expect(login({}, next)).rejects.toMatchObject({
      status: 429,
      code: "LOGIN_RATE_LIMITED",
    });
    await provisionPasswordOperator(platform, config, {
      username: "ADMIN.test",
      password,
      name: "Reset administrator",
      role: "founder",
      reset: true,
    });
    await expect(login({}, next)).rejects.toMatchObject({
      status: 429,
      code: "LOGIN_RATE_LIMITED",
    });
  });
  it("atomically replaces an old session after successful factors and preserves it after bad factors", async () => {
    const { login, auth, now } = await fixture();
    const first = await login();
    await expect(
      login({ password: "incorrect", previousToken: first.token }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(auth.authenticate(first.token, now)).resolves.toHaveProperty("operator");
    const next = new Date(now.getTime() + 30_000);
    const second = await login({ previousToken: first.token }, next);
    await expect(auth.authenticate(first.token, next)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(auth.authenticate(second.token, next)).resolves.toHaveProperty("operator");
  });
  it("explicit credential reset revokes sessions and preserves account disablement", async () => {
    const { login, auth, platform, config, provisioned } = await fixture("support");
    const first = await login();
    const replacement = await provisionPasswordOperator(platform, config, {
      username: "admin.test",
      password: `${password}-new`,
      name: "Reset admin",
      role: "support",
      reset: true,
    });
    expect(replacement.operator.id).toBe(first.operator.id);
    await expect(auth.authenticate(first.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await platform.provisionOperator({ ...provisioned.operator, active: false });
    const resetDisabled = await provisionPasswordOperator(platform, config, {
      username: "admin.test",
      password,
      name: "Disabled admin",
      role: "support",
      reset: true,
    });
    expect(resetDisabled.operator.active).toBe(false);
    await expect(
      auth.passwordLogin({
        username: "admin.test",
        password,
        code: operatorTotpCode(resetDisabled.totpSecret),
        requestId: "disabled",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
  // Ten real scrypt derivations include both rolled-back and successful offline credential resets.
  it("recovers a locked username immediately after an atomic offline credential reset", async () => {
    const { login, auth, platform, config, now } = await fixture();
    const signedIn = await login();
    for (let index = 0; index < 5; index++)
      await expect(login({ password: "incorrect" })).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
    const before = await platform.getOperatorPasswordCredential("admin.test");
    const input = {
      username: " ADMIN.test ",
      password: `${password}-reset`,
      name: "Reset administrator",
      role: "founder" as const,
      reset: true,
    };
    await expect(
      provisionPasswordOperator(withFailingAudit(platform), config, input, now),
    ).rejects.toThrow("audit unavailable");
    expect(await platform.getOperatorPasswordCredential("admin.test")).toEqual(before);
    await expect(auth.authenticate(signedIn.token, now)).resolves.toHaveProperty("operator");
    await expect(login()).rejects.toMatchObject({ status: 429, code: "LOGIN_RATE_LIMITED" });

    const reset = await provisionPasswordOperator(platform, config, input, now);
    await expect(auth.authenticate(signedIn.token, now)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      login({ password: input.password, code: operatorTotpCode(reset.totpSecret, now) }),
    ).resolves.toHaveProperty("token");
  }, 15_000);
  it("rejects swapped seed ciphertext or a wrong encryption key", async () => {
    const { config, platform, provisioned, now, login } = await fixture();
    const wrongKey = new OperatorAuthService(platform, configuration(), provider());
    await expect(
      wrongKey.passwordLogin(
        {
          username: "admin.test",
          password,
          code: operatorTotpCode(provisioned.totpSecret, now),
          requestId: "wrong-key",
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await provisionPasswordOperator(platform, config, {
      username: "other.admin",
      password,
      name: "Other admin",
      role: "support",
    });
    const first = (await platform.getOperatorPasswordCredential("admin.test"))!;
    const second = (await platform.getOperatorPasswordCredential("other.admin"))!;
    await platform.saveOperatorPasswordCredential(
      { ...first, totpCiphertext: second.totpCiphertext },
      first.revision,
    );
    await expect(login()).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
  it("rejects credential replacement performed while scrypt is pending", async () => {
    const { platform, config, provisioned, now } = await fixture();
    let reads = 0;
    const raced = new Proxy(platform, {
      get(target, key) {
        if (key === "getOperatorPasswordCredential")
          return async (username: string) => {
            const old = await target.getOperatorPasswordCredential(username);
            if (++reads === 1 && old)
              await target.saveOperatorPasswordCredential(
                { ...old, totpCiphertext: old.totpCiphertext },
                old.revision,
              );
            return old;
          };
        return Reflect.get(target, key);
      },
    });
    await expect(
      new OperatorAuthService(raced, config, provider()).passwordLogin(
        {
          username: "admin.test",
          password,
          code: operatorTotpCode(provisioned.totpSecret, now),
          requestId: "raced",
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(
      (await platform.getOperatorPasswordCredential("admin.test"))?.lastUsedCounter,
    ).toBeNull();
  });
  it("rolls back the username budget clear, session and replay consumption when audit persistence fails", async () => {
    const { platform, config, provisioned, now, login } = await fixture();
    for (let index = 0; index < 4; index++)
      await expect(login({ password: "incorrect" })).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
    await expect(
      new OperatorAuthService(withFailingAudit(platform), config, provider()).passwordLogin(
        {
          username: "admin.test",
          password,
          code: operatorTotpCode(provisioned.totpSecret, now),
          requestId: "rollback",
        },
        now,
      ),
    ).rejects.toThrow("audit unavailable");
    expect(
      (await platform.getOperatorPasswordCredential("admin.test"))?.lastUsedCounter,
    ).toBeNull();
    await expect(login()).rejects.toMatchObject({ status: 429, code: "LOGIN_RATE_LIMITED" });
    await expect(login({}, new Date(now.getTime() + 15 * 60_000 + 1))).resolves.toHaveProperty(
      "token",
    );
  });
  it("isolates password, legacy local and OIDC sessions on a shared database", async () => {
    const { platform, auth, login, now } = await fixture();
    const session = await login();
    const localConfig = loadControlConfig({
      CONTROL_ENABLED: "true",
      CONTROL_AUTH_MODE: "local",
      CONTROL_LOCAL_DEVELOPMENT: "true",
      OPENROUND_DEPLOYMENT_ENVIRONMENT: "development",
      CONTROL_PUBLIC_ORIGIN: "http://localhost:3002",
      CONTROL_DATABASE_URL: "postgresql://runtime@db/control",
    });
    const localAuth = new OperatorAuthService(platform, localConfig, provider());
    await expect(localAuth.authenticate(session.token, now)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const local = await localAuth.localLogin("legacy");
    expect(local.operator.issuer).toBe(LOCAL_OPERATOR_ISSUER);
    await expect(auth.authenticate(local.token, now)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const oidcConfig = loadControlConfig({
      CONTROL_ENABLED: "true",
      CONTROL_PUBLIC_ORIGIN: "https://control.example.test",
      CONTROL_DATABASE_URL: "postgresql://runtime@db/control",
      OPERATOR_OIDC_ISSUER: "https://identity.example.test",
      OPERATOR_OIDC_CLIENT_ID: "operator",
      OPERATOR_OIDC_CLIENT_SECRET: "synthetic",
      OPERATOR_OIDC_MFA_POLICY_ENFORCED: "true",
      OPERATOR_OIDC_REQUIRED_AMR: "mfa",
    });
    await expect(
      new OperatorAuthService(platform, oidcConfig, provider()).authenticate(session.token, now),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("bounds concurrent native password verification and queued work", async () => {
    const { auth, platform, now } = await fixture();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        auth
          .passwordLogin(
            {
              username: `unknown-${index}`,
              password,
              code: "123456",
              requestId: `bounded-${index}`,
            },
            now,
          )
          .catch((error: OperatorError) => ({ code: error.code, status: error.status })),
      ),
    );
    expect(
      results.filter((result) => "code" in result && result.code === "AUTH_BUSY"),
    ).toHaveLength(2);
    expect(
      results.filter((result) => "code" in result && result.code === "INVALID_CREDENTIALS"),
    ).toHaveLength(10);
    expect(
      (await platform.listAuditEvents()).filter((event) => event.action === "operator.login"),
    ).toHaveLength(0);
  });
  it.each([
    { role: "readonly", active: true },
    { role: "founder", active: false },
  ] as const)(
    "does not count a legacy local founder when an API command would strand password administrators (%j)",
    async (change) => {
      const { platform, provisioned, login, auth, now } = await fixture();
      await provisionLegacyFounder(platform);
      const signedIn = await login();
      const context = await auth.authenticate(signedIn.token, now);
      await expect(
        new OperatorService(platform).command(
          context,
          {
            action: "operators.update",
            operatorId: provisioned.operator.id,
            ...change,
            reason: "Regression protection for password founder",
            idempotencyKey: randomUUID(),
          },
          "last-password-founder",
        ),
      ).rejects.toMatchObject({ status: 409, code: "LAST_FOUNDER" });
      expect(await platform.getOperator(provisioned.operator.id)).toMatchObject({
        active: true,
        role: "founder",
      });
      await expect(auth.authenticate(signedIn.token, now)).resolves.toHaveProperty("operator");
    },
  );
  it("rejects offline reset to readonly when a legacy local founder is the only other founder", async () => {
    const { platform, config, provisioned, login, auth, now } = await fixture();
    await provisionLegacyFounder(platform);
    const signedIn = await login();
    const credential = await platform.getOperatorPasswordCredential("admin.test");
    await expect(
      provisionPasswordOperator(platform, config, {
        username: "admin.test",
        password: `${password}-reset`,
        name: "Would strand password console",
        role: "readonly",
        reset: true,
      }),
    ).rejects.toMatchObject({ code: "LAST_FOUNDER" });
    expect(await platform.getOperatorPasswordCredential("admin.test")).toEqual(credential);
    expect(await platform.getOperator(provisioned.operator.id)).toMatchObject({
      active: true,
      role: "founder",
    });
    await expect(auth.authenticate(signedIn.token, now)).resolves.toHaveProperty("operator");
    expect(
      (await platform.listAuditEvents()).filter(
        (event) => event.action === "operator.credentials.reset",
      ),
    ).toHaveLength(0);
  });
  it.each([
    { role: "readonly", active: true },
    { role: "founder", active: false },
  ] as const)(
    "permits an API founder update when another password founder has credentials (%j)",
    async (change) => {
      const { platform, config, provisioned, login, auth, now } = await fixture();
      await provisionLegacyFounder(platform);
      await provisionPasswordOperator(platform, config, {
        username: "second.admin",
        password,
        name: "Second password founder",
        role: "founder",
      });
      const signedIn = await login();
      await expect(
        new OperatorService(platform).command(
          await auth.authenticate(signedIn.token, now),
          {
            action: "operators.update",
            operatorId: provisioned.operator.id,
            ...change,
            reason: "Second password founder preserves access",
            idempotencyKey: randomUUID(),
          },
          "same-issuer-founder",
        ),
      ).resolves.toMatchObject({ ...change });
      expect(await platform.getOperator(provisioned.operator.id)).toMatchObject(change);
      await expect(auth.authenticate(signedIn.token, now)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    },
  );
  it("permits an offline credential reset to readonly with a second password founder", async () => {
    const { platform, config, provisioned } = await fixture();
    await provisionLegacyFounder(platform);
    await provisionPasswordOperator(platform, config, {
      username: "second.admin",
      password,
      name: "Second password founder",
      role: "founder",
    });
    const reset = await provisionPasswordOperator(platform, config, {
      username: "admin.test",
      password: `${password}-reset`,
      name: "Reset reader",
      role: "readonly",
      reset: true,
    });
    expect(reset.operator).toMatchObject({
      id: provisioned.operator.id,
      role: "readonly",
      active: true,
    });
    expect((await platform.getOperatorPasswordCredential("admin.test"))?.revision).toBe(2);
  });
  it.each([
    { role: "readonly", active: true },
    { role: "founder", active: false },
  ] as const)(
    "does not count a password founder promoted through Staff without enrollment (%j)",
    async (change) => {
      const { platform, provisioned, login, auth, now } = await fixture();
      const ghost = await platform.provisionOperator({
        issuer: PASSWORD_OPERATOR_ISSUER,
        subject: "unenrolled.admin",
        name: "Unenrolled staff identity",
        role: "readonly",
        active: true,
        capabilities: [],
      });
      const context = await auth.authenticate((await login()).token, now);
      const service = new OperatorService(platform);
      await service.command(
        context,
        {
          action: "operators.update",
          operatorId: ghost.id,
          role: "founder",
          active: true,
          reason: "Promote existing staff identity without enrollment",
          idempotencyKey: randomUUID(),
        },
        "promote-unenrolled",
      );
      expect(await platform.getOperatorPasswordCredential(ghost.subject)).toBeNull();
      await expect(
        service.command(
          context,
          {
            action: "operators.update",
            operatorId: provisioned.operator.id,
            ...change,
            reason: "Unenrolled founder cannot preserve console access",
            idempotencyKey: randomUUID(),
          },
          "unenrolled-cannot-replace",
        ),
      ).rejects.toMatchObject({ status: 409, code: "LAST_FOUNDER" });
      expect(await platform.getOperator(provisioned.operator.id)).toMatchObject({
        role: "founder",
        active: true,
      });
    },
  );
  it("rejects an offline readonly reset when the other password founder has no credentials", async () => {
    const { platform, config, provisioned, login, auth, now } = await fixture();
    await platform.provisionOperator({
      issuer: PASSWORD_OPERATOR_ISSUER,
      subject: "unenrolled.admin",
      name: "Unenrolled founder",
      role: "founder",
      active: true,
      capabilities: [],
    });
    const signedIn = await login();
    const credential = await platform.getOperatorPasswordCredential("admin.test");
    await expect(
      provisionPasswordOperator(platform, config, {
        username: "admin.test",
        password: `${password}-reset`,
        name: "Would strand console",
        role: "readonly",
        reset: true,
      }),
    ).rejects.toMatchObject({ code: "LAST_FOUNDER" });
    expect(await platform.getOperatorPasswordCredential("admin.test")).toEqual(credential);
    expect(await platform.getOperator(provisioned.operator.id)).toMatchObject({
      role: "founder",
      active: true,
    });
    await expect(auth.authenticate(signedIn.token, now)).resolves.toHaveProperty("operator");
  });
  it("generates independent authenticator seeds", () => {
    const first = generateOperatorTotpSecret();
    expect(first).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateOperatorTotpSecret()).not.toBe(first);
  });
});
