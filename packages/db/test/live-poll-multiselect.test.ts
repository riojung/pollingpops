import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MemoryRepository,
  roundArtifactSchemaVersion,
  roundResponseSchemaVersion,
  upcastRoundContent,
  upcastRoundDraft,
  upcastRoundResponse,
} from "../src/index.js";
import { expectLivePollPersistenceConformance } from "./support/live-poll-conformance.js";

function poll() {
  return {
    id: randomUUID(),
    type: "poll" as const,
    prompt: "Which priorities?",
    maxSelections: 2,
    choices: ["One", "Two"].map((label) => ({ id: randomUUID(), label, isCorrect: false })),
    timeLimitSeconds: 30,
    basePoints: 0,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
}

describe("versioned live poll persistence", () => {
  it("does not reinterpret legacy artifact or response versions as multiple-selection polls", () => {
    const question = poll();
    const content = { title: "Opinions", description: "", questions: [question] };
    expect(roundArtifactSchemaVersion(content)).toBe(2);
    for (const parse of [upcastRoundDraft, upcastRoundContent]) {
      expect(() => parse(content, 1)).toThrow("schema version 2");
      expect(parse(content, 2).questions[0]?.maxSelections).toBe(2);
      expect(() => parse(content, 5)).toThrow("Unsupported");
    }
    const response = {
      kind: "poll" as const,
      choiceIds: question.choices.map((choice) => choice.id),
    };
    expect(roundResponseSchemaVersion(response)).toBe(3);
    expect(
      roundResponseSchemaVersion({ ...response, choiceIds: response.choiceIds.slice(0, 1) }),
    ).toBe(2);
    for (const version of [1, 2])
      expect(() => upcastRoundResponse(response, version)).toThrow("schema version 3");
    expect(upcastRoundResponse(response, 3)).toEqual(response);
    expect(() => upcastRoundResponse(response, 6)).toThrow("Unsupported");
    const legacy = { kind: "choice" as const, choiceIds: [randomUUID()] };
    expect(upcastRoundResponse(legacy, 1)).toEqual(legacy);
  });

  it("preserves extended immutable content, reversible draft history and acknowledged answers in memory", async () => {
    await expectLivePollPersistenceConformance({
      repository: new MemoryRepository(),
      workspaceId: randomUUID(),
      editorId: randomUUID(),
      otherWorkspaceId: randomUUID(),
      code: "1234567",
    });
  });
});
