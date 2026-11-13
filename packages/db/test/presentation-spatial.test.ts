import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  resolvePresentationSpatialFrames,
  type PresentationContent,
} from "@openround/contracts";
import {
  MemoryRepository,
  createPresentationSessionRepository,
  upcastPresentationContent,
  upcastPresentationDraft,
  upcastPresentationSessionContent,
} from "../src/index.js";
import { transitionContent } from "../src/presentation-session-rules.js";
import {
  advancedInteractionContent,
  expectAdvancedInteractionConformance,
} from "./support/presentation-advanced-interaction-conformance.js";
import {
  createPresentationNavigationSession,
  expectPresentationNavigationConformance,
  presentationNavigationContent,
  presentationNavigationSlide,
} from "./support/presentation-navigation-conformance.js";

export function spatialContent(source = advancedInteractionContent()): PresentationContent {
  return PresentationContentSchema.parse({
    ...source,
    schemaVersion: 14,
    spatial: {
      schemaVersion: 1,
      frames: [
        { blockId: source.blocks[0]!.id.toUpperCase(), x: 320, y: 180, width: 1280, height: 720 },
      ],
    },
  });
}
describe("durable bounded Presentation spatial layout", () => {
  it.each([6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const)(
    "requires publication-valid initial session content in document%s",
    (schemaVersion) => {
      const content = PresentationContentSchema.parse({
        schemaVersion,
        title: "Published story",
        blocks: [presentationNavigationSlide("Visible slide")],
      });
      expect(upcastPresentationSessionContent(content, schemaVersion)).toEqual(content);
      const hidden = { ...content, blocks: [{ ...content.blocks[0]!, hidden: true as const }] };
      for (const invalid of [hidden, { ...content, blocks: [] }, { ...content, title: " " }]) {
        // These are valid editable drafts. Only the publication dispatch can reject them.
        expect(PresentationDraftSchema.safeParse(invalid).success).toBe(true);
        expect(() => upcastPresentationSessionContent(invalid, schemaVersion)).toThrow();
      }
    },
  );
  it("rejects unpublished14 content before an initial Memory session can be stored", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const content = PresentationContentSchema.parse({
      schemaVersion: 14,
      title: "Published story",
      blocks: [presentationNavigationSlide("Visible slide")],
    });
    const visible = content.blocks[0]!;
    if (visible.kind !== "content") throw new Error("Expected a visible content slide");
    const now = new Date(),
      workspaceId = randomUUID();
    const base = {
      workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: content.title,
      status: "active" as const,
      phase: "lobby" as const,
      currentBlockIndex: -1,
      revision: 0,
      createdBy: randomUUID(),
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 3600000),
      retentionExpiresAt: new Date(now.getTime() + 86400000),
    };
    const valid = await repository.createSession({
      ...base,
      id: randomUUID(),
      code: "9893400",
      content,
    });
    expect((await repository.getSessionById(valid.id))!.content).toEqual(content);
    const invalidContents = [
      { ...content, blocks: [{ ...visible, hidden: true as const }] },
      { ...content, blocks: [] },
      { ...content, title: " " },
    ];
    for (const [index, invalid] of invalidContents.entries()) {
      const id = randomUUID();
      await expect(
        repository.createSession({ ...base, id, code: String(9893401 + index), content: invalid }),
      ).rejects.toThrow();
      await expect(repository.getSessionById(id)).resolves.toBeNull();
    }
  });
  it("retains valid14 live insertion metadata through the content reader and keeps legacy partial reads unchanged", async () => {
    const original = spatialContent(presentationNavigationContent());
    const source = original.blocks.find((block) => block.kind === "question")!;
    if (source.kind !== "question") throw new Error("Expected numeric question");
    const quickCheck = {
      id: randomUUID(),
      kind: "question" as const,
      question: {
        id: randomUUID(),
        type: "poll" as const,
        prompt: "Session-only check",
        purpose: "opinion" as const,
        confidence: "off" as const,
        delivery: "main" as const,
        conceptKeys: [],
        linkedRecheckQuestionId: null,
        timeLimitSeconds: 30,
        basePoints: 0,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
        choices: ["First", "Second"].map((label) => ({
          id: randomUUID(),
          label,
          isCorrect: false,
        })),
      },
    };
    const publishedMarker = {
      commandId: randomUUID(),
      blockId: randomUUID(),
      sourceQuizId: randomUUID(),
      sourceQuizVersionId: randomUUID(),
      sourceQuizVersion: 1,
      sourceQuestionId: randomUUID(),
      contentHash: "a".repeat(64),
    };
    const publishedBlock = {
      id: publishedMarker.blockId,
      kind: "question" as const,
      question: { ...source.question, id: randomUUID() },
      provenance: {
        sourceQuizVersionId: publishedMarker.sourceQuizVersionId,
        sourceQuestionId: publishedMarker.sourceQuestionId,
      },
    };
    const content = PresentationContentSchema.parse({
      ...original,
      blocks: [...original.blocks, quickCheck, publishedBlock],
      liveQuickCheck: { commandId: randomUUID(), blockId: quickCheck.id },
      livePublishedQuestions: [publishedMarker],
    });
    const bytes = JSON.stringify(content);
    expect(JSON.stringify(upcastPresentationSessionContent(JSON.parse(bytes), 14))).toBe(bytes);
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const { session } = await createPresentationNavigationSession({
      repository,
      workspaceId: randomUUID(),
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      createdBy: randomUUID(),
      content,
    });
    const restored = (await repository.getSessionById(session.id))!.content;
    expect(restored.liveQuickCheck).toEqual(content.liveQuickCheck);
    expect(restored.livePublishedQuestions).toEqual([publishedMarker]);
    expect(restored.spatial).toEqual(original.spatial);
    expect(() =>
      upcastPresentationSessionContent(
        { ...content, liveQuickCheck: { ...content.liveQuickCheck, blockId: randomUUID() } },
        14,
      ),
    ).toThrow();
    expect(() =>
      upcastPresentationSessionContent(
        {
          ...content,
          livePublishedQuestions: [{ ...publishedMarker, sourceQuestionId: randomUUID() }],
        },
        14,
      ),
    ).toThrow();
    const legacy = { schemaVersion: 5, title: "", blocks: [] };
    expect(upcastPresentationSessionContent(legacy, 5)).toMatchObject(legacy);
  });
  it("adds exact14 and15 readers without rewriting13 hashes/defaults or accepting16", () => {
    const original = advancedInteractionContent(),
      bytes = JSON.stringify(original);
    const hash = createHash("sha256").update(bytes).digest("hex"),
      content = spatialContent(original);
    for (const parse of [
      upcastPresentationDraft,
      upcastPresentationContent,
      upcastPresentationSessionContent,
    ]) {
      expect(
        createHash("sha256")
          .update(JSON.stringify(parse(original, 13)))
          .digest("hex"),
      ).toBe(hash);
      expect(parse(content, 14)).toEqual(content);
      expect(() => parse(content, 13)).toThrow();
      expect(() => parse(original, 14)).toThrow();
      expect(parse({ ...content, schemaVersion: 15 }, 15)).toEqual({
        ...content,
        schemaVersion: 15,
      });
      expect(() => parse({ ...content, schemaVersion: 15 }, 14)).toThrow();
      expect(parse({ ...content, schemaVersion: 16 }, 16)).toEqual({
        ...content,
        schemaVersion: 16,
      });
      expect(() => parse({ ...content, schemaVersion: 18 }, 18)).toThrow("Unsupported");
    }
    expect(JSON.stringify(original)).toBe(bytes);
    expect(upcastPresentationContent({ ...content, spatial: undefined }, 14)).not.toHaveProperty(
      "spatial.frames",
    );
  });
  it("preserves scene6 reveal/branch behavior, durable receipts and accepted responses in14", async () => {
    await expectAdvancedInteractionConformance({
      repository: createPresentationSessionRepository(new MemoryRepository()),
      workspaceId: randomUUID(),
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      createdBy: randomUUID(),
      content: spatialContent(),
    });
  });
  it("preserves original question windows and closed revisits across14 navigation", async () => {
    await expectPresentationNavigationConformance({
      repository: createPresentationSessionRepository(new MemoryRepository()),
      workspaceId: randomUUID(),
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      createdBy: randomUUID(),
      content: spatialContent(presentationNavigationContent()),
    });
  });
  it("freezes spatial metadata during live insertions and resolves new blocks without persisted defaults", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const { session, content } = await createPresentationNavigationSession({
      repository,
      workspaceId: randomUUID(),
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      createdBy: randomUUID(),
      content: spatialContent(presentationNavigationContent()),
    });
    expect(session.interactionState).toEqual({ reveals: [] });
    const before = JSON.stringify(content.spatial);
    const appended = PresentationContentSchema.parse({
      ...content,
      blocks: [...content.blocks, presentationNavigationSlide("Live addition")],
    });
    const accepted = await repository.transitionSessionCommand({
      workspaceId: session.workspaceId,
      sessionId: session.id,
      expectedRevision: 0,
      commandId: randomUUID(),
      requestHash: "a".repeat(64),
      status: "active",
      phase: "content",
      currentBlockIndex: 0,
      content: appended,
      event: { type: "content.presented", blockId: content.blocks[0]!.id, blockIndex: 0 },
    });
    expect(accepted.status).toBe("accepted");
    const stored = (await repository.getSessionById(session.id))!;
    expect(JSON.stringify(stored.content.spatial)).toBe(before);
    expect(resolvePresentationSpatialFrames(stored.content).at(-1)).toMatchObject({
      blockId: appended.blocks.at(-1)!.id,
      x: 6400,
      y: 0,
      width: 1280,
      height: 720,
    });
    for (const spatial of [
      { ...content.spatial!, frames: [] },
      { ...content.spatial!, frames: [{ ...content.spatial!.frames[0]!, x: 640 }] },
      undefined,
    ]) {
      expect(() => transitionContent(stored, { content: { ...stored.content, spatial } })).toThrow(
        "frozen sections and spatial",
      );
    }
    expect(JSON.stringify((await repository.getSessionById(session.id))!.content.spatial)).toBe(
      before,
    );
  });
});
