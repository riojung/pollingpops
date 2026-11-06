import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/index.js";
import {
  expectReviewFeedbackConformance,
  expectReviewEnableOnceConformance,
  expectReviewFeedbackErasure,
  expectReviewFeedbackRevokedExport,
  reviewFeedbackFixture,
} from "./support/presentation-review-feedback-conformance.js";

describe("Presentation review feedback", () => {
  it("enables each cycle once and reserves no receipts for later enable intents", async () => {
    await expectReviewEnableOnceConformance(new MemoryRepository());
  });
  it("preserves exact enable and comment retries when legitimate mutations reach the receipt cap", async () => {
    const f = await reviewFeedbackFixture(new MemoryRepository()),
      enabled = await f.enable();
    let snapshot = (await f.feedback.getReviewerReview(f.reviewer())).feedback;
    const threadId = randomUUID(),
      messageId = randomUUID(),
      create = f.mutation(snapshot, {
        type: "thread.create",
        threadId,
        messageId,
        blockId: f.content.blocks[0]!.id,
        text: "First",
      });
    snapshot = (await f.feedback.mutateReviewerReview({ ...f.reviewer(), mutation: create })).result
      .feedback;
    for (let count = 2; count < 5000; count++)
      snapshot = (
        await f.feedback.mutateReviewerReview({
          ...f.reviewer(),
          mutation: f.mutation(snapshot, {
            type: "message.edit",
            threadId,
            messageId,
            expectedThreadVersion: count - 1,
            text: `Edit ${count}`,
          }),
        })
      ).result.feedback;
    const operationId = randomUUID();
    await expect(
      f.feedback.enableReview({ ...f.author, request: { operationId, versionId: f.version.id } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      f.feedback.mutateReviewerReview({
        ...f.reviewer(),
        mutation: f.mutation(
          snapshot,
          {
            type: "message.edit",
            threadId,
            messageId,
            expectedThreadVersion: 4999,
            text: "Over capacity",
          },
          operationId,
        ),
      }),
    ).rejects.toMatchObject({ code: "REVIEW_LIMIT" });
    expect((await f.feedback.getReviewerReview(f.reviewer())).feedback).toEqual(snapshot);
    expect(
      (await f.feedback.mutateReviewerReview({ ...f.reviewer(), mutation: create })).result,
    ).toMatchObject({ replayed: true, feedback: snapshot, receipt: { reviewSeq: 2 } });
    const replay = await f.feedback.enableReview({
      ...f.author,
      request: { operationId: enabled.result.receipt.operationId, versionId: f.version.id },
    });
    expect(replay.result.replayed).toBe(true);
    expect(replay.result.receipt).toEqual(enabled.result.receipt);
    expect(replay.result.feedback.reviewSeq).toBe(5000);
  });
  it("fences new comments while account deletion waits for another lifecycle extension", async () => {
    const repository = new MemoryRepository(),
      f = await reviewFeedbackFixture(repository);
    await f.enable();
    const snapshot = (await f.feedback.getReviewerReview(f.reviewer())).feedback;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
    repository.getOrCreateLifecycleExtension("review-erasure-test-gate", () => ({
      exportAccount: () => ({}),
      deleteAccount: async () => {
        entered();
        await gate;
      },
    }));
    const deletion = repository.deleteAccount(f.first.userId);
    try {
      await ready;
      expect(repository.users.get(f.first.userId)!.deletedAt).toBeFalsy();
      await expect(
        f.feedback.mutateReviewerReview({
          ...f.reviewer(),
          mutation: f.mutation(snapshot, {
            type: "thread.create",
            threadId: randomUUID(),
            messageId: randomUUID(),
            blockId: f.content.blocks[0]!.id,
            text: "Must never survive erasure",
          }),
        }),
      ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    } finally {
      release();
      await deletion;
    }
    expect((await f.feedback.getAuthorReview(f.author)).feedback.threads).toEqual([]);
  });
  it("exports only an external reviewer's own messages after revocation", async () => {
    await expectReviewFeedbackRevokedExport(new MemoryRepository());
  });
  it("pins free-account feedback, viewer identities, CAS, exact receipts and author approval", async () => {
    await expectReviewFeedbackConformance(new MemoryRepository());
  });
  it("exports external reviewers' own feedback and erases bodies, receipts and stale thread versions", async () => {
    await expectReviewFeedbackErasure(new MemoryRepository());
  });
  it("fences receipt replay by current publisher membership, account and expiry", async () => {
    const repository = new MemoryRepository(),
      f = await reviewFeedbackFixture(repository);
    const enabled = await f.enable(),
      reviewer = (await f.feedback.getReviewerReview(f.reviewer())).feedback;
    const mutation = f.mutation(reviewer, {
      type: "thread.create",
      threadId: randomUUID(),
      messageId: randomUUID(),
      blockId: f.content.blocks[0]!.id,
      text: "Bounded comment",
    });
    await f.feedback.mutateReviewerReview({ ...f.reviewer(), mutation });
    const member = repository.workspaceMembers.get(`${f.actor.workspaceId}:${f.actor.userId}`)!;
    member.role = "viewer";
    repository.users.get(f.actor.userId)!.role = "viewer";
    await expect(
      f.feedback.mutateReviewerReview({ ...f.reviewer(), mutation }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    member.role = "owner";
    repository.users.get(f.actor.userId)!.role = "owner";
    await expect(
      f.feedback.mutateReviewerReview({
        ...f.reviewer(),
        now: new Date(f.share.expiresAt),
        mutation,
      }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(
      f.feedback.enableReview({
        ...f.author,
        now: new Date(f.share.expiresAt),
        request: { operationId: enabled.result.receipt.operationId, versionId: f.version.id },
      }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    repository.users.get(f.first.userId)!.deletedAt = new Date();
    await expect(
      f.feedback.mutateReviewerReview({ ...f.reviewer(), mutation }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
  it("rejects the twenty-first message atomically while preserving exact retries at capacity", async () => {
    const f = await reviewFeedbackFixture(new MemoryRepository());
    await f.enable();
    let snapshot = (await f.feedback.getReviewerReview(f.reviewer())).feedback;
    const threadId = randomUUID(),
      first = f.mutation(snapshot, {
        type: "thread.create",
        threadId,
        messageId: randomUUID(),
        blockId: f.content.blocks[0]!.id,
        text: "First",
      });
    snapshot = (await f.feedback.mutateReviewerReview({ ...f.reviewer(), mutation: first })).result
      .feedback;
    for (let i = 1; i < 20; i++)
      snapshot = (
        await f.feedback.mutateReviewerReview({
          ...f.reviewer(),
          mutation: f.mutation(snapshot, {
            type: "message.reply",
            threadId,
            messageId: randomUUID(),
            expectedThreadVersion: i,
            text: `Reply ${i}`,
          }),
        })
      ).result.feedback;
    await expect(
      f.feedback.mutateReviewerReview({
        ...f.reviewer(),
        mutation: f.mutation(snapshot, {
          type: "message.reply",
          threadId,
          messageId: randomUUID(),
          expectedThreadVersion: 20,
          text: "Overflow",
        }),
      }),
    ).rejects.toMatchObject({ code: "REVIEW_LIMIT" });
    expect((await f.feedback.getReviewerReview(f.reviewer())).feedback).toEqual(snapshot);
    expect(
      (await f.feedback.mutateReviewerReview({ ...f.reviewer(), mutation: first })).result.replayed,
    ).toBe(true);
  });
});
