import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreatePresentationAssignmentSchema,
  StartPresentationReadingAttemptSchema,
  PresentationReadingProgressSchema,
  PresentationReadingAttemptSchema,
  PresentationReadingMutationResultSchema,
} from "../src/index.js";
const now = new Date().toISOString();
const attempt = () => ({
  id: randomUUID(),
  assignmentId: randomUUID(),
  revision: 0,
  readBlockIds: [] as string[],
  currentBlockId: null as string | null,
  startedAt: now,
  updatedAt: now,
  completedAt: null,
});
describe("Presentation reading contracts", () => {
  it("accepts only bounded creation and independent anonymous start credentials", () => {
    const create = {
      requestId: randomUUID(),
      versionId: randomUUID(),
      token: "a".repeat(43),
      expiresAt: now,
    };
    expect(CreatePresentationAssignmentSchema.safeParse(create).success).toBe(true);
    expect(CreatePresentationAssignmentSchema.safeParse({ ...create, mastery: true }).success).toBe(
      false,
    );
    expect(
      StartPresentationReadingAttemptSchema.safeParse({
        attemptId: randomUUID(),
        token: create.token,
      }).success,
    ).toBe(true);
    expect(
      StartPresentationReadingAttemptSchema.safeParse({ attemptId: randomUUID(), token: "short" })
        .success,
    ).toBe(false);
  });
  it("requires an explicit page for a read and forbids answer or score payloads", () => {
    const read = {
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "read",
      blockId: randomUUID(),
    };
    expect(PresentationReadingProgressSchema.safeParse(read).success).toBe(true);
    expect(
      PresentationReadingProgressSchema.safeParse({ ...read, blockId: undefined }).success,
    ).toBe(false);
    expect(PresentationReadingProgressSchema.safeParse({ ...read, answer: "x" }).success).toBe(
      false,
    );
    expect(PresentationReadingProgressSchema.safeParse({ ...read, kind: "complete" }).success).toBe(
      false,
    );
    expect(
      PresentationReadingProgressSchema.safeParse({
        requestId: read.requestId,
        expectedRevision: 1,
        kind: "complete",
      }).success,
    ).toBe(true);
  });
  it("bounds acknowledgement sets and keeps a current page inside the read set", () => {
    const value = attempt(),
      id = randomUUID();
    expect(PresentationReadingAttemptSchema.safeParse(value).success).toBe(true);
    expect(
      PresentationReadingAttemptSchema.safeParse({
        ...value,
        readBlockIds: Array.from({ length: 201 }, () => randomUUID()),
      }).success,
    ).toBe(false);
    expect(
      PresentationReadingAttemptSchema.safeParse({ ...value, readBlockIds: [id, id.toUpperCase()] })
        .success,
    ).toBe(false);
    expect(
      PresentationReadingAttemptSchema.safeParse({ ...value, currentBlockId: id }).success,
    ).toBe(false);
  });
  it("keeps mutation responses compact and free of bearer credentials", () => {
    const value = { attempt: attempt(), replayed: false };
    expect(PresentationReadingMutationResultSchema.safeParse(value).success).toBe(true);
    expect(
      PresentationReadingMutationResultSchema.safeParse({ ...value, review: {} }).success,
    ).toBe(false);
    expect(
      PresentationReadingMutationResultSchema.safeParse({
        ...value,
        attempt: { ...value.attempt, tokenHash: "a".repeat(64) },
      }).success,
    ).toBe(false);
  });
});
