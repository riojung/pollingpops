import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { PostgresRepository } from "./postgres.js";
import { PlatformService, type PlatformStore } from "./platform-service.js";
import {
  PlatformError,
  type OrganizationWorkspaceRecord,
  type PlatformRoomCoverageInput,
  type PlatformRoomType,
  type CreditLedgerEntry,
  type ProductQueueKind,
  type ProductQueueHealth,
  type ActiveRoomSummary,
} from "./platform-types.js";

export function encodePlatformValue(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(encodePlatformValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, encodePlatformValue(item)]),
    );
  return value;
}
export function decodePlatformValue(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => decodePlatformValue(item));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.$date === "string" && Object.keys(record).length === 1)
      return new Date(record.$date);
    return Object.fromEntries(
      Object.entries(record).map(([name, item]) => [name, decodePlatformValue(item, name)]),
    );
  }
  if (
    typeof value === "string" &&
    /(?:At|Until|Through)$/.test(key) &&
    /^\d{4}-\d\d-\d\dT/.test(value)
  )
    return new Date(value);
  return value;
}
const json = (value: unknown) => JSON.stringify(encodePlatformValue(value));
const memberKey = (id: string) => {
  const colon = id.indexOf(":");
  return [id.slice(0, colon), id.slice(colon + 1)];
};
const organizationRow = (row: QueryResultRow) => ({
  id: row.id,
  name: row.name,
  status: row.status,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});
const workspaceRow = (row: QueryResultRow): OrganizationWorkspaceRecord => ({
  id: row.id,
  organizationId: row.organization_id,
  name: row.name,
  segment: row.segment,
  homeRegion: row.home_region,
  ownerId: row.owner_id,
  status: row.platform_status,
});

export class PostgresPlatformStore implements PlatformStore {
  constructor(
    private readonly pool: Pool | null,
    readonly client?: PoolClient,
  ) {}
  async transaction<T>(scope: string, work: (store: PlatformStore) => Promise<T>): Promise<T> {
    if (this.client) {
      if (scope !== "read")
        await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 73501))", [
          scope,
        ]);
      return work(this);
    }
    const client = await this.pool!.connect();
    try {
      await client.query("BEGIN");
      // Only this service's trusted methods use system context. Customer methods explicitly
      // validate identity and organization role before accessing a commercial organization.
      await client.query("SELECT set_config('app.system_access', 'on', true)");
      const result = await new PostgresPlatformStore(null, client).transaction(scope, work);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async get<T>(kind: string, id: string): Promise<T | null> {
    if (!this.client) return this.transaction("read", (store) => store.get<T>(kind, id));
    if (kind === "organization") {
      const result = await this.client.query("SELECT * FROM organizations WHERE id = $1", [id]);
      return result.rows[0] ? (organizationRow(result.rows[0]) as T) : null;
    }
    if (kind === "member") {
      const [org, user] = memberKey(id);
      const result = await this.client.query(
        "SELECT * FROM organization_members WHERE organization_id=$1 AND user_id=$2",
        [org, user],
      );
      const row = result.rows[0];
      return row
        ? ({
            organizationId: row.organization_id,
            userId: row.user_id,
            role: row.role,
            createdAt: new Date(row.created_at),
          } as T)
        : null;
    }
    if (kind === "workspace") {
      const result = await this.client.query("SELECT * FROM workspaces WHERE id=$1", [id]);
      return result.rows[0] ? (workspaceRow(result.rows[0]) as T) : null;
    }
    if (kind === "account") {
      const result = await this.client.query(
        "SELECT balance,reserved FROM platform_credit_accounts WHERE organization_id=$1 FOR UPDATE",
        [id],
      );
      return result.rows[0]
        ? ({
            balance: Number(result.rows[0].balance),
            reserved: Number(result.rows[0].reserved),
          } as T)
        : null;
    }
    const table =
      kind === "ledger"
        ? "platform_credit_ledger"
        : kind === "coverage"
          ? "platform_room_coverages"
          : "platform_records";
    const result = await this.client.query(
      `SELECT data FROM ${table} WHERE ${table === "platform_records" ? "kind=$1 AND id=$2" : "id=$1"}${kind === "provider_lock" ? " FOR UPDATE" : ""}`,
      table === "platform_records" ? [kind, id] : [id],
    );
    return result.rows[0] ? (decodePlatformValue(result.rows[0].data) as T) : null;
  }
  async list<T>(kind: string, org?: string): Promise<T[]> {
    if (!this.client) return this.transaction("read", (store) => store.list<T>(kind, org));
    if (kind === "organization") {
      const result = await this.client.query("SELECT * FROM organizations ORDER BY created_at,id");
      return result.rows.map((row) => organizationRow(row) as T);
    }
    if (kind === "member") {
      const result = await this.client.query(
        "SELECT * FROM organization_members WHERE ($1::uuid IS NULL OR organization_id=$1) ORDER BY created_at,user_id",
        [org ?? null],
      );
      return result.rows.map(
        (row) =>
          ({
            organizationId: row.organization_id,
            userId: row.user_id,
            role: row.role,
            createdAt: new Date(row.created_at),
          }) as T,
      );
    }
    if (kind === "workspace") {
      const result = await this.client.query(
        "SELECT * FROM workspaces WHERE ($1::uuid IS NULL OR organization_id=$1) ORDER BY created_at,id",
        [org ?? null],
      );
      return result.rows.map((row) => workspaceRow(row) as T);
    }
    const table =
      kind === "ledger"
        ? "platform_credit_ledger"
        : kind === "coverage"
          ? "platform_room_coverages"
          : "platform_records";
    const result = await this.client.query(
      `SELECT data FROM ${table} WHERE ${table === "platform_records" ? "kind=$1 AND ($2::uuid IS NULL OR organization_id=$2)" : "($1::uuid IS NULL OR organization_id=$1)"} ORDER BY created_at,id`,
      table === "platform_records" ? [kind, org ?? null] : [org ?? null],
    );
    return result.rows.map((row) => decodePlatformValue(row.data) as T);
  }
  async put<T>(kind: string, id: string, org: string | null, value: T): Promise<void> {
    if (!this.client)
      return this.transaction(kind === "audit" ? "operator" : `write:${kind}`, (store) =>
        store.put(kind, id, org, value),
      );
    const data = value as Record<string, unknown>;
    if (kind === "organization") {
      await this.client.query(
        `INSERT INTO organizations(id,name,status,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
        [id, data.name, data.status, data.createdAt, data.updatedAt],
      );
      await this.client.query(
        "INSERT INTO platform_credit_accounts(organization_id) VALUES($1) ON CONFLICT DO NOTHING",
        [id],
      );
      return;
    }
    if (kind === "member") {
      await this.client.query(
        `INSERT INTO organization_members(organization_id,user_id,role,created_at)
        VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=EXCLUDED.role`,
        [org, data.userId, data.role, data.createdAt],
      );
      return;
    }
    if (kind === "workspace") {
      await this.client.query("UPDATE workspaces SET name=$2,platform_status=$3 WHERE id=$1", [
        id,
        data.name,
        data.status,
      ]);
      return;
    }
    if (kind === "account") {
      await this.client.query(
        `INSERT INTO platform_credit_accounts(organization_id,balance,reserved)
        VALUES($1,$2,$3) ON CONFLICT(organization_id) DO UPDATE SET balance=EXCLUDED.balance,reserved=EXCLUDED.reserved,updated_at=now()`,
        [org, data.balance, data.reserved],
      );
      return;
    }
    if (kind === "ledger") {
      const entry = value as CreditLedgerEntry;
      await this.client.query(
        `INSERT INTO platform_credit_ledger(id,organization_id,source_key,delta,data,created_at)
        VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
        [id, org, entry.sourceKey, entry.delta, json(value), entry.createdAt],
      );
      return;
    }
    if (kind === "coverage") {
      await this.client.query(
        `INSERT INTO platform_room_coverages(id,organization_id,workspace_id,artifact_type,room_id,
        creation_key,reservation_state,expires_at,data,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
        ON CONFLICT(id) DO UPDATE SET reservation_state=EXCLUDED.reservation_state,data=EXCLUDED.data`,
        [
          id,
          org,
          data.workspaceId,
          data.artifactType,
          data.roomId,
          data.creationKey ?? null,
          data.reservationState,
          data.expiresAt,
          json(value),
          data.createdAt,
        ],
      );
      return;
    }
    if (kind === "audit" || kind === "stripe_transaction") {
      await this.client.query(
        "INSERT INTO platform_records(kind,id,organization_id,data) VALUES($1,$2,$3,$4::jsonb)",
        [kind, id, org, json(value)],
      );
      return;
    }
    await this.client.query(
      `INSERT INTO platform_records(kind,id,organization_id,data)
      VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(kind,id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()`,
      [kind, id, org, json(value)],
    );
  }
  async remove(kind: string, id: string): Promise<boolean> {
    if (!this.client) return this.transaction(`delete:${kind}`, (store) => store.remove(kind, id));
    if (["ledger", "audit", "coverage", "stripe_transaction"].includes(kind))
      throw new PlatformError("IMMUTABLE_RECORD", "Commercial evidence cannot be deleted");
    if (kind === "member") {
      const [org, user] = memberKey(id);
      const result = await this.client.query(
        "DELETE FROM organization_members WHERE organization_id=$1 AND user_id=$2",
        [org, user],
      );
      return result.rowCount === 1;
    }
    const result = await this.client.query("DELETE FROM platform_records WHERE kind=$1 AND id=$2", [
      kind,
      id,
    ]);
    return result.rowCount === 1;
  }
  async userExists(id: string): Promise<boolean> {
    if (!this.client) return this.transaction("read", (store) => store.userExists(id));
    const result = await this.client.query(
      "SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL",
      [id],
    );
    return result.rowCount === 1;
  }
  async userEmail(id: string): Promise<string | null> {
    if (!this.client) return this.transaction("read", (store) => store.userEmail(id));
    const result = await this.client.query(
      "SELECT email FROM users WHERE id=$1 AND deleted_at IS NULL",
      [id],
    );
    return result.rows[0]?.email ?? null;
  }
  async organizationIdForWorkspace(id: string): Promise<string | null> {
    if (!this.client)
      return this.transaction("read", (store) => store.organizationIdForWorkspace(id));
    const result = await this.client.query("SELECT organization_id FROM workspaces WHERE id=$1", [
      id,
    ]);
    return result.rows[0]?.organization_id ?? null;
  }
  async createWorkspace(input: OrganizationWorkspaceRecord) {
    if (!this.client)
      return this.transaction(`org:${input.organizationId}`, (store) =>
        store.createWorkspace(input),
      );
    await this.client.query(
      `INSERT INTO workspaces(id,name,segment,owner_id,home_region,organization_id,platform_status)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.id,
        input.name,
        input.segment,
        input.ownerId,
        input.homeRegion,
        input.organizationId,
        input.status,
      ],
    );
    await this.client.query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'owner')",
      [input.id, input.ownerId],
    );
    await this.client.query("INSERT INTO subscriptions(workspace_id) VALUES($1)", [input.id]);
  }
  async transferWorkspaceOwner(workspace: string, user: string) {
    if (!this.client)
      return this.transaction(`workspace:${workspace}`, (store) =>
        store.transferWorkspaceOwner(workspace, user),
      );
    const member = await this.client.query(
      "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
      [workspace, user],
    );
    if (!member.rowCount)
      throw new PlatformError("NOT_FOUND", "New steward must already belong to workspace");
    await this.client.query(
      "UPDATE workspace_members SET role='editor' WHERE workspace_id=$1 AND role='owner'",
      [workspace],
    );
    await this.client.query(
      "UPDATE workspace_members SET role='owner' WHERE workspace_id=$1 AND user_id=$2",
      [workspace, user],
    );
    await this.client.query("UPDATE workspaces SET owner_id=$2 WHERE id=$1", [workspace, user]);
  }
  async deleteUserMemberships(user: string) {
    if (!this.client)
      return this.transaction("identity", (store) => store.deleteUserMemberships(user));
    await this.client.query("DELETE FROM workspace_members WHERE user_id=$1", [user]);
  }
  async workspaceOwnerIds(user: string): Promise<string[]> {
    if (!this.client) return this.transaction("read", (store) => store.workspaceOwnerIds(user));
    const result = await this.client.query("SELECT id FROM workspaces WHERE owner_id=$1", [user]);
    return result.rows.map((row) => row.id);
  }
  async hasActiveSubscriptionRoom(workspace: string): Promise<boolean> {
    if (!this.client)
      return this.transaction("read", (store) => store.hasActiveSubscriptionRoom(workspace));
    const result = await this.client.query(
      `SELECT 1 FROM platform_room_coverages coverage
      WHERE coverage.workspace_id=$1 AND coverage.data->>'funding'='subscription' AND coverage.expires_at>clock_timestamp()
      AND ((coverage.artifact_type='round' AND EXISTS(SELECT 1 FROM game_sessions room WHERE room.id=coverage.room_id
        AND room.state<>'finished' AND room.ended_at IS NULL AND room.deleted_at IS NULL AND room.expires_at>clock_timestamp()))
        OR (coverage.artifact_type='presentation' AND EXISTS(SELECT 1 FROM presentation_live_sessions room WHERE room.id=coverage.room_id
        AND room.status='active' AND room.live_expires_at>clock_timestamp()))) LIMIT 1`,
      [workspace],
    );
    return result.rowCount === 1;
  }
  async hasActiveOrganizationRoom(org: string): Promise<boolean> {
    if (!this.client)
      return this.transaction("read", (store) => store.hasActiveOrganizationRoom(org));
    const result = await this.client.query(
      `SELECT 1 FROM live_room_codes room JOIN workspaces workspace ON workspace.id=room.workspace_id
       WHERE workspace.organization_id=$1 AND room.released_at IS NULL AND room.expires_at>clock_timestamp() LIMIT 1`,
      [org],
    );
    return result.rowCount === 1;
  }
  async lockWorkspace(id: string) {
    if (!this.client) return this.transaction("read", (store) => store.lockWorkspace(id));
    await this.client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [id]);
  }
  async listActiveRooms(org: string | undefined, limit: number): Promise<ActiveRoomSummary[]> {
    if (!this.client) return this.transaction("read", (store) => store.listActiveRooms(org, limit));
    const result = await this.client.query(
      `SELECT room.*, workspace.organization_id, workspace.name AS workspace_name,
      organization.name AS organization_name,coverage.data->>'funding' AS funding,
      CASE room.artifact_type WHEN 'round' THEN (SELECT count(*) FROM participants WHERE session_id=room.artifact_id)
        WHEN 'presentation' THEN (SELECT count(*) FROM presentation_live_participants WHERE session_id=room.artifact_id)
        ELSE (SELECT count(*) FROM survey_guests WHERE room_id=room.artifact_id) END AS participant_count
      FROM live_room_codes room JOIN workspaces workspace ON workspace.id=room.workspace_id
      JOIN organizations organization ON organization.id=workspace.organization_id
      LEFT JOIN platform_room_coverages coverage ON coverage.artifact_type=room.artifact_type AND coverage.room_id=room.artifact_id
      WHERE room.released_at IS NULL AND room.expires_at>clock_timestamp() AND ($1::uuid IS NULL OR organization.id=$1)
      ORDER BY room.created_at DESC,room.artifact_id LIMIT $2`,
      [org ?? null, limit],
    );
    return result.rows.map((row) => ({
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      artifactType: row.artifact_type,
      roomId: row.artifact_id,
      code: row.code,
      participantCount: Number(row.participant_count),
      expiresAt: new Date(row.expires_at),
      funding: row.funding,
    }));
  }
  async getProductQueueHealth(now: Date): Promise<ProductQueueHealth[]> {
    if (!this.client) return this.transaction("read", (store) => store.getProductQueueHealth(now));
    const specifications = [
      {
        kind: "round-report",
        table: "reports",
        processing: "job.attempts>0 AND job.available_at>$1 AND job.last_error IS NULL",
        retryable:
          "EXISTS(SELECT 1 FROM game_sessions room WHERE room.id=job.session_id AND room.deleted_at IS NULL AND room.retention_expires_at>$1)",
      },
      {
        kind: "presentation-report",
        table: "presentation_session_reports",
        processing: "job.lease_token IS NOT NULL AND job.available_at>$1",
        retryable:
          "EXISTS(SELECT 1 FROM presentation_live_sessions room WHERE room.id=job.session_id AND room.retention_expires_at>$1)",
      },
      {
        kind: "authoring",
        table: "authoring_jobs",
        processing: "job.status='processing'",
        retryable:
          "job.expires_at>$1 AND job.applied_quiz_id IS NULL AND job.output IS NULL AND (job.source_text IS NOT NULL OR job.source_blob IS NOT NULL)",
      },
    ] as const;
    const summaries: ProductQueueHealth[] = [];
    for (const spec of specifications) {
      const result = await this.client.query(
        `WITH queue AS (SELECT job.*,(${spec.processing}) AS processing,(${spec.retryable}) AS retryable FROM ${spec.table} job)
        SELECT count(*) FILTER(WHERE status='pending' AND NOT processing) AS pending,
          count(*) FILTER(WHERE (status='pending' AND processing) OR status='processing') AS processing,
          count(*) FILTER(WHERE status='failed') AS failed,
          COALESCE(GREATEST(0,extract(epoch FROM $1::timestamptz-min(created_at) FILTER(WHERE status IN ('pending','processing')))),0) AS oldest_age,
          ARRAY(SELECT id FROM queue WHERE status='failed' ORDER BY created_at,id LIMIT 100) AS failed_ids,
          ARRAY(SELECT id FROM queue WHERE status='failed' AND retryable ORDER BY created_at,id LIMIT 100) AS retryable_failed_ids FROM queue`,
        [now],
      );
      const row = result.rows[0];
      summaries.push({
        kind: spec.kind,
        pending: Number(row.pending),
        processing: Number(row.processing),
        failed: Number(row.failed),
        oldestPendingAgeSeconds: Number(row.oldest_age),
        failedIds: row.failed_ids,
        retryableFailedIds: row.retryable_failed_ids,
      });
    }
    return summaries;
  }
  async retryFailedProductJob(kind: ProductQueueKind, id: string, now: Date): Promise<boolean> {
    if (!this.client)
      return this.transaction("operator", (store) => store.retryFailedProductJob(kind, id, now));
    const result = await this.client.query(
      kind === "authoring"
        ? `UPDATE authoring_jobs SET status='pending',available_at=$2,last_error=NULL,updated_at=$2 WHERE id=$1 AND status='failed' AND expires_at>$2 AND applied_quiz_id IS NULL AND output IS NULL AND (source_text IS NOT NULL OR source_blob IS NOT NULL) RETURNING id`
        : kind === "round-report"
          ? `UPDATE reports job SET status='pending',available_at=$2,last_error=NULL,updated_at=$2 WHERE id=$1 AND status='failed' AND EXISTS(SELECT 1 FROM game_sessions room WHERE room.id=job.session_id AND room.deleted_at IS NULL AND room.retention_expires_at>$2) RETURNING id`
          : `UPDATE presentation_session_reports job SET status='pending',available_at=$2,lease_token=NULL,last_error=NULL,updated_at=$2 WHERE id=$1 AND status='failed' AND EXISTS(SELECT 1 FROM presentation_live_sessions room WHERE room.id=job.session_id AND room.retention_expires_at>$2) RETURNING id`,
      [id, now],
    );
    return result.rowCount === 1;
  }
  async withRoomLifecycleLock<T>(
    type: PlatformRoomType,
    room: string,
    work: (
      store: PlatformStore,
      state: { closed: boolean; hasAudience: boolean } | null,
    ) => Promise<T>,
  ): Promise<T> {
    if (!this.client)
      return this.transaction("read", (store) => store.withRoomLifecycleLock(type, room, work));
    // Match admission's parent-row lock before acquiring any organization/wallet lock.
    const table = type === "round" ? "game_sessions" : "presentation_live_sessions";
    const parent = await this.client.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [
      room,
    ]);
    if (!parent.rowCount) return work(this, null);
    // A separate statement observes current time only after waiting for the parent lock.
    const result = await this.client.query(
      type === "round"
        ? `SELECT (state='finished' OR ended_at IS NOT NULL OR deleted_at IS NOT NULL OR expires_at<=clock_timestamp()) AS closed,
            EXISTS(SELECT 1 FROM participants WHERE session_id=$1) AS has_audience FROM game_sessions WHERE id=$1`
        : `SELECT (status='finished' OR live_expires_at<=clock_timestamp()) AS closed,
            EXISTS(SELECT 1 FROM presentation_live_participants WHERE session_id=$1) AS has_audience FROM presentation_live_sessions WHERE id=$1`,
      [room],
    );
    return work(this, { closed: result.rows[0].closed, hasAudience: result.rows[0].has_audience });
  }
}
export class PostgresPlatformRepository extends PlatformService {
  constructor(repository: PostgresRepository) {
    super(new PostgresPlatformStore(repository.pool));
  }
}

/** These helpers never begin/commit independently. The calling room repository must hold
 * its workspace/room locks and include product writes in this same transaction. */
async function serviceForClient(client: PoolClient, workspaceId?: string) {
  if (workspaceId) {
    const org = await client.query("SELECT organization_id FROM workspaces WHERE id=$1", [
      workspaceId,
    ]);
    if (!org.rows[0]?.organization_id) throw new PlatformError("NOT_FOUND", "Workspace not found");
    await client.query("SELECT set_config('app.organization_id',$1,true)", [
      org.rows[0].organization_id,
    ]);
  }
  return new PlatformService(new PostgresPlatformStore(null, client));
}
export async function reserveRoomCoverageForTransaction(
  client: PoolClient,
  input: PlatformRoomCoverageInput,
) {
  return (await serviceForClient(client, input.workspaceId)).reserveRoomCoverage(input);
}
async function coverageService(client: PoolClient, type: PlatformRoomType, room: string) {
  const row = await client.query(
    "SELECT organization_id FROM platform_room_coverages WHERE id=$1",
    [`${type}:${room}`],
  );
  if (!row.rows[0]) return null;
  await client.query("SELECT set_config('app.organization_id',$1,true)", [
    row.rows[0].organization_id,
  ]);
  return serviceForClient(client);
}
export async function consumeRoomCoverageForTransaction(
  client: PoolClient,
  type: PlatformRoomType,
  room: string,
) {
  const service = await coverageService(client, type, room);
  return service ? service.consumeRoomCoverage(type, room) : null;
}
export async function releaseRoomCoverageForTransaction(
  client: PoolClient,
  type: PlatformRoomType,
  room: string,
) {
  const service = await coverageService(client, type, room);
  return service ? service.releaseRoomCoverage(type, room) : null;
}
export async function assertAudienceAdmissionForTransaction(client: PoolClient, workspace: string) {
  const service = await serviceForClient(client, workspace);
  const restriction = await service.getWorkspaceAdmissionRestriction(workspace);
  if (restriction?.blocked)
    throw new PlatformError(
      "ADMISSION_RESTRICTED",
      "Audience admission is restricted for this workspace",
    );
}
