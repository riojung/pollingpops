import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  RecoveryPackContentSchema,
  recoveryPackContentHash,
  type PresentationContent,
} from "@openround/contracts";
import {
  createPresentationSessionRepository,
  MemoryRepository,
  upcastPresentationContent,
  validatePresentationNavigationState,
  transitionPresentationNavigationState,
  type PresentationSessionCommandInput,
} from "../src/index.js";
import { transitionContent } from "../src/presentation-session-rules.js";
import { expectPresentationNavigationConformance } from "./support/presentation-navigation-conformance.js";
import { presentationSessionConformanceContent } from "./support/presentation-session-conformance.js";

import { recoveryPackDraft } from "./support/recovery-pack-conformance.js";
import { presentationPackMediaDraft } from "./support/presentation-pack-media-conformance.js";

const slide = (title: string) => ({
  id: randomUUID(),
  kind: "content" as const,
  layout: "title_body" as const,
  title,
  textElements: [{ id: randomUUID(), role: "title", text: title, region: "top_center", order: 0 }],
  mediaId: null,
  mediaAlt: null,
  speakerNotes: "",
});
export function navigationContent(): PresentationContent {
  return PresentationContentSchema.parse({
    ...presentationSessionConformanceContent(),
    schemaVersion: 12,
    blocks: [
      slide("Path"),
      ...presentationSessionConformanceContent().blocks,
      slide("Detour"),
      slide("Skipped"),
    ],
  });
}

describe("durable Presentation navigation", () => {
  it("satisfies the shared durable response, receipt, reconnect and CAS contract", async () => {
    await expectPresentationNavigationConformance({
      repository: createPresentationSessionRepository(new MemoryRepository()),
      workspaceId: randomUUID(),
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      createdBy: randomUUID(),
    });
  });

  it("keeps v12 opt-in and rejects mismatching stored versions", () => {
    const content = navigationContent();
    expect(upcastPresentationContent(content, 12)).toEqual(content);
    expect(() => upcastPresentationContent(content, 11)).toThrow();
    expect(() => upcastPresentationContent({ ...content, schemaVersion: 11 }, 12)).toThrow();
  });

  it("validates selected cards against the accepted frozen Pack update baseline", () => {
    const original = RecoveryPackContentSchema.parse(recoveryPackDraft());
    const draft = presentationPackMediaDraft(original);
    const accepted = structuredClone(original);
    accepted.interventions[0]!.id = randomUUID();
    accepted.interventions[0]!.body = "Updated explanation";
    const baseline = {
      packVersionId: randomUUID(),
      packVersion: 2,
      contentHash: recoveryPackContentHash(accepted),
      content: accepted,
    };
    draft.recoveryPackInsertions![0]!.updateBaseline = baseline;
    const content = PresentationContentSchema.parse({ ...draft, schemaVersion: 12 });
    const insertion = content.recoveryPackInsertions![0]!;
    const reference = {
      insertionId: insertion.id,
      packId: insertion.packId,
      packVersionId: baseline.packVersionId,
      packVersion: baseline.packVersion,
      contentHash: baseline.contentHash,
      cardId: accepted.interventions[0]!.id,
    };
    const state = {
      returnBlockId: null,
      blocks: [
        {
          blockId: content.blocks[0]!.id,
          phase: "intervention",
          questionOpenedAt: "2026-11-04T12:00:00.000Z",
          questionClosesAt: "2026-11-04T12:00:30.000Z",
          recoveryPackIntervention: { type: "explain", reference },
        },
      ],
    };
    expect(validatePresentationNavigationState(content, state)).toEqual(state);
    expect(() =>
      validatePresentationNavigationState(content, {
        ...state,
        blocks: [
          {
            ...state.blocks[0],
            recoveryPackIntervention: {
              type: "explain",
              reference: {
                ...reference,
                packVersionId: insertion.packVersionId,
                packVersion: insertion.packVersion,
                contentHash: insertion.contentHash,
                cardId: original.interventions[0]!.id,
              },
            },
          },
        ],
      }),
    ).toThrow("frozen diagnostic");
  });

  it("returns safely to a closed recheck anchor while denying direct jumps to it", async () => {
    const pack = RecoveryPackContentSchema.parse(recoveryPackDraft());
    const draft = presentationPackMediaDraft(pack);
    const content = PresentationContentSchema.parse({
      ...draft,
      schemaVersion: 12,
      blocks: [...draft.blocks, slide("Detour")],
    });
    const now = new Date("2026-11-04T12:00:00.000Z");
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const session = await repository.createSession({
      id: randomUUID(),
      workspaceId: randomUUID(),
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: content.title,
      content,
      code: "8152307",
      status: "active",
      phase: "content",
      currentBlockIndex: 2,
      revision: 4,
      createdBy: randomUUID(),
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 3600000),
      retentionExpiresAt: new Date(now.getTime() + 86400000),
    });
    session.navigationState = {
      returnBlockId: content.blocks[1]!.id,
      blocks: [
        ...content.blocks.slice(0, 2).map((block) => ({
          blockId: block.id,
          phase: "question_reveal" as const,
          questionOpenedAt: now.toISOString(),
          questionClosesAt: new Date(now.getTime() + 30000).toISOString(),
        })),
        {
          blockId: content.blocks[2]!.id,
          phase: "content",
          questionOpenedAt: null,
          questionClosesAt: null,
        },
      ],
    };
    const input = {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      expectedRevision: 4,
      phase: "question_reveal" as const,
      currentBlockIndex: 1,
      status: "active" as const,
      navigationState: { ...session.navigationState, returnBlockId: null },
      event: {
        type: "navigation.returned" as const,
        blockIndex: 1,
        blockId: content.blocks[1]!.id,
        navigation: {
          fromBlockId: content.blocks[2]!.id,
          toBlockId: content.blocks[1]!.id,
          returnBlockId: null,
          restored: true,
        },
      },
    };
    expect(
      transitionPresentationNavigationState(session, input, content, {
        questionOpenedAt: null,
        questionClosesAt: null,
      })!.blocks,
    ).toEqual(session.navigationState.blocks);
    expect(() =>
      transitionPresentationNavigationState(
        session,
        { ...input, event: { ...input.event, type: "navigation.jumped" } },
        content,
        { questionOpenedAt: null, questionClosesAt: null },
      ),
    ).toThrow("linked diagnostic");
  });

  it("retains original attempts, reveal rosters, anchor and receipt through jumps and revisits", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const content = navigationContent();
    const now = new Date("2026-11-04T12:00:00.000Z");
    let session = await repository.createSession({
      id: randomUUID(),
      workspaceId: randomUUID(),
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: content.title,
      content,
      code: "9350217",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      createdBy: randomUUID(),
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 3600000),
      retentionExpiresAt: new Date(now.getTime() + 86400000),
    });
    expect(session.navigationState).toEqual({ returnBlockId: null, blocks: [] });
    const insertion = {
      ...content,
      blocks: [
        content.blocks[0]!,
        slide("Session-only insertion") as (typeof content.blocks)[0],
        ...content.blocks.slice(1),
      ],
    };
    expect(transitionContent(session, { content: insertion }).blocks).toHaveLength(
      content.blocks.length + 1,
    );
    expect(() =>
      transitionContent(session, {
        content: { ...content, blocks: [...content.blocks].reverse() },
      }),
    ).toThrow("frozen blocks");
    expect(() =>
      transitionContent(session, {
        content: { ...content, sections: [] },
      }),
    ).toThrow("frozen sections");
    const edited = structuredClone(content);
    if (edited.blocks[0]?.kind === "content")
      edited.blocks[0].speakerNotes = "Changed frozen notes";
    expect(() => transitionContent(session, { content: edited })).toThrow("frozen blocks");

    const command = async (
      input: Partial<PresentationSessionCommandInput> &
        Pick<PresentationSessionCommandInput, "phase" | "currentBlockIndex" | "event">,
    ) => {
      const result = await repository.transitionSessionCommand({
        workspaceId: session.workspaceId,
        sessionId: session.id,
        expectedRevision: session.revision,
        commandId: randomUUID(),
        requestHash: "b".repeat(64),
        status: "active",
        occurredAt: now,
        ...input,
      });
      if (result.status !== "accepted") throw new Error("Expected transition");
      session = result.session;
      return session;
    };
    await command({
      phase: "content",
      currentBlockIndex: 0,
      event: { type: "content.presented", blockIndex: 0, blockId: content.blocks[0]!.id },
    });
    await command({
      phase: "question_open",
      currentBlockIndex: 1,
      event: { type: "question.launched", blockIndex: 1, blockId: content.blocks[1]!.id },
    });
    const openedAt = session.questionOpenedAt;
    const closesAt = session.questionClosesAt;
    await expect(
      command({
        phase: "content",
        currentBlockIndex: 2,
        event: { type: "content.presented", blockIndex: 2, blockId: content.blocks[2]!.id },
      }),
    ).rejects.toThrow("Reveal");
    await command({
      phase: "question_reveal",
      currentBlockIndex: 1,
      event: { type: "question.revealed", blockIndex: 1, blockId: content.blocks[1]!.id },
    });
    const closedProgress = structuredClone(session.navigationState!.blocks[1]);
    expect(closedProgress).toMatchObject({
      phase: "question_reveal",
      questionOpenedAt: openedAt!.toISOString(),
      questionClosesAt: closesAt!.toISOString(),
    });
    expect(session.questionOpenedAt).toBeNull();
    const jump: PresentationSessionCommandInput = {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      expectedRevision: session.revision,
      commandId: randomUUID(),
      requestHash: "c".repeat(64),
      status: "active",
      occurredAt: now,
      phase: "content",
      currentBlockIndex: 2,
      navigationState: { ...session.navigationState!, returnBlockId: content.blocks[1]!.id },
      event: {
        type: "navigation.jumped",
        blockIndex: 2,
        blockId: content.blocks[2]!.id,
        navigation: {
          fromBlockId: content.blocks[1]!.id,
          toBlockId: content.blocks[2]!.id,
          returnBlockId: content.blocks[1]!.id,
          restored: false,
        },
      },
    };
    const accepted = await repository.transitionSessionCommand(jump);
    if (accepted.status !== "accepted") throw new Error("Expected jump");
    session = accepted.session;
    await command({
      phase: "question_reveal",
      currentBlockIndex: 1,
      navigationState: { ...session.navigationState!, returnBlockId: null },
      event: {
        type: "navigation.returned",
        blockIndex: 1,
        blockId: content.blocks[1]!.id,
        navigation: {
          fromBlockId: content.blocks[2]!.id,
          toBlockId: content.blocks[1]!.id,
          returnBlockId: null,
          restored: true,
        },
      },
    });
    expect(session.navigationState!.blocks[1]).toEqual(closedProgress);
    expect((await repository.transitionSessionCommand(jump)).status).toBe("duplicate");
    expect(
      (await repository.transitionSessionCommand({ ...jump, requestHash: "d".repeat(64) })).status,
    ).toBe("idempotency_conflict");
    await expect(
      command({
        phase: "question_open",
        currentBlockIndex: 1,
        event: { type: "question.launched", blockIndex: 1, blockId: content.blocks[1]!.id },
      }),
    ).rejects.toThrow("cannot reopen");
    await expect(
      command({
        phase: "question_reveal",
        currentBlockIndex: 1,
        event: { type: "question.revealed", blockIndex: 1, blockId: content.blocks[1]!.id },
      }),
    ).rejects.toThrow("only once");
    const timeline = await repository.listTimeline(session.id);
    expect(timeline.filter((event) => event.type === "question.revealed")).toHaveLength(1);
    expect(
      timeline
        .filter((event) => event.type.startsWith("navigation."))
        .map((event) => event.navigation?.restored),
    ).toEqual([false, true]);
    expect((await repository.getSessionById(session.id))!.navigationState).toEqual(
      session.navigationState,
    );
    expect(
      session.navigationState!.blocks.some((block) => block.blockId === content.blocks[3]!.id),
    ).toBe(false);
  });
});
