import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PresentationContentSchema } from "@openround/contracts";
import {
  MemoryRepository,
  createPresentationSessionRepository,
  PRESENTATION_DRAFT_SCHEMA_VERSION,
  PRESENTATION_CONTENT_SCHEMA_VERSION,
  PRESENTATION_INTERACTION_SCHEMA_VERSION,
  upcastPresentationContent,
  upcastPresentationDraft,
  upcastPresentationSessionContent,
} from "../src/index.js";
import { expectPresentationSceneConformance } from "./support/presentation-scene-conformance.js";
import { expectPresentationOpinionResponseConformance } from "./support/presentation-opinion-conformance.js";
import { expectPresentationTextConformance } from "./support/presentation-text-conformance.js";

import { interactionDocument } from "./support/presentation-interaction-fixture.js";

describe("Presentation v11 durable local interactions", () => {
  it("retains mixed old activities and exact scene bytes while leaving default versions unchanged", () => {
    const draft = interactionDocument();
    const bytes = JSON.stringify(draft);
    expect(PRESENTATION_INTERACTION_SCHEMA_VERSION).toBe(11);
    expect(PRESENTATION_DRAFT_SCHEMA_VERSION).toBe(2);
    expect(PRESENTATION_CONTENT_SCHEMA_VERSION).toBe(2);
    for (const parse of [
      upcastPresentationDraft,
      upcastPresentationContent,
      upcastPresentationSessionContent,
    ]) {
      expect(JSON.stringify(parse(JSON.parse(bytes), 11))).toBe(bytes);
      for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        expect(() => parse(draft, version)).toThrow();
    }
    expect(PresentationContentSchema.parse(draft)).toEqual(draft);
    const invalid = structuredClone(draft);
    const block = invalid.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("Expected native slide");
    const reveal = block.scene.nodes.find((node) => node.type === "reveal")!;
    if (reveal.type !== "reveal") throw new Error("Expected panel");
    reveal.body = "";
    expect(upcastPresentationDraft(invalid, 11)).toEqual(invalid);
    expect(() => upcastPresentationSessionContent(invalid, 11)).toThrow();
  });

  it("retains v11 panels, links, media and immutable hashes through retry, history, restore and cleanup", async () => {
    const repository = new MemoryRepository();
    const now = new Date();
    const tokenHash = randomUUID();
    await repository.createMagicToken({
      id: randomUUID(),
      email: `interactions-${randomUUID()}@example.com`,
      segment: "education",
      tokenHash,
      policyVersion: "test-v1",
      expiresAt: new Date(now.getTime() + 60000),
      consumedAt: null,
    });
    const actor = (await repository.consumeMagicToken(tokenHash, now))!;
    await expectPresentationSceneConformance({
      repository,
      workspaceId: actor.workspaceId,
      otherWorkspaceId: randomUUID(),
      editorId: actor.userId,
      interactions: true,
    });
  });

  it("preserves opinion response2 and private text response3 semantics in v11 interaction decks", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const input = {
      repository,
      workspaceId: randomUUID(),
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      createdBy: randomUUID(),
    };
    await expectPresentationOpinionResponseConformance({ ...input, schemaVersion: 11 });
    await expectPresentationTextConformance({ ...input, schemaVersion: 11 });
  });
});
