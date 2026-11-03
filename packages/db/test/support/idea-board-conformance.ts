import { createHash, randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  IdeaBoardCreateSchema,
  IDEA_BOARD_MAX_ROUNDS,
  type IdeaBoardHostCommand,
} from "@openround/contracts";
import {
  createIdeaBoardRepository,
  createPlatformRepository,
  type Repository,
} from "../../src/index.js";

export const ideaGuestHash = () => createHash("sha256").update(randomUUID()).digest("hex");
export async function expectIdeaBoardRoundConformance(repository: Repository, workspaceId: string) {
  const boards = createIdeaBoardRepository(repository),
    now = new Date(),
    token = ideaGuestHash(),
    second = ideaGuestHash();
  const board = await boards.create(
    workspaceId,
    randomUUID(),
    IdeaBoardCreateSchema.parse({ title: "Reusable workshop" }),
    randomUUID(),
    {
      participantLimit: 10,
      closesAt: new Date(+now + 86_400_000).toISOString(),
      expiresAt: new Date(+now + 2 * 86_400_000).toISOString(),
    },
    now,
  );
  const host = async (command: IdeaBoardHostCommand, key = randomUUID()) => {
    const current = await boards.getModerator(workspaceId, board.id, now);
    return boards.hostCommand(workspaceId, board.id, command, current.revision, key, now);
  };
  await host({ type: "collect" });
  await boards.join(board.id, token, null, now);
  await boards.join(board.id, second, null, now);
  const submitKey = randomUUID();
  const submitted = await boards.submitIdea(board.id, token, "Approved priority", submitKey, now);
  const ideaId = submitted.ownIdeas[0]!.id;
  await boards.submitIdea(board.id, second, "PRIVATE pending intake", randomUUID(), now);
  await expect(host({ type: "start_voting" })).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
    message: "Approve at least one idea before voting",
  });
  await host({ type: "moderate", ideaId, status: "approved" });
  const groupId = randomUUID();
  await host({ type: "group.create", id: groupId, name: "Retained group" });
  await host({ type: "idea.group", ideaId, groupId });
  await host({ type: "start_voting" });
  const voteKey = randomUUID();
  const voted = await boards.vote(board.id, token, [ideaId], 0, voteKey, now);
  expect(voted.hasVoted).toBe(true);
  const closed = (await host({ type: "close" })).board;
  const reopenKey = randomUUID(),
    reopen = { type: "reopen" as const };
  const opened = await Promise.all([
    boards.hostCommand(workspaceId, board.id, reopen, closed.revision, reopenKey, now),
    boards.hostCommand(workspaceId, board.id, reopen, closed.revision, reopenKey, now),
  ]);
  expect(opened[0]?.receipt).toEqual(opened[1]?.receipt);
  expect(opened[0]?.board).toMatchObject({
    id: board.id,
    status: "collecting",
    roundNumber: 2,
    expiresAt: board.expiresAt,
    closesAt: board.expiresAt,
    roundHistory: [
      {
        roundNumber: 1,
        closedAt: now.toISOString(),
        ballotCount: 1,
        results: [{ ideaId, voteCount: 1 }],
      },
    ],
    roundHistoryIdeas: [{ ideaId, body: "Approved priority" }],
  });
  expect(opened[0]?.board.groups).toEqual([{ id: groupId, name: "Retained group" }]);
  const fresh = await boards.getGuest(board.id, token, now),
    untouched = await boards.getGuest(board.id, second, now);
  expect(fresh).toMatchObject({ revision: 2, hasVoted: false, votedIdeaIds: [] });
  expect(untouched.revision).toBe(1);
  expect(JSON.stringify(fresh.board.roundHistory)).not.toContain("PRIVATE pending intake");
  expect(fresh.board.ideas).toEqual([]);
  expect(fresh.ownIdeas[0]?.id).toBe(ideaId);
  expect(
    (await boards.submitIdea(board.id, token, "Approved priority", submitKey, now)).receipt,
  ).toEqual(submitted.receipt);
  expect(await boards.vote(board.id, token, [ideaId], 0, voteKey, now)).toMatchObject({
    receipt: voted.receipt,
    hasVoted: false,
    votedIdeaIds: [],
  });
  await expect(
    boards.submitIdea(board.id, token, "Late idea", randomUUID(), now),
  ).rejects.toMatchObject({ code: "STALE_DRAFT" });
  await expect(host({ type: "close", roundNumber: 1 })).rejects.toMatchObject({
    code: "STALE_DRAFT",
  });
  await expect(
    boards.vote(board.id, token, [ideaId], fresh.revision, randomUUID(), now, 1),
  ).rejects.toMatchObject({ code: "STALE_DRAFT" });
  await host({ type: "start_voting", roundNumber: 2 });
  await expect(
    boards.vote(board.id, token, [ideaId], voted.revision, randomUUID(), now, 2),
  ).rejects.toMatchObject({ code: "STALE_DRAFT" });
  const secondVote = await boards.vote(
    board.id,
    token,
    [ideaId],
    fresh.revision,
    randomUUID(),
    now,
    2,
  );
  expect(secondVote).toMatchObject({ revision: 3, hasVoted: true });
  await host({ type: "close", roundNumber: 2 });
  await host({ type: "reopen", roundNumber: 2, windowDays: 1 });
  await host({ type: "moderate", roundNumber: 3, ideaId, status: "removed" });
  const removed = await boards.getGuest(board.id, token, now);
  expect(removed.board.roundHistory.map((round) => round.results)).toEqual([
    [{ ideaId, voteCount: 1 }],
    [{ ideaId, voteCount: 1 }],
  ]);
  expect(removed.board.roundHistoryIdeas).toEqual([{ ideaId, body: null }]);
  for (let round = 3; round <= IDEA_BOARD_MAX_ROUNDS; round++) {
    await host({ type: "close", roundNumber: round });
    if (round < IDEA_BOARD_MAX_ROUNDS) await host({ type: "reopen", roundNumber: round });
  }
  const capped = await boards.getModerator(workspaceId, board.id, now);
  expect(capped.roundHistory).toHaveLength(19);
  expect(capped.roundHistory.at(-1)?.ballotCount).toBe(0);
  await expect(host({ type: "reopen", roundNumber: 20 })).rejects.toMatchObject({
    code: "ENTITLEMENT_LIMIT",
  });
  expect(await boards.getModerator(workspaceId, board.id, now)).toEqual(capped);
  await expect(
    boards.hostCommand(
      workspaceId,
      board.id,
      { type: "reopen", roundNumber: 20 },
      capped.revision,
      randomUUID(),
      new Date(board.expiresAt),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const earlier = new Date(+now - 7_200_000),
    deadline = new Date(+now - 3_600_000).toISOString();
  const timed = await boards.create(
    workspaceId,
    randomUUID(),
    IdeaBoardCreateSchema.parse({ title: "Deadline-closed round" }),
    randomUUID(),
    { participantLimit: 10, closesAt: deadline, expiresAt: board.expiresAt },
    earlier,
  );
  await boards.hostCommand(workspaceId, timed.id, { type: "collect" }, 0, randomUUID(), earlier);
  const renewed = await boards.hostCommand(
    workspaceId,
    timed.id,
    { type: "reopen" },
    1,
    randomUUID(),
    now,
  );
  expect(renewed.board).toMatchObject({
    status: "collecting",
    roundNumber: 2,
    roundHistory: [{ closedAt: deadline, ballotCount: 0, results: [] }],
  });
}
export async function expectIdeaBoardConformance(
  repository: Repository,
  workspaceId: string,
  otherWorkspaceId: string,
) {
  const boards = createIdeaBoardRepository(repository),
    now = new Date();
  const input = IdeaBoardCreateSchema.parse({ title: "Workshop priorities", voteBudget: 2 });
  const settings = {
    participantLimit: 10,
    closesAt: new Date(now.getTime() + 86_400_000).toISOString(),
    expiresAt: new Date(now.getTime() + 2 * 86_400_000).toISOString(),
  };
  const key = randomUUID(),
    id = randomUUID();
  const draft = await boards.create(workspaceId, id, input, key, settings, now);
  expect(draft).toMatchObject({ status: "draft", revision: 0, ideas: [], countsVisible: false });
  expect(
    await boards.create(
      workspaceId,
      randomUUID(),
      input,
      key,
      { ...settings, participantLimit: 5 },
      now,
    ),
  ).toEqual(draft);
  await expect(
    boards.create(workspaceId, id, { ...input, title: "Conflict" }, key, settings, now),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(await boards.getCreation(otherWorkspaceId, key, now)).toBeNull();
  await expect(boards.getModerator(otherWorkspaceId, id, now)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(boards.join(id, ideaGuestHash(), null, now)).rejects.toMatchObject({
    code: "ROOM_CLOSED",
  });
  await boards.hostCommand(workspaceId, id, { type: "collect" }, 0, randomUUID(), now);
  const token = ideaGuestHash(),
    secondToken = ideaGuestHash();
  await expect(boards.join(id, ideaGuestHash(), "Unwanted alias", now)).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  const joined = await boards.join(id, token, null, now);
  expect(joined.board.participantCount).toBeNull();
  await boards.join(id, secondToken, null, now);
  const submitKey = randomUUID();
  const own = await boards.submitIdea(id, token, "PRIVATE REMOVED IDEA", submitKey, now);
  const ideaId = own.ownIdeas[0]!.id;
  expect(own.board.ideas).toEqual([]);
  expect(own.ownIdeas).toMatchObject([{ body: "PRIVATE REMOVED IDEA", status: "pending" }]);
  expect(await boards.submitIdea(id, token, "PRIVATE REMOVED IDEA", submitKey, now)).toEqual(own);
  await expect(
    boards.submitIdea(id, token, "Different payload", submitKey, now),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect((await boards.getViewer(workspaceId, id, now)).ideas).toEqual([]);
  const info = await boards.getPublicInfo(id, now);
  expect(info).not.toHaveProperty("ideas");
  expect(info).not.toHaveProperty("participantCount");
  let board = await boards.getModerator(workspaceId, id, now);
  await expect(
    boards.hostCommand(
      workspaceId,
      id,
      { type: "moderate", ideaId, status: "approved" },
      board.revision - 1,
      randomUUID(),
      now,
    ),
  ).rejects.toMatchObject({ code: "STALE_DRAFT" });
  board = (
    await boards.hostCommand(
      workspaceId,
      id,
      { type: "moderate", ideaId, status: "approved" },
      board.revision,
      randomUUID(),
      now,
    )
  ).board;
  const groupId = randomUUID();
  board = (
    await boards.hostCommand(
      workspaceId,
      id,
      { type: "group.create", id: groupId, name: "Next week" },
      board.revision,
      randomUUID(),
      now,
    )
  ).board;
  board = (
    await boards.hostCommand(
      workspaceId,
      id,
      { type: "idea.group", ideaId, groupId },
      board.revision,
      randomUUID(),
      now,
    )
  ).board;
  expect(board.ideas[0]!.groupId).toBe(groupId);
  board = (
    await boards.hostCommand(
      workspaceId,
      id,
      { type: "moderate", ideaId, status: "removed" },
      board.revision,
      randomUUID(),
      now,
    )
  ).board;
  expect(board.ideas[0]).toMatchObject({
    body: null,
    alias: null,
    status: "removed",
    groupId: null,
  });
  expect(
    JSON.stringify(await boards.submitIdea(id, token, "PRIVATE REMOVED IDEA", submitKey, now)),
  ).not.toContain("PRIVATE REMOVED IDEA");
  await expect(
    boards.hostCommand(
      workspaceId,
      id,
      { type: "moderate", ideaId, status: "approved" },
      board.revision,
      randomUUID(),
      now,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const next = await boards.submitIdea(id, token, "Published priority", randomUUID(), now),
    approvedId = next.ownIdeas[1]!.id;
  board = await boards.getModerator(workspaceId, id, now);
  board = (
    await boards.hostCommand(
      workspaceId,
      id,
      { type: "moderate", ideaId: approvedId, status: "approved" },
      board.revision,
      randomUUID(),
      now,
    )
  ).board;
  const startKey = randomUUID(),
    startRevision = board.revision;
  const start = await boards.hostCommand(
    workspaceId,
    id,
    { type: "start_voting" },
    startRevision,
    startKey,
    now,
  );
  board = start.board;
  expect((await boards.getGuest(id, secondToken, now)).board.ideas).toMatchObject([
    { id: approvedId, voteCount: null },
  ]);
  for (const command of [
    { type: "moderate", ideaId: approvedId, status: "removed" },
    { type: "group.delete", groupId },
  ] as const)
    await expect(
      boards.hostCommand(workspaceId, id, command, board.revision, randomUUID(), now),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(
    boards.vote(id, token, [approvedId, approvedId], 0, randomUUID(), now),
  ).rejects.toThrow();
  await expect(boards.vote(id, token, [randomUUID()], 0, randomUUID(), now)).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  const voteKey = randomUUID();
  const concurrent = await Promise.all([
    boards.vote(id, token, [approvedId], 0, voteKey, now),
    boards.vote(id, token, [approvedId], 0, voteKey, now),
  ]);
  expect(concurrent[0].receipt).toEqual(concurrent[1].receipt);
  expect(concurrent[0]).toMatchObject({ votedIdeaIds: [approvedId], revision: 1 });
  await expect(boards.vote(id, token, [approvedId], 1, randomUUID(), now)).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  await boards.vote(id, secondToken, [approvedId], 0, randomUUID(), now);
  expect(
    (await boards.getModerator(workspaceId, id, now)).ideas.find((idea) => idea.id === approvedId)
      ?.voteCount,
  ).toBeNull();
  const closeKey = randomUUID(),
    closeRevision = board.revision;
  const close = await boards.hostCommand(
    workspaceId,
    id,
    { type: "close" },
    closeRevision,
    closeKey,
    now,
  );
  expect(close.board.ideas.find((idea) => idea.id === approvedId)?.voteCount).toBe(2);
  expect(close.board.countsVisible).toBe(true);
  await expect(
    boards.hostCommand(
      workspaceId,
      id,
      { type: "collect" },
      close.board.revision,
      randomUUID(),
      now,
    ),
  ).rejects.toMatchObject({ code: "ROOM_CLOSED" });
  expect(
    (
      await boards.hostCommand(
        workspaceId,
        id,
        { type: "start_voting" },
        startRevision,
        startKey,
        now,
      )
    ).receipt,
  ).toEqual(start.receipt);
  expect(
    (await boards.vote(id, token, [approvedId], 0, voteKey, new Date(settings.closesAt))).receipt,
  ).toEqual(concurrent[0].receipt);
  const serialized = JSON.stringify({
    moderator: close.board,
    guest: await boards.getGuest(id, token, now),
    info,
  });
  for (const forbidden of [
    token,
    secondToken,
    "guestId",
    "tokenHash",
    "workspaceId",
    "PRIVATE REMOVED IDEA",
  ])
    expect(serialized).not.toContain(forbidden);
  expect(close.board).not.toHaveProperty("guests");
  expect(close.board).not.toHaveProperty("votedIdeaIds");
  return { id, approvedId, token, voteKey, settings, now };
}

export async function expectIdeaBoardAdmissionConformance(
  repository: Repository,
  workspaceId: string,
) {
  const boards = createIdeaBoardRepository(repository),
    platform = createPlatformRepository(repository),
    now = new Date();
  const settings = {
    participantLimit: 1,
    closesAt: new Date(now.getTime() + 86_400_000).toISOString(),
    expiresAt: new Date(now.getTime() + 2 * 86_400_000).toISOString(),
  };
  const board = await boards.create(
    workspaceId,
    randomUUID(),
    IdeaBoardCreateSchema.parse({ title: "Bounded board", moderationEnabled: false }),
    randomUUID(),
    settings,
    now,
  );
  await boards.hostCommand(workspaceId, board.id, { type: "collect" }, 0, randomUUID(), now);
  await platform.setWorkspaceAdmissionRestriction(workspaceId, true);
  await expect(boards.join(board.id, ideaGuestHash(), null, now)).rejects.toMatchObject({
    code: "ADMISSION_RESTRICTED",
  });
  await platform.setWorkspaceAdmissionRestriction(workspaceId, false);
  const tokens = [ideaGuestHash(), ideaGuestHash()];
  const admissions = await Promise.allSettled(
    tokens.map((token) => boards.join(board.id, token, null, now)),
  );
  expect(admissions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(admissions.filter((result) => result.status === "rejected")).toMatchObject([
    { reason: { code: "PARTICIPANT_LIMIT" } },
  ]);
  const acceptedToken = tokens[admissions.findIndex((result) => result.status === "fulfilled")]!;
  await platform.setWorkspaceAdmissionRestriction(workspaceId, true);
  expect((await boards.join(board.id, acceptedToken, null, now)).revision).toBe(0);
  await platform.setWorkspaceAdmissionRestriction(workspaceId, false);
  for (let i = 0; i < 10; i++)
    await boards.submitIdea(board.id, acceptedToken, `Idea ${i}`, randomUUID(), now);
  await expect(
    boards.submitIdea(board.id, acceptedToken, "Over limit", randomUUID(), now),
  ).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT" });
  expect((await boards.getGuest(board.id, acceptedToken, now)).board.ideas).toEqual([]);
  await expect(
    boards.submitIdea(
      board.id,
      acceptedToken,
      "Deadline",
      randomUUID(),
      new Date(settings.closesAt),
    ),
  ).rejects.toMatchObject({ code: "ROOM_CLOSED" });
  expect(
    (await boards.getGuest(board.id, acceptedToken, new Date(settings.closesAt))).board.status,
  ).toBe("closed");
  return { id: board.id, settings };
}
