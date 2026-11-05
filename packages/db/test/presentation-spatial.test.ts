import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
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
  it("adds exact14 readers without rewriting13 hashes/defaults or accepting15", () => {
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
      expect(() => parse({ ...content, schemaVersion: 15 }, 15)).toThrow("Unsupported");
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
