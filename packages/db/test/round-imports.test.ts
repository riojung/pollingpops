import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/index.js";
import {
  expectRoundImportAuthority,
  expectRoundImportDeletion,
  expectRoundImportRecovery,
  roundImportFixture,
} from "./support/round-import-conformance.js";

describe("Round import receipts in memory", () => {
  it("serializes confirmation and recovers current content", async () =>
    expectRoundImportRecovery(new MemoryRepository()));
  it("isolates actors and workspaces and checks current authority", async () =>
    expectRoundImportAuthority(new MemoryRepository()));
  it("retains consumed identities after archive and deletion", async () =>
    expectRoundImportDeletion(new MemoryRepository()));
  it("rolls back draft/history and retains no receipt when initial references fail", async () => {
    const repository = new MemoryRepository(),
      f = await roundImportFixture(repository);
    const record = f.record();
    record.draft.questions = [
      {
        id: randomUUID(),
        type: "single_select",
        prompt: "Review the procedure",
        choices: [
          { id: randomUUID(), label: "Complete check", isCorrect: true },
          { id: randomUUID(), label: "Skip check", isCorrect: false },
        ],
        timeLimitSeconds: 20,
        basePoints: 1000,
        explanation: "",
        mediaId: randomUUID(),
        mediaAlt: "Unavailable private reference",
      },
    ];
    await expect(repository.createImportedQuiz(record, f.identity())).rejects.toThrow(
      "unavailable in this workspace",
    );
    expect(await repository.listQuizzes(f.actor.workspaceId)).toEqual([]);
    expect(repository.quizDraftHistory.size).toBe(0);
    expect(await repository.getImportedQuiz(f.identity())).toBeNull();
    expect((await repository.createImportedQuiz(f.record(), f.identity())).status).toBe("created");
  });
});
