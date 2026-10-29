import { randomInt, randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { LocalReturnPathSchema } from "@openround/contracts";
import { createPlatformRepository, PlatformError } from "@openround/db";
import type {
  CreatorContext,
  MagicLinkIdentity,
  Repository,
  Segment,
  UserPrincipal,
} from "@openround/db";
import type { AppConfig } from "./config.js";
import type { Mailer } from "./mailer.js";
import { hashToken, opaqueToken } from "./security.js";

export class AuthEmailDeliveryError extends Error {
  constructor() {
    super("We could not send your sign-in PIN. Please try again.");
  }
}

export class AuthService {
  constructor(
    private readonly repository: Repository,
    private readonly mailer: Mailer,
    private readonly config: AppConfig,
  ) {}

  private async effectiveCreator(creator: CreatorContext): Promise<CreatorContext> {
    if (this.config.COMMUNITY_MODE) return { ...creator, plan: "team" };
    const platform = createPlatformRepository(this.repository);
    const organization = await platform.getOrganizationForWorkspace(creator.workspaceId);
    if (
      organization?.licenseUnit === "user" &&
      !(await platform.workspaceHasLicense(creator.workspaceId))
    )
      return { ...creator, role: "viewer", plan: "free" };
    return this.config.BUSINESS_PLATFORM_ENABLED
      ? { ...creator, plan: await this.repository.getPlan(creator.workspaceId) }
      : creator;
  }

  async requestMagicLink(email: string, segment: Segment, returnTo?: string) {
    return this.requestAccountVerification(email, segment, returnTo);
  }

  async requestAccountVerification(email: string, segment: Segment, returnTo?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    // Registration never restarts onboarding or issues a sign-in credential for an
    // existing verified mailbox. The public response remains the same accepted result.
    if (await this.repository.getVerifiedEmailIdentity(normalizedEmail)) return undefined;
    const token = opaqueToken();
    await this.repository.createMagicToken({
      id: randomUUID(),
      email: normalizedEmail,
      segment,
      tokenHash: hashToken(token),
      policyVersion: this.config.POLICY_VERSION,
      expiresAt: new Date(Date.now() + 15 * 60_000),
      consumedAt: null,
    });
    const verifyUrl = new URL("/v1/auth/verify", this.config.PUBLIC_API_URL);
    verifyUrl.searchParams.set("token", token);
    if (returnTo) verifyUrl.searchParams.set("returnTo", returnTo);
    await this.mailer.sendAccountVerification(normalizedEmail, verifyUrl.href);
    return this.config.NODE_ENV !== "production" || this.config.AUTH_DEBUG_MAGIC_LINKS
      ? verifyUrl.href
      : undefined;
  }

  async verifyMagicLink(token: string) {
    // A verification credential must never be exchanged for a session.
    return this.repository.consumeMagicLinkIdentity(hashToken(token), new Date());
  }

  async prepareSignInPin(email: string) {
    return this.repository.getVerifiedEmailIdentity(email);
  }

  async requestSignInPin(
    email: string,
    returnTo?: string,
    workspaceId?: string,
    preparedIdentity?: MagicLinkIdentity | null,
  ) {
    const challengeId = opaqueToken();
    const identity =
      preparedIdentity === undefined
        ? await this.repository.getVerifiedEmailIdentity(email)
        : preparedIdentity;
    const result = {
      accepted: true as const,
      challengeId,
      expiresInSeconds: 600,
      resendAfterSeconds: 60,
    };
    // The response is indistinguishable for unknown, deleted and unverified accounts.
    if (!identity) return result;
    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const now = new Date();
    await this.repository.createEmailPinChallenge({
      id: randomUUID(),
      userId: identity.user.userId,
      tokenHash: hashToken(challengeId),
      // The raw high-entropy challenge is absent from storage. A database-only leak
      // cannot enumerate the small PIN space using the stored challenge hash.
      pinHash: hashToken(`${challengeId}:${pin}`),
      policyVersion: this.config.POLICY_VERSION,
      returnTo: returnTo ?? null,
      workspaceId: workspaceId ?? null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 10 * 60_000),
      consumedAt: null,
      attempts: 0,
    });
    try {
      await this.mailer.sendSignInPin(email, pin);
    } catch {
      await this.repository.revokeEmailPinChallenge(hashToken(challengeId));
      throw new AuthEmailDeliveryError();
    }
    return this.config.NODE_ENV !== "production" || this.config.AUTH_DEBUG_MAGIC_LINKS
      ? { ...result, debugPin: pin }
      : result;
  }

  async verifySignInPin(challengeId: string, pin: string) {
    const consumed = await this.repository.consumeEmailPinChallenge(
      hashToken(challengeId),
      hashToken(`${challengeId}:${pin}`),
      new Date(),
    );
    if (!consumed) return null;
    const { identity, returnTo } = consumed;
    if (identity.creator) {
      return {
        ...(await this.issueCreatorSession(identity.creator)),
        user: identity.user,
        returnTo,
      };
    }
    const sessionToken = await this.issueIdentitySession(identity.user);
    return { user: identity.user, creator: null, sessionToken, returnTo };
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
    const organization = await createPlatformRepository(
      this.repository,
    ).getOrganizationForWorkspace(creator.workspaceId);
    if (organization?.licenseUnit === "user")
      throw new PlatformError(
        "ORGANIZATION_MEMBERSHIP_REQUIRED",
        "Manage licensed users through organization People settings",
      );
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
    return this.effectiveCreator(creator);
  }

  async switchWorkspace(
    request: FastifyRequest,
    creator: Pick<UserPrincipal, "userId">,
    workspaceId: string,
  ) {
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

  localeAwareWebRedirect(creator: UserPrincipal, returnTo: string) {
    const webOrigin = new URL(this.config.WEB_ORIGIN);
    const localReturnTo = LocalReturnPathSchema.safeParse(returnTo);
    let destination: URL;
    try {
      destination = new URL(localReturnTo.success ? localReturnTo.data : "/home", webOrigin);
    } catch {
      destination = new URL("/home", webOrigin);
    }
    if (destination.origin !== webOrigin.origin) destination = new URL("/home", webOrigin);
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
  }
}
