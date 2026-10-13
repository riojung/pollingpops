import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import * as oidc from "openid-client";
import type { PlatformOperator, PlatformOperatorSession, PlatformRepository } from "@openround/db";
import { isLocalControlDevelopment, type ControlConfig } from "./config.js";

export const OPERATOR_SESSION_COOKIE = "__Host-pollingpops-operator";
export const OPERATOR_BINDING_COOKIE = "__Host-pollingpops-operator-login";
export const LOCAL_OPERATOR_ISSUER = "urn:pollingpops:local-development";
export const LOCAL_OPERATOR_SUBJECT = "local-admin";
export const LOCAL_OPERATOR_NAME = "Local admin";
export const operatorSessionLifetimeMs = 8 * 60 * 60_000;
export const operatorIdleLifetimeMs = 30 * 60_000;
export function operatorCookieNames(config: Pick<ControlConfig, "CONTROL_PUBLIC_ORIGIN">) {
  const secure = new URL(config.CONTROL_PUBLIC_ORIGIN!).protocol === "https:";
  return {
    secure,
    session: secure ? OPERATOR_SESSION_COOKIE : "pollingpops-operator-local",
    binding: secure ? OPERATOR_BINDING_COOKIE : "pollingpops-operator-login-local",
    csrf: secure ? "__Host-pollingpops-operator-csrf" : "pollingpops-operator-csrf-local",
  };
}
export function operatorSessionCookieOptions(config: Pick<ControlConfig, "CONTROL_PUBLIC_ORIGIN">) {
  return {
    path: "/",
    httpOnly: true,
    secure: operatorCookieNames(config).secure,
    sameSite: "lax" as const,
    maxAge: operatorSessionLifetimeMs / 1_000,
  };
}
export function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function secretEqual(left: string, right: string): boolean {
  const first = Buffer.from(tokenHash(left));
  const second = Buffer.from(tokenHash(right));
  return timingSafeEqual(first, second);
}
export class OperatorError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OperatorError";
  }
}
export interface OperatorClaims {
  issuer: string;
  subject: string;
  authenticatedAt: number;
  amr: string[];
  acr: string | null;
}
export interface OperatorOidcProvider {
  authorizationUrl(input: { state: string; nonce: string; codeVerifier: string }): Promise<string>;
  exchange(input: {
    currentUrl: URL;
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<OperatorClaims>;
}
export class ManagedOperatorOidcProvider implements OperatorOidcProvider {
  private discovered: Promise<oidc.Configuration> | null = null;
  private readonly callback: string;
  constructor(private readonly config: ControlConfig) {
    this.callback = new URL("/auth/callback", config.CONTROL_PUBLIC_ORIGIN!).href;
  }
  private configuration() {
    if (!this.discovered)
      this.discovered = oidc.discovery(
        new URL(this.config.OPERATOR_OIDC_ISSUER!),
        this.config.OPERATOR_OIDC_CLIENT_ID!,
        {
          client_secret: this.config.OPERATOR_OIDC_CLIENT_SECRET,
          redirect_uris: [this.callback],
          response_types: ["code"],
        },
        oidc.ClientSecretBasic(this.config.OPERATOR_OIDC_CLIENT_SECRET),
        {
          timeout: 10,
          ...(this.config.CONTROL_ALLOW_LOCAL_HTTP && this.config.NODE_ENV !== "production"
            ? { execute: [oidc.allowInsecureRequests] }
            : {}),
        },
      );
    return this.discovered;
  }
  async authorizationUrl(input: { state: string; nonce: string; codeVerifier: string }) {
    const configuration = await this.configuration();
    return oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.callback,
      response_type: "code",
      scope: "openid",
      state: input.state,
      nonce: input.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(input.codeVerifier),
      code_challenge_method: "S256",
      max_age: "300",
      ...(this.config.OPERATOR_OIDC_ALLOWED_ACR.length
        ? { acr_values: this.config.OPERATOR_OIDC_ALLOWED_ACR.join(" ") }
        : {}),
    }).href;
  }
  async exchange(input: {
    currentUrl: URL;
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<OperatorClaims> {
    const tokens = await oidc.authorizationCodeGrant(await this.configuration(), input.currentUrl, {
      pkceCodeVerifier: input.codeVerifier,
      expectedState: input.state,
      expectedNonce: input.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.iss || !claims.sub || typeof claims.auth_time !== "number")
      throw new OperatorError(401, "OIDC_INVALID", "Provider authentication could not be verified");
    return {
      issuer: claims.iss,
      subject: claims.sub,
      authenticatedAt: claims.auth_time,
      amr: Array.isArray(claims.amr)
        ? claims.amr.filter((value): value is string => typeof value === "string")
        : [],
      acr: typeof claims.acr === "string" ? claims.acr : null,
    };
  }
}

export function verifyOperatorAssurance(
  config: ControlConfig,
  claims: OperatorClaims,
  now = new Date(),
): void {
  const age = now.getTime() / 1_000 - claims.authenticatedAt;
  if (
    claims.issuer !== config.OPERATOR_OIDC_ISSUER ||
    !claims.subject ||
    !Number.isFinite(claims.authenticatedAt) ||
    age < -60 ||
    age > 300
  )
    throw new OperatorError(401, "OIDC_INVALID", "Fresh operator authentication is required");
  if (
    !config.OPERATOR_OIDC_MFA_POLICY_ENFORCED ||
    !config.OPERATOR_OIDC_REQUIRED_AMR.every((method) => claims.amr.includes(method)) ||
    (config.OPERATOR_OIDC_ALLOWED_ACR.length > 0 &&
      (!claims.acr || !config.OPERATOR_OIDC_ALLOWED_ACR.includes(claims.acr)))
  )
    throw new OperatorError(
      403,
      "MFA_REQUIRED",
      "The provider did not verify the required operator MFA assurance",
    );
}

export type OperatorContext = {
  operator: PlatformOperator;
  session: PlatformOperatorSession;
  tokenHash: string;
};
export class OperatorAuthService {
  constructor(
    private readonly platform: PlatformRepository,
    private readonly config: ControlConfig,
    private readonly provider: OperatorOidcProvider,
  ) {}
  async provisionConfiguredOperators() {
    if (this.config.CONTROL_AUTH_MODE !== "oidc") return;
    for (const identity of this.config.OPERATOR_BOOTSTRAP_IDENTITIES) {
      // Configuration inserts initial operators; a restart cannot reactivate a revoked identity.
      await this.platform.withOperatorTransaction(async (repository) => {
        if (await repository.getOperatorByIdentity(identity.issuer, identity.subject)) return;
        await repository.provisionOperator({
          issuer: identity.issuer,
          subject: identity.subject,
          name: identity.displayName,
          role: identity.role,
          capabilities: [],
          active: true,
        });
      });
    }
  }
  async localLogin(requestId: string, now = new Date()) {
    if (!isLocalControlDevelopment(this.config))
      throw new OperatorError(404, "LOCAL_AUTH_DISABLED", "Local operator sign-in is unavailable");
    return this.platform.withOperatorTransaction(async (repository) => {
      const operator =
        (await repository.getOperatorByIdentity(LOCAL_OPERATOR_ISSUER, LOCAL_OPERATOR_SUBJECT)) ??
        (await repository.provisionOperator({
          issuer: LOCAL_OPERATOR_ISSUER,
          subject: LOCAL_OPERATOR_SUBJECT,
          name: LOCAL_OPERATOR_NAME,
          role: "founder",
          capabilities: [],
          active: true,
        }));
      if (!operator.active)
        throw new OperatorError(
          403,
          "OPERATOR_NOT_PROVISIONED",
          "The local administrator has no active operator access",
        );
      const token = randomBytes(32).toString("base64url");
      const csrfToken = randomBytes(32).toString("base64url");
      const session: PlatformOperatorSession = {
        id: randomUUID(),
        operatorId: operator.id,
        tokenHash: tokenHash(token),
        csrfHash: tokenHash(csrfToken),
        authenticatedAt: now,
        lastSeenAt: now,
        createdAt: now,
        expiresAt: new Date(now.getTime() + operatorSessionLifetimeMs),
        revokedAt: null,
      };
      await repository.createOperatorSession(session);
      await repository.appendAuditEvent({
        actorId: operator.id,
        organizationId: null,
        action: "operator.login",
        targetId: session.id,
        reason: "Explicit local development administrator sign-in",
        requestId,
        before: null,
        after: { role: operator.role, authMode: "local" },
      });
      return { token, csrfToken, operator };
    });
  }
  async start(now = new Date()) {
    if (!this.config.CONTROL_ENABLED)
      throw new OperatorError(404, "CONTROL_DISABLED", "Operator control is disabled");
    if (this.config.CONTROL_AUTH_MODE !== "oidc")
      throw new OperatorError(404, "OIDC_DISABLED", "Managed operator sign-in is unavailable");
    const state = oidc.randomState();
    const binding = randomBytes(32).toString("base64url");
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const authorizationUrl = await this.provider.authorizationUrl({ state, nonce, codeVerifier });
    await this.platform.createOperatorOidcTransaction({
      stateHash: tokenHash(state),
      browserBindingHash: tokenHash(binding),
      codeVerifier,
      nonce,
      expiresAt: new Date(now.getTime() + 300_000),
      consumedAt: null,
      returnTo: "/",
    });
    return { authorizationUrl, binding };
  }
  async callback(
    currentUrl: URL,
    state: string,
    binding: string,
    requestId: string,
    now = new Date(),
  ) {
    if (!this.config.CONTROL_ENABLED || this.config.CONTROL_AUTH_MODE !== "oidc")
      throw new OperatorError(404, "OIDC_DISABLED", "Managed operator sign-in is unavailable");
    const transaction = await this.platform.consumeOperatorOidcTransaction(
      tokenHash(state),
      tokenHash(binding),
      now,
    );
    if (!transaction)
      throw new OperatorError(
        401,
        "OIDC_REPLAY",
        "This operator login is expired, invalid, or already used",
      );
    const claims = await this.provider.exchange({
      currentUrl,
      state,
      nonce: transaction.nonce,
      codeVerifier: transaction.codeVerifier,
    });
    verifyOperatorAssurance(this.config, claims, now);
    const operator = await this.platform.getOperatorByIdentity(claims.issuer, claims.subject);
    if (!operator?.active)
      throw new OperatorError(
        403,
        "OPERATOR_NOT_PROVISIONED",
        "This identity has no active operator access",
      );
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const session: PlatformOperatorSession = {
      id: randomUUID(),
      operatorId: operator.id,
      tokenHash: tokenHash(token),
      csrfHash: tokenHash(csrfToken),
      authenticatedAt: new Date(claims.authenticatedAt * 1_000),
      lastSeenAt: now,
      createdAt: now,
      expiresAt: new Date(now.getTime() + operatorSessionLifetimeMs),
      revokedAt: null,
    };
    await this.platform.withOperatorTransaction(async (repository) => {
      await repository.createOperatorSession(session);
      await repository.appendAuditEvent({
        actorId: operator.id,
        organizationId: null,
        action: "operator.login",
        targetId: session.id,
        reason: "MFA verified operator login",
        requestId,
        before: null,
        after: { role: operator.role },
      });
    });
    return { token, csrfToken, operator };
  }
  async authenticate(token: string | undefined, now = new Date()): Promise<OperatorContext> {
    const local = isLocalControlDevelopment(this.config);
    if (
      !this.config.CONTROL_ENABLED ||
      !token ||
      token.length > 256 ||
      (this.config.CONTROL_AUTH_MODE === "local" && !local)
    )
      throw new OperatorError(401, "UNAUTHORIZED", "Operator sign-in required");
    const hash = tokenHash(token);
    const context = await this.platform.touchOperatorSession(
      hash,
      now,
      new Date(now.getTime() - operatorIdleLifetimeMs),
    );
    if (
      !context ||
      !context.operator.active ||
      context.session.revokedAt ||
      context.session.expiresAt <= now ||
      !context.session.authenticatedAt ||
      (local
        ? context.operator.issuer !== LOCAL_OPERATOR_ISSUER ||
          context.operator.subject !== LOCAL_OPERATOR_SUBJECT
        : context.operator.issuer === LOCAL_OPERATOR_ISSUER)
    )
      throw new OperatorError(401, "UNAUTHORIZED", "Operator sign-in required");
    return { ...context, tokenHash: hash };
  }
  async logout(context: OperatorContext, requestId: string) {
    await this.platform.withOperatorTransaction(async (repository) => {
      await repository.revokeOperatorSession(context.tokenHash);
      await repository.appendAuditEvent({
        actorId: context.operator.id,
        organizationId: null,
        action: "operator.logout",
        targetId: context.session.id,
        reason: "Operator ended session",
        requestId,
        before: null,
        after: null,
      });
    });
  }
}

export function verifyMutationRequest(
  context: OperatorContext,
  origin: string | null,
  csrf: string | null,
  config: ControlConfig,
) {
  if (
    origin !== config.CONTROL_PUBLIC_ORIGIN ||
    !csrf ||
    !context.session.csrfHash ||
    !secretEqual(tokenHash(csrf), context.session.csrfHash)
  )
    throw new OperatorError(
      403,
      "ORIGIN_REJECTED",
      "Same-origin operator request verification failed",
    );
}
export function requireFreshOperator(context: OperatorContext, now = new Date()) {
  if (
    !context.session.authenticatedAt ||
    now.getTime() - context.session.authenticatedAt.getTime() > 300_000
  )
    throw new OperatorError(
      403,
      "REAUTHENTICATION_REQUIRED",
      "Sign in again before this sensitive operation",
    );
}
