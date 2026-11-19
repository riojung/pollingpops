import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresRepository, assertRestrictedRuntimeDatabasePrincipal } from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import {
  expectBranchingLifecycle,
  expectBranchingReaderAndResponses,
  expectBranchingReaderLegacyCompatibility,
  expectBranchingWriterAndResultsBoundary,
  seedBranchingSurvey,
} from "./support/survey-branching-conformance.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))(
  "conditional Survey readers with restricted PostgreSQL",
  () => {
    const database = `survey_branching_${randomUUID().replaceAll("-", "")}`;
    let created = false;
    let repository: PostgresRepository;
    let administrator: PostgresRepository;
    beforeAll(async () => {
      await preparePostgresTestRuntime(adminUrl!, runtimeUrl!);
      const cluster = new PostgresRepository(adminUrl!);
      try {
        await cluster.pool.query(`CREATE DATABASE "${database}"`);
        created = true;
      } finally {
        await cluster.close();
      }
      const admin = new URL(adminUrl!);
      const runtime = new URL(runtimeUrl!);
      admin.pathname = runtime.pathname = `/${database}`;
      administrator = new PostgresRepository(admin.toString());
      await administrator.migrate();
      await administrator.migrate();
      expect(
        (await administrator.pool.query("SELECT name FROM _openround_migrations WHERE version=118"))
          .rows,
      ).toEqual([{ name: "survey_branching_readers" }]);
      repository = new PostgresRepository(runtime.toString());
      await repository.initialize();
      expect(
        assertRestrictedRuntimeDatabasePrincipal(
          await repository.inspectRuntimeDatabasePrincipal(),
        ),
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
          await cluster.pool.query(`DROP DATABASE "${database}"`);
        } finally {
          await cluster.close();
        }
      }
    });
    it("reads frozen v4 documents and validates branching without resurrecting older receipt maps", () =>
      expectBranchingReaderAndResponses(repository));
    it("reads and writes historical attempts with reader4 while retaining their original versions", () =>
      expectBranchingReaderLegacyCompatibility(repository));
    it("fences every author writer and results before mutating frozen runs", () =>
      expectBranchingWriterAndResultsBoundary(repository));
    it.each(["room", "expiry", "account"] as const)(
      "preserves private exports and %s deletion",
      async (mode) => {
        const f = await expectBranchingLifecycle(repository, mode);
        for (const table of ["survey_feedback_rooms", "survey_guests", "survey_mutation_receipts"])
          expect(
            (
              await administrator.pool.query(
                `SELECT workspace_id FROM ${table} WHERE workspace_id=$1`,
                [f.actor.workspaceId],
              )
            ).rows,
          ).toEqual([]);
      },
    );
    it("preserves snapshots, exact receipt storage, scope checks, future-version refusal and forced RLS", async () => {
      const f = await seedBranchingSurvey(repository);
      const token = randomUUID();
      await f.surveys.admit(f.room.id, token, f.now, 4);
      const key = randomUUID();
      await f.surveys.respond(f.room.id, token, f.shut, 0, key, false, f.now, 4);
      const query =
        "SELECT request_hash,receipt FROM survey_mutation_receipts WHERE workspace_id=$1 ORDER BY idempotency_key";
      const before = (await administrator.pool.query(query, [f.actor.workspaceId])).rows;
      await f.surveys.get(f.actor.workspaceId, f.id);
      await f.surveys.attempt(f.room.id, token, f.now, 4);
      await f.surveys.respond(f.room.id, token, f.shut, 0, key, false, f.now, 4);
      expect((await administrator.pool.query(query, [f.actor.workspaceId])).rows).toEqual(before);
      for (const [table, id] of [
        ["survey_versions", f.version.id],
        ["survey_feedback_rooms", f.room.id],
      ])
        await expect(
          administrator.pool.query(
            `UPDATE ${table} SET data=jsonb_set(data,'{content,pages,0,title}','"changed"') WHERE id=$1`,
            [id],
          ),
        ).rejects.toMatchObject({ code: "P0001" });
      await expect(
        administrator.pool.query(
          "UPDATE surveys SET data=jsonb_set(data,'{schemaVersion}','5') WHERE id=$1",
          [f.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await administrator.pool.query(
        "UPDATE survey_guests SET data=jsonb_set(data,'{schemaVersion}','3') WHERE room_id=$1",
        [f.room.id],
      );
      await expect(f.surveys.attempt(f.room.id, token, f.now, 4)).rejects.toThrow(
        "matching scope and schema",
      );
      await expect(
        f.surveys.respond(f.room.id, token, f.shut, 0, key, false, f.now, 4),
      ).rejects.toThrow("matching scope and schema");
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
    });
  },
);
