import { createHash, randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  createPresentationSessionRepository,
  type PresentationSessionRecord,
  type Repository,
} from "../../src/index.js";
import { presentationSharingFixture } from "./presentation-sharing-conformance.js";

export async function expectPresentationResultsHistoryConformance(
  repository: Repository,
  setPreciseDates?: (workspaceId: string, newerId: string, olderId: string) => Promise<void>,
) {
  const owner = await presentationSharingFixture(repository, "presentation-results-owner");
  const outsider = await presentationSharingFixture(repository, "presentation-results-outsider");
  const sessions = createPresentationSessionRepository(repository);
  const workspaceId = owner.actor.workspaceId;
  const olderPresentation = await owner.presentations.createPresentation({
    ...owner.presentation,
    id: randomUUID(),
  });
  const olderVersion = await owner.presentations.publishPresentation(
    { ...owner.version, id: randomUUID(), presentationId: olderPresentation.id },
    0,
  );
  async function session(
    fixture: typeof owner,
    date: string,
    title: string,
    status: PresentationSessionRecord["status"],
    options: { id?: string; expired?: boolean; oldestSource?: boolean; question?: boolean } = {},
  ) {
    const createdAt = new Date(date);
    return sessions.createSession({
      id: options.id ?? randomUUID(),
      workspaceId: fixture.actor.workspaceId,
      presentationId: options.oldestSource ? olderPresentation.id : fixture.presentation.id,
      presentationVersionId: options.oldestSource ? olderVersion.id : fixture.version.id,
      title,
      content: fixture.content,
      code: String(randomInt(1_000_000, 10_000_000)),
      status,
      phase: status === "finished" ? "finished" : options.question ? "question_open" : "lobby",
      currentBlockIndex: options.question ? 1 : -1,
      revision: 0,
      createdBy: fixture.actor.userId,
      createdAt,
      updatedAt: createdAt,
      finishedAt: status === "finished" ? createdAt : null,
      liveExpiresAt: new Date(options.expired ? createdAt.getTime() + 60_000 : Date.now() + 60_000),
      retentionExpiresAt: new Date(Date.now() + 86_400_000),
    });
  }
  async function join(room: PresentationSessionRecord) {
    return sessions.addParticipant({
      id: randomUUID(),
      workspaceId: room.workspaceId,
      sessionId: room.id,
      nickname: "PRIVATE_LEARNER",
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      joinedAt: room.createdAt,
      lastSeenAt: room.createdAt,
    });
  }

  const dates = [
    "2023-12-31T23:59:00.000Z",
    "2024-01-01T00:01:00.000Z",
    "2024-04-01T00:01:00.000Z",
    "2024-07-01T00:01:00.000Z",
    "2024-10-01T00:01:00.000Z",
    "2025-01-01T00:01:00.000Z",
    "2025-04-01T00:01:00.123Z",
  ];
  const oldest = await session(owner, dates[0]!, "Older source", "active", {
    expired: true,
    oldestSource: true,
  });
  const oldTitle = await session(
    owner,
    dates[1]!,
    "Original %_ Workout ΟΣ Review τελος",
    "finished",
  );
  await session(owner, dates[2]!, "Original ZZ Workout", "finished");
  for (const date of dates.slice(3, -1)) await session(owner, date, "Other", "active");
  await session(owner, "2025-03-01T00:01:00.000Z", "Another month", "active");
  const olderTie = await session(owner, dates[6]!, "Midpoint %_ Workout", "finished", {
    id: "11111111-1111-4111-8111-111111111111",
  });
  const newerTie = await session(owner, dates[6]!, "Latest %_ Workout", "active", {
    id: "22222222-2222-4222-8222-222222222222",
    question: true,
  });
  const foreign = await session(outsider, dates[6]!, "Outside %_ Workout", "active");
  await join(oldTitle);
  const answering = await join(newerTie);
  await join(newerTie);
  await join(foreign);
  const block = newerTie.content.blocks[1]!;
  if (block.kind !== "question") throw new Error("Expected a question in the results fixture");
  await sessions.saveResponse({
    id: randomUUID(),
    workspaceId,
    sessionId: newerTie.id,
    participantId: answering.id,
    blockId: block.id,
    questionId: block.question.id,
    response: { numericValue: "917" },
    correct: true,
    score: 1000,
    responseMs: 10,
    submittedAt: new Date(newerTie.createdAt.getTime() + 10),
  });

  const first = await sessions.listResultsHistory(workspaceId, { limit: 1 });
  expect(first.hasMore).toBe(true);
  expect(first.items).toEqual([
    expect.objectContaining({
      id: newerTie.id,
      title: newerTie.title,
      participantCount: 2,
      responseCount: 1,
      blockCount: 2,
      reportStatus: null,
    }),
  ]);
  expect(first.items[0]).not.toHaveProperty("participants");
  const second = await sessions.listResultsHistory(workspaceId, {
    limit: 1,
    cursor: first.items[0]!,
  });
  expect(second.items).toEqual([
    expect.objectContaining({ id: olderTie.id, reportStatus: "pending", responseCount: 0 }),
  ]);
  expect(await sessions.listResultsSources(workspaceId)).toEqual(
    expect.arrayContaining([
      { id: owner.presentation.id, title: newerTie.title },
      { id: oldest.presentationId, title: oldest.title },
    ]),
  );
  expect(await sessions.listResultsSources(workspaceId)).toHaveLength(2);
  expect(await sessions.listResultsSources(outsider.actor.workspaceId)).toEqual([
    { id: foreign.presentationId, title: foreign.title },
  ]);
  expect(await sessions.getResultsAnalytics(workspaceId, {})).toEqual({
    active: 6,
    finished: 3,
    participantJoins: 3,
    activity: {
      month: [
        { start: "2024-04-01", count: 1 },
        { start: "2024-07-01", count: 1 },
        { start: "2024-10-01", count: 1 },
        { start: "2025-01-01", count: 1 },
        { start: "2025-03-01", count: 1 },
        { start: "2025-04-01", count: 2 },
      ],
      quarter: dates.slice(1).map((date, index) => ({
        start: `${date.slice(0, 7)}-01`,
        count: index >= 4 ? 2 : 1,
      })),
    },
  });

  const filtered = {
    search: "  %_ wORkout ",
    status: "finished" as const,
    presentationId: owner.presentation.id,
    from: oldTitle.createdAt,
    to: olderTie.createdAt,
  };
  expect(
    (await sessions.listResultsHistory(workspaceId, { ...filtered, limit: 5 })).items.map(
      ({ id }) => id,
    ),
  ).toEqual([olderTie.id, oldTitle.id]);
  expect(await sessions.getResultsAnalytics(workspaceId, filtered)).toEqual({
    active: 0,
    finished: 2,
    participantJoins: 1,
    activity: {
      month: [
        { start: "2024-01-01", count: 1 },
        { start: "2025-04-01", count: 1 },
      ],
      quarter: [
        { start: "2024-01-01", count: 1 },
        { start: "2025-04-01", count: 1 },
      ],
    },
  });
  for (const search of ["ος review", "ΤΕΛΟΣ"]) {
    expect(
      (await sessions.listResultsHistory(workspaceId, { search, limit: 5 })).items.map(
        ({ id }) => id,
      ),
    ).toEqual([oldTitle.id]);
    expect(await sessions.getResultsAnalytics(workspaceId, { search })).toEqual({
      active: 0,
      finished: 1,
      participantJoins: 1,
      activity: {
        month: [{ start: "2024-01-01", count: 1 }],
        quarter: [{ start: "2024-01-01", count: 1 }],
      },
    });
  }
  expect(
    await sessions.getResultsAnalytics(workspaceId, { presentationId: foreign.presentationId }),
  ).toEqual({
    active: 0,
    finished: 0,
    participantJoins: 0,
    activity: { month: [], quarter: [] },
  });
  expect(await sessions.deleteSession(workspaceId, oldest.id)).toEqual({ status: "deleted" });
  expect(await sessions.listResultsSources(workspaceId)).toEqual([
    { id: owner.presentation.id, title: newerTie.title },
  ]);

  if (setPreciseDates) {
    // This reverses the native UUID tiebreaker so truncating the boundary would lose a row.
    await setPreciseDates(workspaceId, olderTie.id, newerTie.id);
    const precise = (await sessions.listResultsHistory(workspaceId, { limit: 1 })).items[0]!;
    expect(precise.id).toBe(olderTie.id);
    expect(precise.cursorCreatedAt).toBe("2025-04-01T00:01:00.123457Z");
    const next = await sessions.listResultsHistory(workspaceId, { cursor: precise, limit: 1 });
    expect(next.items[0]?.id).toBe(newerTie.id);
  }
}
