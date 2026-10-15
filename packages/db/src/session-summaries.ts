import { randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
  AggregateSessionSummarySchema,
  SummarySourceSchema,
  type AggregateSessionSummary,
  type SummarySource,
} from "@openround/contracts";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import type { Repository } from "./types.js";

export class SessionSummaryError extends Error {
  constructor(
    public readonly code: "IDEMPOTENCY_CONFLICT" | "LINK_LIMIT" | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

export interface SessionSummarySnapshotRecord {
  id: string;
  workspaceId: string;
  source: SummarySource;
  createdBy: string;
  summary: AggregateSessionSummary;
  createdAt: Date;
  expiresAt: Date;
}

/** Internal capability metadata; never serialize tokenHash or intentHash to the public API. */
export interface SessionSummaryShareRecord {
  id: string;
  workspaceId: string;
  snapshotId: string;
  actorId: string;
  idempotencyKey: string;
  intentHash: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  allowDownloads: boolean;
  nextSteps: string;
}

export interface CreateSessionSummarySnapshot {
  workspaceId: string;
  source: SummarySource;
  actorId: string;
  summary: AggregateSessionSummary;
  expiresAt: Date;
  now: Date;
}

export interface CreateSessionSummaryShare {
  workspaceId: string;
  snapshotId: string;
  actorId: string;
  idempotencyKey: string;
  intentHash: string;
  tokenHash: string;
  expiresInDays: number;
  allowDownloads: boolean;
  nextSteps: string;
  now: Date;
}

export interface SessionSummaryRepository {
  getSnapshot(
    workspaceId: string,
    source: SummarySource,
  ): Promise<SessionSummarySnapshotRecord | null>;
  getOrCreateSnapshot(
    input: CreateSessionSummarySnapshot,
  ): Promise<SessionSummarySnapshotRecord | null>;
  hasSnapshots(workspaceId: string): Promise<boolean>;
  getShareIntent(
    workspaceId: string,
    actorId: string,
    idempotencyKey: string,
  ): Promise<SessionSummaryShareRecord | null>;
  createShare(
    input: CreateSessionSummaryShare,
  ): Promise<{ share: SessionSummaryShareRecord; replayed: boolean }>;
  listShares(workspaceId: string, source: SummarySource): Promise<SessionSummaryShareRecord[]>;
  revokeShare(
    workspaceId: string,
    source: SummarySource,
    shareId: string,
    actorId: string,
    now: Date,
  ): Promise<boolean>;
  getPublicShare(
    shareId: string,
    tokenHash: string,
    now: Date,
  ): Promise<{ snapshot: SessionSummarySnapshotRecord; share: SessionSummaryShareRecord } | null>;
}

const dayMs = 86_400_000;
const hash64 = /^[a-f0-9]{64}$/;
const unavailable = () => new SessionSummaryError("UNAVAILABLE", "This summary is unavailable");
const sourceKey = (workspaceId: string, source: SummarySource) =>
  `${workspaceId}:${source.kind}:${source.id}`;
const intentKey = (workspaceId: string, actorId: string, key: string) =>
  `${workspaceId}:${actorId}:${key}`;
const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function snapshotInput(input: CreateSessionSummarySnapshot) {
  const source = SummarySourceSchema.parse(input.source);
  const summary = AggregateSessionSummarySchema.parse(input.summary);
  if (
    summary.kind !== source.kind ||
    summary.nextSteps !== "" ||
    !Number.isFinite(input.now.getTime()) ||
    !Number.isFinite(input.expiresAt.getTime())
  )
    throw unavailable();
  return { source, summary };
}

function validateShare(input: CreateSessionSummaryShare) {
  if (
    !hash64.test(input.intentHash) ||
    !hash64.test(input.tokenHash) ||
    !Number.isInteger(input.expiresInDays) ||
    input.expiresInDays < 1 ||
    input.expiresInDays > 30 ||
    typeof input.allowDownloads !== "boolean" ||
    typeof input.nextSteps !== "string" ||
    input.nextSteps.length > 2_000 ||
    !Number.isFinite(input.now.getTime())
  )
    throw unavailable();
  SummarySourceSchema.shape.id.parse(input.idempotencyKey);
}

function replay(
  share: SessionSummaryShareRecord,
  input: Pick<CreateSessionSummaryShare, "intentHash" | "snapshotId">,
) {
  if (share.intentHash !== input.intentHash || share.snapshotId !== input.snapshotId)
    throw new SessionSummaryError("IDEMPOTENCY_CONFLICT", "This sharing request has changed");
  return { share: structuredClone(share), replayed: true };
}

export class MemorySessionSummaryRepository
  implements SessionSummaryRepository, MemoryRepositoryLifecycleExtension
{
  private readonly snapshots = new Map<string, SessionSummarySnapshotRecord>();
  private readonly shares = new Map<string, SessionSummaryShareRecord>();
  private readonly intents = new Map<string, string>();

  constructor(private readonly parent: MemoryRepository) {}

  private member(workspaceId: string, actorId: string, write = false) {
    const user = this.parent.users.get(actorId);
    const member = this.parent.workspaceMembers.get(`${workspaceId}:${actorId}`);
    if (!user || user.deletedAt || !member || !this.parent.workspaces.has(workspaceId))
      return false;
    const role = user.workspaceId === workspaceId ? user.role : member.role;
    return !write || role === "owner" || role === "editor";
  }

  private retained(snapshot: SessionSummarySnapshotRecord, now: Date) {
    const source = this.parent.getSessionSummarySource(
      snapshot.workspaceId,
      snapshot.source.kind,
      snapshot.source.id,
      now,
    );
    return source?.ready && source.expiresAt > now && snapshot.expiresAt > now;
  }

  async getSnapshot(workspaceId: string, source: SummarySource) {
    SummarySourceSchema.parse(source);
    const snapshot = this.snapshots.get(sourceKey(workspaceId, source));
    return snapshot && this.retained(snapshot, new Date()) ? structuredClone(snapshot) : null;
  }

  async getOrCreateSnapshot(input: CreateSessionSummarySnapshot) {
    const { source, summary } = snapshotInput(input);
    this.parent.assertWorkspaceLiveSessionCreationAllowed(input.workspaceId);
    if (!this.member(input.workspaceId, input.actorId)) return null;
    const parent = this.parent.getSessionSummarySource(
      input.workspaceId,
      source.kind,
      source.id,
      input.now,
      true,
    );
    if (!parent?.ready || parent.expiresAt <= input.now) return null;
    const key = sourceKey(input.workspaceId, source);
    const existing = this.snapshots.get(key);
    if (existing) return existing.expiresAt > input.now ? structuredClone(existing) : null;
    const expiresAt = new Date(Math.min(input.expiresAt.getTime(), parent.expiresAt.getTime()));
    if (expiresAt <= input.now) return null;
    // No await between authority checks and the write: source deletion cannot interleave.
    const snapshot = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      source,
      createdBy: input.actorId,
      summary,
      createdAt: new Date(input.now),
      expiresAt,
    };
    this.snapshots.set(key, structuredClone(snapshot));
    return structuredClone(snapshot);
  }

  async hasSnapshots(workspaceId: string) {
    const now = new Date();
    return [...this.snapshots.values()].some(
      (snapshot) => snapshot.workspaceId === workspaceId && this.retained(snapshot, now),
    );
  }

  async getShareIntent(workspaceId: string, actorId: string, idempotencyKey: string) {
    if (!this.member(workspaceId, actorId, true)) return null;
    const id = this.intents.get(intentKey(workspaceId, actorId, idempotencyKey));
    const share = id ? this.shares.get(id) : null;
    return share ? structuredClone(share) : null;
  }

  async createShare(input: CreateSessionSummaryShare) {
    validateShare(input);
    this.parent.assertWorkspaceLiveSessionCreationAllowed(input.workspaceId);
    if (!this.member(input.workspaceId, input.actorId, true)) throw unavailable();
    const snapshot = [...this.snapshots.values()].find(
      (entry) => entry.workspaceId === input.workspaceId && entry.id === input.snapshotId,
    );
    if (!snapshot || !this.retained(snapshot, input.now)) throw unavailable();
    const key = intentKey(input.workspaceId, input.actorId, input.idempotencyKey);
    const existingId = this.intents.get(key);
    const existing = existingId ? this.shares.get(existingId) : null;
    if (existing) return replay(existing, input);
    const active = [...this.shares.values()].filter(
      (share) =>
        share.snapshotId === snapshot.id && !share.revokedAt && share.expiresAt > input.now,
    );
    if (active.length >= 20)
      throw new SessionSummaryError(
        "LINK_LIMIT",
        "Revoke a link before creating another summary link",
      );
    if ([...this.shares.values()].some((share) => share.tokenHash === input.tokenHash))
      throw unavailable();
    const parent = this.parent.getSessionSummarySource(
      input.workspaceId,
      snapshot.source.kind,
      snapshot.source.id,
      input.now,
    )!;
    const share = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      snapshotId: snapshot.id,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      intentHash: input.intentHash,
      tokenHash: input.tokenHash,
      expiresAt: new Date(
        Math.min(
          input.now.getTime() + input.expiresInDays * dayMs,
          snapshot.expiresAt.getTime(),
          parent.expiresAt.getTime(),
        ),
      ),
      revokedAt: null,
      allowDownloads: input.allowDownloads,
      nextSteps: input.nextSteps,
      createdAt: new Date(input.now),
    };
    this.shares.set(share.id, structuredClone(share));
    this.intents.set(key, share.id);
    return { share: structuredClone(share), replayed: false };
  }

  async listShares(workspaceId: string, source: SummarySource) {
    SummarySourceSchema.parse(source);
    const snapshot = this.snapshots.get(sourceKey(workspaceId, source));
    const now = new Date();
    const active = (share: SessionSummaryShareRecord) =>
      Number(!share.revokedAt && share.expiresAt > now);
    return [...this.shares.values()]
      .filter((share) => share.workspaceId === workspaceId && share.snapshotId === snapshot?.id)
      .sort(
        (a, b) =>
          active(b) - active(a) ||
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.id.localeCompare(a.id),
      )
      .slice(0, 100)
      .map((share) => structuredClone(share));
  }

  async revokeShare(
    workspaceId: string,
    source: SummarySource,
    shareId: string,
    actorId: string,
    now: Date,
  ) {
    if (!this.member(workspaceId, actorId, true)) throw unavailable();
    const snapshot = this.snapshots.get(sourceKey(workspaceId, SummarySourceSchema.parse(source)));
    const share = this.shares.get(shareId);
    if (!share || share.workspaceId !== workspaceId || share.snapshotId !== snapshot?.id)
      return false;
    share.revokedAt ??= new Date(now);
    return true;
  }

  async getPublicShare(shareId: string, tokenHash: string, now: Date) {
    const share = this.shares.get(shareId);
    if (
      !share ||
      !hash64.test(tokenHash) ||
      !safeEqual(share.tokenHash, tokenHash) ||
      share.revokedAt ||
      share.expiresAt <= now ||
      !this.member(share.workspaceId, share.actorId, true)
    )
      return null;
    const snapshot = [...this.snapshots.values()].find((entry) => entry.id === share.snapshotId);
    return snapshot && this.retained(snapshot, now) ? structuredClone({ snapshot, share }) : null;
  }

  deleteSessionSummarySource(workspaceId: string, kind: SummarySource["kind"], id: string) {
    const key = sourceKey(workspaceId, { kind, id });
    const snapshot = this.snapshots.get(key);
    if (!snapshot) return;
    this.snapshots.delete(key);
    for (const [shareId, share] of this.shares)
      if (share.snapshotId === snapshot.id) {
        this.shares.delete(shareId);
        this.intents.delete(intentKey(share.workspaceId, share.actorId, share.idempotencyKey));
      }
  }

  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    return {
      sessionSummarySnapshots: [...this.snapshots.values()]
        .filter((snapshot) => ownedWorkspaceIds.has(snapshot.workspaceId))
        .map((snapshot) => structuredClone(snapshot)),
      sessionSummaryShares: [...this.shares.values()]
        .filter((share) => ownedWorkspaceIds.has(share.workspaceId))
        .map(({ tokenHash: _tokenHash, intentHash: _intentHash, ...share }) =>
          structuredClone(share),
        ),
    };
  }

  deleteAccount({ ownedWorkspaceIds, userId }: MemoryRepositoryLifecycleContext) {
    for (const snapshot of this.snapshots.values())
      if (ownedWorkspaceIds.has(snapshot.workspaceId))
        this.deleteSessionSummarySource(
          snapshot.workspaceId,
          snapshot.source.kind,
          snapshot.source.id,
        );
    // Remove a departing collaborator's capabilities without deleting another member's evidence.
    for (const [id, share] of this.shares)
      if (share.actorId === userId) {
        this.shares.delete(id);
        this.intents.delete(intentKey(share.workspaceId, share.actorId, share.idempotencyKey));
      }
  }

  purgeExpired(now: Date) {
    for (const snapshot of this.snapshots.values())
      if (!this.retained(snapshot, now))
        this.deleteSessionSummarySource(
          snapshot.workspaceId,
          snapshot.source.kind,
          snapshot.source.id,
        );
    return [];
  }
}

const columnFor = {
  round: "round_session_id",
  presentation: "presentation_session_id",
  survey: "survey_room_id",
} as const;

function mapSnapshot(row: QueryResultRow): SessionSummarySnapshotRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    source: SummarySourceSchema.parse({
      kind: row.source_kind,
      id: row[columnFor[row.source_kind as SummarySource["kind"]]],
    }),
    createdBy: row.created_by,
    summary: AggregateSessionSummarySchema.parse(row.summary),
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
  };
}

function mapShare(row: QueryResultRow): SessionSummaryShareRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    snapshotId: row.snapshot_id,
    actorId: row.actor_id,
    idempotencyKey: row.idempotency_key,
    intentHash: row.intent_hash,
    tokenHash: row.token_hash,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    allowDownloads: row.allow_downloads,
    nextSteps: row.next_steps,
  };
}

export class PostgresSessionSummaryRepository implements SessionSummaryRepository {
  constructor(private readonly parent: PostgresRepository) {}

  private async transaction<T>(
    workspaceId: string | null,
    work: (client: PoolClient) => Promise<T>,
    write = false,
  ) {
    const client = await this.parent.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config($1, $2, true)", [
        workspaceId ? "app.workspace_id" : "app.system_access",
        workspaceId ?? "on",
      ]);
      if (workspaceId && write) {
        const workspace = await client.query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE", [
          workspaceId,
        ]);
        if (!workspace.rowCount) throw unavailable();
        const deletion = await client.query(
          "SELECT 1 FROM workspace_media_deletion_jobs WHERE workspace_id = $1",
          [workspaceId],
        );
        if (deletion.rowCount) throw unavailable();
      }
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

  private async member(client: PoolClient, workspaceId: string, actorId: string, write = false) {
    // User rows have system-only RLS. Elevate only for this exact identity/membership lookup.
    await client.query("SELECT set_config('app.system_access', 'on', true)");
    const result = await client.query(
      `SELECT member.role FROM workspace_members member JOIN users actor ON actor.id = member.user_id
       WHERE member.workspace_id = $1 AND member.user_id = $2 AND actor.deleted_at IS NULL
       FOR SHARE OF member, actor`,
      [workspaceId, actorId],
    );
    await client.query("SELECT set_config('app.system_access', '', true)");
    return Boolean(
      result.rowCount && (!write || ["owner", "editor"].includes(result.rows[0]!.role)),
    );
  }

  private async source(
    client: PoolClient,
    workspaceId: string,
    source: SummarySource,
    now: Date,
    freeze = false,
  ) {
    const sql =
      source.kind === "round"
        ? `SELECT parent.retention_expires_at FROM game_sessions parent
         WHERE parent.workspace_id = $1 AND parent.id = $2 AND parent.state = 'finished'
           AND parent.deleted_at IS NULL AND parent.retention_expires_at > $3
           AND EXISTS (SELECT 1 FROM reports report WHERE report.workspace_id = $1
             AND report.session_id = parent.id AND report.status = 'ready') FOR SHARE OF parent`
        : source.kind === "presentation"
          ? `SELECT parent.retention_expires_at FROM presentation_live_sessions parent
           WHERE parent.workspace_id = $1 AND parent.id = $2 AND parent.status = 'finished'
             AND parent.retention_expires_at > $3
             AND EXISTS (SELECT 1 FROM presentation_session_reports report WHERE report.workspace_id = $1
               AND report.session_id = parent.id AND report.status = 'ready') FOR SHARE OF parent`
          : `SELECT parent.retention_expires_at, parent.closes_at FROM survey_feedback_rooms parent
           WHERE parent.workspace_id = $1 AND parent.id = $2 AND parent.retention_expires_at > $3
             AND ((parent.data->>'closed')::boolean OR parent.closes_at <= $3) FOR SHARE OF parent`;
    const result = await client.query(sql, [workspaceId, source.id, now]);
    if (result.rowCount && freeze && source.kind === "survey") {
      const closedAt = new Date(
        Math.min(new Date(result.rows[0]!.closes_at).getTime(), now.getTime()),
      ).toISOString();
      await client.query(
        "UPDATE survey_feedback_rooms SET data = jsonb_set(jsonb_set(data, '{closed}', 'true'::jsonb), '{closedAt}', coalesce(data->'closedAt', to_jsonb($4::text))) WHERE workspace_id = $1 AND id = $2 AND ((data->>'closed')::boolean OR closes_at <= $3) AND (NOT (data->>'closed')::boolean OR NOT (data ? 'closedAt'))",
        [workspaceId, source.id, now, closedAt],
      );
    }
    return result.rows[0] ? new Date(result.rows[0].retention_expires_at) : null;
  }

  async getSnapshot(workspaceId: string, source: SummarySource) {
    SummarySourceSchema.parse(source);
    return this.transaction(workspaceId, async (client) => {
      const now = new Date();
      if (!(await this.source(client, workspaceId, source, now))) return null;
      const result = await client.query(
        `SELECT * FROM session_summary_snapshots WHERE workspace_id = $1 AND ${columnFor[source.kind]} = $2 AND expires_at > $3`,
        [workspaceId, source.id, now],
      );
      return result.rows[0] ? mapSnapshot(result.rows[0]) : null;
    });
  }

  async getOrCreateSnapshot(input: CreateSessionSummarySnapshot) {
    const { source, summary } = snapshotInput(input);
    return this.transaction(
      input.workspaceId,
      async (client) => {
        if (!(await this.member(client, input.workspaceId, input.actorId))) return null;
        const retention = await this.source(client, input.workspaceId, source, input.now, true);
        if (!retention) return null;
        const existing = await client.query(
          `SELECT * FROM session_summary_snapshots WHERE workspace_id = $1 AND ${columnFor[source.kind]} = $2`,
          [input.workspaceId, source.id],
        );
        if (existing.rows[0]) {
          const snapshot = mapSnapshot(existing.rows[0]);
          return snapshot.expiresAt > input.now ? snapshot : null;
        }
        const expiresAt = new Date(Math.min(input.expiresAt.getTime(), retention.getTime()));
        if (expiresAt <= input.now) return null;
        const result = await client.query(
          `INSERT INTO session_summary_snapshots (id, workspace_id, source_kind, ${columnFor[source.kind]}, created_by, summary, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            randomUUID(),
            input.workspaceId,
            source.kind,
            source.id,
            input.actorId,
            summary,
            input.now,
            expiresAt,
          ],
        );
        return mapSnapshot(result.rows[0]!);
      },
      true,
    );
  }

  async hasSnapshots(workspaceId: string) {
    return this.transaction(workspaceId, async (client) => {
      const now = new Date();
      const result = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM session_summary_snapshots snapshot
           LEFT JOIN game_sessions round ON round.workspace_id = snapshot.workspace_id
             AND round.id = snapshot.round_session_id
           LEFT JOIN presentation_live_sessions presentation ON presentation.workspace_id = snapshot.workspace_id
             AND presentation.id = snapshot.presentation_session_id
           LEFT JOIN survey_feedback_rooms survey ON survey.workspace_id = snapshot.workspace_id
             AND survey.id = snapshot.survey_room_id
           WHERE snapshot.workspace_id = $1 AND snapshot.expires_at > $2 AND (
             (snapshot.source_kind = 'round' AND round.state = 'finished'
               AND round.deleted_at IS NULL AND round.retention_expires_at > $2
               AND EXISTS (SELECT 1 FROM reports report WHERE report.workspace_id = $1
                 AND report.session_id = round.id AND report.status = 'ready'))
             OR (snapshot.source_kind = 'presentation' AND presentation.status = 'finished'
               AND presentation.retention_expires_at > $2
               AND EXISTS (SELECT 1 FROM presentation_session_reports report WHERE report.workspace_id = $1
                 AND report.session_id = presentation.id AND report.status = 'ready'))
             OR (snapshot.source_kind = 'survey' AND survey.retention_expires_at > $2
               AND ((survey.data->>'closed')::boolean OR survey.closes_at <= $2))
           )
         ) AS present`,
        [workspaceId, now],
      );
      return Boolean(result.rows[0]?.present);
    });
  }

  async getShareIntent(workspaceId: string, actorId: string, idempotencyKey: string) {
    return this.transaction(workspaceId, async (client) => {
      if (!(await this.member(client, workspaceId, actorId, true))) return null;
      const result = await client.query(
        "SELECT * FROM session_summary_shares WHERE workspace_id = $1 AND actor_id = $2 AND idempotency_key = $3",
        [workspaceId, actorId, idempotencyKey],
      );
      return result.rows[0] ? mapShare(result.rows[0]) : null;
    });
  }

  async createShare(input: CreateSessionSummaryShare) {
    validateShare(input);
    return this.transaction(
      input.workspaceId,
      async (client) => {
        if (!(await this.member(client, input.workspaceId, input.actorId, true)))
          throw unavailable();
        const stored = await client.query(
          "SELECT * FROM session_summary_snapshots WHERE workspace_id = $1 AND id = $2",
          [input.workspaceId, input.snapshotId],
        );
        if (!stored.rows[0]) throw unavailable();
        const snapshot = mapSnapshot(stored.rows[0]);
        const retention = await this.source(client, input.workspaceId, snapshot.source, input.now);
        if (!retention || snapshot.expiresAt <= input.now) throw unavailable();
        // Match parent deletion's lock order: source, snapshot, capability.
        const retained = await client.query(
          "SELECT id FROM session_summary_snapshots WHERE workspace_id = $1 AND id = $2 FOR SHARE",
          [input.workspaceId, snapshot.id],
        );
        if (!retained.rowCount) throw unavailable();
        const previous = await client.query(
          "SELECT * FROM session_summary_shares WHERE workspace_id = $1 AND actor_id = $2 AND idempotency_key = $3",
          [input.workspaceId, input.actorId, input.idempotencyKey],
        );
        if (previous.rows[0]) return replay(mapShare(previous.rows[0]), input);
        const active = await client.query(
          "SELECT count(*) AS count FROM session_summary_shares WHERE workspace_id = $1 AND snapshot_id = $2 AND revoked_at IS NULL AND expires_at > $3",
          [input.workspaceId, snapshot.id, input.now],
        );
        if (Number(active.rows[0]!.count) >= 20)
          throw new SessionSummaryError(
            "LINK_LIMIT",
            "Revoke a link before creating another summary link",
          );
        const expiresAt = new Date(
          Math.min(
            input.now.getTime() + input.expiresInDays * dayMs,
            snapshot.expiresAt.getTime(),
            retention.getTime(),
          ),
        );
        const result = await client.query(
          `INSERT INTO session_summary_shares (id, workspace_id, snapshot_id, actor_id, idempotency_key, intent_hash, token_hash, allow_downloads, next_steps, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            randomUUID(),
            input.workspaceId,
            snapshot.id,
            input.actorId,
            input.idempotencyKey,
            input.intentHash,
            input.tokenHash,
            input.allowDownloads,
            input.nextSteps,
            input.now,
            expiresAt,
          ],
        );
        return { share: mapShare(result.rows[0]!), replayed: false };
      },
      true,
    );
  }

  async listShares(workspaceId: string, source: SummarySource) {
    SummarySourceSchema.parse(source);
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `SELECT share.* FROM session_summary_shares share JOIN session_summary_snapshots snapshot
         ON snapshot.workspace_id = share.workspace_id AND snapshot.id = share.snapshot_id
         WHERE share.workspace_id = $1 AND snapshot.${columnFor[source.kind]} = $2
         ORDER BY (share.revoked_at IS NULL AND share.expires_at > $3) DESC,
           share.created_at DESC, share.id DESC LIMIT 100`,
        [workspaceId, source.id, new Date()],
      );
      return result.rows.map(mapShare);
    });
  }

  async revokeShare(
    workspaceId: string,
    source: SummarySource,
    shareId: string,
    actorId: string,
    now: Date,
  ) {
    SummarySourceSchema.parse(source);
    return this.transaction(workspaceId, async (client) => {
      if (!(await this.member(client, workspaceId, actorId, true))) throw unavailable();
      const result = await client.query(
        `UPDATE session_summary_shares share SET revoked_at = COALESCE(share.revoked_at, $4)
         FROM session_summary_snapshots snapshot WHERE share.id = $3 AND share.workspace_id = $1
           AND snapshot.workspace_id = $1 AND snapshot.id = share.snapshot_id
           AND snapshot.${columnFor[source.kind]} = $2 RETURNING share.id`,
        [workspaceId, source.id, shareId, now],
      );
      return Boolean(result.rowCount);
    });
  }

  async getPublicShare(shareId: string, tokenHash: string, now: Date) {
    if (!hash64.test(tokenHash)) return null;
    return this.transaction(null, async (client) => {
      // The only cross-tenant operation is an exact capability lookup. Remaining reads use RLS.
      const result = await client.query(
        "SELECT * FROM session_summary_shares WHERE id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > $3",
        [shareId, tokenHash, now],
      );
      if (!result.rows[0]) return null;
      const share = mapShare(result.rows[0]);
      await client.query(
        "SELECT set_config('app.workspace_id', $1, true), set_config('app.system_access', '', true)",
        [share.workspaceId],
      );
      if (!(await this.member(client, share.workspaceId, share.actorId, true))) return null;
      const stored = await client.query(
        "SELECT * FROM session_summary_snapshots WHERE workspace_id = $1 AND id = $2 AND expires_at > $3",
        [share.workspaceId, share.snapshotId, now],
      );
      if (!stored.rows[0]) return null;
      const snapshot = mapSnapshot(stored.rows[0]);
      if (!(await this.source(client, share.workspaceId, snapshot.source, now))) return null;
      // Recheck after obtaining the source fence, then lock in deletion's parent-to-child order.
      const retained = await client.query(
        "SELECT id FROM session_summary_snapshots WHERE workspace_id = $1 AND id = $2 AND expires_at > $3 FOR SHARE",
        [share.workspaceId, snapshot.id, now],
      );
      if (!retained.rowCount) return null;
      const current = await client.query(
        "SELECT * FROM session_summary_shares WHERE workspace_id = $1 AND id = $2 AND token_hash = $3 AND revoked_at IS NULL AND expires_at > $4 FOR SHARE",
        [share.workspaceId, shareId, tokenHash, now],
      );
      return current.rows[0] ? { snapshot, share: mapShare(current.rows[0]) } : null;
    });
  }
}

export function createSessionSummaryRepository(repository: Repository): SessionSummaryRepository {
  if (repository instanceof PostgresRepository)
    return new PostgresSessionSummaryRepository(repository);
  if (repository instanceof MemoryRepository)
    return repository.getOrCreateLifecycleExtension(
      "session-summaries",
      () => new MemorySessionSummaryRepository(repository),
    );
  throw new Error("Unsupported session summary repository");
}
