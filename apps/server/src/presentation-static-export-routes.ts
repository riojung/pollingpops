import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  PresentationStaticExportRequestSchema,
  PresentationStaticExportSourceSchema,
  PresentationStaticExportFailureSchema,
} from "@openround/contracts";
import type { PresentationRepository, Repository } from "@openround/db";
import type { AuthService } from "./auth.js";
import type { StorageService } from "./storage.js";
import type { AppConfig } from "./config.js";
import { workspaceFeatureEnabled } from "./feature-policy.js";
import {
  PresentationStaticExportService,
  PresentationStaticExportRequestError,
  type PresentationStaticRenderer,
} from "./presentation-static-export-service.js";
const params = z
  .object({
    id: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
  })
  .strict();
const sourceQuery = z
  .object({
    versionId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
  })
  .strict();
function failure(reply: FastifyReply, error: PresentationStaticExportRequestError) {
  if (error.retryAfterSeconds) reply.header("retry-after", String(error.retryAfterSeconds));
  return reply.code(error.statusCode).send(
    PresentationStaticExportFailureSchema.parse({
      error: { code: error.code, message: error.message },
    }),
  );
}
export async function registerPresentationStaticExportRoutes(
  app: FastifyInstance,
  deps: {
    auth: Pick<AuthService, "requireCreator" | "creatorFromRequest">;
    repository: Repository;
    presentations: PresentationRepository;
    storage: Pick<StorageService, "readImage">;
    config: AppConfig;
    consumeAdmission: (key: string, max: number, windowMs: number) => Promise<boolean>;
    featureEnabled?: (workspaceId: string) => Promise<boolean>;
    render?: PresentationStaticRenderer;
    deadlineMs?: number;
  },
) {
  const service = new PresentationStaticExportService({
    repository: deps.repository,
    presentations: deps.presentations,
    storage: deps.storage,
    featureEnabled:
      deps.featureEnabled ??
      ((workspaceId) =>
        workspaceFeatureEnabled(deps.repository, deps.config, workspaceId, "presentations")),
    render: deps.render,
    deadlineMs: deps.deadlineMs,
  });
  await app.register(async (scoped) => {
    scoped.addHook("onRequest", async (_request, reply) => {
      reply
        .header("cache-control", "private, no-store")
        .header("pragma", "no-cache")
        .header("vary", "Authorization, Cookie, Origin")
        .header("referrer-policy", "no-referrer")
        .header("x-content-type-options", "nosniff")
        .header("x-robots-tag", "noindex, nofollow, noarchive");
    });
    scoped.setErrorHandler((error, _request, reply) => {
      if (error instanceof PresentationStaticExportRequestError) return failure(reply, error);
      if (error instanceof z.ZodError)
        return failure(
          reply,
          new PresentationStaticExportRequestError(
            "EXPORT_INVALID",
            422,
            "Choose a published version and a supported export format",
          ),
        );
      throw error;
    });
    scoped.get("/v1/presentations/:id/exports/source", async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      const { id } = params.parse(request.params),
        { versionId } = sourceQuery.parse(request.query);
      if (
        !(await deps.consumeAdmission(
          `presentation-static-source:${actor.workspaceId}:${actor.userId}`,
          60,
          60_000,
        ))
      )
        return failure(
          reply,
          new PresentationStaticExportRequestError(
            "EXPORT_RATE_LIMITED",
            429,
            "Too many export requests. Try again in a minute.",
            60,
          ),
        );
      return PresentationStaticExportSourceSchema.parse(
        await service.metadata(actor, id, versionId, {
          reauthorize: () => deps.auth.creatorFromRequest(request),
        }),
      );
    });
    scoped.post(
      "/v1/presentations/:id/exports",
      { bodyLimit: 1024 },
      async (request: FastifyRequest, reply) => {
        const actor = await deps.auth.requireCreator(request, reply);
        if (!actor) return;
        const { id } = params.parse(request.params),
          input = PresentationStaticExportRequestSchema.parse(request.body);
        if (
          !(await deps.consumeAdmission(
            `presentation-static-export:${actor.workspaceId}:${actor.userId}`,
            5,
            60_000,
          ))
        )
          return failure(
            reply,
            new PresentationStaticExportRequestError(
              "EXPORT_RATE_LIMITED",
              429,
              "Too many export requests. Try again in a minute.",
              60,
            ),
          );
        const controller = new AbortController();
        const disconnected = () => {
          if (!reply.raw.writableFinished) controller.abort();
        };
        request.raw.once("aborted", disconnected);
        reply.raw.once("close", disconnected);
        try {
          if (reply.raw.destroyed || request.raw.aborted) {
            controller.abort();
            return;
          }
          const result = await service.export(actor, id, input, {
            signal: controller.signal,
            reauthorize: () => deps.auth.creatorFromRequest(request),
          });
          if (reply.raw.destroyed || request.raw.aborted) return;
          return reply
            .header("content-type", result.contentType)
            .header(
              "content-disposition",
              `attachment; filename="polling-pops-presentation.${result.extension}"`,
            )
            .header("content-length", String(result.bytes.byteLength))
            .send(result.bytes);
        } catch (error) {
          if (reply.raw.destroyed || request.raw.aborted) return;
          throw error;
        } finally {
          request.raw.off("aborted", disconnected);
          reply.raw.off("close", disconnected);
        }
      },
    );
  });
  return service;
}
