import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { FeedbackPageCursorSchema, type FeedbackSubmission } from "@openround/contracts";
import { MemoryRepository, type MemoryRepositoryLifecycleContext } from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import type { Repository } from "./types.js";

export interface FeedbackRecord extends FeedbackSubmission {
  id: string;
  workspaceId: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}
export class FeedbackConflictError extends Error {}
export class FeedbackCursorError extends Error {
  constructor() {
    super("Invalid or expired feedback cursor. Refresh the queue and try again.");
  }
}
export type FeedbackCursor = { id: string; createdAt?: Date };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function feedbackCursor(row: Pick<FeedbackRecord, "id" | "createdAt">) {
  return Buffer.from(
    JSON.stringify({ schemaVersion: 1, id: row.id, createdAt: row.createdAt.toISOString() }),
  ).toString("base64url");
}
export function parseFeedbackCursor(value: string): FeedbackCursor {
  // Keep accepting the previous UUID cursor; newly issued cursors survive anchor deletion.
  if (uuid.test(value)) return { id: value.toLowerCase() };
  try {
    if (value.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new FeedbackCursorError();
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw new FeedbackCursorError();
    const parsed = FeedbackPageCursorSchema.parse(JSON.parse(bytes.toString("utf8")));
    return { id: parsed.id, createdAt: new Date(parsed.createdAt) };
  } catch {
    throw new FeedbackCursorError();
  }
}
function matches(record: FeedbackRecord, input: FeedbackSubmission) {
  if (
    record.category !== input.category ||
    record.message !== input.message ||
    record.page !== input.page ||
    record.allowContact !== input.allowContact
  )
    throw new FeedbackConflictError("This retry key was already used for different feedback");
  return record;
}
interface FeedbackRepository {
  find(workspaceId: string, userId: string, key: string): Promise<FeedbackRecord | null>;
  submit(
    workspaceId: string,
    userId: string,
    input: FeedbackSubmission,
    now: Date,
  ): Promise<FeedbackRecord>;
  list(
    cursor?: FeedbackCursor,
    limit?: number,
  ): Promise<Array<FeedbackRecord & { contactEmail: string | null }>>;
  purge(now: Date): Promise<number>;
}
class MemoryFeedbackRepository implements FeedbackRepository {
  readonly records = new Map<string, FeedbackRecord>();
  constructor(private readonly parent: MemoryRepository) {}
  async find(workspaceId: string, userId: string, key: string) {
    return structuredClone(
      [...this.records.values()].find(
        (row) =>
          row.workspaceId === workspaceId && row.userId === userId && row.idempotencyKey === key,
      ) ?? null,
    );
  }
  async submit(workspaceId: string, userId: string, input: FeedbackSubmission, now: Date) {
    // Keep check-and-insert synchronous so concurrent memory retries are atomic.
    const existing = [...this.records.values()].find(
      (row) =>
        row.workspaceId === workspaceId &&
        row.userId === userId &&
        row.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return structuredClone(matches(existing, input));
    const record = {
      ...input,
      id: randomUUID(),
      workspaceId,
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 90 * 86400000),
    };
    this.records.set(record.id, structuredClone(record));
    return structuredClone(record);
  }
  async list(cursor?: FeedbackCursor, limit = 50) {
    const now = new Date();
    const before = cursor
      ? { id: cursor.id, createdAt: cursor.createdAt ?? this.records.get(cursor.id)?.createdAt }
      : undefined;
    if (before && !before.createdAt) throw new FeedbackCursorError();
    return [...this.records.values()]
      .filter((row) => row.expiresAt > now)
      .filter(
        (row) =>
          !before ||
          row.createdAt < before.createdAt! ||
          (row.createdAt.getTime() === before.createdAt!.getTime() && row.id < before.id),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((row) => ({
        ...structuredClone(row),
        contactEmail: row.allowContact ? (this.parent.users.get(row.userId)?.email ?? null) : null,
      }));
  }
  async purge(now: Date) {
    let count = 0;
    for (const [id, row] of this.records)
      if (row.expiresAt <= now) {
        this.records.delete(id);
        count++;
      }
    return count;
  }
  exportAccount({ userId }: MemoryRepositoryLifecycleContext) {
    return {
      productFeedback: [...this.records.values()]
        .filter((row) => row.userId === userId)
        .map((row) => structuredClone(row)),
    };
  }
  deleteAccount({ userId, ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    for (const [id, row] of this.records)
      if (row.userId === userId || ownedWorkspaceIds.has(row.workspaceId)) this.records.delete(id);
  }
}
function map(row: QueryResultRow): FeedbackRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    idempotencyKey: row.idempotency_key,
    category: row.category,
    message: row.message,
    page: row.page,
    allowContact: row.allow_contact,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
class PostgresFeedbackRepository implements FeedbackRepository {
  constructor(private readonly parent: PostgresRepository) {}
  private async transaction<T>(
    workspaceId: string | null,
    userId: string | null,
    work: (client: PoolClient) => Promise<T>,
  ) {
    const client = await this.parent.pool.connect();
    try {
      await client.query("BEGIN");
      if (workspaceId) {
        await client.query(
          "SELECT set_config('app.workspace_id', $1, true), set_config('app.user_id', $2, true)",
          [workspaceId, userId],
        );
      } else await client.query("SELECT set_config('app.system_access', 'on', true)");
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
  async find(workspaceId: string, userId: string, key: string) {
    return this.transaction(workspaceId, userId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM beta_feedback WHERE workspace_id = $1 AND user_id = $2 AND idempotency_key = $3",
        [workspaceId, userId, key],
      );
      return rows[0] ? map(rows[0]) : null;
    });
  }
  async submit(workspaceId: string, userId: string, input: FeedbackSubmission, now: Date) {
    return this.transaction(workspaceId, userId, async (client) => {
      const inserted = await client.query(
        `INSERT INTO beta_feedback
        (id, workspace_id, user_id, idempotency_key, category, message, page, allow_contact, created_at, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (workspace_id, user_id, idempotency_key) DO NOTHING RETURNING *`,
        [
          randomUUID(),
          workspaceId,
          userId,
          input.idempotencyKey,
          input.category,
          input.message,
          input.page,
          input.allowContact,
          now,
          new Date(now.getTime() + 90 * 86400000),
        ],
      );
      const row =
        inserted.rows[0] ??
        (
          await client.query(
            "SELECT * FROM beta_feedback WHERE workspace_id = $1 AND user_id = $2 AND idempotency_key = $3",
            [workspaceId, userId, input.idempotencyKey],
          )
        ).rows[0];
      if (!row) throw new Error("Feedback receipt not found after commit conflict");
      return matches(map(row), input);
    });
  }
  async list(cursor?: FeedbackCursor, limit = 50) {
    return this.transaction(null, null, async (client) => {
      let before = cursor;
      if (before && !before.createdAt) {
        const anchor = await client.query("SELECT created_at FROM beta_feedback WHERE id = $1", [
          before.id,
        ]);
        if (!anchor.rows[0]) throw new FeedbackCursorError();
        before = { id: before.id, createdAt: anchor.rows[0].created_at };
      }
      return (
        await client.query(
          `SELECT f.*, CASE WHEN f.allow_contact THEN u.email ELSE NULL END AS contact_email
       FROM beta_feedback f JOIN users u ON u.id = f.user_id
       WHERE ($1::timestamptz IS NULL OR (f.created_at, f.id) < ($1::timestamptz, $2::uuid)) AND f.expires_at > $4
       ORDER BY f.created_at DESC, f.id DESC LIMIT $3`,
          [before?.createdAt ?? null, before?.id ?? null, limit, new Date()],
        )
      ).rows.map((row) => ({ ...map(row), contactEmail: row.contact_email }));
    });
  }
  async purge(now: Date) {
    return this.transaction(
      null,
      null,
      async (client) =>
        (await client.query("DELETE FROM beta_feedback WHERE expires_at <= $1", [now])).rowCount ??
        0,
    );
  }
}
export function createFeedbackRepository(repository: Repository): FeedbackRepository {
  if (repository instanceof MemoryRepository)
    return repository.getOrCreateLifecycleExtension(
      "product-feedback",
      () => new MemoryFeedbackRepository(repository),
    );
  if (repository instanceof PostgresRepository) return new PostgresFeedbackRepository(repository);
  throw new Error("Unsupported feedback repository");
}
