import { createHash } from "node:crypto";
import {
  CreatePresentationAssignmentSchema,
  PresentationReadingProgressSchema,
} from "@openround/contracts";
import type { PresentationReadingProgress } from "@openround/contracts";
import {
  PresentationAssignmentError,
  type CreatePresentationAssignmentInput,
  type PresentationAssignmentRecord,
  type PresentationReadingAttemptRecord,
} from "./presentation-assignment-types.js";
import type { PresentationVersionRecord } from "./presentation-types.js";
export const day = 86_400_000;
export const hash = /^[a-f0-9]{64}$/;
export function fail(
  code: ConstructorParameters<typeof PresentationAssignmentError>[0] = "UNAVAILABLE",
): never {
  throw new PresentationAssignmentError(code);
}
export const effectiveNow = (now: Date) => new Date(Math.max(now.getTime(), Date.now()));
export interface ReadingReceipt {
  requestHash: string;
  revision: number;
  currentBlockId: string | null;
  updatedAt: string;
  completedAt: string | null;
}
export interface ReadingState {
  attempt: PresentationReadingAttemptRecord;
  readRevisions: Record<string, number>;
  receipts: Record<string, ReadingReceipt>;
}
export function validateCreate(input: CreatePresentationAssignmentInput) {
  CreatePresentationAssignmentSchema.omit({ token: true }).parse({
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
export function expiry(input: CreatePresentationAssignmentInput) {
  const expiresAt = new Date(input.expiresAt);
  if (expiresAt <= effectiveNow(input.now)) fail("REQUEST_EXPIRED");
  if (expiresAt.getTime() > input.now.getTime() + 30 * day) fail();
  return expiresAt;
}
export function replayAssignment(
  assignment: PresentationAssignmentRecord,
  input: CreatePresentationAssignmentInput,
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
export function blockIds(version: PresentationVersionRecord) {
  return version.content.blocks
    .filter((b) => !("hidden" in b && b.hidden))
    .map((b) => b.id.toLowerCase());
}
export function initialAttempt(state: ReadingState) {
  return {
    ...structuredClone(state.attempt),
    revision: 0,
    readBlockIds: [],
    currentBlockId: null,
    updatedAt: new Date(state.attempt.startedAt),
    completedAt: null,
  };
}
export function changeReading(
  state: ReadingState,
  version: PresentationVersionRecord,
  value: PresentationReadingProgress,
  now: Date,
) {
  const mutation = PresentationReadingProgressSchema.parse(value),
    requestHash = createHash("sha256").update(JSON.stringify(mutation)).digest("hex");
  const receipt = state.receipts[mutation.requestId];
  if (receipt) {
    if (receipt.requestHash !== requestHash) fail("IDEMPOTENCY_CONFLICT");
    return {
      attempt: {
        ...structuredClone(state.attempt),
        revision: receipt.revision,
        readBlockIds: state.attempt.readBlockIds.filter(
          (id) => state.readRevisions[id]! <= receipt.revision,
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
  if (Object.keys(state.receipts).length >= 250) fail("RECEIPT_LIMIT");
  const visible = blockIds(version);
  if (!visible.length || visible.length > 200) fail();
  const revision = state.attempt.revision + 1;
  if (mutation.kind === "read") {
    if (!visible.includes(mutation.blockId)) fail("INVALID_BLOCK");
    if (state.readRevisions[mutation.blockId] === undefined) {
      state.readRevisions[mutation.blockId] = revision;
      state.attempt.readBlockIds.push(mutation.blockId);
    }
    state.attempt.currentBlockId = mutation.blockId;
  } else {
    if (visible.some((id) => state.readRevisions[id] === undefined)) fail("INCOMPLETE");
    state.attempt.completedAt = new Date(now);
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
