import { createHash, randomUUID } from "node:crypto";
import { PresentationContentSchema } from "@openround/contracts";
import { expect } from "vitest";
import {
  createPresentationPracticeAssignmentRepository,
  type CreatorContext,
  type Repository,
} from "../../src/index.js";
import { presentationSharingFixture } from "./presentation-sharing-conformance.js";
export async function practiceAssignmentFixture(repository: Repository) {
  const f = await presentationSharingFixture(repository, "practice"),
    assignments = createPresentationPracticeAssignmentRepository(repository);
  const choices = [
    {
      id: randomUUID(),
      label: "Accepted answer",
      isCorrect: true,
      feedback: "PRIVATE_SELECTED_FEEDBACK",
    },
    {
      id: randomUUID(),
      label: "Other answer",
      isCorrect: false,
      feedback: "PRIVATE_OTHER_FEEDBACK",
    },
  ];
  const content = PresentationContentSchema.parse({
    ...f.content,
    blocks: [
      f.content.blocks[0],
      {
        id: f.content.blocks[1]!.id,
        kind: "question",
        question: {
          id: randomUUID(),
          type: "single_select",
          prompt: "Choose one",
          choices,
          timeLimitSeconds: 30,
          basePoints: 1000,
          explanation: "PRIVATE_EXPLANATION",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  });
  const version = await f.presentations.publishPresentation(
    {
      ...f.version,
      id: randomUUID(),
      version: 2,
      content,
      contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
    },
    0,
  );
  const request = () => ({ ...f.request(), versionId: version.id });
  const input = request(),
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
  return { ...f, content, version, request, input, assignment, assignments, start, write, choices };
}
export async function expectPracticeConformance(repository: Repository) {
  const f = await practiceAssignmentFixture(repository),
    { assignment, assignments, start } = f;
  expect((await assignments.createAssignment(f.input)).replayed).toBe(true);
  await expect(
    assignments.createAssignment({ ...f.input, tokenHash: "f".repeat(64) }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const first = await assignments.startAttempt(start);
  expect(first.attempt).toMatchObject({
    revision: 0,
    readBlockIds: [],
    answers: {},
    completedAt: null,
  });
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
    questionId = f.content.blocks[1]!.id;
  await expect(f.write({ ...read, blockId: questionId })).rejects.toMatchObject({
    code: "INVALID_BLOCK",
  });
  await expect(
    f.write({ requestId: randomUUID(), expectedRevision: 0, kind: "complete" }),
  ).rejects.toMatchObject({ code: "INCOMPLETE" });
  await expect(
    f.write({
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "answer",
      blockId: questionId,
      choiceId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  const readResult = await f.write(read);
  const answer = {
    requestId: randomUUID(),
    expectedRevision: 1,
    kind: "answer" as const,
    blockId: questionId,
    choiceId: f.choices[1]!.id,
  };
  const concurrent = await Promise.allSettled([
    f.write(answer),
    f.write({ ...answer, requestId: randomUUID() }),
  ]);
  expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(concurrent.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "REVISION_CONFLICT" },
  });
  const current = (await assignments.getAttempt(
    assignment.id,
    start.attemptId,
    start.tokenHash,
    f.now,
  ))!.attempt;
  expect(current).toMatchObject({
    revision: 2,
    readBlockIds: [read.blockId, questionId],
    answers: { [questionId]: { choiceId: f.choices[1]!.id, correct: false, revision: 2 } },
  });
  expect(current.answers[questionId]!.submittedAt).toBeInstanceOf(Date);
  await expect(
    f.write({
      ...answer,
      requestId: randomUUID(),
      expectedRevision: 2,
      choiceId: f.choices[0]!.id,
    }),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  expect((await f.write(read)).attempt).toEqual(readResult.attempt);
  await expect(f.write({ ...read, blockId: questionId })).rejects.toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
  });
  expect((await assignments.startAttempt(start)).attempt).toEqual(first.attempt);
  const finish = { requestId: randomUUID(), expectedRevision: 2, kind: "complete" as const },
    completed = await f.write(finish);
  expect(completed.attempt.completedAt).toBeInstanceOf(Date);
  expect((await f.write(finish)).attempt).toEqual(completed.attempt);
  expect((await f.write(read)).attempt).toEqual(readResult.attempt);
  await expect(
    f.write({ ...read, requestId: randomUUID(), expectedRevision: 3 }),
  ).rejects.toMatchObject({ code: "COMPLETED" });
  const report = await assignments.getPracticeInsights(
    f.actor.workspaceId,
    f.presentation.id,
    assignment.id,
    f.actor.userId,
    f.now,
  );
  expect(report).toMatchObject({ started: 1, completed: 1, assignment });
  expect(Object.keys(report!).sort()).toEqual(
    ["assignment", "generatedAt", "started", "completed"].sort(),
  );
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
  await expect(f.write(read)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(
    await assignments.getPracticeInsights(
      f.actor.workspaceId,
      f.presentation.id,
      assignment.id,
      f.actor.userId,
      f.now,
    ),
  ).toMatchObject({ started: 1, completed: 1 });
  expect(
    await assignments.getPracticeInsights(
      f.actor.workspaceId,
      f.presentation.id,
      assignment.id,
      f.actor.userId,
      new Date(assignment.expiresAt.getTime() + 7 * 86400000),
    ),
  ).toBeNull();
  return f;
}
export async function expectPracticeLifecycle(repository: Repository) {
  const f = await practiceAssignmentFixture(repository);
  await f.assignments.startAttempt(f.start);
  await f.write({
    requestId: randomUUID(),
    expectedRevision: 0,
    kind: "answer",
    blockId: f.content.blocks[1]!.id,
    choiceId: f.choices[0]!.id,
  });
  const exported = (await repository.exportAccount(f.actor.userId))!;
  expect(exported.presentationPracticeAssignments).toHaveLength(1);
  const metadata = JSON.stringify(exported.presentationPracticeAssignments);
  for (const secret of [
    f.start.tokenHash,
    f.input.tokenHash,
    f.input.intentHash,
    "answers",
    "PRIVATE_SELECTED_FEEDBACK",
    "PRIVATE_EXPLANATION",
  ])
    expect(metadata).not.toContain(secret);
  expect(exported).not.toHaveProperty("presentationPracticeAttempts");
  await repository.deleteAccount(f.actor.userId);
  expect(
    await f.assignments.getAttempt(f.assignment.id, f.start.attemptId, f.start.tokenHash, f.now),
  ).toBeNull();
  return f;
}
export async function expectPracticeAuthority(
  repository: Repository,
  withPublisherDemoted: (actor: CreatorContext, check: () => Promise<void>) => Promise<void>,
) {
  const f = await practiceAssignmentFixture(repository);
  await f.assignments.startAttempt(f.start);
  const report = (actorId = f.actor.userId) =>
    f.assignments.getPracticeInsights(
      f.actor.workspaceId,
      f.presentation.id,
      f.assignment.id,
      actorId,
      f.now,
    );
  expect(await report()).toMatchObject({ started: 1, completed: 0 });
  const other = await presentationSharingFixture(repository, "other-practice");
  expect(await report(other.actor.userId)).toBeNull();
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
  expect(await report(other.actor.userId)).toMatchObject({ started: 1, completed: 0 });
  await withPublisherDemoted(f.actor, async () => {
    expect(await report()).toBeNull();
    expect(
      await f.assignments.getPublicAssignment(f.assignment.id, f.input.tokenHash, f.now),
    ).toBeNull();
    await expect(
      f.write({
        requestId: randomUUID(),
        expectedRevision: 0,
        kind: "read",
        blockId: f.content.blocks[0]!.id,
      }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
  await f.presentations.archivePresentation(f.actor.workspaceId, f.presentation.id, true);
  expect(
    await f.assignments.getPublicAssignment(f.assignment.id, f.input.tokenHash, f.now),
  ).not.toBeNull();
  await expect(f.assignments.createAssignment(f.request())).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  await f.presentations.deletePresentation(f.actor.workspaceId, f.presentation.id);
  expect(await report()).toBeNull();
  expect(
    await f.assignments.listAssignments(f.actor.workspaceId, f.presentation.id, f.actor.userId),
  ).toEqual([]);
}
export async function expectPracticeFrozenPublication(repository: Repository) {
  const f = await practiceAssignmentFixture(repository),
    question = f.content.blocks[1]!;
  if (question.kind !== "question" || !("choices" in question.question))
    throw new Error("Choice fixture required");
  const extra = {
    ...structuredClone(question),
    id: randomUUID(),
    question: {
      ...structuredClone(question.question),
      id: randomUUID(),
      choices: question.question.choices.map((choice) => ({ ...choice, id: randomUUID() })),
    },
  };
  const content = PresentationContentSchema.parse({
    ...f.content,
    blocks: [...f.content.blocks, extra],
  });
  const version = await f.presentations.publishPresentation(
    {
      ...f.version,
      id: randomUUID(),
      version: 3,
      content,
      contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
    },
    0,
  );
  const input = { ...f.request(), versionId: version.id },
    assignment = (await f.assignments.createAssignment(input)).assignment,
    start = {
      ...f.start,
      assignmentId: assignment.id,
      assignmentTokenHash: input.tokenHash,
      attemptId: randomUUID(),
    };
  await f.assignments.startAttempt(start);
  const first = {
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "answer" as const,
      blockId: question.id,
      choiceId: f.choices[0]!.id,
    },
    accepted = await f.assignments.mutateAttempt({ ...start, mutation: first });
  await f.assignments.mutateAttempt({
    ...start,
    mutation: {
      requestId: randomUUID(),
      expectedRevision: 1,
      kind: "answer",
      blockId: extra.id,
      choiceId: extra.question.choices[1]!.id,
    },
  });
  const replay = await f.assignments.mutateAttempt({ ...start, mutation: first });
  expect(replay.attempt).toEqual(accepted.attempt);
  expect(Object.keys(replay.attempt.answers)).toEqual([question.id]);
  replay.attempt.answers[question.id]!.correct = false;
  replay.attempt.answers[question.id]!.submittedAt.setTime(0);
  expect(
    (await f.assignments.getAttempt(assignment.id, start.attemptId, start.tokenHash, f.now))!
      .attempt.answers[question.id],
  ).toEqual(accepted.attempt.answers[question.id]);
  await expect(
    f.assignments.mutateAttempt({
      ...start,
      mutation: { requestId: randomUUID(), expectedRevision: 2, kind: "complete" },
    }),
  ).rejects.toMatchObject({ code: "INCOMPLETE" });
  const newer = PresentationContentSchema.parse({ ...f.content, blocks: [f.content.blocks[0]] });
  await f.presentations.publishPresentation(
    {
      ...f.version,
      id: randomUUID(),
      version: 4,
      content: newer,
      contentHash: createHash("sha256").update(JSON.stringify(newer)).digest("hex"),
    },
    0,
  );
  await f.assignments.mutateAttempt({
    ...start,
    mutation: {
      requestId: randomUUID(),
      expectedRevision: 2,
      kind: "read",
      blockId: f.content.blocks[0]!.id,
    },
  });
  const finished = await f.assignments.mutateAttempt({
    ...start,
    mutation: { requestId: randomUUID(), expectedRevision: 3, kind: "complete" },
  });
  expect(finished.attempt.completedAt).toBeInstanceOf(Date);
  expect(finished.version.id).toBe(version.id);
  expect(Object.keys(finished.attempt.answers)).toHaveLength(2);
  expect(finished.version.content).toEqual(content);
  const report = await f.assignments.getPracticeInsights(
    f.actor.workspaceId,
    f.presentation.id,
    assignment.id,
    f.actor.userId,
    f.now,
  );
  expect(report).toMatchObject({ started: 1, completed: 1 });
  await repository.claimWorkspaceMediaDeletion(f.actor.workspaceId);
  expect(
    await f.assignments.getAttempt(assignment.id, start.attemptId, start.tokenHash, f.now),
  ).toBeNull();
  expect(
    await f.assignments.getPracticeInsights(
      f.actor.workspaceId,
      f.presentation.id,
      assignment.id,
      f.actor.userId,
      f.now,
    ),
  ).toBeNull();
}
