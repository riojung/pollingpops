import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresRepository, assertRestrictedRuntimeDatabasePrincipal } from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import {
  expectPresentationCreationRecovery,
  expectPresentationCreationAuthority,
  expectPresentationCreationDeletion,
  presentationCreationFixture,
} from "./support/presentation-creation-conformance.js";
import { assistanceIdentity } from "./support/presentation-assistance-conformance.js";
import { summaryMember } from "./support/session-summary-conformance.js";
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))("Presentation creation PostgreSQL", () => {
  const database = `presentation_creation_${randomUUID().replaceAll("-", "")}`;
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
      (await administrator.pool.query("SELECT name FROM _openround_migrations WHERE version=101"))
        .rows,
    ).toEqual([{ name: "presentation_creation_receipts" }]);
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
  it("serializes concurrent creation and recovers current edits/publication without allowance use", async () => {
    const f = await expectPresentationCreationRecovery(repository);
    const rows = (
      await administrator.pool.query(
        "SELECT request_id,presentation_id,intent_hash FROM presentation_creation_receipts WHERE workspace_id=$1",
        [f.actor.workspaceId],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.request_id === f.creationRequestId)).toMatchObject({
      presentation_id: f.presentation.id,
      intent_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
  it("binds current author/workspace and keeps receipts after account erasure", async () => {
    const f = await expectPresentationCreationAuthority(repository);
    expect(
      (
        await administrator.pool.query(
          "SELECT request_id FROM presentation_creation_receipts WHERE request_id=$1",
          [f.editorIntent.creationRequestId],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("retains erased-target request identity without recreating a deck or history", async () => {
    const f = await expectPresentationCreationDeletion(repository);
    expect(
      (
        await administrator.pool.query(
          "SELECT presentation_id FROM presentation_creation_receipts WHERE request_id=$1",
          [f.creationRequestId],
        )
      ).rows,
    ).toEqual([{ presentation_id: f.presentation.id }]);
    const client = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [f.actor.workspaceId]);
      await expect(
        client.query("DELETE FROM presentation_creation_receipts WHERE request_id=$1", [
          f.creationRequestId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it("keeps compact receipts forced-RLS protected, immutable to runtime and finite", async () => {
    expect(
      (
        await administrator.pool.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='presentation_creation_receipts'",
        )
      ).rows,
    ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    expect(
      (
        await administrator.pool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='presentation_creation_receipts' ORDER BY ordinal_position",
        )
      ).rows.map((row) => row.column_name),
    ).toEqual(["request_id", "workspace_id", "presentation_id", "intent_hash", "created_at"]);
    const f = await presentationCreationFixture(repository);
    await f.presentations.createPresentationIdempotently(f.record(), f.intent());
    const client = await repository.pool.connect();
    try {
      expect(
        (
          await client.query(
            "SELECT request_id FROM presentation_creation_receipts WHERE request_id=$1",
            [f.creationRequestId],
          )
        ).rows,
      ).toEqual([]);
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [f.actor.workspaceId]);
      expect(
        (
          await client.query(
            "SELECT request_id FROM presentation_creation_receipts WHERE request_id=$1",
            [f.creationRequestId],
          )
        ).rows,
      ).toHaveLength(1);
      await expect(
        client.query("DELETE FROM presentation_creation_receipts WHERE request_id=$1", [
          f.creationRequestId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [f.actor.workspaceId]);
      await expect(
        client.query(
          "UPDATE presentation_creation_receipts SET intent_hash=$2 WHERE request_id=$1",
          [f.creationRequestId, "b".repeat(64)],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [f.actor.workspaceId]);
      await expect(
        client.query(
          "INSERT INTO presentation_creation_receipts(request_id,workspace_id,presentation_id,intent_hash,created_at) VALUES($1,$2,$3,$4,'infinity')",
          [randomUUID(), f.actor.workspaceId, randomUUID(), "a".repeat(64)],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    // Whole-workspace erasure remains the only permitted removal of compact identities.
    await repository.deleteAccount(f.actor.userId);
    expect(
      (
        await administrator.pool.query("SELECT id FROM workspaces WHERE id=$1", [
          f.actor.workspaceId,
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (
        await administrator.pool.query(
          "SELECT request_id FROM presentation_creation_receipts WHERE request_id=$1",
          [f.creationRequestId],
        )
      ).rows,
    ).toEqual([]);
  });
  it("rolls back deck and creation receipt when initial history cannot be saved", async () => {
    const f = await presentationCreationFixture(repository),
      input = f.record();
    input.title = input.draft.title = "CREATION_ROLLBACK_PROBE";
    await administrator.pool.query(
      "CREATE FUNCTION reject_creation_history_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'creation history probe failure'; END $$",
    );
    try {
      await administrator.pool.query(
        "CREATE TRIGGER reject_creation_history_probe BEFORE INSERT ON presentation_draft_history FOR EACH ROW WHEN (NEW.draft->>'title'='CREATION_ROLLBACK_PROBE') EXECUTE FUNCTION reject_creation_history_probe()",
      );
      await expect(
        f.presentations.createPresentationIdempotently(input, f.intent()),
      ).rejects.toThrow("creation history probe failure");
      expect(
        (
          await administrator.pool.query("SELECT id FROM presentations WHERE workspace_id=$1", [
            f.actor.workspaceId,
          ])
        ).rows,
      ).toEqual([]);
      expect(
        (
          await administrator.pool.query(
            "SELECT request_id FROM presentation_creation_receipts WHERE request_id=$1",
            [f.creationRequestId],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await administrator.pool.query(
        "DROP TRIGGER IF EXISTS reject_creation_history_probe ON presentation_draft_history",
      );
      await administrator.pool.query("DROP FUNCTION reject_creation_history_probe()");
    }
    expect((await f.presentations.createPresentationIdempotently(input, f.intent())).status).toBe(
      "created",
    );
  });
  it("rechecks editor authority while holding the creation transaction", async () => {
    const f = await presentationCreationFixture(repository),
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
      pending = f.presentations.createPresentationIdempotently(f.record(editor), f.intent(editor));
      // Attach rejection handling before releasing the deliberately blocked membership row.
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
      expect(await f.presentations.listPresentations(f.actor.workspaceId)).toEqual([]);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await pending?.catch(() => undefined);
    }
  });
});
