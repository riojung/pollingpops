import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { JoinPreflightRequestSchema, JoinPreflightResponseSchema } from "@openround/contracts";
import type { PresentationSessionRepository, Repository, SurveyRepository } from "@openround/db";
import type { AppConfig } from "./config.js";
import { entitlementsFor } from "./entitlements.js";
import { SessionError, type SessionService } from "./session-service.js";

const unavailableRoom = () =>
  new SessionError(
    "INVALID_CODE",
    "This room is not accepting joins. Check the code or ask the facilitator",
  );

function preflightRateLimitKey(request: FastifyRequest) {
  const parsed = JoinPreflightRequestSchema.safeParse(request.query);
  const code = parsed.success ? parsed.data.code : "invalid";
  return `live-room-preflight:${code}`;
}

function rateLimited(reply: FastifyReply, requestId: string) {
  return reply.code(429).send({
    error: { code: "RATE_LIMITED", message: "Too many requests", requestId },
  });
}

/** Resolve a public room code without mutating either delivery engine. */
export async function registerLiveRoomRoutes(
  app: FastifyInstance,
  dependencies: {
    repository: Repository;
    surveys?: SurveyRepository;
    sessions: SessionService;
    presentationSessions: PresentationSessionRepository;
    config: Pick<
      AppConfig,
      | "COMMUNITY_MODE"
      | "COMMUNITY_REPORT_RETENTION_DAYS"
      | "MAX_SESSION_PARTICIPANTS"
      | "MAX_PRACTICE_PERSONAL_LINKS"
    >;
    consumeAdmission?: (key: string, maximum: number, windowMs: number) => Promise<boolean>;
  },
) {
  app.get(
    "/v1/live-rooms/join/preflight",
    {
      // Keep the application-wide per-IP limiter active. A second shared budget protects a known
      // room across processes without letting caller-controlled room codes mint fresh IP buckets.
      preHandler: async (request, reply) => {
        if (!dependencies.consumeAdmission) return;
        if (!(await dependencies.consumeAdmission(preflightRateLimitKey(request), 600, 60_000))) {
          return rateLimited(reply, request.id);
        }
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const input = JoinPreflightRequestSchema.parse(request.query);

      const now = new Date();
      const room = await dependencies.repository.getLiveRoomCode(input.code, now);
      if (!room) throw unavailableRoom();

      if (room.artifactType === "round") {
        const claimedRound = await dependencies.repository.getSessionById(room.artifactId);
        if (!claimedRound || claimedRound.state.code !== input.code) throw unavailableRoom();
        try {
          const round = await dependencies.sessions.preflightJoin(input);
          return JoinPreflightResponseSchema.parse({
            ...round,
            artifactType: "round",
            destination: "/join",
          });
        } catch (error) {
          if (!(error instanceof SessionError) || error.code !== "INVALID_CODE") throw error;
          throw unavailableRoom();
        }
      }

      if (room.artifactType === "feedback_room") {
        const survey = await dependencies.surveys?.getRoom(room.artifactId);
        if (
          !survey ||
          survey.closed ||
          survey.code !== input.code ||
          new Date(survey.closesAt) <= now ||
          new Date(survey.expiresAt) <= now
        )
          throw unavailableRoom();
        return JoinPreflightResponseSchema.parse({
          nicknamePolicy: "friendly_only",
          artifactType: "feedback_room",
          destination: `/survey/${survey.id}`,
        });
      }
      const presentation = await dependencies.presentationSessions.getSessionById(room.artifactId);
      if (
        !presentation ||
        presentation.code !== input.code ||
        presentation.status !== "active" ||
        presentation.liveExpiresAt.getTime() <= now.getTime()
      ) {
        throw unavailableRoom();
      }

      const [institutionPolicy, plan, participants] = await Promise.all([
        dependencies.repository.getInstitutionPolicy(presentation.workspaceId),
        dependencies.repository.getPlan(presentation.workspaceId),
        dependencies.presentationSessions.listParticipants(presentation.id),
      ]);
      const participantLimit = entitlementsFor(plan, dependencies.config).maxParticipants;
      if (
        institutionPolicy.identityRequirement === "institution" ||
        participants.length >= participantLimit
      ) {
        throw unavailableRoom();
      }

      return JoinPreflightResponseSchema.parse({
        nicknamePolicy: "custom",
        artifactType: "presentation",
        destination: "/join",
      });
    },
  );
}
