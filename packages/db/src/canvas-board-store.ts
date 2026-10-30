import type { PoolClient } from "pg";
import {
  CanvasObjectSchema,
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
} from "./canvas-board-types.js";
import type {
  OrganizationRecord,
  OrganizationMemberRecord,
  OrganizationWorkspaceRecord,
  PlatformSubscription,
  UserLicenseAssignment,
} from "./platform-types.js";

export class MemoryCanvasBoards {
  readonly rows = new Map<string, CanvasState>();
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
        get: async (id) => (current(id) ? structuredClone(current(id)) : null),
        list: async () => [...this.rows.values()].map((state) => structuredClone(state.board)),
        put: async (state) => {
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
      };
      void actor;
      void scope;
      const result = await work(tx);
      for (const row of sources.values()) saveMemoryIdeaBoardCanvasSource(this.repository, row);
      for (const [id, state] of changed) {
        if (state) this.rows.set(id, state);
        else {
          this.rows.delete(id);
          for (let index = this.events.length - 1; index >= 0; index--)
            if (this.events[index]!.boardId === id && this.events[index]!.type !== "canvas.deleted")
              this.events.splice(index, 1);
        }
      }
      for (const { event, expiresAt } of events)
        this.events.push({ ...event, cursor: ++this.cursor, expiresAt });
      return result;
    });
  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    const now = Date.now();
    return {
      canvasBoards: [...this.rows.values()]
        .filter(
          ({ board }) =>
            ownedWorkspaceIds.has(board.workspaceId) && Date.parse(board.expiresAt) > now,
        )
        .map(({ board, objects }) => {
          const { creationKey, creationHash, ...metadata } = board;
          void creationKey;
          void creationHash;
          return { ...metadata, objects: objects.filter((object) => object.type !== "idea_ref") };
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
      if (ownedWorkspaceIds.has(state.board.workspaceId)) this.rows.delete(id);
      else {
        state.grants = state.grants.filter((grant) => grant.userId !== userId);
        state.invitations = state.invitations.filter(
          (invite) => invite.email !== this.repository.users.get(userId)?.email,
        );
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
        this.rows.delete(id);
        removed.push(id);
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
    for (const id of ids) this.rows.delete(id);
    for (let index = this.events.length - 1; index >= 0; index--)
      if (ids.has(this.events[index]!.boardId)) this.events.splice(index, 1);
  }
}

function boardRow(row: Record<string, unknown>): CanvasBoardStored {
  return {
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
        sourceMetadata: async (id, guestHash) => {
          const result = await client.query(
            "SELECT id,workspace_id,data->>'revision' AS revision,data->>'status' AS status,data->>'closesAt' AS closes_at,data->>'expiresAt' AS expires_at,EXISTS(SELECT 1 FROM jsonb_array_elements(data->'guests') guest WHERE guest->>'tokenHash'=$2) AS guest_present FROM idea_boards WHERE id=$1",
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
          const state = { board, objects, grants, invitations, receipts };
          originals.set(id, structuredClone(state));
          return state;
        },
        put: async (state, insert = false) => {
          const board = state.board;
          await selectBoard(board);
          if (insert)
            await client.query(
              "INSERT INTO canvas_boards(id,workspace_id,organization_id,owner_user_id,source_board_id,board_type,title,status,canvas_seq,creation_key,creation_hash,created_at,updated_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
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
              ],
            );
          else
            await client.query(
              "UPDATE canvas_boards SET title=$2,status=$3,canvas_seq=$4,updated_at=$5 WHERE id=$1",
              [board.id, board.title, board.status, board.canvasSeq, board.updatedAt],
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
