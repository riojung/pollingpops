import {
  expectPresentationOpinionCountsConformance,
  presentationInsightsOpinionFixture,
} from "./support/presentation-insights-conformance.js";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PostgresRepository, assertRestrictedRuntimeDatabasePrincipal } from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import {
  expectPresentationQnaCountsConformance,
  expectPresentationRevealCountsConformance,
} from "./support/presentation-insights-conformance.js";
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))("Presentation session insights PostgreSQL", () => {
  const database = `presentation_insights_${randomUUID().replaceAll("-", "")}`;
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
      (await administrator.pool.query("SELECT name FROM _openround_migrations WHERE version=97"))
        .rows,
    ).toEqual([{ name: "presentation_sharing" }]);
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
    expect(
      (
        await administrator.pool.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='presentation_session_timeline'::regclass",
        )
      ).rows[0],
    ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
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
  it("reads public Q&A aggregates and fences moderation, retention and deletion", async () => {
    await expectPresentationQnaCountsConformance(repository);
  });
  it("counts exact private reveal rosters without returning principal IDs", async () => {
    await expectPresentationRevealCountsConformance(repository, async (events) => {
      // These explicit null/empty legacy rows use the supported expired-live import path.
      // Retention remains valid, and the production aggregate sequence guard stays enabled.
      await administrator.pool.query(
        "UPDATE presentation_live_sessions SET live_expires_at=clock_timestamp()-interval '1 second' WHERE workspace_id=$1 AND id=$2",
        [events[0]!.workspaceId, events[0]!.sessionId],
      );
      for (const event of events)
        await administrator.pool.query(
          "INSERT INTO presentation_session_timeline(id,workspace_id,session_id,sequence,event_type,block_index,block_id,occurred_at,revealed_participant_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            event.id,
            event.workspaceId,
            event.sessionId,
            event.sequence,
            event.type,
            event.blockIndex,
            event.blockId,
            event.occurredAt,
            event.revealedParticipantIds,
          ],
        );
    });
  });
  it("retains poll and rating counts with literal legacy identities when the snapshot omits schemaVersion", async () => {
    const valid = await presentationInsightsOpinionFixture(repository, false, false);
    const legacyCase = await presentationInsightsOpinionFixture(repository, false, true);
    const importLegacySnapshot = async (f: typeof valid) => {
      // This disposable retained legacy import omits the optional version field. Existing
      // migration guards remain enabled; published artifacts and response rows stay intact.
      await administrator.pool.query(
        "UPDATE presentation_live_sessions SET live_expires_at=clock_timestamp()-interval '1 second',content_snapshot=content_snapshot-'schemaVersion' WHERE workspace_id=$1 AND id=$2",
        [f.actor.workspaceId, f.session.id],
      );
      const row = (
        await administrator.pool.query(
          "SELECT content_snapshot::text AS snapshot FROM presentation_live_sessions WHERE workspace_id=$1 AND id=$2",
          [f.actor.workspaceId, f.session.id],
        )
      ).rows[0];
      expect(JSON.parse(row.snapshot).schemaVersion).toBeUndefined();
      expect(
        (await f.sessions.getSessionForWorkspace(f.actor.workspaceId, f.session.id))?.content
          .schemaVersion,
      ).toBe(2);
      return row.snapshot as string;
    };
    const validSnapshot = await importLegacySnapshot(valid),
      caseSnapshot = await importLegacySnapshot(legacyCase);
    const reportBefore = await valid.sessions.getReport(valid.actor.workspaceId, valid.session.id);
    expect(
      await valid.sessions.getInsightsOpinionCounts(
        valid.actor.workspaceId,
        valid.session.id,
        valid.selectors,
      ),
    ).toEqual([
      {
        blockId: valid.selectors[0]!.blockId,
        responseCount: 5,
        buckets: valid.selectors[0]!.choiceIds.map((key, index) => ({ key, count: index ? 2 : 3 })),
      },
      {
        blockId: valid.selectors[1]!.blockId,
        responseCount: 5,
        buckets: [
          { key: "1", count: 2 },
          { key: "2", count: 2 },
          { key: "3", count: 1 },
        ],
      },
    ]);
    // Missing schemaVersion uses the legacy literal comparison, never v12 UUID folding.
    expect(
      await legacyCase.sessions.getInsightsOpinionCounts(
        legacyCase.actor.workspaceId,
        legacyCase.session.id,
        legacyCase.selectors,
      ),
    ).toEqual([
      {
        blockId: legacyCase.selectors[0]!.blockId,
        responseCount: 5,
        buckets: legacyCase.selectors[0]!.choiceIds.map((key) => ({ key, count: 0 })),
      },
      {
        blockId: legacyCase.selectors[1]!.blockId,
        responseCount: 5,
        buckets: [
          { key: "1", count: 2 },
          { key: "2", count: 1 },
          { key: "3", count: 1 },
        ],
      },
    ]);
    expect(
      await valid.sessions.getInsightsOpinionCounts(
        valid.actor.workspaceId,
        valid.session.id,
        valid.selectors.map((selector) => ({ ...selector, semanticIds: true })),
      ),
    ).toEqual([]);
    expect(await valid.sessions.getReport(valid.actor.workspaceId, valid.session.id)).toEqual(
      reportBefore,
    );
    expect(
      (await valid.presentations.getPresentationVersion(valid.actor.workspaceId, valid.version.id))
        ?.contentHash,
    ).toBe(valid.version.contentHash);
    for (const [f, snapshot] of [
      [valid, validSnapshot],
      [legacyCase, caseSnapshot],
    ] as const)
      expect(
        (
          await administrator.pool.query(
            "SELECT content_snapshot::text AS snapshot FROM presentation_live_sessions WHERE workspace_id=$1 AND id=$2",
            [f.actor.workspaceId, f.session.id],
          )
        ).rows[0].snapshot,
      ).toBe(snapshot);
  });
  it("aggregates ordinary poll and rating buckets with frozen bindings and no private rows", async () => {
    await expectPresentationOpinionCountsConformance(repository);
  });
});
