import { workspaceFeatureEnabled } from "./feature-policy.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CreateRecoveryPackPracticeAssignmentSchema } from "@openround/contracts";
import type { RecoveryPackRepository, Repository } from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { workspaceEntitlements } from "./entitlements.js";
import type { ProductEventDispatcher } from "./product-events.js";
import { RecoveryPackPracticeService } from "./recovery-pack-practice-service.js";

const IdParams = z.object({ id: z.string().uuid() });

export async function registerRecoveryPackPracticeRoutes(
  app: FastifyInstance,
  dependencies: {
    config: AppConfig;
    repository: Repository;
    packs: RecoveryPackRepository;
    auth: AuthService;
    productEvents: ProductEventDispatcher;
  },
) {
  const { config, repository, packs, auth, productEvents } = dependencies;
  const practice = new RecoveryPackPracticeService(repository, packs);
  app.post("/v1/recovery-packs/:id/practice-assignments", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (creator.role === "viewer") {
      return reply.code(403).send({
        error: {
          code: "UNAUTHORIZED",
          message: "Your workspace role does not allow this action",
          requestId: request.id,
        },
      });
    }
    const { id } = IdParams.parse(request.params);
    const input = CreateRecoveryPackPracticeAssignmentSchema.parse(request.body);
    // Authentication/role still apply; exact recovery must precede flags, source and plan drift.
    let created: Awaited<ReturnType<RecoveryPackPracticeService["create"]>> | null =
      await practice.replay(creator, id, input);
    if (!created) {
      if (
        !(await workspaceFeatureEnabled(
          repository,
          config,
          creator.workspaceId,
          "recoveryPacks",
        )) ||
        !(await workspaceFeatureEnabled(
          repository,
          config,
          creator.workspaceId,
          "practiceAssignments",
        ))
      ) {
        return reply.code(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Recovery Pack practice is not available in this workspace",
            requestId: request.id,
          },
        });
      }
      const entitlements = await workspaceEntitlements(
        repository,
        config,
        creator.workspaceId,
        creator.plan,
      );
      if (!entitlements.followups) {
        return reply.code(402).send({
          error: {
            code: "ENTITLEMENT_LIMIT",
            message: "Practice assignments are available on the Pro plan",
            requestId: request.id,
          },
        });
      }
      created = await practice.create(
        creator,
        id,
        input,
        entitlements.reportRetentionDays,
        entitlements.maxPracticePersonalLinks,
        { requestId: request.id, segment: creator.segment },
      );
      // Creation, its audit, and its event are already one durable transaction. Metrics
      // observe only the actual insertion; replay never enqueues another persistence write.
      if (created.productEvent) {
        productEvents.recordPersisted(created.productEvent);
      }
    }
    const link = (token: string) =>
      `${config.WEB_ORIGIN}/followup/${created.followup.id}#token=${encodeURIComponent(token)}`;
    return reply.code(201).send({
      followup: created.followup,
      genericUrl: link(created.genericToken),
      personalAccess: created.personalAccess.map(({ token, ...access }) => ({
        ...access,
        url: link(token),
      })),
    });
  });
}
