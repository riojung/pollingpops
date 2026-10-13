import type { FastifyInstance } from "fastify";
import { createPlatformRepository, type Repository } from "@openround/db";
import type { AppConfig } from "./config.js";
import type { AuthService } from "./auth.js";
import { entitlementsFor } from "./entitlements.js";
import { roomEntitlements } from "./room-entitlements.js";
import { z } from "zod";

export async function registerRoomFundingRoutes(
  app: FastifyInstance,
  dependencies: { repository: Repository; config: AppConfig; auth: AuthService },
) {
  app.get("/v1/sessions/:id/entitlements", async (request, reply) => {
    const creator = await dependencies.auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const session = await dependencies.repository.getSessionById(id);
    if (!session || session.workspaceId !== creator.workspaceId) {
      return reply.code(404).send({
        error: { code: "NOT_FOUND", message: "Session not found", requestId: request.id },
      });
    }
    reply.header("cache-control", "private, no-store");
    return {
      entitlements: await roomEntitlements(
        dependencies.repository,
        dependencies.config,
        "round",
        id,
        creator.workspaceId,
      ),
    };
  });
  app.get("/v1/workspaces/current/room-funding", async (request, reply) => {
    const creator = await dependencies.auth.requireCreator(request, reply);
    if (!creator) return;
    reply.header("cache-control", "private, no-store");
    const enabled =
      dependencies.config.BUSINESS_PLATFORM_ENABLED &&
      dependencies.config.BUSINESS_EVENT_CREDITS_ENABLED &&
      !dependencies.config.COMMUNITY_MODE;
    if (!enabled) return { enabled: false, coveredBySubscription: false, availableCredits: 0 };
    const platform = createPlatformRepository(dependencies.repository);
    const organization = await platform.getOrganizationForWorkspace(creator.workspaceId);
    if (!organization || organization.status !== "active") {
      return { enabled: false, coveredBySubscription: false, availableCredits: 0 };
    }
    const balance = await platform.getCreditBalance(organization.id);
    return {
      enabled: true,
      coveredBySubscription: await platform.workspaceHasLicense(creator.workspaceId),
      availableCredits: balance.available,
      eventEntitlements: entitlementsFor("pro", dependencies.config),
    };
  });
}
