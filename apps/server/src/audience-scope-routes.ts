import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  ActivatePresentationAudienceScopeSchema,
  ScopedQnaCommandSchema,
} from "@openround/contracts";
import { AudienceScopeStoreError, ScopedQnaError } from "@openround/db";
import { AudienceAccessError } from "./audience-access.js";
import type { AudienceScopeService } from "./audience-scope-service.js";
import { hashToken } from "./security.js";

const ScopeParams = z.object({ scopeId: z.string().uuid() }).strict();
const ScopeQuery = z.object({ kind: z.enum(["round", "presentation"]) }).strict();
const SyncBody = ScopeQuery.extend({ limit: z.number().int().min(1).max(50).default(50) });
// Shared-network headroom, not an authentication bypass: all read routes consume this ceiling.
const AUDIENCE_READ_IP_LIMIT = 10_000;
const READ_WINDOW_MS = 60_000;

function readRateLimited(request: FastifyRequest, reply: FastifyReply) {
  return reply
    .header("retry-after", "60")
    .code(429)
    .send({
      error: {
        code: "RATE_LIMITED",
        message: "Too many audience reads. Wait a minute and retry",
        requestId: request.id,
      },
    });
}

function credential(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ") || authorization.length > 2_048) {
    throw new AudienceAccessError(
      "UNAUTHORIZED",
      "Use your room credential in the Authorization header",
    );
  }
  return authorization.slice(7);
}

function audienceReadRateLimitKey(request: FastifyRequest) {
  const params = ScopeParams.safeParse(request.params);
  const scopeId = params.success ? params.data.scopeId : "invalid";
  const authorization = request.headers.authorization;
  const identity =
    authorization?.startsWith("Bearer ") && authorization.length <= 2_048
      ? hashToken(authorization.slice(7))
      : `unauthorized:${request.ip}`;
  const family = request.routeOptions.url?.endsWith("/availability") ? "discovery" : "state";
  return `audience-read:${family}:${scopeId}:${identity}`;
}

/** Credentials stay out of query strings. Legacy Round endpoints remain registered unchanged. */
export async function registerAudienceScopeRoutes(
  app: FastifyInstance,
  service: AudienceScopeService,
  consumeAdmission: (key: string, maximum: number, windowMs: number) => Promise<boolean>,
) {
  // Encapsulation keeps scope-specific error translation out of the legacy route handler.
  await app.register(async (scoped) => {
    // This manual limiter has its own local store and does not skip the credential limiter.
    const preAuthenticationReads = scoped.createRateLimit({
      max: AUDIENCE_READ_IP_LIMIT,
      timeWindow: READ_WINDOW_MS,
      keyGenerator: (request: FastifyRequest) => `audience-read-ip:${request.ip}`,
    });
    const readOptions = (maximum: number) => ({
      onRequest: async (request: FastifyRequest, reply: FastifyReply) => {
        const local = await preAuthenticationReads(request);
        // Fastify appends the route's credential limiter after this hook. Reject before
        // allocating caller-controlled buckets or performing any repository authentication.
        if (
          (!local.isAllowed && local.isExceeded) ||
          !(await consumeAdmission(
            `audience-read-ip:${request.ip}`,
            AUDIENCE_READ_IP_LIMIT,
            READ_WINDOW_MS,
          ))
        ) {
          return readRateLimited(request, reply);
        }
      },
      config: {
        // Keep individual budgets in addition to the independent pre-authentication IP ceiling.
        rateLimit: { max: maximum, timeWindow: "1 minute", keyGenerator: audienceReadRateLimitKey },
      },
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        if (!(await consumeAdmission(audienceReadRateLimitKey(request), maximum, READ_WINDOW_MS))) {
          return readRateLimited(request, reply);
        }
      },
    });
    const discoveryReads = readOptions(120);
    // Notices coalesce at 100 ms: state reads need headroom for ten updates/sec plus manual reads.
    const stateReads = readOptions(720);
    scoped.setErrorHandler((error, request, reply) => {
      if (
        error instanceof AudienceAccessError ||
        error instanceof AudienceScopeStoreError ||
        error instanceof ScopedQnaError
      ) {
        const status =
          error.code === "NOT_FOUND"
            ? 404
            : error.code === "UNAUTHORIZED"
              ? 401
              : error.code === "QNA_RATE_LIMITED"
                ? 429
                : 409;
        return reply
          .code(status)
          .send({ error: { code: error.code, message: error.message, requestId: request.id } });
      }
      throw error;
    });
    scoped.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store");
    });
    scoped.post("/v1/audience-scopes", async (request, reply) => {
      const input = ActivatePresentationAudienceScopeSchema.parse(request.body);
      const token = credential(request);
      if (!(await consumeAdmission(`audience-scope-activation:${hashToken(token)}`, 20, 60_000))) {
        return reply.code(429).send({
          error: {
            code: "RATE_LIMITED",
            message: "Too many audience activation requests; wait a minute and retry",
            requestId: request.id,
          },
        });
      }
      const result = await service.activatePresentation(
        input.sessionId,
        token,
        input.idempotencyKey,
      );
      return reply.code(result.created ? 201 : 200).send({ scope: result.scope });
    });
    scoped.get("/v1/audience-scopes/:scopeId", stateReads, async (request) => {
      const { scopeId } = ScopeParams.parse(request.params);
      const { kind } = ScopeQuery.parse(request.query);
      return { scope: await service.snapshot(kind, scopeId, credential(request)) };
    });
    scoped.get("/v1/audience-scopes/:scopeId/availability", discoveryReads, async (request) => {
      const { scopeId } = ScopeParams.parse(request.params);
      z.object({ kind: z.literal("presentation") })
        .strict()
        .parse(request.query);
      return service.presentationAvailability(scopeId, credential(request));
    });
    scoped.post("/v1/audience-scopes/:scopeId/sync", stateReads, async (request) => {
      const { scopeId } = ScopeParams.parse(request.params);
      const input = SyncBody.parse(request.body);
      return service.sync(input.kind, scopeId, credential(request), input.limit);
    });
    // This first writer is Presentation-only. Legacy Round endpoints retain their request shapes.
    const qnaQuery = z
      .object({
        kind: z.literal("presentation"),
        limit: z.coerce.number().int().min(1).max(50).default(50),
        cursor: z.string().max(256).optional(),
      })
      .strict();
    scoped.get("/v1/audience-scopes/:scopeId/qna/questions", stateReads, async (request) => {
      const { scopeId } = ScopeParams.parse(request.params);
      const input = qnaQuery.parse(request.query);
      return service.listPresentationQna(scopeId, credential(request), {
        limit: input.limit,
        ...(input.cursor ? { cursor: input.cursor } : {}),
      });
    });
    scoped.post("/v1/audience-scopes/:scopeId/qna/commands", async (request, reply) => {
      const { scopeId } = ScopeParams.parse(request.params);
      const input = z
        .object({ kind: z.literal("presentation"), command: ScopedQnaCommandSchema })
        .strict()
        .parse(request.body);
      const token = credential(request);
      if (!(await consumeAdmission(`scoped-qna:${scopeId}:${hashToken(token)}`, 120, 60_000)))
        return reply.code(429).send({
          error: {
            code: "QNA_RATE_LIMITED",
            message: "Too many Q&A requests. Wait a minute and retry",
            requestId: request.id,
          },
        });
      return service.mutatePresentationQna(scopeId, token, input.command);
    });
  });
}
