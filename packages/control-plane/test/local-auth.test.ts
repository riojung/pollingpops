import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MemoryRepository, createPlatformRepository, type PlatformRepository } from "@openround/db";
import { loadControlConfig } from "../src/config.js";
import {
  LOCAL_OPERATOR_ISSUER,
  LOCAL_OPERATOR_SUBJECT,
  OperatorAuthService,
  operatorSessionLifetimeMs,
  tokenHash,
  verifyMutationRequest,
} from "../src/auth.js";
import { OperatorService, operatorCapabilities } from "../src/operator-service.js";

const localConfig = () =>
  loadControlConfig({
    NODE_ENV: "production",
    CONTROL_ENABLED: "true",
    CONTROL_AUTH_MODE: "local",
    CONTROL_LOCAL_DEVELOPMENT: "true",
    OPENROUND_DEPLOYMENT_ENVIRONMENT: "development",
    CONTROL_PUBLIC_ORIGIN: "http://localhost:3002",
    CONTROL_PRODUCT_ORIGIN: "http://localhost:8080",
    CONTROL_DATABASE_URL: "postgresql://openround_app@postgres/openround",
  });
const managedConfig = () =>
  loadControlConfig({
    NODE_ENV: "production",
    CONTROL_ENABLED: "true",
    CONTROL_PUBLIC_ORIGIN: "https://control.example.test",
    OPENROUND_DEPLOYMENT_ENVIRONMENT: "production",
    CONTROL_DATABASE_URL: "postgresql://runtime@postgres/openround",
    OPERATOR_OIDC_ISSUER: "https://identity.example.test",
    OPERATOR_OIDC_CLIENT_ID: "operator",
    OPERATOR_OIDC_CLIENT_SECRET: "synthetic-secret",
    OPERATOR_OIDC_MFA_POLICY_ENFORCED: "true",
    OPERATOR_OIDC_REQUIRED_AMR: "mfa",
  });
async function fixture() {
  const repository = new MemoryRepository();
  const now = new Date();
  const magic = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email: "local-owner@example.test",
    segment: "workplace",
    tokenHash: magic,
    policyVersion: "test",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const creator = (await repository.consumeMagicToken(magic, now))!;
  const platform = createPlatformRepository(repository);
  const organization = (await platform.getOrganizationForWorkspace(creator.workspaceId))!;
  const provider = { authorizationUrl: vi.fn(), exchange: vi.fn() };
  const auth = new OperatorAuthService(platform, localConfig(), provider);
  return { platform, organization, provider, auth };
}

describe("durable local development administrator", () => {
  it("signs in with founder capabilities, hashed revocable credentials and attributable local audit without an IdP", async () => {
    const { platform, provider, auth } = await fixture();
    const now = new Date();
    await auth.provisionConfiguredOperators();
    const result = await auth.localLogin("local-login-request", now);
    expect(result.operator).toMatchObject({
      issuer: LOCAL_OPERATOR_ISSUER,
      subject: LOCAL_OPERATOR_SUBJECT,
      name: "Local admin",
      role: "founder",
      active: true,
    });
    expect(operatorCapabilities(result.operator)).toContain("credits.write");
    const durable = await platform.getOperatorSession(tokenHash(result.token), now);
    expect(durable?.session).toMatchObject({
      csrfHash: tokenHash(result.csrfToken),
      tokenHash: tokenHash(result.token),
      authenticatedAt: now,
      expiresAt: new Date(now.getTime() + operatorSessionLifetimeMs),
    });
    expect(JSON.stringify(durable)).not.toContain(result.token);
    expect(JSON.stringify(durable)).not.toContain(result.csrfToken);
    const context = await auth.authenticate(result.token, now);
    expect(() =>
      verifyMutationRequest(context, "http://localhost:3002", result.csrfToken, localConfig()),
    ).not.toThrow();
    expect(() =>
      verifyMutationRequest(context, "http://localhost:8080", result.csrfToken, localConfig()),
    ).toThrow();
    expect(await platform.listAuditEvents()).toMatchObject([
      {
        actorId: result.operator.id,
        action: "operator.login",
        requestId: "local-login-request",
        targetId: context.session.id,
        after: { role: "founder", authMode: "local" },
      },
    ]);
    await expect(auth.start()).rejects.toMatchObject({ code: "OIDC_DISABLED" });
    await expect(
      auth.callback(new URL("http://localhost:3002/auth/callback"), "state", "binding", "request"),
    ).rejects.toMatchObject({ code: "OIDC_DISABLED" });
    expect(provider.authorizationUrl).not.toHaveBeenCalled();
    expect(provider.exchange).not.toHaveBeenCalled();
  });
  it("serializes concurrent first logins into one durable operator and distinct audited sessions", async () => {
    const { platform, auth } = await fixture();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => auth.localLogin(`request-${index}`)),
    );
    expect(await platform.listOperators()).toHaveLength(1);
    expect(new Set(results.map((result) => result.operator.id)).size).toBe(1);
    expect(new Set(results.map((result) => result.token)).size).toBe(8);
    expect(await platform.listAuditEvents()).toHaveLength(8);
    for (const result of results)
      expect((await auth.authenticate(result.token)).operator.id).toBe(result.operator.id);
  });
  it("can issue an audited credit grant using the real founder command transaction", async () => {
    const { platform, organization, auth } = await fixture();
    const result = await auth.localLogin("login");
    const context = await auth.authenticate(result.token);
    await new OperatorService(platform).command(
      context,
      {
        action: "credits.grant",
        organizationId: organization.id,
        quantity: 3,
        reason: "Local development event credit rehearsal",
        idempotencyKey: randomUUID(),
      },
      "grant",
    );
    expect(await platform.getCreditBalance(organization.id)).toMatchObject({ balance: 3 });
    expect((await platform.listAuditEvents()).map((event) => event.action)).toContain(
      "credits.grant",
    );
  });
  it("honors logout and operator revocation without recreating or reactivating the local identity", async () => {
    const { platform, auth } = await fixture();
    const result = await auth.localLogin("first");
    await auth.logout(await auth.authenticate(result.token), "logout");
    await expect(auth.authenticate(result.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const next = await auth.localLogin("next");
    expect(next.operator.id).toBe(result.operator.id);
    await platform.provisionOperator({
      issuer: "https://identity.example.test",
      subject: "other-founder",
      name: "Managed founder",
      role: "founder",
      capabilities: [],
      active: true,
    });
    await platform.provisionOperator({ ...next.operator, active: false });
    await expect(auth.authenticate(next.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(auth.localLogin("disabled")).rejects.toMatchObject({
      code: "OPERATOR_NOT_PROVISIONED",
    });
    expect((await platform.getOperator(next.operator.id))?.active).toBe(false);
    expect(
      (await platform.listAuditEvents()).filter((event) => event.action === "operator.login"),
    ).toHaveLength(2);
  });
  it("preserves a deliberately changed local role rather than elevating it at the next login", async () => {
    const { platform, auth } = await fixture();
    const result = await auth.localLogin("first");
    await platform.provisionOperator({
      issuer: "https://identity.example.test",
      subject: "other-founder",
      name: "Managed founder",
      role: "founder",
      capabilities: [],
      active: true,
    });
    await platform.provisionOperator({ ...result.operator, role: "readonly" });
    const next = await auth.localLogin("reader");
    expect(next.operator.role).toBe("readonly");
    expect(operatorCapabilities(next.operator)).not.toContain("credits.write");
  });
  it("rejects local sessions when switching to managed/hosted configuration on the same database", async () => {
    const { platform, auth, provider } = await fixture();
    const result = await auth.localLogin("local");
    const managed = new OperatorAuthService(platform, managedConfig(), provider);
    await expect(managed.authenticate(result.token)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(managed.localLogin("hosted")).rejects.toMatchObject({
      code: "LOCAL_AUTH_DISABLED",
    });
    const unsafe = new OperatorAuthService(
      platform,
      { ...localConfig(), OPENROUND_DEPLOYMENT_ENVIRONMENT: "staging" },
      provider,
    );
    await expect(unsafe.authenticate(result.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(unsafe.localLogin("staging")).rejects.toMatchObject({
      code: "LOCAL_AUTH_DISABLED",
    });
  });
  it("does not accept managed sessions in local mode", async () => {
    const { platform, auth } = await fixture();
    const operator = await platform.provisionOperator({
      issuer: "https://identity.example.test",
      subject: "managed",
      name: "Managed founder",
      role: "founder",
      capabilities: [],
      active: true,
    });
    const now = new Date();
    await platform.createOperatorSession({
      id: randomUUID(),
      operatorId: operator.id,
      tokenHash: tokenHash("managed-token"),
      csrfHash: tokenHash("managed-csrf"),
      authenticatedAt: now,
      lastSeenAt: now,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
    });
    await expect(auth.authenticate("managed-token")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
  it("rolls back operator and session provisioning if attributable audit cannot commit", async () => {
    const { platform, provider } = await fixture();
    const failing = new Proxy(platform, {
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
    await expect(
      new OperatorAuthService(failing, localConfig(), provider).localLogin("rollback"),
    ).rejects.toThrow("audit unavailable");
    expect(await platform.listOperators()).toHaveLength(0);
    expect(await platform.listAuditEvents()).toHaveLength(0);
  });
});
