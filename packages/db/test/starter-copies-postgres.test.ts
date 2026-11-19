import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresRepository,
  assertRestrictedRuntimeDatabasePrincipal,
  starterCopyActorHash,
  starterCopyKey,
} from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import {
  expectStarterCopyAuthority,
  expectStarterCopyDeletion,
  expectStarterCopyRecovery,
  starterCopyFixture,
} from "./support/starter-copy-conformance.js";
import { assistanceIdentity } from "./support/presentation-assistance-conformance.js";
import { summaryMember } from "./support/session-summary-conformance.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))("Starter copy PostgreSQL receipts", () => {
  const database = `starter_copy_${randomUUID().replaceAll("-", "")}`;
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
      (await administrator.pool.query("SELECT name FROM _openround_migrations WHERE version=116"))
        .rows,
    ).toEqual([{ name: "starter_copy_receipts" }]);
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
        // Pool.end resolves after local sockets close; allow PostgreSQL to observe their
        // Terminate messages before dropping the database so cleanup cannot kill a closing client.
        for (let attempt = 0; attempt < 100; attempt++) {
          const connections = await cluster.pool.query(
            "SELECT count(*) AS count FROM pg_stat_activity WHERE datname=$1",
            [database],
          );
          if (Number(connections.rows[0].count) === 0) break;
          await delay(10);
        }
        await cluster.pool.query(`DROP DATABASE "${database}"`);
      } finally {
        await cluster.close();
      }
    }
  });
  it("serializes concurrent confirmation and recovers current content", async () => {
    await expectStarterCopyRecovery(repository);
  });
  it("isolates actors/workspaces and retains only opaque identity after actor erasure", async () => {
    const f = await expectStarterCopyAuthority(repository);
    expect(
      (
        await administrator.pool.query(
          "SELECT quiz_id FROM starter_copy_receipts WHERE workspace_id=$1 AND actor_hash=$2",
          [f.actor.workspaceId, starterCopyActorHash(f.editor.userId)],
        )
      ).rows,
    ).toEqual([{ quiz_id: f.editorQuiz.id }]);
  });
  it("retains consumed identities after archive and target deletion", async () => {
    const f = await expectStarterCopyDeletion(repository);
    expect(
      (
        await administrator.pool.query(
          "SELECT quiz_id FROM starter_copy_receipts WHERE workspace_id=$1 AND idempotency_key=$2",
          [f.actor.workspaceId, f.idempotencyKey],
        )
      ).rows,
    ).toEqual([{ quiz_id: f.quiz.id }]);
  });
  it("blocks import creation and recovery behind the deletion fence without a media job", async () => {
    const f = await starterCopyFixture(repository);
    const { quiz } = await repository.createStarterCopy(f.record(), f.identity());
    expect(await repository.claimWorkspaceMediaDeletion(f.actor.workspaceId)).toEqual([]);
    expect(
      (
        await administrator.pool.query(
          "SELECT deletion_started_at IS NOT NULL AS fenced, EXISTS(SELECT 1 FROM workspace_media_deletion_jobs WHERE workspace_id=workspaces.id) AS has_job FROM workspaces WHERE id=$1",
          [f.actor.workspaceId],
        )
      ).rows,
    ).toEqual([{ fenced: true, has_job: false }]);
    await expect(repository.getStarterCopy(f.identity())).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    for (const identity of [f.identity(), { ...f.identity(), idempotencyKey: randomUUID() }]) {
      await expect(repository.createStarterCopy(f.record(), identity)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    }
    expect(await repository.listQuizzes(f.actor.workspaceId)).toMatchObject([{ id: quiz.id }]);
    expect(await repository.listQuizDraftHistory(f.actor.workspaceId, quiz.id, 20)).toHaveLength(1);
    expect(
      (
        await administrator.pool.query(
          "SELECT quiz_id FROM starter_copy_receipts WHERE workspace_id=$1",
          [f.actor.workspaceId],
        )
      ).rows,
    ).toEqual([{ quiz_id: quiz.id }]);
  });
  it("enforces RLS, append-only receipts, finite time, compact storage and workspace erasure", async () => {
    expect(
      (
        await administrator.pool.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='starter_copy_receipts'",
        )
      ).rows,
    ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    expect(
      (
        await administrator.pool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='starter_copy_receipts' ORDER BY ordinal_position",
        )
      ).rows.map((row) => row.column_name),
    ).toEqual([
      "workspace_id",
      "actor_hash",
      "idempotency_key",
      "request_hash",
      "quiz_id",
      "created_at",
      "expires_at",
    ]);
    const f = await starterCopyFixture(repository);
    await repository.createStarterCopy(f.record(), f.identity());
    const client = await repository.pool.connect();
    try {
      expect(
        (
          await client.query("SELECT quiz_id FROM starter_copy_receipts WHERE idempotency_key=$1", [
            f.idempotencyKey,
          ])
        ).rows,
      ).toEqual([]);
      for (const statement of [
        "DELETE FROM starter_copy_receipts WHERE idempotency_key=$1",
        "UPDATE starter_copy_receipts SET request_hash=repeat('b',64) WHERE idempotency_key=$1",
      ]) {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.workspace_id',$1,true)", [f.actor.workspaceId]);
        expect(
          (
            await client.query(
              "SELECT quiz_id FROM starter_copy_receipts WHERE idempotency_key=$1",
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
          "INSERT INTO starter_copy_receipts(workspace_id,actor_hash,idempotency_key,request_hash,quiz_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5,'infinity',now()+interval '1 day')",
          [
            f.actor.workspaceId,
            starterCopyActorHash(f.actor.userId),
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
          "SELECT quiz_id FROM starter_copy_receipts WHERE workspace_id=$1",
          [f.actor.workspaceId],
        )
      ).rows,
    ).toEqual([]);
  });
  it("checks fresh intent expiry while retaining committed identities", async () => {
    const f = await starterCopyFixture(repository);
    await expect(
      repository.createStarterCopy(f.record(), { ...f.identity(), expiresAt: new Date(0) }),
    ).rejects.toMatchObject({ code: "STARTER_COPY_EXPIRED" });
    expect(await repository.getStarterCopy(f.identity())).toBeNull();
    const accepted = await repository.createStarterCopy(f.record(), f.identity());
    expect(
      await repository.createStarterCopy(f.record(), { ...f.identity(), expiresAt: new Date(0) }),
    ).toMatchObject({ status: "duplicate", quiz: { id: accepted.quiz.id } });
  });
  it("waits for an in-flight copy before resolving the original target", async () => {
    const f = await starterCopyFixture(repository);
    const blocker = await administrator.pool.connect();
    let creation: ReturnType<typeof repository.createStarterCopy> | undefined;
    let recovery: ReturnType<typeof repository.getStarterCopy> | undefined;
    const key = `starter-copy:${starterCopyKey(f.identity())}`;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
      creation = repository.createStarterCopy(f.record(), f.identity());
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting =
          Number(
            (
              await administrator.pool.query(
                "SELECT count(*) AS count FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'",
                [database],
              )
            ).rows[0].count,
          ) >= 1;
        if (!waiting) await delay(10);
      }
      expect(waiting).toBe(true);
      recovery = repository.getStarterCopy(f.identity());
      for (let attempt = 0; attempt < 100; attempt++) {
        const count = Number(
          (
            await administrator.pool.query(
              "SELECT count(*) AS count FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'",
              [database],
            )
          ).rows[0].count,
        );
        if (count >= 2) break;
        if (attempt === 99) throw new Error("Recovery did not wait for the copy lock");
        await delay(10);
      }
      await blocker.query("COMMIT");
      const accepted = await creation;
      expect(await recovery).toMatchObject({ id: accepted.quiz.id });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await creation?.catch(() => undefined);
      await recovery?.catch(() => undefined);
    }
  });
  it("rechecks fresh intent expiry after waiting for the identity lock", async () => {
    const f = await starterCopyFixture(repository);
    const identity = { ...f.identity(), expiresAt: new Date(Date.now() + 300) };
    const blocker = await administrator.pool.connect();
    let creation: ReturnType<typeof repository.createStarterCopy> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `starter-copy:${starterCopyKey(identity)}`,
      ]);
      creation = repository.createStarterCopy(f.record(), identity);
      const rejected = expect(creation).rejects.toMatchObject({ code: "STARTER_COPY_EXPIRED" });
      await delay(Math.max(0, identity.expiresAt.getTime() - Date.now() + 10));
      await blocker.query("COMMIT");
      await rejected;
      expect(await repository.getStarterCopy(identity)).toBeNull();
      expect(await repository.listQuizzes(f.actor.workspaceId)).toEqual([]);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await creation?.catch(() => undefined);
    }
  });
  it("rolls back parent/history/receipt together after a history failure", async () => {
    const f = await starterCopyFixture(repository),
      record = f.record();
    record.title = record.draft.title = "STARTER_COPY_ROLLBACK_PROBE";
    await administrator.pool.query(
      "CREATE FUNCTION reject_starter_copy_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'import history probe failure'; END $$",
    );
    try {
      await administrator.pool.query(
        "CREATE TRIGGER reject_starter_copy_probe BEFORE INSERT ON quiz_draft_history FOR EACH ROW WHEN (NEW.draft->>'title'='STARTER_COPY_ROLLBACK_PROBE') EXECUTE FUNCTION reject_starter_copy_probe()",
      );
      await expect(repository.createStarterCopy(record, f.identity())).rejects.toThrow(
        "import history probe failure",
      );
      expect(await repository.listQuizzes(f.actor.workspaceId)).toEqual([]);
      expect(await repository.getStarterCopy(f.identity())).toBeNull();
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
        "DROP TRIGGER IF EXISTS reject_starter_copy_probe ON quiz_draft_history",
      );
      await administrator.pool.query("DROP FUNCTION reject_starter_copy_probe()");
    }
    expect((await repository.createStarterCopy(record, f.identity())).status).toBe("created");
  });
  it("rechecks creator authority inside the creation transaction", async () => {
    const f = await starterCopyFixture(repository),
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
      pending = repository.createStarterCopy(f.record(editor), f.identity(editor));
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
  it("rolls back parent and history if the final receipt insert fails", async () => {
    const f = await starterCopyFixture(repository);
    const identity = { ...f.identity(), requestHash: "e".repeat(64) };
    await administrator.pool.query(
      "CREATE FUNCTION reject_starter_receipt_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'starter receipt probe failure'; END $$",
    );
    try {
      await administrator.pool.query(
        "CREATE TRIGGER reject_starter_receipt_probe BEFORE INSERT ON starter_copy_receipts FOR EACH ROW WHEN (NEW.request_hash=repeat('e',64)) EXECUTE FUNCTION reject_starter_receipt_probe()",
      );
      await expect(repository.createStarterCopy(f.record(), identity)).rejects.toThrow(
        "starter receipt probe failure",
      );
      expect(await repository.listQuizzes(f.actor.workspaceId)).toEqual([]);
      expect(await repository.getStarterCopy(identity)).toBeNull();
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
        "DROP TRIGGER IF EXISTS reject_starter_receipt_probe ON starter_copy_receipts",
      );
      await administrator.pool.query("DROP FUNCTION reject_starter_receipt_probe()");
    }
    expect((await repository.createStarterCopy(f.record(), identity)).status).toBe("created");
  });
});
