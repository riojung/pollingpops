import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/index.js";
import {
  expectStarterCopyAuthority,
  expectStarterCopyDeletion,
  expectStarterCopyRecovery,
  starterCopyFixture,
} from "./support/starter-copy-conformance.js";

describe("Starter copy receipts in memory", () => {
  it("serializes confirmation and recovers current content", async () =>
    expectStarterCopyRecovery(new MemoryRepository()));
  it("isolates actors and workspaces and checks current authority", async () =>
    expectStarterCopyAuthority(new MemoryRepository()));
  it("retains consumed identities after archive and deletion", async () =>
    expectStarterCopyDeletion(new MemoryRepository()));
  it("expires unaccepted intents but retains accepted receipts and rejects excessive lifetimes", async () => {
    const repository = new MemoryRepository(),
      f = await starterCopyFixture(repository);
    await expect(
      repository.createStarterCopy(f.record(), { ...f.identity(), expiresAt: new Date(0) }),
    ).rejects.toMatchObject({ code: "STARTER_COPY_EXPIRED" });
    await expect(
      repository.createStarterCopy(f.record(), {
        ...f.identity(),
        expiresAt: new Date(Date.now() + 25 * 60 * 60_000),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INTENT" });
    expect(await repository.listQuizzes(f.actor.workspaceId)).toEqual([]);
    const accepted = await repository.createStarterCopy(f.record(), f.identity());
    expect(
      await repository.createStarterCopy(f.record(), { ...f.identity(), expiresAt: new Date(0) }),
    ).toMatchObject({ status: "duplicate", quiz: { id: accepted.quiz.id } });
  });
  it("blocks creation and recovery behind the workspace deletion fence", async () => {
    const repository = new MemoryRepository(),
      f = await starterCopyFixture(repository);
    await repository.createStarterCopy(f.record(), f.identity());
    await repository.claimWorkspaceMediaDeletion(f.actor.workspaceId);
    await expect(repository.getStarterCopy(f.identity())).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      repository.createStarterCopy(f.record(), { ...f.identity(), idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("rolls back draft/history and retains no receipt when initial references fail", async () => {
    const repository = new MemoryRepository(),
      f = await starterCopyFixture(repository);
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
    await expect(repository.createStarterCopy(record, f.identity())).rejects.toThrow(
      "unavailable in this workspace",
    );
    expect(await repository.listQuizzes(f.actor.workspaceId)).toEqual([]);
    expect(repository.quizDraftHistory.size).toBe(0);
    expect(await repository.getStarterCopy(f.identity())).toBeNull();
    expect((await repository.createStarterCopy(f.record(), f.identity())).status).toBe("created");
  });
});
