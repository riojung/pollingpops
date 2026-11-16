import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  CreatePresentationVisualImportSchema,
  InsertPresentationVisualImportSchema,
  PRESENTATION_VISUAL_IMPORT_MAX_IMAGE_BYTES,
  PRESENTATION_VISUAL_IMPORT_MAX_PAGES,
  PRESENTATION_VISUAL_IMPORT_MAX_PDF_BYTES,
  PRESENTATION_VISUAL_IMPORT_MAX_TOTAL_BYTES,
} from "@openround/contracts";
import {
  PresentationDraftConflictError,
  PresentationMutationConflictError,
  PresentationVisualImportError as RepositoryImportError,
  type CreatorContext,
  type PresentationRepository,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { StorageService } from "./storage.js";
import {
  PresentationVisualImportError,
  type PresentationVisualImportService,
} from "./presentation-visual-import-service.js";

const Params = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid().optional(),
  pageNumber: z.coerce.number().int().min(1).max(40).optional(),
});
function failure(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return reply.code(status).send({ error: { code, message, requestId } });
}

export async function registerPresentationVisualImportRoutes(
  app: FastifyInstance,
  deps: {
    repository: Repository;
    presentations: PresentationRepository;
    auth: AuthService;
    service: PresentationVisualImportService;
    storage: StorageService;
    workspaceEnabled: (workspaceId: string, plan?: CreatorContext["plan"]) => Promise<boolean>;
  },
) {
  const { repository, presentations, auth, service, storage } = deps;
  const base = "/v1/presentations/:id/visual-imports";
  const editor = (creator: CreatorContext, reply: FastifyReply, requestId: string) => {
    if (creator.role === "owner" || creator.role === "editor") return true;
    failure(
      reply,
      403,
      "UNAUTHORIZED",
      "Your workspace role does not allow this action",
      requestId,
    );
    return false;
  };
  const safe = async (reply: FastifyReply, requestId: string, run: () => Promise<unknown>) => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof PresentationVisualImportError)
        return failure(reply, error.status, error.code, error.message, requestId);
      if (error instanceof RepositoryImportError)
        return failure(
          reply,
          error.code === "NOT_FOUND" ? 404 : error.code === "LIMIT_REACHED" ? 429 : 409,
          error.code,
          error.code === "LIMIT_REACHED"
            ? "The workspace import limit was reached. Cancel an active import or try again tomorrow."
            : error.message,
          requestId,
        );
      if (error instanceof PresentationDraftConflictError)
        return failure(
          reply,
          409,
          "STALE_DRAFT",
          "This presentation changed. Reload it before inserting pages.",
          requestId,
        );
      if (error instanceof PresentationMutationConflictError)
        return failure(
          reply,
          409,
          "CONFLICT",
          "This mutation ID belongs to a different presentation change",
          requestId,
        );
      if (error instanceof z.ZodError) throw error;
      // Storage/parser/database exceptions can contain source bytes or failing-row details.
      app.log.error(
        { requestId, errorType: error instanceof Error ? error.name : "unknown" },
        "visual import operation deferred",
      );
      return failure(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Visual import could not finish. Retry this request or try again later.",
        requestId,
      );
    }
  };
  app.get(base, async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = Params.parse(request.params);
    if (!(await presentations.getPresentation(creator.workspaceId, id)))
      return failure(reply, 404, "NOT_FOUND", "Presentation not found", request.id);
    reply.header("cache-control", "private, no-store");
    return {
      available:
        service.available &&
        (await repository.getOperationalFeatures()).mediaUploads &&
        (await deps.workspaceEnabled(creator.workspaceId, creator.plan)),
      jobs: await service.imports.list(creator.workspaceId, id),
      limits: {
        maxPdfBytes: PRESENTATION_VISUAL_IMPORT_MAX_PDF_BYTES,
        maxImageBytes: PRESENTATION_VISUAL_IMPORT_MAX_IMAGE_BYTES,
        maxImageSetBytes: PRESENTATION_VISUAL_IMPORT_MAX_TOTAL_BYTES,
        maxPages: PRESENTATION_VISUAL_IMPORT_MAX_PAGES,
      },
    };
  });
  app.post(
    base,
    { bodyLimit: 28_100_000, config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      const creator = await auth.requireCreator(request, reply);
      if (!creator || !editor(creator, reply, request.id)) return;
      const { id } = Params.parse(request.params);
      const input = CreatePresentationVisualImportSchema.parse(request.body);
      return safe(reply, request.id, async () => {
        const job = await service.create(
          creator,
          id,
          input,
          await deps.workspaceEnabled(creator.workspaceId, creator.plan),
        );
        await repository.recordAudit({
          workspaceId: creator.workspaceId,
          actorId: creator.userId,
          action: "presentation.visual_import.create",
          targetType: "presentation",
          targetId: id,
          requestId: request.id,
          metadata: { jobId: job.id, sourceType: job.sourceType, fileCount: job.fileCount },
        });
        return reply.header("cache-control", "private, no-store").code(202).send({ job });
      });
    },
  );
  app.get(`${base}/:jobId`, async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id, jobId } = Params.parse(request.params);
    const job = await service.imports.get(creator.workspaceId, id, jobId!);
    if (!job)
      return failure(
        reply,
        404,
        "NOT_FOUND",
        "Visual import not found or expired. Upload the source again.",
        request.id,
      );
    return reply.header("cache-control", "private, no-store").send({ job });
  });
  app.delete(`${base}/:jobId`, async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator || !editor(creator, reply, request.id)) return;
    const { id, jobId } = Params.parse(request.params);
    const job = await service.imports.cancel(creator.workspaceId, id, jobId!);
    if (!job) return failure(reply, 404, "NOT_FOUND", "Visual import not found", request.id);
    return reply.header("cache-control", "private, no-store").send({ job });
  });
  app.get(`${base}/:jobId/pages/:pageNumber`, async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id, jobId, pageNumber } = Params.parse(request.params);
    const job = await service.imports.get(creator.workspaceId, id, jobId!);
    const page =
      job?.status === "ready"
        ? job.pages.find((candidate) => candidate.pageNumber === pageNumber)
        : undefined;
    const asset = page ? await repository.getMediaAsset(creator.workspaceId, page.mediaId) : null;
    if (!asset || asset.scanStatus !== "clean")
      return failure(reply, 404, "NOT_FOUND", "Converted page not found", request.id);
    return reply
      .header("cache-control", "private, no-store")
      .send({ downloadUrl: await storage.createDownloadUrl(asset) });
  });
  app.post(`${base}/:jobId/insert`, { bodyLimit: 1_000_000 }, async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator || !editor(creator, reply, request.id)) return;
    const { id, jobId } = Params.parse(request.params);
    const input = InsertPresentationVisualImportSchema.parse(request.body);
    return safe(reply, request.id, async () => {
      const result = await service.insert(
        creator,
        id,
        jobId!,
        input,
        await deps.workspaceEnabled(creator.workspaceId, creator.plan),
      );
      await repository.recordAudit({
        workspaceId: creator.workspaceId,
        actorId: creator.userId,
        action: "presentation.visual_import.insert",
        targetType: "presentation",
        targetId: id,
        requestId: request.id,
        metadata: {
          jobId,
          pageCount: input.pages.length,
          blockCount: result.insertedBlockIds.length,
        },
      });
      return reply.header("etag", `"draft-${result.presentation.draftRevision}"`).send(result);
    });
  });
}
