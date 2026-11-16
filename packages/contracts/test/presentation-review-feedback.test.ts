import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EnablePresentationReviewSchema,
  PresentationReviewFeedbackAccessSchema,
  PresentationReviewFeedbackCommandSchema,
  PresentationReviewFeedbackMutationSchema,
  PresentationReviewFeedbackSchema,
} from "../src/index.js";
const now = new Date().toISOString();
const message = () => ({
  id: randomUUID(),
  text: "Plain feedback",
  authorLabel: "Reviewer 1",
  authorRole: "reviewer" as const,
  isOwn: true,
  version: 1,
  deleted: false,
  createdAt: now,
  updatedAt: now,
});
const snapshot = () => ({
  schemaVersion: 1 as const,
  shareId: randomUUID(),
  versionId: randomUUID(),
  version: 2,
  reviewSeq: 1,
  status: "open" as const,
  viewerKey: "a".repeat(64),
  expiresAt: now,
  serverTime: now,
  capabilities: { enable: false, comment: true, resolve: false, approve: false },
  approval: { state: "not_approved" as const, approvedAt: null, approvedReviewSeq: null },
  threads: [
    {
      id: randomUUID(),
      blockId: randomUUID(),
      blockIndex: 0,
      version: 1,
      resolved: false,
      createdAt: now,
      updatedAt: now,
      messages: [message()],
    },
  ],
});
describe("Presentation review feedback contracts", () => {
  it("keeps anonymous capability discovery body-free and all resources strict", () => {
    const access = {
      schemaVersion: 1,
      shareId: randomUUID(),
      versionId: randomUUID(),
      enabled: true,
      signInRequired: true,
      expiresAt: now,
    };
    expect(PresentationReviewFeedbackAccessSchema.parse(access)).toEqual(access);
    for (const field of ["threads", "email", "actorId", "workspaceId", "tokenHash"])
      expect(
        PresentationReviewFeedbackAccessSchema.safeParse({ ...access, [field]: "private" }).success,
      ).toBe(false);
    expect(
      EnablePresentationReviewSchema.safeParse({
        operationId: randomUUID(),
        versionId: randomUUID(),
        displayLabel: "Caller alias",
      }).success,
    ).toBe(false);
  });
  it("requires an account-bound viewer key and bounded plain text for every mutation", () => {
    const value = {
      schemaVersion: 1,
      operationId: randomUUID(),
      versionId: randomUUID(),
      viewerKey: "b".repeat(64),
      command: {
        type: "thread.create",
        threadId: randomUUID(),
        messageId: randomUUID(),
        blockId: randomUUID(),
        text: "  Cafe\u0301\nFeedback  ",
      },
    };
    expect(PresentationReviewFeedbackMutationSchema.parse(value).command).toMatchObject({
      text: "Café\nFeedback",
    });
    const { viewerKey: _, ...missing } = value;
    void _;
    expect(PresentationReviewFeedbackMutationSchema.safeParse(missing).success).toBe(false);
    for (const text of [" ", "x".repeat(2001), "Unsafe\u202ecomment", "bad\u0001text"])
      expect(
        PresentationReviewFeedbackMutationSchema.safeParse({
          ...value,
          command: { ...value.command, text },
        }).success,
      ).toBe(false);
    expect(
      PresentationReviewFeedbackCommandSchema.safeParse({
        type: "approval.set",
        expectedReviewSeq: 0,
        approved: true,
      }).success,
    ).toBe(false);
  });
  it("validates stable pseudonyms, tombstones and publication page ordinals without raw identity fields", () => {
    const value = snapshot();
    expect(PresentationReviewFeedbackSchema.parse(value)).toEqual(value);
    for (const patch of [
      { authorLabel: "person@example.test" },
      { authorLabel: "Author" },
      { deleted: true },
      { actorId: randomUUID() },
    ]) {
      const invalid = snapshot();
      Object.assign(invalid.threads[0]!.messages[0]!, patch);
      expect(PresentationReviewFeedbackSchema.safeParse(invalid).success).toBe(false);
    }
    const tombstone = snapshot();
    Object.assign(tombstone.threads[0]!.messages[0]!, { deleted: true, text: "", isOwn: false });
    expect(PresentationReviewFeedbackSchema.safeParse(tombstone).success).toBe(true);
    for (const blockIndex of [-1, 200, 0.5]) {
      const invalid = snapshot();
      invalid.threads[0]!.blockIndex = blockIndex;
      expect(PresentationReviewFeedbackSchema.safeParse(invalid).success).toBe(false);
    }
  });
  it("enforces closed, disabled, unique, bounded and approval revision states", () => {
    const value = snapshot();
    expect(PresentationReviewFeedbackSchema.safeParse({ ...value, status: "closed" }).success).toBe(
      false,
    );
    expect(
      PresentationReviewFeedbackSchema.safeParse({
        ...value,
        status: "not_enabled",
        reviewSeq: 0,
        capabilities: { enable: true, comment: false, resolve: false, approve: false },
      }).success,
    ).toBe(false);
    expect(
      PresentationReviewFeedbackSchema.safeParse({
        ...value,
        threads: [value.threads[0], value.threads[0]],
      }).success,
    ).toBe(false);
    expect(
      PresentationReviewFeedbackSchema.safeParse({
        ...value,
        approval: { state: "approved", approvedAt: now, approvedReviewSeq: 1 },
      }).success,
    ).toBe(false);
    const resolved = {
      ...value,
      threads: value.threads.map((thread) => ({ ...thread, resolved: true })),
    };
    expect(
      PresentationReviewFeedbackSchema.safeParse({
        ...resolved,
        approval: { state: "approved", approvedAt: now, approvedReviewSeq: 1 },
      }).success,
    ).toBe(true);
    expect(
      PresentationReviewFeedbackSchema.safeParse({
        ...resolved,
        reviewSeq: 2,
        approval: { state: "stale", approvedAt: now, approvedReviewSeq: 1 },
      }).success,
    ).toBe(true);
    const thread = value.threads[0]!;
    expect(
      PresentationReviewFeedbackSchema.safeParse({
        ...value,
        threads: [{ ...thread, messages: Array.from({ length: 21 }, message) }],
      }).success,
    ).toBe(false);
    expect(
      PresentationReviewFeedbackSchema.safeParse({
        ...value,
        threads: Array.from({ length: 5 }, () => ({
          ...thread,
          id: randomUUID(),
          messages: Array.from({ length: 20 }, () => ({ ...message(), text: "界".repeat(2000) })),
        })),
      }).success,
    ).toBe(false);
  });
});
