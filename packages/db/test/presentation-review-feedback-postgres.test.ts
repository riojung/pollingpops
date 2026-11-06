import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresRepository,
  assertRestrictedRuntimeDatabasePrincipal,
  createPresentationReviewFeedbackRepository,
} from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import {
  expectReviewFeedbackConformance,
  expectReviewEnableOnceConformance,
  expectReviewFeedbackErasure,
  expectReviewFeedbackRevokedExport,
  reviewFeedbackFixture,
} from "./support/presentation-review-feedback-conformance.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))("Presentation review feedback PostgreSQL", () => {
  const database = `presentation_review_${randomUUID().replaceAll("-", "")}`;
  let created = false,
    repository: PostgresRepository,
    administrator: PostgresRepository,
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
    expect(
      (await administrator.pool.query("SELECT name FROM _openround_migrations WHERE version=99"))
        .rows,
    ).toEqual([{ name: "presentation_review_feedback" }]);
    repository = new PostgresRepository(runtimeDatabaseUrl);
    await repository.initialize();
    expect(
      assertRestrictedRuntimeDatabasePrincipal(await repository.inspectRuntimeDatabasePrincipal()),
    ).toMatchObject({
      superuser: false,
      bypassRls: false,
      createRole: false,
      createDatabase: false,
    });
    expect(
      (
        await administrator.pool.query(
          "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[]) ORDER BY relname",
          [
            [
              "presentation_review_cycles",
              "presentation_review_threads",
              "presentation_review_messages",
              "presentation_review_receipts",
            ],
          ],
        )
      ).rows,
    ).toEqual(
      [
        "presentation_review_cycles",
        "presentation_review_messages",
        "presentation_review_receipts",
        "presentation_review_threads",
      ].map((relname) => ({ relname, relrowsecurity: true, relforcerowsecurity: true })),
    );
  });
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
  it("enables each cycle once and reserves no receipts for later enable intents", async () => {
    const f = await expectReviewEnableOnceConformance(repository);
    expect(
      (
        await administrator.pool.query(
          "SELECT count(*)::integer AS count FROM presentation_review_receipts WHERE share_id=$1",
          [f.share.id],
        )
      ).rows[0].count,
    ).toBe(5);
  });
  it("persists pinned-version free-account feedback, concurrent CAS and exact receipts under revocation", async () => {
    const f = await expectReviewFeedbackConformance(repository),
      reopened = new PostgresRepository(runtimeDatabaseUrl);
    try {
      expect(
        (await createPresentationReviewFeedbackRepository(reopened).getAuthorReview(f.author))
          .feedback,
      ).toEqual((await f.feedback.getAuthorReview(f.author)).feedback);
    } finally {
      await reopened.close();
    }
  });
  it("exports external own messages and erases bodies, receipts and thread versions on account deletion", async () => {
    const f = await expectReviewFeedbackErasure(repository);
    expect(
      (
        await administrator.pool.query(
          "SELECT actor_id,body,deleted FROM presentation_review_messages WHERE share_id=$1 ORDER BY created_seq",
          [f.share.id],
        )
      ).rows,
    ).toEqual([
      { actor_id: null, body: "", deleted: true },
      { actor_id: f.second.userId, body: "OTHER_REVIEWER_BODY", deleted: false },
    ]);
    expect(
      (
        await administrator.pool.query(
          "SELECT count(*)::integer AS count FROM presentation_review_receipts WHERE share_id=$1 AND actor_id=$2",
          [f.share.id, f.first.userId],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("keeps revoked external-account exports limited to that reviewer's messages", async () => {
    await expectReviewFeedbackRevokedExport(repository);
  });
  it("forces share-scoped RLS and guards raw source, revision, body, anchor and receipt invariants", async () => {
    const f = await reviewFeedbackFixture(repository);
    await f.enable();
    const first = (await f.feedback.getReviewerReview(f.reviewer())).feedback,
      threadId = randomUUID(),
      messageId = randomUUID();
    await f.feedback.mutateReviewerReview({
      ...f.reviewer(),
      mutation: f.mutation(first, {
        type: "thread.create",
        threadId,
        messageId,
        blockId: f.content.blocks[0]!.id,
        text: "RAW_PRIVATE_BODY",
      }),
    });
    expect(
      (
        await repository.pool.query(
          "SELECT count(*)::integer AS count FROM presentation_review_messages",
        )
      ).rows[0].count,
    ).toBe(0);
    const client = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.workspace_id',$1,true),set_config('app.presentation_review_share_id',$2,true)",
        [f.actor.workspaceId, randomUUID()],
      );
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM presentation_review_messages"))
          .rows[0].count,
      ).toBe(0);
      await client.query("SELECT set_config('app.presentation_review_share_id',$1,true)", [
        f.share.id,
      ]);
      expect(
        (
          await client.query("SELECT body FROM presentation_review_messages WHERE share_id=$1", [
            f.share.id,
          ])
        ).rows,
      ).toEqual([{ body: "RAW_PRIVATE_BODY" }]);
      const reject = async (sql: string, values: unknown[], code = "23514") => {
        await client.query("SAVEPOINT bad_review");
        try {
          await expect(client.query(sql, values)).rejects.toMatchObject({ code });
        } finally {
          await client.query("ROLLBACK TO SAVEPOINT bad_review");
        }
      };
      await reject("UPDATE presentation_review_cycles SET version_id=$2 WHERE share_id=$1", [
        f.share.id,
        randomUUID(),
      ]);
      await reject(
        "UPDATE presentation_review_cycles SET review_seq=review_seq-1 WHERE share_id=$1",
        [f.share.id],
      );
      await reject(
        "UPDATE presentation_review_cycles SET approved_by=$2,approved_at=clock_timestamp(),approved_seq=review_seq WHERE share_id=$1",
        [f.share.id, f.actor.userId],
      );
      await reject(
        "UPDATE presentation_review_threads SET block_id=$3,version=version+1 WHERE share_id=$1 AND id=$2",
        [f.share.id, threadId, randomUUID()],
      );
      await reject(
        "UPDATE presentation_review_receipts SET request_hash=repeat('a',64) WHERE share_id=$1",
        [f.share.id],
      );
      for (const table of [
        "presentation_review_receipts",
        "presentation_review_messages",
        "presentation_review_threads",
        "presentation_review_cycles",
      ])
        await reject(`DELETE FROM ${table} WHERE share_id=$1`, [f.share.id]);
      await client.query(
        "UPDATE presentation_review_cycles SET review_seq=review_seq+1 WHERE share_id=$1",
        [f.share.id],
      );
      await reject(
        "UPDATE presentation_review_messages SET body=repeat('x',2001),version=version+1,changed_seq=3 WHERE share_id=$1 AND id=$2",
        [f.share.id, messageId],
      );
      await reject(
        "INSERT INTO presentation_review_threads(share_id,workspace_id,id,block_id,version,resolved,created_at,updated_at,created_seq,changed_seq) VALUES($1,$2,$3,$4,1,false,clock_timestamp(),clock_timestamp(),3,3)",
        [f.share.id, f.actor.workspaceId, randomUUID(), randomUUID()],
      );
      await reject(
        "INSERT INTO presentation_review_messages(share_id,workspace_id,id,thread_id,actor_id,author_role,reviewer_ordinal,body,version,deleted,created_at,updated_at,created_seq,changed_seq) VALUES($1,$2,$3,$4,$5,'reviewer',NULL,'unsafe ordinal',1,false,clock_timestamp(),clock_timestamp(),3,3)",
        [f.share.id, f.actor.workspaceId, randomUUID(), threadId, f.first.userId],
      );
      await reject(
        "INSERT INTO presentation_review_receipts(share_id,workspace_id,actor_id,operation_id,request_hash,receipt) VALUES($1,$2,$3,$4,repeat('a',64),$5::jsonb)",
        [
          f.share.id,
          f.actor.workspaceId,
          f.first.userId,
          randomUUID(),
          JSON.stringify({
            operationId: randomUUID(),
            reviewSeq: 99,
            type: "thread.create",
            threadId,
            messageId,
            body: "PRIVATE",
          }),
        ],
      );
      await client.query("ROLLBACK");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    const source = await f.presentations.getPresentationVersion(f.actor.workspaceId, f.version.id);
    await f.presentations.archivePresentation(f.actor.workspaceId, f.presentation.id, true);
    expect(await f.presentations.deletePresentation(f.actor.workspaceId, f.presentation.id)).toBe(
      "deleted",
    );
    expect(
      (
        await administrator.pool.query(
          "SELECT count(*)::integer AS count FROM presentation_review_cycles WHERE share_id=$1",
          [f.share.id],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(source?.contentHash).toBe(f.version.contentHash);
  });
  it("rechecks real clock expiry after blocked access, body reads and accepted receipt lookup", async () => {
    const f = await reviewFeedbackFixture(repository);
    for (const mode of ["access", "read", "replay", "enableReplay"] as const) {
      const expiresAt = new Date(Date.now() + 700),
        input = { ...f.request(), expiresAt: expiresAt.toISOString() },
        share = (await f.shares.createShare(input)).share;
      const author = { ...f.author, shareId: share.id },
        reviewer = { ...f.reviewer(), shareId: share.id, tokenHash: input.tokenHash },
        request = { operationId: randomUUID(), versionId: f.version.id };
      await f.feedback.enableReview({ ...author, request });
      const current = (await f.feedback.getReviewerReview(reviewer)).feedback,
        mutation = f.mutation(current, {
          type: "thread.create",
          threadId: randomUUID(),
          messageId: randomUUID(),
          blockId: f.content.blocks[0]!.id,
          text: "Do not return after expiry",
        });
      await f.feedback.mutateReviewerReview({ ...reviewer, mutation });
      const blocker = await administrator.pool.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query("LOCK TABLE presentation_review_cycles IN ACCESS EXCLUSIVE MODE");
        const action =
          mode === "access"
            ? f.feedback.getReviewAccess(reviewer)
            : mode === "read"
              ? f.feedback.getReviewerReview(reviewer)
              : mode === "replay"
                ? f.feedback.mutateReviewerReview({ ...reviewer, mutation })
                : f.feedback.enableReview({ ...author, request });
        const pending = action.then(
          (value) => ({ value, error: null }),
          (error) => ({ value: null, error }),
        );
        let blocked = false;
        for (let i = 0; i < 30; i++) {
          blocked = !!(
            await administrator.pool.query(
              "SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND state='active' AND wait_event_type='Lock' AND query LIKE '%presentation_review_cycles%'",
              [database],
            )
          ).rowCount;
          if (blocked) break;
          await delay(5);
        }
        expect(blocked).toBe(true);
        await delay(Math.max(0, expiresAt.getTime() - Date.now() + 15));
        await blocker.query("COMMIT");
        expect((await pending).error).toMatchObject({ code: "UNAVAILABLE" });
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
    }
  });
  it("serializes erasure with another reviewer's source lock without a share-cycle deadlock", async () => {
    const f = await reviewFeedbackFixture(repository);
    await f.enable();
    const first = (await f.feedback.getReviewerReview(f.reviewer())).feedback;
    await f.feedback.mutateReviewerReview({
      ...f.reviewer(),
      mutation: f.mutation(first, {
        type: "thread.create",
        threadId: randomUUID(),
        messageId: randomUUID(),
        blockId: f.content.blocks[0]!.id,
        text: "ERASE_RACE_BODY",
      }),
    });
    await Promise.all([
      repository.deleteAccount(f.first.userId),
      ...Array.from({ length: 3 }, () => f.feedback.getReviewerReview(f.reviewer(f.second.userId))),
    ]);
    const final = (await f.feedback.getReviewerReview(f.reviewer(f.second.userId))).feedback;
    expect(final.threads[0]!.messages[0]).toMatchObject({ text: "", deleted: true });
    expect(JSON.stringify(final)).not.toContain("ERASE_RACE_BODY");
  });
  it("locks the publisher identity before its workspace while owner deletion races a reviewer", async () => {
    const f = await reviewFeedbackFixture(repository);
    await f.enable();
    const blocker = await administrator.pool.connect();
    let pending: Promise<{ error: unknown }> | undefined;
    try {
      await blocker.query("BEGIN");
      // This is deleteAccount's first row lock, before it deletes owned workspaces.
      await blocker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [f.actor.userId]);
      pending = f.feedback.getReviewerReview(f.reviewer(f.second.userId)).then(
        () => ({ error: null }),
        (error) => ({ error }),
      );
      let blocked = false;
      for (let i = 0; i < 60; i++) {
        blocked = !!(
          await administrator.pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND state='active' AND wait_event_type='Lock' AND query LIKE '%users%'",
            [database],
          )
        ).rowCount;
        if (blocked) break;
        await delay(5);
      }
      expect(blocked).toBe(true);
      // A workspace-first reader would hold this row while waiting for our user lock.
      await blocker.query("DELETE FROM workspaces WHERE id=$1", [f.actor.workspaceId]);
      await blocker.query("COMMIT");
      expect((await pending).error).toMatchObject({ code: "UNAVAILABLE" });
      expect(
        (
          await administrator.pool.query(
            "SELECT count(*)::integer AS count FROM presentation_review_cycles WHERE share_id=$1",
            [f.share.id],
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await pending;
    }
  });
});
