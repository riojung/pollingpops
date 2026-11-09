import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/index.js";
import {
  expectReadingConformance,
  expectReadingLifecycle,
  readingAssignmentFixture,
} from "./support/presentation-assignments-conformance.js";
describe("Presentation reading assignments", () => {
  it("pins reading progress, independent credentials, concurrent CAS and exact compact receipts", async () => {
    await expectReadingConformance(new MemoryRepository());
  });
  it("exports credential-free metadata and erases assignments and anonymous attempts", async () => {
    await expectReadingLifecycle(new MemoryRepository());
  });
  it("retains retries until seven days after assignment expiry and purges all children", async () => {
    const repository = new MemoryRepository(),
      f = await readingAssignmentFixture(repository);
    await f.assignments.startAttempt(f.start);
    await repository.purgeExpired(new Date(f.assignment.expiresAt.getTime() + 6 * 86400000));
    expect(
      await f.assignments.listAssignments(f.actor.workspaceId, f.presentation.id, f.actor.userId),
    ).toHaveLength(1);
    await repository.purgeExpired(new Date(f.assignment.expiresAt.getTime() + 7 * 86400000));
    expect(
      await f.assignments.listAssignments(f.actor.workspaceId, f.presentation.id, f.actor.userId),
    ).toHaveLength(0);
  });
  it("rejects invalid pages, changed creator authority and removed library sources", async () => {
    const repository = new MemoryRepository(),
      f = await readingAssignmentFixture(repository);
    await f.assignments.startAttempt(f.start);
    await expect(
      f.write({
        requestId: randomUUID(),
        expectedRevision: 0,
        kind: "read",
        blockId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_BLOCK" });
    repository.users.get(f.actor.userId)!.role = "viewer";
    expect(
      await f.assignments.getPublicAssignment(f.assignment.id, f.input.tokenHash, f.now),
    ).toBeNull();
    repository.users.get(f.actor.userId)!.role = "owner";
    await f.presentations.archivePresentation(f.actor.workspaceId, f.presentation.id, true);
    await expect(f.assignments.createAssignment(f.request())).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    await f.write({
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "read",
      blockId: f.content.blocks[0]!.id,
    });
    expect(
      await f.assignments.getAttempt(f.assignment.id, f.start.attemptId, f.start.tokenHash, f.now),
    ).not.toBeNull();
    await f.presentations.deletePresentation(f.actor.workspaceId, f.presentation.id);
    expect(
      await f.assignments.listAssignments(f.actor.workspaceId, f.presentation.id, f.actor.userId),
    ).toHaveLength(0);
  });
  it("caps progress receipts while preserving exact retries and remaining state", async () => {
    const f = await readingAssignmentFixture(new MemoryRepository());
    await f.assignments.startAttempt(f.start);
    const first = {
        requestId: randomUUID(),
        expectedRevision: 0,
        kind: "read" as const,
        blockId: f.content.blocks[0]!.id,
      },
      accepted = await f.write(first);
    for (let revision = 1; revision < 250; revision++)
      await f.write({
        requestId: randomUUID(),
        expectedRevision: revision,
        kind: "read",
        blockId: first.blockId,
      });
    await expect(
      f.write({
        requestId: randomUUID(),
        expectedRevision: 250,
        kind: "read",
        blockId: first.blockId,
      }),
    ).rejects.toMatchObject({ code: "RECEIPT_LIMIT" });
    expect((await f.write(first)).attempt).toEqual(accepted.attempt);
  });
});
