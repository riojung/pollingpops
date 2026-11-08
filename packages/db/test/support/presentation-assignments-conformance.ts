import { createHash, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { createPresentationAssignmentRepository, type Repository } from "../../src/index.js";
import { presentationSharingFixture } from "./presentation-sharing-conformance.js";
export async function readingAssignmentFixture(repository: Repository) {
  const f = await presentationSharingFixture(repository, "reading"),
    assignments = createPresentationAssignmentRepository(repository),
    input = f.request(),
    assignment = (await assignments.createAssignment(input)).assignment;
  const start = {
    assignmentId: assignment.id,
    assignmentTokenHash: input.tokenHash,
    attemptId: randomUUID(),
    tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
    now: f.now,
  };
  const write = (mutation: Parameters<typeof assignments.mutateAttempt>[0]["mutation"]) =>
    assignments.mutateAttempt({
      assignmentId: assignment.id,
      attemptId: start.attemptId,
      tokenHash: start.tokenHash,
      mutation,
      now: f.now,
    });
  return { ...f, input, assignment, assignments, start, write };
}
export async function expectReadingConformance(repository: Repository) {
  const f = await readingAssignmentFixture(repository),
    { assignment, assignments, start } = f;
  expect((await assignments.createAssignment(f.input)).replayed).toBe(true);
  await expect(
    assignments.createAssignment({ ...f.input, tokenHash: "f".repeat(64) }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const first = await assignments.startAttempt(start);
  expect(first.attempt).toMatchObject({ revision: 0, readBlockIds: [], completedAt: null });
  await expect(
    assignments.startAttempt({ ...start, tokenHash: "f".repeat(64) }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(
    await assignments.getAttempt(assignment.id, start.attemptId, f.input.tokenHash, f.now),
  ).toBeNull();
  expect(await assignments.getPublicAssignment(assignment.id, start.tokenHash, f.now)).toBeNull();
  const read = {
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "read" as const,
      blockId: f.content.blocks[0]!.id,
    },
    readResult = await f.write(read);
  expect(readResult.attempt).toMatchObject({
    revision: 1,
    readBlockIds: [read.blockId],
    currentBlockId: read.blockId,
    completedAt: null,
  });
  await expect(
    f.write({ requestId: randomUUID(), expectedRevision: 1, kind: "complete" }),
  ).rejects.toMatchObject({ code: "INCOMPLETE" });
  await expect(f.write({ ...read, blockId: f.content.blocks[1]!.id })).rejects.toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
  });
  const concurrent = await Promise.allSettled([
    f.write({
      requestId: randomUUID(),
      expectedRevision: 1,
      kind: "read",
      blockId: f.content.blocks[1]!.id,
    }),
    f.write({ requestId: randomUUID(), expectedRevision: 1, kind: "read", blockId: read.blockId }),
  ]);
  expect(concurrent.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(concurrent.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "REVISION_CONFLICT" },
  });
  let current = (await assignments.getAttempt(
    assignment.id,
    start.attemptId,
    start.tokenHash,
    f.now,
  ))!.attempt;
  if (current.readBlockIds.length === 1) {
    await f.write({
      requestId: randomUUID(),
      expectedRevision: current.revision,
      kind: "read",
      blockId: f.content.blocks[1]!.id,
    });
    current = (await assignments.getAttempt(
      assignment.id,
      start.attemptId,
      start.tokenHash,
      f.now,
    ))!.attempt;
  }
  const replay = await f.write(read);
  expect(replay.replayed).toBe(true);
  expect(replay.attempt).toEqual(readResult.attempt);
  expect((await assignments.startAttempt(start)).attempt).toEqual(first.attempt);
  const finish = {
      requestId: randomUUID(),
      expectedRevision: current.revision,
      kind: "complete" as const,
    },
    finished = await f.write(finish);
  expect(finished.attempt.completedAt).toBeInstanceOf(Date);
  expect((await f.write(finish)).attempt).toEqual(finished.attempt);
  await expect(
    f.write({
      requestId: randomUUID(),
      expectedRevision: finished.attempt.revision,
      kind: "read",
      blockId: read.blockId,
    }),
  ).rejects.toMatchObject({ code: "COMPLETED" });
  expect(
    (await assignments.getPublicAssignment(assignment.id, f.input.tokenHash, f.now))!.version
      .contentHash,
  ).toBe(f.version.contentHash);
  expect(
    await assignments.getAttempt(
      assignment.id,
      start.attemptId,
      start.tokenHash,
      new Date(assignment.expiresAt),
    ),
  ).toBeNull();
  await expect(
    assignments.mutateAttempt({ ...start, mutation: read, now: new Date(assignment.expiresAt) }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await assignments.revokeAssignment(
    f.actor.workspaceId,
    f.presentation.id,
    assignment.id,
    f.actor.userId,
    f.now,
  );
  expect(
    await assignments.getAttempt(assignment.id, start.attemptId, start.tokenHash, f.now),
  ).toBeNull();
  expect(await assignments.getAssignmentAccess(assignment.id, f.input.tokenHash, f.now)).toBeNull();
  await expect(f.write(read)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  return f;
}
export async function expectReadingLifecycle(repository: Repository) {
  const f = await readingAssignmentFixture(repository);
  await f.assignments.startAttempt(f.start);
  await f.write({
    requestId: randomUUID(),
    expectedRevision: 0,
    kind: "read",
    blockId: f.content.blocks[0]!.id,
  });
  const exported = (await repository.exportAccount(f.actor.userId))!;
  expect(exported.presentationAssignments).toHaveLength(1);
  expect(exported.presentationReadingAttempts).toHaveLength(1);
  const metadata = JSON.stringify({
    assignments: exported.presentationAssignments,
    attempts: exported.presentationReadingAttempts,
  });
  expect(metadata).not.toContain(f.start.tokenHash);
  expect(metadata).not.toContain(f.input.tokenHash);
  expect(metadata).not.toContain(f.input.intentHash);
  expect(metadata).not.toContain("requestHash");
  await repository.deleteAccount(f.actor.userId);
  expect(
    await f.assignments.getAttempt(f.assignment.id, f.start.attemptId, f.start.tokenHash, f.now),
  ).toBeNull();
  return f;
}
