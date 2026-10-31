import { createHash } from "node:crypto";
import {
  CANVAS_ARTIFACT_LINK_LIMIT,
  CANVAS_ARTIFACT_LINK_RECEIPT_LIMIT,
  CanvasArtifactLinkCreateSchema,
  CanvasArtifactLinkDeleteSchema,
  CanvasArtifactLinkListSchema,
  CanvasArtifactLinkEligibleSchema,
  type CanvasArtifactLinkCreate,
  type CanvasArtifactLinkDelete,
} from "@openround/contracts";
import { MemoryRepository, type MemoryRepositoryLifecycleContext } from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { MemoryCanvasBoards, postgresCanvasRun } from "./canvas-board-store.js";
import { CanvasBoardRepository } from "./canvas-boards.js";
import { CanvasBoardError } from "./canvas-board-error.js";
import { createPresentationRepository, MemoryPresentationRepository } from "./presentations.js";
import { activeSubscription, stablePlatformJson } from "./platform-service.js";
import { getMemoryPlatformRepository } from "./platform-memory.js";
import { memoryIdeaBoardCanvasSource } from "./idea-boards.js";
import type { CanvasTransaction, CanvasAccessContext } from "./canvas-board-types.js";
import type { Repository } from "./types.js";

export interface CanvasArtifactTarget {
  workspaceId: string;
  kind: "round" | "presentation";
  id: string;
}
interface Link {
  id: string;
  workspaceId: string;
  targetKind: CanvasArtifactTarget["kind"];
  targetId: string;
  boardId: string;
  versionId: string;
  createdBy: string | null;
  createdAt: string;
  revision: 1;
}
interface Receipt {
  operationId: string;
  actorId: string | null;
  hash: string;
  requestedLinkId: string;
  linkId: string;
  deleted: boolean;
  workspaceId: string;
  targetKind: CanvasArtifactTarget["kind"];
  targetId: string;
}
const sameTarget = (
  row: { workspaceId: string; targetKind: string; targetId: string },
  target: CanvasArtifactTarget,
) =>
  row.workspaceId === target.workspaceId &&
  row.targetKind === target.kind &&
  row.targetId === target.id;
function missing(): never {
  throw new CanvasBoardError("NOT_FOUND", "Snapshot link is unavailable");
}
function forbidden(): never {
  throw new CanvasBoardError(
    "FORBIDDEN",
    "Only the canvas owner and destination editors can change snapshot links",
  );
}
const fingerprint = (value: unknown) =>
  createHash("sha256").update(stablePlatformJson(value)).digest("hex");

class MemoryCanvasArtifactLinks {
  constructor(private readonly repository: MemoryRepository) {}
  readonly links = new Map<string, Link>();
  readonly receipts: Receipt[] = [];
  syncCanvasArtifactLinks(boardId: string, versions: ReadonlySet<string>) {
    for (const [id, link] of this.links)
      if (link.boardId === boardId && !versions.has(link.versionId)) this.links.delete(id);
  }
  deleteLibraryArtifactMetadata(workspaceId: string, kind: string, id: string) {
    const target = { workspaceId, kind, id } as CanvasArtifactTarget;
    for (const [key, link] of this.links) if (sameTarget(link, target)) this.links.delete(key);
    for (let i = this.receipts.length - 1; i >= 0; i--)
      if (sameTarget(this.receipts[i]!, target)) this.receipts.splice(i, 1);
  }
  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    const canvases = this.repository.getOrCreateLifecycleExtension(
      "canvasBoards",
      () => new MemoryCanvasBoards(this.repository),
    );
    return {
      canvasArtifactLinks: structuredClone(
        [...this.links.values()].filter((link) => {
          const source = canvases.rows.get(link.boardId);
          return (
            ownedWorkspaceIds.has(link.workspaceId) &&
            source &&
            Date.parse(source.board.expiresAt) > Date.now() &&
            source.facilitation?.versions.some((saved) => saved.metadata.id === link.versionId)
          );
        }),
      ),
    };
  }
  deleteAccount({ userId, ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    for (const [id, link] of this.links) {
      if (ownedWorkspaceIds.has(link.workspaceId)) this.links.delete(id);
      else if (link.createdBy === userId) link.createdBy = null;
    }
    for (let i = this.receipts.length - 1; i >= 0; i--) {
      const receipt = this.receipts[i]!;
      if (ownedWorkspaceIds.has(receipt.workspaceId)) this.receipts.splice(i, 1);
      else if (receipt.actorId === userId) receipt.actorId = null;
    }
  }
}
type Context = {
  tx: CanvasTransaction;
  source: CanvasBoardRepository;
  edit: boolean;
  target: CanvasArtifactTarget;
  actor: { userId: string };
  staged?: { links: Link[]; receipts: Receipt[] };
  sourceFences: Map<string, SourceFence>;
  linkFences: Map<string, string>;
  memoryAuthority?: string;
  targetAccess?: CanvasAccessContext;
  requireActive?: boolean;
};
interface SourceFence {
  boardId: string;
  owner: boolean;
  canvasSeq: number;
  sourceRevision: number | null;
  expiresAt: string;
  sourceExpiresAt?: string;
  memorySnapshot?: string;
}
function eligible(access: CanvasAccessContext, userId: string, community: boolean) {
  if (community || access.organization?.licenseUnit !== "user") return true;
  const subscription = access.subscription;
  return Boolean(
    access.workspaceLicensed &&
    subscription &&
    !access.commercialHold &&
    activeSubscription(subscription, new Date()) &&
    access.assignments
      .slice()
      .sort(
        (a, b) =>
          a.assignedAt.getTime() - b.assignedAt.getTime() || a.userId.localeCompare(b.userId),
      )
      .slice(0, subscription.licenseQuantity)
      .some((item) => item.userId === userId),
  );
}

/** Authoring-only relationships. No scene, guest body, media copy, or access capability is stored. */
export class CanvasArtifactLinkRepository {
  private readonly memory: MemoryCanvasArtifactLinks | null;
  private readonly canvasStore: MemoryCanvasBoards | PostgresRepository;
  constructor(
    private readonly repository: MemoryRepository | PostgresRepository,
    private readonly options: { communityMode?: boolean } = {},
  ) {
    this.memory =
      repository instanceof MemoryRepository
        ? repository.getOrCreateLifecycleExtension(
            "canvasArtifactLinks",
            () => new MemoryCanvasArtifactLinks(repository),
          )
        : null;
    this.canvasStore =
      repository instanceof MemoryRepository
        ? repository.getOrCreateLifecycleExtension(
            "canvasBoards",
            () => new MemoryCanvasBoards(repository),
          )
        : repository;
  }
  private memoryTarget(target: CanvasArtifactTarget) {
    if (!(this.repository instanceof MemoryRepository)) return null;
    if (target.kind === "round") return this.repository.quizzes.get(target.id) ?? null;
    const presentations = createPresentationRepository(this.repository);
    return presentations instanceof MemoryPresentationRepository
      ? (presentations.presentations.get(target.id) ?? null)
      : null;
  }
  private memoryAuthority(ctx: Context) {
    if (!(this.repository instanceof MemoryRepository)) return undefined;
    const platform = getMemoryPlatformRepository(this.repository).memoryStore;
    const workspace = platform.getSync<{ organizationId: string }>(
      "workspace",
      ctx.target.workspaceId,
    );
    const organizationId = workspace?.organizationId ?? "";
    const assignments = platform.listSync<{ userId: string }>("user_license", organizationId);
    const user = this.repository.users.get(ctx.actor.userId);
    return fingerprint({
      workspace,
      user: user && { verifiedAt: user.emailVerifiedAt, deletedAt: user.deletedAt },
      membership: this.repository.workspaceMembers.get(
        `${ctx.target.workspaceId}:${ctx.actor.userId}`,
      ),
      organization: platform.getSync("organization", organizationId),
      member: platform.getSync("member", `${organizationId}:${ctx.actor.userId}`),
      subscription: platform.getSync("subscription", organizationId),
      assignments,
      assignmentMembers: assignments.map((row) =>
        platform.getSync("member", `${organizationId}:${row.userId}`),
      ),
      workspaceLicenses: platform.listSync("license", organizationId),
      commercialHold: platform.getSync("commercial_hold", organizationId),
      workspaceDeleting: this.repository.workspaceMediaDeletionJobs.has(ctx.target.workspaceId),
    });
  }
  private memorySource(ctx: Context, boardId: string) {
    if (!(this.canvasStore instanceof MemoryCanvasBoards)) return undefined;
    const state = this.canvasStore.rows.get(boardId);
    const source = state?.board.sourceBoardId
      ? memoryIdeaBoardCanvasSource(this.canvasStore.repository, state.board.sourceBoardId)
      : null;
    return fingerprint({
      board: state?.board,
      grant: state?.grants.find((row) => row.userId === ctx.actor.userId),
      versions: state?.facilitation?.versions.map((row) => row.metadata),
      source: source && {
        id: source.id,
        revision: source.revision,
        expiresAt: source.expiresAt,
      },
    });
  }
  private checkAccess(ctx: Context, access: CanvasAccessContext | null, write: boolean) {
    if (
      !access?.user?.verified ||
      !access.workspace.membership ||
      access.workspaceDeleting ||
      access.workspace.status !== "active" ||
      access.organization?.status !== "active" ||
      (!access.member && access.organization.accountType !== "personal")
    )
      missing();
    ctx.edit =
      access.workspace.membership !== "viewer" &&
      eligible(access, ctx.actor.userId, Boolean(this.options.communityMode));
    if (write && !ctx.edit) forbidden();
    ctx.targetAccess = access;
  }
  private async target(ctx: Context, write = false) {
    const access = await ctx.tx.access(ctx.target.workspaceId, ctx.actor.userId);
    this.checkAccess(ctx, access, write);
    const client = ctx.tx.sqlClient;
    const row = client
      ? (
          await client.query(
            `SELECT workspace_id AS "workspaceId",status FROM ${ctx.target.kind === "round" ? "quizzes" : "presentations"} WHERE workspace_id=$1 AND id=$2 FOR ${write ? "UPDATE" : "SHARE"}`,
            [ctx.target.workspaceId, ctx.target.id],
          )
        ).rows[0]
      : this.memoryTarget(ctx.target);
    if (!row || row.workspaceId !== ctx.target.workspaceId) missing();
    return row as { status: string };
  }
  private async refreshSource(ctx: Context, fence: SourceFence) {
    const access = await ctx.source.authorize(ctx.actor, fence.boardId);
    if (access.workspaceId !== ctx.target.workspaceId) missing();
    if (fence.owner && (access.role !== "owner" || !access.capabilities.share)) forbidden();
    const board = await ctx.tx.metadata(fence.boardId);
    const source = board?.sourceBoardId
      ? await ctx.tx.sourceMetadata(board.sourceBoardId, undefined, true)
      : null;
    if (!board || (board.sourceBoardId && !source)) missing();
    if (
      access.canvasSeq !== fence.canvasSeq ||
      access.sourceRevision !== fence.sourceRevision ||
      (source?.revision ?? null) !== fence.sourceRevision
    )
      throw new CanvasBoardError(
        "STALE_DRAFT",
        "The linked canvas changed. Refresh before continuing",
      );
    fence.expiresAt = board.expiresAt;
    fence.sourceExpiresAt = source?.expiresAt;
  }
  private finalFence(ctx: Context, write: boolean) {
    // No await inside this transaction may follow these checks before publishing its result.
    const now = Date.now();
    for (const fence of ctx.sourceFences.values()) {
      if (
        Date.parse(fence.expiresAt) <= now ||
        (fence.sourceExpiresAt && Date.parse(fence.sourceExpiresAt) <= now)
      )
        missing();
      if (fence.memorySnapshot !== this.memorySource(ctx, fence.boardId)) missing();
    }
    if (ctx.memoryAuthority !== this.memoryAuthority(ctx)) missing();
    if (ctx.targetAccess) this.checkAccess(ctx, ctx.targetAccess, write);
    if (this.memory) {
      const target = this.memoryTarget(ctx.target);
      if (!target || target.workspaceId !== ctx.target.workspaceId) missing();
      if (ctx.requireActive && target.status === "archived")
        throw new CanvasBoardError("ROOM_CLOSED", "Restore this artifact before linking a canvas");
      for (const [id, snapshot] of ctx.linkFences)
        if (fingerprint(this.memory.links.get(id) ?? null) !== snapshot) missing();
      // Match PostgreSQL's global primary key even though staged state is destination-scoped.
      for (const row of ctx.staged?.links ?? []) {
        const existing = this.memory.links.get(row.id);
        if (existing && !sameTarget(existing, ctx.target))
          throw new CanvasBoardError("IDEMPOTENCY_CONFLICT", "Choose a new link identifier");
      }
    }
  }
  private trackLink(ctx: Context, link: Link) {
    if (this.memory) ctx.linkFences.set(link.id, fingerprint(link));
  }
  private async run<T>(
    actor: { userId: string },
    target: CanvasArtifactTarget,
    write: boolean,
    work: (ctx: Context) => Promise<T>,
    delivery: "read" | "receipt" = write ? "receipt" : "read",
  ) {
    const run =
      this.canvasStore instanceof MemoryCanvasBoards
        ? this.canvasStore.run
        : postgresCanvasRun(this.canvasStore);
    let deliveryDeadline = Number.POSITIVE_INFINITY;
    const result = await run(actor, { workspaceId: target.workspaceId }, async (tx) => {
      const source = new CanvasBoardRepository(
        (_actor, _scope, inner) => inner(tx),
        this.canvasStore,
        this.options,
      );
      const ctx: Context = {
        tx,
        source,
        edit: false,
        target,
        actor,
        sourceFences: new Map(),
        linkFences: new Map(),
      };
      ctx.memoryAuthority = this.memoryAuthority(ctx);
      if (this.memory && write)
        ctx.staged = {
          links: structuredClone(
            [...this.memory.links.values()].filter((row) => sameTarget(row, target)),
          ),
          receipts: structuredClone(this.memory.receipts.filter((row) => sameTarget(row, target))),
        };
      if (tx.sqlClient) {
        await tx.sqlClient.query(
          "SELECT set_config('app.canvas_artifact_target_kind',$1,true),set_config('app.canvas_artifact_target_id',$2,true)",
          [target.kind, target.id],
        );
      }
      await this.target(ctx, write);
      const result = await work(ctx);
      for (const fence of ctx.sourceFences.values()) await this.refreshSource(ctx, fence);
      const current = await this.target(ctx, write);
      if (ctx.requireActive && current.status === "archived")
        throw new CanvasBoardError("ROOM_CLOSED", "Restore this artifact before linking a canvas");
      this.finalFence(ctx, write);
      if (delivery === "read")
        for (const fence of ctx.sourceFences.values())
          deliveryDeadline = Math.min(
            deliveryDeadline,
            Date.parse(fence.expiresAt),
            fence.sourceExpiresAt ? Date.parse(fence.sourceExpiresAt) : Number.POSITIVE_INFINITY,
          );
      if (this.memory && ctx.staged) {
        // Publish only after all awaited identity, source, expiry and destination fences pass.
        if (!this.memoryTarget(target)) missing();
        for (const [id, link] of this.memory.links)
          if (sameTarget(link, target)) this.memory.links.delete(id);
        for (const link of ctx.staged.links) this.memory.links.set(link.id, link);
        for (let i = this.memory.receipts.length - 1; i >= 0; i--)
          if (sameTarget(this.memory.receipts[i]!, target)) this.memory.receipts.splice(i, 1);
        this.memory.receipts.push(...ctx.staged.receipts);
      }
      return result;
    });
    // COMMIT/release can await after the transactional fence. Only deadline validity moves
    // with time; identity/revocation stays linearized in that transaction, and receipts stay durable.
    if (deliveryDeadline <= Date.now()) missing();
    return result;
  }
  private async links(ctx: Context): Promise<Link[]> {
    if (ctx.staged) return ctx.staged.links;
    if (this.memory)
      return structuredClone(
        [...this.memory.links.values()].filter((row) => sameTarget(row, ctx.target)),
      );
    return (
      await ctx.tx.sqlClient!.query(
        `SELECT id,workspace_id AS "workspaceId",target_kind AS "targetKind",target_id AS "targetId",board_id AS "boardId",version_id AS "versionId",created_by AS "createdBy",created_at AS "createdAt",revision FROM canvas_artifact_links WHERE target_kind=$1 AND target_id=$2 ORDER BY created_at,id`,
        [ctx.target.kind, ctx.target.id],
      )
    ).rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })) as Link[];
  }
  private async receipts(ctx: Context): Promise<Receipt[]> {
    if (ctx.staged) return ctx.staged.receipts;
    if (this.memory) return this.memory.receipts.filter((row) => sameTarget(row, ctx.target));
    return (
      await ctx.tx.sqlClient!.query(
        `SELECT workspace_id AS "workspaceId",target_kind AS "targetKind",target_id AS "targetId",actor_id AS "actorId",operation_id AS "operationId",request_hash AS hash,requested_link_id AS "requestedLinkId",link_id AS "linkId",deleted FROM canvas_artifact_link_receipts WHERE target_kind=$1 AND target_id=$2`,
        [ctx.target.kind, ctx.target.id],
      )
    ).rows as Receipt[];
  }
  private async source(ctx: Context, boardId: string, versionId: string, owner = false) {
    const memorySnapshot = this.memorySource(ctx, boardId);
    const access = await ctx.source.authorize(ctx.actor, boardId);
    if (access.workspaceId !== ctx.target.workspaceId) missing();
    if (owner && (access.role !== "owner" || !access.capabilities.share)) forbidden();
    const version = await ctx.source.getVersion(ctx.actor, boardId, versionId);
    const board = await ctx.tx.metadata(boardId);
    if (!board) missing();
    const fresh = await ctx.source.authorize(ctx.actor, boardId);
    if (fresh.canvasSeq !== access.canvasSeq || fresh.sourceRevision !== access.sourceRevision)
      throw new CanvasBoardError(
        "STALE_DRAFT",
        "The linked canvas changed. Refresh before continuing",
      );
    this.recordSource(ctx, {
      boardId,
      owner,
      canvasSeq: fresh.canvasSeq,
      sourceRevision: fresh.sourceRevision,
      expiresAt: board.expiresAt,
      memorySnapshot,
    });
    return { access: fresh, board, version };
  }
  private recordSource(ctx: Context, fence: SourceFence) {
    const previous = ctx.sourceFences.get(fence.boardId);
    if (
      previous &&
      (previous.canvasSeq !== fence.canvasSeq ||
        previous.sourceRevision !== fence.sourceRevision ||
        previous.memorySnapshot !== fence.memorySnapshot)
    )
      throw new CanvasBoardError(
        "STALE_DRAFT",
        "The linked canvas changed. Refresh before continuing",
      );
    ctx.sourceFences.set(fence.boardId, {
      ...fence,
      owner: fence.owner || Boolean(previous?.owner),
    });
  }
  async list(actor: { userId: string }, target: CanvasArtifactTarget) {
    return this.run(actor, target, false, async (ctx) => {
      const links = [];
      const archived = (await this.target(ctx)).status === "archived";
      for (const link of await this.links(ctx)) {
        try {
          const source = await this.source(ctx, link.boardId, link.versionId);
          this.trackLink(ctx, link);
          links.push({
            ...link,
            boardTitle: source.board.title,
            name: source.version.version.name,
            canDelete:
              ctx.edit && source.access.role === "owner" && source.access.capabilities.share,
          });
        } catch (error) {
          if (!(
            error instanceof CanvasBoardError &&
            ["NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED"].includes(error.code)
          ))
            throw error;
        }
      }
      await this.target(ctx);
      return CanvasArtifactLinkListSchema.parse({
        schemaVersion: 1,
        canCreate: ctx.edit && !archived,
        links: links.map(
          ({ workspaceId: _workspaceId, targetKind: _targetKind, targetId: _targetId, ...link }) =>
            link,
        ),
      });
    });
  }
  async eligible(actor: { userId: string }, target: CanvasArtifactTarget) {
    return this.run(
      actor,
      target,
      true,
      async (ctx) => {
        if ((await this.target(ctx, true)).status === "archived")
          return { schemaVersion: 1 as const, boards: [] };
        const boards = [];
        for (const board of await ctx.source.list(actor, { scope: "owned" })) {
          if (board.workspaceId !== target.workspaceId || board.status === "archived") continue;
          const access = await ctx.source.authorize(actor, board.id);
          if (access.role !== "owner" || !access.capabilities.share) continue;
          const memorySnapshot = this.memorySource(ctx, board.id);
          const facilitation = await ctx.source.getFacilitation(actor, board.id);
          if (facilitation.versions.length) {
            this.recordSource(ctx, {
              boardId: board.id,
              owner: true,
              canvasSeq: access.canvasSeq,
              sourceRevision: access.sourceRevision,
              expiresAt: access.expiresAt,
              memorySnapshot,
            });
            boards.push({ id: board.id, title: board.title, versions: facilitation.versions });
          }
          if (boards.length === 50) break;
        }
        await this.target(ctx, true);
        return CanvasArtifactLinkEligibleSchema.parse({ schemaVersion: 1, boards });
      },
      "read",
    );
  }
  private response(receipt: Receipt) {
    return {
      schemaVersion: 1 as const,
      receipt: {
        operationId: receipt.operationId,
        linkId: receipt.linkId,
        deleted: receipt.deleted,
      },
    };
  }
  private prior(
    receipts: Receipt[],
    actorId: string,
    operationId: string,
    hash: string,
    limit = CANVAS_ARTIFACT_LINK_RECEIPT_LIMIT,
  ) {
    const prior = receipts.find(
      (row) => row.actorId === actorId && row.operationId === operationId,
    );
    if (prior && prior.hash !== hash)
      throw new CanvasBoardError("IDEMPOTENCY_CONFLICT", "Use the original snapshot-link request");
    if (!prior && receipts.length >= limit)
      throw new CanvasBoardError(
        "ENTITLEMENT_LIMIT",
        "This artifact has reached its snapshot-link operation limit",
      );
    return prior;
  }
  private async saveReceipt(ctx: Context, receipt: Receipt) {
    if (ctx.staged) ctx.staged.receipts.push(structuredClone(receipt));
    else
      await ctx.tx.sqlClient!.query(
        `INSERT INTO canvas_artifact_link_receipts(workspace_id,target_kind,target_id,quiz_id,presentation_id,actor_id,operation_id,request_hash,requested_link_id,link_id,deleted) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          receipt.workspaceId,
          receipt.targetKind,
          receipt.targetId,
          receipt.targetKind === "round" ? receipt.targetId : null,
          receipt.targetKind === "presentation" ? receipt.targetId : null,
          receipt.actorId,
          receipt.operationId,
          receipt.hash,
          receipt.requestedLinkId,
          receipt.linkId,
          receipt.deleted,
        ],
      );
  }
  async create(
    actor: { userId: string },
    target: CanvasArtifactTarget,
    value: CanvasArtifactLinkCreate,
  ) {
    const input = CanvasArtifactLinkCreateSchema.parse(value),
      hash = fingerprint({ type: "create", input });
    return this.run(actor, target, true, async (ctx) => {
      const receipts = await this.receipts(ctx),
        // Reserve enough durable receipts to unlink every retained relationship at capacity.
        prior = this.prior(
          receipts,
          actor.userId,
          input.operationId,
          hash,
          CANVAS_ARTIFACT_LINK_RECEIPT_LIMIT - CANVAS_ARTIFACT_LINK_LIMIT,
        );
      if (prior) return this.response(prior);
      ctx.requireActive = true;
      if ((await this.target(ctx, true)).status === "archived")
        throw new CanvasBoardError("ROOM_CLOSED", "Restore this artifact before linking a canvas");
      const source = await this.source(ctx, input.boardId, input.versionId, true);
      if (source.board.status === "archived")
        throw new CanvasBoardError(
          "ROOM_CLOSED",
          "Restore this canvas before linking a checkpoint",
        );
      const links = await this.links(ctx);
      if (
        receipts.some(
          (row) => row.requestedLinkId === input.linkId || row.linkId === input.linkId,
        ) ||
        links.some((row) => row.id === input.linkId) ||
        this.memory?.links.has(input.linkId)
      )
        throw new CanvasBoardError(
          "IDEMPOTENCY_CONFLICT",
          "Choose a new link identifier; retired identifiers cannot be reused",
        );
      let link = links.find(
        (row) => row.boardId === input.boardId && row.versionId === input.versionId,
      );
      if (link) this.trackLink(ctx, link);
      if (!link && links.length >= CANVAS_ARTIFACT_LINK_LIMIT)
        throw new CanvasBoardError("ENTITLEMENT_LIMIT", "Keep up to 20 canvas links per artifact");
      if (!link) {
        link = {
          id: input.linkId,
          workspaceId: target.workspaceId,
          targetKind: target.kind,
          targetId: target.id,
          boardId: input.boardId,
          versionId: input.versionId,
          createdBy: actor.userId,
          createdAt: new Date().toISOString(),
          revision: 1,
        };
        if (ctx.staged) ctx.staged.links.push(structuredClone(link));
        else {
          const inserted = await ctx.tx.sqlClient!.query(
            `INSERT INTO canvas_artifact_links(id,workspace_id,target_kind,target_id,quiz_id,presentation_id,board_id,version_id,created_by,created_at,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1) ON CONFLICT(id) DO NOTHING RETURNING id`,
            [
              link.id,
              link.workspaceId,
              link.targetKind,
              link.targetId,
              link.targetKind === "round" ? link.targetId : null,
              link.targetKind === "presentation" ? link.targetId : null,
              link.boardId,
              link.versionId,
              link.createdBy,
              link.createdAt,
            ],
          );
          if (!inserted.rowCount)
            throw new CanvasBoardError("IDEMPOTENCY_CONFLICT", "Choose a new link identifier");
        }
      }
      const receipt: Receipt = {
        workspaceId: target.workspaceId,
        targetKind: target.kind,
        targetId: target.id,
        actorId: actor.userId,
        operationId: input.operationId,
        hash,
        requestedLinkId: input.linkId,
        linkId: link.id,
        deleted: false,
      };
      await this.saveReceipt(ctx, receipt);
      return this.response(receipt);
    });
  }
  async delete(
    actor: { userId: string },
    target: CanvasArtifactTarget,
    linkId: string,
    value: CanvasArtifactLinkDelete,
  ) {
    const input = CanvasArtifactLinkDeleteSchema.parse(value),
      hash = fingerprint({ type: "delete", linkId, input });
    return this.run(actor, target, true, async (ctx) => {
      const receipts = await this.receipts(ctx),
        prior = this.prior(receipts, actor.userId, input.operationId, hash);
      if (prior) return this.response(prior);
      const link = (await this.links(ctx)).find((row) => row.id === linkId);
      if (!link) missing();
      this.trackLink(ctx, link);
      if (link.revision !== input.expectedRevision)
        throw new CanvasBoardError("STALE_DRAFT", "This link changed. Refresh before deleting");
      await this.source(ctx, link.boardId, link.versionId, true);
      if (ctx.staged) ctx.staged.links = ctx.staged.links.filter((row) => row.id !== linkId);
      else await ctx.tx.sqlClient!.query("DELETE FROM canvas_artifact_links WHERE id=$1", [linkId]);
      const receipt: Receipt = {
        workspaceId: target.workspaceId,
        targetKind: target.kind,
        targetId: target.id,
        actorId: actor.userId,
        operationId: input.operationId,
        hash,
        requestedLinkId: linkId,
        linkId,
        deleted: true,
      };
      await this.saveReceipt(ctx, receipt);
      return this.response(receipt);
    });
  }
  async preview(actor: { userId: string }, target: CanvasArtifactTarget, linkId: string) {
    return this.run(actor, target, false, async (ctx) => {
      const link = (await this.links(ctx)).find((row) => row.id === linkId);
      if (!link) missing();
      this.trackLink(ctx, link);
      const source = await this.source(ctx, link.boardId, link.versionId);
      await this.target(ctx);
      return source.version;
    });
  }
  async authorizeMedia(
    actor: { userId: string },
    target: CanvasArtifactTarget,
    linkId: string,
    mediaId: string,
  ) {
    return this.run(actor, target, false, async (ctx) => {
      const link = (await this.links(ctx)).find((row) => row.id === linkId);
      if (!link) missing();
      this.trackLink(ctx, link);
      await this.source(ctx, link.boardId, link.versionId);
      const scope = await ctx.source.authorizeVersionMedia(
        actor,
        link.boardId,
        link.versionId,
        mediaId,
      );
      await this.target(ctx);
      return scope;
    });
  }
}
export function createCanvasArtifactLinkRepository(
  repository: Repository,
  options: { communityMode?: boolean } = {},
) {
  if (!(repository instanceof MemoryRepository || repository instanceof PostgresRepository))
    throw new Error("Canvas artifact links require a supported repository");
  return new CanvasArtifactLinkRepository(repository, options);
}
