import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import {
  CanvasBoardInvitationBatchSchema,
  IdeaBoardInvitationBatchSchema,
  type BoardInvitationBatchResponse,
} from "@openround/contracts";
import {
  BoardInvitationError,
  CanvasBoardError,
  IdeaBoardError,
  boardInvitationRecipientId,
  type BoardInvitationRepository,
  type BoardInvitationScope,
  type CanvasBoardRepository,
  type IdeaBoardRepository,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { SessionCache } from "./cache.js";
import type { BoardInvitationMail, Mailer } from "./mailer.js";
import { workspaceFeatureEnabled } from "./feature-policy.js";

const Params = z.object({ id: z.string().uuid() }).strict();
const DELIVERY_BUDGET_MS = 5_000;
const CLAIM_MS = 10_000;
class InvitationRequestError extends Error {
  constructor(readonly code: "UNAUTHORIZED" | "FORBIDDEN" | "DEPENDENCY_UNAVAILABLE") {
    super("This invitation request is unavailable");
  }
}
interface AuthorizedBoard extends BoardInvitationScope {
  title: string;
  expiresAt: string;
}
export interface BoardInvitationRouteDependencies {
  auth: AuthService;
  config: AppConfig;
  repository: Repository;
  canvases: CanvasBoardRepository;
  boards: IdeaBoardRepository;
  deliveries: BoardInvitationRepository;
  mailer: Mailer;
  deliveryAvailable: boolean;
  cache: Pick<SessionCache, "consumeIdempotentRateLimit">;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const expectedAccessFailure = (error: unknown) =>
  (error instanceof CanvasBoardError || error instanceof IdeaBoardError) &&
  (error.code === "NOT_FOUND" || error.code === "FORBIDDEN");

/** Await acknowledgement only within this HTTP request. A timed-out send is never replayed. */
async function sendWithin(
  mailer: Mailer,
  email: string,
  invitation: BoardInvitationMail,
  timeoutMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      mailer.sendBoardInvitation!(email, { ...invitation, timeoutMs }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Delivery acknowledgement is unknown")),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function registerBoardInvitationRoutes(
  app: FastifyInstance,
  deps: BoardInvitationRouteDependencies,
) {
  const authorize = async (
    request: FastifyRequest,
    kind: BoardInvitationScope["resourceKind"],
    id: string,
  ): Promise<AuthorizedBoard> => {
    if (kind === "canvas") {
      const actor = await deps.auth.userFromRequest(request);
      if (!actor) throw new InvitationRequestError("UNAUTHORIZED");
      const board = await deps.canvases.get(actor, id, () => new Date());
      if (
        !board.capabilities.share ||
        board.status !== "active" ||
        !(await workspaceFeatureEnabled(
          deps.repository,
          deps.config,
          board.workspaceId,
          "canvasBoardSharing",
        ))
      )
        throw new InvitationRequestError("FORBIDDEN");
      return {
        workspaceId: board.workspaceId,
        actorId: actor.userId,
        resourceKind: kind,
        resourceId: board.id,
        title: board.title,
        expiresAt: board.expiresAt,
      };
    }
    const actor = await deps.auth.creatorFromRequest(request);
    if (actor && actor.role !== "viewer") {
      let board: Awaited<ReturnType<IdeaBoardRepository["getModerator"]>> | undefined;
      try {
        board = await deps.boards.getModerator(actor.workspaceId, id, () => new Date());
      } catch (error) {
        if (!expectedAccessFailure(error)) throw error;
      }
      if (board) {
        if (
          board.status === "closed" ||
          Date.parse(board.closesAt) <= Date.now() ||
          Date.parse(board.expiresAt) <= Date.now() ||
          !(await workspaceFeatureEnabled(
            deps.repository,
            deps.config,
            actor.workspaceId,
            "ideaBoards",
          ))
        )
          throw new InvitationRequestError("FORBIDDEN");
        return {
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          resourceKind: kind,
          resourceId: board.id,
          title: board.title,
          expiresAt: board.expiresAt,
        };
      }
    }
    // An assigned facilitator can manage an attached source without membership in
    // its owning workspace. Canvas authorization supplies current seat/grant facts.
    const principal = await deps.auth.userFromRequest(request);
    if (!principal) throw new InvitationRequestError("UNAUTHORIZED");
    let workshop: Awaited<ReturnType<CanvasBoardRepository["getWorkshop"]>>;
    try {
      workshop = await deps.canvases.getWorkshop(principal, id, () => new Date());
    } catch (error) {
      if (!expectedAccessFailure(error)) throw error;
      throw new InvitationRequestError("FORBIDDEN");
    }
    const source = workshop.sourceBoard;
    if (
      workshop.boardType !== "workshop" ||
      workshop.sourceBoardId !== id ||
      source?.id !== id ||
      !workshop.capabilities.facilitate ||
      !workshop.capabilities.share ||
      workshop.status !== "active" ||
      Date.parse(workshop.expiresAt) <= Date.now() ||
      source.status === "closed" ||
      Date.parse(source.closesAt) <= Date.now() ||
      Date.parse(source.expiresAt) <= Date.now()
    )
      throw new InvitationRequestError("FORBIDDEN");
    const features = await Promise.all(
      (["ideaBoards", "canvasBoards", "canvasBoardSharing"] as const).map((feature) =>
        workspaceFeatureEnabled(deps.repository, deps.config, workshop.workspaceId, feature),
      ),
    );
    if (features.some((enabled) => !enabled)) throw new InvitationRequestError("FORBIDDEN");
    return {
      workspaceId: workshop.workspaceId,
      actorId: principal.userId,
      resourceKind: kind,
      resourceId: source.id,
      title: source.title,
      expiresAt: source.expiresAt,
    };
  };
  const fresh = async (request: FastifyRequest, scope: BoardInvitationScope) => {
    const current = await authorize(request, scope.resourceKind, scope.resourceId);
    if (current.actorId !== scope.actorId || current.workspaceId !== scope.workspaceId)
      throw new InvitationRequestError("FORBIDDEN");
    return current;
  };
  const admit = async (
    request: FastifyRequest,
    scope: BoardInvitationScope,
    operationId: string,
    email: string,
  ) => {
    // Keys contain only digests, not recipient addresses or bearer credentials. Each
    // scoped recipient intent is charged once, including retries on another process.
    const recipient = hash(email);
    const intent = hash(JSON.stringify([scope, operationId, recipient]));
    const budgets: Array<[string, number, number]> = [
      [`board-mail-ip:${hash(request.ip)}`, 100, 60_000],
      [`board-mail-actor:${scope.actorId}`, 100, 3_600_000],
      [`board-mail-workspace:${scope.workspaceId}`, 300, 3_600_000],
      [`board-mail-recipient:${recipient}`, 10, 86_400_000],
    ];
    for (const [key, maximum, window] of budgets)
      if (!(await deps.cache.consumeIdempotentRateLimit(key, intent, maximum, window)))
        return false;
    return true;
  };

  await app.register(async (routes) => {
    routes.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store");
    });
    routes.setErrorHandler((error, request, reply) => {
      let code = "DEPENDENCY_UNAVAILABLE";
      let status = 503;
      const parseStatus = (error as { statusCode?: number }).statusCode;
      if (
        parseStatus === 400 ||
        parseStatus === 413 ||
        parseStatus === 415 ||
        parseStatus === 429
      ) {
        status = parseStatus;
        code = parseStatus === 429 ? "RATE_LIMITED" : "VALIDATION_ERROR";
      } else if (error instanceof ZodError) {
        code = "VALIDATION_ERROR";
        status = 400;
      } else if (error instanceof BoardInvitationError) {
        code = error.code;
        status =
          code === "NOT_FOUND"
            ? 404
            : code === "BATCH_EXPIRED"
              ? 410
              : code === "LIMIT_REACHED"
                ? 429
                : 409;
      } else if (error instanceof InvitationRequestError) {
        code = error.code;
        status = code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" ? 403 : 503;
      } else if (typeof (error as { code?: unknown }).code === "string") {
        const known = (error as { code: string }).code;
        if (["NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN", "ROOM_CLOSED"].includes(known)) {
          code = known;
          status = known === "NOT_FOUND" ? 404 : known === "UNAUTHORIZED" ? 401 : 403;
        }
      }
      return reply.code(status).send({
        error: { code, message: "This invitation request is unavailable", requestId: request.id },
      });
    });
    const handler =
      (kind: BoardInvitationScope["resourceKind"]) =>
      async (request: FastifyRequest, reply: FastifyReply) => {
        const started = performance.now();
        const remaining = () =>
          Math.max(0, Math.floor(DELIVERY_BUDGET_MS - (performance.now() - started)));
        const { id } = Params.parse(request.params);
        const canvasInput =
          kind === "canvas" ? CanvasBoardInvitationBatchSchema.parse(request.body) : null;
        const input = canvasInput ?? IdeaBoardInvitationBatchSchema.parse(request.body);
        const initial = await authorize(request, kind, id);
        if (!deps.deliveryAvailable || !deps.mailer.sendBoardInvitation)
          throw new InvitationRequestError("DEPENDENCY_UNAVAILABLE");
        const scope: BoardInvitationScope = {
          workspaceId: initial.workspaceId,
          actorId: initial.actorId,
          resourceKind: kind,
          resourceId: id,
        };
        const batch = await deps.deliveries.prepare(scope, {
          ...input,
          expiresAt: initial.expiresAt,
        });
        const current = await deps.deliveries.response(scope, batch.batchId);
        for (const recipient of current.results) {
          if (recipient.status !== "pending") continue;
          if (remaining() < 50) break;
          if (!(await admit(request, scope, input.operationId, recipient.email))) {
            reply.header("retry-after", "60");
            break;
          }
          // Do not claim anything after a slow authorization read consumes the budget.
          await fresh(request, scope);
          if (remaining() < 50) break;
          const claim = await deps.deliveries.claim(
            scope,
            batch.batchId,
            recipient.email,
            new Date(),
            CLAIM_MS,
          );
          if (!claim) continue;
          let invitationId: string | undefined;
          let currentBoard: AuthorizedBoard;
          try {
            currentBoard = await fresh(request, scope);
            if (canvasInput) {
              const actor = await deps.auth.userFromRequest(request);
              if (!actor || actor.userId !== scope.actorId)
                throw new InvitationRequestError("FORBIDDEN");
              const invitation = await deps.canvases.invite(
                actor,
                id,
                {
                  email: recipient.email,
                  role: canvasInput.role,
                  operationId: boardInvitationRecipientId(batch.batchId, recipient.email),
                },
                () => new Date(),
              );
              if (
                invitation.revokedAt ||
                invitation.acceptedAt ||
                Date.parse(invitation.expiresAt) <= Date.now()
              )
                throw new InvitationRequestError("FORBIDDEN");
              invitationId = invitation.id;
              // Invitation creation itself can block. Recheck the current sender, seat,
              // owning-workspace feature and board immediately before sending mail.
              currentBoard = await fresh(request, scope);
            }
          } catch (error) {
            await deps.deliveries.finish(scope, batch.batchId, recipient.email, claim.claimToken, {
              status:
                kind === "canvas" && !(error instanceof InvitationRequestError)
                  ? "rejected"
                  : "failed",
              errorCode:
                kind === "canvas" && !(error instanceof InvitationRequestError)
                  ? "RECIPIENT_UNAVAILABLE"
                  : "ACCESS_CHANGED",
            });
            continue;
          }
          const budget = remaining();
          if (budget < 1) {
            // No SMTP call has started, so this fenced claim can safely remain pending.
            await deps.deliveries.defer(scope, batch.batchId, recipient.email, claim.claimToken);
            break;
          }
          const destination =
            kind === "canvas" ? `/canvas/invitations/${invitationId}` : `/board/${id}`;
          const url = new URL(destination, deps.config.WEB_ORIGIN).href;
          const host =
            new URL(deps.config.WEB_ORIGIN).hostname.replace(/[^a-zA-Z0-9.-]/g, "") || "localhost";
          try {
            await sendWithin(
              deps.mailer,
              recipient.email,
              {
                title: currentBoard.title,
                url,
                kind,
                messageId: `<board-invitation-${boardInvitationRecipientId(batch.batchId, recipient.email)}@${host}>`,
              },
              budget,
            );
          } catch {
            await deps.deliveries.finish(scope, batch.batchId, recipient.email, claim.claimToken, {
              status: "unknown",
              errorCode: "DELIVERY_UNKNOWN",
              ...(invitationId ? { invitationId } : {}),
            });
            continue;
          }
          // If receipt persistence fails after SMTP acknowledgement, leave the claim
          // intact. Its expiry becomes unknown; another POST must never resend it.
          await deps.deliveries.finish(scope, batch.batchId, recipient.email, claim.claimToken, {
            status: "sent",
            ...(invitationId ? { invitationId } : {}),
          });
        }
        const result: BoardInvitationBatchResponse = await deps.deliveries.response(
          scope,
          batch.batchId,
        );
        return reply.code(result.complete ? 200 : 202).send(result);
      };
    const options = {
      bodyLimit: 16 * 1024,
      config: { rateLimit: { max: 30, timeWindow: 60_000 } },
    };
    routes.post("/v1/canvas-boards/:id/invitations/batch", options, handler("canvas"));
    routes.post("/v1/idea-boards/:id/invitations", options, handler("idea_board"));
  });
}
