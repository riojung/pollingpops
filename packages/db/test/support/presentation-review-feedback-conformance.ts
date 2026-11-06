import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  PresentationReviewFeedbackMutationResponseSchema,
  PresentationReviewFeedbackSchema,
  type PresentationReviewFeedbackCommand,
  type PresentationReviewFeedback,
} from "@openround/contracts";
import { createPresentationReviewFeedbackRepository, type Repository } from "../../src/index.js";
import { presentationSharingFixture } from "./presentation-sharing-conformance.js";

export async function reviewFeedbackIdentity(repository: Repository) {
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `review-${randomUUID()}@example.test`,
    segment: "education",
    tokenHash,
    policyVersion: "test",
    expiresAt: new Date(Date.now() + 60000),
    consumedAt: null,
  });
  return (await repository.consumeMagicLinkIdentity(tokenHash, new Date()))!.user;
}
export async function reviewFeedbackFixture(repository: Repository) {
  const f = await presentationSharingFixture(repository, "feedback"),
    input = f.request();
  const { share } = await f.shares.createShare(input),
    feedback = createPresentationReviewFeedbackRepository(repository);
  const first = await reviewFeedbackIdentity(repository),
    second = await reviewFeedbackIdentity(repository);
  const author = {
    workspaceId: f.actor.workspaceId,
    presentationId: f.presentation.id,
    shareId: share.id,
    actorId: f.actor.userId,
    now: f.now,
  };
  const reviewer = (actorId = first.userId) => ({
    shareId: share.id,
    tokenHash: input.tokenHash,
    actorId,
    now: f.now,
  });
  const mutation = (
    snapshot: PresentationReviewFeedback,
    command: PresentationReviewFeedbackCommand,
    operationId = randomUUID(),
  ) => ({
    schemaVersion: 1 as const,
    operationId,
    versionId: f.version.id,
    viewerKey: snapshot.viewerKey,
    command,
  });
  const enable = () =>
    feedback.enableReview({
      ...author,
      request: { operationId: randomUUID(), versionId: f.version.id },
    });
  return { ...f, input, share, feedback, first, second, author, reviewer, mutation, enable };
}

export async function expectReviewEnableOnceConformance(repository: Repository) {
  const f = await reviewFeedbackFixture(repository);
  const request = { operationId: randomUUID(), versionId: f.version.id };
  const original = (await f.feedback.enableReview({ ...f.author, request })).result.receipt;
  const rejectFreshEnable = async () => {
    const before = (await f.feedback.getAuthorReview(f.author)).feedback;
    const operationId = randomUUID();
    await expect(
      f.feedback.enableReview({ ...f.author, request: { ...request, operationId } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await f.feedback.getAuthorReview(f.author)).feedback).toEqual(before);
    const replay = (await f.feedback.enableReview({ ...f.author, request })).result;
    expect(replay).toEqual({ feedback: before, receipt: original, replayed: true });
    return { operationId, before };
  };
  const threadId = randomUUID();
  const initial = await rejectFreshEnable();
  const create = f.mutation(
    initial.before,
    {
      type: "thread.create",
      threadId,
      messageId: randomUUID(),
      blockId: f.content.blocks[0]!.id,
      text: "Real author feedback",
    },
    initial.operationId,
  );
  // Reusing each rejected enable ID for a real command proves no receipt was allocated.
  await f.feedback.mutateAuthorReview({ ...f.author, mutation: create });
  const commented = await rejectFreshEnable();
  await f.feedback.mutateAuthorReview({
    ...f.author,
    mutation: f.mutation(
      commented.before,
      { type: "thread.resolve", threadId, expectedThreadVersion: 1, resolved: true },
      commented.operationId,
    ),
  });
  const resolved = await rejectFreshEnable();
  await f.feedback.mutateAuthorReview({
    ...f.author,
    mutation: f.mutation(
      resolved.before,
      { type: "approval.set", expectedReviewSeq: resolved.before.reviewSeq, approved: true },
      resolved.operationId,
    ),
  });
  const approved = await rejectFreshEnable();
  expect(approved.before.approval.state).toBe("approved");
  const late = f.mutation(
    approved.before,
    {
      type: "thread.create",
      threadId: randomUUID(),
      messageId: randomUUID(),
      blockId: f.content.blocks[1]!.id,
      text: "Later real author feedback",
    },
    approved.operationId,
  );
  const final = (await f.feedback.mutateAuthorReview({ ...f.author, mutation: late })).result
    .feedback;
  expect(final.approval.state).toBe("stale");
  await expect(
    f.feedback.enableReview({
      ...f.author,
      request: { ...request, operationId: create.operationId },
    }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    f.feedback.mutateAuthorReview({
      ...f.author,
      mutation: { ...late, operationId: request.operationId },
    }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect((await f.feedback.getAuthorReview(f.author)).feedback).toEqual(final);
  await expect(
    f.feedback.enableReview({ ...f.author, actorId: f.first.userId, request }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(
    f.feedback.enableReview({ ...f.author, now: new Date(f.share.expiresAt), request }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await f.shares.revokeShare(
    f.actor.workspaceId,
    f.presentation.id,
    f.share.id,
    f.actor.userId,
    f.now,
  );
  for (const operationId of [request.operationId, randomUUID()])
    await expect(
      f.feedback.enableReview({ ...f.author, request: { ...request, operationId } }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  return f;
}

/** Same source, identity, receipt and CAS contract for memory and restricted PostgreSQL. */
export async function expectReviewFeedbackConformance(repository: Repository) {
  const f = await reviewFeedbackFixture(repository);
  const access = { shareId: f.share.id, tokenHash: f.input.tokenHash, now: f.now };
  expect((await f.feedback.getReviewAccess(access)).access).toMatchObject({
    enabled: false,
    signInRequired: false,
  });
  expect((await f.feedback.getReviewerReview(f.reviewer())).feedback).toMatchObject({
    status: "not_enabled",
    reviewSeq: 0,
    threads: [],
  });
  const request = { operationId: randomUUID(), versionId: f.version.id };
  const enabled = await Promise.all([
    f.feedback.enableReview({ ...f.author, request }),
    f.feedback.enableReview({ ...f.author, request }),
  ]);
  expect(enabled.map((value) => value.result.replayed).sort()).toEqual([false, true]);
  expect((await f.feedback.getReviewAccess(access)).access).toMatchObject({
    enabled: true,
    signInRequired: true,
  });
  let first = (await f.feedback.getReviewerReview(f.reviewer())).feedback;
  let second = (await f.feedback.getReviewerReview(f.reviewer(f.second.userId))).feedback;
  expect(first.viewerKey).not.toBe(second.viewerKey);
  const threadId = randomUUID(),
    messageId = randomUUID();
  const create = f.mutation(first, {
    type: "thread.create",
    threadId,
    messageId,
    blockId: f.content.blocks[0]!.id.toUpperCase(),
    text: "First public feedback",
  });
  const concurrent = await Promise.all([
    f.feedback.mutateReviewerReview({ ...f.reviewer(), mutation: create }),
    f.feedback.mutateReviewerReview({ ...f.reviewer(), mutation: create }),
  ]);
  expect(concurrent.map((value) => value.result.replayed).sort()).toEqual([false, true]);
  first = concurrent[0]!.result.feedback;
  expect(
    PresentationReviewFeedbackMutationResponseSchema.parse(concurrent[0]!.result),
  ).toBeDefined();
  expect(first.threads[0]).toMatchObject({
    blockId: f.content.blocks[0]!.id,
    blockIndex: 0,
    version: 1,
    messages: [expect.objectContaining({ authorLabel: "Reviewer 1", isOwn: true })],
  });
  await expect(
    f.feedback.mutateReviewerReview({ ...f.reviewer(f.second.userId), mutation: create }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(
    f.feedback.mutateReviewerReview({
      ...f.reviewer(),
      mutation: {
        ...create,
        command: {
          type: "thread.create",
          threadId,
          messageId,
          blockId: f.content.blocks[0]!.id,
          text: "different",
        },
      },
    }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    f.feedback.mutateReviewerReview({
      ...f.reviewer(),
      mutation: f.mutation(first, {
        type: "thread.create",
        threadId: randomUUID(),
        messageId: randomUUID(),
        blockId: randomUUID(),
        text: "foreign",
      }),
    }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(
    f.feedback.mutateReviewerReview({
      ...f.reviewer(f.second.userId),
      mutation: f.mutation(second, {
        type: "message.edit",
        threadId,
        messageId,
        expectedThreadVersion: 1,
        text: "take over",
      }),
    }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(
    f.feedback.mutateReviewerReview({
      ...f.reviewer(),
      mutation: f.mutation(first, {
        type: "thread.resolve",
        threadId,
        expectedThreadVersion: 1,
        resolved: true,
      }),
    }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  second = (
    await f.feedback.mutateReviewerReview({
      ...f.reviewer(f.second.userId),
      mutation: f.mutation(second, {
        type: "message.reply",
        threadId,
        messageId: randomUUID(),
        expectedThreadVersion: 1,
        text: "Second reviewer",
      }),
    })
  ).result.feedback;
  expect(second.threads[0]!.messages.map((value) => value.authorLabel)).toEqual([
    "Reviewer 1",
    "Reviewer 2",
  ]);
  const attempts = await Promise.allSettled(
    ["A", "B"].map((text) =>
      f.feedback.mutateReviewerReview({
        ...f.reviewer(),
        mutation: f.mutation(first, {
          type: "message.reply",
          threadId,
          messageId: randomUUID(),
          expectedThreadVersion: 2,
          text,
        }),
      }),
    ),
  );
  expect(attempts.filter((value) => value.status === "fulfilled")).toHaveLength(1);
  expect(attempts.filter((value) => value.status === "rejected")).toHaveLength(1);
  first = (await f.feedback.getReviewerReview(f.reviewer())).feedback;
  expect(first.threads[0]!.messages.at(-1)!.authorLabel).toBe("Reviewer 1");
  first = (
    await f.feedback.mutateReviewerReview({
      ...f.reviewer(),
      mutation: f.mutation(first, {
        type: "message.edit",
        threadId,
        messageId,
        expectedThreadVersion: 3,
        text: "Edited feedback",
      }),
    })
  ).result.feedback;
  first = (
    await f.feedback.mutateReviewerReview({
      ...f.reviewer(),
      mutation: f.mutation(first, {
        type: "message.delete",
        threadId,
        messageId,
        expectedThreadVersion: 4,
      }),
    })
  ).result.feedback;
  const late = (await f.feedback.mutateReviewerReview({ ...f.reviewer(), mutation: create }))
    .result;
  expect(late.replayed).toBe(true);
  expect(late.receipt.reviewSeq).toBe(2);
  expect(late.feedback.threads[0]!.messages[0]).toMatchObject({
    text: "",
    deleted: true,
    version: 3,
  });
  expect(JSON.stringify(late.feedback)).not.toContain("First public feedback");
  let author = (await f.feedback.getAuthorReview(f.author)).feedback;
  await expect(
    f.feedback.mutateAuthorReview({
      ...f.author,
      mutation: f.mutation(author, {
        type: "approval.set",
        expectedReviewSeq: author.reviewSeq,
        approved: true,
      }),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  author = (
    await f.feedback.mutateAuthorReview({
      ...f.author,
      mutation: f.mutation(author, {
        type: "message.reply",
        threadId,
        messageId: randomUUID(),
        expectedThreadVersion: 5,
        text: "Author response",
      }),
    })
  ).result.feedback;
  expect(author.threads[0]!.messages.at(-1)).toMatchObject({
    authorLabel: "Author",
    authorRole: "author",
    isOwn: true,
  });
  author = (
    await f.feedback.mutateAuthorReview({
      ...f.author,
      mutation: f.mutation(author, {
        type: "thread.resolve",
        threadId,
        expectedThreadVersion: 6,
        resolved: true,
      }),
    })
  ).result.feedback;
  author = (
    await f.feedback.mutateAuthorReview({
      ...f.author,
      mutation: f.mutation(author, {
        type: "approval.set",
        expectedReviewSeq: author.reviewSeq,
        approved: true,
      }),
    })
  ).result.feedback;
  expect(author.approval.state).toBe("approved");
  first = (
    await f.feedback.mutateReviewerReview({
      ...f.reviewer(),
      mutation: f.mutation(first, {
        type: "thread.create",
        threadId: randomUUID(),
        messageId: randomUUID(),
        blockId: f.content.blocks[1]!.id,
        text: "Later feedback",
      }),
    })
  ).result.feedback;
  expect(first.approval.state).toBe("stale");
  expect(first.threads[1]!.blockIndex).toBe(1);
  const json = JSON.stringify(PresentationReviewFeedbackSchema.parse(first));
  for (const secret of [
    f.actor.userId,
    f.first.userId,
    f.second.userId,
    f.first.email,
    "PRIVATE_SPEAKER_NOTES",
    "PRIVATE_EXPLANATION",
    "correctValue",
    "tokenHash",
    "actorId",
  ])
    expect(json).not.toContain(secret);
  const restarted = createPresentationReviewFeedbackRepository(repository);
  expect((await restarted.getReviewerReview(f.reviewer())).feedback).toEqual(first);
  await f.shares.revokeShare(
    f.actor.workspaceId,
    f.presentation.id,
    f.share.id,
    f.actor.userId,
    f.now,
  );
  await expect(f.feedback.getReviewerReview(f.reviewer())).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  await expect(
    f.feedback.mutateReviewerReview({ ...f.reviewer(), mutation: create }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(f.feedback.enableReview({ ...f.author, request })).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  const closed = (await f.feedback.getAuthorReview(f.author)).feedback;
  expect(closed.status).toBe("closed");
  expect(closed.capabilities).toEqual({
    enable: false,
    comment: false,
    resolve: false,
    approve: false,
  });
  return f;
}

export async function expectReviewFeedbackErasure(repository: Repository) {
  const f = await reviewFeedbackFixture(repository);
  await f.enable();
  const first = (await f.feedback.getReviewerReview(f.reviewer())).feedback;
  const threadId = randomUUID(),
    messageId = randomUUID();
  const mutation = f.mutation(first, {
    type: "thread.create",
    threadId,
    messageId,
    blockId: f.content.blocks[0]!.id,
    text: "ERASE_EXTERNAL_REVIEW_BODY",
  });
  await f.feedback.mutateReviewerReview({ ...f.reviewer(), mutation });
  let second = (await f.feedback.getReviewerReview(f.reviewer(f.second.userId))).feedback;
  second = (
    await f.feedback.mutateReviewerReview({
      ...f.reviewer(f.second.userId),
      mutation: f.mutation(second, {
        type: "message.reply",
        threadId,
        messageId: randomUUID(),
        expectedThreadVersion: 1,
        text: "OTHER_REVIEWER_BODY",
      }),
    })
  ).result.feedback;
  const exported = await repository.exportAccount(f.first.userId);
  const own = exported.presentationReviewMessages as { text: string }[];
  expect(own.map((message) => message.text)).toEqual(["ERASE_EXTERNAL_REVIEW_BODY"]);
  expect(JSON.stringify(exported)).not.toContain("OTHER_REVIEWER_BODY");
  expect(JSON.stringify(exported.presentationReviewMessages)).not.toMatch(
    /request_hash|requestHash|tokenHash|viewerKey/,
  );
  await repository.deleteAccount(f.first.userId);
  const after = (await f.feedback.getReviewerReview(f.reviewer(f.second.userId))).feedback;
  expect(after.reviewSeq).toBe(second.reviewSeq + 1);
  expect(after.threads[0]!.version).toBe(3);
  expect(after.threads[0]!.messages[0]).toMatchObject({
    text: "",
    deleted: true,
    isOwn: false,
    version: 2,
  });
  await expect(
    f.feedback.mutateReviewerReview({
      ...f.reviewer(f.second.userId),
      mutation: f.mutation(second, {
        type: "message.reply",
        threadId,
        messageId: randomUUID(),
        expectedThreadVersion: 2,
        text: "stale",
      }),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    f.feedback.mutateReviewerReview({ ...f.reviewer(), mutation }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  const ownerExport = await repository.exportAccount(f.actor.userId);
  expect(JSON.stringify(ownerExport.presentationReviewMessages)).not.toContain(
    "ERASE_EXTERNAL_REVIEW_BODY",
  );
  expect(
    (await f.presentations.getPresentationVersion(f.actor.workspaceId, f.version.id))?.contentHash,
  ).toBe(f.version.contentHash);
  return f;
}

export async function expectReviewFeedbackRevokedExport(repository: Repository) {
  const f = await reviewFeedbackFixture(repository);
  await f.enable();
  const first = (await f.feedback.getReviewerReview(f.reviewer())).feedback,
    threadId = randomUUID();
  await f.feedback.mutateReviewerReview({
    ...f.reviewer(),
    mutation: f.mutation(first, {
      type: "thread.create",
      threadId,
      messageId: randomUUID(),
      blockId: f.content.blocks[0]!.id,
      text: "OWN_EXTERNAL_BODY",
    }),
  });
  const second = (await f.feedback.getReviewerReview(f.reviewer(f.second.userId))).feedback;
  await f.feedback.mutateReviewerReview({
    ...f.reviewer(f.second.userId),
    mutation: f.mutation(second, {
      type: "message.reply",
      threadId,
      messageId: randomUUID(),
      expectedThreadVersion: 1,
      text: "OTHER_EXTERNAL_BODY",
    }),
  });
  const author = (await f.feedback.getAuthorReview(f.author)).feedback;
  await f.feedback.mutateAuthorReview({
    ...f.author,
    mutation: f.mutation(author, {
      type: "message.reply",
      threadId,
      messageId: randomUUID(),
      expectedThreadVersion: 2,
      text: "AUTHOR_PRIVATE_BODY",
    }),
  });
  await f.shares.revokeShare(
    f.actor.workspaceId,
    f.presentation.id,
    f.share.id,
    f.actor.userId,
    f.now,
  );
  const own = await repository.exportAccount(f.first.userId);
  expect(
    (own.presentationReviewMessages as { text: string }[]).map((message) => message.text),
  ).toEqual(["OWN_EXTERNAL_BODY"]);
  expect(JSON.stringify(own)).not.toMatch(
    /OTHER_EXTERNAL_BODY|AUTHOR_PRIVATE_BODY|request_hash|requestHash|tokenHash|viewerKey/,
  );
  expect(own.presentationReviewCycles).toEqual([]);
  const owner = await repository.exportAccount(f.actor.userId);
  expect(
    (owner.presentationReviewMessages as { text: string }[]).map((message) => message.text),
  ).toEqual(["OWN_EXTERNAL_BODY", "OTHER_EXTERNAL_BODY", "AUTHOR_PRIVATE_BODY"]);
  return f;
}
