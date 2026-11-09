import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository, createPresentationPracticeAssignmentRepository } from "../src/index.js";
import {
  expectPracticeConformance,
  expectPracticeFrozenPublication,
  expectPracticeLifecycle,
  expectPracticeAuthority,
  practiceAssignmentFixture,
} from "./support/presentation-practice-conformance.js";
import { presentationSharingFixture } from "./support/presentation-sharing-conformance.js";
describe("Presentation practice assignments", () => {
  it("keeps frozen page/answer denominators, reconstructs answer cutoffs and fences workspace erasure", async () => {
    await expectPracticeFrozenPublication(new MemoryRepository());
  });
  it("pins one final response, page acknowledgements, independent capabilities, concurrent CAS and exact receipts", async () => {
    await expectPracticeConformance(new MemoryRepository());
  });
  it("exports safe assignment metadata without private attempts and cascades account erasure", async () => {
    await expectPracticeLifecycle(new MemoryRepository());
  });
  it("fences publisher/current reporter authority and preserves archive/source deletion semantics", async () => {
    const repository = new MemoryRepository();
    await expectPracticeAuthority(repository, async (actor, check) => {
      repository.users.get(actor.userId)!.role = "viewer";
      try {
        await check();
      } finally {
        repository.users.get(actor.userId)!.role = "owner";
      }
    });
  });
  it("rejects an unsupported entire publication before assignment creation", async () => {
    const repository = new MemoryRepository(),
      f = await presentationSharingFixture(repository, "unsupported-practice");
    await expect(
      createPresentationPracticeAssignmentRepository(repository).createAssignment(f.request()),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
  });
  it("caps accepted progress receipts while preserving exact historical retries", async () => {
    const f = await practiceAssignmentFixture(new MemoryRepository());
    await f.assignments.startAttempt(f.start);
    const first = {
        requestId: randomUUID(),
        expectedRevision: 0,
        kind: "read" as const,
        blockId: f.content.blocks[0]!.id,
      },
      accepted = await f.write(first);
    for (let revision = 1; revision < 100; revision++)
      await f.write({ ...first, requestId: randomUUID(), expectedRevision: revision });
    await expect(
      f.write({ ...first, requestId: randomUUID(), expectedRevision: 100 }),
    ).rejects.toMatchObject({ code: "RECEIPT_LIMIT" });
    expect((await f.write(first)).attempt).toEqual(accepted.attempt);
  });
  it("enforces the shared-source active assignment cap and seven-day child retention", async () => {
    const repository = new MemoryRepository(),
      f = await practiceAssignmentFixture(repository);
    await f.assignments.startAttempt(f.start);
    for (let i = 1; i < 10; i++) await f.assignments.createAssignment(f.request());
    await expect(f.assignments.createAssignment(f.request())).rejects.toMatchObject({
      code: "ASSIGNMENT_LIMIT",
    });
    await repository.purgeExpired(new Date(f.assignment.expiresAt.getTime() + 6 * 86400000));
    expect(
      await f.assignments.listAssignments(f.actor.workspaceId, f.presentation.id, f.actor.userId),
    ).toHaveLength(10);
    await repository.purgeExpired(new Date(f.assignment.expiresAt.getTime() + 7 * 86400000));
    expect(
      await f.assignments.listAssignments(f.actor.workspaceId, f.presentation.id, f.actor.userId),
    ).toEqual([]);
  });
});
