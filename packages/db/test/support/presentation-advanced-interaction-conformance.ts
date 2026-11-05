import { randomUUID, randomInt } from "node:crypto";
import { expect } from "vitest";
import { PresentationContentSchema, type PresentationContent } from "@openround/contracts";
import type {
  PresentationSessionRepository,
  PresentationSessionRecord,
  PresentationSessionCommandInput,
  PresentationSessionResponseRecord,
} from "../../src/index.js";
import { presentationSessionConformanceContent } from "./presentation-session-conformance.js";

export function advancedInteractionContent(): PresentationContent {
  const source = presentationSessionConformanceContent().blocks[0]!;
  const target = {
    id: randomUUID(),
    kind: "content",
    layout: "title_body",
    textElements: [
      {
        id: "target-title",
        role: "title",
        text: "Branch destination",
        region: "top_center",
        order: 0,
      },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "PRIVATE target notes",
  };
  return PresentationContentSchema.parse({
    title: "Advanced interactions",
    schemaVersion: 13,
    blocks: [
      {
        id: randomUUID(),
        kind: "content",
        layout: "title_body",
        textElements: [],
        mediaId: null,
        mediaAlt: null,
        speakerNotes: "PRIVATE scene notes",
        scene: {
          schemaVersion: 6,
          aspectRatio: "16:9",
          nodes: [
            {
              id: "title",
              type: "text",
              role: "title",
              text: "Explore the diagram",
              frame: { x: 0, y: 0, width: 100, height: 10 },
            },
            {
              id: "image",
              type: "image",
              mediaId: randomUUID(),
              altText: "Example diagram",
              frame: { x: 5, y: 15, width: 65, height: 75 },
            },
            {
              id: "hotspot",
              type: "hotspot",
              imageNodeId: "image",
              scope: "local",
              label: "Inspect detail",
              detailTitle: "Diagram detail",
              body: "Public local detail",
              frame: { x: 10, y: 25, width: 12, height: 12 },
            },
            {
              id: "dialog",
              type: "dialog",
              scope: "local",
              label: "Read detail",
              detailTitle: "Background",
              body: "Public background",
              frame: { x: 75, y: 15, width: 20, height: 15 },
            },
            {
              id: "navigation",
              type: "navigation",
              label: "Go to destination",
              targetBlockId: target.id,
              frame: { x: 75, y: 40, width: 20, height: 15 },
            },
            {
              id: "broadcast",
              type: "reveal",
              scope: "broadcast",
              label: "Presenter reveal",
              body: "PRIVATE UNTIL BROADCAST",
              frame: { x: 75, y: 65, width: 20, height: 15 },
            },
          ],
          readingOrder: ["title", "image", "hotspot", "dialog", "navigation", "broadcast"],
        },
      },
      {
        ...source,
        branches: [
          {
            id: randomUUID(),
            label: "Follow the evidence",
            condition: { kind: "correct_share", minPercent: 50, minResponses: 2 },
            targetBlockId: target.id,
          },
        ],
      },
      target,
    ],
  });
}

export interface AdvancedInteractionConformanceInput {
  repository: PresentationSessionRepository;
  workspaceId: string;
  presentationId: string;
  presentationVersionId: string;
  createdBy: string;
  content?: PresentationContent;
  reopenRepository?: () => PresentationSessionRepository;
}
export async function expectAdvancedInteractionConformance(
  input: AdvancedInteractionConformanceInput,
) {
  let repository = input.repository;
  const content = input.content ?? advancedInteractionContent();
  const now = new Date();
  let session: PresentationSessionRecord = await repository.createSession({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    presentationId: input.presentationId,
    presentationVersionId: input.presentationVersionId,
    title: content.title,
    content,
    code: String(randomInt(1000000, 10000000)),
    status: "active",
    phase: "lobby",
    currentBlockIndex: -1,
    revision: 0,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 3600000),
    retentionExpiresAt: new Date(now.getTime() + 86400000),
  });
  expect(session.interactionState).toEqual({ reveals: [] });
  const make = (
    value: Partial<PresentationSessionCommandInput> &
      Pick<PresentationSessionCommandInput, "phase" | "currentBlockIndex" | "event">,
  ): PresentationSessionCommandInput => ({
    workspaceId: input.workspaceId,
    sessionId: session.id,
    expectedRevision: session.revision,
    commandId: randomUUID(),
    requestHash: "a".repeat(64),
    occurredAt: now,
    status: "active",
    ...value,
  });
  const accept = async (command: PresentationSessionCommandInput) => {
    const result = await repository.transitionSessionCommand(command);
    if (result.status !== "accepted") throw new Error("Expected an accepted interaction");
    session = result.session;
    return session;
  };
  await accept(
    make({
      phase: "content",
      currentBlockIndex: 0,
      event: { type: "content.presented", blockIndex: 0, blockId: content.blocks[0]!.id },
    }),
  );
  const revealValue = { blockId: content.blocks[0]!.id, nodeId: "broadcast", revealed: true };
  const reveal = make({
    phase: "content",
    currentBlockIndex: 0,
    interactionState: { reveals: [revealValue] },
    event: {
      type: "scene.reveal_changed",
      blockId: content.blocks[0]!.id,
      blockIndex: 0,
      interaction: revealValue,
    },
  });
  await expect(
    repository.transitionSessionCommand({ ...reveal, requestHash: null }),
  ).rejects.toThrow("fingerprint");
  const beforeProgress = structuredClone(session.navigationState);
  await accept(reveal);
  expect(session.navigationState).toEqual(beforeProgress);
  expect(session.questionOpenedAt).toBeNull();
  await expect(
    repository.transitionSessionCommand(
      make({ ...reveal, commandId: randomUUID(), expectedRevision: session.revision }),
    ),
  ).rejects.toThrow("already");
  if (input.reopenRepository) repository = input.reopenRepository();
  expect((await repository.getSessionById(session.id))!.interactionState).toEqual({
    reveals: [revealValue],
  });
  const hidden = { ...revealValue, revealed: false };
  await accept(
    make({
      phase: "content",
      currentBlockIndex: 0,
      interactionState: { reveals: [hidden] },
      event: {
        type: "scene.reveal_changed",
        blockId: hidden.blockId,
        blockIndex: 0,
        interaction: hidden,
      },
    }),
  );
  expect((await repository.transitionSessionCommand(reveal)).status).toBe("duplicate");
  expect(
    (await repository.getSessionById(session.id))!.interactionState!.reveals[0]!.revealed,
  ).toBe(false);
  expect(
    (await repository.transitionSessionCommand({ ...reveal, requestHash: "b".repeat(64) })).status,
  ).toBe("idempotency_conflict");
  const question = content.blocks[1]!;
  if (question.kind !== "question") throw new Error("Expected numeric checkpoint");
  await accept(
    make({
      phase: "question_open",
      currentBlockIndex: 1,
      event: { type: "question.launched", blockIndex: 1, blockId: question.id },
    }),
  );
  const window = structuredClone(
    session.navigationState!.blocks.find((entry) => entry.blockId === question.id),
  );
  const branch = question.branches![0]!;
  const target = content.blocks[2]!;
  const branchCommand = () =>
    make({
      phase: "content",
      currentBlockIndex: 2,
      navigationState: { ...session.navigationState!, returnBlockId: question.id },
      event: {
        type: "navigation.branched",
        blockIndex: 2,
        blockId: target.id,
        navigation: {
          fromBlockId: question.id,
          toBlockId: target.id,
          returnBlockId: question.id,
          restored: false,
        },
        branch: {
          branchId: branch.id,
          sourceBlockId: question.id,
          targetBlockId: target.id,
          denominator: 2,
          matchedResponses: 1,
        },
      },
    });
  await expect(repository.transitionSessionCommand(branchCommand())).rejects.toThrow("Reveal");
  const responseIds: string[] = [];
  for (let index = 0; index < 2; index++) {
    const participantId = randomUUID();
    await repository.addParticipant({
      id: participantId,
      workspaceId: input.workspaceId,
      sessionId: session.id,
      nickname: `Reader ${index}`,
      tokenHash: randomUUID(),
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
      response: { numericValue: index === 0 ? "1" : "2" },
      correct: index === 0,
      score: index === 0 ? 1000 : 0,
      responseMs: 1000,
      submittedAt: new Date(now.getTime() + 1000),
      idempotencyKey: randomUUID(),
      requestHash: "c".repeat(64),
    };
    responseIds.push(response.id);
    expect((await repository.acceptResponse(response, session.revision)).status).toBe("accepted");
  }
  await accept(
    make({
      phase: "question_reveal",
      currentBlockIndex: 1,
      event: { type: "question.revealed", blockIndex: 1, blockId: question.id },
    }),
  );
  const validBranch = branchCommand();
  await expect(
    repository.transitionSessionCommand({
      ...validBranch,
      event: {
        ...validBranch.event,
        branch: { ...validBranch.event.branch!, matchedResponses: 2 },
      },
    }),
  ).rejects.toThrow("branch condition");
  await accept(validBranch);
  expect(
    session.navigationState!.blocks.find((entry) => entry.blockId === question.id),
  ).toMatchObject({ ...window, phase: "question_reveal" });
  expect(session.interactionState).toEqual({ reveals: [hidden] });
  expect((await repository.transitionSessionCommand(validBranch)).status).toBe("duplicate");
  expect(
    (await repository.listResponses(session.id)).map((response) => response.id).sort(),
  ).toEqual(responseIds.sort());
  const timeline = await repository.listTimeline(session.id);
  expect(
    timeline
      .filter((event) => event.type === "scene.reveal_changed")
      .map((event) => event.interaction?.revealed),
  ).toEqual([true, false]);
  expect(timeline.find((event) => event.type === "navigation.branched")?.branch).toEqual(
    validBranch.event.branch,
  );
  expect(timeline.filter((event) => event.type === "question.revealed")).toHaveLength(1);
  return { session, content, reveal, branch: validBranch };
}
