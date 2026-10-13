import { describe, expect, it, vi } from "vitest";
import type { PlatformRepository } from "@openround/db";
import { loadControlConfig } from "../src/config.js";
import {
  OperatorAuthService,
  verifyOperatorAssurance,
  verifyMutationRequest,
  tokenHash,
  type OperatorContext,
} from "../src/auth.js";
import {
  operatorCapabilities,
  OperatorService,
  exportCreditLedgerCsv,
} from "../src/operator-service.js";

const configuration = () =>
  loadControlConfig({
    NODE_ENV: "test",
    CONTROL_ENABLED: "true",
    CONTROL_PUBLIC_ORIGIN: "https://control.example.org",
    CONTROL_DATABASE_URL: "postgresql://runtime@db/control",
    OPERATOR_OIDC_ISSUER: "https://identity.example.org",
    OPERATOR_OIDC_CLIENT_ID: "operator",
    OPERATOR_OIDC_CLIENT_SECRET: "secret",
    OPERATOR_OIDC_MFA_POLICY_ENFORCED: "true",
    OPERATOR_OIDC_REQUIRED_AMR: "mfa",
  });
const now = new Date("2026-10-12T12:00:00Z");
const claims = {
  issuer: "https://identity.example.org",
  subject: "founder-subject",
  authenticatedAt: now.getTime() / 1000,
  amr: ["mfa"],
  acr: null,
};
const context = (role = "founder"): OperatorContext => ({
  operator: {
    id: "f2182e9d-b8cf-4b38-b06f-8292e9e87738",
    issuer: claims.issuer,
    subject: claims.subject,
    name: "Founder",
    role: role as "founder",
    capabilities: [],
    active: true,
    createdAt: now,
    updatedAt: now,
  },
  session: {
    id: "8152e405-ed80-4497-9463-a44b96c401b1",
    operatorId: "f2182e9d-b8cf-4b38-b06f-8292e9e87738",
    tokenHash: "hash",
    csrfHash: tokenHash("csrf"),
    authenticatedAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + 10000),
    createdAt: now,
    revokedAt: null,
  },
  tokenHash: "hash",
});

describe("operator trust boundary", () => {
  it("requires an attested dedicated MFA policy and exact assurance claims", () => {
    expect(() =>
      loadControlConfig({ ...configuration(), CONTROL_ENABLED: "true" } as unknown as Record<
        string,
        string
      >),
    ).toThrow();
    expect(() => verifyOperatorAssurance(configuration(), claims, now)).not.toThrow();
    expect(() => verifyOperatorAssurance(configuration(), { ...claims, amr: [] }, now)).toThrow(
      /MFA/,
    );
    expect(() =>
      verifyOperatorAssurance(
        configuration(),
        { ...claims, issuer: "https://customer-idp.example.org" },
        now,
      ),
    ).toThrow();
    expect(() =>
      verifyOperatorAssurance(
        configuration(),
        { ...claims, authenticatedAt: claims.authenticatedAt - 301 },
        now,
      ),
    ).toThrow();
  });
  it("rejects missing CSRF or a foreign Origin", () => {
    expect(() =>
      verifyMutationRequest(context(), "https://control.example.org", "csrf", configuration()),
    ).not.toThrow();
    expect(() =>
      verifyMutationRequest(context(), "https://evil.example.org", "csrf", configuration()),
    ).toThrow();
    expect(() =>
      verifyMutationRequest(context(), "https://control.example.org", "other", configuration()),
    ).toThrow();
  });
  it("cannot authorize a support operator for billing grants", async () => {
    const repository = { withOperatorTransaction: vi.fn() } as unknown as PlatformRepository;
    expect(operatorCapabilities(context("support").operator)).not.toContain("credits.write");
    await expect(
      new OperatorService(repository).command(
        context("support"),
        {
          action: "credits.grant",
          organizationId: "910a8703-6e76-42cc-951b-1228a81411bf",
          quantity: 1,
          reason: "Support requested credit",
          idempotencyKey: "5a3f94f5-eede-4fcb-867a-3c47930d6df8",
        },
        "request",
      ),
    ).rejects.toThrow(/cannot perform/);
    expect(repository.withOperatorTransaction).not.toHaveBeenCalled();
  });
  it("checks durable revocation for every authenticated request", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce({ session: context().session, operator: context().operator })
      .mockResolvedValueOnce(null);
    const service = new OperatorAuthService(
      { touchOperatorSession: lookup } as unknown as PlatformRepository,
      configuration(),
      {} as never,
    );
    await expect(service.authenticate("opaque-token", now)).resolves.toMatchObject({
      operator: { role: "founder" },
    });
    await expect(service.authenticate("opaque-token", now)).rejects.toThrow(/sign-in required/);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it("does not create a session for an unprovisioned external identity", async () => {
    const create = vi.fn();
    const repository = {
      consumeOperatorOidcTransaction: vi
        .fn()
        .mockResolvedValue({ nonce: "nonce", codeVerifier: "pkce" }),
      getOperatorByIdentity: vi.fn().mockResolvedValue(null),
      createOperatorSession: create,
    } as unknown as PlatformRepository;
    const provider = { authorizationUrl: vi.fn(), exchange: vi.fn().mockResolvedValue(claims) };
    const service = new OperatorAuthService(repository, configuration(), provider);
    await expect(
      service.callback(
        new URL("https://control.example.org/auth/callback"),
        "state",
        "binding",
        "request",
        now,
      ),
    ).rejects.toThrow(/no active operator/);
    expect(repository.consumeOperatorOidcTransaction).toHaveBeenCalledWith(
      tokenHash("state"),
      tokenHash("binding"),
      now,
    );
    expect(create).not.toHaveBeenCalled();
  });
  it("does not reactivate a disabled operator when the process restarts", async () => {
    const config = configuration();
    config.OPERATOR_BOOTSTRAP_IDENTITIES = [
      { issuer: claims.issuer, subject: claims.subject, displayName: "Founder", role: "founder" },
    ];
    const provision = vi.fn();
    const repository = {
      getOperatorByIdentity: vi
        .fn()
        .mockResolvedValue({ ...context().operator, active: false, role: "support" }),
      provisionOperator: provision,
    } as unknown as PlatformRepository;
    repository.withOperatorTransaction = (work) => work(repository);
    const service = new OperatorAuthService(repository, config, {} as never);
    await service.provisionConfiguredOperators();
    await service.provisionConfiguredOperators();
    expect(provision).not.toHaveBeenCalled();
  });
  it("escapes spreadsheet formulas without changing negative numeric deltas", () => {
    const csv = exportCreditLedgerCsv([
      {
        id: "entry",
        organizationId: "org",
        delta: -1,
        reason: '=HYPERLINK("https://invalid")',
        sourceKey: "source",
        createdAt: now,
      },
    ]);
    expect(csv).toContain('"-1"');
    expect(csv).toContain("'=HYPERLINK");
  });
});
