import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresRepository, assertRestrictedRuntimeDatabasePrincipal } from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import {
  expectSurveyPagesAudience,
  expectSurveyPagesWriterBoundary,
  seedPagedSurvey,
} from "./support/survey-pages-conformance.js";
import {
  expectSurveyConformance,
  expectSurveyCreationUpgradeConformance,
} from "./support/survey-conformance.js";
import { assistanceIdentity } from "./support/presentation-assistance-conformance.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))("Survey page readers with restricted PostgreSQL", () => {
  const database = `survey_pages_${randomUUID().replaceAll("-", "")}`;
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
      (await administrator.pool.query("SELECT name FROM _openround_migrations WHERE version=117"))
        .rows,
    ).toEqual([{ name: "survey_pages_readers" }]);
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
        for (let index = 0; index < 100; index++) {
          if (
            Number(
              (
                await cluster.pool.query(
                  "SELECT count(*) AS count FROM pg_stat_activity WHERE datname=$1",
                  [database],
                )
              ).rows[0].count,
            ) === 0
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
  it("preserves v3 snapshots and exact author receipts while disabling fresh page writers", () =>
    expectSurveyPagesWriterBoundary(repository));
  it("negotiates audience readers, preserves aggregate privacy and cascades room deletion", () =>
    expectSurveyPagesAudience(repository));
  it("keeps both historical paths and the exact v1-to-v2 creation receipt compatibility", async () => {
    const actor = await assistanceIdentity(repository);
    await expectSurveyCreationUpgradeConformance(repository, actor.workspaceId);
    await expectSurveyConformance(repository, actor.workspaceId, 1);
    await expectSurveyConformance(repository, actor.workspaceId, 2);
  });
  it("retains forced RLS, immutable pages, future-version rejection and untouched stored receipts", async () => {
    const f = await seedPagedSurvey(repository);
    const before = await administrator.pool.query(
      "SELECT request_hash,receipt FROM survey_mutation_receipts WHERE workspace_id=$1 ORDER BY idempotency_key",
      [f.actor.workspaceId],
    );
    await f.surveys.get(f.actor.workspaceId, f.id);
    await f.surveys.getRoom(f.room.id);
    await f.surveys.list(f.actor.workspaceId);
    const after = await administrator.pool.query(
      "SELECT request_hash,receipt FROM survey_mutation_receipts WHERE workspace_id=$1 ORDER BY idempotency_key",
      [f.actor.workspaceId],
    );
    expect(after.rows).toEqual(before.rows);
    await expect(
      administrator.pool.query(
        "UPDATE survey_versions SET data=jsonb_set(data,'{content,pages,0,title}','\"changed\"') WHERE id=$1",
        [f.published.versionId],
      ),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      administrator.pool.query(
        "UPDATE survey_feedback_rooms SET data=jsonb_set(data,'{content,pages,0,title}','\"changed\"') WHERE id=$1",
        [f.room.id],
      ),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      administrator.pool.query(
        "UPDATE surveys SET data=jsonb_set(data,'{schemaVersion}','5') WHERE id=$1",
        [f.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (await repository.pool.query("SELECT id FROM surveys WHERE id=$1", [f.id])).rows,
    ).toEqual([]);
    expect(
      (
        await administrator.pool.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])",
          [["surveys", "survey_versions", "survey_feedback_rooms", "survey_guests"]],
        )
      ).rows,
    ).toEqual(
      Array.from({ length: 4 }, () => ({ relrowsecurity: true, relforcerowsecurity: true })),
    );
    await repository.deleteAccount(f.actor.userId);
    for (const table of [
      "surveys",
      "survey_versions",
      "survey_feedback_rooms",
      "survey_guests",
      "survey_mutation_receipts",
    ])
      expect(
        (
          await administrator.pool.query(
            `SELECT workspace_id FROM ${table} WHERE workspace_id=$1`,
            [f.actor.workspaceId],
          )
        ).rows,
      ).toEqual([]);
  });
});
