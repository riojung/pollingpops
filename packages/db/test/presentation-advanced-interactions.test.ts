import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  MemoryRepository,
  createPresentationSessionRepository,
  upcastPresentationContent,
  upcastPresentationDraft,
  upcastPresentationSessionContent,
} from "../src/index.js";
import {
  advancedInteractionContent,
  expectAdvancedInteractionConformance,
} from "./support/presentation-advanced-interaction-conformance.js";
describe("durable advanced Presentation interactions", () => {
  it("keeps opt-in doc13/scene6 bytes and version fences", () => {
    const content = advancedInteractionContent();
    const bytes = JSON.stringify(content);
    for (const parse of [
      upcastPresentationContent,
      upcastPresentationDraft,
      upcastPresentationSessionContent,
    ]) {
      expect(JSON.stringify(parse(JSON.parse(bytes), 13))).toBe(bytes);
      expect(() => parse(content, 12)).toThrow();
    }
  });
  it("satisfies the shared atomic reveal, branch, response and receipt contract", async () => {
    await expectAdvancedInteractionConformance({
      repository: createPresentationSessionRepository(new MemoryRepository()),
      workspaceId: randomUUID(),
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      createdBy: randomUUID(),
    });
  });
});
