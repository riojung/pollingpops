import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import {
  IdeaBoardCreateSchema,
  IdeaBoardHostCommandSchema,
  IdeaBoardJoinSchema,
  IdeaBoardSubmitSchema,
  IdeaBoardVoteSchema,
} from "@openround/contracts";
import {
  IdeaBoardError,
  PlatformError,
  createPlatformRepository,
  type IdeaBoardRepository,
  type Repository,
} from "@openround/db";
import type { AppConfig } from "./config.js";
import type { AuthService } from "./auth.js";
import { workspaceFeatureEnabled } from "./feature-policy.js";
import { roomCreationPolicy } from "./room-entitlements.js";
import { cleanPlainText, hashToken } from "./security.js";

const Id = z.object({ id: z.string().uuid() }).strict();
const CreateMutation = IdeaBoardCreateSchema.extend({ idempotencyKey: z.string().uuid() });
// A full board may poll behind one shared office/school IP. Match the shared
// budget instead of applying Fastify's 300/minute production default here.
const routeOptions = { config: { rateLimit: { max: 10_000, timeWindow: 60_000 } } };
const Page = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(50),
  })
  .strict();
const HostMutation = z
  .object({
    schemaVersion: z.literal(1).default(1),
    idempotencyKey: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    command: IdeaBoardHostCommandSchema,
  })
  .strict();

function plainText(value: string, limit: number, required = true) {
  const cleaned = cleanPlainText(value.normalize("NFC"), limit);
  if (required && !cleaned)
    throw new IdeaBoardError("VALIDATION_ERROR", "Enter visible text before submitting");
  return cleaned;
}

export async function registerIdeaBoardRoutes(
  app: FastifyInstance,
  deps: {
    auth: AuthService;
    config: AppConfig;
    repository: Repository;
    boards: IdeaBoardRepository;
    consumeAdmission: (key: string, maximum: number, windowMs: number) => Promise<boolean>;
  },
) {
  await app.register(async (routes) => {
    routes.setErrorHandler((error, request, reply) => {
      const parseStatus = (error as { statusCode?: number }).statusCode;
      if (parseStatus === 400 || parseStatus === 413 || parseStatus === 415)
        return reply.code(parseStatus).send({
          error: {
            code: "VALIDATION_ERROR",
            message:
              parseStatus === 413
                ? "This board request is too large"
                : "Send a valid JSON board request",
            requestId: request.id,
          },
        });
      if (error instanceof ZodError)
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Check the submitted board values",
            requestId: request.id,
          },
        });
      if (error instanceof IdeaBoardError || error instanceof PlatformError) {
        const status =
          error.code === "NOT_FOUND"
            ? 404
            : error.code === "UNAUTHORIZED"
              ? 401
              : error.code === "FORBIDDEN" || error.code === "ADMISSION_RESTRICTED"
                ? 403
                : error.code === "RATE_LIMITED"
                  ? 429
                  : error.code === "ENTITLEMENT_LIMIT"
                    ? 402
                    : error.code === "VALIDATION_ERROR"
                      ? 422
                      : 409;
        return reply.code(status).send({
          error: { code: error.code, message: error.message, requestId: request.id },
        });
      }
      throw error;
    });
    // This shared IP budget runs before body parsing and credential lookup. Never put
    // caller-selected board IDs in its key, which would allow unlimited fresh buckets.
    routes.addHook("onRequest", async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      if (!(await deps.consumeAdmission(`idea-board-ip:${request.ip}`, 10_000, 60_000)))
        throw new IdeaBoardError("RATE_LIMITED", "Too many requests. Wait a minute and retry");
    });
    const creator = async (request: FastifyRequest, reply: FastifyReply, write = false) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return null;
      if (write && actor.role === "viewer") {
        reply.code(403).send({
          error: {
            code: "UNAUTHORIZED",
            message: "Your role allows viewing boards, not managing them",
            requestId: request.id,
          },
        });
        return null;
      }
      return actor;
    };
    const guestHash = async (request: FastifyRequest) => {
      const authorization = request.headers.authorization;
      if (!authorization || !/^Bearer [a-f0-9]{64}$/.test(authorization))
        throw new IdeaBoardError("UNAUTHORIZED", "Join this board to receive board-scoped access");
      const tokenHash = hashToken(authorization.slice(7));
      if (!(await deps.consumeAdmission(`idea-board-guest:${tokenHash}`, 120, 60_000)))
        throw new IdeaBoardError("RATE_LIMITED", "Too many requests. Wait a minute and retry");
      return tokenHash;
    };
    const requireCreation = async (workspaceId: string) => {
      if (!(await workspaceFeatureEnabled(deps.repository, deps.config, workspaceId, "ideaBoards")))
        throw new IdeaBoardError("NOT_FOUND", "Board creation is not enabled for this workspace");
      const operational = await deps.repository.getOperationalFeatures();
      if (!operational.sessionCreation)
        throw new IdeaBoardError("ROOM_CLOSED", "New board launches are temporarily paused");
      if (deps.config.BUSINESS_PLATFORM_ENABLED && !deps.config.COMMUNITY_MODE) {
        const platform = createPlatformRepository(deps.repository);
        const organization = await platform.getOrganizationForWorkspace(workspaceId);
        const workspace = organization
          ? (await platform.listOrganizationWorkspacesForOperator(organization.id)).find(
              (entry) => entry.id === workspaceId,
            )
          : null;
        if (!organization || organization.status !== "active" || workspace?.status !== "active")
          throw new IdeaBoardError(
            "ROOM_CLOSED",
            "New board launches are paused for this workspace",
          );
      }
    };
    routes.get("/v1/idea-boards", routeOptions, async (request, reply) => {
      const actor = await creator(request, reply);
      if (!actor) return;
      const input = Page.parse(request.query);
      const rows = (
        await deps.boards.list(actor.workspaceId, () => new Date(), actor.role !== "viewer")
      )
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((row) => !input.cursor || row.id > input.cursor);
      const boards = rows.slice(0, input.limit);
      return { boards, nextCursor: rows.length > input.limit ? boards.at(-1)!.id : null };
    });
    routes.post(
      "/v1/idea-boards",
      { ...routeOptions, bodyLimit: 8 * 1024 },
      async (request, reply) => {
        const actor = await creator(request, reply, true);
        if (!actor) return;
        const { idempotencyKey, ...parsed } = CreateMutation.parse(request.body);
        const input = {
          ...parsed,
          title: plainText(parsed.title, 160),
          description: plainText(parsed.description, 2_000, false),
        };
        const previous = await deps.boards.getCreation(
          actor.workspaceId,
          idempotencyKey,
          () => new Date(),
        );
        // Exact accepted retries retain their original limits and deadlines after rollout,
        // operational, or plan changes. The store still checks the input fingerprint.
        if (!previous) await requireCreation(actor.workspaceId);
        const limits = previous
          ? null
          : (await roomCreationPolicy(deps.repository, deps.config, actor.workspaceId))
              .entitlements;
        const now = new Date();
        const closesAt =
          previous?.closesAt ??
          new Date(now.getTime() + input.windowDays * 86_400_000).toISOString();
        const expiresAt =
          previous?.expiresAt ??
          new Date(Date.parse(closesAt) + limits!.reportRetentionDays * 86_400_000).toISOString();
        const board = await deps.boards.create(
          actor.workspaceId,
          idempotencyKey,
          input,
          idempotencyKey,
          {
            participantLimit: Math.min(250, limits?.maxParticipants ?? 1),
            closesAt,
            expiresAt,
            replayOnly: Boolean(previous),
          },
          () => new Date(),
        );
        if (!previous)
          await deps.repository.recordAudit({
            workspaceId: actor.workspaceId,
            actorId: actor.userId,
            action: "idea_board.created",
            targetType: "idea_board",
            targetId: board.id,
            requestId: request.id,
            metadata: {},
          });
        return reply.code(201).send({ board });
      },
    );
    routes.get("/v1/idea-boards/:id", routeOptions, async (request, reply) => {
      const actor = await creator(request, reply);
      if (!actor) return;
      const id = Id.parse(request.params).id;
      const board = await (actor.role === "viewer"
        ? deps.boards.getViewer(actor.workspaceId, id, () => new Date())
        : deps.boards.getModerator(actor.workspaceId, id, () => new Date()));
      return { board };
    });
    routes.post(
      "/v1/idea-boards/:id/commands",
      { ...routeOptions, bodyLimit: 4 * 1024 },
      async (request, reply) => {
        const actor = await creator(request, reply, true);
        if (!actor) return;
        const id = Id.parse(request.params).id;
        const input = HostMutation.parse(request.body);
        const current = await deps.boards.getModerator(actor.workspaceId, id, () => new Date());
        // A completed collect retry reaches the receipt check even when new opens pause.
        if (input.command.type === "collect" && current.status === "draft")
          await requireCreation(actor.workspaceId);
        let command = input.command;
        if (command.type === "group.create" || command.type === "group.rename")
          command = { ...command, name: plainText(command.name, 80) };
        const result = await deps.boards.hostCommand(
          actor.workspaceId,
          id,
          command,
          input.expectedRevision,
          input.idempotencyKey,
          () => new Date(),
        );
        await deps.repository.recordAudit({
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          action: `idea_board.${command.type}`,
          targetType: "idea_board",
          targetId: id,
          requestId: request.id,
          metadata: {
            ...("ideaId" in command ? { ideaId: command.ideaId } : {}),
            ...("groupId" in command ? { groupId: command.groupId } : {}),
          },
        });
        return result;
      },
    );
    routes.delete("/v1/idea-boards/:id", routeOptions, async (request, reply) => {
      const actor = await creator(request, reply);
      if (!actor) return;
      if (actor.role !== "owner")
        return reply.code(403).send({
          error: {
            code: "UNAUTHORIZED",
            message: "Only the workspace owner can permanently delete a board",
            requestId: request.id,
          },
        });
      const id = Id.parse(request.params).id;
      await deps.boards.delete(actor.workspaceId, id);
      await deps.repository.recordAudit({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "idea_board.deleted",
        targetType: "idea_board",
        targetId: id,
        requestId: request.id,
        metadata: {},
      });
      return reply.code(204).send();
    });
    routes.get("/v1/idea-boards/:id/public", routeOptions, async (request) => ({
      board: await deps.boards.getPublicInfo(Id.parse(request.params).id, () => new Date()),
    }));
    routes.post(
      "/v1/idea-boards/:id/join",
      { ...routeOptions, bodyLimit: 1024 },
      async (request) => {
        const tokenHash = await guestHash(request);
        if (!(await deps.consumeAdmission(`idea-board-admit:${request.ip}`, 1_000, 60_000)))
          throw new IdeaBoardError("RATE_LIMITED", "Too many admissions. Wait a minute and retry");
        const input = IdeaBoardJoinSchema.parse(request.body ?? {});
        const alias = input.alias == null ? null : plainText(input.alias, 40);
        return deps.boards.join(Id.parse(request.params).id, tokenHash, alias, () => new Date());
      },
    );
    routes.get("/v1/idea-boards/:id/guest", routeOptions, async (request) => {
      const tokenHash = await guestHash(request);
      return deps.boards.getGuest(Id.parse(request.params).id, tokenHash, () => new Date());
    });
    routes.post(
      "/v1/idea-boards/:id/ideas",
      { ...routeOptions, bodyLimit: 8 * 1024 },
      async (request) => {
        const tokenHash = await guestHash(request);
        const input = IdeaBoardSubmitSchema.parse(request.body);
        return deps.boards.submitIdea(
          Id.parse(request.params).id,
          tokenHash,
          plainText(input.body, 1_000),
          input.idempotencyKey,
          () => new Date(),
        );
      },
    );
    routes.put(
      "/v1/idea-boards/:id/votes",
      { ...routeOptions, bodyLimit: 2 * 1024 },
      async (request) => {
        const tokenHash = await guestHash(request);
        const input = IdeaBoardVoteSchema.parse(request.body);
        return deps.boards.vote(
          Id.parse(request.params).id,
          tokenHash,
          input.ideaIds,
          input.expectedRevision,
          input.idempotencyKey,
          () => new Date(),
        );
      },
    );
  });
}
