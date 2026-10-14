import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MemoryRepository,
  roundArtifactSchemaVersion,
  roundResponseSchemaVersion,
  upcastRoundDraft,
  upcastRoundContent,
  upcastRoundResponse,
} from "../src/index.js";
import { expectLivePollPersistenceConformance } from "./support/live-poll-conformance.js";

describe("versioned ranking persistence", () => {
  it("rejects ranking meanings under old artifact and response versions", () => {
    const question = {
      id: randomUUID(),
      type: "ranking" as const,
      prompt: "Rank these",
      rankCount: 2,
      choices: ["One", "Two", "Three"].map((label) => ({
        id: randomUUID(),
        label,
        isCorrect: false,
      })),
      timeLimitSeconds: 30,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    };
    const content = { title: "Rankings", description: "", questions: [question] };
    expect(roundArtifactSchemaVersion(content)).toBe(3);
    for (const parse of [upcastRoundDraft, upcastRoundContent]) {
      for (const version of [1, 2])
        expect(() => parse(content, version)).toThrow("schema version 3");
      expect(parse(content, 3).questions[0]).toMatchObject(question);
      expect(() => parse(content, 5)).toThrow("Unsupported");
    }
    const response = {
      kind: "ranking" as const,
      choiceIds: [question.choices[1]!.id, question.choices[0]!.id],
    };
    expect(roundResponseSchemaVersion(response)).toBe(4);
    for (const version of [1, 2, 3])
      expect(() => upcastRoundResponse(response, version)).toThrow("schema version 4");
    expect(upcastRoundResponse(response, 4)).toEqual(response);
    expect(() => upcastRoundResponse(response, 6)).toThrow("Unsupported");
  });
  it("preserves ordered ranking answers, history and immutable versions in memory", async () => {
    await expectLivePollPersistenceConformance({
      repository: new MemoryRepository(),
      workspaceId: randomUUID(),
      editorId: randomUUID(),
      otherWorkspaceId: randomUUID(),
      code: "1234567",
      ranking: true,
    });
  });
});
