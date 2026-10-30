import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  CANVAS_MAX_DOCUMENT_BYTES,
  CANVAS_MAX_OBJECTS,
  CanvasBoardCreateSchema,
  CanvasBoardCommandSchema,
  CanvasBoardGuestViewSchema,
  CanvasBoardInviteSchema,
  CanvasBoardMutationSchema,
  CanvasBoardViewSchema,
  CanvasObjectSchema,
  ideaBoardProjection,
  type CanvasBoardCreate,
  type CanvasBoardEvent,
  type CanvasBoardGuestView,
  type CanvasBoardInvitation,
  type CanvasBoardMutation,
  type CanvasBoardMutationResponse,
  type CanvasBoardRole,
  type CanvasBoardView,
  type CanvasObject,
  type IdeaBoardStored,
} from "@openround/contracts";
import { MemoryRepository } from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { IdeaBoardRepository } from "./idea-boards.js";
import { activeSubscription, stablePlatformJson } from "./platform-service.js";
import {
  MemoryCanvasBoards,
  postgresCanvasEvents,
  postgresCanvasRun,
} from "./canvas-board-store.js";
import type { Repository } from "./types.js";
import type {
  CanvasAccessContext,
  CanvasActor,
  CanvasBoardAuthorization,
  CanvasBoardStored,
  CanvasClock,
  CanvasReceipt,
  CanvasRun,
  CanvasState,
  CanvasTransaction,
} from "./canvas-board-types.js";

export class CanvasBoardError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "UNAUTHORIZED"
      | "FORBIDDEN"
      | "STALE_DRAFT"
      | "IDEMPOTENCY_CONFLICT"
      | "ROOM_CLOSED"
      | "VALIDATION_ERROR"
      | "ENTITLEMENT_LIMIT"
      | "RATE_LIMITED",
    message: string,
  ) {
    super(message);
  }
}
const instant = (clock: CanvasClock) => (typeof clock === "function" ? clock() : clock);
const fingerprint = (value: unknown) =>
  createHash("sha256").update(stablePlatformJson(value)).digest("hex");
function fail(message = "Canvas board not found or access is no longer available"): never {
  throw new CanvasBoardError("NOT_FOUND", message);
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CanvasBoardError("VALIDATION_ERROR", message);
}
function notExpired(board: CanvasBoardStored, now: Date) {
  if (Date.parse(board.expiresAt) <= now.getTime()) fail("This canvas board has expired");
}
function sourceCurrent(source: IdeaBoardStored | null, now: Date) {
  if (!source || Date.parse(source.expiresAt) <= now.getTime())
    fail("The workshop is no longer available");
  return source;
}
function status(
  board: CanvasBoardStored,
  source: Pick<IdeaBoardStored, "status" | "closesAt"> | null,
  now: Date,
): CanvasBoardView["status"] {
  if (source && (source.status === "closed" || Date.parse(source.closesAt) <= now.getTime()))
    return "closed";
  if (source?.status === "voting") return "frozen";
  return board.status;
}
function roleFor(
  state: CanvasState,
  actor: CanvasActor,
  access: CanvasAccessContext,
): CanvasBoardRole | null {
  if (
    (state.board.ownerUserId === actor.userId && access.workspace.membership) ||
    (access.workspace.ownerId === actor.userId && access.workspace.membership === "owner")
  )
    return "owner";
  return state.grants.find((grant) => grant.userId === actor.userId)?.role ?? null;
}
function currentSeat(access: CanvasAccessContext, userId: string, now: Date) {
  if (access.organization?.licenseUnit !== "user") return true;
  if (
    !access.subscription ||
    access.commercialHold ||
    !activeSubscription(access.subscription, now)
  )
    return false;
  return access.assignments
    .slice()
    .sort(
      (a, b) => a.assignedAt.getTime() - b.assignedAt.getTime() || a.userId.localeCompare(b.userId),
    )
    .slice(0, access.subscription.licenseQuantity)
    .some((assignment) => assignment.userId === userId);
}
function sourceObjects(objects: CanvasObject[], source: IdeaBoardStored | null): CanvasObject[] {
  if (!source) return objects;
  const approved = source.ideas.filter((idea) => idea.status === "approved");
  const valid = new Set(approved.map((idea) => idea.id));
  const next = objects.filter((object) => object.type !== "idea_ref" || valid.has(object.ideaId));
  const represented = new Set(
    next.flatMap((object) => (object.type === "idea_ref" ? [object.ideaId] : [])),
  );
  for (const [index, idea] of approved.entries())
    if (!represented.has(idea.id))
      next.push(
        CanvasObjectSchema.parse({
          id: idea.id,
          type: "idea_ref",
          ideaId: idea.id,
          x: (index % 4) * 280,
          y: Math.floor(index / 4) * 220,
          width: 250,
          height: 190,
          color: "yellow",
          visibility: "published",
          version: 1,
        }),
      );
  const ids = new Set(next.map((object) => object.id));
  return next.filter(
    (object) =>
      object.type !== "connector" ||
      ((!object.from.objectId || ids.has(object.from.objectId)) &&
        (!object.to.objectId || ids.has(object.to.objectId))),
  );
}
function rebaseOwnHistory(
  receipts: CanvasReceipt[],
  actorId: string,
  desired: CanvasObject[],
  restored: CanvasObject[],
) {
  // An inverse restores the same historical state at a new physical version. Only
  // receipts linked to that exact version may follow it; semantic equality alone
  // would erase a collaborator's intervening no-op or ABA edit.
  const lineage = new Map(desired.map((object) => [object.id, stablePlatformJson(object)]));
  const versions = new Map(restored.map((object) => [object.id, object.version]));
  for (const receipt of receipts) {
    if (receipt.actorId !== actorId || !receipt.undoable) continue;
    for (const object of [...receipt.before, ...receipt.after]) {
      const version = versions.get(object.id);
      if (version === undefined || lineage.get(object.id) !== stablePlatformJson(object)) continue;
      object.version = version;
      receipt.objectVersions ??= {};
      receipt.objectVersions[object.id] = Math.max(receipt.objectVersions[object.id] ?? 0, version);
    }
  }
}
function projectedObjects(
  state: CanvasState,
  source: IdeaBoardStored | null,
  guest: boolean,
  now: Date,
  moderator = false,
) {
  const published = source ? ideaBoardProjection(source, now, moderator && !guest).ideas : [];
  const canSee =
    !source ||
    source.ideasVisible ||
    ["voting", "closed"].includes(ideaBoardProjection(source, now).status);
  if (guest && !canSee) return [];
  let projected = sourceObjects(state.objects, source)
    .filter((object) => !guest || object.visibility === "published")
    .flatMap((object) => {
      const { idea: _idea, ...safe } = object;
      void _idea;
      if (object.type !== "idea_ref") return [safe as CanvasObject];
      const idea = published.find((entry) => entry.id === object.ideaId);
      return idea ? [{ ...safe, idea } as CanvasObject] : [];
    });
  for (let pass = 0; pass < CANVAS_MAX_OBJECTS; pass++) {
    const ids = new Set(projected.map((object) => object.id));
    const next = projected.filter(
      (object) =>
        (!object.parentId || ids.has(object.parentId)) &&
        (object.type !== "connector" ||
          ((!object.from.objectId || ids.has(object.from.objectId)) &&
            (!object.to.objectId || ids.has(object.to.objectId)))),
    );
    if (next.length === projected.length) return projected;
    projected = next;
  }
  return projected;
}
function validateObjects(objects: CanvasObject[]) {
  assert(objects.length <= CANVAS_MAX_OBJECTS, `Use up to ${CANVAS_MAX_OBJECTS} canvas objects`);
  assert(
    new Set(objects.map((object) => object.id)).size === objects.length,
    "Use unique object identifiers",
  );
  assert(
    Buffer.byteLength(JSON.stringify(objects), "utf8") <= CANVAS_MAX_DOCUMENT_BYTES,
    "This canvas has reached its retained content limit",
  );
  const map = new Map(objects.map((object) => [object.id, object]));
  for (const object of objects) {
    CanvasObjectSchema.parse(object);
    if (object.parentId) {
      const parent = map.get(object.parentId);
      assert(
        parent?.type === "frame" && parent.id !== object.id,
        "Choose an existing frame as the parent",
      );
    }
    const seen = new Set([object.id]);
    let parent = object.parentId;
    while (parent) {
      assert(!seen.has(parent), "Frame relationships cannot contain cycles");
      seen.add(parent);
      parent = map.get(parent)?.parentId ?? null;
    }
    if (object.type === "connector")
      for (const endpoint of [object.from, object.to])
        if (endpoint.objectId)
          assert(
            map.has(endpoint.objectId) && endpoint.objectId !== object.id,
            "Choose an existing connector endpoint",
          );
  }
}
function stripProjected(objects: CanvasObject[]) {
  return objects.map(({ idea, ...object }) => {
    void idea;
    return object as CanvasObject;
  });
}

export class CanvasBoardRepository {
  constructor(
    private readonly run: CanvasRun,
    private readonly store: MemoryCanvasBoards | PostgresRepository,
    private readonly options: { communityMode?: boolean; communityRetentionDays?: number } = {},
  ) {}
  private async checked(
    tx: CanvasTransaction,
    actor: CanvasActor,
    id: string,
    clock: CanvasClock,
    lock = false,
  ) {
    // Refuse unaccepted, revoked or foreign grants before reading private scene/history rows.
    const preflight = await this.authorizedMetadata(tx, actor, id, clock);
    const state = await tx.get(id, lock);
    if (!state) fail();
    const access = preflight.access;
    notExpired(state.board, instant(clock));
    const role = roleFor(state, actor, access);
    if (!role || (access.member?.role === "billing" && role !== "viewer")) fail();
    if (
      access.organization?.licenseUnit === "user" &&
      role !== "viewer" &&
      !access.assignments.some((assignment) => assignment.userId === actor.userId)
    )
      fail();
    const source = state.board.sourceBoardId
      ? sourceCurrent(await tx.source(state.board.sourceBoardId, lock), instant(clock))
      : null;
    const currentStatus = status(state.board, source, instant(clock));
    const seat = this.options.communityMode || currentSeat(access, actor.userId, instant(clock));
    const originSeat =
      this.options.communityMode ||
      access.organization?.licenseUnit !== "user" ||
      access.workspaceLicensed;
    const writable = seat && originSeat && currentStatus === "active";
    const capabilities = {
      edit: role !== "viewer" && writable,
      facilitate: (role === "owner" || role === "facilitator") && seat && originSeat,
      share: role === "owner" && seat && originSeat,
      delete: role === "owner" && seat,
      archive: role === "owner" && seat && state.board.boardType === "team",
    };
    return { state, access, role, source, capabilities };
  }
  private view(
    checked: Awaited<ReturnType<CanvasBoardRepository["checked"]>>,
    actor: CanvasActor,
    clock: CanvasClock,
  ): CanvasBoardView {
    const { state, source, access, role, capabilities } = checked;
    const now = instant(clock);
    notExpired(state.board, now);
    if (source) sourceCurrent(source, now);
    const own = state.receipts
      .filter((receipt) => receipt.actorId === actor.userId && receipt.undoable)
      .sort((a, b) => (a.historySeq ?? a.canvasSeq) - (b.historySeq ?? b.canvasSeq));
    const undo = own.filter((receipt) => !receipt.undone).at(-1);
    const redo = own.filter((receipt) => receipt.undone).at(-1);
    const { creationKey, creationHash, ...metadata } = state.board;
    void creationKey;
    void creationHash;
    return CanvasBoardViewSchema.parse({
      schemaVersion: 1,
      ...metadata,
      workspaceName: access.workspace.name,
      organizationName: access.organization?.name,
      status: status(state.board, source, now),
      role,
      capabilities,
      objects: projectedObjects(state, source, false, now, capabilities.facilitate),
      grants: capabilities.share ? state.grants : [],
      invitations: capabilities.share ? state.invitations : [],
      sourceBoard: source ? ideaBoardProjection(source, now, capabilities.facilitate) : undefined,
      undoOperationId: undo?.operationId ?? null,
      redoOperationId: redo?.operationId ?? null,
    });
  }
  /** Read-only receipt replay. Callers must return this existing resource, never recreate it
   * after the lookup if new-creation policy has been paused. */
  getCreation(
    actor: CanvasActor,
    input: CanvasBoardCreate,
    clock: CanvasClock = () => new Date(),
  ): Promise<{ id: string; workspaceId: string } | null> {
    const parsed = CanvasBoardCreateSchema.parse(input);
    return this.run(actor, { workspaceId: parsed.workspaceId }, async (tx) => {
      const previous = await tx.creation(parsed.workspaceId, parsed.operationId);
      if (!previous) return null;
      try {
        const authorized = await this.authorizedMetadata(tx, actor, previous.id, clock);
        if (previous.creationHash !== fingerprint(parsed))
          throw new CanvasBoardError(
            "IDEMPOTENCY_CONFLICT",
            "This creation identifier was used for different content",
          );
        return { id: authorized.board.id, workspaceId: authorized.board.workspaceId };
      } catch (error) {
        if (error instanceof CanvasBoardError && error.code === "NOT_FOUND") return null;
        throw error;
      }
    });
  }
  create(actor: CanvasActor, input: CanvasBoardCreate, clock: CanvasClock = () => new Date()) {
    const parsed = CanvasBoardCreateSchema.parse(input),
      id = randomUUID();
    return this.run(actor, { workspaceId: parsed.workspaceId, boardId: id }, async (tx) => {
      const access = await tx.access(parsed.workspaceId, actor.userId);
      const now = instant(clock);
      if (
        !access?.user?.verified ||
        !["owner", "editor"].includes(access.workspace.membership ?? "") ||
        access.organization?.status !== "active" ||
        access.workspace.status !== "active" ||
        access.workspaceDeleting ||
        access.member?.role === "billing"
      )
        fail();
      if (!this.options.communityMode && !currentSeat(access, actor.userId, now))
        throw new CanvasBoardError("FORBIDDEN", "An active creator license is required");
      const previous =
        (await tx.creation(parsed.workspaceId, parsed.operationId)) ??
        (parsed.sourceBoardId
          ? (await tx.list()).find(
              (board) =>
                board.workspaceId === parsed.workspaceId &&
                board.sourceBoardId === parsed.sourceBoardId,
            )
          : null);
      if (previous) {
        if (
          previous.creationKey === parsed.operationId &&
          previous.creationHash !== fingerprint(parsed)
        )
          throw new CanvasBoardError(
            "IDEMPOTENCY_CONFLICT",
            "This creation identifier was used for different content",
          );
        return this.view(await this.checked(tx, actor, previous.id, clock), actor, clock);
      }
      if ((await tx.countWorkspace(parsed.workspaceId, instant(clock))) >= 100)
        throw new CanvasBoardError(
          "ENTITLEMENT_LIMIT",
          "Use up to 100 retained canvases per workspace",
        );
      const source = parsed.sourceBoardId
        ? sourceCurrent(await tx.source(parsed.sourceBoardId, true), instant(clock))
        : null;
      if (source) {
        assert(source.workspaceId === parsed.workspaceId, "Choose a workshop in this workspace");
        if (
          source.status === "voting" ||
          source.status === "closed" ||
          Date.parse(source.closesAt) <= instant(clock).getTime()
        )
          throw new CanvasBoardError(
            "ROOM_CLOSED",
            "Only draft or collecting workshops can enable an editable canvas",
          );
      }
      const retentionDays = this.options.communityMode
        ? (this.options.communityRetentionDays ?? 365)
        : access.workspaceLicensed
          ? (access.subscription?.offerSnapshot?.entitlements.reportRetentionDays ?? 365)
          : 30;
      const state: CanvasState = {
        board: {
          id,
          workspaceId: parsed.workspaceId,
          organizationId: access.workspace.organizationId,
          ownerUserId: actor.userId,
          title: parsed.title,
          boardType: parsed.boardType,
          sourceBoardId: parsed.sourceBoardId ?? null,
          status: "active",
          canvasSeq: 0,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          expiresAt:
            source?.expiresAt ?? new Date(now.getTime() + retentionDays * 86400000).toISOString(),
          creationKey: parsed.operationId,
          creationHash: fingerprint(parsed),
        },
        objects: sourceObjects([], source),
        grants: [],
        invitations: [],
        receipts: [],
      };
      validateObjects(state.objects);
      await tx.put(state, true);
      await this.emit(tx, state, "canvas.changed", now);
      return this.view(await this.checked(tx, actor, id, clock), actor, clock);
    });
  }
  get(actor: CanvasActor, id: string, clock: CanvasClock = () => new Date()) {
    return this.run(actor, { boardId: id }, async (tx) =>
      this.view(await this.checked(tx, actor, id, clock), actor, clock),
    );
  }
  list(
    actor: CanvasActor,
    query: { scope?: "all" | "owned" | "shared" | "archived" } = {},
    clock: CanvasClock = () => new Date(),
  ) {
    return this.run(actor, {}, async (tx) => {
      const result: CanvasBoardView[] = [];
      for (const row of await tx.list()) {
        try {
          const checked = await this.authorizedMetadata(tx, actor, row.id, clock);
          const scope = query.scope ?? "all";
          if (
            (scope === "owned" && checked.authorization.role !== "owner") ||
            (scope === "shared" && checked.authorization.role === "owner") ||
            (scope === "archived" && row.status !== "archived") ||
            (scope !== "archived" && row.status === "archived")
          )
            continue;
          const { creationKey, creationHash, ...metadata } = checked.board;
          void creationKey;
          void creationHash;
          notExpired(checked.board, instant(clock));
          result.push(
            CanvasBoardViewSchema.parse({
              schemaVersion: 1,
              ...metadata,
              workspaceName: checked.access.workspace.name,
              organizationName: checked.access.organization?.name,
              status: status(checked.board, checked.source, instant(clock)),
              role: checked.authorization.role,
              capabilities: checked.authorization.capabilities,
              objects: [],
              grants: [],
              invitations: [],
              undoOperationId: null,
              redoOperationId: null,
            }),
          );
        } catch (error) {
          if (!(error instanceof CanvasBoardError && error.code === "NOT_FOUND")) throw error;
        }
      }
      return result;
    });
  }
  private async authorizedMetadata(
    tx: CanvasTransaction,
    actor: CanvasActor,
    id: string,
    clock: CanvasClock,
  ) {
    const board = await tx.metadata(id);
    if (!board) fail();
    const access = await tx.access(board.workspaceId, actor.userId);
    notExpired(board, instant(clock));
    if (
      !access?.user?.verified ||
      access.workspaceDeleting ||
      access.organization?.status !== "active" ||
      access.workspace.status !== "active" ||
      (!access.member &&
        !(access.organization?.accountType === "personal" && access.workspace.membership))
    )
      fail();
    const grant = await tx.grant(id, actor.userId);
    const role = roleFor(
      { board, objects: [], grants: grant ? [grant] : [], receipts: [], invitations: [] },
      actor,
      access,
    );
    if (!role || (access.member?.role === "billing" && role !== "viewer")) fail();
    if (
      access.organization?.licenseUnit === "user" &&
      role !== "viewer" &&
      !access.assignments.some((assignment) => assignment.userId === actor.userId)
    )
      fail();
    const source = board.sourceBoardId ? await tx.sourceMetadata(board.sourceBoardId) : null;
    if (
      board.sourceBoardId &&
      (!source || Date.parse(source.expiresAt) <= instant(clock).getTime())
    )
      fail();
    const seat = this.options.communityMode || currentSeat(access, actor.userId, instant(clock));
    const originSeat =
      this.options.communityMode ||
      access.organization?.licenseUnit !== "user" ||
      access.workspaceLicensed;
    notExpired(board, instant(clock));
    return {
      board,
      access,
      source,
      authorization: {
        boardId: id,
        workspaceId: board.workspaceId,
        canvasSeq: board.canvasSeq,
        sourceRevision: source?.revision ?? null,
        role,
        capabilities: {
          edit:
            role !== "viewer" &&
            seat &&
            originSeat &&
            status(board, source, instant(clock)) === "active",
          facilitate: (role === "owner" || role === "facilitator") && seat && originSeat,
          share: role === "owner" && seat && originSeat,
          delete: role === "owner" && seat,
          archive: role === "owner" && seat && board.boardType === "team",
        },
        expiresAt: board.expiresAt,
      },
    };
  }
  authorize(
    actor: CanvasActor,
    id: string,
    clock: CanvasClock = () => new Date(),
  ): Promise<CanvasBoardAuthorization> {
    return this.run(
      actor,
      { boardId: id },
      async (tx) => (await this.authorizedMetadata(tx, actor, id, clock)).authorization,
    );
  }
  private async guest(
    tx: CanvasTransaction,
    sourceBoardId: string,
    tokenHash: string,
    clock: CanvasClock,
  ) {
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) fail();
    const admission = await tx.sourceMetadata(sourceBoardId, tokenHash);
    if (!admission?.guestPresent || Date.parse(admission.expiresAt) <= instant(clock).getTime())
      fail();
    const row = (await tx.list()).find((board) => board.sourceBoardId === sourceBoardId);
    if (!row) return null;
    const state = await tx.get(row.id);
    if (!state) return null;
    notExpired(state.board, instant(clock));
    const source = sourceCurrent(await tx.source(sourceBoardId), instant(clock));
    if (
      !source.guests.some(
        (guest) =>
          guest.tokenHash.length === tokenHash.length &&
          timingSafeEqual(Buffer.from(guest.tokenHash), Buffer.from(tokenHash)),
      )
    )
      fail();
    return { state, source };
  }
  getGuest(
    sourceBoardId: string,
    tokenHash: string,
    clock: CanvasClock = () => new Date(),
  ): Promise<CanvasBoardGuestView | null> {
    return this.run(null, { sourceBoardId, guestHash: tokenHash }, async (tx) => {
      const value = await this.guest(tx, sourceBoardId, tokenHash, clock);
      if (!value) return null;
      return CanvasBoardGuestViewSchema.parse({
        schemaVersion: 1,
        id: value.state.board.id,
        sourceBoardId,
        canvasSeq: value.state.board.canvasSeq,
        status: status(value.state.board, value.source, instant(clock)),
        objects: projectedObjects(value.state, value.source, true, instant(clock)),
        sourceBoard: ideaBoardProjection(value.source, instant(clock)),
      });
    });
  }
  authorizeGuest(sourceBoardId: string, tokenHash: string, clock: CanvasClock = () => new Date()) {
    return this.run(null, { sourceBoardId, guestHash: tokenHash }, async (tx) => {
      if (!/^[a-f0-9]{64}$/.test(tokenHash)) fail();
      const board = (await tx.list()).find((entry) => entry.sourceBoardId === sourceBoardId);
      if (!board) fail();
      notExpired(board, instant(clock));
      const source = await tx.sourceMetadata(sourceBoardId, tokenHash);
      if (!source?.guestPresent || Date.parse(source.expiresAt) <= instant(clock).getTime()) fail();
      return {
        boardId: board.id,
        workspaceId: board.workspaceId,
        canvasSeq: board.canvasSeq,
        sourceRevision: source.revision,
        expiresAt: board.expiresAt,
      };
    });
  }
  authorizeMedia(
    actor: CanvasActor,
    id: string,
    mediaId: string,
    clock: CanvasClock = () => new Date(),
  ) {
    return this.run(actor, { boardId: id }, async (tx) => {
      const value = await this.checked(tx, actor, id, clock);
      if (!value.source) fail();
      const view = ideaBoardProjection(value.source, instant(clock), value.capabilities.facilitate);
      if (
        !view.ideas.some((idea) =>
          idea.attachments?.some((attachment) => attachment.mediaId === mediaId),
        )
      )
        fail();
      return {
        workspaceId: value.state.board.workspaceId,
        sourceBoardId: value.source.id,
        moderator: value.capabilities.facilitate,
      };
    });
  }
  private async emit(
    tx: CanvasTransaction,
    state: CanvasState,
    type: CanvasBoardEvent["type"],
    now: Date,
  ) {
    await tx.emit(
      {
        eventId: randomUUID(),
        boardId: state.board.id,
        canvasSeq: state.board.canvasSeq,
        type,
        createdAt: now.toISOString(),
      },
      state.board.expiresAt,
    );
  }
  private async targetUser(
    tx: CanvasTransaction,
    state: CanvasState,
    userId: string,
    clock: CanvasClock,
    viewer = false,
  ) {
    const access = await tx.access(state.board.workspaceId, userId);
    if (
      !access?.user?.verified ||
      !access.member ||
      (!viewer && access.member.role === "billing") ||
      access.workspace.organizationId !== state.board.organizationId ||
      access.organization?.status !== "active" ||
      access.workspace.status !== "active" ||
      access.workspaceDeleting
    )
      fail("Choose a verified member of this organization");
    if (!viewer && !this.options.communityMode && !currentSeat(access, userId, instant(clock)))
      throw new CanvasBoardError(
        "FORBIDDEN",
        "Editing collaborators need an active creator license",
      );
    return access.user;
  }
  private async commit(tx: CanvasTransaction, state: CanvasState, clock: CanvasClock) {
    state.board.canvasSeq++;
    state.board.updatedAt = instant(clock).toISOString();
    validateObjects(state.objects);
    if (state.board.boardType === "workshop")
      assert(
        state.objects.filter((object) => object.type !== "idea_ref").length <= 300,
        "Workshop canvases reserve 200 of 500 object slots for approved guest ideas",
      );
    notExpired(state.board, instant(clock));
    await tx.put(state);
    await this.emit(tx, state, "canvas.changed", instant(clock));
  }
  command(
    actor: CanvasActor,
    id: string,
    input: CanvasBoardMutation,
    clock: CanvasClock = () => new Date(),
  ): Promise<CanvasBoardMutationResponse> {
    const mutation = CanvasBoardMutationSchema.parse(input);
    return this.run(actor, { boardId: id }, async (tx) => {
      const checked = await this.checked(tx, actor, id, clock, true),
        { state, source, capabilities } = checked;
      const prior = state.receipts.find(
        (receipt) =>
          receipt.actorId === actor.userId && receipt.operationId === mutation.operationId,
      );
      if (prior) {
        if (prior.hash !== fingerprint(mutation))
          throw new CanvasBoardError(
            "IDEMPOTENCY_CONFLICT",
            "This operation identifier was used for another change",
          );
        return {
          board: this.view(checked, actor, clock),
          receipt: { operationId: prior.operationId, canvasSeq: prior.canvasSeq, type: prior.type },
        };
      }
      if (state.receipts.length >= 5000)
        throw new CanvasBoardError(
          "ENTITLEMENT_LIMIT",
          "This canvas has reached its durable operation limit",
        );
      const command = mutation.command;
      const before: CanvasObject[] = [],
        after: CanvasObject[] = [];
      if (
        command.type === "batch" ||
        command.type === "undo" ||
        command.type === "redo" ||
        (command.type === "workshop" && source && ["draft", "collecting"].includes(source.status))
      )
        state.objects = stripProjected(sourceObjects(state.objects, source));
      if (command.type === "grant" || command.type === "revoke") {
        if (!capabilities.share)
          throw new CanvasBoardError("FORBIDDEN", "Only a board owner can manage sharing");
        if (command.userId === state.board.ownerUserId)
          assert(false, "Board ownership cannot be changed through a grant");
        const grant = state.grants.find((entry) => entry.userId === command.userId);
        assert(grant, "Invite this person and have them accept before changing a grant");
        if (command.type === "grant") {
          await this.targetUser(tx, state, command.userId, clock, command.role === "viewer");
          grant.role = command.role;
        } else state.grants = state.grants.filter((entry) => entry.userId !== command.userId);
      } else if (command.type === "archive" || command.type === "restore") {
        if (!capabilities.archive)
          throw new CanvasBoardError(
            "FORBIDDEN",
            "Only a team canvas owner can archive or restore it",
          );
        state.board.status = command.type === "archive" ? "archived" : "active";
      } else if (command.type === "workshop") {
        if (!source || !capabilities.facilitate)
          throw new CanvasBoardError("FORBIDDEN", "A workshop facilitator is required");
        if (command.command.type === "start_voting" || command.command.type === "close")
          await tx.put(state);
        const legacy = new IdeaBoardRepository(async (_workspace, _id, work) =>
          work({
            get: (sourceId) => tx.source(sourceId, true),
            list: async () => [source],
            put: (row) => tx.putSource(row),
            remove: async () => {
              throw new CanvasBoardError(
                "FORBIDDEN",
                "Delete the source board through its owner controls",
              );
            },
            admission: async () => undefined,
          }),
        );
        await legacy.hostCommand(
          state.board.workspaceId,
          source.id,
          command.command,
          command.expectedRevision,
          mutation.operationId,
          () => instant(clock),
        );
        checked.source = sourceCurrent(await tx.source(source.id), instant(clock));
        if (["draft", "collecting"].includes(checked.source.status))
          state.objects = stripProjected(sourceObjects(state.objects, checked.source));
        if (command.command.type === "moderate" && command.command.status === "removed") {
          const removedIdeaId = command.command.ideaId;
          for (const receipt of state.receipts) {
            if (
              [...receipt.before, ...receipt.after].some(
                (object) => object.type === "idea_ref" && object.ideaId === removedIdeaId,
              )
            )
              receipt.undoable = false;
            receipt.before = receipt.before.filter(
              (object) => object.type !== "idea_ref" || object.ideaId !== removedIdeaId,
            );
            receipt.after = receipt.after.filter(
              (object) => object.type !== "idea_ref" || object.ideaId !== removedIdeaId,
            );
          }
        }
      } else {
        if (!capabilities.edit)
          throw new CanvasBoardError(
            "ROOM_CLOSED",
            "This canvas is read-only or workshop voting has frozen it",
          );
        if (source && !["draft", "collecting"].includes(source.status))
          throw new CanvasBoardError("ROOM_CLOSED", "Workshop content is frozen");
        if (command.type === "batch") {
          const touched = new Set<string>();
          for (const operation of command.operations) {
            const objectId = operation.type === "create" ? operation.object.id : operation.id;
            assert(!touched.has(objectId), "Change each object at most once per batch");
            touched.add(objectId);
            const index = state.objects.findIndex((object) => object.id === objectId),
              existing = state.objects[index];
            if (operation.type === "create") {
              assert(
                !existing &&
                  !state.receipts.some(
                    (receipt) =>
                      receipt.objectVersions?.[objectId] !== undefined ||
                      [...receipt.before, ...receipt.after].some(
                        (object) => object.id === objectId,
                      ),
                  ),
                "This object identifier is already used",
              );
              const object = CanvasObjectSchema.parse({ ...operation.object, version: 1 });
              if (source && object.type !== "idea_ref")
                assert(
                  !source.ideas.some((idea) => idea.id === object.id),
                  "This identifier is reserved for a workshop idea",
                );
              if (object.type === "idea_ref") {
                assert(
                  capabilities.facilitate &&
                    source?.ideas.some(
                      (idea) => idea.id === object.ideaId && idea.status === "approved",
                    ),
                  "Only facilitators can reference an approved workshop idea",
                );
                assert(
                  !state.objects.some(
                    (entry) => entry.type === "idea_ref" && entry.ideaId === object.ideaId,
                  ),
                  "This idea already has a canvas card",
                );
              }
              if (object.visibility === "published" && !capabilities.facilitate && source)
                throw new CanvasBoardError(
                  "FORBIDDEN",
                  "Only facilitators can publish objects to guests",
                );
              state.objects.push(object);
              after.push(object);
            } else {
              if (!existing)
                throw new CanvasBoardError(
                  "STALE_DRAFT",
                  "This object was removed; refresh the canvas",
                );
              if (existing.version !== operation.expectedVersion)
                throw new CanvasBoardError(
                  "STALE_DRAFT",
                  "This object changed; refresh before applying your proposal",
                );
              if (source && existing.visibility === "published" && !capabilities.facilitate)
                throw new CanvasBoardError(
                  "FORBIDDEN",
                  "Only facilitators can change published workshop objects",
                );
              if (
                source &&
                !capabilities.facilitate &&
                state.objects.some(
                  (entry) => entry.type === "idea_ref" && entry.parentId === existing.id,
                )
              )
                throw new CanvasBoardError(
                  "FORBIDDEN",
                  "Only facilitators can change a frame containing guest ideas",
                );
              if (existing.locked && !capabilities.facilitate)
                throw new CanvasBoardError("FORBIDDEN", "This object is locked");
              if (existing.type === "idea_ref" && !capabilities.facilitate)
                throw new CanvasBoardError(
                  "FORBIDDEN",
                  "Only facilitators can arrange guest idea cards",
                );
              before.push(structuredClone(existing));
              if (operation.type === "delete") {
                assert(existing.type !== "idea_ref", "Remove a guest idea through moderation");
                state.objects.splice(index, 1);
              } else {
                if (existing.type === "idea_ref")
                  assert(
                    Object.keys(operation.patch).every((key) =>
                      ["x", "y", "width", "height", "rotation", "zIndex", "parentId"].includes(key),
                    ),
                    "Guest idea content is protected",
                  );
                if (
                  source &&
                  operation.patch.visibility === "published" &&
                  !capabilities.facilitate
                )
                  throw new CanvasBoardError(
                    "FORBIDDEN",
                    "Only facilitators can publish objects to guests",
                  );
                const updated = CanvasObjectSchema.parse({
                  ...existing,
                  ...operation.patch,
                  version: existing.version + 1,
                });
                state.objects[index] = updated;
                after.push(updated);
              }
            }
          }
          const ids = new Set(state.objects.map((object) => object.id));
          for (const object of state.objects) {
            if (object.parentId && !ids.has(object.parentId)) {
              if (!before.some((entry) => entry.id === object.id))
                before.push(structuredClone(object));
              object.parentId = null;
              object.version++;
              after.push(structuredClone(object));
            }
          }
          const dangling = state.objects.filter(
            (object) =>
              object.type === "connector" &&
              ((object.from.objectId && !ids.has(object.from.objectId)) ||
                (object.to.objectId && !ids.has(object.to.objectId))),
          );
          for (const object of dangling) {
            const deletedIds = new Set(
              before.filter((entry) => !ids.has(entry.id)).map((entry) => entry.id),
            );
            if (object.type === "connector")
              for (const endpoint of [object.from, object.to])
                if (endpoint.objectId && !ids.has(endpoint.objectId))
                  assert(
                    deletedIds.has(endpoint.objectId),
                    "Choose an existing connector endpoint",
                  );
            if (!before.some((entry) => entry.id === object.id)) before.push(object);
            state.objects = state.objects.filter((entry) => entry.id !== object.id);
          }
        } else {
          const target = state.receipts.find(
            (receipt) =>
              receipt.operationId === command.targetOperationId &&
              receipt.actorId === actor.userId &&
              receipt.undoable,
          );
          assert(target, "Choose one of your retained canvas operations");
          assert(
            command.type === "undo" ? !target.undone : target.undone,
            "This operation is not in the expected undo state",
          );
          const expected = command.type === "undo" ? target.after : target.before,
            desired = command.type === "undo" ? target.before : target.after;
          const allIds = new Set([...expected, ...desired].map((object) => object.id));
          for (const objectId of allIds) {
            const current = state.objects.find((object) => object.id === objectId),
              expectation = expected.find((object) => object.id === objectId);
            if (
              expectation ? !current || current.version !== expectation.version : Boolean(current)
            )
              throw new CanvasBoardError(
                "STALE_DRAFT",
                "Another change affects this operation; undo cannot overwrite it",
              );
            const restoration = desired.find((object) => object.id === objectId);
            if (
              !capabilities.facilitate &&
              (current?.locked ||
                restoration?.locked ||
                (source &&
                  (current?.type === "idea_ref" ||
                    restoration?.type === "idea_ref" ||
                    current?.visibility === "published" ||
                    restoration?.visibility === "published")))
            )
              throw new CanvasBoardError(
                "FORBIDDEN",
                "Your current role cannot undo protected or published objects",
              );
          }
          for (const objectId of allIds) {
            const current = state.objects.find((object) => object.id === objectId),
              desiredObject = desired.find((object) => object.id === objectId);
            if (current) before.push(current);
            state.objects = state.objects.filter((object) => object.id !== objectId);
            if (desiredObject) {
              const object = {
                ...desiredObject,
                version:
                  Math.max(
                    current?.version ?? 0,
                    desiredObject.version,
                    ...state.receipts.map(
                      (receipt) =>
                        receipt.objectVersions?.[objectId] ??
                        Math.max(
                          0,
                          ...[...receipt.before, ...receipt.after]
                            .filter((object) => object.id === objectId)
                            .map((object) => object.version),
                        ),
                    ),
                  ) + 1,
              };
              state.objects.push(object);
              after.push(object);
            }
          }
          rebaseOwnHistory(state.receipts, actor.userId, desired, after);
          target.historySeq = state.board.canvasSeq + 1;
          if (command.type === "undo") {
            target.undone = true;
            target.before = structuredClone(after);
          } else {
            target.undone = false;
            target.after = structuredClone(after);
          }
        }
      }
      const receipt: CanvasReceipt = {
        operationId: mutation.operationId,
        actorId: actor.userId,
        hash: fingerprint(mutation),
        canvasSeq: state.board.canvasSeq + 1,
        historySeq: state.board.canvasSeq + 1,
        type: command.type,
        before: stripProjected(
          before.filter(
            (object, index) => before.findIndex((entry) => entry.id === object.id) === index,
          ),
        ),
        after: stripProjected(
          state.objects.filter((object) => after.some((entry) => entry.id === object.id)),
        ),
        undone: false,
        undoable: command.type === "batch",
        objectVersions: Object.fromEntries(
          [...before, ...after].map((object) => [
            object.id,
            Math.max(
              object.version,
              ...[...before, ...after]
                .filter((entry) => entry.id === object.id)
                .map((entry) => entry.version),
            ),
          ]),
        ),
      };
      if (Buffer.byteLength(JSON.stringify(receipt)) > 400 * 1024) {
        receipt.before = [];
        receipt.after = [];
        receipt.undoable = false;
      }
      state.receipts.push(receipt);
      let retained = Buffer.byteLength(JSON.stringify(state.receipts));
      for (const entry of state.receipts) {
        if (retained <= 4 * 1024 * 1024) break;
        retained -=
          Buffer.byteLength(JSON.stringify(entry.before)) +
          Buffer.byteLength(JSON.stringify(entry.after));
        entry.before = [];
        entry.after = [];
        entry.undoable = false;
      }
      await this.commit(tx, state, clock);
      if (
        (command.type === "batch" || command.type === "undo" || command.type === "redo") &&
        source &&
        (source.status === "voting" ||
          source.status === "closed" ||
          Date.parse(source.closesAt) <= instant(clock).getTime())
      )
        throw new CanvasBoardError("ROOM_CLOSED", "The workshop collection window has ended");
      // The transaction still holds principal/organization and canvas/source fences.
      // Reproject the committed local state instead of loading 500 objects and history twice.
      const eligible =
        (this.options.communityMode || currentSeat(checked.access, actor.userId, instant(clock))) &&
        (this.options.communityMode ||
          checked.access.organization?.licenseUnit !== "user" ||
          checked.access.workspaceLicensed);
      checked.capabilities.edit =
        checked.role !== "viewer" &&
        Boolean(eligible) &&
        status(state.board, checked.source, instant(clock)) === "active";
      return {
        board: this.view(checked, actor, clock),
        receipt: {
          operationId: receipt.operationId,
          canvasSeq: receipt.canvasSeq,
          type: receipt.type,
        },
      };
    });
  }
  async getWorkshop(
    actor: CanvasActor,
    sourceBoardId: string,
    clock: CanvasClock = () => new Date(),
  ) {
    const rows = await this.list(actor, { scope: "all" }, clock);
    const board = rows.find((entry) => entry.sourceBoardId === sourceBoardId);
    if (!board) fail();
    return this.get(actor, board.id, clock);
  }
  invite(
    actor: CanvasActor,
    id: string,
    input: ReturnType<typeof CanvasBoardInviteSchema.parse>,
    clock: CanvasClock = () => new Date(),
  ): Promise<CanvasBoardInvitation> {
    const parsed = CanvasBoardInviteSchema.parse(input);
    return this.run(actor, { boardId: id }, async (tx) => {
      const value = await this.checked(tx, actor, id, clock, true);
      if (!value.capabilities.share)
        throw new CanvasBoardError("FORBIDDEN", "Only a board owner can invite collaborators");
      const prior = value.state.receipts.find(
        (receipt) => receipt.operationId === parsed.operationId && receipt.actorId === actor.userId,
      );
      if (prior) {
        if (prior.hash !== fingerprint(parsed))
          throw new CanvasBoardError(
            "IDEMPOTENCY_CONFLICT",
            "This invitation identifier was used differently",
          );
        const invitation = value.state.invitations.find((entry) => entry.id === parsed.operationId);
        if (!invitation) fail();
        return invitation;
      }
      const target = await tx.findUser(parsed.email, value.state.board.organizationId);
      if (!target) fail("Invite an existing verified member of this organization");
      await this.targetUser(tx, value.state, target.userId, clock, parsed.role === "viewer");
      assert(target.userId !== value.state.board.ownerUserId, "The board owner already has access");
      assert(value.state.invitations.length < 100, "Use up to 100 retained invitations per board");
      const now = instant(clock),
        invitation: CanvasBoardInvitation = {
          id: parsed.operationId,
          boardId: id,
          email: target.email,
          role: parsed.role,
          createdAt: now.toISOString(),
          expiresAt: new Date(
            Math.min(Date.parse(value.state.board.expiresAt), now.getTime() + 7 * 86400000),
          ).toISOString(),
          acceptedAt: null,
          revokedAt: null,
        };
      value.state.invitations.push(invitation);
      value.state.receipts.push({
        operationId: parsed.operationId,
        actorId: actor.userId,
        hash: fingerprint(parsed),
        canvasSeq: value.state.board.canvasSeq + 1,
        type: "invite",
        before: [],
        after: [],
        undone: false,
        undoable: false,
      });
      await this.commit(tx, value.state, clock);
      return invitation;
    });
  }
  private async pendingInvitation(
    tx: CanvasTransaction,
    actor: CanvasActor,
    invitationId: string,
    clock: CanvasClock,
  ) {
    const metadata = await tx.invitation(invitationId);
    if (!metadata) fail();
    const state = await tx.get(metadata.boardId, true);
    if (!state) fail();
    const invitation = state.invitations.find((entry) => entry.id === invitationId);
    if (
      !invitation ||
      invitation.revokedAt ||
      Date.parse(invitation.expiresAt) <= instant(clock).getTime()
    )
      fail("This invitation is unavailable or expired");
    const user = await this.targetUser(
      tx,
      state,
      actor.userId,
      clock,
      invitation.role === "viewer",
    );
    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) fail();
    notExpired(state.board, instant(clock));
    return { state, invitation };
  }
  invitationWorkspace(
    actor: CanvasActor,
    invitationId: string,
    clock: CanvasClock = () => new Date(),
  ) {
    return this.run(actor, { invitationId }, async (tx) => {
      const value = await this.pendingInvitation(tx, actor, invitationId, clock);
      return value.state.board.workspaceId;
    });
  }
  acceptInvitation(
    actor: CanvasActor,
    invitationId: string,
    clock: CanvasClock = () => new Date(),
  ) {
    return this.run(actor, { invitationId }, async (tx) => {
      const { state, invitation } = await this.pendingInvitation(tx, actor, invitationId, clock);
      if (!invitation.acceptedAt) {
        assert(state.grants.length < 100, "Use up to 100 board collaborators");
        state.grants = state.grants.filter((grant) => grant.userId !== actor.userId);
        state.grants.push({
          userId: actor.userId,
          role: invitation.role,
          createdAt: instant(clock).toISOString(),
          label: invitation.email,
        });
        invitation.acceptedAt = instant(clock).toISOString();
        await this.commit(tx, state, clock);
      }
      return this.view(await this.checked(tx, actor, state.board.id, clock), actor, clock);
    });
  }
  revokeInvitation(
    actor: CanvasActor,
    id: string,
    invitationId: string,
    clock: CanvasClock = () => new Date(),
  ) {
    return this.run(actor, { boardId: id }, async (tx) => {
      const value = await this.checked(tx, actor, id, clock, true);
      if (!value.capabilities.share)
        throw new CanvasBoardError("FORBIDDEN", "Only a board owner can revoke invitations");
      const invitation = value.state.invitations.find((entry) => entry.id === invitationId);
      if (!invitation) fail();
      if (!invitation.revokedAt) {
        invitation.revokedAt = instant(clock).toISOString();
        await this.commit(tx, value.state, clock);
      }
    });
  }
  revokeGrant(
    actor: CanvasActor,
    id: string,
    userId: string,
    clock: CanvasClock = () => new Date(),
  ) {
    CanvasBoardCommandSchema.parse({ type: "revoke", userId });
    return this.run(actor, { boardId: id }, async (tx) => {
      const value = await this.checked(tx, actor, id, clock, true);
      if (!value.capabilities.share)
        throw new CanvasBoardError("FORBIDDEN", "Only a board owner can manage sharing");
      assert(
        userId !== value.state.board.ownerUserId,
        "Board ownership cannot be changed through a grant",
      );
      if (!value.state.grants.some((grant) => grant.userId === userId)) return;
      value.state.grants = value.state.grants.filter((grant) => grant.userId !== userId);
      await this.commit(tx, value.state, clock);
    });
  }
  delete(actor: CanvasActor, id: string, clock: CanvasClock = () => new Date()) {
    return this.run(actor, { boardId: id }, async (tx) => {
      const value = await this.checked(tx, actor, id, clock, true);
      if (!value.capabilities.delete)
        throw new CanvasBoardError("FORBIDDEN", "Only a board owner can delete this canvas");
      value.state.board.canvasSeq++;
      await tx.emit(
        {
          eventId: randomUUID(),
          boardId: id,
          canvasSeq: value.state.board.canvasSeq,
          type: "canvas.deleted",
          createdAt: instant(clock).toISOString(),
        },
        new Date(
          Math.min(Date.parse(value.state.board.expiresAt), instant(clock).getTime() + 60_000),
        ).toISOString(),
      );
      await tx.remove(id);
    });
  }
  async listOutbox(after = 0, limit = 100) {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1)
      throw new CanvasBoardError("VALIDATION_ERROR", "Use a valid event cursor");
    const events =
      this.store instanceof MemoryCanvasBoards
        ? this.store.events
            .filter((entry) => entry.cursor > after && Date.parse(entry.expiresAt) > Date.now())
            .slice(0, Math.min(500, limit))
            .map(({ expiresAt, leaseToken, leasedUntil, delivered, ...event }) => {
              void expiresAt;
              void leaseToken;
              void leasedUntil;
              void delivered;
              return event;
            })
        : await postgresCanvasEvents(this.store, after, limit);
    return { events, cursor: events.at(-1)?.cursor ?? after };
  }
  async claimOutbox(now = new Date(), leaseMs = 30000) {
    if (this.store instanceof MemoryCanvasBoards) {
      const event = this.store.events.find(
        (entry) =>
          !entry.delivered &&
          (!entry.leasedUntil || entry.leasedUntil <= now.getTime()) &&
          Date.parse(entry.expiresAt) > now.getTime(),
      );
      if (!event) return null;
      event.leaseToken = randomUUID();
      event.leasedUntil = now.getTime() + leaseMs;
      return { ...event };
    }
    const client = await this.store.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.canvas_relay','on',true)");
      const token = randomUUID();
      const result = await client.query(
        "WITH candidate AS (SELECT cursor FROM canvas_board_outbox WHERE delivered_at IS NULL AND expires_at>$1 AND (leased_until IS NULL OR leased_until<=$1) ORDER BY cursor FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE canvas_board_outbox event SET lease_token=$2,leased_until=$3 FROM candidate WHERE event.cursor=candidate.cursor RETURNING event.*",
        [now, token, new Date(now.getTime() + leaseMs)],
      );
      await client.query("COMMIT");
      return result.rows[0]
        ? { ...result.rows[0].data, cursor: Number(result.rows[0].cursor), leaseToken: token }
        : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async completeOutbox(eventId: string, leaseToken: string, now = new Date()) {
    if (this.store instanceof MemoryCanvasBoards) {
      const event = this.store.events.find(
        (entry) =>
          entry.eventId === eventId &&
          entry.leaseToken === leaseToken &&
          !entry.delivered &&
          entry.leasedUntil! > now.getTime(),
      );
      if (!event) return false;
      event.delivered = true;
      return true;
    }
    const client = await this.store.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.canvas_relay','on',true)");
      const result = await client.query(
        "UPDATE canvas_board_outbox SET delivered_at=$3 WHERE event_id=$1 AND lease_token=$2 AND delivered_at IS NULL AND leased_until>$3",
        [eventId, leaseToken, now],
      );
      await client.query("COMMIT");
      return Boolean(result.rowCount);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
export function createCanvasBoardRepository(
  repository: Repository,
  options: { communityMode?: boolean; communityRetentionDays?: number } = {},
) {
  if (repository instanceof MemoryRepository) {
    const store = repository.getOrCreateLifecycleExtension(
      "canvasBoards",
      () => new MemoryCanvasBoards(repository),
    );
    return new CanvasBoardRepository(store.run, store, options);
  }
  if (repository instanceof PostgresRepository) {
    const execute = postgresCanvasRun(repository);
    const run: CanvasRun = async (actor, scope, work) => {
      try {
        return await execute(actor, scope, work);
      } catch (error) {
        const candidate = error as { code?: string; message?: string };
        if (candidate.code === "23514" && candidate.message?.includes("Workshop canvas is frozen"))
          throw new CanvasBoardError("ROOM_CLOSED", "Workshop content is frozen");
        if (candidate.code === "23505")
          throw new CanvasBoardError(
            "IDEMPOTENCY_CONFLICT",
            "This canvas identifier or source is already in use",
          );
        throw error;
      }
    };
    return new CanvasBoardRepository(run, repository, options);
  }
  throw new Error("Unsupported canvas board repository");
}
