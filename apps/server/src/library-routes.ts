import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type {
  CreatorContext,
  LibraryMetadataRepository,
  LibraryArtifactDeletionResult,
  PresentationRepository,
  Repository,
  SurveyRepository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import { professionalFeatureUnavailable } from "./workspace-rollout.js";

const FavoriteParamsSchema = z.object({
  artifactType: z.enum(["round", "presentation", "survey"]),
  artifactId: z.string().uuid(),
});
const FavoriteMutationSchema = z.object({ favorite: z.boolean() });
const PresentationParamsSchema = z.object({ id: z.string().uuid() });
const PresentationOrganizationSchema = z.object({ folderId: z.string().uuid().nullable() });
const PresentationArchiveSchema = z.object({ archived: z.boolean().default(true) });

function apiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return reply.code(status).send({ error: { code, message, requestId } });
}

function requireEditor(creator: CreatorContext, reply: FastifyReply, requestId: string) {
  return creator.role === "owner" || creator.role === "editor"
    ? true
    : apiError(
        reply,
        403,
        "UNAUTHORIZED",
        "Your workspace role does not allow this action",
        requestId,
      );
}

function requireOwner(creator: CreatorContext, reply: FastifyReply, requestId: string) {
  return creator.role === "owner"
    ? true
    : apiError(
        reply,
        403,
        "UNAUTHORIZED",
        "Only workspace owners can permanently delete Library items",
        requestId,
      );
}

function deletionError(
  reply: FastifyReply,
  result: Exclude<LibraryArtifactDeletionResult, "deleted">,
  name: string,
  requestId: string,
) {
  if (result === "not_found")
    return apiError(reply, 404, "NOT_FOUND", `${name} not found`, requestId);
  if (result === "not_archived")
    return apiError(
      reply,
      409,
      "ARTIFACT_NOT_ARCHIVED",
      `Archive this ${name.toLowerCase()} before permanently deleting it`,
      requestId,
    );
  return apiError(
    reply,
    409,
    "ARTIFACT_IN_USE",
    `${name} is used by retained sessions or practice assignments. Delete the associated sessions first. If practice assignments exist, keep the ${name.toLowerCase()} archived to preserve them.`,
    requestId,
  );
}

export async function registerLibraryRoutes(
  app: FastifyInstance,
  dependencies: {
    repository: Repository;
    presentations: PresentationRepository;
    libraryMetadata: LibraryMetadataRepository;
    surveys: SurveyRepository;
    auth: AuthService;
    workspaceEnabled: (workspaceId: string) => boolean | Promise<boolean>;
    presentationsEnabled: (workspaceId: string) => boolean | Promise<boolean>;
  },
) {
  const {
    repository,
    presentations,
    libraryMetadata,
    auth,
    workspaceEnabled,
    presentationsEnabled,
  } = dependencies;

  async function requireLibraryWorkspace(
    creator: CreatorContext,
    reply: FastifyReply,
    requestId: string,
  ) {
    return (await workspaceEnabled(creator.workspaceId))
      ? true
      : professionalFeatureUnavailable(reply, requestId, "Library metadata not found");
  }

  app.get("/v1/library/favorites", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if ((await requireLibraryWorkspace(creator, reply, request.id)) !== true) return;
    const workspacePresentationsEnabled = await presentationsEnabled(creator.workspaceId);
    const favorites = (
      await libraryMetadata.listFavorites(creator.workspaceId, creator.userId)
    ).filter(
      (favorite) => favorite.artifactType !== "presentation" || workspacePresentationsEnabled,
    );
    return { favorites };
  });

  app.put("/v1/library/favorites/:artifactType/:artifactId", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if ((await requireLibraryWorkspace(creator, reply, request.id)) !== true) return;
    const { artifactType, artifactId } = FavoriteParamsSchema.parse(request.params);
    if (artifactType === "presentation" && !(await presentationsEnabled(creator.workspaceId))) {
      return apiError(reply, 404, "NOT_FOUND", "Library item not found", request.id);
    }
    const { favorite } = FavoriteMutationSchema.parse(request.body);
    if (favorite) {
      const artifact =
        artifactType === "round"
          ? await repository.getQuiz(creator.workspaceId, artifactId)
          : artifactType === "survey"
            ? await dependencies.surveys.get(creator.workspaceId, artifactId)
            : await presentations.getPresentation(creator.workspaceId, artifactId);
      if (!artifact) {
        return apiError(reply, 404, "NOT_FOUND", "Library item not found", request.id);
      }
    }
    const record = await libraryMetadata.setFavorite({
      workspaceId: creator.workspaceId,
      userId: creator.userId,
      artifactType,
      artifactId,
      favorite,
      now: new Date(),
    });
    if (favorite && !record) {
      return apiError(reply, 404, "NOT_FOUND", "Library item not found", request.id);
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: favorite ? "library.favorite.add" : "library.favorite.remove",
      targetType: artifactType === "round" ? "quiz" : artifactType,
      targetId: artifactId,
      requestId: request.id,
    });
    return { favorite: record };
  });

  app.delete("/v1/quizzes/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if ((await requireLibraryWorkspace(creator, reply, request.id)) !== true) return;
    if (requireOwner(creator, reply, request.id) !== true) return;
    const { id } = PresentationParamsSchema.parse(request.params);
    const result = await repository.deleteQuiz(creator.workspaceId, id);
    if (result !== "deleted") return deletionError(reply, result, "Round", request.id);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "quiz.delete",
      targetType: "quiz",
      targetId: id,
      requestId: request.id,
    });
    return reply.code(204).send();
  });

  app.delete("/v1/presentations/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if ((await requireLibraryWorkspace(creator, reply, request.id)) !== true) return;
    if (!(await presentationsEnabled(creator.workspaceId))) {
      return professionalFeatureUnavailable(reply, request.id, "Presentation not found");
    }
    if (requireOwner(creator, reply, request.id) !== true) return;
    const { id } = PresentationParamsSchema.parse(request.params);
    const result = await presentations.deletePresentation(creator.workspaceId, id);
    if (result !== "deleted") return deletionError(reply, result, "Presentation", request.id);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "presentation.delete",
      targetType: "presentation",
      targetId: id,
      requestId: request.id,
    });
    return reply.code(204).send();
  });

  app.patch("/v1/presentations/:id/organization", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if ((await requireLibraryWorkspace(creator, reply, request.id)) !== true) return;
    if (!(await presentationsEnabled(creator.workspaceId))) {
      return professionalFeatureUnavailable(reply, request.id, "Presentation not found");
    }
    if (requireEditor(creator, reply, request.id) !== true) return;
    const { id } = PresentationParamsSchema.parse(request.params);
    const { folderId } = PresentationOrganizationSchema.parse(request.body);
    const presentation = await presentations.organizePresentation(
      creator.workspaceId,
      id,
      folderId,
    );
    if (!presentation) {
      return apiError(
        reply,
        404,
        "NOT_FOUND",
        "Presentation or selected folder not found",
        request.id,
      );
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "presentation.organize",
      targetType: "presentation",
      targetId: presentation.id,
      requestId: request.id,
      metadata: { folderId },
    });
    return { presentation };
  });

  app.post("/v1/presentations/:id/archive", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if ((await requireLibraryWorkspace(creator, reply, request.id)) !== true) return;
    if (!(await presentationsEnabled(creator.workspaceId))) {
      return professionalFeatureUnavailable(reply, request.id, "Presentation not found");
    }
    if (requireEditor(creator, reply, request.id) !== true) return;
    const { id } = PresentationParamsSchema.parse(request.params);
    const { archived } = PresentationArchiveSchema.parse(request.body);
    const presentation = await presentations.archivePresentation(creator.workspaceId, id, archived);
    if (!presentation) {
      return apiError(reply, 404, "NOT_FOUND", "Presentation not found", request.id);
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: archived ? "presentation.archive" : "presentation.restore",
      targetType: "presentation",
      targetId: presentation.id,
      requestId: request.id,
    });
    return { presentation };
  });
}
