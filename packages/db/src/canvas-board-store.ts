import type { PoolClient } from "pg";
import {
  CanvasObjectSchema,
  CanvasCommentThreadSchema,
  CanvasTimerSchema,
  CanvasVersionMetadataSchema,
  type CanvasBoardEvent,
  type IdeaBoardStored,
} from "@openround/contracts";
import type { MemoryRepository, MemoryRepositoryLifecycleContext } from "./memory.js";
import type { PostgresRepository } from "./postgres.js";
import { getMemoryPlatformRepository } from "./platform-memory.js";
import { PostgresPlatformStore } from "./platform-postgres.js";
import { PlatformService } from "./platform-service.js";
import { memoryIdeaBoardCanvasSource, saveMemoryIdeaBoardCanvasSource } from "./idea-boards.js";
import type {
  CanvasAccessContext,
  CanvasBoardStored,
  CanvasRun,
  CanvasState,
  CanvasTransaction,
  CanvasMediaUpload,
} from "./canvas-board-types.js";
import { CanvasBoardError } from "./canvas-board-error.js";
import {
  canvasDefaultTimer,
  canvasFacilitation,
  sanitizeCanvasFacilitation,
} from "./canvas-facilitation.js";

export function canvasMediaIds(state: CanvasState) {
  return [
    ...new Set(
      [
        ...state.objects,
        ...state.receipts
          .filter((receipt) => receipt.undoable)
          .flatMap((receipt) => [...receipt.before, ...receipt.after]),
        ...(state.facilitation?.versions.flatMap((saved) => saved.objects) ?? []),
      ].flatMap((object) => (object.type === "image" ? [object.mediaId] : [])),
    ),
  ];
}
function normalizedCanvasState(state: CanvasState): CanvasState {
  return {
    ...state,
    board: {
      ...state.board,
      schemaVersion: state.board.schemaVersion ?? 1,
      uploadCount: state.board.uploadCount ?? 0,
      uploadBytes: state.board.uploadBytes ?? 0,
    },
    objects: state.objects.map((object) => CanvasObjectSchema.parse(object)),
    receipts: state.receipts.map((receipt) => ({
      ...receipt,
      before: receipt.before.map((object) => CanvasObjectSchema.parse(object)),
      after: receipt.after.map((object) => CanvasObjectSchema.parse(object)),
    })),
    facilitation: {
      threads: (state.facilitation?.threads ?? []).map((thread) =>
        CanvasCommentThreadSchema.parse(thread),
      ),
      timer: CanvasTimerSchema.parse(canvasFacilitation(state).timer),
      versions: (state.facilitation?.versions ?? []).map((saved) => ({
        metadata: CanvasVersionMetadataSchema.parse(saved.metadata),
        objects: saved.objects.map(({ idea: _idea, ...object }) => {
          void _idea;
          return CanvasObjectSchema.parse(object);
        }),
      })),
    },
  };
}
import type {
  OrganizationRecord,
  OrganizationMemberRecord,
  OrganizationWorkspaceRecord,
  PlatformSubscription,
  UserLicenseAssignment,
} from "./platform-types.js";

export class MemoryCanvasBoards {
  readonly rows = new Map<string, CanvasState>();
  readonly uploads = new Map<string, CanvasMediaUpload>();
  readonly events: Array<
    CanvasBoardEvent & {
      cursor: number;
      expiresAt: string;
      leaseToken?: string;
      leasedUntil?: number;
      delivered?: boolean;
    }
  > = [];
  private cursor = 0;
  constructor(readonly repository: MemoryRepository) {}
  run: CanvasRun = (actor, scope, work) =>
    getMemoryPlatformRepository(this.repository).withTransaction(async () => {
      const platform = getMemoryPlatformRepository(this.repository).memoryStore;
      const changed = new Map<string, CanvasState | null>();
      const sources = new Map<string, IdeaBoardStored>();
      const reserved = new Map<string, CanvasMediaUpload>();
      const references = new Map<string, string[]>();
      const events: Array<{ event: CanvasBoardEvent; expiresAt: string }> = [];
      const current = (id: string) =>
        changed.has(id) ? (changed.get(id) ?? null) : (this.rows.get(id) ?? null);
      const tx: CanvasTransaction = {
        metadata: async (id) => (current(id) ? structuredClone(current(id)!.board) : null),
        creation: async (workspaceId, operationId) => {
          const state = [...this.rows.values()].find(
            ({ board }) => board.workspaceId === workspaceId && board.creationKey === operationId,
          );
          return state ? structuredClone(state.board) : null;
        },
        countWorkspace: async (workspaceId, now) =>
          [...this.rows.values()].filter(
            ({ board }) =>
              board.workspaceId === workspaceId && Date.parse(board.expiresAt) > now.getTime(),
          ).length,
        timer: async (id) =>
          structuredClone(current(id)?.facilitation?.timer ?? canvasDefaultTimer()),
        grant: async (id, userId) =>
          structuredClone(current(id)?.grants.find((grant) => grant.userId === userId) ?? null),
        sourceMetadata: async (id, guestHash) => {
          const source = sources.get(id) ?? memoryIdeaBoardCanvasSource(this.repository, id);
          return source
            ? {
                id: source.id,
                workspaceId: source.workspaceId,
                revision: source.revision,
                status: source.status,
                closesAt: source.closesAt,
                expiresAt: source.expiresAt,
                guestPresent: Boolean(
                  guestHash && source.guests.some((guest) => guest.tokenHash === guestHash),
                ),
              }
            : null;
        },
        get: async (id) =>
          current(id) ? normalizedCanvasState(structuredClone(current(id)!)) : null,
        list: async () => [...this.rows.values()].map((state) => structuredClone(state.board)),
        put: async (state) => {
          if (state.board.uploadCount || canvasMediaIds(state).length) await tx.syncMedia(state);
          changed.set(state.board.id, structuredClone(state));
        },
        remove: async (id) => {
          changed.set(id, null);
        },
        access: async (workspaceId, userId) => {
          const workspace = platform.getSync<OrganizationWorkspaceRecord>("workspace", workspaceId);
          if (!workspace) return null;
          const user = this.repository.users.get(userId);
          return {
            workspace: {
              ...workspace,
              retentionDays: 30,
              membership:
                this.repository.workspaceMembers.get(`${workspaceId}:${userId}`)?.role ?? null,
            },
            user:
              user && !user.deletedAt
                ? { userId, email: user.email, verified: Boolean(user.emailVerifiedAt) }
                : null,
            organization: platform.getSync<OrganizationRecord>(
              "organization",
              workspace.organizationId,
            ),
            member: platform.getSync<OrganizationMemberRecord>(
              "member",
              `${workspace.organizationId}:${userId}`,
            ),
            subscription: platform.getSync<PlatformSubscription>(
              "subscription",
              workspace.organizationId,
            ),
            assignments: platform.listSync<UserLicenseAssignment>(
              "user_license",
              workspace.organizationId,
            ),
            commercialHold: Boolean(
              platform.getSync<{ held: boolean }>("commercial_hold", workspace.organizationId)
                ?.held,
            ),
            workspaceDeleting: Boolean(this.repository.workspaceMediaDeletionJobs.has(workspaceId)),
            workspaceLicensed: await getMemoryPlatformRepository(
              this.repository,
            ).workspaceHasLicense(workspaceId),
          };
        },
        findUser: async (email, organizationId) => {
          const user = [...this.repository.users.values()].find(
            (entry) =>
              entry.email.toLowerCase() === email.toLowerCase() &&
              entry.emailVerifiedAt &&
              !entry.deletedAt,
          );
          return user && platform.getSync("member", `${organizationId}:${user.userId}`)
            ? { userId: user.userId, email: user.email }
            : null;
        },
        source: async (id) =>
          structuredClone(sources.get(id) ?? memoryIdeaBoardCanvasSource(this.repository, id)),
        putSource: async (row) => {
          sources.set(row.id, structuredClone(row));
        },
        emit: async (event, expiresAt) => {
          events.push({ event, expiresAt });
        },
        invitation: async (id) => {
          for (const state of this.rows.values())
            if (state.invitations.some((invite) => invite.id === id))
              return { boardId: state.board.id };
          return null;
        },
        media: async (boardId, mediaId) => {
          const upload = reserved.get(mediaId) ?? this.uploads.get(mediaId);
          const asset = reserved.get(mediaId)?.asset ?? this.repository.mediaAssets.get(mediaId);
          return upload?.boardId === boardId &&
            asset &&
            (reserved.has(mediaId) ||
              this.repository.canvasBoardMediaOwners.get(mediaId)?.boardId === boardId)
            ? { ...structuredClone(upload), asset: structuredClone(asset) }
            : null;
        },
        reserveMedia: async (board, uploaderUserId, input) => {
          const asset = { ...input, deletionStartedAt: null, finalizedAt: null };
          reserved.set(asset.id, { boardId: board.id, uploaderUserId, asset });
          return asset;
        },
        syncMedia: async (state) => {
          const ids = canvasMediaIds(state);
          for (const object of state.objects) {
            if (object.type !== "image") continue;
            const upload = await tx.media(state.board.id, object.mediaId);
            if (
              !upload ||
              upload.asset.workspaceId !== state.board.workspaceId ||
              upload.asset.scanStatus !== "clean"
            )
              throw new CanvasBoardError(
                "NOT_FOUND",
                "Canvas images must be clean and owned by this board",
              );
          }
          for (const upload of [...this.uploads.values(), ...reserved.values()])
            if (
              upload.boardId === state.board.id &&
              upload.asset.createdAt.getTime() > Date.now() - 15 * 60_000 &&
              !ids.includes(upload.asset.id)
            )
              ids.push(upload.asset.id);
          references.set(state.board.id, ids);
        },
      };
      void actor;
      void scope;
      const result = await work(tx);
      // Memory media claims do not take the platform queue. Recheck synchronously
      // before publishing state/references so a deletion during an await cannot win.
      for (const state of changed.values()) {
        if (!state) continue;
        for (const object of state.objects) {
          if (object.type !== "image") continue;
          const asset = this.repository.mediaAssets.get(object.mediaId);
          if (
            !asset ||
            asset.scanStatus !== "clean" ||
            this.repository.canvasBoardMediaOwners.get(object.mediaId)?.boardId !== state.board.id
          )
            throw new CanvasBoardError("NOT_FOUND", "This canvas image is no longer available");
        }
      }
      for (const upload of reserved.values()) {
        this.uploads.set(upload.asset.id, structuredClone(upload));
        this.repository.mediaAssets.set(upload.asset.id, structuredClone(upload.asset));
        this.repository.canvasBoardMediaOwners.set(upload.asset.id, {
          workspaceId: upload.asset.workspaceId,
          boardId: upload.boardId,
        });
      }
      for (const row of sources.values()) saveMemoryIdeaBoardCanvasSource(this.repository, row);
      for (const [id, state] of changed) {
        if (state) this.rows.set(id, state);
        else {
          this.rows.delete(id);
          this.removeMedia(id);
          for (let index = this.events.length - 1; index >= 0; index--)
            if (this.events[index]!.boardId === id && this.events[index]!.type !== "canvas.deleted")
              this.events.splice(index, 1);
        }
      }
      for (const [boardId, ids] of references) {
        for (const [key, reference] of this.repository.mediaReferences)
          if (reference.ownerType === "canvas_board" && reference.ownerId === boardId)
            this.repository.mediaReferences.delete(key);
        const board = current(boardId)?.board;
        if (board)
          for (const mediaId of ids) {
            const upload = this.uploads.get(mediaId);
            if (upload?.boardId === boardId)
              this.repository.mediaReferences.set(
                `${board.workspaceId}:${mediaId}:canvas_board:${boardId}`,
                {
                  workspaceId: board.workspaceId,
                  mediaId,
                  ownerType: "canvas_board",
                  ownerId: boardId,
                  createdAt: new Date(),
                },
              );
          }
      }
      for (const { event, expiresAt } of events)
        this.events.push({ ...event, cursor: ++this.cursor, expiresAt });
      return result;
    });
  private removeMedia(boardId: string, now = new Date()) {
    for (const [key, reference] of this.repository.mediaReferences)
      if (reference.ownerType === "canvas_board" && reference.ownerId === boardId)
        this.repository.mediaReferences.delete(key);
    for (const [mediaId, upload] of this.uploads) {
      if (upload.boardId !== boardId) continue;
      const asset = this.repository.mediaAssets.get(mediaId);
      if (asset && this.repository.canvasBoardMediaOwners.get(mediaId)?.boardId === boardId) {
        asset.scanStatus = "deleting";
        asset.deletionStartedAt ??= new Date(now);
        this.repository.mediaFinalizationLeases.delete(mediaId);
        this.repository.mediaObjectCleanup.delete(mediaId);
      }
      this.uploads.delete(mediaId);
      this.repository.canvasBoardMediaOwners.delete(mediaId);
    }
  }
  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    const now = Date.now();
    return {
      canvasBoards: [...this.rows.values()]
        .filter(
          ({ board }) =>
            ownedWorkspaceIds.has(board.workspaceId) && Date.parse(board.expiresAt) > now,
        )
        .map(({ board, objects, facilitation }) => {
          const { creationKey, creationHash, ...metadata } = board;
          void creationKey;
          void creationHash;
          const ordinaryIds = new Set(
            objects.filter((object) => object.type !== "idea_ref").map((object) => object.id),
          );
          return {
            ...metadata,
            objects: objects.filter((object) => object.type !== "idea_ref"),
            ...(facilitation
              ? {
                  facilitation: {
                    timer: structuredClone(facilitation.timer),
                    threads: structuredClone(
                      facilitation.threads.filter((thread) => ordinaryIds.has(thread.objectId)),
                    ),
                    versions: facilitation.versions.map((saved) => ({
                      ...saved.metadata,
                      objects: saved.objects.filter((object) => object.type !== "idea_ref"),
                    })),
                  },
                }
              : {}),
          };
        }),
    };
  }
  deleteAccount({ userId, ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    const removedIds = new Set(
      [...this.rows.values()]
        .filter(({ board }) => ownedWorkspaceIds.has(board.workspaceId))
        .map(({ board }) => board.id),
    );
    for (const [id, state] of this.rows) {
      if (ownedWorkspaceIds.has(state.board.workspaceId)) {
        this.removeMedia(id);
        this.rows.delete(id);
      } else {
        state.grants = state.grants.filter((grant) => grant.userId !== userId);
        state.invitations = state.invitations.filter(
          (invite) => invite.email !== this.repository.users.get(userId)?.email,
        );
        if (state.facilitation) {
          for (const thread of state.facilitation.threads)
            thread.messages = thread.messages.filter((message) => message.authorId !== userId);
          state.facilitation.threads = state.facilitation.threads.filter(
            (thread) => thread.messages.length,
          );
          for (const saved of state.facilitation.versions)
            if (saved.metadata.createdBy === userId) saved.metadata.createdBy = null;
        }
      }
    }
    for (let i = this.events.length - 1; i >= 0; i--)
      if (removedIds.has(this.events[i]!.boardId)) this.events.splice(i, 1);
  }
  purgeExpired(now: Date) {
    const removed: string[] = [];
    for (const [id, state] of this.rows)
      if (
        Date.parse(state.board.expiresAt) <= now.getTime() ||
        (state.board.sourceBoardId &&
          !memoryIdeaBoardCanvasSource(this.repository, state.board.sourceBoardId))
      ) {
        this.removeMedia(id, now);
        this.rows.delete(id);
        removed.push(id);
      } else {
        const retained = new Set(canvasMediaIds(state));
        for (const [key, reference] of this.repository.mediaReferences)
          if (
            reference.ownerType === "canvas_board" &&
            reference.ownerId === id &&
            !retained.has(reference.mediaId) &&
            (this.repository.mediaAssets.get(reference.mediaId)?.createdAt.getTime() ?? 0) <=
              now.getTime() - 15 * 60_000
          )
            this.repository.mediaReferences.delete(key);
      }
    for (let i = this.events.length - 1; i >= 0; i--)
      if (Date.parse(this.events[i]!.expiresAt) <= now.getTime()) this.events.splice(i, 1);
    return removed;
  }
  deleteIdeaBoardMetadata(sourceBoardId: string) {
    const ids = new Set(
      [...this.rows.values()]
        .filter(({ board }) => board.sourceBoardId === sourceBoardId)
        .map(({ board }) => board.id),
    );
    for (const id of ids) {
      this.removeMedia(id);
      this.rows.delete(id);
    }
    for (let index = this.events.length - 1; index >= 0; index--)
      if (ids.has(this.events[index]!.boardId)) this.events.splice(index, 1);
  }
  updateIdeaBoardMetadata(sourceBoardId: string) {
    const source = memoryIdeaBoardCanvasSource(this.repository, sourceBoardId);
    for (const state of this.rows.values())
      if (state.board.sourceBoardId === sourceBoardId) sanitizeCanvasFacilitation(state, source);
  }
}

function boardRow(row: Record<string, unknown>): CanvasBoardStored {
  return {
    schemaVersion: Number(row.schema_version ?? 1) as 1 | 2,
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    organizationId: String(row.organization_id),
    ownerUserId: String(row.owner_user_id),
    title: String(row.title),
    boardType: row.board_type as "team" | "workshop",
    sourceBoardId: row.source_board_id ? String(row.source_board_id) : null,
    status: row.status as "active" | "archived",
    canvasSeq: Number(row.canvas_seq),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    expiresAt: new Date(row.expires_at as string).toISOString(),
    creationKey: String(row.creation_key),
    creationHash: String(row.creation_hash),
    uploadCount: Number(row.upload_count ?? 0),
    uploadBytes: Number(row.upload_bytes ?? 0),
  };
}
const context = async (client: PoolClient, key: string, value: string) => {
  await client.query("SELECT set_config($1,$2,true)", [key, value]);
};
export function postgresCanvasRun(repository: PostgresRepository): CanvasRun {
  return async (actor, scope, work) => {
    const client = await repository.pool.connect();
    const originals = new Map<string, CanvasState>();
    const selectedBoards = new Map<string, CanvasBoardStored>();
    const selectedOrganizations = new Set<string>();
    const selectBoard = async (board: CanvasBoardStored) => {
      selectedBoards.set(board.id, board);
      if (!selectedOrganizations.has(board.organizationId)) {
        await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1,73501))", [
          `org:${board.organizationId}`,
        ]);
        selectedOrganizations.add(board.organizationId);
      }
      await context(client, "app.organization_id", board.organizationId);
      await context(client, "app.workspace_id", board.workspaceId);
      await context(client, "app.canvas_board_id", board.id);
    };
    try {
      await client.query("BEGIN");
      // Platform identity/seat changes take the corresponding exclusive lock. Independent canvas writers share it.
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('identity',73501))");
      if (scope.workspaceId)
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,73501))", [
          `canvas-create:${scope.workspaceId}`,
        ]);
      if (actor) await context(client, "app.canvas_user_id", actor.userId);
      if (scope.sourceBoardId) await context(client, "app.canvas_source_id", scope.sourceBoardId);
      if (scope.guestHash) await context(client, "app.canvas_guest_hash", scope.guestHash);
      const initial = scope.boardId
        ? await client.query("SELECT * FROM canvas_boards WHERE id=$1", [scope.boardId])
        : scope.sourceBoardId
          ? await client.query("SELECT * FROM canvas_boards WHERE source_board_id=$1", [
              scope.sourceBoardId,
            ])
          : null;
      if (initial?.rows[0]) await selectBoard(boardRow(initial.rows[0]));
      else if (scope.workspaceId) {
        await context(client, "app.workspace_id", scope.workspaceId);
        if (scope.boardId) await context(client, "app.canvas_board_id", scope.boardId);
      }
      const platform = new PostgresPlatformStore(null, client);
      const tx: CanvasTransaction = {
        timer: async (id, lock = false) => {
          if (lock) {
            const board = selectedBoards.get(id);
            if (!board)
              throw new CanvasBoardError("NOT_FOUND", "Canvas board is no longer available");
            await client.query("SELECT id FROM workspaces WHERE id=$1 FOR SHARE", [
              board.workspaceId,
            ]);
            const current = await client.query(
              "SELECT id FROM canvas_boards WHERE id=$1 FOR SHARE",
              [id],
            );
            if (!current.rows[0])
              throw new CanvasBoardError("NOT_FOUND", "Canvas board is no longer available");
          }
          const result = await client.query(
            "SELECT data FROM canvas_board_timers WHERE board_id=$1",
            [id],
          );
          return result.rows[0]?.data ?? canvasDefaultTimer();
        },
        metadata: async (id) => {
          const result = await client.query("SELECT * FROM canvas_boards WHERE id=$1", [id]);
          return result.rows[0] ? boardRow(result.rows[0]) : null;
        },
        creation: async (workspaceId, operationId) => {
          const result = await client.query(
            "SELECT * FROM canvas_boards WHERE workspace_id=$1 AND creation_key=$2",
            [workspaceId, operationId],
          );
          return result.rows[0] ? boardRow(result.rows[0]) : null;
        },
        countWorkspace: async (workspaceId, now) => {
          await context(client, "app.canvas_quota", "on");
          try {
            const result = await client.query(
              "SELECT count(*)::integer AS count FROM canvas_boards WHERE workspace_id=$1 AND expires_at>$2",
              [workspaceId, now],
            );
            return Number(result.rows[0].count);
          } finally {
            await context(client, "app.canvas_quota", "");
          }
        },
        grant: async (id, userId) => {
          const result = await client.query(
            "SELECT user_id,role,created_at,label FROM canvas_board_grants WHERE board_id=$1 AND user_id=$2",
            [id, userId],
          );
          const row = result.rows[0];
          return row
            ? {
                userId: row.user_id,
                role: row.role,
                createdAt: new Date(row.created_at).toISOString(),
                ...(row.label ? { label: row.label } : {}),
              }
            : null;
        },
        sourceMetadata: async (id, guestHash, lock = false) => {
          const result = await client.query(
            `SELECT id,workspace_id,data->>'revision' AS revision,data->>'status' AS status,data->>'closesAt' AS closes_at,data->>'expiresAt' AS expires_at,EXISTS(SELECT 1 FROM jsonb_array_elements(data->'guests') guest WHERE guest->>'tokenHash'=$2) AS guest_present FROM idea_boards WHERE id=$1${lock ? " FOR SHARE" : ""}`,
            [id, guestHash ?? null],
          );
          const row = result.rows[0];
          return row
            ? {
                id: row.id,
                workspaceId: row.workspace_id,
                revision: Number(row.revision),
                status: row.status,
                closesAt: row.closes_at,
                expiresAt: row.expires_at,
                guestPresent: Boolean(row.guest_present),
              }
            : null;
        },
        list: async () =>
          (
            await client.query("SELECT * FROM canvas_boards ORDER BY updated_at DESC,id LIMIT 1000")
          ).rows.map(boardRow),
        get: async (id, lock = false) => {
          let candidate = selectedBoards.get(id);
          if (!candidate) {
            const metadata = await client.query("SELECT * FROM canvas_boards WHERE id=$1", [id]);
            if (!metadata.rows[0]) return null;
            candidate = boardRow(metadata.rows[0]);
            await selectBoard(candidate);
          }
          // Workspace -> canvas -> source is the same lock order as legacy source deletion.
          await client.query("SELECT id FROM workspaces WHERE id=$1 FOR SHARE", [
            candidate.workspaceId,
          ]);
          const result = await client.query(
            `SELECT * FROM canvas_boards WHERE id=$1${lock ? " FOR UPDATE" : " FOR SHARE"}`,
            [id],
          );
          if (!result.rows[0]) return null;
          const board = boardRow(result.rows[0]);
          await selectBoard(board);
          const objects = (
            await client.query(
              "SELECT data FROM canvas_board_objects WHERE board_id=$1 ORDER BY id",
              [id],
            )
          ).rows.map((entry) => CanvasObjectSchema.parse(entry.data));
          const grants = (
            await client.query(
              "SELECT user_id,role,created_at,label FROM canvas_board_grants WHERE board_id=$1 ORDER BY user_id",
              [id],
            )
          ).rows.map((entry) => ({
            userId: entry.user_id,
            role: entry.role,
            createdAt: new Date(entry.created_at).toISOString(),
            ...(entry.label ? { label: entry.label } : {}),
          }));
          const invitations = (
            await client.query(
              "SELECT data FROM canvas_board_invitations WHERE board_id=$1 ORDER BY id",
              [id],
            )
          ).rows.map((entry) => entry.data);
          const receipts = (
            await client.query(
              "SELECT data FROM canvas_board_receipts WHERE board_id=$1 ORDER BY (data->>'canvasSeq')::bigint,operation_id",
              [id],
            )
          ).rows.map((entry) => entry.data);
          const threadRows = await client.query(
            "SELECT data FROM canvas_board_comment_threads WHERE board_id=$1 ORDER BY created_at,id",
            [id],
          );
          const messageRows = await client.query(
            "SELECT thread_id,author_id,data FROM canvas_board_comment_messages WHERE board_id=$1 ORDER BY created_at,id",
            [id],
          );
          const timer = await tx.timer(id);
          const versions = (
            await client.query(
              "SELECT created_by,data,objects FROM canvas_board_versions WHERE board_id=$1 ORDER BY created_at DESC,id",
              [id],
            )
          ).rows.map((entry) => ({
            metadata: { ...entry.data, createdBy: entry.created_by },
            objects: entry.objects,
          }));
          const threads = threadRows.rows.map((entry) => ({
            ...entry.data,
            messages: messageRows.rows
              .filter((message) => message.thread_id === entry.data.id)
              .map((message) => ({ ...message.data, authorId: message.author_id })),
          }));
          const state = normalizedCanvasState({
            board,
            objects,
            grants,
            invitations,
            receipts,
            facilitation: { threads, timer, versions },
          });
          originals.set(id, structuredClone(state));
          return state;
        },
        put: async (state, insert = false) => {
          const board = state.board;
          await selectBoard(board);
          if (insert)
            await client.query(
              "INSERT INTO canvas_boards(id,workspace_id,organization_id,owner_user_id,source_board_id,board_type,title,status,canvas_seq,creation_key,creation_hash,created_at,updated_at,expires_at,schema_version,upload_count,upload_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
              [
                board.id,
                board.workspaceId,
                board.organizationId,
                board.ownerUserId,
                board.sourceBoardId,
                board.boardType,
                board.title,
                board.status,
                board.canvasSeq,
                board.creationKey,
                board.creationHash,
                board.createdAt,
                board.updatedAt,
                board.expiresAt,
                board.schemaVersion,
                board.uploadCount,
                board.uploadBytes,
              ],
            );
          else
            await client.query(
              "UPDATE canvas_boards SET title=$2,status=$3,canvas_seq=$4,updated_at=$5,schema_version=$6,upload_count=$7,upload_bytes=$8 WHERE id=$1",
              [
                board.id,
                board.title,
                board.status,
                board.canvasSeq,
                board.updatedAt,
                board.schemaVersion,
                board.uploadCount,
                board.uploadBytes,
              ],
            );
          const previous = originals.get(board.id);
          const nextIds = state.objects.map((object) => object.id);
          await client.query(
            "DELETE FROM canvas_board_objects WHERE board_id=$1 AND NOT(id=ANY($2::uuid[]))",
            [board.id, nextIds],
          );
          for (const object of state.objects)
            if (
              JSON.stringify(previous?.objects.find((entry) => entry.id === object.id)) !==
              JSON.stringify(object)
            )
              await client.query(
                "INSERT INTO canvas_board_objects(board_id,workspace_id,id,version,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(board_id,id) DO UPDATE SET version=EXCLUDED.version,data=EXCLUDED.data",
                [board.id, board.workspaceId, object.id, object.version, object],
              );
          if (JSON.stringify(previous?.grants) !== JSON.stringify(state.grants)) {
            await client.query("DELETE FROM canvas_board_grants WHERE board_id=$1", [board.id]);
            for (const grant of state.grants)
              await client.query(
                "INSERT INTO canvas_board_grants(board_id,workspace_id,user_id,role,created_at,label) VALUES($1,$2,$3,$4,$5,$6)",
                [
                  board.id,
                  board.workspaceId,
                  grant.userId,
                  grant.role,
                  grant.createdAt,
                  grant.label ?? null,
                ],
              );
          }
          for (const receipt of state.receipts)
            if (
              JSON.stringify(
                previous?.receipts.find(
                  (entry) =>
                    entry.operationId === receipt.operationId && entry.actorId === receipt.actorId,
                ),
              ) !== JSON.stringify(receipt)
            )
              await client.query(
                "INSERT INTO canvas_board_receipts(board_id,workspace_id,actor_id,operation_id,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(board_id,actor_id,operation_id) DO UPDATE SET data=EXCLUDED.data",
                [board.id, board.workspaceId, receipt.actorId, receipt.operationId, receipt],
              );
          for (const invitation of state.invitations)
            if (
              JSON.stringify(previous?.invitations.find((entry) => entry.id === invitation.id)) !==
              JSON.stringify(invitation)
            ) {
              const user = await tx.findUser(invitation.email, board.organizationId);
              if (!user) throw new Error("Canvas invitee is no longer available");
              await client.query(
                "INSERT INTO canvas_board_invitations(id,board_id,workspace_id,user_id,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data",
                [invitation.id, board.id, board.workspaceId, user.userId, invitation],
              );
            }
          const facilitation = canvasFacilitation(state);
          await client.query(
            "DELETE FROM canvas_board_comment_threads WHERE board_id=$1 AND NOT(id=ANY($2::uuid[]))",
            [board.id, facilitation.threads.map((thread) => thread.id)],
          );
          for (const thread of facilitation.threads) {
            const old = previous?.facilitation?.threads.find((entry) => entry.id === thread.id);
            if (JSON.stringify(old) === JSON.stringify(thread)) continue;
            const { messages, ...data } = thread;
            if (
              JSON.stringify(old ? { ...old, messages: undefined } : undefined) !==
              JSON.stringify({ ...thread, messages: undefined })
            )
              await client.query(
                "INSERT INTO canvas_board_comment_threads(board_id,workspace_id,id,object_id,created_at,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(board_id,id) DO UPDATE SET data=EXCLUDED.data",
                [board.id, board.workspaceId, thread.id, thread.objectId, thread.createdAt, data],
              );
            await client.query(
              "DELETE FROM canvas_board_comment_messages WHERE board_id=$1 AND thread_id=$2 AND NOT(id=ANY($3::uuid[]))",
              [board.id, thread.id, messages.map((message) => message.id)],
            );
            for (const message of messages)
              if (
                JSON.stringify(old?.messages.find((entry) => entry.id === message.id)) !==
                JSON.stringify(message)
              ) {
                const { authorId, ...messageData } = message;
                await client.query(
                  "INSERT INTO canvas_board_comment_messages(board_id,workspace_id,id,thread_id,author_id,created_at,data) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(board_id,id) DO UPDATE SET data=EXCLUDED.data",
                  [
                    board.id,
                    board.workspaceId,
                    message.id,
                    thread.id,
                    authorId,
                    message.createdAt,
                    messageData,
                  ],
                );
              }
          }
          if (JSON.stringify(previous?.facilitation?.timer) !== JSON.stringify(facilitation.timer))
            await client.query(
              "INSERT INTO canvas_board_timers(board_id,workspace_id,data) VALUES($1,$2,$3) ON CONFLICT(board_id) DO UPDATE SET data=EXCLUDED.data",
              [board.id, board.workspaceId, facilitation.timer],
            );
          await client.query(
            "DELETE FROM canvas_board_versions WHERE board_id=$1 AND NOT(id=ANY($2::uuid[]))",
            [board.id, facilitation.versions.map((saved) => saved.metadata.id)],
          );
          for (const saved of facilitation.versions)
            if (
              JSON.stringify(
                previous?.facilitation?.versions.find(
                  (entry) => entry.metadata.id === saved.metadata.id,
                ),
              ) !== JSON.stringify(saved)
            ) {
              const { createdBy, ...data } = saved.metadata;
              await client.query(
                "INSERT INTO canvas_board_versions(board_id,workspace_id,id,created_by,created_at,data,objects) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(board_id,id) DO UPDATE SET data=EXCLUDED.data,objects=EXCLUDED.objects,created_by=EXCLUDED.created_by",
                [
                  board.id,
                  board.workspaceId,
                  saved.metadata.id,
                  createdBy,
                  saved.metadata.createdAt,
                  data,
                  JSON.stringify(saved.objects),
                ],
              );
            }
          if (state.board.uploadCount || canvasMediaIds(state).length) await tx.syncMedia(state);
          originals.set(board.id, structuredClone(state));
        },
        remove: async (id) => {
          await client.query("DELETE FROM canvas_boards WHERE id=$1", [id]);
        },
        access: async (workspaceId, userId) => {
          await context(client, "app.workspace_id", workspaceId);
          const workspaceResult = await client.query("SELECT * FROM workspaces WHERE id=$1", [
            workspaceId,
          ]);
          let workspace = workspaceResult.rows[0];
          if (!workspace) return null;
          const organizationId = String(workspace.organization_id);
          if (!selectedOrganizations.has(organizationId)) {
            await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1,73501))", [
              `org:${organizationId}`,
            ]);
            selectedOrganizations.add(organizationId);
          }
          await context(client, "app.organization_id", organizationId);
          const freshWorkspace = await client.query(
            "SELECT * FROM workspaces WHERE id=$1 FOR SHARE",
            [workspaceId],
          );
          if (!freshWorkspace.rows[0]) return null;
          workspace = freshWorkspace.rows[0];
          const userResult = await client.query(
            "SELECT id,email,email_verified_at FROM users WHERE id=$1 AND deleted_at IS NULL",
            [userId],
          );
          const memberResult = await client.query(
            "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
            [workspaceId, userId],
          );
          const deleting = await client.query(
            "SELECT 1 FROM workspace_media_deletion_jobs WHERE workspace_id=$1",
            [workspaceId],
          );
          return {
            workspace: {
              id: workspaceId,
              name: workspace.name,
              organizationId,
              ownerId: workspace.owner_id,
              status: workspace.platform_status,
              retentionDays: Number(workspace.retention_days),
              membership: memberResult.rows[0]?.role ?? null,
            },
            user: userResult.rows[0]
              ? {
                  userId,
                  email: userResult.rows[0].email,
                  verified: Boolean(userResult.rows[0].email_verified_at),
                }
              : null,
            organization: await platform.get<OrganizationRecord>("organization", organizationId),
            member: await platform.get<OrganizationMemberRecord>(
              "member",
              `${organizationId}:${userId}`,
            ),
            subscription: await platform.get<PlatformSubscription>("subscription", organizationId),
            assignments: await platform.list<UserLicenseAssignment>("user_license", organizationId),
            commercialHold: Boolean(
              (await platform.get<{ held: boolean }>("commercial_hold", organizationId))?.held,
            ),
            workspaceDeleting: Boolean(deleting.rowCount),
            workspaceLicensed: await new PlatformService(platform).workspaceHasLicense(workspaceId),
          } satisfies CanvasAccessContext;
        },
        findUser: async (email, organizationId) => {
          await context(client, "app.organization_id", organizationId);
          const result = await client.query(
            "SELECT user_row.id,user_row.email FROM users user_row JOIN organization_members member ON member.user_id=user_row.id AND member.organization_id=$2 WHERE lower(user_row.email)=lower($1) AND user_row.deleted_at IS NULL AND user_row.email_verified_at IS NOT NULL",
            [email, organizationId],
          );
          return result.rows[0] ? { userId: result.rows[0].id, email: result.rows[0].email } : null;
        },
        source: async (id, lock = false) => {
          const result = await client.query(
            `SELECT data FROM idea_boards WHERE id=$1${lock ? " FOR UPDATE" : " FOR SHARE"}`,
            [id],
          );
          return result.rows[0]?.data ?? null;
        },
        putSource: async (row) => {
          await client.query("UPDATE idea_boards SET data=$2 WHERE id=$1", [row.id, row]);
        },
        emit: async (event, expiresAt) => {
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('canvas-outbox',73501))",
          );
          await client.query(
            "INSERT INTO canvas_board_outbox(event_id,board_id,workspace_id,data,expires_at) VALUES($1,$2,current_setting('app.workspace_id')::uuid,$3,$4)",
            [event.eventId, event.boardId, event, expiresAt],
          );
        },
        invitation: async (id) => {
          const result = await client.query(
            "SELECT board_id FROM canvas_board_invitations WHERE id=$1",
            [id],
          );
          return result.rows[0] ? { boardId: result.rows[0].board_id } : null;
        },
        media: async (boardId, mediaId) => {
          const result = await client.query(
            "SELECT asset.*,upload.uploader_user_id FROM canvas_board_uploads upload JOIN media_assets asset ON asset.workspace_id=upload.workspace_id AND asset.id=upload.media_id WHERE upload.board_id=$1 AND upload.media_id=$2 FOR SHARE OF asset,upload",
            [boardId, mediaId],
          );
          const value = result.rows[0];
          return value
            ? {
                boardId,
                uploaderUserId: value.uploader_user_id,
                asset: {
                  id: value.id,
                  workspaceId: value.workspace_id,
                  objectKey: value.object_key,
                  mimeType: value.mime_type,
                  sizeBytes: Number(value.size_bytes),
                  scanStatus: value.scan_status,
                  altText: value.alt_text,
                  createdAt: new Date(value.created_at),
                  deletionStartedAt: value.deletion_started_at
                    ? new Date(value.deletion_started_at)
                    : null,
                  finalizedAt: value.finalized_at ? new Date(value.finalized_at) : null,
                },
              }
            : null;
        },
        reserveMedia: async (board, userId, input) => {
          await client.query(
            "INSERT INTO media_assets(id,workspace_id,object_key,mime_type,size_bytes,scan_status,alt_text,created_at,canvas_board_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              input.id,
              board.workspaceId,
              input.objectKey,
              input.mimeType,
              input.sizeBytes,
              input.scanStatus,
              input.altText,
              input.createdAt,
              board.id,
            ],
          );
          await client.query(
            "INSERT INTO canvas_board_uploads(workspace_id,board_id,media_id,uploader_user_id) VALUES($1,$2,$3,$4)",
            [board.workspaceId, board.id, input.id, userId],
          );
          return { ...input, deletionStartedAt: null, finalizedAt: null };
        },
        syncMedia: async (state) => {
          const ids = canvasMediaIds(state);
          const locked = await client.query(
            "SELECT asset.id,asset.scan_status FROM media_assets asset JOIN canvas_board_uploads upload ON upload.workspace_id=asset.workspace_id AND upload.media_id=asset.id WHERE upload.board_id=$1 AND (asset.id=ANY($2::uuid[]) OR asset.created_at>clock_timestamp()-interval '15 minutes') ORDER BY asset.id FOR UPDATE OF asset",
            [state.board.id, ids],
          );
          for (const object of state.objects)
            if (
              object.type === "image" &&
              !locked.rows.some((row) => row.id === object.mediaId && row.scan_status === "clean")
            )
              throw new CanvasBoardError(
                "NOT_FOUND",
                "Canvas images must be clean and owned by this board",
              );
          await client.query(
            "DELETE FROM media_references WHERE workspace_id=$1 AND owner_type='canvas_board' AND owner_id=$2",
            [state.board.workspaceId, state.board.id],
          );
          await client.query(
            "INSERT INTO media_references(workspace_id,media_id,owner_type,owner_id) SELECT asset.workspace_id,asset.id,'canvas_board',$1 FROM media_assets asset JOIN canvas_board_uploads upload ON upload.workspace_id=asset.workspace_id AND upload.media_id=asset.id WHERE upload.board_id=$1 AND asset.scan_status<>'deleting' AND (asset.id=ANY($2::uuid[]) OR asset.created_at>clock_timestamp()-interval '15 minutes') ON CONFLICT DO NOTHING",
            [state.board.id, ids],
          );
        },
      };
      const result = await work(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
}

export async function postgresCanvasEvents(
  repository: PostgresRepository,
  after: number,
  limit: number,
) {
  const client = await repository.pool.connect();
  try {
    await client.query("BEGIN");
    await context(client, "app.canvas_relay", "on");
    const result = await client.query(
      "SELECT cursor,data FROM canvas_board_outbox WHERE cursor>$1 AND expires_at>clock_timestamp() ORDER BY cursor LIMIT $2",
      [after, Math.min(500, limit)],
    );
    await client.query("COMMIT");
    return result.rows.map((row) => ({ ...row.data, cursor: Number(row.cursor) }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
