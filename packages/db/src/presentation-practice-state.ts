import { createHash } from "node:crypto";
import {
  CreatePresentationPracticeAssignmentSchema,
  PresentationPracticeProgressSchema,
  presentationPracticeEligibility,
  type PresentationPracticeProgress,
} from "@openround/contracts";
import {
  PresentationPracticeAssignmentError,
  type CreatePresentationPracticeAssignmentInput,
  type PresentationPracticeAssignmentRecord,
  type PresentationPracticeAttemptRecord,
} from "./presentation-practice-types.js";
import type { PresentationVersionRecord } from "./presentation-types.js";
export const day = 86_400_000;
export const hash = /^[a-f0-9]{64}$/;
export const effectiveNow = (now: Date) => new Date(Math.max(now.getTime(), Date.now()));
export function fail(
  code: ConstructorParameters<typeof PresentationPracticeAssignmentError>[0] = "UNAVAILABLE",
): never {
  throw new PresentationPracticeAssignmentError(code);
}
export interface PracticeReceipt {
  requestHash: string;
  revision: number;
  currentBlockId: string | null;
  updatedAt: string;
  completedAt: string | null;
}
export interface PracticeState {
  attempt: PresentationPracticeAttemptRecord;
  readRevisions: Record<string, number>;
  receipts: Record<string, PracticeReceipt>;
}
export function practiceBlocks(version: PresentationVersionRecord) {
  return version.content.blocks.filter((block) => !("hidden" in block && block.hidden));
}
export function assertPracticeEligible(version: PresentationVersionRecord) {
  const blocks = practiceBlocks(version);
  const eligibility = presentationPracticeEligibility(version.content);
  if (!eligibility.eligible)
    throw new PresentationPracticeAssignmentError(
      "UNSUPPORTED_CONTENT",
      eligibility.reason ?? undefined,
    );
  return blocks;
}
export function validateCreate(input: CreatePresentationPracticeAssignmentInput) {
  CreatePresentationPracticeAssignmentSchema.omit({ token: true }).parse({
    requestId: input.requestId,
    versionId: input.versionId,
    expiresAt: input.expiresAt,
  });
  if (
    !hash.test(input.intentHash) ||
    !hash.test(input.tokenHash) ||
    !Number.isFinite(input.now.getTime())
  )
    fail();
}
export function expiry(input: CreatePresentationPracticeAssignmentInput) {
  const expiresAt = new Date(input.expiresAt);
  if (expiresAt <= effectiveNow(input.now)) fail("REQUEST_EXPIRED");
  if (expiresAt.getTime() > input.now.getTime() + 30 * day) fail();
  return expiresAt;
}
export function replayAssignment(
  assignment: PresentationPracticeAssignmentRecord,
  input: CreatePresentationPracticeAssignmentInput,
) {
  if (
    assignment.intentHash !== input.intentHash ||
    assignment.tokenHash !== input.tokenHash ||
    assignment.presentationId !== input.presentationId ||
    assignment.versionId !== input.versionId ||
    assignment.expiresAt.toISOString() !== input.expiresAt
  )
    fail("IDEMPOTENCY_CONFLICT");
  return { assignment: structuredClone(assignment), replayed: true };
}
export function initialAttempt(state: PracticeState): PresentationPracticeAttemptRecord {
  return {
    ...structuredClone(state.attempt),
    revision: 0,
    readBlockIds: [],
    currentBlockId: null,
    answers: {},
    updatedAt: new Date(state.attempt.startedAt),
    completedAt: null,
  };
}
export function changePractice(
  state: PracticeState,
  version: PresentationVersionRecord,
  value: PresentationPracticeProgress,
  now: Date,
) {
  const mutation = PresentationPracticeProgressSchema.parse(value),
    requestHash = createHash("sha256").update(JSON.stringify(mutation)).digest("hex"),
    receipt = state.receipts[mutation.requestId];
  if (receipt) {
    if (receipt.requestHash !== requestHash) fail("IDEMPOTENCY_CONFLICT");
    return {
      attempt: {
        ...structuredClone(state.attempt),
        revision: receipt.revision,
        readBlockIds: state.attempt.readBlockIds.filter(
          (id) => state.readRevisions[id]! <= receipt.revision,
        ),
        answers: structuredClone(
          Object.fromEntries(
            Object.entries(state.attempt.answers).filter(
              ([, answer]) => answer.revision <= receipt.revision,
            ),
          ),
        ),
        currentBlockId: receipt.currentBlockId,
        updatedAt: new Date(receipt.updatedAt),
        completedAt: receipt.completedAt ? new Date(receipt.completedAt) : null,
      },
      replayed: true,
    };
  }
  if (mutation.expectedRevision !== state.attempt.revision) fail("REVISION_CONFLICT");
  if (state.attempt.completedAt) fail("COMPLETED");
  if (Object.keys(state.receipts).length >= 100) fail("RECEIPT_LIMIT");
  const blocks = assertPracticeEligible(version),
    revision = state.attempt.revision + 1;
  if (mutation.kind === "complete") {
    if (
      blocks.some(
        (block) =>
          state.readRevisions[block.id.toLowerCase()] === undefined ||
          (block.kind === "question" && !state.attempt.answers[block.id.toLowerCase()]),
      )
    )
      fail("INCOMPLETE");
    state.attempt.completedAt = new Date(now);
  } else {
    const block = blocks.find((block) => block.id.toLowerCase() === mutation.blockId);
    if (!block || (mutation.kind === "read" && block.kind !== "content")) fail("INVALID_BLOCK");
    if (mutation.kind === "answer") {
      if (
        block.kind !== "question" ||
        !["single_select", "true_false"].includes(block.question.type) ||
        !("choices" in block.question)
      )
        fail("INVALID_RESPONSE");
      const choice = block.question.choices.find(
        (choice) => choice.id.toLowerCase() === mutation.choiceId,
      );
      if (!choice) fail("INVALID_RESPONSE");
      if (state.attempt.answers[mutation.blockId]) fail("INVALID_RESPONSE");
      state.attempt.answers[mutation.blockId] = {
        choiceId: mutation.choiceId,
        correct: choice.isCorrect,
        revision,
        submittedAt: new Date(now),
      };
    }
    if (state.readRevisions[mutation.blockId] === undefined) {
      state.readRevisions[mutation.blockId] = revision;
      state.attempt.readBlockIds.push(mutation.blockId);
    }
    state.attempt.currentBlockId = mutation.blockId;
  }
  state.attempt.revision = revision;
  state.attempt.updatedAt = new Date(now);
  state.receipts[mutation.requestId] = {
    requestHash,
    revision,
    currentBlockId: state.attempt.currentBlockId,
    updatedAt: now.toISOString(),
    completedAt: state.attempt.completedAt?.toISOString() ?? null,
  };
  return { attempt: structuredClone(state.attempt), replayed: false };
}
