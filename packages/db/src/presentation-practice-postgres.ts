import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import type { PostgresRepository } from "./postgres.js";
import { upcastPresentationContent } from "./artifact-schemas.js";
import type { PresentationVersionRecord } from "./presentation-types.js";
import type {
  CreatePresentationPracticeAssignmentInput,
  PresentationPracticeAssignmentRecord,
  PresentationPracticeAssignmentRepository,
  PresentationPracticeAttemptRecord,
  PresentationPracticeInsightsRecord,
  StartPresentationPracticeAttemptInput,
  MutatePresentationPracticeAttemptInput,
} from "./presentation-practice-types.js";
import {
  assertPracticeEligible,
  changePractice,
  day,
  expiry,
  fail,
  hash,
  initialAttempt,
  replayAssignment,
  validateCreate,
  type PracticeState,
} from "./presentation-practice-state.js";
function mapAssignment(r: QueryResultRow): PresentationPracticeAssignmentRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    presentationId: r.presentation_id,
    versionId: r.version_id,
    actorId: r.actor_id,
    requestId: r.request_id,
    intentHash: r.intent_hash,
    tokenHash: r.token_hash,
    createdAt: new Date(r.created_at),
    expiresAt: new Date(r.expires_at),
    revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
  };
}
function mapState(r: QueryResultRow): PracticeState {
  return {
    attempt: {
      id: r.id,
      assignmentId: r.assignment_id,
      workspaceId: r.workspace_id,
      tokenHash: r.token_hash,
      revision: Number(r.revision),
      readBlockIds: r.read_block_ids,
      answers: Object.fromEntries(
        Object.entries(
          r.answers as Record<
            string,
            { choiceId: string; correct: boolean; revision: number; submittedAt: string }
          >,
        ).map(([id, answer]) => [id, { ...answer, submittedAt: new Date(answer.submittedAt) }]),
      ),
      currentBlockId: r.current_block_id,
      startedAt: new Date(r.started_at),
      updatedAt: new Date(r.updated_at),
      completedAt: r.completed_at ? new Date(r.completed_at) : null,
    },
    readRevisions: r.read_revisions,
    receipts: {},
  };
}
function mapVersion(r: QueryResultRow): PresentationVersionRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    presentationId: r.presentation_id,
    version: r.version,
    content: upcastPresentationContent(r.content, r.content_schema_version),
    contentSchemaVersion: r.content_schema_version,
    contentHash: r.content_hash,
    sourceDraftRevision: r.source_draft_revision,
    publishedAt: new Date(r.published_at),
  };
}
export class PostgresPresentationPracticeAssignmentRepository implements PresentationPracticeAssignmentRepository {
  constructor(private parent: PostgresRepository) {}
  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.parent.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='5000ms'");
      await client.query("SELECT set_config('app.system_access','on',true)");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      if (
        e instanceof Error &&
        "code" in e &&
        e.code === "23514" &&
        e.message.includes("Practice assignment is no longer active")
      )
        fail();
      throw e;
    } finally {
      client.release();
    }
  }
  private async scope(client: PoolClient, workspaceId: string, assignmentId = "") {
    await client.query(
      "SELECT set_config('app.workspace_id',$1,true),set_config('app.presentation_practice_assignment_id',$2,true),set_config('app.system_access','',true)",
      [workspaceId, assignmentId],
    );
  }
  private async privileged<T>(client: PoolClient, work: () => Promise<T>) {
    await client.query("SELECT set_config('app.system_access','on',true)");
    try {
      return await work();
    } finally {
      await client.query("SELECT set_config('app.system_access','',true)");
    }
  }
  private async writer(client: PoolClient, workspaceId: string, actorId: string) {
    if (
      !(
        await client.query("SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL FOR SHARE", [
          actorId,
        ])
      ).rowCount
    )
      return false;
    return !!(
      await client.query(
        "SELECT member.user_id FROM workspace_members member JOIN users actor ON actor.id=member.user_id WHERE member.workspace_id=$1 AND member.user_id=$2 AND member.role IN('owner','editor') AND actor.deleted_at IS NULL FOR SHARE OF member,actor",
        [workspaceId, actorId],
      )
    ).rowCount;
  }
  private async workspace(client: PoolClient, workspaceId: string, write = false) {
    if (
      !(
        await client.query(
          `SELECT id FROM workspaces WHERE id=$1 AND deletion_started_at IS NULL FOR ${write ? "UPDATE" : "SHARE"}`,
          [workspaceId],
        )
      ).rowCount ||
      (
        await client.query("SELECT 1 FROM workspace_media_deletion_jobs WHERE workspace_id=$1", [
          workspaceId,
        ])
      ).rowCount
    )
      fail();
  }
  private async now(client: PoolClient, now: Date) {
    return new Date(
      (await client.query("SELECT greatest($1::timestamptz,clock_timestamp()) AS now", [now]))
        .rows[0].now,
    );
  }
  private async source(
    client: PoolClient,
    assignmentId: string,
    now: Date,
    tokenHash?: string,
    write = false,
  ) {
    if (!Number.isFinite(now.getTime()) || (tokenHash !== undefined && !hash.test(tokenHash)))
      fail();
    const initial = (
      await client.query(
        "SELECT * FROM presentation_practice_assignments WHERE id=$1 AND ($2::text IS NULL OR token_hash=$2)",
        [assignmentId, tokenHash ?? null],
      )
    ).rows[0];
    if (!initial) fail();
    // Account erasure takes the publisher identity before workspace/source locks.
    if (!(await this.writer(client, initial.workspace_id, initial.actor_id))) fail();
    await this.scope(client, initial.workspace_id, initial.id);
    await this.workspace(client, initial.workspace_id, write);
    const row = (
      await client.query(
        "SELECT version.* FROM presentations parent JOIN presentation_versions version ON version.workspace_id=parent.workspace_id AND version.presentation_id=parent.id WHERE parent.workspace_id=$1 AND parent.id=$2 AND version.id=$3 FOR SHARE OF parent",
        [initial.workspace_id, initial.presentation_id, initial.version_id],
      )
    ).rows[0];
    if (!row) fail();
    const current = (
      await client.query(
        `SELECT * FROM presentation_practice_assignments WHERE id=$1 FOR ${write ? "UPDATE" : "SHARE"}`,
        [assignmentId],
      )
    ).rows[0];
    const admittedAt = await this.now(client, now);
    if (
      !current ||
      current.revoked_at ||
      new Date(current.expires_at) <= admittedAt ||
      (tokenHash !== undefined && current.token_hash !== tokenHash)
    )
      fail();
    return { assignment: mapAssignment(current), version: mapVersion(row) };
  }
  async createAssignment(input: CreatePresentationPracticeAssignmentInput) {
    validateCreate(input);
    return this.transaction(async (client) => {
      if (!(await this.writer(client, input.workspaceId, input.actorId))) fail();
      await this.scope(client, input.workspaceId);
      await this.workspace(client, input.workspaceId, true);
      const previous = (
        await client.query(
          "SELECT * FROM presentation_practice_assignments WHERE workspace_id=$1 AND actor_id=$2 AND request_id=$3",
          [input.workspaceId, input.actorId, input.requestId],
        )
      ).rows[0];
      if (previous) return replayAssignment(mapAssignment(previous), input);
      const row = (
        await client.query(
          "SELECT version.* FROM presentations parent JOIN presentation_versions version ON version.workspace_id=parent.workspace_id AND version.presentation_id=parent.id WHERE parent.workspace_id=$1 AND parent.id=$2 AND version.id=$3 AND parent.status<>'archived' FOR UPDATE OF parent",
          [input.workspaceId, input.presentationId, input.versionId],
        )
      ).rows[0];
      if (!row) fail();
      const version = mapVersion(row);
      assertPracticeEligible(version);
      const expiresAt = expiry(input);
      await this.privileged(client, () =>
        client.query(
          "DELETE FROM presentation_practice_assignments WHERE workspace_id=$1 AND presentation_id=$2 AND expires_at<=$3",
          [input.workspaceId, input.presentationId, new Date(input.now.getTime() - 7 * day)],
        ),
      );
      const counts = (
        await client.query(
          "SELECT count(*)::integer AS retained,count(*) FILTER(WHERE revoked_at IS NULL AND expires_at>clock_timestamp())::integer AS active FROM presentation_practice_assignments WHERE workspace_id=$1 AND presentation_id=$2",
          [input.workspaceId, input.presentationId],
        )
      ).rows[0];
      if (counts.retained >= 50 || counts.active >= 10) fail("ASSIGNMENT_LIMIT");
      const accepted = (
        await client.query(
          "INSERT INTO presentation_practice_assignments(id,workspace_id,presentation_id,version_id,actor_id,request_id,intent_hash,token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
          [
            randomUUID(),
            input.workspaceId,
            input.presentationId,
            input.versionId,
            input.actorId,
            input.requestId,
            input.intentHash,
            input.tokenHash,
            input.now,
            expiresAt,
          ],
        )
      ).rows[0];
      return { assignment: mapAssignment(accepted), replayed: false };
    });
  }
  async listAssignments(workspaceId: string, presentationId: string, actorId: string) {
    return this.transaction(async (client) => {
      if (!(await this.writer(client, workspaceId, actorId))) fail();
      await this.scope(client, workspaceId);
      return (
        await client.query(
          "SELECT * FROM presentation_practice_assignments WHERE workspace_id=$1 AND presentation_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50",
          [workspaceId, presentationId],
        )
      ).rows.map(mapAssignment);
    });
  }
  async getPracticeInsights(
    workspaceId: string,
    presentationId: string,
    assignmentId: string,
    actorId: string,
    now: Date,
  ): Promise<PresentationPracticeInsightsRecord | null> {
    if (!Number.isFinite(now.getTime())) return null;
    try {
      return await this.transaction(async (client) => {
        if (!(await this.writer(client, workspaceId, actorId))) return null;
        await this.scope(client, workspaceId, assignmentId);
        await this.workspace(client, workspaceId);
        const initial = (
          await client.query(
            "SELECT * FROM presentation_practice_assignments WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3",
            [workspaceId, presentationId, assignmentId],
          )
        ).rows[0];
        if (!initial) return null;
        // Match the source-before-assignment lock order used by recipient reads and deletion.
        const version = (
          await client.query(
            "SELECT version.* FROM presentations parent JOIN presentation_versions version ON version.workspace_id=parent.workspace_id AND version.presentation_id=parent.id WHERE parent.workspace_id=$1 AND parent.id=$2 AND version.id=$3 FOR SHARE OF parent",
            [workspaceId, presentationId, initial.version_id],
          )
        ).rows[0];
        if (!version) return null;
        const current = (
          await client.query(
            "SELECT * FROM presentation_practice_assignments WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3 FOR SHARE",
            [workspaceId, presentationId, assignmentId],
          )
        ).rows[0];
        if (!current) return null;

        const counts = (
          await client.query(
            `WITH report_clock AS MATERIALIZED (
              SELECT greatest($3::timestamptz,clock_timestamp()) AS generated_at
            ), totals AS (
              SELECT count(*)::integer AS started,
                count(*) FILTER(WHERE completed_at IS NOT NULL)::integer AS completed
              FROM presentation_practice_attempts WHERE workspace_id=$1 AND assignment_id=$2
            )
            SELECT report_clock.generated_at,totals.started,totals.completed
            FROM report_clock CROSS JOIN totals
            WHERE $4::timestamptz+interval '7 days'>report_clock.generated_at`,
            [workspaceId, assignmentId, now, current.expires_at],
          )
        ).rows[0];
        if (!counts) return null;
        return {
          assignment: mapAssignment(current),
          generatedAt: new Date(counts.generated_at),
          started: counts.started,
          completed: counts.completed,
        };
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "UNAVAILABLE") return null;
      throw error;
    }
  }
  async revokeAssignment(
    workspaceId: string,
    presentationId: string,
    assignmentId: string,
    actorId: string,
    now: Date,
  ) {
    return this.transaction(async (client) => {
      if (!(await this.writer(client, workspaceId, actorId))) fail();
      await this.scope(client, workspaceId);
      await this.workspace(client, workspaceId, true);
      return !!(
        await client.query(
          "UPDATE presentation_practice_assignments SET revoked_at=coalesce(revoked_at,greatest($5::timestamptz,clock_timestamp())) WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3 AND $4::uuid IS NOT NULL RETURNING id",
          [workspaceId, presentationId, assignmentId, actorId, now],
        )
      ).rowCount;
    });
  }
  async getPublicAssignment(assignmentId: string, tokenHash: string, now: Date) {
    try {
      return await this.transaction((client) => this.source(client, assignmentId, now, tokenHash));
    } catch (e) {
      if (e instanceof Error && "code" in e && e.code === "UNAVAILABLE") return null;
      throw e;
    }
  }
  async getAssignmentAccess(assignmentId: string, tokenHash: string, now: Date) {
    return (await this.getPublicAssignment(assignmentId, tokenHash, now))?.assignment ?? null;
  }
  async startAttempt(input: StartPresentationPracticeAttemptInput) {
    return this.transaction(async (client) => {
      const source = await this.source(
        client,
        input.assignmentId,
        input.now,
        input.assignmentTokenHash,
        true,
      );
      if (!hash.test(input.tokenHash)) fail();
      const previous = (
        await this.privileged(client, () =>
          client.query("SELECT * FROM presentation_practice_attempts WHERE id=$1", [
            input.attemptId,
          ]),
        )
      ).rows[0];
      if (previous) {
        if (
          previous.assignment_id !== input.assignmentId ||
          previous.token_hash !== input.tokenHash
        )
          fail("IDEMPOTENCY_CONFLICT");
        return { ...source, attempt: initialAttempt(mapState(previous)), replayed: true };
      }
      const counts = (
        await this.privileged(client, () =>
          client.query(
            "SELECT count(*) FILTER(WHERE attempt.assignment_id=$1)::integer AS assignment,count(*) FILTER(WHERE parent.presentation_id=$2)::integer AS presentation,count(*)::integer AS workspace FROM presentation_practice_attempts attempt JOIN presentation_practice_assignments parent ON parent.id=attempt.assignment_id WHERE attempt.workspace_id=$3",
            [input.assignmentId, source.assignment.presentationId, source.assignment.workspaceId],
          ),
        )
      ).rows[0];
      if (counts.assignment >= 250 || counts.presentation >= 1000 || counts.workspace >= 2000)
        fail("ATTEMPT_LIMIT");
      const now = await this.now(client, input.now);
      if (source.assignment.expiresAt <= now) fail();
      const attempt = mapState(
        (
          await client.query(
            "INSERT INTO presentation_practice_attempts(id,assignment_id,workspace_id,token_hash,revision,read_block_ids,read_revisions,answers,current_block_id,started_at,updated_at,completed_at) VALUES($1,$2,$3,$4,0,'{}','{}','{}',NULL,$5,$5,NULL) RETURNING *",
            [
              input.attemptId,
              input.assignmentId,
              source.assignment.workspaceId,
              input.tokenHash,
              now,
            ],
          )
        ).rows[0],
      ).attempt;
      return { ...source, attempt, replayed: false };
    });
  }
  private async attemptSource(
    client: PoolClient,
    assignmentId: string,
    attemptId: string,
    tokenHash: string,
    now: Date,
    write = false,
  ) {
    if (!hash.test(tokenHash)) fail();
    const initial = (
      await client.query(
        "SELECT id FROM presentation_practice_attempts WHERE assignment_id=$1 AND id=$2 AND token_hash=$3",
        [assignmentId, attemptId, tokenHash],
      )
    ).rows[0];
    if (!initial) fail();
    const source = await this.source(client, assignmentId, now);
    const row = (
      await client.query(
        `SELECT * FROM presentation_practice_attempts WHERE assignment_id=$1 AND id=$2 AND token_hash=$3 FOR ${write ? "UPDATE" : "SHARE"}`,
        [assignmentId, attemptId, tokenHash],
      )
    ).rows[0];
    if (!row || source.assignment.expiresAt <= (await this.now(client, now))) fail();
    return { ...source, state: mapState(row) };
  }
  async getAttempt(assignmentId: string, attemptId: string, tokenHash: string, now: Date) {
    try {
      return await this.transaction(async (client) => {
        const { state, ...source } = await this.attemptSource(
          client,
          assignmentId,
          attemptId,
          tokenHash,
          now,
        );
        return { ...source, attempt: state.attempt };
      });
    } catch (e) {
      if (e instanceof Error && "code" in e && e.code === "UNAVAILABLE") return null;
      throw e;
    }
  }
  async mutateAttempt(input: MutatePresentationPracticeAttemptInput) {
    return this.transaction(async (client) => {
      const { state, ...source } = await this.attemptSource(
        client,
        input.assignmentId,
        input.attemptId,
        input.tokenHash,
        input.now,
        true,
      );
      const receipts = (
        await client.query(
          "SELECT request_id,request_hash,receipt FROM presentation_practice_receipts WHERE assignment_id=$1 AND attempt_id=$2",
          [input.assignmentId, input.attemptId],
        )
      ).rows;
      for (const row of receipts)
        state.receipts[row.request_id] = { requestHash: row.request_hash, ...row.receipt };
      const now = await this.now(client, input.now);
      if (source.assignment.expiresAt <= now) fail();
      const result = changePractice(state, source.version, input.mutation, now);
      if (!result.replayed) {
        const a: PresentationPracticeAttemptRecord = state.attempt;
        await client.query(
          "UPDATE presentation_practice_attempts SET revision=$3,read_block_ids=$4,read_revisions=$5,current_block_id=$6,updated_at=$7,completed_at=$8,answers=$9 WHERE assignment_id=$1 AND id=$2",
          [
            input.assignmentId,
            input.attemptId,
            a.revision,
            a.readBlockIds,
            JSON.stringify(state.readRevisions),
            a.currentBlockId,
            a.updatedAt,
            a.completedAt,
            JSON.stringify(a.answers),
          ],
        );
        const { requestHash, ...receipt } = state.receipts[input.mutation.requestId]!;
        await client.query(
          "INSERT INTO presentation_practice_receipts(workspace_id,assignment_id,attempt_id,request_id,request_hash,receipt) VALUES($1,$2,$3,$4,$5,$6)",
          [
            source.assignment.workspaceId,
            input.assignmentId,
            input.attemptId,
            input.mutation.requestId,
            requestHash,
            JSON.stringify(receipt),
          ],
        );
      }
      return { ...source, ...result };
    });
  }
}
