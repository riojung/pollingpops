import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assertRestrictedRuntimeDatabasePrincipal,
  createSurveyRepository,
  MemoryRepository,
  PostgresRepository,
  type Repository,
} from "../src/index.js";
import { assistanceIdentity } from "./support/presentation-assistance-conformance.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import { surveyFixture } from "./support/survey-conformance.js";

vi.mock(import("node:crypto"), async (importOriginal) => {
  const crypto = await importOriginal();
  return { ...crypto, randomUUID: vi.fn(crypto.randomUUID) };
});

async function expectSurveyResultsHistory(repository: Repository) {
  const { workspaceId } = await assistanceIdentity(repository);
  const outsider = await assistanceIdentity(repository);
  const surveys = createSurveyRepository(repository);
  const history = surveys.resultsHistory;
  const now = new Date("2026-10-01T00:00:00.000Z");
  const retention = "2027-01-01T00:00:00.000Z";
  let code = 1_234_500;

  async function source(title: string, workspace = workspaceId) {
    const id = randomUUID();
    await surveys.create(workspace, id, { ...surveyFixture(), title }, randomUUID());
    await surveys.publish(workspace, id, 0, randomUUID(), null);
    return id;
  }
  function room(
    id: string,
    closesAt: string,
    expiresAt = retention,
    revision = 0,
    workspace = workspaceId,
    roomId?: ReturnType<typeof randomUUID>,
  ) {
    const key = randomUUID();
    if (roomId) vi.mocked(randomUUID).mockReturnValueOnce(roomId);
    return surveys.createRoom(workspace, id, revision, key, {
      code: String(code++),
      closesAt,
      expiresAt,
      participantLimit: 100,
      windowDays: 1,
      joinPasswordHash: "private-room-verifier",
    });
  }

  const archivedId = await source("Archived Survey");
  const archived = await room(archivedId, "2023-12-31T23:59:59.000Z", "2026-10-01T00:01:00.000Z");
  await surveys.archive(workspaceId, archivedId, 0, randomUUID());
  const renamedId = await source("Original %_ Feedback");
  for (const date of ["2024-01-01", "2024-04-01", "2024-07-01", "2024-10-01", "2025-01-01"]) {
    await room(renamedId, `${date}T00:00:01.000Z`);
  }
  const tiedDeadline = "2025-04-01T00:00:00.123Z";
  const firstTied = await room(renamedId, tiedDeadline);
  const secondTied = await room(renamedId, tiedDeadline);
  const tiedIds = [firstTied.id, secondTied.id].sort();
  await surveys.save(
    workspaceId,
    renamedId,
    { ...surveyFixture(), title: "Latest %_ Feedback" },
    0,
    randomUUID(),
  );
  await surveys.publish(workspaceId, renamedId, 1, randomUUID(), null);
  const manuallyClosed = await room(renamedId, "2026-12-01T00:00:00.000Z", retention, 1);
  await surveys.close(workspaceId, manuallyClosed.id);
  const openId = await source("Open Survey");
  const openRoom = await room(openId, "2026-10-01T00:02:00.000Z", "2026-10-01T01:00:00.000Z");
  const expiredId = await source("Expired Survey");
  await room(expiredId, "2026-09-01T00:00:00.000Z", now.toISOString());
  const foreignId = await source("Outside %_ Feedback", outsider.workspaceId);
  await room(foreignId, "2024-01-01T00:00:00.001Z", retention, 0, outsider.workspaceId);

  const first = await history.list(workspaceId, { now, limit: 2 });
  expect(first.items).toEqual([
    {
      id: manuallyClosed.id,
      surveyId: renamedId,
      title: "Latest %_ Feedback",
      code: manuallyClosed.code,
      closesAt: manuallyClosed.closesAt,
      expiresAt: retention,
    },
    {
      id: tiedIds[0],
      surveyId: renamedId,
      title: "Original %_ Feedback",
      code: tiedIds[0] === firstTied.id ? firstTied.code : secondTied.code,
      closesAt: tiedDeadline,
      expiresAt: retention,
    },
  ]);
  expect(first.next).toMatchObject({ id: tiedIds[0] });
  const second = await history.list(workspaceId, { now, cursor: first.next!, limit: 20 });
  expect(second.items[0]?.id).toBe(tiedIds[1]);
  expect(second.items.at(-1)?.id).toBe(archived.id);
  expect(second.items).toHaveLength(7);
  expect(second.next).toBeNull();

  function buckets(starts: string[]) {
    return starts.map((start) => ({ start, count: start === "2025-04-01" ? 2 : 1 }));
  }
  const commonStarts = ["2024-04-01", "2024-07-01", "2024-10-01", "2025-01-01", "2025-04-01"];
  expect(await history.analytics(workspaceId, { now })).toEqual({
    rooms: 9,
    surveys: 2,
    activity: {
      month: buckets([...commonStarts, "2026-12-01"]),
      quarter: buckets([...commonStarts, "2026-10-01"]),
    },
    // This expiry is for the oldest retained room, beyond the initial list page.
    refreshAfterMs: 60_000,
  });

  const date = new Date(tiedDeadline);
  const filtered = { now, surveyId: renamedId, from: date, to: date, search: "  %_ FEEDBACK " };
  expect(await history.analytics(workspaceId, filtered)).toEqual({
    rooms: 2,
    surveys: 1,
    activity: { month: buckets(["2025-04-01"]), quarter: buckets(["2025-04-01"]) },
    refreshAfterMs: Date.parse(retention) - now.getTime(),
  });
  expect(
    (await history.list(workspaceId, { ...filtered, limit: 25 })).items.map(({ id }) => id),
  ).toEqual(tiedIds);
  expect((await history.analytics(workspaceId, { now, search: firstTied.code })).rooms).toBe(1);
  expect(await history.analytics(workspaceId, { now, surveyId: foreignId })).toEqual({
    rooms: 0,
    surveys: 0,
    activity: { month: [], quarter: [] },
    refreshAfterMs: null,
  });
  const scheduled = { now, surveyId: openId, search: openRoom.code, from: now };
  expect(await history.analytics(workspaceId, scheduled)).toEqual({
    rooms: 0,
    surveys: 0,
    activity: { month: [], quarter: [] },
    refreshAfterMs: 120_000,
  });
  expect(await history.analytics(workspaceId, { ...scheduled, to: now })).toMatchObject({
    refreshAfterMs: null,
  });

  const sources = await history.sources(workspaceId, now);
  expect(sources).toEqual({
    sources: [
      { id: archivedId, title: "Archived Survey" },
      { id: renamedId, title: "Latest %_ Feedback" },
    ].sort((left, right) => left.id.localeCompare(right.id)),
    refreshAfterMs: 60_000,
  });
  const afterExpiry = new Date(now.getTime() + 60_000);
  expect(await history.sources(workspaceId, afterExpiry)).toEqual({
    sources: [{ id: renamedId, title: "Latest %_ Feedback" }],
    refreshAfterMs: 60_000,
  });
  const afterClose = new Date(now.getTime() + 120_000);
  expect(await history.analytics(workspaceId, { ...scheduled, now: afterClose })).toEqual({
    rooms: 1,
    surveys: 1,
    activity: { month: buckets(["2026-10-01"]), quarter: buckets(["2026-10-01"]) },
    refreshAfterMs: 3_480_000,
  });
  expect(await history.sources(workspaceId, afterClose)).toEqual({
    sources: [
      { id: renamedId, title: "Latest %_ Feedback" },
      { id: openId, title: "Open Survey" },
    ].sort((left, right) => left.id.localeCompare(right.id)),
    refreshAfterMs: 3_480_000,
  });
  expect(await history.sources(workspaceId, new Date(retention))).toEqual({
    sources: [],
    refreshAfterMs: null,
  });

  const tiedWorkspace = (await assistanceIdentity(repository)).workspaceId;
  const tiedSource = await source("Original title on tied deadline", tiedWorkspace);
  await room(
    tiedSource,
    tiedDeadline,
    retention,
    0,
    tiedWorkspace,
    "22222222-2222-4222-8222-222222222222",
  );
  await surveys.save(
    tiedWorkspace,
    tiedSource,
    { ...surveyFixture(), title: "Renamed title on tied deadline" },
    0,
    randomUUID(),
  );
  await surveys.publish(tiedWorkspace, tiedSource, 1, randomUUID(), null);
  const winningRoom = await room(
    tiedSource,
    tiedDeadline,
    retention,
    1,
    tiedWorkspace,
    "11111111-1111-4111-8111-111111111111",
  );
  expect(winningRoom.id).toBe("11111111-1111-4111-8111-111111111111");
  expect((await history.sources(tiedWorkspace, now)).sources).toEqual([
    {
      id: tiedSource,
      title: winningRoom.content.title,
    },
  ]);

  if (repository instanceof PostgresRepository) {
    // PostgreSQL timestamps can distinguish deadlines within the same millisecond.
    const preciseId = await source("Submillisecond deadlines");
    const older = await room(preciseId, "2025-05-01T00:00:00.123100Z");
    const newer = await room(preciseId, "2025-05-01T00:00:00.123200Z");
    const criteria = { now, surveyId: preciseId, limit: 1 };
    const precisePage = await history.list(workspaceId, criteria);
    expect(precisePage.items[0]?.id).toBe(newer.id);
    expect(precisePage.next).toEqual({ id: newer.id, closesAt: newer.closesAt });
    const nextPrecisePage = await history.list(workspaceId, {
      ...criteria,
      cursor: precisePage.next!,
    });
    expect(nextPrecisePage.items[0]?.id).toBe(older.id);
    expect(nextPrecisePage.next).toBeNull();

    await room(preciseId, "2026-10-01T00:00:00.000500Z");
    expect((await history.sources(workspaceId, now)).refreshAfterMs).toBe(1);
  }
}

it("pages and aggregates eligible Survey room metadata in memory", async () => {
  await expectSurveyResultsHistory(new MemoryRepository());
});

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))(
  "Survey Results history with restricted PostgreSQL",
  () => {
    const database = `survey_history_${randomUUID().replaceAll("-", "")}`;
    let created = false;
    let repository: PostgresRepository;
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
      // Keep the source tie fixture in insertion order until its explicit SQL sort.
      runtime.searchParams.set(
        "options",
        "-c timezone=America/Edmonton -c enable_indexscan=off -c enable_bitmapscan=off -c enable_indexonlyscan=off",
      );
      const administrator = new PostgresRepository(admin.toString());
      try {
        await administrator.migrate();
      } finally {
        await administrator.close();
      }
      repository = new PostgresRepository(runtime.toString());
      await repository.initialize();
      assertRestrictedRuntimeDatabasePrincipal(await repository.inspectRuntimeDatabasePrincipal());
    }, 60_000);
    afterAll(async () => {
      await repository?.close();
      if (created) {
        const cluster = new PostgresRepository(adminUrl!);
        try {
          await cluster.pool.query(`DROP DATABASE "${database}"`);
        } finally {
          await cluster.close();
        }
      }
    });

    it("applies the same workspace filters, UTC buckets, cursors and lifecycle in a non-UTC database session", async () => {
      await expectSurveyResultsHistory(repository);
    });
  },
);
