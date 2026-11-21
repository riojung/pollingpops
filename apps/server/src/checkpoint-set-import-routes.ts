import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  CheckpointSetImportConfirmRequestSchema,
  CheckpointSetImportPreviewRequestSchema,
  CheckpointSetImportPreviewResponseSchema,
  CheckpointSetImportRequestSchema,
  requiresExtendedRoundResponses,
  type CheckpointSetImportRequest,
  type CheckpointSetImportUnavailableReason,
  type ImportValidationReport,
} from "@openround/contracts";
import {
  RoundImportError,
  roundArtifactSchemaVersion,
  type CreatorContext,
  type QuizRecord,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { workspaceEntitlementsWithAvailability } from "./entitlements.js";
import { workspaceFeatureEnabled } from "./feature-policy.js";
import { importCheckpointSet } from "./portability.js";
import { importQtiPackage } from "./qti.js";
import { EXTENDED_ROUND_RESPONSE_UNAVAILABLE_MESSAGE } from "./round-response-rollout.js";

// Bump when parser or preview semantics change; fingerprints never depend on generated IDs.
const IMPORT_PREVIEW_PROTOCOL = "round-structured-import-preview-v1";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function source(input: CheckpointSetImportRequest): CheckpointSetImportRequest {
  return {
    format: input.format,
    data: input.data,
    encoding: input.encoding,
    ...(input.title === undefined ? {} : { title: input.title }),
  };
}

function contextFor(creator: CreatorContext) {
  return {
    actorId: creator.userId.toLowerCase(),
    workspaceId: creator.workspaceId.toLowerCase(),
  };
}

function error(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: {
    unavailableReason: CheckpointSetImportUnavailableReason;
    creationContext: ReturnType<typeof contextFor>;
  },
) {
  return reply.code(status).send({ error: { code, message, requestId, details } });
}

export function registerCheckpointSetImportRoutes(
  app: FastifyInstance,
  { repository, config, auth }: { repository: Repository; config: AppConfig; auth: AuthService },
) {
  const options = { bodyLimit: 8_100_000 };
  const requireWriter = (creator: CreatorContext, reply: FastifyReply, requestId: string) => {
    if (["owner", "editor"].includes(creator.role)) return true;
    error(reply, 403, "UNAUTHORIZED", "Your workspace role does not allow this action", requestId);
    return false;
  };
  const authority = async (creator: CreatorContext) => {
    const [{ entitlements, unavailableReason }, roundClientProtocol] = await Promise.all([
      workspaceEntitlementsWithAvailability(
        repository,
        config,
        creator.workspaceId,
        creator.plan,
        "csvExport",
      ),
      workspaceFeatureEnabled(repository, config, creator.workspaceId, "roundClientProtocol"),
    ]);
    return {
      importEnabled: entitlements.csvExport,
      roundClientProtocol,
      unavailableReason,
    };
  };
  const requireEntitlement = (
    access: Awaited<ReturnType<typeof authority>>,
    creator: CreatorContext,
    reply: FastifyReply,
    requestId: string,
  ) => {
    if (access.importEnabled) return true;
    error(
      reply,
      402,
      "ENTITLEMENT_LIMIT",
      "Checkpoint-set import is unavailable for this workspace",
      requestId,
      access.unavailableReason
        ? { unavailableReason: access.unavailableReason, creationContext: contextFor(creator) }
        : undefined,
    );
    return false;
  };
  const fingerprintFor = (
    input: CheckpointSetImportRequest,
    creator: CreatorContext,
    access: Awaited<ReturnType<typeof authority>>,
  ) =>
    digest({
      protocol: IMPORT_PREVIEW_PROTOCOL,
      source: source(input),
      creationContext: contextFor(creator),
      authority: {
        importEnabled: access.importEnabled,
        roundClientProtocol: access.roundClientProtocol,
      },
    });

  async function validate(
    input: CheckpointSetImportRequest,
    creator: CreatorContext,
    access: Awaited<ReturnType<typeof authority>>,
  ) {
    const result =
      input.format === "qti3"
        ? await importQtiPackage(input.data, input.title)
        : importCheckpointSet(input.format, input.data, input.title);
    if (result.draft) {
      const addError = (code: string, message: string, field?: string) =>
        result.validation.errors.push({
          severity: "error",
          code,
          message,
          ...(field ? { field } : {}),
        });
      if (requiresExtendedRoundResponses(result.draft) && !access.roundClientProtocol)
        addError("ROUND_RESPONSE_UNAVAILABLE", EXTENDED_ROUND_RESPONSE_UNAVAILABLE_MESSAGE);
      if (
        result.draft.questions.filter(
          (question) => question.type === "open_text" || question.type === "word_cloud",
        ).length > 10
      )
        addError("TEXT_CHECKPOINT_LIMIT", "Use up to 10 text checkpoints in a Round");
      // Frozen Pack evidence is immutable. Check private baseline media without stripping it.
      const baselineMediaIds = new Set(
        (result.draft.recoveryPackInsertions ?? []).flatMap(({ originalContent, updateBaseline }) =>
          [originalContent, ...(updateBaseline ? [updateBaseline.content] : [])].flatMap(
            (content) =>
              [content.diagnostic, content.recheck, content.delayedProbe].flatMap((question) =>
                question?.mediaId ? [question.mediaId] : [],
              ),
          ),
        ),
      );
      for (const mediaId of baselineMediaIds) {
        const asset = await repository.getMediaAsset(creator.workspaceId, mediaId);
        if (!asset || asset.deletionStartedAt || asset.scanStatus === "rejected") {
          addError(
            "RECOVERY_PACK_MEDIA_UNAVAILABLE",
            "The frozen Pack baseline references private media unavailable in this workspace and was not imported.",
            "recoveryPackInsertions",
          );
          break;
        }
      }
    }
    if (result.validation.errors.length) result.draft = null;
    return result;
  }

  const draftRecord = (
    draft: NonNullable<Awaited<ReturnType<typeof validate>>["draft"]>,
    creator: CreatorContext,
  ): QuizRecord => {
    const now = new Date();
    return {
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      draftSchemaVersion: roundArtifactSchemaVersion(draft),
      lastEditedBy: creator.userId,
      currentVersionId: null,
      folderId: null,
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
  };
  const audit = (
    quiz: QuizRecord,
    creator: CreatorContext,
    input: CheckpointSetImportRequest,
    validation: ImportValidationReport,
    requestId: string,
  ) =>
    repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "quiz.import",
      targetType: "quiz",
      targetId: quiz.id,
      requestId,
      metadata: {
        format: input.format,
        importedCheckpoints: validation.importedCheckpoints,
        warningCount: validation.warnings.length,
      },
    });
  const validationFailure = (
    validation: ImportValidationReport,
    reply: FastifyReply,
    requestId: string,
    legacy = false,
  ) => {
    const writer = validation.errors.find(
      (issue) =>
        issue.code === "ROUND_RESPONSE_UNAVAILABLE" || issue.code === "TEXT_CHECKPOINT_LIMIT",
    );
    if (legacy && writer)
      return error(
        reply,
        writer.code === "ROUND_RESPONSE_UNAVAILABLE" ? 404 : 400,
        writer.code === "ROUND_RESPONSE_UNAVAILABLE" ? "NOT_FOUND" : "VALIDATION_ERROR",
        writer.message,
        requestId,
      );
    return reply.code(422).send({
      error: {
        code: "IMPORT_VALIDATION_FAILED",
        message: "The checkpoint set could not be imported. Review the validation details.",
        requestId,
      },
      validation,
    });
  };

  app.post("/v1/quizzes/import/preview", options, async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const creator = await auth.requireCreator(request, reply);
    if (!creator || !requireWriter(creator, reply, request.id)) return;
    const input = CheckpointSetImportPreviewRequestSchema.parse(request.body);
    const access = await authority(creator);
    if (!requireEntitlement(access, creator, reply, request.id)) return;
    const result = await validate(input, creator, access);
    return CheckpointSetImportPreviewResponseSchema.parse({
      ...result,
      sourceDigest: digest(source(input)),
      previewFingerprint: fingerprintFor(input, creator, access),
      creationContext: contextFor(creator),
    });
  });

  app.post("/v1/quizzes/import/confirm", options, async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const input = CheckpointSetImportConfirmRequestSchema.parse(request.body);
    const creationContext = contextFor(creator);
    if (
      input.creationContext.actorId !== creationContext.actorId ||
      input.creationContext.workspaceId !== creationContext.workspaceId
    )
      return error(
        reply,
        409,
        "IMPORT_CONTEXT_CHANGED",
        "The account or workspace changed. Preview this import again in the current workspace.",
        request.id,
      );
    const identity = {
      ...creationContext,
      idempotencyKey: input.idempotencyKey,
      requestHash: digest({
        source: source(input),
        creationContext,
        previewFingerprint: input.previewFingerprint,
      }),
    };
    try {
      // Recover a committed draft before writer/entitlement checks: a lost acknowledgement
      // must remain recoverable after a writer rollback or plan/role change.
      const recovered = await repository.getImportedQuiz(identity);
      if (recovered)
        return {
          quiz: recovered,
          validation: {
            format: input.format,
            importedCheckpoints: recovered.draft.questions.length,
            errors: [],
            warnings: [],
          },
          replayed: true,
        };
      if (!requireWriter(creator, reply, request.id)) return;
      const access = await authority(creator);
      if (!requireEntitlement(access, creator, reply, request.id)) return;
      if (input.previewFingerprint !== fingerprintFor(input, creator, access))
        return error(
          reply,
          409,
          "IMPORT_PREVIEW_STALE",
          "The import content or available features changed. Preview this import again before creating a draft.",
          request.id,
        );
      const result = await validate(input, creator, access);
      if (!result.draft) return validationFailure(result.validation, reply, request.id);
      const created = await repository.createImportedQuiz(
        draftRecord(result.draft, creator),
        identity,
      );
      if (created.status === "created")
        await audit(created.quiz, creator, input, result.validation, request.id);
      return reply.code(created.status === "created" ? 201 : 200).send({
        quiz: created.quiz,
        validation: result.validation,
        replayed: created.status === "duplicate",
      });
    } catch (caught) {
      if (!(caught instanceof RoundImportError)) throw caught;
      return error(
        reply,
        caught.code === "UNAUTHORIZED" ? 403 : 409,
        caught.code,
        caught.message,
        request.id,
      );
    }
  });

  app.post("/v1/quizzes/import", options, async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator || !requireWriter(creator, reply, request.id)) return;
    const access = await authority(creator);
    if (!requireEntitlement(access, creator, reply, request.id)) return;
    const input = CheckpointSetImportRequestSchema.parse(request.body);
    const result = await validate(input, creator, access);
    if (!result.draft) return validationFailure(result.validation, reply, request.id, true);
    const quiz = await repository.createQuiz(draftRecord(result.draft, creator));
    await audit(quiz, creator, input, result.validation, request.id);
    return reply.code(201).send({ quiz, validation: result.validation });
  });
}
