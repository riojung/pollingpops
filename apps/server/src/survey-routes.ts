import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { StarterIdSchema } from "@openround/contracts";
import {
  SurveyDraftSchema,
  SurveyMutationSchema,
  SurveyRoomCreateSchema,
  SurveyAttemptMutationSchema,
} from "@openround/contracts/surveys";
import {
  PublishedQuizLimitError,
  SessionCodeConflictError,
  SurveyError,
  type Repository,
  type SurveyRepository,
} from "@openround/db";
import type { AppConfig } from "./config.js";
import type { AuthService } from "./auth.js";
import { coreParityCreationEnabled } from "./core-parity-rollout.js";
import { entitlementsFor } from "./entitlements.js";
import { hashToken } from "./security.js";
import { instantiateStarter, starterSummaries } from "./starters.js";

const Id = z.object({ id: z.string().uuid() }).strict();
const Key = z
  .object({ idempotencyKey: z.string().uuid(), expectedRevision: z.number().int().nonnegative() })
  .strict();
const Create = z
  .object({
    idempotencyKey: z.string().uuid(),
    title: z.string().trim().min(1).max(160).default("Untitled survey"),
    templateId: StarterIdSchema.optional(),
    sourceId: z.string().uuid().optional(),
  })
  .strict()
  .refine((value) => !(value.templateId && value.sourceId), "Choose one source");
const Page = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(50),
  })
  .strict();
const Join = z.object({ code: z.string().regex(/^\d{7}$/) }).strict();
function publicRoom(room: {
  id: string;
  surveyId: string;
  code: string;
  content: { title: string };
  closesAt: string;
  expiresAt: string;
  closed: boolean;
}) {
  return {
    id: room.id,
    surveyId: room.surveyId,
    code: room.code,
    title: room.content.title,
    closesAt: room.closesAt,
    expiresAt: room.expiresAt,
    closed: room.closed,
    identityPolicy: "organizer_blind",
    delivery: "self_paced",
  };
}

export async function registerSurveyRoutes(
  app: FastifyInstance,
  deps: {
    auth: AuthService;
    config: AppConfig;
    repository: Repository;
    surveys: SurveyRepository;
    consumeAdmission: (key: string, maximum: number, windowMs: number) => Promise<boolean>;
  },
) {
  await app.register(async (scoped) => {
    scoped.setErrorHandler((error, request, reply) => {
      if (error instanceof SurveyError || error instanceof PublishedQuizLimitError) {
        const code = error instanceof SurveyError ? error.code : "ENTITLEMENT_LIMIT";
        return reply
          .code(
            code === "NOT_FOUND"
              ? 404
              : code === "UNAUTHORIZED"
                ? 401
                : code === "RATE_LIMITED"
                  ? 429
                  : code === "VALIDATION_ERROR"
                    ? 422
                    : 409,
          )
          .send({
            error: {
              code,
              message:
                error instanceof PublishedQuizLimitError
                  ? `Your plan allows ${error.limit} published Rounds and Surveys combined. Archive an item or upgrade before publishing.`
                  : error.message,
              requestId: request.id,
            },
          });
      }
      throw error;
    });
    scoped.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store");
    });
    const creator = async (
      request: Parameters<AuthService["requireCreator"]>[0],
      reply: Parameters<AuthService["requireCreator"]>[1],
      edit = false,
      create = false,
    ) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return null;
      if (edit && actor.role === "viewer") {
        reply.code(403).send({
          error: {
            code: "UNAUTHORIZED",
            message: "Your role allows viewing surveys, not editing or sharing them",
          },
        });
        return null;
      }
      if (create && !coreParityCreationEnabled(deps.config, actor.workspaceId, "surveys")) {
        reply.code(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Survey creation is not enabled for this workspace yet",
          },
        });
        return null;
      }
      return actor;
    };
    const guestHash = async (request: Parameters<AuthService["requireCreator"]>[0]) => {
      if (!(await deps.consumeAdmission(`survey-ip:${request.ip}`, 600, 60000)))
        throw new SurveyError("RATE_LIMITED", "Too many requests. Wait a minute and retry");
      const authorization = request.headers.authorization;
      if (!authorization || !/^Bearer [a-f0-9]{64}$/.test(authorization))
        throw new SurveyError("UNAUTHORIZED", "Join this survey to receive room-scoped access");
      const tokenHash = hashToken(authorization.slice(7));
      if (!(await deps.consumeAdmission(`survey-guest:${tokenHash}`, 120, 60000)))
        throw new SurveyError("RATE_LIMITED", "Too many requests. Wait a minute and retry");
      return tokenHash;
    };
    scoped.get("/v1/surveys", async (request, reply) => {
      const actor = await creator(request, reply);
      if (!actor) return;
      const input = Page.parse(request.query);
      const all = (await deps.surveys.list(actor.workspaceId))
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((row) => !input.cursor || row.id > input.cursor);
      const page = all.slice(0, input.limit);
      return { surveys: page, nextCursor: all.length > input.limit ? page.at(-1)!.id : null };
    });
    scoped.post("/v1/surveys", async (request, reply) => {
      const actor = await creator(request, reply, true, true);
      if (!actor) return;
      const input = Create.parse(request.body);
      let draft = SurveyDraftSchema.parse({ schemaVersion: 1, title: input.title, items: [] });
      if (input.templateId) {
        const template = instantiateStarter(input.templateId);
        if (!template.questions.every((q) => q.type === "poll" || q.type === "rating"))
          throw new SurveyError(
            "VALIDATION_ERROR",
            "Choose a poll or feedback template for a Survey",
          );
        draft = SurveyDraftSchema.parse({
          schemaVersion: 1,
          title: template.title,
          description: "Answer independently at your own pace. This Survey is unscored.",
          category: template.category,
          experiencePreset: template.experiencePreset,
          items: template.questions.map((question) => ({ required: true, question })),
        });
      }
      if (input.sourceId) {
        const source = await deps.surveys.get(actor.workspaceId, input.sourceId);
        if (!source) throw new SurveyError("NOT_FOUND", "Survey not found");
        draft = structuredClone(source.draft);
        draft.title = `${draft.title.slice(0, 150)} (copy)`;
      }
      // Stable IDs make a lost creation response retryable without exposing credentials.
      for (const [index, item] of draft.items.entries()) {
        item.question.id = stableId(`${input.idempotencyKey}:question:${index}`);
        if ("choices" in item.question)
          item.question.choices.forEach((choice, offset) => {
            choice.id = stableId(`${input.idempotencyKey}:choice:${index}:${offset}`);
          });
      }
      const survey = await deps.surveys.create(
        actor.workspaceId,
        input.idempotencyKey,
        draft,
        input.idempotencyKey,
      );
      await deps.repository.recordAudit({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "survey.created",
        targetType: "survey",
        targetId: survey.id,
        requestId: request.id,
        metadata: {},
      });
      return reply.code(201).send({ survey });
    });
    scoped.get("/v1/surveys/templates", async (request, reply) => {
      if (!(await creator(request, reply))) return;
      return { templates: starterSummaries.filter((s) => s.roundType === "poll") };
    });
    scoped.get("/v1/surveys/:id", async (request, reply) => {
      const actor = await creator(request, reply);
      if (!actor) return;
      const survey = await deps.surveys.get(actor.workspaceId, Id.parse(request.params).id);
      if (!survey) throw new SurveyError("NOT_FOUND", "Survey not found");
      return { survey };
    });
    scoped.put("/v1/surveys/:id", async (request, reply) => {
      const actor = await creator(request, reply, true);
      if (!actor) return;
      const input = SurveyMutationSchema.parse(request.body);
      return {
        survey: await deps.surveys.save(
          actor.workspaceId,
          Id.parse(request.params).id,
          input.draft,
          input.expectedRevision,
          input.idempotencyKey,
        ),
      };
    });
    scoped.post("/v1/surveys/:id/publish", async (request, reply) => {
      const actor = await creator(request, reply, true, true);
      if (!actor) return;
      const input = Key.parse(request.body);
      const limits = entitlementsFor(await deps.repository.getPlan(actor.workspaceId), deps.config);
      return {
        survey: await deps.surveys.publish(
          actor.workspaceId,
          Id.parse(request.params).id,
          input.expectedRevision,
          input.idempotencyKey,
          limits.maxPublishedQuizzes,
        ),
      };
    });
    scoped.post("/v1/surveys/:id/archive", async (request, reply) => {
      const actor = await creator(request, reply, true);
      if (!actor) return;
      const input = Key.parse(request.body);
      return {
        survey: await deps.surveys.archive(
          actor.workspaceId,
          Id.parse(request.params).id,
          input.expectedRevision,
          input.idempotencyKey,
        ),
      };
    });
    scoped.post("/v1/surveys/:id/rooms", async (request, reply) => {
      const actor = await creator(request, reply, true, true);
      if (!actor) return;
      const input = SurveyRoomCreateSchema.parse(request.body);
      const id = Id.parse(request.params).id;
      const limits = entitlementsFor(await deps.repository.getPlan(actor.workspaceId), deps.config);
      const features = await deps.repository.getOperationalFeatures();
      if (!features.sessionCreation)
        throw new SurveyError("ROOM_CLOSED", "New room creation is temporarily paused");
      const now = Date.now();
      const closesAt = new Date(now + input.windowDays * 86400000);
      // Retain final results after collection closes, including the maximum Free window.
      // Both deadlines are frozen with the run; manual early closure does not extend them.
      const expiresAt = new Date(closesAt.getTime() + limits.reportRetentionDays * 86400000);
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const room = await deps.surveys.createRoom(
            actor.workspaceId,
            id,
            input.expectedRevision,
            input.idempotencyKey,
            {
              code: String(randomInt(1000000, 10000000)),
              closesAt: closesAt.toISOString(),
              expiresAt: expiresAt.toISOString(),
              participantLimit: limits.maxParticipants,
              windowDays: input.windowDays,
            },
          );
          return reply.code(201).send({ room: publicRoom(room) });
        } catch (error) {
          if (!(error instanceof SessionCodeConflictError)) throw error;
        }
      }
      throw new SurveyError("VALIDATION_ERROR", "Could not reserve a room code. Retry shortly");
    });
    scoped.get("/v1/survey-rooms", async (request, reply) => {
      const actor = await creator(request, reply);
      if (!actor) return;
      const input = Page.parse(request.query);
      const rooms = (await deps.surveys.listRooms(actor.workspaceId))
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((row) => !input.cursor || row.id > input.cursor);
      const page = rooms.slice(0, input.limit);
      return {
        rooms: page.map(publicRoom),
        nextCursor: rooms.length > input.limit ? page.at(-1)!.id : null,
      };
    });
    scoped.post("/v1/survey-rooms/join", async (request) => {
      const tokenHash = await guestHash(request);
      const { code } = Join.parse(request.body);
      if (!(await deps.consumeAdmission(`survey-admission:${request.ip}`, 30, 60000)))
        throw new SurveyError("RATE_LIMITED", "Too many admissions. Wait a minute and retry");
      const claim = await deps.repository.getLiveRoomCode(code, new Date());
      if (!claim || claim.artifactType !== "feedback_room")
        throw new SurveyError(
          "NOT_FOUND",
          "This survey code is unavailable. Check it with the facilitator",
        );
      const attempt = await deps.surveys.admit(claim.artifactId, tokenHash, () => new Date());
      return { attempt };
    });
    scoped.get("/v1/survey-rooms/:id/attempt", async (request) => ({
      attempt: await deps.surveys.attempt(
        Id.parse(request.params).id,
        await guestHash(request),
        new Date(),
      ),
    }));
    for (const final of [false, true])
      scoped.post(`/v1/survey-rooms/:id/${final ? "submit" : "draft"}`, async (request) => {
        const input = SurveyAttemptMutationSchema.parse(request.body);
        return {
          attempt: await deps.surveys.respond(
            Id.parse(request.params).id,
            await guestHash(request),
            input.responses,
            input.expectedRevision,
            input.idempotencyKey,
            final,
            () => new Date(),
          ),
        };
      });
    scoped.get("/v1/survey-rooms/:id/results", async (request, reply) => {
      const actor = await creator(request, reply);
      if (!actor) return;
      return {
        results: await deps.surveys.results(
          actor.workspaceId,
          Id.parse(request.params).id,
          new Date(),
        ),
      };
    });
    scoped.get("/v1/survey-rooms/:id", async (request, reply) => {
      const actor = await creator(request, reply);
      if (!actor) return;
      const room = await deps.surveys.getRoom(Id.parse(request.params).id, actor.workspaceId);
      if (!room || new Date(room.expiresAt) <= new Date())
        throw new SurveyError("NOT_FOUND", "Survey room not found or expired");
      return { room: publicRoom(room) };
    });
    scoped.post("/v1/survey-rooms/:id/close", async (request, reply) => {
      const actor = await creator(request, reply, true);
      if (!actor) return;
      z.object({ idempotencyKey: z.string().uuid() }).strict().parse(request.body);
      await deps.surveys.close(actor.workspaceId, Id.parse(request.params).id);
      return reply.code(204).send();
    });
    scoped.delete("/v1/survey-rooms/:id", async (request, reply) => {
      const actor = await creator(request, reply);
      if (!actor) return;
      if (actor.role !== "owner")
        return reply.code(403).send({
          error: {
            code: "UNAUTHORIZED",
            message:
              "Only the workspace owner can permanently delete a survey run and its responses",
            requestId: request.id,
          },
        });
      await deps.surveys.deleteRoom(actor.workspaceId, Id.parse(request.params).id);
      return reply.code(204).send();
    });
  });
}
function stableId(value: string) {
  const hex = hashToken(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
