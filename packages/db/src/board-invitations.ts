import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  BoardInvitationBatchResponseSchema,
  type BoardInvitationBatchResponse,
  type BoardInvitationDeliveryResult,
} from "@openround/contracts";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { getMemoryPlatformRepository } from "./platform-memory.js";
import type { Repository } from "./types.js";

export interface BoardInvitationScope {
  workspaceId: string;
  actorId: string;
  resourceKind: "canvas" | "idea_board";
  resourceId: string;
}
interface Recipient extends Omit<BoardInvitationDeliveryResult, "status"> {
  status: BoardInvitationDeliveryResult["status"] | "claimed";
  claimToken?: string;
  claimExpiresAt?: string;
}
export interface BoardInvitationBatchRecord extends BoardInvitationScope {
  batchId: string;
  operationId: string;
  fingerprint: string;
  createdAt: string;
  expiresAt: string;
  recipients: Recipient[];
}
export class BoardInvitationError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "IDEMPOTENCY_CONFLICT" | "BATCH_EXPIRED" | "LIMIT_REACHED",
  ) {
    super("Invitation delivery is unavailable for this request");
  }
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sameScope = (a: BoardInvitationScope, b: BoardInvitationScope) =>
  a.workspaceId === b.workspaceId &&
  a.actorId === b.actorId &&
  a.resourceKind === b.resourceKind &&
  a.resourceId === b.resourceId;
function uuid(value: unknown) {
  const bytes = Buffer.from(digest(value).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function boardInvitationRecipientId(batchId: string, email: string) {
  return uuid(["board-invitation-recipient", batchId, email.trim().toLowerCase()]);
}
function batchId(scope: BoardInvitationScope, operationId: string) {
  return uuid([
    "board-invitation-batch",
    scope.workspaceId,
    scope.actorId,
    scope.resourceKind,
    scope.resourceId,
    operationId,
  ]);
}
function expireClaims(row: BoardInvitationBatchRecord, now: Date) {
  for (const recipient of row.recipients) {
    const expires = Date.parse(recipient.claimExpiresAt ?? "");
    if (recipient.status === "claimed" && (!Number.isFinite(expires) || expires <= now.getTime())) {
      recipient.status = "unknown";
      recipient.errorCode = "DELIVERY_UNKNOWN";
      delete recipient.claimToken;
      delete recipient.claimExpiresAt;
    }
  }
}
interface Transaction {
  get(id: string): Promise<BoardInvitationBatchRecord | null>;
  put(row: BoardInvitationBatchRecord, insert?: boolean): Promise<void>;
  count(): Promise<number>;
}
type Run = <T>(scope: BoardInvitationScope, work: (tx: Transaction) => Promise<T>) => Promise<T>;

/** Claims are deliberately never recycled: an expired or ambiguous send becomes terminal unknown. */
export class BoardInvitationRepository {
  constructor(
    private readonly run: Run,
    readonly purgeExpired: (now: Date) => Promise<string[]>,
  ) {}
  async prepare(
    scope: BoardInvitationScope,
    input: { operationId: string; emails: string[]; role?: string; expiresAt: string },
    now = new Date(),
  ) {
    const normalized = [...new Set(input.emails.map((email) => email.trim().toLowerCase()))].sort();
    if (normalized.length < 1 || normalized.length > 20)
      throw new BoardInvitationError("LIMIT_REACHED");
    const id = batchId(scope, input.operationId);
    const fingerprint = digest({ emails: normalized, role: input.role ?? null });
    return this.run(scope, async (tx) => {
      const existing = await tx.get(id);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new BoardInvitationError("IDEMPOTENCY_CONFLICT");
        if (Date.parse(existing.expiresAt) <= now.getTime())
          throw new BoardInvitationError("BATCH_EXPIRED");
        expireClaims(existing, now);
        await tx.put(existing);
        return existing;
      }
      if (Date.parse(input.expiresAt) <= now.getTime())
        throw new BoardInvitationError("BATCH_EXPIRED");
      if ((await tx.count()) >= 1_000) throw new BoardInvitationError("LIMIT_REACHED");
      const row: BoardInvitationBatchRecord = {
        ...scope,
        batchId: id,
        operationId: input.operationId,
        fingerprint,
        createdAt: now.toISOString(),
        expiresAt: input.expiresAt,
        recipients: normalized.map((email) => ({ email, status: "pending" })),
      };
      await tx.put(row, true);
      return row;
    });
  }
  private update<T>(
    scope: BoardInvitationScope,
    id: string,
    now: Date,
    work: (row: BoardInvitationBatchRecord) => T,
  ) {
    return this.run(scope, async (tx) => {
      const row = await tx.get(id);
      if (!row || !sameScope(scope, row)) throw new BoardInvitationError("NOT_FOUND");
      if (Date.parse(row.expiresAt) <= now.getTime())
        throw new BoardInvitationError("BATCH_EXPIRED");
      expireClaims(row, now);
      const result = work(row);
      await tx.put(row);
      return result;
    });
  }
  claim(
    scope: BoardInvitationScope,
    id: string,
    email: string,
    now = new Date(),
    leaseMs = 10_000,
  ) {
    return this.update(scope, id, now, (row) => {
      const recipient = row.recipients.find((entry) => entry.email === email);
      if (recipient?.status !== "pending") return null;
      recipient.status = "claimed";
      recipient.claimToken = randomUUID();
      recipient.claimExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
      return { claimToken: recipient.claimToken, email: recipient.email };
    });
  }
  /** Only for the caller that has not begun SMTP; never defer an ambiguous delivery. */
  defer(scope: BoardInvitationScope, id: string, email: string, token: string, now = new Date()) {
    return this.update(scope, id, now, (row) => {
      const recipient = row.recipients.find((entry) => entry.email === email);
      if (recipient?.status !== "claimed" || recipient.claimToken !== token) return false;
      recipient.status = "pending";
      delete recipient.claimToken;
      delete recipient.claimExpiresAt;
      return true;
    });
  }
  finish(
    scope: BoardInvitationScope,
    id: string,
    email: string,
    token: string,
    outcome: Omit<BoardInvitationDeliveryResult, "email" | "status"> & {
      status: Exclude<BoardInvitationDeliveryResult["status"], "pending">;
    },
    now = new Date(),
  ) {
    return this.update(scope, id, now, (row) => {
      const recipient = row.recipients.find((entry) => entry.email === email);
      if (recipient?.status !== "claimed" || recipient.claimToken !== token) return false;
      Object.assign(recipient, outcome);
      delete recipient.claimToken;
      delete recipient.claimExpiresAt;
      return true;
    });
  }
  response(scope: BoardInvitationScope, id: string, now = new Date()) {
    return this.update(scope, id, now, (row): BoardInvitationBatchResponse => {
      const results = row.recipients.map(({ email, status, invitationId, errorCode }) => ({
        email,
        status: status === "claimed" ? ("pending" as const) : status,
        ...(invitationId ? { invitationId } : {}),
        ...(errorCode ? { errorCode } : {}),
      }));
      return BoardInvitationBatchResponseSchema.parse({
        batchId: row.batchId,
        results,
        complete: results.every((recipient) => recipient.status !== "pending"),
      });
    });
  }
}

class MemoryBoardInvitationStore implements MemoryRepositoryLifecycleExtension {
  private readonly rows = new Map<string, BoardInvitationBatchRecord>();
  private readonly deletedResources = new Set<string>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly repository: MemoryRepository) {}
  run: Run = (scope, work) => {
    const active = this.tail.then(() =>
      getMemoryPlatformRepository(this.repository).withTransaction(async () => {
        const tx: Transaction = {
          get: async (id) => {
            const row = this.rows.get(id);
            return row && sameScope(scope, row) ? structuredClone(row) : null;
          },
          put: async (row, insert = false) => {
            if (
              !sameScope(scope, row) ||
              (!insert && !this.rows.has(row.batchId)) ||
              this.deletedResources.has(`${row.resourceKind}:${row.resourceId}`) ||
              !this.repository.workspaces.has(scope.workspaceId) ||
              !this.repository.users.has(scope.actorId) ||
              this.repository.users.get(scope.actorId)?.deletedAt
            )
              throw new BoardInvitationError("NOT_FOUND");
            this.rows.set(row.batchId, structuredClone(row));
          },
          count: async () => [...this.rows.values()].filter((row) => sameScope(scope, row)).length,
        };
        return work(tx);
      }),
    );
    this.tail = active.catch(() => undefined);
    return active;
  };
  exportAccount({ userId, ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    return {
      boardInvitationDeliveries: [...this.rows.values()]
        .filter(
          (row) =>
            Date.parse(row.expiresAt) > Date.now() &&
            (row.actorId === userId || ownedWorkspaceIds.has(row.workspaceId)),
        )
        .map((row) => ({
          batchId: row.batchId,
          resourceKind: row.resourceKind,
          resourceId: row.resourceId,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          results: row.recipients.map(({ email, status }) => ({ email, status })),
        })),
    };
  }
  deleteAccount({ userId, ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    for (const [id, row] of this.rows)
      if (row.actorId === userId || ownedWorkspaceIds.has(row.workspaceId)) this.rows.delete(id);
  }
  deleteIdeaBoardMetadata(resourceId: string) {
    this.deletedResources.add(`idea_board:${resourceId}`);
    for (const [id, row] of this.rows)
      if (row.resourceKind === "idea_board" && row.resourceId === resourceId) this.rows.delete(id);
  }
  deleteCanvasBoardMetadata(resourceId: string) {
    this.deletedResources.add(`canvas:${resourceId}`);
    for (const [id, row] of this.rows)
      if (row.resourceKind === "canvas" && row.resourceId === resourceId) this.rows.delete(id);
  }
  purgeExpired(now: Date) {
    const removed: string[] = [];
    for (const [id, row] of this.rows)
      if (Date.parse(row.expiresAt) <= now.getTime()) {
        this.rows.delete(id);
        removed.push(id);
      }
    return removed;
  }
}

async function postgresTransaction<T>(
  repository: PostgresRepository,
  scope: BoardInvitationScope | null,
  work: (client: PoolClient) => Promise<T>,
) {
  const client = await repository.pool.connect();
  try {
    await client.query("BEGIN");
    if (scope) {
      for (const [key, value] of Object.entries({
        "app.workspace_id": scope.workspaceId,
        "app.board_invitation_actor": scope.actorId,
        "app.board_invitation_kind": scope.resourceKind,
        "app.board_invitation_resource": scope.resourceId,
      }))
        await client.query("SELECT set_config($1,$2,true)", [key, value]);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,86301))", [
        JSON.stringify([scope.workspaceId, scope.actorId, scope.resourceKind, scope.resourceId]),
      ]);
    } else await client.query("SELECT set_config('app.board_invitation_lifecycle','on',true)");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function createBoardInvitationRepository(repository: Repository): BoardInvitationRepository {
  if (repository instanceof MemoryRepository) {
    const store = repository.getOrCreateLifecycleExtension(
      "board-invitation-delivery",
      () => new MemoryBoardInvitationStore(repository),
    );
    return new BoardInvitationRepository(store.run, async (now) => store.purgeExpired(now));
  }
  if (!(repository instanceof PostgresRepository))
    throw new Error("Invitation delivery requires the canonical repository");
  const run: Run = (scope, work) =>
    postgresTransaction(repository, scope, async (client) =>
      work({
        get: async (id) => {
          const result = await client.query(
            "SELECT data FROM board_invitation_deliveries WHERE id=$1 FOR UPDATE",
            [id],
          );
          return (result.rows[0]?.data as BoardInvitationBatchRecord | undefined) ?? null;
        },
        put: async (row, insert) => {
          if (insert)
            await client.query(
              "INSERT INTO board_invitation_deliveries(id,workspace_id,actor_id,resource_kind,resource_id,operation_id,expires_at,canvas_board_id,idea_board_id,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
              [
                row.batchId,
                row.workspaceId,
                row.actorId,
                row.resourceKind,
                row.resourceId,
                row.operationId,
                row.expiresAt,
                row.resourceKind === "canvas" ? row.resourceId : null,
                row.resourceKind === "idea_board" ? row.resourceId : null,
                row,
              ],
            );
          else {
            const result = await client.query(
              "UPDATE board_invitation_deliveries SET data=$2 WHERE id=$1",
              [row.batchId, row],
            );
            if (result.rowCount !== 1) throw new BoardInvitationError("NOT_FOUND");
          }
        },
        count: async () =>
          Number(
            (await client.query("SELECT count(*) AS count FROM board_invitation_deliveries"))
              .rows[0].count,
          ),
      }),
    );
  return new BoardInvitationRepository(run, (now) =>
    postgresTransaction(repository, null, async (client) =>
      (
        await client.query(
          "DELETE FROM board_invitation_deliveries WHERE expires_at<=$1 RETURNING id",
          [now],
        )
      ).rows.map((row) => String(row.id)),
    ),
  );
}
