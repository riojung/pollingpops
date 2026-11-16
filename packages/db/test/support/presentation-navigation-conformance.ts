import { createHash, randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { PresentationContentSchema, type PresentationContent } from "@openround/contracts";
import type {
  PresentationSessionCommandInput,
  PresentationSessionRepository,
  PresentationSessionResponseRecord,
} from "../../src/index.js";
import { presentationSessionConformanceContent } from "./presentation-session-conformance.js";

export function presentationNavigationSlide(title: string) {
  return {
    id: randomUUID(),
    kind: "content" as const,
    layout: "title_body" as const,
    textElements: [
      {
        id: randomUUID(),
        role: "title" as const,
        text: title,
        region: "top_center" as const,
        order: 0,
      },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "Private author cue",
  };
}

export function presentationNavigationContent(): PresentationContent {
  const question = presentationSessionConformanceContent().blocks[0]!;
  if (question.kind !== "question") throw new Error("Expected numeric question");
  question.id = question.id.toUpperCase();
  question.question.id = question.question.id.toUpperCase();
  return PresentationContentSchema.parse({
    ...presentationSessionConformanceContent(),
    schemaVersion: 12,
    blocks: [
      presentationNavigationSlide("Path"),
      question,
      presentationNavigationSlide("Detour"),
      presentationNavigationSlide("Skipped"),
    ],
    sections: [{ id: randomUUID(), title: "Core", blockIds: [question.id] }],
  });
}

export interface PresentationNavigationConformanceInput {
  repository: PresentationSessionRepository;
  workspaceId: string;
  presentationId: string;
  presentationVersionId: string;
  createdBy: string;
  content?: PresentationContent;
  recoveryPackCardsEnabled?: boolean;
  reopenRepository?: () => PresentationSessionRepository;
}

export async function createPresentationNavigationSession(
  input: PresentationNavigationConformanceInput,
) {
  const now = new Date();
  const content = input.content ?? presentationNavigationContent();
  const session = await input.repository.createSession({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    presentationId: input.presentationId,
    presentationVersionId: input.presentationVersionId,
    title: content.title,
    content,
    code: String(randomInt(1_000_000, 10_000_000)),
    status: "active",
    phase: "lobby",
    currentBlockIndex: -1,
    revision: 0,
    settings: { timeMode: "timed" },
    recoveryPackCardsEnabled: input.recoveryPackCardsEnabled,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 3_600_000),
    retentionExpiresAt: new Date(now.getTime() + 86_400_000),
  });
  return { session, content, now };
}

/** The same attempt, progress, receipt and concurrency contract runs against both backends. */
export async function expectPresentationNavigationConformance(
  input: PresentationNavigationConformanceInput,
) {
  let repository = input.repository;
  const fixture = await createPresentationNavigationSession(input);
  const { content, now } = fixture;
  let session = fixture.session;
  const question = content.blocks[1]!;
  if (question.kind !== "question") throw new Error("Expected numeric question");
  expect(session.navigationState).toEqual({ returnBlockId: null, blocks: [] });
  const makeCommand = (
    change: Pick<PresentationSessionCommandInput, "phase" | "currentBlockIndex" | "event"> &
      Partial<PresentationSessionCommandInput>,
  ): PresentationSessionCommandInput => ({
    workspaceId: input.workspaceId,
    sessionId: session.id,
    expectedRevision: session.revision,
    commandId: randomUUID(),
    requestHash: createHash("sha256").update(randomUUID()).digest("hex"),
    status: "active",
    occurredAt: new Date(now.getTime() + (session.revision + 1) * 1_000),
    ...change,
  });
  const accept = async (command: PresentationSessionCommandInput) => {
    const result = await repository.transitionSessionCommand(command);
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") throw new Error("Expected accepted navigation transition");
    session = result.session;
    return session;
  };
  await accept(
    makeCommand({
      phase: "content",
      currentBlockIndex: 0,
      event: { type: "content.presented", blockIndex: 0, blockId: content.blocks[0]!.id },
    }),
  );
  await accept(
    makeCommand({
      phase: "question_open",
      currentBlockIndex: 1,
      event: { type: "question.launched", blockIndex: 1, blockId: question.id },
    }),
  );
  const openedAt = session.questionOpenedAt!;
  const closesAt = session.questionClosesAt!;
  const participantId = randomUUID();
  await repository.addParticipant({
    id: participantId,
    workspaceId: input.workspaceId,
    sessionId: session.id,
    nickname: "Navigation learner",
    tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
    joinedAt: now,
    lastSeenAt: now,
  });
  const response: PresentationSessionResponseRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    sessionId: session.id,
    participantId,
    blockId: question.id,
    questionId: question.question.id,
    response: { numericValue: "1" },
    correct: true,
    score: 1000,
    responseMs: 1000,
    submittedAt: new Date(openedAt.getTime() + 1_000),
    idempotencyKey: randomUUID(),
    requestHash: "b".repeat(64),
  };
  expect((await repository.acceptResponse(response, session.revision)).status).toBe("accepted");
  await expect(
    repository.transitionSessionCommand(
      makeCommand({
        phase: "content",
        currentBlockIndex: 2,
        event: { type: "content.presented", blockIndex: 2, blockId: content.blocks[2]!.id },
      }),
    ),
  ).rejects.toThrow("Reveal");
  await accept(
    makeCommand({
      phase: "question_reveal",
      currentBlockIndex: 1,
      event: { type: "question.revealed", blockIndex: 1, blockId: question.id },
    }),
  );
  const closedProgress = structuredClone(
    session.navigationState!.blocks.find((entry) => entry.blockId === question.id),
  );
  expect(closedProgress).toMatchObject({
    phase: "question_reveal",
    questionOpenedAt: openedAt.toISOString(),
    questionClosesAt: closesAt.toISOString(),
  });
  const revealed = (await repository.listTimeline(session.id)).find(
    (event) => event.type === "question.revealed",
  )!;
  expect(revealed.revealedParticipantIds).toEqual([participantId]);
  const navigation = (
    index: number,
    type: "navigation.jumped" | "navigation.returned" | "navigation.revisited",
    anchor: string | null,
  ) => {
    const target = content.blocks[index]!;
    const previous = session.navigationState!.blocks.find(
      (entry) => entry.blockId.toLowerCase() === target.id.toLowerCase(),
    );
    return makeCommand({
      phase: previous?.phase ?? (target.kind === "content" ? "content" : "question_open"),
      currentBlockIndex: index,
      navigationState: { ...session.navigationState!, returnBlockId: anchor },
      event: {
        type,
        blockIndex: index,
        blockId: target.id,
        navigation: {
          fromBlockId: content.blocks[session.currentBlockIndex]!.id,
          toBlockId: target.id,
          returnBlockId: anchor,
          restored: Boolean(previous),
        },
      },
    });
  };
  const jump = navigation(2, "navigation.jumped", question.id);
  const jumpResults = await Promise.all([
    repository.transitionSessionCommand(jump),
    repository.transitionSessionCommand(jump),
  ]);
  expect(jumpResults.map((result) => result.status).sort()).toEqual(["accepted", "duplicate"]);
  const jumped = jumpResults.find((result) => result.status === "accepted")!;
  if (jumped.status !== "accepted") throw new Error("Expected one accepted detour");
  session = jumped.session;
  const jumpRevision = session.revision;
  await expect(
    repository.findCommandReceipt(input.workspaceId, session.id, jump.commandId),
  ).resolves.toMatchObject({
    expectedRevision: jump.expectedRevision,
    resultingRevision: jumpRevision,
    requestHash: jump.requestHash,
    eventType: "navigation.jumped",
  });
  await expect(
    repository.findCommandReceipt(randomUUID(), session.id, jump.commandId),
  ).resolves.toBeNull();
  if (input.reopenRepository) repository = input.reopenRepository();
  expect((await repository.getSessionById(session.id))!.navigationState).toEqual(
    session.navigationState,
  );
  await accept(navigation(1, "navigation.returned", null));
  expect(session.phase).toBe("question_reveal");
  expect(session.questionOpenedAt).toBeNull();
  expect(session.questionClosesAt).toBeNull();
  expect(session.navigationState!.blocks.find((entry) => entry.blockId === question.id)).toEqual(
    closedProgress,
  );
  expect((await repository.transitionSessionCommand(jump)).status).toBe("duplicate");
  expect(
    (await repository.transitionSessionCommand({ ...jump, requestHash: "c".repeat(64) })).status,
  ).toBe("idempotency_conflict");
  expect((await repository.acceptResponse(response, jump.expectedRevision)).status).toBe(
    "duplicate",
  );
  expect(await repository.listResponses(session.id)).toMatchObject([
    { id: response.id, correct: true, score: 1000 },
  ]);
  await expect(
    repository.transitionSessionCommand(
      makeCommand({
        phase: "question_open",
        currentBlockIndex: 1,
        event: { type: "question.launched", blockIndex: 1, blockId: question.id },
      }),
    ),
  ).rejects.toThrow(/cannot reopen|launch again/);
  const beforeRace = session.revision;
  const race = await Promise.allSettled([
    repository.transitionSessionCommand(navigation(0, "navigation.jumped", question.id)),
    repository.transitionSessionCommand(navigation(2, "navigation.jumped", question.id)),
  ]);
  expect(race.filter((result) => result.status === "rejected")).toHaveLength(1);
  const winner = race.find((result) => result.status === "fulfilled");
  if (!winner || winner.status !== "fulfilled" || winner.value.status !== "accepted")
    throw new Error("Expected one winning navigation CAS");
  session = winner.value.session;
  expect(session.revision).toBe(beforeRace + 1);
  await accept(navigation(1, "navigation.returned", null));
  await accept(navigation(2, "navigation.revisited", null));
  const timeline = await repository.listTimeline(session.id);
  expect(timeline.filter((event) => event.type === "question.launched")).toHaveLength(1);
  expect(timeline.filter((event) => event.type === "question.revealed")).toEqual([revealed]);
  expect(timeline.filter((event) => event.type === "navigation.jumped")).toHaveLength(2);
  expect(
    timeline.find((event) => event.type === "navigation.revisited")?.navigation?.restored,
  ).toBe(true);
  expect(
    session.navigationState!.blocks.some((entry) => entry.blockId === content.blocks[3]!.id),
  ).toBe(false);
  expect(session.content).toEqual(content);
  return { session, content, response, closedProgress, jump };
}
