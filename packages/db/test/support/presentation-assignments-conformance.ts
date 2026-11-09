import { createHash, randomUUID } from "node:crypto";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  preparePresentationPublication,
} from "@openround/contracts";
import { expect } from "vitest";
import {
  createPresentationAssignmentRepository,
  type CreatorContext,
  type Repository,
} from "../../src/index.js";
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

export async function expectReadingReportConformance(
  repository: Repository,
  withPublisherDemoted?: (actor: CreatorContext, check: () => Promise<void>) => Promise<void>,
) {
  const f = await readingAssignmentFixture(repository),
    hiddenId = randomUUID(),
    content = PresentationContentSchema.parse(
      preparePresentationPublication(
        PresentationDraftSchema.parse({
          ...f.content,
          schemaVersion: 6,
          blocks: [...f.content.blocks, { ...f.content.blocks[0]!, id: hiddenId, hidden: true }],
        }),
      ),
    ),
    version = await f.presentations.publishPresentation(
      {
        ...f.version,
        id: randomUUID(),
        version: 2,
        content,
        contentSchemaVersion: 6,
        contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      },
      0,
    ),
    assignment = (await f.assignments.createAssignment({ ...f.request(), versionId: version.id }))
      .assignment,
    report = (now = f.now, actorId = f.actor.userId) =>
      f.assignments.getReadingReport(
        f.actor.workspaceId,
        f.presentation.id,
        assignment.id,
        actorId,
        now,
      ),
    visible = f.content.blocks.map((block) => block.id),
    empty = await report();
  expect(empty).toMatchObject({
    assignment,
    blockIds: visible,
    started: 0,
    completed: 0,
    readCounts: Object.fromEntries(visible.map((id) => [id, 0])),
  });
  // Preview and reports never create an attempt; another assignment's attempts are excluded.
  await f.assignments.startAttempt(f.start);
  expect((await report())!.started).toBe(0);
  const credential = (
    await f.assignments.listAssignments(f.actor.workspaceId, f.presentation.id, f.actor.userId)
  ).find((value) => value.id === assignment.id)!;
  const starts = Array.from({ length: 4 }, () => ({
    ...f.start,
    assignmentId: assignment.id,
    assignmentTokenHash: credential.tokenHash,
    attemptId: randomUUID(),
    tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
  }));
  for (const start of starts) await f.assignments.startAttempt(start);
  for (const [index, start] of starts.entries()) {
    if (index === 3) continue;
    const first = {
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "read" as const,
      blockId: visible[0]!,
    };
    await f.assignments.mutateAttempt({ ...start, mutation: first });
    await f.assignments.mutateAttempt({ ...start, mutation: first });
    if (index === 1) continue;
    await f.assignments.mutateAttempt({
      ...start,
      mutation: {
        requestId: randomUUID(),
        expectedRevision: 1,
        kind: "read",
        blockId: visible[1]!,
      },
    });
    if (index !== 0) continue;
    const complete = { requestId: randomUUID(), expectedRevision: 2, kind: "complete" as const };
    await f.assignments.mutateAttempt({ ...start, mutation: complete });
    await f.assignments.mutateAttempt({ ...start, mutation: complete });
    await f.assignments.startAttempt(start);
  }
  const counts = {
    blockIds: visible,
    started: 4,
    completed: 1,
    readCounts: { [visible[0]!]: 3, [visible[1]!]: 2 },
  };
  expect(await report()).toMatchObject(counts);
  // A newer publication cannot change this assignment's page order or eligible denominator.
  const newer = PresentationContentSchema.parse({
    ...f.content,
    blocks: [{ ...f.content.blocks[0]!, id: randomUUID() }],
  });
  await f.presentations.publishPresentation(
    {
      ...f.version,
      id: randomUUID(),
      version: 3,
      content: newer,
      contentHash: createHash("sha256").update(JSON.stringify(newer)).digest("hex"),
    },
    0,
  );
  const current = (await report())!;
  expect(current).toMatchObject(counts);
  expect(current.assignment.versionId).toBe(version.id);
  expect(current.generatedAt).toBeInstanceOf(Date);
  expect(current.generatedAt.getTime()).toBeGreaterThanOrEqual(f.now.getTime());
  expect(Object.keys(current).sort()).toEqual(
    ["assignment", "generatedAt", "blockIds", "started", "completed", "readCounts"].sort(),
  );
  expect(current.readCounts).not.toHaveProperty(hiddenId);
  for (const start of starts) expect(JSON.stringify(current)).not.toContain(start.tokenHash);
  expect(JSON.stringify(current)).not.toContain("PRIVATE_SPEAKER_NOTES");
  expect(JSON.stringify(current)).not.toContain("PRIVATE_EXPLANATION");
  const other = await readingAssignmentFixture(repository);
  expect(await report(f.now, other.actor.userId)).toBeNull();
  expect(
    await f.assignments.getReadingReport(
      other.actor.workspaceId,
      f.presentation.id,
      assignment.id,
      other.actor.userId,
      f.now,
    ),
  ).toBeNull();
  expect(
    await f.assignments.getReadingReport(
      f.actor.workspaceId,
      other.presentation.id,
      assignment.id,
      f.actor.userId,
      f.now,
    ),
  ).toBeNull();
  const invitationHash = createHash("sha256").update(randomUUID()).digest("hex");
  await repository.createWorkspaceInvitation({
    id: randomUUID(),
    workspaceId: f.actor.workspaceId,
    email: other.actor.email,
    role: "editor",
    tokenHash: invitationHash,
    invitedBy: f.actor.userId,
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date(),
  });
  await repository.acceptWorkspaceInvitation(invitationHash, new Date(), "test");
  expect(await report(f.now, other.actor.userId)).toMatchObject(counts);
  await repository.updateWorkspaceMemberRole(f.actor.workspaceId, other.actor.userId, "viewer");
  expect(await report(f.now, other.actor.userId)).toBeNull();
  await repository.updateWorkspaceMemberRole(f.actor.workspaceId, other.actor.userId, "editor");
  await withPublisherDemoted?.(f.actor, async () => {
    expect(await report(f.now, other.actor.userId)).toMatchObject(counts);
    expect(await report()).toBeNull();
  });
  await f.presentations.archivePresentation(f.actor.workspaceId, f.presentation.id, true);
  await f.assignments.revokeAssignment(
    f.actor.workspaceId,
    f.presentation.id,
    assignment.id,
    f.actor.userId,
    f.now,
  );
  expect(await report(f.now, other.actor.userId)).toMatchObject(counts);
  expect(await report(new Date(assignment.expiresAt))).toMatchObject(counts);
  const retentionEnd = new Date(assignment.expiresAt.getTime() + 7 * 86_400_000);
  expect(await report(new Date(retentionEnd.getTime() - 1))).toMatchObject(counts);
  expect(await report(retentionEnd)).toBeNull();
  expect(await report(new Date(Number.NaN))).toBeNull();
  await f.presentations.deletePresentation(f.actor.workspaceId, f.presentation.id);
  expect(await report()).toBeNull();
  expect(await report(f.now, other.actor.userId)).toBeNull();
  expect(
    await other.assignments.getReadingReport(
      other.actor.workspaceId,
      other.presentation.id,
      other.assignment.id,
      other.actor.userId,
      other.now,
    ),
  ).not.toBeNull();
  await repository.claimWorkspaceMediaDeletion(other.actor.workspaceId);
  expect(
    await other.assignments.getReadingReport(
      other.actor.workspaceId,
      other.presentation.id,
      other.assignment.id,
      other.actor.userId,
      other.now,
    ),
  ).toBeNull();
}
