import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PlatformOperator, PlatformRepository } from "@openround/db";
import { OperatorError, requireFreshOperator, tokenHash, type OperatorContext } from "./auth.js";
import { encryptIntegrationSecret } from "./integrations.js";
import { AccountingMappingSchema } from "./accounting.js";

export type OperatorView =
  "organizations" | "billing" | "credits" | "operations" | "support" | "integrations" | "audit";
const roleCapabilities: Record<string, readonly string[]> = {
  founder: [
    "organizations.read",
    "billing.read",
    "billing.write",
    "credits.read",
    "operations.read",
    "operations.write",
    "support.read",
    "integrations.read",
    "audit.read",
    "organizations.write",
    "credits.write",
    "support.write",
    "integrations.write",
    "operators.write",
  ],
  support: ["organizations.read", "support.read", "support.write"],
  billing: [
    "organizations.read",
    "billing.read",
    "billing.write",
    "credits.read",
    "credits.write",
    "audit.read",
  ],
  operations: [
    "organizations.read",
    "operations.read",
    "operations.write",
    "integrations.read",
    "integrations.write",
    "organizations.write",
    "support.read",
    "audit.read",
  ],
  readonly: ["organizations.read", "operations.read"],
};
export function operatorCapabilities(operator: PlatformOperator): string[] {
  return [...new Set([...(roleCapabilities[operator.role] ?? []), ...operator.capabilities])];
}
export function requireOperatorCapability(context: OperatorContext, capability: string) {
  if (!operatorCapabilities(context.operator).includes(capability))
    throw new OperatorError(
      403,
      "FORBIDDEN",
      "This operator role cannot perform the requested action",
    );
}
const envelope = { idempotencyKey: z.string().uuid(), reason: z.string().trim().min(10).max(500) };
export const OperatorCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...envelope,
      action: z.literal("organization.status"),
      organizationId: z.string().uuid(),
      status: z.enum(["active", "suspended"]),
      expectedUpdatedAt: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("workspace.status"),
      organizationId: z.string().uuid(),
      workspaceId: z.string().uuid(),
      status: z.enum(["active", "suspended"]),
      expectedStatus: z.enum(["active", "suspended"]),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("workspace.admission.restrict"),
      organizationId: z.string().uuid(),
      workspaceId: z.string().uuid(),
      blocked: z.boolean(),
      expectedBlocked: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("credits.grant"),
      organizationId: z.string().uuid(),
      quantity: z.number().int().min(1).max(100_000),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("billing.hold.resolve"),
      organizationId: z.string().uuid(),
      expectedHeld: z.literal(true),
      expectedUpdatedAt: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("credits.reverse"),
      organizationId: z.string().uuid(),
      artifactType: z.enum(["round", "presentation"]),
      roomId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("promotion.create"),
      organizationId: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(120),
      code: z.string().trim().min(8).max(80),
      creditQuantity: z.number().int().min(1).max(10_000),
      maximumRedemptions: z.number().int().min(1).max(10_000),
      expiresAt: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("promotion.discount.create"),
      organizationId: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(120),
      code: z.string().trim().min(8).max(80),
      stripePromotionCodeId: z.string().regex(/^promo_[A-Za-z0-9]+$/),
      maximumRedemptions: z.number().int().min(1).max(10_000),
      expiresAt: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("case.create"),
      organizationId: z.string().uuid().optional(),
      workspaceId: z.string().uuid().optional(),
      category: z.enum(["incident", "billing", "feedback", "integration"]),
      title: z.string().trim().min(1).max(160),
      redactedDescription: z.string().trim().min(10).max(4_000),
      sendToSupport: z.boolean().default(false),
    })
    .strict(),
  z.object({ ...envelope, action: z.literal("case.close"), caseId: z.string().uuid() }).strict(),
  z.object({ ...envelope, action: z.literal("case.sync"), caseId: z.string().uuid() }).strict(),
  z
    .object({
      ...envelope,
      action: z.literal("case.reconcile"),
      caseId: z.string().uuid(),
      originalJobId: z.string().regex(/^[a-f0-9]{64}$/),
      issueId: z.string().regex(/^\d+$/).max(30),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("product.job.retry"),
      kind: z.enum(["round-report", "presentation-report", "authoring"]),
      jobId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("billing.job.retry"),
      eventId: z
        .string()
        .regex(/^evt_[A-Za-z0-9_]+$/)
        .max(128),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("integration.retry"),
      jobId: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({ ...envelope, action: z.literal("operators.revoke"), operatorId: z.string().uuid() })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("operators.update"),
      operatorId: z.string().uuid(),
      role: z.enum(["founder", "support", "billing", "operations", "readonly"]),
      active: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("worker.pause"),
      workerId: z.enum([
        "reports",
        "authoring",
        "retention",
        "billing-reconciliation",
        "business-integrations",
      ]),
      paused: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("integration.connect"),
      integration: z.enum(["jira-service-management", "hubspot", "quickbooks"]),
      accessToken: z.string().min(1).max(8_000),
      refreshToken: z.string().min(1).max(8_000).optional(),
      clientId: z.string().min(1).max(500).optional(),
      clientSecret: z.string().min(1).max(2000).optional(),
      expiresAt: z.iso.datetime().optional(),
      cloudId: z.string().uuid().optional(),
      serviceDeskId: z.string().regex(/^\d+$/).optional(),
      requestTypeId: z.string().regex(/^\d+$/).optional(),
      realmId: z.string().regex(/^\d+$/).optional(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("integration.disconnect"),
      integration: z.enum(["jira-service-management", "hubspot", "quickbooks"]),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("integration.crm.designate"),
      organizationId: z.string().uuid(),
      userId: z.string().uuid(),
      designated: z.literal(true),
    })
    .strict(),
  z
    .object({
      ...envelope,
      action: z.literal("integration.accounting.reconcile"),
      organizationId: z.string().uuid(),
      externalCustomerId: z.string().regex(/^\d+$/),
      startDate: z.iso.date(),
      endDate: z.iso.date(),
      homeCurrency: z.string().regex(/^[A-Z]{3}$/),
      transactionMappings: z.array(AccountingMappingSchema).max(100).default([]),
    })
    .strict(),
]);
export type OperatorCommand = z.infer<typeof OperatorCommandSchema>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export class OperatorService {
  constructor(
    private readonly platform: PlatformRepository,
    private readonly integrationSecretKey?: string,
    private readonly feedbackReader?: () => Promise<Record<string, unknown>[]>,
  ) {}
  async view(context: OperatorContext, view: OperatorView, organizationId?: string) {
    requireOperatorCapability(context, `${view}.read`);
    if (view === "organizations") {
      const organizations = await this.platform.listAllOrganizations(100);
      return {
        organizations: await Promise.all(
          organizations.map(async (organization) => ({
            ...organization,
            workspaces: await Promise.all(
              (await this.platform.listOrganizationWorkspacesForOperator(organization.id)).map(
                async (workspace) => ({
                  ...workspace,
                  admissionBlocked:
                    (await this.platform.getWorkspaceAdmissionRestriction(workspace.id))?.blocked ??
                    false,
                }),
              ),
            ),
          })),
        ),
      };
    }
    if (view === "billing") {
      const organizations = await this.platform.listAllOrganizations(100);
      const subscriptions = await Promise.all(
        organizations.map(async (organization) => ({
          organizationId: organization.id,
          organizationName: organization.name,
          subscription: await this.platform.getSubscription(organization.id),
          commercialHold: await this.platform.getOrganizationCommercialHold(organization.id),
        })),
      );
      const events = await this.platform.listBillingEvents(100);
      return {
        subscriptions,
        offers: await this.platform.listOffers(true),
        events: events.map(
          ({ id, eventType, state, attempts, availableAt, lastError, createdAt }) => ({
            id,
            eventType,
            state,
            attempts,
            availableAt,
            lastError,
            createdAt,
          }),
        ),
      };
    }
    if (view === "credits") {
      const organizations = await this.platform.listAllOrganizations(100);
      return {
        balances: await Promise.all(
          organizations
            .filter((organization) => !organizationId || organization.id === organizationId)
            .map(async (organization) => ({
              organizationId: organization.id,
              organizationName: organization.name,
              balance: await this.platform.getCreditBalance(organization.id),
              ledger: await this.platform.listCreditLedgerForOperator(organization.id, 100),
            })),
        ),
        promotions: (await this.platform.listPromotions()).map(
          ({ codeHash: _codeHash, ...promotion }) => promotion,
        ),
      };
    }
    if (view === "operations")
      return {
        activeRooms: await this.platform.listActiveRooms(organizationId, 100),
        productQueues: await this.platform.getProductQueueHealth(),
        heartbeats: await this.platform.listHeartbeats(),
        workerControls: await Promise.all(
          [
            "reports",
            "authoring",
            "retention",
            "billing-reconciliation",
            "business-integrations",
          ].map(async (id) => ({
            id,
            paused: (await this.platform.getWorkerControl(id))?.paused ?? false,
          })),
        ),
        ...(context.operator.role === "founder"
          ? {
              operators: (await this.platform.listOperators()).map(
                ({ id, name, role, active }) => ({ id, name, role, active }),
              ),
            }
          : {}),
        jobs: (await this.platform.listIntegrationJobs(undefined, 100)).map(
          ({
            id,
            integration,
            organizationId,
            eventType,
            state,
            attempts,
            lastError,
            createdAt,
            availableAt,
          }) => ({
            id,
            integration,
            organizationId,
            eventType,
            state,
            attempts,
            lastError,
            createdAt,
            availableAt,
          }),
        ),
      };
    if (view === "support")
      return {
        cases: await Promise.all(
          (await this.platform.listCases()).map(async (supportCase) => {
            const creation = await this.platform.getIntegrationJobByDeduplication(
              "jira-service-management",
              `case:${supportCase.id}`,
            );
            return {
              ...supportCase,
              externalIssueKey: creation?.result?.issueKey ?? null,
              externalJobId: creation?.id ?? null,
              externalDeliveryState: creation?.state ?? null,
              providerMirror: supportCase.details.providerMirror ?? null,
            };
          }),
        ),
        feedback: this.feedbackReader ? await this.feedbackReader() : [],
      };
    if (view === "integrations") {
      const providers = ["jira-service-management", "hubspot", "quickbooks"];
      const connections = await Promise.all(
        providers.map(async (provider) => {
          const connection = await this.platform.getIntegrationConnection(provider);
          return {
            provider,
            status: connection?.status ?? "disconnected",
            updatedAt: connection?.updatedAt ?? null,
            credentialConfigured: Boolean(connection?.credentialCiphertext),
          };
        }),
      );
      const contacts = organizationId
        ? await this.platform.listOrganizationContactsForOperator(organizationId)
        : [];
      return {
        connections,
        contacts,
        stripeTransactions:
          organizationId && operatorCapabilities(context.operator).includes("billing.read")
            ? await this.platform.listStripeTransactionsForOperator(
                organizationId,
                new Date(Date.now() - 366 * 86_400_000),
                new Date(),
              )
            : [],
        jobs: (await this.platform.listIntegrationJobs(undefined, 100))
          .filter(
            (job) =>
              job.integration !== "quickbooks" ||
              operatorCapabilities(context.operator).includes("billing.read"),
          )
          .map(
            ({
              id,
              integration,
              organizationId,
              eventType,
              state,
              attempts,
              externalId,
              lastError,
              createdAt,
              completedAt,
              result,
            }) => ({
              id,
              integration,
              organizationId,
              eventType,
              state,
              attempts,
              externalId,
              lastError,
              createdAt,
              completedAt,
              result,
            }),
          ),
      };
    }
    return { events: await this.platform.listAuditEvents(organizationId, 100) };
  }
  async command(context: OperatorContext, body: unknown, requestId: string) {
    const command = OperatorCommandSchema.parse(body);
    const capability =
      command.action.startsWith("credits.") || command.action.startsWith("promotion.")
        ? "credits.write"
        : command.action.startsWith("billing.")
          ? "billing.write"
          : command.action === "worker.pause" || command.action.startsWith("product.job.")
            ? "operations.write"
            : command.action.startsWith("case.")
              ? "support.write"
              : command.action.startsWith("integration.")
                ? "integrations.write"
                : command.action.startsWith("operators.")
                  ? "operators.write"
                  : "organizations.write";
    requireOperatorCapability(context, capability);
    if (
      [
        "credits.grant",
        "billing.hold.resolve",
        "credits.reverse",
        "promotion.create",
        "promotion.discount.create",
        "operators.revoke",
        "operators.update",
        "integration.connect",
        "integration.disconnect",
        "integration.crm.designate",
        "workspace.admission.restrict",
        "product.job.retry",
        "billing.job.retry",
      ].includes(command.action)
    )
      requireFreshOperator(context);
    const requestHash = createHash("sha256").update(stableJson(command)).digest("hex");
    return this.platform.withOperatorTransaction(async (repository) => {
      const currentSession = await repository.getOperatorSession(context.tokenHash);
      if (!currentSession || currentSession.session.id !== context.session.id)
        throw new OperatorError(401, "UNAUTHORIZED", "Operator session was revoked or expired");
      const currentOperator = await repository.getOperator(context.operator.id);
      if (!currentOperator?.active)
        throw new OperatorError(403, "FORBIDDEN", "Operator access has been revoked");
      requireOperatorCapability({ ...context, operator: currentOperator }, capability);
      const integrationRetryJob =
        command.action === "integration.retry"
          ? await repository.getIntegrationJob(command.jobId)
          : null;
      if (integrationRetryJob?.integration === "quickbooks")
        requireOperatorCapability({ ...context, operator: currentOperator }, "billing.read");
      const { receipt, created } = await repository.beginCommand({
        actorId: context.operator.id,
        idempotencyKey: command.idempotencyKey,
        requestHash,
      });
      if (!created) {
        if (receipt.requestHash !== requestHash)
          throw new OperatorError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This command key has different input",
          );
        if (receipt.state !== "complete")
          throw new OperatorError(409, "COMMAND_PENDING", "The command has not completed");
        return receipt.result;
      }
      let organizationId = "organizationId" in command ? (command.organizationId ?? null) : null;
      let before: unknown = null;
      let result: unknown;
      let targetId: string | null = organizationId;
      if (command.action === "organization.status") {
        const existing = (await repository.listAllOrganizations(1000)).find(
          (organization) => organization.id === command.organizationId,
        );
        if (!existing) throw new OperatorError(404, "NOT_FOUND", "Organization not found");
        if (existing.status === "closed")
          throw new OperatorError(
            409,
            "ORGANIZATION_CLOSED",
            "Closed organizations cannot be resumed through an operational pause command",
          );
        if (existing.updatedAt.toISOString() !== command.expectedUpdatedAt)
          throw new OperatorError(409, "CONFLICT", "Organization changed; refresh before retry");
        before = { status: existing.status };
        result = await repository.updateOrganizationStatus(command.organizationId, command.status);
      } else if (command.action === "workspace.status") {
        const existing = (
          await repository.listOrganizationWorkspacesForOperator(command.organizationId)
        ).find((workspace) => workspace.id === command.workspaceId);
        if (!existing)
          throw new OperatorError(404, "NOT_FOUND", "Workspace not found in this organization");
        if (existing.status !== command.expectedStatus)
          throw new OperatorError(
            409,
            "CONFLICT",
            "Workspace status changed; refresh before retry",
          );
        before = { status: existing.status };
        targetId = command.workspaceId;
        result = await repository.updateWorkspaceStatus(command.workspaceId, command.status);
      } else if (command.action === "credits.grant") {
        before = await repository.getCreditBalance(command.organizationId);
        result = await repository.grantCredits({
          organizationId: command.organizationId,
          quantity: command.quantity,
          reason: command.reason,
          sourceKey: `operator:${context.operator.id}:${command.idempotencyKey}`,
          actorId: context.operator.id,
        });
      } else if (command.action === "billing.hold.resolve") {
        const resolved = await repository.withOrganizationBillingLock(
          command.organizationId,
          async (scoped) => {
            const hold = await scoped.getOrganizationCommercialHold(command.organizationId);
            if (
              !hold?.held ||
              hold.held !== command.expectedHeld ||
              hold.updatedAt.toISOString() !== command.expectedUpdatedAt
            )
              throw new OperatorError(
                409,
                "CONFLICT",
                "Commercial hold changed; refresh before resolving",
              );
            return {
              before: { held: hold.held, reason: hold.reason },
              result: await scoped.setOrganizationCommercialHold(
                command.organizationId,
                false,
                command.reason,
              ),
            };
          },
        );
        before = resolved.before;
        result = resolved.result;
      } else if (command.action === "credits.reverse") {
        const coverage = await repository.getRoomCoverage(command.artifactType, command.roomId);
        if (coverage?.organizationId !== command.organizationId)
          throw new OperatorError(404, "NOT_FOUND", "Room coverage not found in this organization");
        targetId = command.roomId;
        result = await repository.reverseCreditConsumption({
          artifactType: command.artifactType,
          roomId: command.roomId,
          actorId: context.operator.id,
          reason: command.reason,
          idempotencyKey: command.idempotencyKey,
        });
      } else if (command.action === "workspace.admission.restrict") {
        if (
          !(await repository.listOrganizationWorkspacesForOperator(command.organizationId)).some(
            (workspace) => workspace.id === command.workspaceId,
          )
        )
          throw new OperatorError(404, "NOT_FOUND", "Workspace not found in this organization");
        const prior = await repository.getWorkspaceAdmissionRestriction(command.workspaceId);
        if ((prior?.blocked ?? false) !== command.expectedBlocked)
          throw new OperatorError(
            409,
            "CONFLICT",
            "Admission policy changed; refresh before retry",
          );
        before = { blocked: prior?.blocked ?? false };
        targetId = command.workspaceId;
        result = await repository.setWorkspaceAdmissionRestriction(
          command.workspaceId,
          command.blocked,
        );
      } else if (
        command.action === "promotion.create" ||
        command.action === "promotion.discount.create"
      ) {
        if (new Date(command.expiresAt) <= new Date())
          throw new OperatorError(422, "INVALID_EXPIRY", "Promotion expiry must be in the future");
        const promotion = await repository.savePromotion({
          id: randomUUID(),
          codeHash: tokenHash(command.code.trim().toUpperCase()),
          name: command.name,
          kind: command.action === "promotion.create" ? "credits" : "discount",
          creditQuantity: command.action === "promotion.create" ? command.creditQuantity : 0,
          stripePromotionCodeId:
            command.action === "promotion.discount.create" ? command.stripePromotionCodeId : null,
          organizationId: command.organizationId ?? null,
          maximumRedemptions: command.maximumRedemptions,
          expiresAt: new Date(command.expiresAt),
          active: true,
          createdAt: new Date(),
        });
        result = {
          id: promotion.id,
          name: promotion.name,
          kind: promotion.kind,
          creditQuantity: promotion.creditQuantity,
          organizationId: promotion.organizationId,
          maximumRedemptions: promotion.maximumRedemptions,
          expiresAt: promotion.expiresAt,
          active: promotion.active,
        };
        targetId = promotion.id;
      } else if (command.action === "case.create") {
        if (
          command.workspaceId &&
          (!command.organizationId ||
            !(await repository.listOrganizationWorkspacesForOperator(command.organizationId)).some(
              (workspace) => workspace.id === command.workspaceId,
            ))
        )
          throw new OperatorError(
            422,
            "INVALID_WORKSPACE",
            "Support workspace must belong to the selected organization",
          );
        const supportCase = await repository.createCase({
          organizationId: command.organizationId ?? null,
          category: command.category,
          title: command.title,
          details: {
            redactedDescription: command.redactedDescription,
            ...(command.workspaceId ? { workspaceId: command.workspaceId } : {}),
          },
        });
        result = supportCase;
        targetId = supportCase.id;
        if (command.sendToSupport) {
          if (!command.organizationId)
            throw new OperatorError(
              422,
              "ORGANIZATION_REQUIRED",
              "Select an organization for an external support request",
            );
          await repository.enqueueIntegrationJob({
            integration: "jira-service-management",
            organizationId: command.organizationId,
            eventType: "support.create",
            deduplicationKey: `case:${supportCase.id}`,
            payload: {
              caseId: supportCase.id,
              organizationId: command.organizationId,
              ...(command.workspaceId ? { workspaceId: command.workspaceId } : {}),
              subject: command.title,
              redactedDescription: command.redactedDescription,
            },
          });
        }
      } else if (command.action === "case.close") {
        targetId = command.caseId;
        result = await repository.closeCase(command.caseId);
        organizationId = (result as { organizationId: string | null }).organizationId;
      } else if (command.action === "case.reconcile") {
        const supportCase = (await repository.listCases()).find(
          (entry) => entry.id === command.caseId,
        );
        if (!supportCase?.organizationId)
          throw new OperatorError(404, "NOT_FOUND", "Organization support case not found");
        const original = await repository.getIntegrationJobByDeduplication(
          "jira-service-management",
          `case:${supportCase.id}`,
        );
        if (
          !original ||
          original.id !== command.originalJobId ||
          original.state !== "ambiguous" ||
          original.eventType !== "support.create" ||
          original.organizationId !== supportCase.organizationId ||
          original.payload.caseId !== supportCase.id
        )
          throw new OperatorError(
            409,
            "RECONCILIATION_NOT_ALLOWED",
            "Only this case's ambiguous support creation may be reconciled to an existing request",
          );
        const job = await repository.enqueueIntegrationJob({
          integration: "jira-service-management",
          organizationId: supportCase.organizationId,
          eventType: "support.reconcile",
          deduplicationKey: `case-reconcile:${supportCase.id}:${command.idempotencyKey}`,
          payload: {
            caseId: supportCase.id,
            organizationId: supportCase.organizationId,
            originalJobId: original.id,
            issueId: command.issueId,
          },
        });
        organizationId = supportCase.organizationId;
        targetId = supportCase.id;
        before = { originalJobId: original.id, state: "ambiguous" };
        result = {
          jobId: job.id,
          originalJobId: original.id,
          issueId: command.issueId,
          verificationPending: true,
        };
      } else if (command.action === "case.sync") {
        const supportCase = (await repository.listCases()).find(
          (entry) => entry.id === command.caseId,
        );
        if (!supportCase) throw new OperatorError(404, "NOT_FOUND", "Support case not found");
        const creation = await repository.getIntegrationJobByDeduplication(
          "jira-service-management",
          `case:${supportCase.id}`,
        );
        const issueKey = creation?.result?.issueKey;
        if (
          creation?.state !== "complete" ||
          typeof issueKey !== "string" ||
          !creation.externalId ||
          !/^\d+$/.test(creation.externalId) ||
          !/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)
        )
          throw new OperatorError(
            409,
            "SUPPORT_NOT_LINKED",
            "A verified support creation receipt is required before status refresh",
          );
        const job = await repository.enqueueIntegrationJob({
          integration: "jira-service-management",
          organizationId: supportCase.organizationId,
          eventType: "support.status",
          deduplicationKey: `case-status:${supportCase.id}:${command.idempotencyKey}`,
          payload: { caseId: supportCase.id, issueKey, issueId: creation.externalId },
        });
        targetId = supportCase.id;
        organizationId = supportCase.organizationId;
        result = { jobId: job.id, issueKey };
      } else if (command.action === "integration.retry") {
        const job = integrationRetryJob;
        if (!job || job.state !== "failed")
          throw new OperatorError(
            409,
            "RETRY_NOT_ALLOWED",
            "Only a failed job can be retried; ambiguous provider creation requires reconciliation",
          );
        before = { state: job.state };
        organizationId = job.organizationId;
        targetId = job.id;
        const retried = await repository.retryIntegrationJob(job.id);
        result = { jobId: retried.id, integration: retried.integration, state: retried.state };
      } else if (command.action === "integration.connect") {
        if (!this.integrationSecretKey)
          throw new OperatorError(
            503,
            "SECRET_KEY_REQUIRED",
            "Integration encryption has not been configured",
          );
        if (
          command.integration === "jira-service-management" &&
          (!command.cloudId || !command.serviceDeskId || !command.requestTypeId)
        )
          throw new OperatorError(
            422,
            "PROVIDER_CONFIGURATION_REQUIRED",
            "Jira requires the approved cloud, service desk, and request type IDs",
          );
        if (command.integration === "quickbooks" && !command.realmId)
          throw new OperatorError(
            422,
            "PROVIDER_CONFIGURATION_REQUIRED",
            "QuickBooks requires the approved realm ID",
          );
        if (
          command.refreshToken &&
          (!command.clientId || !command.clientSecret || !command.expiresAt)
        )
          throw new OperatorError(
            422,
            "PROVIDER_CONFIGURATION_REQUIRED",
            "Refresh tokens require client credentials and an expiry",
          );
        targetId = command.integration;
        const credential = {
          accessToken: command.accessToken,
          ...(command.refreshToken ? { refreshToken: command.refreshToken } : {}),
          ...(command.clientId ? { clientId: command.clientId } : {}),
          ...(command.clientSecret ? { clientSecret: command.clientSecret } : {}),
          ...(command.expiresAt ? { expiresAt: command.expiresAt } : {}),
          ...(command.cloudId ? { cloudId: command.cloudId } : {}),
          ...(command.serviceDeskId ? { serviceDeskId: command.serviceDeskId } : {}),
          ...(command.requestTypeId ? { requestTypeId: command.requestTypeId } : {}),
          ...(command.realmId ? { realmId: command.realmId } : {}),
        };
        await repository.saveIntegrationConnection({
          id: command.integration,
          integration: command.integration,
          status: "connected",
          credentialCiphertext: encryptIntegrationSecret(credential, this.integrationSecretKey),
          configuration: {},
          updatedAt: new Date(),
        });
        result = { provider: command.integration, status: "connected", credentialConfigured: true };
      } else if (command.action === "integration.disconnect") {
        targetId = command.integration;
        await repository.saveIntegrationConnection({
          id: command.integration,
          integration: command.integration,
          status: "disconnected",
          credentialCiphertext: null,
          configuration: {},
          updatedAt: new Date(),
        });
        result = {
          provider: command.integration,
          status: "disconnected",
          credentialConfigured: false,
        };
      } else if (command.action === "integration.crm.designate") {
        const contact = await repository.getVerifiedOrganizationContact(
          command.organizationId,
          command.userId,
        );
        if (!contact)
          throw new OperatorError(
            404,
            "CONTACT_NOT_ELIGIBLE",
            "Select a verified member of this organization",
          );
        const organization = (await repository.listAllOrganizations(1000)).find(
          (entry) => entry.id === command.organizationId,
        );
        if (!organization) throw new OperatorError(404, "NOT_FOUND", "Organization not found");
        const job = await repository.enqueueIntegrationJob({
          integration: "hubspot",
          organizationId: organization.id,
          eventType: "crm.organization.upsert",
          deduplicationKey: `operator:${context.operator.id}:${command.idempotencyKey}`,
          payload: {
            organizationId: organization.id,
            name: organization.name,
            designatedContacts: [{ email: contact.email, authorized: true }],
          },
        });
        result = { jobId: job.id, userId: command.userId, designated: true };
        targetId = command.userId;
      } else if (command.action === "integration.accounting.reconcile") {
        requireOperatorCapability({ ...context, operator: currentOperator }, "billing.read");
        requireFreshOperator(context);
        if (
          command.startDate > command.endDate ||
          new Date(command.endDate).getTime() - new Date(command.startDate).getTime() >=
            366 * 86_400_000
        )
          throw new OperatorError(422, "INVALID_PERIOD", "Accounting dates are invalid");
        if (
          !(await repository.listAllOrganizations(1000)).some(
            (entry) => entry.id === command.organizationId,
          )
        )
          throw new OperatorError(404, "NOT_FOUND", "Organization not found");
        const connection = await repository.getIntegrationConnection("quickbooks");
        if (!connection)
          throw new OperatorError(
            409,
            "CONNECTION_REQUIRED",
            "Configure the approved QuickBooks connection first",
          );
        const mappings =
          connection.configuration.customerMappings &&
          typeof connection.configuration.customerMappings === "object"
            ? (connection.configuration.customerMappings as Record<string, unknown>)
            : {};
        const transactions = await repository.listStripeTransactionsForOperator(
          command.organizationId,
          new Date(`${command.startDate}T00:00:00.000Z`),
          new Date(`${command.endDate}T23:59:59.999Z`),
        );
        if (transactions.length > 10_000)
          throw new OperatorError(
            413,
            "PERIOD_TOO_LARGE",
            "Select a shorter accounting period with at most 10000 imported transactions",
          );
        const sourceIds = new Set(transactions.map((entry) => entry.id));
        const seenSources = new Set<string>();
        const seenDocuments = new Set<string>();
        for (const mapping of command.transactionMappings) {
          const documentKey = `${mapping.entity}:${mapping.externalId}`;
          if (
            !sourceIds.has(mapping.stripeTransactionId) ||
            seenSources.has(mapping.stripeTransactionId) ||
            seenDocuments.has(documentKey)
          )
            throw new OperatorError(
              422,
              "INVALID_MAPPING",
              "Each mapping must select one imported transaction in this organization and period, and a unique accounting document",
            );
          seenSources.add(mapping.stripeTransactionId);
          seenDocuments.add(documentKey);
        }
        await repository.saveIntegrationConnection({
          ...connection,
          configuration: {
            ...connection.configuration,
            customerMappings: { ...mappings, [command.organizationId]: command.externalCustomerId },
            transactionMappings: {
              ...(connection.configuration.transactionMappings &&
              typeof connection.configuration.transactionMappings === "object"
                ? connection.configuration.transactionMappings
                : {}),
              [command.organizationId]: command.transactionMappings,
            },
          },
          updatedAt: new Date(),
        });
        const job = await repository.enqueueIntegrationJob({
          integration: "quickbooks",
          organizationId: command.organizationId,
          eventType: "accounting.reconcile",
          deduplicationKey: `operator:${context.operator.id}:${command.idempotencyKey}`,
          payload: {
            organizationId: command.organizationId,
            externalCustomerId: command.externalCustomerId,
            startDate: command.startDate,
            endDate: command.endDate,
            homeCurrency: command.homeCurrency,
            snapshotAt: new Date().toISOString(),
            stripeTransactions: transactions.map(
              ({ organizationId: _organizationId, ...entry }) => ({
                ...entry,
                occurredAt: entry.occurredAt.toISOString(),
              }),
            ),
            transactionMappings: command.transactionMappings,
          },
        });
        result = { jobId: job.id, externalCustomerId: command.externalCustomerId, readOnly: true };
      } else if (command.action === "product.job.retry") {
        if (!(await repository.retryFailedProductJob(command.kind, command.jobId)))
          throw new OperatorError(
            409,
            "RETRY_NOT_ALLOWED",
            "This job is no longer failed or its source evidence is unavailable. Refresh the queue; authoring with erased or expired input requires a new upload.",
          );
        targetId = command.jobId;
        before = { state: "failed", kind: command.kind };
        result = { jobId: command.jobId, kind: command.kind, state: "pending" };
      } else if (command.action === "billing.job.retry") {
        if (!(await repository.retryBillingEvent(command.eventId)))
          throw new OperatorError(
            409,
            "RETRY_NOT_ALLOWED",
            "Only a failed billing event can be retried. Refresh before retrying.",
          );
        targetId = command.eventId;
        before = { state: "failed" };
        result = { eventId: command.eventId, state: "pending" };
      } else if (command.action === "worker.pause") {
        targetId = command.workerId;
        before = await repository.getWorkerControl(command.workerId);
        result = await repository.setWorkerControl(command.workerId, command.paused);
      } else if (command.action === "operators.update") {
        const operator = await repository.getOperator(command.operatorId);
        if (!operator) throw new OperatorError(404, "NOT_FOUND", "Operator not found");
        if (
          operator.active &&
          operator.role === "founder" &&
          (!command.active || command.role !== "founder") &&
          (await repository.listOperators()).filter(
            (entry) => entry.active && entry.role === "founder",
          ).length <= 1
        )
          throw new OperatorError(
            409,
            "LAST_FOUNDER",
            "The final active founder cannot be disabled or demoted",
          );
        before = { role: operator.role, active: operator.active };
        targetId = operator.id;
        await repository.provisionOperator({
          id: operator.id,
          issuer: operator.issuer,
          subject: operator.subject,
          name: operator.name,
          role: command.role,
          capabilities: [],
          active: command.active,
        });
        const revokedSessions = await repository.revokeOperatorSessions(operator.id);
        result = {
          operatorId: operator.id,
          role: command.role,
          active: command.active,
          revokedSessions,
        };
      } else {
        if (!(await repository.getOperator(command.operatorId)))
          throw new OperatorError(404, "NOT_FOUND", "Operator not found");
        targetId = command.operatorId;
        result = { revokedSessions: await repository.revokeOperatorSessions(command.operatorId) };
      }
      await repository.appendAuditEvent({
        actorId: context.operator.id,
        organizationId,
        action: command.action,
        targetId,
        reason: command.reason,
        requestId,
        before,
        after: result,
      });
      await repository.completeCommand(receipt.id, result);
      return result;
    });
  }
}

export async function readCompleteCreditLedgerExport(
  platform: PlatformRepository,
  organizationId: string,
  from: Date,
  to: Date,
) {
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    from > to ||
    to.getTime() - from.getTime() > 366 * 86_400_000
  )
    throw new OperatorError(
      422,
      "INVALID_PERIOD",
      "Choose a credit ledger period of at most 366 days",
    );
  const entries: Awaited<
    ReturnType<PlatformRepository["listCreditLedgerPageForOperator"]>
  >["entries"] = [];
  let cursor: string | undefined;
  do {
    const page = await platform.listCreditLedgerPageForOperator(organizationId, {
      from,
      to,
      cursor,
      limit: 1000,
    });
    entries.push(...page.entries);
    if (entries.length > 100_000 || (entries.length === 100_000 && page.nextCursor))
      throw new OperatorError(
        413,
        "PERIOD_TOO_LARGE",
        "This period exceeds 100000 entries; select a shorter period. No partial CSV was produced.",
      );
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return entries;
}

export function exportCreditLedgerCsv(
  entries: Array<{
    id: string;
    organizationId: string;
    delta: number;
    reason: string;
    sourceKey: string;
    createdAt: Date;
  }>,
): string {
  const cell = (value: string | number) =>
    `"${(typeof value === "number" ? String(value) : value.replace(/^[=+\-@\t\r\n]/, "'$&")).replaceAll('"', '""')}"`;
  return [
    "entry_id,organization_id,delta,reason,source_key,created_at",
    ...entries.map((entry) =>
      [
        entry.id,
        entry.organizationId,
        entry.delta,
        entry.reason,
        entry.sourceKey,
        entry.createdAt.toISOString(),
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\r\n");
}
