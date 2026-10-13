import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { LocalReturnPathSchema } from "@openround/contracts";
import type { CreatorContext, Repository, Segment, UserPrincipal } from "@openround/db";
import { isLocalProductAdminDevelopment, type AppConfig } from "./config.js";
import type { Mailer } from "./mailer.js";
import { hashToken, opaqueToken } from "./security.js";
import { LocalProductOperatorAuth } from "./local-operator-auth.js";

export class AuthService {
  private readonly localOperator;
  constructor(
    private readonly repository: Repository,
    private readonly mailer: Mailer,
    private readonly config: AppConfig,
  ) {
    this.localOperator = isLocalProductAdminDevelopment(config)
      ? new LocalProductOperatorAuth(repository, config)
      : null;
  }

  private async effectiveCreator(creator: CreatorContext): Promise<CreatorContext> {
    if (this.config.COMMUNITY_MODE) return { ...creator, plan: "team" };
    return this.config.BUSINESS_PLATFORM_ENABLED
      ? { ...creator, plan: await this.repository.getPlan(creator.workspaceId) }
      : creator;
  }

  async requestMagicLink(email: string, segment: Segment, returnTo?: string) {
    const token = opaqueToken();
    await this.repository.createMagicToken({
      id: randomUUID(),
      email,
      segment,
      tokenHash: hashToken(token),
      policyVersion: this.config.POLICY_VERSION,
      expiresAt: new Date(Date.now() + 15 * 60_000),
      consumedAt: null,
    });
    const verifyUrl = new URL(
      "/v1/auth/verify",
      this.localOperator?.isAdminEmail(email)
        ? this.localOperator.verificationApiOrigin()
        : this.config.PUBLIC_API_URL,
    );
    verifyUrl.searchParams.set("token", token);
    if (returnTo) verifyUrl.searchParams.set("returnTo", returnTo);
    await this.mailer.sendMagicLink(email, verifyUrl.href);
    return this.config.NODE_ENV !== "production" || this.config.AUTH_DEBUG_MAGIC_LINKS
      ? verifyUrl.href
      : undefined;
  }

  async verifyMagicLink(token: string) {
    const identity = await this.repository.consumeMagicLinkIdentity(hashToken(token), new Date());
    if (!identity) return null;
    if (identity.creator) return this.issueCreatorSession(identity.creator);
    const sessionToken = await this.issueIdentitySession(identity.user);
    return { user: identity.user, creator: null, sessionToken };
  }

  private async issueIdentitySession(user: UserPrincipal, activeWorkspaceId?: string) {
    const sessionToken = opaqueToken();
    await this.repository.createCreatorSession({
      id: randomUUID(),
      userId: user.userId,
      tokenHash: hashToken(sessionToken),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
      ...(activeWorkspaceId ? { activeWorkspaceId } : {}),
    });
    return sessionToken;
  }

  async issueCreatorSession(creator: CreatorContext) {
    const sessionToken = await this.issueIdentitySession(creator, creator.workspaceId);
    return { creator: await this.effectiveCreator(creator), sessionToken };
  }

  async inviteWorkspace(creator: CreatorContext, email: string, role: "editor" | "viewer") {
    const token = opaqueToken();
    const invitation = await this.repository.createWorkspaceInvitation({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      email,
      role,
      tokenHash: hashToken(token),
      invitedBy: creator.userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    });
    const acceptUrl = `${this.config.WEB_ORIGIN}/invite?token=${encodeURIComponent(token)}`;
    try {
      await this.mailer.sendWorkspaceInvitation(email, acceptUrl);
    } catch (error) {
      await this.repository.revokeWorkspaceInvitation(creator.workspaceId, invitation.id);
      throw error;
    }
    return {
      invitation,
      debugUrl:
        this.config.NODE_ENV !== "production" || this.config.AUTH_DEBUG_MAGIC_LINKS
          ? acceptUrl
          : undefined,
    };
  }

  async sendOrganizationInvitation(email: string, inviteUrl: string) {
    const send = this.mailer.sendOrganizationInvitation ?? this.mailer.sendWorkspaceInvitation;
    await send.call(this.mailer, email, inviteUrl);
  }

  async acceptWorkspaceInvitation(token: string) {
    const creator = await this.repository.acceptWorkspaceInvitation(
      hashToken(token),
      new Date(),
      this.config.POLICY_VERSION,
    );
    if (!creator) return null;
    return this.issueCreatorSession(creator);
  }

  async switchWorkspace(request: FastifyRequest, creator: CreatorContext, workspaceId: string) {
    const token = request.cookies[this.config.COOKIE_NAME];
    if (!token) return false;
    return this.repository.setCreatorSessionWorkspace(
      hashToken(token),
      creator.userId,
      workspaceId,
    );
  }

  setSessionCookie(reply: FastifyReply, token: string) {
    reply.setCookie(this.config.COOKIE_NAME, token, this.sessionCookieOptions());
  }

  async setAuthenticatedSession(
    request: FastifyRequest,
    reply: FastifyReply,
    token: string,
    verifiedMagicLinkEmail?: string,
  ) {
    this.setSessionCookie(reply, token);
    return (
      (await this.localOperator?.completeLogin(request, reply, verifiedMagicLinkEmail)) ?? true
    );
  }

  localAdminSignInOrigin(request: FastifyRequest, email: string) {
    return this.localOperator?.signInOrigin(request, email);
  }

  async operatorConsoleOrigin(request: FastifyRequest, user: UserPrincipal | null) {
    if (this.config.CONTROL_AUTH_MODE === "local")
      return this.localOperator?.consoleOrigin(request, user) ?? null;
    return this.config.CONTROL_PUBLIC_ORIGIN
      ? new URL(this.config.CONTROL_PUBLIC_ORIGIN).origin
      : null;
  }

  localeAwareWebRedirect(creator: UserPrincipal, returnTo: string) {
    const webOrigin = new URL(
      this.localOperator?.isAdminEmail(creator.email)
        ? this.config.CONTROL_PRODUCT_ORIGIN!
        : this.config.WEB_ORIGIN,
    );
    const localReturnTo = LocalReturnPathSchema.safeParse(returnTo);
    let destination: URL;
    try {
      destination = new URL(localReturnTo.success ? localReturnTo.data : "/dashboard", webOrigin);
    } catch {
      destination = new URL("/dashboard", webOrigin);
    }
    if (destination.origin !== webOrigin.origin) destination = new URL("/dashboard", webOrigin);
    if (!creator.localePreferenceSet) return destination.href;

    const bridge = new URL("/auth/locale", webOrigin);
    bridge.searchParams.set("locale", creator.locale);
    bridge.searchParams.set(
      "returnTo",
      `${destination.pathname}${destination.search}${destination.hash}`,
    );
    return bridge.href;
  }

  private sessionCookieOptions() {
    return {
      path: "/",
      domain: this.config.COOKIE_DOMAIN,
      httpOnly: true,
      secure:
        this.config.COOKIE_SECURE === "true" ||
        (this.config.COOKIE_SECURE === "auto" && this.config.NODE_ENV === "production"),
      sameSite: "lax" as const,
      maxAge: 30 * 24 * 60 * 60,
    };
  }

  clearSessionCookie(reply: FastifyReply) {
    reply.clearCookie(this.config.COOKIE_NAME, {
      path: "/",
      domain: this.config.COOKIE_DOMAIN,
    });
  }

  async creatorFromRequest(request: FastifyRequest): Promise<CreatorContext | null> {
    const token = request.cookies[this.config.COOKIE_NAME];
    const creator = token
      ? await this.repository.getCreatorBySession(hashToken(token), new Date())
      : null;
    return creator ? this.effectiveCreator(creator) : null;
  }

  async requireCreator(request: FastifyRequest, reply: FastifyReply) {
    const creator = await this.creatorFromRequest(request);
    if (!creator) {
      await reply.code(401).send({
        error: { code: "UNAUTHORIZED", message: "Sign in required", requestId: request.id },
      });
      return null;
    }
    return creator;
  }

  async requireUser(request: FastifyRequest, reply: FastifyReply) {
    const user = await this.userFromRequest(request);
    if (!user) {
      await reply.code(401).send({
        error: { code: "UNAUTHORIZED", message: "Sign in required", requestId: request.id },
      });
    }
    return user;
  }

  async userFromRequest(request: FastifyRequest): Promise<UserPrincipal | null> {
    const token = request.cookies[this.config.COOKIE_NAME];
    return token
      ? await this.repository.getUserPrincipalBySession(hashToken(token), new Date())
      : null;
  }

  async logout(request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies[this.config.COOKIE_NAME];
    if (token) await this.repository.revokeCreatorSession(hashToken(token));
    this.clearSessionCookie(reply);
    return (await this.localOperator?.endSession(request, reply, true)) ?? true;
  }
}
