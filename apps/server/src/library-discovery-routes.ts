import type { FastifyInstance } from "fastify";
import { LibraryItemsQuerySchema } from "@openround/contracts";
import {
  LibraryDiscoveryAuthorizationError,
  LibraryDiscoveryCursorError,
  type LibraryDiscoveryRepository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import { professionalFeatureUnavailable } from "./workspace-rollout.js";

export async function registerLibraryDiscoveryRoutes(
  app: FastifyInstance,
  dependencies: {
    discovery: LibraryDiscoveryRepository;
    auth: Pick<AuthService, "requireCreator">;
    workspaceEnabled: (workspaceId: string) => boolean | Promise<boolean>;
  },
) {
  app.get("/v1/library/items", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await dependencies.auth.requireCreator(request, reply);
    if (!creator) return;
    if (!(await dependencies.workspaceEnabled(creator.workspaceId)))
      return professionalFeatureUnavailable(reply, request.id, "Library metadata not found");
    const parsed = LibraryItemsQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid Library filters",
          requestId: request.id,
        },
      });
    try {
      return await dependencies.discovery.list({
        workspaceId: creator.workspaceId,
        userId: creator.userId,
        // Creation rollout flags do not revoke access to retained content.
        allowedKinds: ["round", "presentation", "survey"],
        query: parsed.data,
      });
    } catch (error) {
      if (error instanceof LibraryDiscoveryCursorError)
        return reply.code(400).send({
          error: { code: "VALIDATION_ERROR", message: error.message, requestId: request.id },
        });
      if (error instanceof LibraryDiscoveryAuthorizationError)
        return reply
          .code(403)
          .send({ error: { code: "UNAUTHORIZED", message: error.message, requestId: request.id } });
      throw error;
    }
  });
}
