import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresRepository,
  assertRestrictedRuntimeDatabasePrincipal,
  roundImportActorHash,
} from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import {
  expectRoundImportAuthority,
  expectRoundImportDeletion,
  expectRoundImportRecovery,
  roundImportFixture,
} from "./support/round-import-conformance.js";
import { assistanceIdentity } from "./support/presentation-assistance-conformance.js";
import { summaryMember } from "./support/session-summary-conformance.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))("Round import PostgreSQL receipts", () => {
  const database = `round_import_${randomUUID().replaceAll("-", "")}`;
  let created = false,
    repository: PostgresRepository,
    administrator: PostgresRepository;
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
    administrator = new PostgresRepository(admin.toString());
    await administrator.migrate();
    await administrator.migrate();
    expect(
      (await administrator.pool.query("SELECT name FROM _openround_migrations WHERE version=115"))
        .rows,
    ).toEqual([{ name: "round_import_receipts" }]);
    repository = new PostgresRepository(runtime.toString());
    await repository.initialize();
    expect(
      assertRestrictedRuntimeDatabasePrincipal(await repository.inspectRuntimeDatabasePrincipal()),
    ).toMatchObject({
      superuser: false,
      bypassRls: false,
      createRole: false,
      createDatabase: false,
    });
  }, 60_000);
  afterAll(async () => {
    await repository?.close();
    await administrator?.close();
    if (created) {
      const cluster = new PostgresRepository(adminUrl!);
      try {
        await cluster.pool.query(`DROP DATABASE "${database}" WITH(FORCE)`);
      } finally {
        await cluster.close();
      }
    }
  });
  it("serializes concurrent confirmation and recovers current content", async () => {
    await expectRoundImportRecovery(repository);
  });
  it("isolates actors/workspaces and retains only opaque identity after actor erasure", async () => {
    const f = await expectRoundImportAuthority(repository);
    expect(
      (
        await administrator.pool.query(
          "SELECT quiz_id FROM round_import_receipts WHERE workspace_id=$1 AND actor_hash=$2",
          [f.actor.workspaceId, roundImportActorHash(f.editor.userId)],
        )
      ).rows,
    ).toEqual([{ quiz_id: f.editorQuiz.id }]);
  });
  it("retains consumed identities after archive and target deletion", async () => {
    const f = await expectRoundImportDeletion(repository);
    expect(
      (
        await administrator.pool.query(
          "SELECT quiz_id FROM round_import_receipts WHERE workspace_id=$1 AND idempotency_key=$2",
          [f.actor.workspaceId, f.idempotencyKey],
        )
      ).rows,
    ).toEqual([{ quiz_id: f.quiz.id }]);
  });
  it("blocks import creation and recovery behind the deletion fence without a media job", async () => {
    const f = await roundImportFixture(repository);
    const { quiz } = await repository.createImportedQuiz(f.record(), f.identity());
    expect(await repository.claimWorkspaceMediaDeletion(f.actor.workspaceId)).toEqual([]);
    expect(
      (
        await administrator.pool.query(
          "SELECT deletion_started_at IS NOT NULL AS fenced, EXISTS(SELECT 1 FROM workspace_media_deletion_jobs WHERE workspace_id=workspaces.id) AS has_job FROM workspaces WHERE id=$1",
          [f.actor.workspaceId],
        )
      ).rows,
    ).toEqual([{ fenced: true, has_job: false }]);
    await expect(repository.getImportedQuiz(f.identity())).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    for (const identity of [f.identity(), { ...f.identity(), idempotencyKey: randomUUID() }]) {
      await expect(repository.createImportedQuiz(f.record(), identity)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    }
    expect(await repository.listQuizzes(f.actor.workspaceId)).toMatchObject([{ id: quiz.id }]);
    expect(await repository.listQuizDraftHistory(f.actor.workspaceId, quiz.id, 20)).toHaveLength(1);
    expect(
      (
        await administrator.pool.query(
          "SELECT quiz_id FROM round_import_receipts WHERE workspace_id=$1",
          [f.actor.workspaceId],
        )
      ).rows,
    ).toEqual([{ quiz_id: quiz.id }]);
  });
  it("enforces RLS, append-only receipts, finite time, compact storage and workspace erasure", async () => {
    expect(
      (
        await administrator.pool.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='round_import_receipts'",
        )
      ).rows,
    ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    expect(
      (
        await administrator.pool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='round_import_receipts' ORDER BY ordinal_position",
        )
      ).rows.map((row) => row.column_name),
    ).toEqual([
      "workspace_id",
      "actor_hash",
      "idempotency_key",
      "request_hash",
      "quiz_id",
      "created_at",
    ]);
    const f = await roundImportFixture(repository);
    await repository.createImportedQuiz(f.record(), f.identity());
    const client = await repository.pool.connect();
    try {
      expect(
        (
          await client.query("SELECT quiz_id FROM round_import_receipts WHERE idempotency_key=$1", [
            f.idempotencyKey,
          ])
        ).rows,
      ).toEqual([]);
      for (const statement of [
        "DELETE FROM round_import_receipts WHERE idempotency_key=$1",
        "UPDATE round_import_receipts SET request_hash=repeat('b',64) WHERE idempotency_key=$1",
      ]) {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.workspace_id',$1,true)", [f.actor.workspaceId]);
        expect(
          (
            await client.query(
              "SELECT quiz_id FROM round_import_receipts WHERE idempotency_key=$1",
              [f.idempotencyKey],
            )
          ).rows,
        ).toHaveLength(1);
        await expect(client.query(statement, [f.idempotencyKey])).rejects.toMatchObject({
          code: "23514",
        });
        await client.query("ROLLBACK");
      }
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [f.actor.workspaceId]);
      await expect(
        client.query(
          "INSERT INTO round_import_receipts(workspace_id,actor_hash,idempotency_key,request_hash,quiz_id,created_at) VALUES($1,$2,$3,$4,$5,'infinity')",
          [
            f.actor.workspaceId,
            roundImportActorHash(f.actor.userId),
            randomUUID(),
            "a".repeat(64),
            randomUUID(),
          ],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    await repository.deleteAccount(f.actor.userId);
    expect(
      (
        await administrator.pool.query(
          "SELECT quiz_id FROM round_import_receipts WHERE workspace_id=$1",
          [f.actor.workspaceId],
        )
      ).rows,
    ).toEqual([]);
  });
  it("rolls back parent/history/receipt together after a history failure", async () => {
    const f = await roundImportFixture(repository),
      record = f.record();
    record.title = record.draft.title = "ROUND_IMPORT_ROLLBACK_PROBE";
    await administrator.pool.query(
      "CREATE FUNCTION reject_round_import_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'import history probe failure'; END $$",
    );
    try {
      await administrator.pool.query(
        "CREATE TRIGGER reject_round_import_probe BEFORE INSERT ON quiz_draft_history FOR EACH ROW WHEN (NEW.draft->>'title'='ROUND_IMPORT_ROLLBACK_PROBE') EXECUTE FUNCTION reject_round_import_probe()",
      );
      await expect(repository.createImportedQuiz(record, f.identity())).rejects.toThrow(
        "import history probe failure",
      );
      expect(await repository.listQuizzes(f.actor.workspaceId)).toEqual([]);
      expect(await repository.getImportedQuiz(f.identity())).toBeNull();
      expect(
        (
          await administrator.pool.query(
            "SELECT id FROM quiz_draft_history WHERE workspace_id=$1",
            [f.actor.workspaceId],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await administrator.pool.query(
        "DROP TRIGGER IF EXISTS reject_round_import_probe ON quiz_draft_history",
      );
      await administrator.pool.query("DROP FUNCTION reject_round_import_probe()");
    }
    expect((await repository.createImportedQuiz(record, f.identity())).status).toBe("created");
  });
  it("rechecks creator authority inside the creation transaction", async () => {
    const f = await roundImportFixture(repository),
      member = await assistanceIdentity(repository);
    await summaryMember(repository, f.actor, member, "editor");
    const editor = { ...member, workspaceId: f.actor.workspaceId, role: "editor" as const };
    const blocker = await administrator.pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT user_id FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE",
        [editor.workspaceId, editor.userId],
      );
      pending = repository.createImportedQuiz(f.record(editor), f.identity(editor));
      const rejected = expect(pending).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      let waiting = false;
      for (let index = 0; index < 100 && !waiting; index++) {
        waiting =
          Number(
            (
              await administrator.pool.query(
                "SELECT count(*) AS count FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE '%workspace_members%'",
                [database],
              )
            ).rows[0].count,
          ) > 0;
        if (!waiting) await delay(10);
      }
      expect(waiting).toBe(true);
      await blocker.query(
        "UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
        [editor.workspaceId, editor.userId],
      );
      await blocker.query("COMMIT");
      await rejected;
      expect(await repository.listQuizzes(f.actor.workspaceId)).toEqual([]);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await pending?.catch(() => undefined);
    }
  });
});
