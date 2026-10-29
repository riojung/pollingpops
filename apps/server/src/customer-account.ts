import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  CustomerSetupSchema,
  UpdateWorkspaceSettingsSchema,
  WorkspaceAccountContextSchema,
  type WorkspaceAccountContext,
} from "@openround/contracts";
import {
  createPlatformRepository,
  PlatformError,
  type CreatorContext,
  type OrganizationRecord,
  type OrganizationWorkspaceRecord,
  type Repository,
} from "@openround/db";
import { z } from "zod";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";

const requestKeySchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9:_-]+$/);

export async function workspaceAccountContext(
  repository: Repository,
  config: AppConfig,
  creator: CreatorContext,
): Promise<WorkspaceAccountContext> {
  const platform = createPlatformRepository(repository);
  const [workspaces, organization, organizations] = await Promise.all([
    repository.listWorkspaces(creator.userId),
    platform.getOrganizationForWorkspace(creator.workspaceId),
    platform.listOrganizations(creator.userId),
  ]);
  const workspace = workspaces.find((candidate) => candidate.id === creator.workspaceId);
  if (!workspace)
    throw new PlatformError("UNAUTHORIZED", "The selected workspace is no longer available");
  const accountType = organization?.accountType ?? "personal";
  const membership = organizations.find((candidate) => candidate.id === organization?.id);
  const role = membership?.role ?? null;
  const active = !organization || organization.status === "active";
  const administerOrganization = active && (role === "owner" || role === "admin");
  const ownsWorkspace = active && creator.role === "owner";
  return WorkspaceAccountContextSchema.parse({
    id: workspace.id,
    name: workspace.name,
    accountType,
    licenseUnit: organization?.licenseUnit ?? "workspace",
    planSource: config.COMMUNITY_MODE
      ? "community"
      : creator.plan === "free"
        ? "free"
        : "subscription",
    organization:
      accountType === "organization" && organization
        ? { id: organization.id, name: organization.name, role }
        : null,
    permissions: {
      manageWorkspace: ownsWorkspace || administerOrganization,
      managePeople: accountType === "organization" ? administerOrganization : ownsWorkspace,
      manageBilling: role === "owner" || role === "admin" || role === "billing",
      manageIntegrations: accountType === "organization" ? administerOrganization : ownsWorkspace,
    },
  });
}

export function registerCustomerAccountRoutes(
  app: FastifyInstance,
  { repository, config, auth }: { repository: Repository; config: AppConfig; auth: AuthService },
) {
  const platform = createPlatformRepository(repository);
  app.patch("/v1/workspace/settings", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { name } = UpdateWorkspaceSettingsSchema.parse(request.body);
    await platform.renameWorkspace(creator.workspaceId, creator.userId, name);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "workspace.settings.update",
      targetType: "workspace",
      targetId: creator.workspaceId,
      requestId: request.id,
      metadata: { name },
    });
    return { workspace: await workspaceAccountContext(repository, config, creator) };
  });

  app.post("/v1/customer/setup", async (request, reply) => {
    const user = await auth.requireUser(request, reply);
    if (!user) return;
    const input = CustomerSetupSchema.parse(request.body);
    if (
      input.accountType === "organization" &&
      (!config.BUSINESS_PLATFORM_ENABLED || config.COMMUNITY_MODE)
    )
      throw new PlatformError(
        "FORBIDDEN",
        "Organization accounts are unavailable in this deployment",
      );
    const idempotencyKey = requestKeySchema.parse(request.headers["x-idempotency-key"]);
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const result = await platform.withTransaction(async (scoped) => {
      const started = await scoped.beginCommand({
        actorId: user.userId,
        idempotencyKey,
        requestHash,
      });
      if (!started.created) {
        if (started.receipt.state === "complete")
          return started.receipt.result as {
            organization: OrganizationRecord;
            workspace: OrganizationWorkspaceRecord;
          };
        throw new PlatformError("CONFLICT", "Account setup is already in progress. Retry shortly.");
      }
      let organization: OrganizationRecord | null = null;
      let workspace: OrganizationWorkspaceRecord | null = null;
      if (input.accountType === "personal") {
        const memberships = await repository.listWorkspaces(user.userId);
        for (const candidate of memberships.filter((item) => item.role === "owner")) {
          const account = await scoped.getOrganizationForWorkspace(candidate.id);
          if (account?.accountType === "personal") {
            organization = account;
            workspace =
              (await scoped.listOrganizationWorkspaces(account.id, user.userId)).find(
                (item) => item.id === candidate.id,
              ) ?? null;
            if (workspace) break;
          }
        }
      }
      if (!organization || !workspace) {
        const workspaceName = input.workspaceName ?? "Personal workspace";
        organization = await scoped.createOrganization({
          id: randomUUID(),
          name: input.accountType === "organization" ? input.name : workspaceName,
          actorId: user.userId,
          accountType: input.accountType,
          licenseUnit: input.accountType === "organization" ? "user" : "workspace",
        });
        workspace = await scoped.createOrganizationWorkspace({
          organizationId: organization.id,
          actorId: user.userId,
          name: workspaceName,
          segment: input.segment,
        });
        if (input.accountType === "organization")
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
      }
      const created = { organization, workspace };
      await scoped.appendAuditEvent({
        actorId: user.userId,
        organizationId: organization.id,
        action: "customer.account_configured",
        targetId: organization.id,
        reason: "Customer selected account type and workspace",
        requestId: request.id,
        before: null,
        after: { accountType: input.accountType, workspaceId: workspace.id },
      });
      await scoped.completeCommand(started.receipt.id, created);
      return created;
    });
    if (!(await auth.switchWorkspace(request, user, result.workspace.id)))
      throw new PlatformError("CONFLICT", "The workspace is ready. Select it again to continue.");
    return reply.code(201).send({ ...result, activeWorkspaceId: result.workspace.id });
  });
}
