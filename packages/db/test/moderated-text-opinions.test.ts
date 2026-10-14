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
import { expectTextOpinionPersistenceConformance } from "./support/text-opinion-conformance.js";

describe("moderated text opinion persistence", () => {
  it("fences new artifacts and text answers without changing legacy writer versions", () => {
    const question = {
      id: randomUUID(),
      type: "open_text" as const,
      prompt: "Feedback",
      timeLimitSeconds: 60,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    };
    const content = { title: "Feedback", description: "", questions: [question] };
    expect(roundArtifactSchemaVersion(content)).toBe(4);
    for (const parse of [upcastRoundDraft, upcastRoundContent]) {
      for (const version of [1, 2, 3])
        expect(() => parse(content, version)).toThrow("schema version 4");
      expect(parse(content, 4).questions[0]).toMatchObject(question);
      expect(() => parse(content, 5)).toThrow("Unsupported");
    }
    const response = { kind: "text" as const, value: "  Cafe\u0301  " };
    expect(roundResponseSchemaVersion(response)).toBe(5);
    for (const version of [1, 2, 3, 4])
      expect(() => upcastRoundResponse(response, version)).toThrow("schema version 5");
    expect(upcastRoundResponse(response, 5)).toEqual({ kind: "text", value: "Café" });
    expect(() => upcastRoundResponse(response, 6)).toThrow("Unsupported");
    expect(roundArtifactSchemaVersion({ ...content, questions: [] })).toBe(1);
    expect(
      roundArtifactSchemaVersion({
        ...content,
        questions: [{ ...question, type: "poll", maxSelections: 2, choices: [] }],
      }),
    ).toBe(2);
    expect(
      roundArtifactSchemaVersion({
        ...content,
        questions: [{ ...question, type: "ranking", choices: [] }],
      }),
    ).toBe(3);
    expect(
      roundResponseSchemaVersion({ kind: "poll", choiceIds: [randomUUID(), randomUUID()] }),
    ).toBe(3);
    expect(roundResponseSchemaVersion({ kind: "ranking", choiceIds: [randomUUID()] })).toBe(4);
  });
  it("persists bounded lookup, CAS moderation and safe account copies in memory", async () => {
    const repository = new MemoryRepository();
    const now = new Date();
    const tokenHash = randomUUID();
    await repository.createMagicToken({
      id: randomUUID(),
      email: `${randomUUID()}@example.com`,
      segment: "workplace",
      tokenHash,
      policyVersion: "test",
      expiresAt: new Date(now.getTime() + 60000),
      consumedAt: null,
    });
    const owner = (await repository.consumeMagicToken(tokenHash, now))!;
    await expectTextOpinionPersistenceConformance({
      repository,
      workspaceId: owner.workspaceId,
      editorId: owner.userId,
      otherWorkspaceId: randomUUID(),
      code: "1234567",
    });
  });
});
