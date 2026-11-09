import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresRepository, createPresentationAssignmentRepository } from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import {
  expectReadingConformance,
  expectReadingLifecycle,
  expectReadingReportConformance,
  readingAssignmentFixture,
} from "./support/presentation-assignments-conformance.js";
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))("Presentation reading PostgreSQL", () => {
  const database = `presentation_reading_${randomUUID().replaceAll("-", "")}`;
  let repository: PostgresRepository,
    administrator: PostgresRepository,
    created = false,
    runtimeDatabaseUrl: string;
  beforeAll(async () => {
    await preparePostgresTestRuntime(adminUrl!, runtimeUrl!);
    const cluster = new PostgresRepository(adminUrl!);
    try {
      await cluster.pool.query(`CREATE DATABASE "${database}"`);
      created = true;
    } finally {
      await cluster.close();
    }
    const admin = new URL(adminUrl!),
      runtime = new URL(runtimeUrl!);
    admin.pathname = runtime.pathname = `/${database}`;
    runtimeDatabaseUrl = runtime.toString();
    administrator = new PostgresRepository(admin.toString());
    await administrator.migrate();
    await administrator.migrate();
    repository = new PostgresRepository(runtimeDatabaseUrl);
    await repository.initialize();
  });
  afterAll(async () => {
    await repository?.close();
    await administrator?.close();
    if (created) {
      const cluster = new PostgresRepository(adminUrl!);
      try {
        for (let i = 0; i < 100; i++) {
          if (
            !(
              await cluster.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1", [
                database,
              ])
            ).rowCount
          )
            break;
          await delay(10);
        }
        await cluster.pool.query(`DROP DATABASE "${database}"`);
      } finally {
        await cluster.close();
      }
    }
  });
  it("persists exact resumable reading and concurrent CAS through a new repository", async () => {
    await expectReadingConformance(repository);
    const f = await readingAssignmentFixture(repository);
    await f.assignments.startAttempt(f.start);
    const first = {
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "read" as const,
      blockId: f.content.blocks[0]!.id,
    };
    const accepted = await f.write(first);
    await f.write({
      requestId: randomUUID(),
      expectedRevision: 1,
      kind: "read",
      blockId: f.content.blocks[1]!.id,
    });
    const completed = await f.write({
      requestId: randomUUID(),
      expectedRevision: 2,
      kind: "complete",
    });
    const reopened = new PostgresRepository(runtimeDatabaseUrl),
      fresh = createPresentationAssignmentRepository(reopened);
    try {
      expect(
        (await fresh.getAttempt(f.assignment.id, f.start.attemptId, f.start.tokenHash, f.now))!
          .attempt,
      ).toEqual(completed.attempt);
      expect((await fresh.mutateAttempt({ ...f.start, mutation: first })).attempt).toEqual(
        accepted.attempt,
      );
      expect(
        (await fresh.getAttempt(f.assignment.id, f.start.attemptId, f.start.tokenHash, f.now))!
          .attempt,
      ).toEqual(completed.attempt);
    } finally {
      await reopened.close();
    }
  });
  it("exports no credentials and cascades account erasure through anonymous attempts", async () => {
    const f = await expectReadingLifecycle(repository);
    expect(
      (
        await administrator.pool.query(
          "SELECT count(*)::integer AS count FROM presentation_reading_attempts WHERE assignment_id=$1",
          [f.assignment.id],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("reports counts under restricted assignment RLS with creator and retention fences", async () => {
    await expectReadingReportConformance(repository, async (actor, check) => {
      await administrator.pool.query(
        "UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
        [actor.workspaceId, actor.userId],
      );
      try {
        await check();
      } finally {
        await administrator.pool.query(
          "UPDATE workspace_members SET role='owner' WHERE workspace_id=$1 AND user_id=$2",
          [actor.workspaceId, actor.userId],
        );
      }
    });
  });
  it("rechecks the report retention deadline after waiting for an assignment lock", async () => {
    const f = await readingAssignmentFixture(repository),
      blocker = await administrator.pool.connect();
    try {
      // Age a valid retained fixture without changing the immutable production write path.
      await blocker.query("BEGIN");
      await blocker.query("SET LOCAL session_replication_role='replica'");
      const aged = (
        await blocker.query(
          "UPDATE presentation_assignments SET created_at=clock_timestamp()-interval '8 days',expires_at=clock_timestamp()-interval '7 days'+interval '650 milliseconds' WHERE id=$1 RETURNING expires_at+interval '7 days' AS retention_end",
          [f.assignment.id],
        )
      ).rows[0];
      await blocker.query("COMMIT");
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM presentation_assignments WHERE id=$1 FOR UPDATE", [
        f.assignment.id,
      ]);
      const pending = f.assignments.getReadingReport(
        f.actor.workspaceId,
        f.presentation.id,
        f.assignment.id,
        f.actor.userId,
        new Date(),
      );
      await delay(Math.max(0, new Date(aged.retention_end).getTime() - Date.now() + 20));
      await blocker.query("COMMIT");
      expect(await pending).toBeNull();
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
  it("forces assignment scoped RLS and rejects raw source, page, revision and receipt changes", async () => {
    const f = await readingAssignmentFixture(repository);
    await f.assignments.startAttempt(f.start);
    await f.write({
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "read",
      blockId: f.content.blocks[0]!.id,
    });
    const tables = [
      "presentation_assignments",
      "presentation_reading_attempts",
      "presentation_reading_receipts",
    ];
    expect(
      (
        await administrator.pool.query(
          "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[]) ORDER BY relname",
          [tables],
        )
      ).rows,
    ).toEqual(
      tables
        .sort()
        .map((relname) => ({ relname, relrowsecurity: true, relforcerowsecurity: true })),
    );
    expect(
      (
        await repository.pool.query(
          "SELECT count(*)::integer AS count FROM presentation_reading_attempts",
        )
      ).rows[0].count,
    ).toBe(0);
    const client = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.workspace_id',$1,true),set_config('app.presentation_assignment_id',$2,true)",
        [f.actor.workspaceId, randomUUID()],
      );
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM presentation_reading_attempts"))
          .rows[0].count,
      ).toBe(0);
      await client.query("SELECT set_config('app.presentation_assignment_id',$1,true)", [
        f.assignment.id,
      ]);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM presentation_reading_attempts"))
          .rows[0].count,
      ).toBe(1);
      const reject = async (sql: string, values: unknown[], code = "23514") => {
        await client.query("SAVEPOINT bad_reading");
        try {
          await expect(client.query(sql, values)).rejects.toMatchObject({ code });
        } finally {
          await client.query("ROLLBACK TO SAVEPOINT bad_reading");
        }
      };
      await reject(
        "UPDATE presentation_assignments SET version_id=$2 WHERE id=$1",
        [f.assignment.id, randomUUID()],
        "42501",
      );
      await reject("UPDATE presentation_reading_attempts SET revision=revision-1 WHERE id=$1", [
        f.start.attemptId,
      ]);
      await reject(
        "UPDATE presentation_reading_attempts SET token_hash=repeat('a',64),revision=revision+1 WHERE id=$1",
        [f.start.attemptId],
      );
      await reject(
        "UPDATE presentation_reading_attempts SET read_block_ids=ARRAY[$2::uuid],read_revisions=jsonb_build_object($2::text,2),revision=revision+1,current_block_id=$2 WHERE id=$1",
        [f.start.attemptId, randomUUID()],
      );
      await reject(
        "UPDATE presentation_reading_attempts SET completed_at=updated_at,revision=revision+1 WHERE id=$1",
        [f.start.attemptId],
      );
      await reject(
        "UPDATE presentation_reading_receipts SET request_hash=repeat('a',64) WHERE attempt_id=$1",
        [f.start.attemptId],
        "42501",
      );
      for (const table of tables)
        await reject(
          `DELETE FROM ${table} WHERE ${table === "presentation_assignments" ? "id" : "assignment_id"}=$1`,
          [f.assignment.id],
        );
      await client.query("ROLLBACK");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    await administrator.pool.query("UPDATE users SET deleted_at=clock_timestamp() WHERE id=$1", [
      f.actor.userId,
    ]);
    expect(
      (
        await administrator.pool.query(
          "SELECT count(*)::integer AS count FROM presentation_assignments WHERE id=$1",
          [f.assignment.id],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("rechecks real deadlines after waiting for source locks, including exact receipt replay", async () => {
    const f = await readingAssignmentFixture(repository);
    for (const mode of ["read", "start", "progress"] as const) {
      const now = new Date(),
        input = { ...f.request(), now, expiresAt: new Date(now.getTime() + 650).toISOString() },
        assignment = (await f.assignments.createAssignment(input)).assignment,
        start = {
          ...f.start,
          assignmentId: assignment.id,
          assignmentTokenHash: input.tokenHash,
          attemptId: randomUUID(),
          now,
        };
      await f.assignments.startAttempt(start);
      const mutation = {
        requestId: randomUUID(),
        expectedRevision: 0,
        kind: "read" as const,
        blockId: f.content.blocks[0]!.id,
      };
      await f.assignments.mutateAttempt({ ...start, mutation });
      const blocker = await administrator.pool.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM presentation_assignments WHERE id=$1 FOR UPDATE", [
          assignment.id,
        ]);
        const action =
          mode === "read"
            ? f.assignments.getAttempt(assignment.id, start.attemptId, start.tokenHash, now)
            : mode === "start"
              ? f.assignments.startAttempt(start)
              : f.assignments.mutateAttempt({ ...start, mutation });
        const pending = action.then(
          (value) => ({ value, error: null }),
          (error) => ({ value: null, error }),
        );
        await delay(Math.max(0, assignment.expiresAt.getTime() - Date.now() + 20));
        await blocker.query("COMMIT");
        const result = await pending;
        if (mode === "read") expect(result.value).toBeNull();
        else expect(result.error).toMatchObject({ code: "UNAVAILABLE" });
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
    }
  });
  it("continues existing reading after archive, denies new assignments and cascades permanent source deletion", async () => {
    const f = await readingAssignmentFixture(repository);
    await f.presentations.archivePresentation(f.actor.workspaceId, f.presentation.id, true);
    await expect(f.assignments.createAssignment(f.request())).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    await f.assignments.startAttempt(f.start);
    const read = await f.write({
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "read",
      blockId: f.content.blocks[0]!.id,
    });
    expect(read.attempt.revision).toBe(1);
    expect(
      await f.assignments.getPublicAssignment(f.assignment.id, f.input.tokenHash, f.now),
    ).not.toBeNull();
    expect(await f.presentations.deletePresentation(f.actor.workspaceId, f.presentation.id)).toBe(
      "deleted",
    );
    expect(
      await f.assignments.getAttempt(f.assignment.id, f.start.attemptId, f.start.tokenHash, f.now),
    ).toBeNull();
    for (const table of [
      "presentation_assignments",
      "presentation_reading_attempts",
      "presentation_reading_receipts",
    ])
      expect(
        (
          await administrator.pool.query(
            `SELECT count(*)::integer AS count FROM ${table} WHERE ${table === "presentation_assignments" ? "id" : "assignment_id"}=$1`,
            [f.assignment.id],
          )
        ).rows[0].count,
      ).toBe(0);
  });
  it("admits the last anonymous attempt once across concurrent starts and preserves accepted retries at capacity", async () => {
    const f = await readingAssignmentFixture(repository);
    await administrator.pool.query(
      "INSERT INTO presentation_reading_attempts(id,workspace_id,assignment_id,token_hash,revision,read_block_ids,read_revisions,started_at,updated_at) SELECT gen_random_uuid(),$1,$2,repeat('c',64),0,'{}','{}',statement_timestamp(),statement_timestamp() FROM generate_series(1,999)",
      [f.actor.workspaceId, f.assignment.id],
    );
    const starts = [
        { ...f.start, attemptId: randomUUID() },
        { ...f.start, attemptId: randomUUID() },
      ],
      results = await Promise.allSettled(starts.map((input) => f.assignments.startAttempt(input)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "ATTEMPT_LIMIT" },
    });
    const accepted = starts[results.findIndex((r) => r.status === "fulfilled")]!;
    expect((await f.assignments.startAttempt(accepted)).replayed).toBe(true);
  });
});
