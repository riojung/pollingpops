import { createHash } from "node:crypto";
import {
  CanvasPresenterMutationSchema,
  CanvasPresenterViewSchema,
  CanvasGuestPresenterViewSchema,
  type CanvasPresenterView,
} from "@openround/contracts";
import { CanvasBoardError, type CanvasBoardRepository } from "@openround/db";
import type { SessionCache } from "./cache.js";
import { CANVAS_PRESENTER_TTL_MS, type CanvasPresenterRecord } from "./canvas-presenter-state.js";

const conflict = () =>
  new CanvasBoardError("STALE_DRAFT", "Presentation changed. Refresh before continuing");
function view(boardId: string, record: CanvasPresenterRecord | null): CanvasPresenterView {
  if (record && record.expiresAt <= Date.now()) record = null;
  return CanvasPresenterViewSchema.parse({
    schemaVersion: 1,
    boardId,
    serverNow: new Date().toISOString(),
    revision: record?.revision ?? 0,
    active: record?.active ?? false,
    sessionId: record?.sessionId ?? null,
    presenterId: record?.active ? record.userId : null,
    audience: record?.audience ?? "team",
    frameId: record?.active ? record.frameId : null,
    viewport: record?.active ? record.viewport : null,
    expiresAt: record?.active ? new Date(record.expiresAt).toISOString() : null,
  });
}

/** A board-scoped, expiring attention cue. It never changes durable content or a follower's opt-in. */
export class CanvasPresenterService {
  constructor(
    private readonly canvases: CanvasBoardRepository,
    private readonly cache: SessionCache,
  ) {}

  private available() {
    if (!this.cache.getCanvasPresenter || !this.cache.setCanvasPresenter)
      throw Object.assign(new Error("Presentation is unavailable"), {
        statusCode: 503,
        code: "DEPENDENCY_UNAVAILABLE",
      });
  }

  private async current(boardId: string, record: CanvasPresenterRecord | null) {
    if (!record || !record.active) return record;
    try {
      const access = await this.canvases.authorize({ userId: record.userId }, boardId);
      if (!access.capabilities.facilitate) return null;
      if (record.audience === "published") {
        const board = await this.canvases.get({ userId: record.userId }, boardId);
        if (
          !board.sourceBoardId ||
          !board.objects.some(
            (object) =>
              object.id === record.frameId &&
              object.type === "frame" &&
              object.visibility === "published",
          )
        )
          return null;
      }
      return record;
    } catch (error) {
      if (
        error instanceof CanvasBoardError &&
        ["NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED"].includes(error.code)
      )
        return null;
      throw error;
    }
  }

  async get(actor: { userId: string }, boardId: string) {
    this.available();
    const initial = await this.canvases.authorize(actor, boardId);
    const record = await this.current(boardId, await this.cache.getCanvasPresenter!(boardId));
    const final = await this.canvases.authorize(actor, boardId);
    return view(
      boardId,
      initial.canvasSeq === final.canvasSeq && initial.sourceRevision === final.sourceRevision
        ? record
        : null,
    );
  }

  async getGuest(sourceBoardId: string, tokenHash: string) {
    this.available();
    const access = await this.canvases.authorizeGuest(sourceBoardId, tokenHash);
    const record = await this.current(
      access.boardId,
      await this.cache.getCanvasPresenter!(access.boardId),
    );
    let allowed = false;
    if (record?.active && record.audience === "published") {
      const board = await this.canvases.getGuest(sourceBoardId, tokenHash);
      allowed = Boolean(
        board?.objects.some((object) => object.id === record.frameId && object.type === "frame"),
      );
    }
    const final = await this.canvases.authorizeGuest(sourceBoardId, tokenHash);
    if (final.canvasSeq !== access.canvasSeq || final.sourceRevision !== access.sourceRevision)
      allowed = false;
    const { presenterId, ...safe } = view(access.boardId, allowed ? record : null);
    void presenterId;
    return CanvasGuestPresenterViewSchema.parse({ ...safe, audience: "published", viewport: null });
  }

  async command(actor: { userId: string }, boardId: string, raw: unknown) {
    this.available();
    const input = CanvasPresenterMutationSchema.parse(raw);
    const access = await this.canvases.authorize(actor, boardId);
    if (!access.capabilities.facilitate)
      throw new CanvasBoardError("FORBIDDEN", "Only a facilitator can manage presentation");
    const actual = await this.cache.getCanvasPresenter!(boardId);
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    if (actual?.operationId === input.operationId) {
      if (actual.hash !== hash || actual.operationActorId !== actor.userId)
        throw new CanvasBoardError("IDEMPOTENCY_CONFLICT", "Use the original presentation request");
      return this.get(actor, boardId);
    }
    const current = await this.current(boardId, actual);
    if (input.expectedRevision !== (current?.revision ?? 0)) throw conflict();
    let next: CanvasPresenterRecord;
    const expiresAt = Math.min(Date.parse(access.expiresAt), Date.now() + CANVAS_PRESENTER_TTL_MS);
    if (input.command.type === "start") {
      if (current?.active || input.sessionId !== input.operationId) throw conflict();
      next = {
        userId: actor.userId,
        sessionId: input.sessionId,
        revision: (current?.revision ?? 0) + 1,
        active: true,
        audience: input.command.audience,
        frameId: input.command.frameId,
        viewport: input.command.viewport,
        expiresAt,
        operationId: input.operationId,
        operationActorId: actor.userId,
        hash,
      };
    } else {
      if (!current?.active || current.sessionId !== input.sessionId) throw conflict();
      if (input.command.type === "update" && current.userId !== actor.userId)
        throw new CanvasBoardError("FORBIDDEN", "Only the current presenter can update this view");
      next = {
        ...current,
        revision: current.revision + 1,
        expiresAt,
        operationId: input.operationId,
        operationActorId: actor.userId,
        hash,
      };
      if (input.command.type === "stop") {
        next.active = false;
        next.viewport = null;
        next.frameId = null;
      } else {
        next.viewport = input.command.viewport;
        next.frameId = input.command.frameId;
        next.audience = input.command.audience;
      }
    }
    if (next.active) {
      if (next.audience === "published") {
        if (next.viewport !== null || !next.frameId)
          throw new CanvasBoardError(
            "VALIDATION_ERROR",
            "Choose a published frame for guest presentation",
          );
        const board = await this.canvases.get(actor, boardId);
        if (
          !board.sourceBoardId ||
          !board.objects.some(
            (object) =>
              object.id === next.frameId &&
              object.type === "frame" &&
              object.visibility === "published",
          )
        )
          throw new CanvasBoardError(
            "VALIDATION_ERROR",
            "Choose a currently published workshop frame",
          );
      } else if (!next.viewport) {
        throw new CanvasBoardError("VALIDATION_ERROR", "Choose a visible team canvas region");
      }
    }
    const fresh = await this.canvases.authorize(actor, boardId);
    if (!fresh.capabilities.facilitate)
      throw new CanvasBoardError("FORBIDDEN", "Presentation access changed");
    next.expiresAt = Math.min(next.expiresAt, Date.parse(fresh.expiresAt));
    if (!(await this.cache.setCanvasPresenter!(boardId, next, actual))) throw conflict();
    return this.get(actor, boardId);
  }
}
