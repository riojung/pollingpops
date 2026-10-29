import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Stripe from "stripe";
import { z, ZodError } from "zod";
import {
  createPlatformRepository,
  PlatformError,
  type OrganizationInvitationRecord,
  type OrganizationRole,
  type PlatformOffer,
  type PlatformRepository,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { PlatformBillingWorker } from "./platform-billing-worker.js";
import { bootstrapPlatformCatalog } from "./platform-catalog.js";

const organizationParams = z.object({ organizationId: z.string().uuid() });
const workspaceParams = organizationParams.extend({ workspaceId: z.string().uuid() });
const memberParams = organizationParams.extend({ userId: z.string().uuid() });
const billingRoles: OrganizationRole[] = ["owner", "admin", "billing"];
const adminRoles: OrganizationRole[] = ["owner", "admin"];
const nameSchema = z.string().trim().min(1).max(120);
const idempotencySchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9:_-]+$/);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

const publicOffer = ({
  stripePriceId: _price,
  entitlements: _entitlements,
  ...offer
}: PlatformOffer) => offer;
const publicInvitation = ({ tokenHash: _tokenHash, ...invitation }: OrganizationInvitationRecord) =>
  invitation;

export async function registerPlatformRoutes(
  app: FastifyInstance,
  dependencies: {
    config: AppConfig;
    repository: Repository;
    auth: AuthService;
    stripeClient?: Stripe | null;
  },
) {
  const { config, repository, auth } = dependencies;
  const platform = createPlatformRepository(repository);
  const platformBillingWorker = new PlatformBillingWorker(
    platform,
    config,
    dependencies.stripeClient,
  );
  const stripe = platformBillingWorker.stripe;
  if (!config.BUSINESS_PLATFORM_ENABLED) return { platformBillingWorker };
  await bootstrapPlatformCatalog(platform, config);

  await app.register(async (routes) => {
    routes.setErrorHandler((error, request, reply) => {
      if (error instanceof ZodError)
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Check the submitted values",
            requestId: request.id,
          },
        });
      if (error instanceof PlatformError) {
        const status =
          error.code === "VALIDATION_ERROR"
            ? 400
            : error.code === "UNAUTHORIZED"
              ? 401
              : error.code === "FORBIDDEN"
                ? 403
                : error.code === "NOT_FOUND"
                  ? 404
                  : error.code === "INSUFFICIENT_CREDITS"
                    ? 402
                    : error.code === "DEPENDENCY_UNAVAILABLE"
                      ? 503
                      : 409;
        return reply
          .code(status)
          .send({ error: { code: error.code, message: error.message, requestId: request.id } });
      }
      request.log.error(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "platform request failed",
      );
      return reply.code(503).send({
        error: {
          code: "DEPENDENCY_UNAVAILABLE",
          message: "The request could not be completed. Try again shortly.",
          requestId: request.id,
        },
      });
    });

    const authorized = async (
      request: FastifyRequest,
      reply: FastifyReply,
      roles: OrganizationRole[],
    ) => {
      const user = await auth.requireUser(request, reply);
      if (!user) return null;
      const { organizationId } = organizationParams.parse(request.params);
      const member = await platform.requireOrganizationRole(organizationId, user.userId, roles);
      return { user, member, organizationId };
    };

    async function command<T>(
      request: FastifyRequest,
      organizationId: string,
      actorId: string,
      action: string,
      work: (scoped: PlatformRepository) => Promise<T>,
    ): Promise<T> {
      const idempotencyKey = idempotencySchema.parse(
        request.headers["x-idempotency-key"] ?? randomUUID(),
      );
      const requestHash = digest(
        JSON.stringify({ action, path: request.url, body: request.body ?? null }),
      );
      return platform.withTransaction(async (scoped) => {
        const started = await scoped.beginCommand({ actorId, idempotencyKey, requestHash });
        if (!started.created) {
          if (started.receipt.state === "complete") return started.receipt.result as T;
          throw new PlatformError(
            "CONFLICT",
            "This action is already in progress. Retry with the same request key.",
          );
        }
        const result = await work(scoped);
        const auditResult =
          action === "organization.invitation_created"
            ? { invitation: (result as { invitation: unknown }).invitation }
            : result;
        await scoped.appendAuditEvent({
          actorId,
          organizationId,
          action,
          targetId: organizationId,
          reason: "Customer administration",
          requestId: request.id,
          before: null,
          after: auditResult,
        });
        await scoped.completeCommand(started.receipt.id, result);
        return result;
      });
    }

    routes.get("/v1/organizations", async (request, reply) => {
      const user = await auth.requireUser(request, reply);
      return user
        ? {
            organizations: (await platform.listOrganizations(user.userId)).filter(
              (organization) => organization.accountType !== "personal",
            ),
          }
        : undefined;
    });
    routes.post("/v1/organizations", async (request, reply) => {
      const user = await auth.requireUser(request, reply);
      if (!user) return;
      const input = z
        .object({ name: nameSchema, licenseUnit: z.enum(["workspace", "user"]).optional() })
        .strict()
        .parse(request.body);
      const idempotencyKey = idempotencySchema.parse(
        request.headers["x-idempotency-key"] ?? randomUUID(),
      );
      const requestHash = digest(
        JSON.stringify({
          action: "organization.created",
          name: input.name,
          licenseUnit: input.licenseUnit ?? "workspace",
        }),
      );
      const result = await platform.withTransaction(async (scoped) => {
        const started = await scoped.beginCommand({
          actorId: user.userId,
          idempotencyKey,
          requestHash,
        });
        if (!started.created) {
          if (started.receipt.state === "complete")
            return started.receipt.result as {
              organization: Awaited<ReturnType<PlatformRepository["createOrganization"]>>;
            };
          throw new PlatformError("CONFLICT", "Organization creation is already in progress");
        }
        const organization = await scoped.createOrganization({
          name: input.name,
          actorId: user.userId,
          accountType: "organization",
          licenseUnit: input.licenseUnit ?? "workspace",
        });
        await scoped.enqueueIntegrationJob({
          integration: "hubspot",
          organizationId: organization.id,
          eventType: "crm.organization.upsert",
          deduplicationKey: `organization-created:${organization.id}`,
          payload: {
            organizationId: organization.id,
            name: organization.name,
            designatedContacts: [],
          },
        });
        const created = { organization };
        await scoped.appendAuditEvent({
          actorId: user.userId,
          organizationId: organization.id,
          action: "organization.created",
          targetId: organization.id,
          reason: "Customer organization creation",
          requestId: request.id,
          before: null,
          after: created,
        });
        await scoped.completeCommand(started.receipt.id, created);
        return created;
      });
      return reply.code(201).send(result);
    });
    routes.get("/v1/organizations/:organizationId", async (request, reply) => {
      const identity = await authorized(request, reply, ["owner", "admin", "billing", "member"]);
      if (!identity) return;
      return {
        organization: await platform.getOrganization(identity.organizationId, identity.user.userId),
        role: identity.member.role,
      };
    });
    routes.patch("/v1/organizations/:organizationId", async (request, reply) => {
      const identity = await authorized(request, reply, adminRoles);
      if (!identity) return;
      const { name } = z.object({ name: nameSchema }).strict().parse(request.body);
      return command(
        request,
        identity.organizationId,
        identity.user.userId,
        "organization.name_changed",
        async (scoped) => ({
          organization: await scoped.renameOrganization(
            identity.organizationId,
            identity.user.userId,
            name,
          ),
        }),
      );
    });
    routes.post("/v1/organizations/:organizationId/close", async (request, reply) => {
      const identity = await authorized(request, reply, ["owner"]);
      if (!identity) return;
      const { confirmation } = z
        .object({ confirmation: z.string().min(1).max(120) })
        .strict()
        .parse(request.body);
      const organization = await platform.getOrganization(
        identity.organizationId,
        identity.user.userId,
      );
      if (confirmation !== organization.name)
        throw new PlatformError(
          "VALIDATION_ERROR",
          "Type the organization name exactly to confirm closure",
        );
      return command(
        request,
        identity.organizationId,
        identity.user.userId,
        "organization.closed",
        async (scoped) => ({
          organization: await scoped.closeOrganization(
            identity.organizationId,
            identity.user.userId,
          ),
        }),
      );
    });
    routes.get("/v1/organizations/:organizationId/workspaces", async (request, reply) => {
      const identity = await authorized(request, reply, ["owner", "admin", "billing", "member"]);
      if (!identity) return;
      const workspaces = await platform.listOrganizationWorkspaces(
        identity.organizationId,
        identity.user.userId,
      );
      const organization = await platform.getOrganization(
        identity.organizationId,
        identity.user.userId,
      );
      const eligibleOrganizationOwners =
        adminRoles.includes(identity.member.role) && organization.licenseUnit === "user"
          ? (await platform.listOrganizationMembers(identity.organizationId, identity.user.userId))
              .filter((member) => member.role !== "billing")
              .map((member) => member.userId)
          : null;
      return {
        workspaces: adminRoles.includes(identity.member.role)
          ? await Promise.all(
              workspaces.map(async (workspace) => ({
                ...workspace,
                eligibleOwnerIds:
                  eligibleOrganizationOwners ??
                  (await repository.listWorkspaceMembers(workspace.id)).map(
                    (member) => member.userId,
                  ),
              })),
            )
          : workspaces,
      };
    });
    routes.post("/v1/organizations/:organizationId/workspaces", async (request, reply) => {
      const identity = await authorized(request, reply, adminRoles);
      if (!identity) return;
      const input = z
        .object({ name: nameSchema, segment: z.enum(["education", "workplace"]) })
        .strict()
        .parse(request.body);
      const result = await command(
        request,
        identity.organizationId,
        identity.user.userId,
        "organization.workspace_created",
        async (scoped) => ({
          workspace: await scoped.createOrganizationWorkspace({
            organizationId: identity.organizationId,
            actorId: identity.user.userId,
            ...input,
          }),
        }),
      );
      return reply.code(201).send(result);
    });
    routes.get("/v1/organizations/:organizationId/members", async (request, reply) => {
      const identity = await authorized(request, reply, adminRoles);
      if (!identity) return;
      const members = await platform.listOrganizationMembers(
        identity.organizationId,
        identity.user.userId,
      );
      return {
        members: await Promise.all(
          members.map(async (member) => ({
            ...member,
            email: (await repository.getUserPrincipalById(member.userId))?.email ?? null,
          })),
        ),
      };
    });
    routes.get("/v1/organizations/:organizationId/seats", async (request, reply) => {
      const identity = await authorized(request, reply, billingRoles);
      if (!identity) return;
      return platform.getOrganizationUserLicenses(identity.organizationId, identity.user.userId);
    });
    routes.put(
      "/v1/organizations/:organizationId/members/:userId/license",
      async (request, reply) => {
        const identity = await authorized(request, reply, adminRoles);
        if (!identity) return;
        const { userId } = memberParams.parse(request.params);
        const { assigned } = z.object({ assigned: z.boolean() }).strict().parse(request.body);
        return command(
          request,
          identity.organizationId,
          identity.user.userId,
          "organization.user_license_changed",
          async (scoped) => ({
            assignment: await scoped.assignOrganizationUserLicense(
              identity.organizationId,
              identity.user.userId,
              userId,
              assigned,
            ),
          }),
        );
      },
    );
    routes.put("/v1/organizations/:organizationId/members/:userId", async (request, reply) => {
      const identity = await authorized(request, reply, adminRoles);
      if (!identity) return;
      const { userId } = memberParams.parse(request.params);
      const { role } = z
        .object({ role: z.enum(["owner", "admin", "billing", "member"]) })
        .strict()
        .parse(request.body);
      if (role === "owner" && identity.member.role !== "owner")
        throw new PlatformError(
          "FORBIDDEN",
          "Only an organization owner can appoint another owner",
        );
      return command(
        request,
        identity.organizationId,
        identity.user.userId,
        "organization.membership_changed",
        async (scoped) => ({
          member: await scoped.setOrganizationMember({
            organizationId: identity.organizationId,
            actorId: identity.user.userId,
            userId,
            role,
          }),
        }),
      );
    });
    routes.delete("/v1/organizations/:organizationId/members/:userId", async (request, reply) => {
      const identity = await authorized(request, reply, adminRoles);
      if (!identity) return;
      const { userId } = memberParams.parse(request.params);
      return command(
        request,
        identity.organizationId,
        identity.user.userId,
        "organization.membership_removed",
        async (scoped) => ({
          removed: await scoped.removeOrganizationMember(
            identity.organizationId,
            identity.user.userId,
            userId,
          ),
        }),
      );
    });
    routes.get("/v1/organizations/:organizationId/invitations", async (request, reply) => {
      const identity = await authorized(request, reply, adminRoles);
      if (!identity) return;
      return {
        invitations: (
          await platform.listOrganizationInvitations(identity.organizationId, identity.user.userId)
        ).map(({ tokenHash: _tokenHash, ...invitation }) => invitation),
      };
    });
    routes.post("/v1/organizations/:organizationId/invitations", async (request, reply) => {
      const identity = await authorized(request, reply, adminRoles);
      if (!identity) return;
      const input = z
        .object({
          email: z
            .string()
            .email()
            .max(254)
            .transform((email) => email.toLowerCase()),
          role: z.enum(["owner", "admin", "billing", "member"]),
          workspaceName: nameSchema.optional(),
        })
        .strict()
        .parse(request.body);
      const token = randomBytes(32).toString("base64url");
      const result = await command(
        request,
        identity.organizationId,
        identity.user.userId,
        "organization.invitation_created",
        async (scoped) => {
          const invitation = publicInvitation(
            await scoped.createOrganizationInvitation({
              organizationId: identity.organizationId,
              actorId: identity.user.userId,
              email: input.email,
              role: input.role,
              ...(input.workspaceName ? { workspaceName: input.workspaceName } : {}),
              tokenHash: digest(token),
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
            }),
          );
          return {
            invitation,
            inviteUrl: `${config.WEB_ORIGIN}/organization/invite?token=${encodeURIComponent(token)}`,
          };
        },
      );
      await auth.sendOrganizationInvitation(result.invitation.email, result.inviteUrl);
      return reply.code(201).send(result);
    });
    routes.delete(
      "/v1/organizations/:organizationId/invitations/:invitationId",
      async (request, reply) => {
        const identity = await authorized(request, reply, adminRoles);
        if (!identity) return;
        const { invitationId } = organizationParams
          .extend({ invitationId: z.string().uuid() })
          .parse(request.params);
        return command(
          request,
          identity.organizationId,
          identity.user.userId,
          "organization.invitation_revoked",
          async (scoped) => ({
            revoked: await scoped.revokeOrganizationInvitation(
              identity.organizationId,
              identity.user.userId,
              invitationId,
            ),
          }),
        );
      },
    );
    routes.post("/v1/organization-invitations/accept", async (request, reply) => {
      const user = await auth.requireUser(request, reply);
      if (!user) return;
      const { token } = z
        .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
        .strict()
        .parse(request.body);
      const member = await platform.acceptOrganizationInvitation({
        tokenHash: digest(token),
        actorId: user.userId,
      });
      if (member.workspaceId && !(await auth.switchWorkspace(request, user, member.workspaceId)))
        throw new PlatformError(
          "CONFLICT",
          "Invitation accepted. Select your organization workspace to continue.",
        );
      return {
        organizationId: member.organizationId,
        role: member.role,
        ...(member.workspaceId
          ? { workspaceId: member.workspaceId, activeWorkspaceId: member.workspaceId }
          : {}),
      };
    });
    routes.post(
      "/v1/organizations/:organizationId/workspaces/:workspaceId/ownership",
      async (request, reply) => {
        const identity = await authorized(request, reply, adminRoles);
        if (!identity) return;
        const { workspaceId } = workspaceParams.parse(request.params);
        const { userId } = z.object({ userId: z.string().uuid() }).strict().parse(request.body);
        const workspaces = await platform.listOrganizationWorkspaces(
          identity.organizationId,
          identity.user.userId,
        );
        if (!workspaces.some((workspace) => workspace.id === workspaceId))
          throw new PlatformError("NOT_FOUND", "Workspace not found");
        return command(
          request,
          identity.organizationId,
          identity.user.userId,
          "workspace.ownership_transferred",
          async (scoped) => {
            await scoped.transferWorkspaceOwnership(workspaceId, identity.user.userId, userId);
            return { transferred: true };
          },
        );
      },
    );

    routes.get("/v1/organizations/:organizationId/billing", async (request, reply) => {
      const identity = await authorized(request, reply, billingRoles);
      if (!identity) return;
      const [subscription, assignments, balance, purchases, commercialHold, userLicenses] =
        await Promise.all([
          platform.getSubscription(identity.organizationId),
          platform.listLicenseAssignments(identity.organizationId, identity.user.userId),
          platform.getCreditBalance(identity.organizationId),
          platform.listPurchases(identity.organizationId, identity.user.userId),
          platform.getOrganizationCommercialHold(identity.organizationId),
          platform.getOrganizationUserLicenses(identity.organizationId, identity.user.userId),
        ]);
      return {
        subscription,
        assignments,
        balance,
        purchases,
        commercialHold,
        userLicenses,
        mode: config.BILLING_MODE,
        eventCreditsEnabled: config.BUSINESS_EVENT_CREDITS_ENABLED && !config.COMMUNITY_MODE,
      };
    });
    routes.put(
      "/v1/organizations/:organizationId/workspaces/:workspaceId/license",
      async (request, reply) => {
        const identity = await authorized(request, reply, billingRoles);
        if (!identity) return;
        const { workspaceId } = workspaceParams.parse(request.params);
        const { assigned } = z.object({ assigned: z.boolean() }).strict().parse(request.body);
        return command(
          request,
          identity.organizationId,
          identity.user.userId,
          "workspace.license_assignment_changed",
          async (scoped) => ({
            assignment: await scoped.assignWorkspaceLicense(
              identity.organizationId,
              identity.user.userId,
              workspaceId,
              assigned,
            ),
          }),
        );
      },
    );
    routes.get("/v1/organizations/:organizationId/credits", async (request, reply) => {
      const identity = await authorized(request, reply, billingRoles);
      return identity
        ? {
            balance: await platform.getCreditBalance(identity.organizationId),
            ledger: await platform.listCreditLedger(identity.organizationId, identity.user.userId),
          }
        : undefined;
    });
    routes.post("/v1/organizations/:organizationId/promotions/redeem", async (request, reply) => {
      const identity = await authorized(request, reply, billingRoles);
      if (!identity) return;
      if (!config.BUSINESS_EVENT_CREDITS_ENABLED || config.COMMUNITY_MODE)
        throw new PlatformError("CONFLICT", "Event credit redemption is not enabled");
      const { code } = z
        .object({ code: z.string().trim().min(3).max(120) })
        .strict()
        .parse(request.body);
      const idempotencyKey = idempotencySchema.parse(
        request.headers["x-idempotency-key"] ?? randomUUID(),
      );
      return command(
        request,
        identity.organizationId,
        identity.user.userId,
        "promotion.redeemed",
        async (scoped) => ({
          redemption: await scoped.redeemPromotion({
            organizationId: identity.organizationId,
            actorId: identity.user.userId,
            codeHash: digest(code.toUpperCase()),
            idempotencyKey,
          }),
        }),
      );
    });
    routes.get("/v1/organizations/:organizationId/catalog", async (request, reply) => {
      const identity = await authorized(request, reply, billingRoles);
      if (!identity) return;
      const organization = await platform.getOrganization(
        identity.organizationId,
        identity.user.userId,
      );
      return {
        offers: (await platform.listOffers())
          .filter(
            (offer) =>
              offer.kind === "credit_pack" ||
              (offer.licenseUnit ?? "workspace") === (organization.licenseUnit ?? "workspace"),
          )
          .map(publicOffer),
        checkoutEnabled: Boolean(stripe) && !config.COMMUNITY_MODE,
      };
    });

    async function checkout(
      request: FastifyRequest,
      organizationId: string,
      userId: string,
      input: { offerId: string; offerVersion: number; quantity: number; promotionCode?: string },
    ) {
      if (!stripe || config.COMMUNITY_MODE)
        throw new PlatformError("CONFLICT", "Paid checkout is disabled for this deployment");
      const idempotencyKey = idempotencySchema.parse(request.headers["x-idempotency-key"]);
      return platform.withProviderBillingLock(organizationId, async () => {
        // Preparation commits before any provider HTTP. Audience joins never wait on this work.
        const prepared = await platform.withTransaction((transaction) =>
          transaction.withOrganizationBillingLock(organizationId, async (scoped) => {
            const offer = await scoped.getOffer(input.offerId);
            if (
              !offer ||
              offer.status !== "published" ||
              offer.version !== input.offerVersion ||
              !offer.stripePriceId
            )
              throw new PlatformError(
                "CONFLICT",
                "This offer is no longer available. Refresh and try again.",
              );
            if (offer.kind === "credit_pack" && !config.BUSINESS_EVENT_CREDITS_ENABLED)
              throw new PlatformError("CONFLICT", "Event credit purchases are not enabled");
            const organization = await scoped.getOrganization(organizationId, userId);
            if (
              offer.kind === "workspace_subscription" &&
              (offer.licenseUnit ?? "workspace") !== (organization.licenseUnit ?? "workspace")
            )
              throw new PlatformError(
                "CONFLICT",
                "Choose a subscription matching this account's license type",
              );
            const subscription = await scoped.getSubscription(organizationId);
            if (
              offer.kind === "workspace_subscription" &&
              subscription.subscriptionId &&
              !["canceled", "incomplete_expired"].includes(subscription.status)
            )
              throw new PlatformError(
                "CONFLICT",
                "A subscription already exists. Use billing management to change it.",
              );
            const pending =
              offer.kind === "workspace_subscription"
                ? (await scoped.listPurchases(organizationId, userId)).filter(
                    (candidate) =>
                      candidate.status === "pending" &&
                      candidate.offer.kind === "workspace_subscription",
                  )
                : [];
            const matching = pending.find(
              (candidate) =>
                candidate.offer.id === input.offerId &&
                candidate.offer.version === input.offerVersion &&
                candidate.quantity === input.quantity,
            );
            if (pending.length && !matching)
              throw new PlatformError(
                "CONFLICT",
                "A subscription checkout already exists. Finish or cancel it before starting another.",
              );
            const purchase =
              matching ??
              (await scoped.createPurchase({
                organizationId,
                actorId: userId,
                offerId: offer.id,
                quantity: input.quantity,
                idempotencyKey,
              }));
            if (purchase.offer.version !== input.offerVersion || purchase.status !== "pending")
              throw new PlatformError(
                "CONFLICT",
                "This purchase has already completed or changed. Start a new purchase.",
              );
            let promotionId: string | null = null;
            if (input.promotionCode) {
              const redemption = await scoped.redeemPromotion({
                organizationId,
                actorId: userId,
                codeHash: digest(input.promotionCode.trim().toUpperCase()),
                idempotencyKey: `${purchase.id}:discount`,
              });
              promotionId = redemption.stripePromotionCodeId;
              if (!promotionId)
                throw new PlatformError(
                  "CONFLICT",
                  "This code grants credits; redeem it from Event credits instead.",
                );
            }
            return { purchase, subscription, promotionId, accountType: organization.accountType };
          }),
        );
        const { purchase, subscription, promotionId } = prepared;
        const checkoutReturn = (outcome: "success" | "cancelled") => {
          const destination = new URL(
            prepared.accountType === "personal" ? "/account" : "/organization",
            config.WEB_ORIGIN,
          );
          destination.searchParams.set("checkout", outcome);
          if (prepared.accountType !== "personal")
            destination.searchParams.set("organizationId", organizationId);
          destination.hash = prepared.accountType === "personal" ? "plan" : "billing";
          return destination.href;
        };
        const providerPrice = await stripe.prices.retrieve(purchase.offer.stripePriceId!);
        const correctPrice =
          providerPrice.active &&
          providerPrice.currency === purchase.offer.currency &&
          providerPrice.unit_amount === purchase.offer.amountMinor;
        const correctSchedule =
          purchase.offer.kind === "credit_pack"
            ? providerPrice.type === "one_time"
            : providerPrice.type === "recurring" &&
              providerPrice.recurring?.interval === purchase.offer.interval &&
              providerPrice.recurring.interval_count === 1 &&
              providerPrice.recurring.usage_type === "licensed";
        if (!correctPrice || !correctSchedule)
          throw new PlatformError("CONFLICT", "This offer’s payment price needs operator review");
        if (purchase.checkoutId) {
          const existing = await stripe.checkout.sessions.retrieve(purchase.checkoutId);
          if (existing.url && existing.status === "open") return { url: existing.url };
          if (existing.status === "expired") await platform.cancelPurchase(purchase.id);
          throw new PlatformError(
            "CONFLICT",
            "This checkout has already completed or expired. Refresh billing before starting a new purchase.",
          );
        }
        const metadata = { organizationId, purchaseId: purchase.id };
        const created = await stripe.checkout.sessions.create(
          {
            mode: purchase.offer.kind === "credit_pack" ? "payment" : "subscription",
            line_items: [{ price: purchase.offer.stripePriceId!, quantity: purchase.quantity }],
            automatic_tax: { enabled: config.BUSINESS_STRIPE_AUTOMATIC_TAX_ENABLED },
            ...(config.BUSINESS_STRIPE_AUTOMATIC_TAX_ENABLED
              ? {
                  billing_address_collection: "required" as const,
                  tax_id_collection: { enabled: true },
                  ...(subscription.customerId
                    ? { customer_update: { address: "auto" as const, name: "auto" as const } }
                    : {}),
                }
              : {}),
            ...(subscription.customerId
              ? { customer: subscription.customerId }
              : purchase.offer.kind === "credit_pack"
                ? { customer_creation: "always" as const }
                : {}),
            client_reference_id: organizationId,
            metadata,
            ...(purchase.offer.kind === "workspace_subscription"
              ? { subscription_data: { metadata } }
              : { payment_intent_data: { metadata } }),
            ...(promotionId ? { discounts: [{ promotion_code: promotionId }] } : {}),
            success_url: checkoutReturn("success"),
            cancel_url: checkoutReturn("cancelled"),
          },
          { idempotencyKey: `pollingpops-purchase-${purchase.id}` },
        );
        await platform.updatePurchaseCheckout(purchase.id, created.id);
        if (!created.url)
          throw new PlatformError(
            "DEPENDENCY_UNAVAILABLE",
            "The payment provider did not return a checkout address",
          );
        return { url: created.url };
      });
    }
    routes.post("/v1/organizations/:organizationId/billing/checkout", async (request, reply) => {
      const identity = await authorized(request, reply, billingRoles);
      if (!identity) return;
      const input = z
        .object({
          offerId: z.string().min(1).max(80),
          offerVersion: z.number().int().positive(),
          quantity: z.number().int().min(1).max(1_000),
          promotionCode: z.string().trim().min(3).max(120).optional(),
        })
        .strict()
        .parse(request.body);
      return checkout(request, identity.organizationId, identity.user.userId, input);
    });
    routes.post("/v1/organizations/:organizationId/billing/portal", async (request, reply) => {
      const identity = await authorized(request, reply, billingRoles);
      if (!identity) return;
      if (!stripe || config.COMMUNITY_MODE)
        throw new PlatformError("CONFLICT", "Billing management is disabled");
      const subscription = await platform.getSubscription(identity.organizationId);
      if (!subscription.customerId)
        throw new PlatformError("CONFLICT", "No billing customer exists yet");
      return {
        url: (
          await stripe.billingPortal.sessions.create({
            customer: subscription.customerId,
            return_url: `${config.WEB_ORIGIN}/organization?organizationId=${identity.organizationId}#billing`,
          })
        ).url,
      };
    });
    routes.post("/v1/organizations/:organizationId/billing/quantity", async (request, reply) => {
      const identity = await authorized(request, reply, billingRoles);
      if (!identity) return;
      if (!stripe || config.COMMUNITY_MODE)
        throw new PlatformError("CONFLICT", "Billing management is disabled");
      const { quantity } = z
        .object({ quantity: z.number().int().min(1).max(1_000) })
        .strict()
        .parse(request.body);
      const key = idempotencySchema.parse(request.headers["x-idempotency-key"]);
      await platform.withProviderBillingLock(identity.organizationId, async () => {
        const prepared = await platform.withTransaction((transaction) =>
          transaction.withOrganizationBillingLock(identity.organizationId, async (scoped) => {
            const started = await scoped.beginCommand({
              actorId: identity.user.userId,
              idempotencyKey: key,
              requestHash: digest(
                JSON.stringify({
                  action: "billing.quantity_changed",
                  organizationId: identity.organizationId,
                  quantity,
                }),
              ),
            });
            if (!started.created && started.receipt.state === "complete")
              return { complete: true as const };
            const subscription = await scoped.getSubscription(identity.organizationId);
            if (!subscription.subscriptionId)
              throw new PlatformError("CONFLICT", "No subscription exists yet");
            const organization = await scoped.getOrganization(
              identity.organizationId,
              identity.user.userId,
            );
            const userLicenses =
              (organization.licenseUnit ?? "workspace") === "user"
                ? await scoped.getOrganizationUserLicenses(
                    identity.organizationId,
                    identity.user.userId,
                  )
                : null;
            const assignments = userLicenses
              ? []
              : await scoped.listLicenseAssignments(identity.organizationId, identity.user.userId);
            if (
              (userLicenses ? userLicenses.assigned + userLicenses.reserved : assignments.length) >
              quantity
            )
              throw new PlatformError(
                "CONFLICT",
                userLicenses
                  ? "Release user licenses and pending invitations before reducing the license quantity"
                  : "Unassign idle workspaces before reducing the license quantity",
              );
            return {
              complete: false as const,
              receiptId: started.receipt.id,
              subscriptionId: subscription.subscriptionId,
            };
          }),
        );
        if (prepared.complete) return;
        const current = await stripe.subscriptions.retrieve(prepared.subscriptionId);
        if (current.items.data.length !== 1)
          throw new PlatformError("CONFLICT", "This subscription requires operator assistance");
        await stripe.subscriptions.update(
          current.id,
          {
            items: [{ id: current.items.data[0]!.id, quantity }],
            payment_behavior: "pending_if_incomplete",
            proration_behavior: "always_invoice",
          },
          { idempotencyKey: `pollingpops-quantity-${identity.organizationId}-${key}` },
        );
        await platform.withTransaction(async (scoped) => {
          await scoped.requireOrganizationRole(
            identity.organizationId,
            identity.user.userId,
            billingRoles,
          );
          const result = { requestedQuantity: quantity };
          await scoped.appendAuditEvent({
            actorId: identity.user.userId,
            organizationId: identity.organizationId,
            action: "billing.quantity_changed",
            targetId: current.id,
            reason: "Customer requested a subscription quantity change",
            requestId: request.id,
            before: { quantity: current.items.data[0]!.quantity },
            after: result,
          });
          await scoped.completeCommand(prepared.receiptId, result);
        });
      });
      const subscription = await platform.getSubscription(identity.organizationId);
      await platformBillingWorker.reconcileSubscription(
        identity.organizationId,
        subscription.subscriptionId,
      );
      return { subscription: await platform.getSubscription(identity.organizationId) };
    });
    routes.get("/v1/organizations/:organizationId/billing/export", async (request, reply) => {
      const identity = await authorized(request, reply, billingRoles);
      if (!identity) return;
      const [subscription, purchases, ledger] = await Promise.all([
        platform.getSubscription(identity.organizationId),
        platform.listPurchases(identity.organizationId, identity.user.userId),
        platform.listCreditLedger(identity.organizationId, identity.user.userId),
      ]);
      return reply
        .header(
          "content-disposition",
          `attachment; filename="pollingpops-billing-${identity.organizationId}.json"`,
        )
        .send({
          organizationId: identity.organizationId,
          subscription,
          purchases: purchases.map((purchase) => ({
            ...purchase,
            offer: publicOffer(purchase.offer),
          })),
          ledger,
        });
    });
    routes.post(
      "/v1/organizations/:organizationId/billing/purchases/:purchaseId/cancel",
      async (request, reply) => {
        const identity = await authorized(request, reply, billingRoles);
        if (!identity) return;
        const { purchaseId } = organizationParams
          .extend({ purchaseId: z.string().regex(/^[a-f0-9]{64}$/) })
          .parse(request.params);
        const key = idempotencySchema.parse(request.headers["x-idempotency-key"]);
        await platform.withProviderBillingLock(identity.organizationId, async () => {
          const purchase = await platform.getPurchase(purchaseId);
          if (!purchase || purchase.organizationId !== identity.organizationId)
            throw new PlatformError("NOT_FOUND", "Purchase not found");
          if (purchase.status === "canceled") return;
          if (purchase.status !== "pending")
            throw new PlatformError("CONFLICT", "Only an unfinished checkout can be canceled");
          if (purchase.checkoutId) {
            if (!stripe) throw new PlatformError("CONFLICT", "Payment management is disabled");
            const session = await stripe.checkout.sessions.retrieve(purchase.checkoutId);
            if (session.status === "open")
              await stripe.checkout.sessions.expire(
                session.id,
                {},
                { idempotencyKey: `pollingpops-cancel-${purchase.id}-${key}` },
              );
            else if (session.status !== "expired")
              throw new PlatformError(
                "CONFLICT",
                "Payment is being confirmed. Refresh billing instead of canceling this checkout.",
              );
          }
          await platform.withTransaction(async (scoped) => {
            await scoped.requireOrganizationRole(
              identity.organizationId,
              identity.user.userId,
              billingRoles,
            );
            await scoped.cancelPurchase(purchase.id);
            await scoped.appendAuditEvent({
              actorId: identity.user.userId,
              organizationId: identity.organizationId,
              action: "billing.checkout_canceled",
              targetId: purchase.id,
              reason: "Customer canceled an unfinished checkout",
              requestId: request.id,
              before: { status: purchase.status },
              after: { status: "canceled" },
            });
          });
        });
        return { canceled: true };
      },
    );

    routes.post("/v1/webhooks/stripe", { config: { rawBody: true } }, async (request, reply) => {
      if (!stripe) return reply.code(204).send();
      const signature = request.headers["stripe-signature"];
      const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
      if (typeof signature !== "string" || !rawBody)
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Missing webhook signature",
            requestId: request.id,
          },
        });
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET!);
      } catch {
        return reply.code(400).send({
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid webhook signature",
            requestId: request.id,
          },
        });
      }
      const providerObject = event.data.object as unknown as {
        id: string;
        metadata?: Record<string, unknown>;
      };
      const metadata = Object.fromEntries(
        ["organizationId", "workspaceId", "purchaseId"].flatMap((name) => {
          const value = providerObject.metadata?.[name];
          return typeof value === "string" && value.length <= 200 ? [[name, value]] : [];
        }),
      );
      await platform.enqueueBillingEvent({
        providerEventId: event.id,
        eventType: event.type,
        payload: { id: providerObject.id, metadata },
        providerCreatedAt: new Date(event.created * 1_000),
      });
      return reply.code(204).send();
    });

    // Old account/pricing links retain their paths; authorization is now organization billing.
    const legacyIdentity = async (request: FastifyRequest, reply: FastifyReply) => {
      const creator = await auth.requireCreator(request, reply);
      if (!creator) return null;
      const organization = await platform.getOrganizationForWorkspace(creator.workspaceId);
      if (!organization) throw new PlatformError("NOT_FOUND", "Billing organization not found");
      await platform.requireOrganizationRole(organization.id, creator.userId, billingRoles);
      return { creator, organization };
    };
    routes.get("/v1/billing/status", async (request, reply) => {
      const identity = await legacyIdentity(request, reply);
      if (!identity) return;
      const billing = await platform.getSubscription(identity.organization.id);
      return {
        billing: {
          ...billing,
          workspaceId: identity.creator.workspaceId,
          plan: await repository.getPlan(identity.creator.workspaceId),
        },
        mode: config.BILLING_MODE,
        organizationId: identity.organization.id,
      };
    });
    const legacySubscriptionOffers = async (licenseUnit: PlatformOffer["licenseUnit"]) =>
      (await platform.listOffers()).filter(
        (offer) =>
          offer.kind === "workspace_subscription" &&
          (offer.licenseUnit ?? "workspace") === (licenseUnit ?? "workspace"),
      );
    routes.get("/v1/billing/catalog", async (request, reply) => {
      const identity = await legacyIdentity(request, reply);
      if (!identity) return;
      return {
        offers: (await legacySubscriptionOffers(identity.organization.licenseUnit)).map(
          publicOffer,
        ),
        checkoutEnabled: Boolean(stripe) && !config.COMMUNITY_MODE,
      };
    });
    routes.post("/v1/billing/checkout", async (request, reply) => {
      const identity = await legacyIdentity(request, reply);
      if (!identity) return;
      const input = z
        .object({ offerId: z.string().min(1).max(80).optional() })
        .strict()
        .default({})
        .parse(request.body);
      const offers = (await legacySubscriptionOffers(identity.organization.licenseUnit)).filter(
        (offer) => !input.offerId || offer.id === input.offerId,
      );
      if (offers.length !== 1)
        throw new PlatformError(
          "CONFLICT",
          identity.organization.accountType === "personal"
            ? "Choose an available subscription in Account > Plan and usage"
            : "Choose an available subscription in organization billing",
        );
      return checkout(
        {
          ...request,
          headers: {
            ...request.headers,
            "x-idempotency-key": request.headers["x-idempotency-key"] ?? randomUUID(),
          },
        } as FastifyRequest,
        identity.organization.id,
        identity.creator.userId,
        { offerId: offers[0]!.id, offerVersion: offers[0]!.version, quantity: 1 },
      );
    });
    routes.post("/v1/billing/portal", async (request, reply) => {
      const identity = await legacyIdentity(request, reply);
      if (!identity) return;
      if (!stripe || config.COMMUNITY_MODE)
        throw new PlatformError("CONFLICT", "Billing management is disabled");
      const billing = await platform.getSubscription(identity.organization.id);
      if (!billing.customerId)
        throw new PlatformError("CONFLICT", "No billing customer exists yet");
      return {
        url: (
          await stripe.billingPortal.sessions.create({
            customer: billing.customerId,
            return_url: `${config.WEB_ORIGIN}/account#plan`,
          })
        ).url,
      };
    });
  });
  return { platformBillingWorker };
}
