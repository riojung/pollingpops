import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AggregateSessionSummarySchema,
  CreatedSummaryShareSchema,
  CreateSummaryShareSchema,
  PresentationReportSchema,
  PublicSummaryExportRequestSchema,
  SessionSummaryPreviewSchema,
  SharedSessionSummarySchema,
  SummaryExportRequestSchema,
  SummaryShareListSchema,
  SummarySourceSchema,
  type AggregateSessionSummary,
  type SummaryCapabilities,
  type SummaryExportFormat,
  type SummarySource,
} from "@openround/contracts";
import {
  SessionSummaryError,
  type CreatorContext,
  type PresentationSessionRepository,
  type Repository,
  type SessionSummaryRepository,
  type SessionSummaryShareRecord,
  type SessionSummarySnapshotRecord,
  type SurveyRepository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { entitlementsFor } from "./entitlements.js";
import { roomEntitlements } from "./room-entitlements.js";
import { hashToken, opaqueToken } from "./security.js";
import {
  projectPresentationSummary,
  projectRoundSummary,
  projectSurveySummary,
  summaryPlainText,
} from "./session-summary-projection.js";
import {
  SessionSummaryExportError,
  type createSessionSummaryExportService,
} from "./session-summary-export.js";

const formats: SummaryExportFormat[] = ["pdf", "png", "xlsx"];
const SourceParams = SummarySourceSchema;
const ShareParams = z
  .object({ kind: SourceParams.shape.kind, id: z.string().uuid(), shareId: z.string().uuid() })
  .strict();
const PublicParams = z.object({ id: z.string().uuid() }).strict();

function metadata(share: SessionSummaryShareRecord) {
  return {
    id: share.id,
    createdAt: share.createdAt.toISOString(),
    expiresAt: share.expiresAt.toISOString(),
    revokedAt: share.revokedAt?.toISOString() ?? null,
    allowDownloads: share.allowDownloads,
  };
}

function failure(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

export async function registerSessionSummaryRoutes(
  app: FastifyInstance,
  deps: {
    auth: AuthService;
    config: AppConfig;
    repository: Repository;
    summaries: SessionSummaryRepository;
    presentationSessions: PresentationSessionRepository;
    surveys: SurveyRepository;
    exports: ReturnType<typeof createSessionSummaryExportService>;
    consumeAdmission: (key: string, maximum: number, windowMs: number) => Promise<boolean>;
  },
) {
  const creationEnabled = (workspaceId: string) =>
    deps.config.FEATURE_SESSION_SUMMARIES &&
    deps.config.CORE_PARITY_WORKSPACE_ALLOWLIST.includes(workspaceId);
  const unavailable = (reply: FastifyReply) =>
    failure(reply, 404, "SUMMARY_UNAVAILABLE", "This summary is unavailable or has expired");
  const readyRequired = (reply: FastifyReply) =>
    failure(
      reply,
      409,
      "SUMMARY_NOT_READY",
      "A completed, retained report is required for a summary",
    );
  const allowedExports = async (workspaceId: string, source: SummarySource) => {
    const entitlements =
      source.kind === "survey"
        ? entitlementsFor(
            deps.config.COMMUNITY_MODE ? "team" : await deps.repository.getPlan(workspaceId),
            deps.config,
          )
        : await roomEntitlements(deps.repository, deps.config, source.kind, source.id, workspaceId);
    return entitlements.csvExport;
  };
  const capabilities = async (
    actor: CreatorContext,
    source: SummarySource,
  ): Promise<SummaryCapabilities> => {
    const enabled = creationEnabled(actor.workspaceId);
    const writer = actor.role !== "viewer";
    const downloads = await allowedExports(actor.workspaceId, source);
    return {
      canCreateShare: enabled && writer && downloads,
      canRevokeShare: writer,
      downloadFormats: downloads ? formats : [],
      reasonCodes: [
        ...(!enabled ? ["feature_disabled" as const] : []),
        ...(!writer ? ["role" as const] : []),
        ...(!downloads ? ["exports_entitlement" as const] : []),
      ],
    };
  };
  const loadSource = async (
    workspaceId: string,
    source: SummarySource,
    now: Date,
  ): Promise<{ summary: AggregateSessionSummary; expiresAt: Date } | null> => {
    if (source.kind === "round") {
      const session = await deps.repository.getSessionById(source.id);
      if (
        !session ||
        session.workspaceId !== workspaceId ||
        session.retentionExpiresAt <= now ||
        session.state.phase !== "finished"
      )
        return null;
      const report = await deps.repository.getReportBySession(workspaceId, source.id);
      if (!report || report.status !== "ready" || new Date(report.expiresAt) <= now) return null;
      return {
        summary: projectRoundSummary(report, session.state.quiz, session.updatedAt.toISOString()),
        expiresAt: new Date(
          Math.min(session.retentionExpiresAt.getTime(), Date.parse(report.expiresAt)),
        ),
      };
    }
    if (source.kind === "presentation") {
      const session = await deps.presentationSessions.getSessionForWorkspace(
        workspaceId,
        source.id,
      );
      if (!session || session.status !== "finished" || session.retentionExpiresAt <= now)
        return null;
      const report = await deps.presentationSessions.getReport(workspaceId, source.id);
      if (!report || report.status !== "ready" || report.expiresAt <= now || !report.payload)
        return null;
      return {
        summary: projectPresentationSummary(PresentationReportSchema.parse(report.payload)),
        expiresAt: new Date(
          Math.min(session.retentionExpiresAt.getTime(), report.expiresAt.getTime()),
        ),
      };
    }
    const room = await deps.surveys.getRoom(source.id, workspaceId);
    if (
      !room ||
      Date.parse(room.expiresAt) <= now.getTime() ||
      (!room.closed && Date.parse(room.closesAt) > now.getTime())
    )
      return null;
    const report = await deps.surveys.results(workspaceId, source.id, now);
    const closedRoom = await deps.surveys.getRoom(source.id, workspaceId);
    if (!closedRoom?.closedAt) return null;
    return {
      summary: projectSurveySummary(report, closedRoom.closedAt),
      expiresAt: new Date(room.expiresAt),
    };
  };
  const preview = async (actor: CreatorContext, source: SummarySource, reply: FastifyReply) => {
    const existing = await deps.summaries.getSnapshot(actor.workspaceId, source);
    if (existing)
      return { summary: existing.summary, expiresAt: existing.expiresAt, snapshot: existing };
    if (!creationEnabled(actor.workspaceId)) {
      unavailable(reply);
      return null;
    }
    const value = await loadSource(actor.workspaceId, source, new Date());
    if (!value) {
      readyRequired(reply);
      return null;
    }
    return { ...value, snapshot: null };
  };
  const freeze = async (actor: CreatorContext, source: SummarySource, reply: FastifyReply) => {
    const value = await preview(actor, source, reply);
    if (!value) return null;
    const snapshot =
      value.snapshot ??
      (await deps.summaries.getOrCreateSnapshot({
        workspaceId: actor.workspaceId,
        source,
        actorId: actor.userId,
        summary: value.summary,
        expiresAt: value.expiresAt,
        now: new Date(),
      }));
    if (!snapshot) readyRequired(reply);
    return snapshot;
  };
  const budget = async (request: FastifyRequest, reply: FastifyReply, key: string, max: number) => {
    if (await deps.consumeAdmission(`summary:${key}:${request.ip}`, max, 60_000)) return true;
    failure(reply, 429, "RATE_LIMITED", "Too many requests. Wait a minute and retry");
    return false;
  };
  const publicShare = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = PublicParams.parse(request.params);
    if (!(await budget(request, reply, `public:${id}`, 60))) return null;
    const bearer = request.headers.authorization;
    if (!bearer || !/^Bearer [A-Za-z0-9_-]{43}$/.test(bearer)) {
      unavailable(reply);
      return null;
    }
    const tokenHash = hashToken(bearer.slice(7));
    const result = await deps.summaries.getPublicShare(id, tokenHash, new Date());
    if (!result) {
      unavailable(reply);
      return null;
    }
    return { ...result, tokenHash };
  };
  const render = async (
    request: FastifyRequest,
    reply: FastifyReply,
    snapshot: SessionSummarySnapshotRecord,
    summary: AggregateSessionSummary,
    input: z.infer<typeof PublicSummaryExportRequestSchema>,
    revalidate: () => Promise<boolean>,
  ) => {
    if (!(await budget(request, reply, `export:${snapshot.workspaceId}:${snapshot.source.id}`, 5)))
      return;
    if (
      input.questionIndex !== undefined &&
      !summary.questions.some((q) => q.index === input.questionIndex)
    )
      return failure(reply, 422, "VALIDATION_ERROR", "The selected question is unavailable");
    const controller = new AbortController();
    const disconnected = () => controller.abort();
    reply.raw.once("close", disconnected);
    request.raw.once("aborted", disconnected);
    try {
      const file = await deps.exports.render(AggregateSessionSummarySchema.parse(summary), {
        format: input.format,
        locale: input.locale,
        questionIndex: input.questionIndex,
        signal: controller.signal,
      });
      // A renderer may outlive revocation, source deletion, or a role change.
      if (!(await revalidate())) return unavailable(reply);
      return reply
        .header("content-type", file.contentType)
        .header(
          "content-disposition",
          `attachment; filename="pollingpops-${snapshot.source.kind}-summary.${file.extension}"`,
        )
        .send(file.bytes);
    } finally {
      reply.raw.off("close", disconnected);
      request.raw.off("aborted", disconnected);
    }
  };

  await app.register(async (scoped) => {
    scoped.addHook("onRequest", async (_request, reply) => {
      reply
        .header("cache-control", "private, no-store")
        .header("vary", "Authorization, Cookie, Origin")
        .header("x-robots-tag", "noindex, nofollow, noarchive")
        .header("referrer-policy", "no-referrer");
    });
    scoped.setErrorHandler((error, _request, reply) => {
      if (error instanceof SessionSummaryError)
        return failure(reply, error.code === "UNAVAILABLE" ? 404 : 409, error.code, error.message);
      if (error instanceof SessionSummaryExportError)
        return failure(reply, error.statusCode, error.code, error.message);
      if (error instanceof z.ZodError)
        return failure(
          reply,
          422,
          "VALIDATION_ERROR",
          "Invalid summary request or unavailable report evidence",
        );
      throw error;
    });
    scoped.get("/v1/session-summaries/features", async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      const source = SummarySourceSchema.parse(request.query);
      return {
        enabled:
          creationEnabled(actor.workspaceId) ||
          Boolean(await deps.summaries.getSnapshot(actor.workspaceId, source)),
      };
    });
    scoped.get("/v1/session-summaries/:kind/:id", async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      const source = SourceParams.parse(request.params);
      const value = await preview(actor, source, reply);
      if (!value) return;
      return SessionSummaryPreviewSchema.parse({
        source,
        summary: value.summary,
        sourceExpiresAt: value.expiresAt.toISOString(),
        capabilities: await capabilities(actor, source),
      });
    });
    scoped.get("/v1/session-summaries/:kind/:id/shares", async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      return SummaryShareListSchema.parse({
        shares: (
          await deps.summaries.listShares(actor.workspaceId, SourceParams.parse(request.params))
        ).map(metadata),
      });
    });
    scoped.post("/v1/session-summaries/:kind/:id/shares", async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      if (actor.role === "viewer")
        return failure(
          reply,
          403,
          "UNAUTHORIZED",
          "Your role allows viewing summaries, not publishing them",
        );
      const source = SourceParams.parse(request.params);
      const input = CreateSummaryShareSchema.parse(request.body);
      input.nextSteps = summaryPlainText(input.nextSteps);
      const intentHash = createHash("sha256")
        .update(
          JSON.stringify({
            source,
            expiresInDays: input.expiresInDays,
            allowDownloads: input.allowDownloads,
            nextSteps: input.nextSteps,
          }),
        )
        .digest("hex");
      const accepted = await deps.summaries.getShareIntent(
        actor.workspaceId,
        actor.userId,
        input.idempotencyKey,
      );
      if (accepted) {
        const snapshot = await deps.summaries.getSnapshot(actor.workspaceId, source);
        if (!snapshot || accepted.snapshotId !== snapshot.id || accepted.intentHash !== intentHash)
          throw new SessionSummaryError("IDEMPOTENCY_CONFLICT", "This sharing request has changed");
        return CreatedSummaryShareSchema.parse({
          share: metadata(accepted),
          url: null,
          replayed: true,
        });
      }
      const access = await capabilities(actor, source);
      if (!access.canCreateShare)
        return failure(
          reply,
          access.reasonCodes.includes("exports_entitlement") ? 402 : 404,
          "SUMMARY_SHARING_UNAVAILABLE",
          "Summary sharing is not available for this workspace",
        );
      if (!(await budget(request, reply, `create:${actor.workspaceId}:${actor.userId}`, 20)))
        return;
      const snapshot = await freeze(actor, source, reply);
      if (!snapshot) return;
      const token = opaqueToken();
      const result = await deps.summaries.createShare({
        workspaceId: actor.workspaceId,
        snapshotId: snapshot.id,
        actorId: actor.userId,
        ...input,
        intentHash,
        tokenHash: hashToken(token),
        now: new Date(),
      });
      const url = result.replayed
        ? null
        : `${deps.config.WEB_ORIGIN}/summary/${result.share.id}#token=${token}`;
      return reply.code(result.replayed ? 200 : 201).send(
        CreatedSummaryShareSchema.parse({
          share: metadata(result.share),
          url,
          replayed: result.replayed,
        }),
      );
    });
    scoped.delete("/v1/session-summaries/:kind/:id/shares/:shareId", async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      if (actor.role === "viewer")
        return failure(
          reply,
          403,
          "UNAUTHORIZED",
          "Your role allows viewing summaries, not revoking them",
        );
      const { kind, id, shareId } = ShareParams.parse(request.params);
      if (
        !(await deps.summaries.revokeShare(
          actor.workspaceId,
          { kind, id },
          shareId,
          actor.userId,
          new Date(),
        ))
      )
        return unavailable(reply);
      return reply.code(204).send();
    });
    scoped.post("/v1/session-summaries/:kind/:id/export", async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      const source = SourceParams.parse(request.params);
      const input = SummaryExportRequestSchema.parse(request.body);
      if (!(await allowedExports(actor.workspaceId, source)))
        return failure(
          reply,
          402,
          "ENTITLEMENT_LIMIT",
          "Report downloads are not included in this workspace or session",
        );
      const snapshot = await freeze(actor, source, reply);
      if (!snapshot) return;
      return render(
        request,
        reply,
        snapshot,
        { ...snapshot.summary, nextSteps: summaryPlainText(input.nextSteps) },
        input,
        async () =>
          !!(await deps.repository.getCreatorByUserId(actor.userId, actor.workspaceId)) &&
          !!(await deps.summaries.getSnapshot(actor.workspaceId, source)) &&
          (await allowedExports(actor.workspaceId, source)),
      );
    });
    scoped.get("/v1/shared-session-summaries/:id", async (request, reply) => {
      const value = await publicShare(request, reply);
      if (!value) return;
      return SharedSessionSummarySchema.parse({
        summary: { ...value.snapshot.summary, nextSteps: value.share.nextSteps },
        expiresAt: value.share.expiresAt.toISOString(),
        downloadFormats:
          value.share.allowDownloads &&
          (await allowedExports(value.snapshot.workspaceId, value.snapshot.source))
            ? formats
            : [],
      });
    });
    scoped.post("/v1/shared-session-summaries/:id/export", async (request, reply) => {
      const value = await publicShare(request, reply);
      if (!value) return;
      const input = PublicSummaryExportRequestSchema.parse(request.body);
      if (
        !value.share.allowDownloads ||
        !(await allowedExports(value.snapshot.workspaceId, value.snapshot.source))
      )
        return unavailable(reply);
      return render(
        request,
        reply,
        value.snapshot,
        { ...value.snapshot.summary, nextSteps: value.share.nextSteps },
        input,
        async () =>
          !!(await deps.summaries.getPublicShare(value.share.id, value.tokenHash, new Date())) &&
          (await allowedExports(value.snapshot.workspaceId, value.snapshot.source)),
      );
    });
  });
}
