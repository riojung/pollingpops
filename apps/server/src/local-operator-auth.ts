import type { FastifyReply, FastifyRequest } from "fastify";
import { createPlatformRepository, type Repository, type UserPrincipal } from "@openround/db";
import {
  LOCAL_OPERATOR_ISSUER,
  LOCAL_OPERATOR_SUBJECT,
  OperatorAuthService,
  loadControlConfig,
  operatorCookieNames,
  operatorSessionCookieOptions,
  tokenHash,
} from "@openround/control-plane";
import { isLocalProductAdminDevelopment, type AppConfig } from "./config.js";

// Created only after the server's explicit local-development configuration has been validated.
export class LocalProductOperatorAuth {
  private readonly platform;
  private readonly control;
  private readonly auth;
  private readonly names;
  constructor(
    repository: Repository,
    private readonly config: AppConfig,
  ) {
    if (!isLocalProductAdminDevelopment(config))
      throw new Error("Local product operator authentication requires explicit development opt-in");
    this.platform = createPlatformRepository(repository);
    this.control = loadControlConfig({
      NODE_ENV: config.NODE_ENV,
      CONTROL_ENABLED: "true",
      CONTROL_AUTH_MODE: "local",
      CONTROL_LOCAL_DEVELOPMENT: "true",
      OPENROUND_DEPLOYMENT_ENVIRONMENT: config.OPENROUND_DEPLOYMENT_ENVIRONMENT,
      CONTROL_PUBLIC_ORIGIN: config.CONTROL_PUBLIC_ORIGIN,
      CONTROL_PRODUCT_ORIGIN: config.CONTROL_PRODUCT_ORIGIN,
      CONTROL_DATABASE_URL: config.DATABASE_URL ?? "in-memory",
    });
    this.auth = new OperatorAuthService(this.platform, this.control, {
      async authorizationUrl() {
        throw new Error("Managed operator authentication is separate");
      },
      async exchange() {
        throw new Error("Managed operator authentication is separate");
      },
    });
    this.names = operatorCookieNames(this.control);
  }

  isAdminEmail(email: string) {
    return email.trim().toLowerCase() === this.config.LOCAL_ADMIN_EMAIL;
  }

  isLoopbackRequest(request: FastifyRequest) {
    try {
      const product = new URL(this.config.CONTROL_PRODUCT_ORIGIN!);
      const host = new URL(`http://${request.headers.host}`);
      if (
        request.protocol !== "http" ||
        host.hostname !== product.hostname ||
        (host.origin !== product.origin && host.origin !== this.verificationApiOrigin()) ||
        host.username ||
        host.password
      )
        return false;
      const forwardedHost = request.headers["x-forwarded-host"];
      if (
        forwardedHost &&
        (typeof forwardedHost !== "string" || forwardedHost !== request.headers.host)
      )
        return false;
      const forwardedProto = request.headers["x-forwarded-proto"];
      if (forwardedProto && forwardedProto !== "http") return false;
      const origin = request.headers.origin;
      return !origin || origin === product.origin || origin === this.verificationApiOrigin();
    } catch {
      return false;
    }
  }

  verificationApiOrigin() {
    const api = new URL(this.config.PUBLIC_API_URL);
    api.hostname = new URL(this.config.CONTROL_PRODUCT_ORIGIN!).hostname;
    return api.origin;
  }

  signInOrigin(request: FastifyRequest, email: string) {
    return this.isAdminEmail(email) && this.isLoopbackRequest(request)
      ? this.config.CONTROL_PRODUCT_ORIGIN
      : undefined;
  }

  private clearCookies(reply: FastifyReply) {
    const options = operatorSessionCookieOptions(this.control);
    for (const name of [this.names.session, this.names.csrf, this.names.binding])
      reply.clearCookie(name, options);
  }

  async endSession(request: FastifyRequest, reply: FastifyReply, alwaysClear = false) {
    const token = request.cookies[this.names.session];
    let revocationComplete = true;
    if (token && token.length <= 256) {
      try {
        const hash = tokenHash(token);
        // Revocation does not require an active identity: a disabled/demoted operator must
        // not recover a product-logout session if later re-enabled.
        await this.platform.withOperatorTransaction(async (repository) => {
          const context = await repository.getOperatorSession(hash);
          const revoked = await repository.revokeOperatorSession(hash);
          if (
            revoked &&
            context?.operator.issuer === LOCAL_OPERATOR_ISSUER &&
            context.operator.subject === LOCAL_OPERATOR_SUBJECT
          )
            await repository.appendAuditEvent({
              actorId: context.operator.id,
              organizationId: null,
              action: "operator.logout",
              targetId: context.session.id,
              reason: "Product sign-out or account change ended local operator access",
              requestId: request.id,
              before: null,
              after: null,
            });
        });
      } catch (error) {
        revocationComplete = false;
        reply.header("x-local-operator-revocation", "unavailable");
        request.log.warn(
          { errorType: error instanceof Error ? error.name.slice(0, 80) : "unknown" },
          "local operator session revocation unavailable",
        );
      }
    }
    if (
      alwaysClear ||
      token ||
      request.cookies[this.names.csrf] ||
      request.cookies[this.names.binding]
    )
      this.clearCookies(reply);
    return revocationComplete;
  }

  async completeLogin(
    request: FastifyRequest,
    reply: FastifyReply,
    verifiedMagicLinkEmail?: string,
  ) {
    const eligible =
      verifiedMagicLinkEmail !== undefined && this.isAdminEmail(verifiedMagicLinkEmail);
    const revocationComplete = await this.endSession(request, reply, eligible);
    if (!eligible || !this.isLoopbackRequest(request)) return revocationComplete;
    try {
      const session = await this.auth.localLogin(request.id);
      const options = operatorSessionCookieOptions(this.control);
      reply.setCookie(this.names.session, session.token, options);
      reply.setCookie(this.names.csrf, session.csrfToken, options);
    } catch (error) {
      // Product identity remains usable if the separate operator identity is disabled or
      // its durable service is unavailable. No operator credential is issued on failure.
      request.log.warn(
        { errorType: error instanceof Error ? error.name.slice(0, 80) : "unknown" },
        "local operator sign-in unavailable",
      );
    }
    return revocationComplete;
  }

  async consoleOrigin(request: FastifyRequest, user: UserPrincipal | null) {
    if (!user || !this.isAdminEmail(user.email) || !this.isLoopbackRequest(request)) return null;
    try {
      await this.auth.authenticate(request.cookies[this.names.session]);
      return this.control.CONTROL_PUBLIC_ORIGIN!;
    } catch {
      return null;
    }
  }
}
