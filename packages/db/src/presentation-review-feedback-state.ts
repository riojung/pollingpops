import { createHash } from "node:crypto";
import {
  PRESENTATION_REVIEW_MAX_THREADS,
  PRESENTATION_REVIEW_MAX_MESSAGES,
  PRESENTATION_REVIEW_MAX_THREAD_MESSAGES,
  PRESENTATION_REVIEW_MAX_COMMENT_BYTES,
  PRESENTATION_REVIEW_MAX_RECEIPTS,
  PresentationReviewFeedbackSchema,
  PresentationReviewFeedbackMutationSchema,
  EnablePresentationReviewSchema,
  type PresentationReviewFeedback,
  type PresentationReviewFeedbackMutation,
  type PresentationReviewFeedbackReceipt,
  type EnablePresentationReview,
} from "@openround/contracts";
import type { PresentationShareRecord } from "./presentation-share-types.js";
import { PresentationReviewFeedbackError } from "./presentation-review-feedback-types.js";
export type ReviewRole = "author" | "reviewer";
export interface ReviewThread {
  id: string;
  blockId: string;
  version: number;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
  createdSeq: number;
}
export interface ReviewMessage {
  id: string;
  threadId: string;
  actorId: string | null;
  role: ReviewRole;
  ordinal: number | null;
  text: string;
  version: number;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  createdSeq: number;
}
export interface ReviewReceipt {
  actorId: string;
  operationId: string;
  hash: string;
  receipt: PresentationReviewFeedbackReceipt;
}
export interface ReviewCycle {
  shareId: string;
  seq: number;
  nextOrdinal: number;
  approvedBy: string | null;
  approvedAt: string | null;
  approvedSeq: number | null;
  threads: ReviewThread[];
  messages: ReviewMessage[];
  receiptCount: number;
}
export interface ReviewSource {
  share: PresentationShareRecord;
  version: number;
  blockIds: string[];
  blockIndexes: number[];
  active: boolean;
}
export const reviewId = (id: string) => id.toLowerCase();
export function reviewError(
  code: ConstructorParameters<typeof PresentationReviewFeedbackError>[0],
): never {
  throw new PresentationReviewFeedbackError(code);
}
export function reviewViewerKey(shareId: string, actorId: string) {
  return createHash("sha256")
    .update(`presentation-review-viewer-v1:${reviewId(shareId)}:${reviewId(actorId)}`)
    .digest("hex");
}
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === "string" &&
      ["operationId", "versionId", "threadId", "messageId", "blockId"].includes(key)
        ? reviewId(item)
        : normalize(item),
    ]),
  );
}
export function reviewRequest(input: PresentationReviewFeedbackMutation) {
  try {
    return PresentationReviewFeedbackMutationSchema.parse(normalize(input));
  } catch {
    return reviewError("VALIDATION_ERROR");
  }
}
export function reviewEnableRequest(input: EnablePresentationReview) {
  try {
    return EnablePresentationReviewSchema.parse(normalize(input));
  } catch {
    return reviewError("VALIDATION_ERROR");
  }
}
export function reviewHash(shareId: string, role: ReviewRole, request: unknown) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        protocol: "presentation-review-feedback-v1",
        shareId: reviewId(shareId),
        role,
        request,
      }),
    )
    .digest("hex");
}
export function emptyReview(shareId: string): ReviewCycle {
  return {
    shareId,
    seq: 1,
    nextOrdinal: 1,
    approvedBy: null,
    approvedAt: null,
    approvedSeq: null,
    threads: [],
    messages: [],
    receiptCount: 0,
  };
}
export function reviewProjection(
  source: ReviewSource,
  cycle: ReviewCycle | null,
  actorId: string,
  role: ReviewRole,
  now: Date,
): PresentationReviewFeedback {
  const active = source.active && cycle !== null;
  return PresentationReviewFeedbackSchema.parse({
    schemaVersion: 1,
    shareId: source.share.id,
    versionId: source.share.versionId,
    version: source.version,
    viewerKey: reviewViewerKey(source.share.id, actorId),
    reviewSeq: cycle?.seq ?? 0,
    status: cycle ? (source.active ? "open" : "closed") : "not_enabled",
    expiresAt: source.share.expiresAt.toISOString(),
    serverTime: now.toISOString(),
    capabilities: {
      enable: role === "author" && source.active && !cycle,
      comment: active,
      resolve: active && role === "author",
      approve: active && role === "author",
    },
    approval: {
      state:
        cycle?.approvedSeq == null
          ? "not_approved"
          : cycle.approvedSeq === cycle.seq
            ? "approved"
            : "stale",
      approvedAt: cycle?.approvedAt ?? null,
      approvedReviewSeq: cycle?.approvedSeq ?? null,
    },
    threads: (cycle?.threads ?? []).map((thread) => ({
      id: thread.id,
      blockId: source.blockIds.find((id) => reviewId(id) === reviewId(thread.blockId)),
      blockIndex:
        source.blockIndexes[
          source.blockIds.findIndex((id) => reviewId(id) === reviewId(thread.blockId))
        ],
      version: thread.version,
      resolved: thread.resolved,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messages: cycle!.messages
        .filter((message) => message.threadId === thread.id)
        .map((message) => ({
          id: message.id,
          text: message.deleted ? "" : message.text,
          authorLabel: message.role === "author" ? "Author" : `Reviewer ${message.ordinal}`,
          authorRole: message.role,
          isOwn: message.actorId === actorId,
          version: message.version,
          deleted: message.deleted,
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
        })),
    })),
  });
}
export function reviewReplay(previous: ReviewReceipt | null, hash: string) {
  if (!previous) return null;
  if (previous.hash !== hash) reviewError("IDEMPOTENCY_CONFLICT");
  return structuredClone(previous.receipt);
}
export function reviewCapacity(cycle: ReviewCycle) {
  if (
    cycle.receiptCount >= PRESENTATION_REVIEW_MAX_RECEIPTS ||
    cycle.threads.length > PRESENTATION_REVIEW_MAX_THREADS ||
    cycle.messages.length > PRESENTATION_REVIEW_MAX_MESSAGES ||
    cycle.threads.some(
      (thread) =>
        cycle.messages.filter((message) => message.threadId === thread.id).length >
        PRESENTATION_REVIEW_MAX_THREAD_MESSAGES,
    ) ||
    cycle.messages.reduce((bytes, message) => bytes + Buffer.byteLength(message.text, "utf8"), 0) >
      PRESENTATION_REVIEW_MAX_COMMENT_BYTES
  )
    reviewError("REVIEW_LIMIT");
}
/** Mutates only a private copy. Authorization and the shared source lock are the backend's responsibility. */
export function applyReview(
  cycle: ReviewCycle,
  source: ReviewSource,
  actorId: string,
  role: ReviewRole,
  mutation: PresentationReviewFeedbackMutation,
  now: Date,
): PresentationReviewFeedbackReceipt {
  const command = mutation.command,
    instant = now.toISOString();
  let thread: ReviewThread | undefined;
  if ("threadId" in command) thread = cycle.threads.find((entry) => entry.id === command.threadId);
  if (command.type === "thread.create") {
    if (thread || cycle.messages.some((message) => message.id === command.messageId))
      reviewError("CONFLICT");
    const targets = source.blockIds.filter((id) => reviewId(id) === command.blockId);
    if (targets.length !== 1) reviewError("UNAVAILABLE");
    thread = {
      id: command.threadId,
      blockId: targets[0]!,
      version: 1,
      resolved: false,
      createdAt: instant,
      updatedAt: instant,
      createdSeq: cycle.seq + 1,
    };
    cycle.threads.push(thread);
  } else if ("threadId" in command) {
    if (!thread) reviewError("UNAVAILABLE");
    if (thread.version !== command.expectedThreadVersion) reviewError("CONFLICT");
  }
  if (command.type === "thread.create" || command.type === "message.reply") {
    if (
      !thread ||
      (command.type === "message.reply" && thread.resolved) ||
      cycle.messages.some((message) => message.id === command.messageId)
    )
      reviewError("VALIDATION_ERROR");
    let ordinal: number | null = null;
    if (role === "reviewer") {
      ordinal =
        cycle.messages.find((message) => message.actorId === actorId && message.role === "reviewer")
          ?.ordinal ?? cycle.nextOrdinal++;
    }
    cycle.messages.push({
      id: command.messageId,
      threadId: thread.id,
      actorId,
      role,
      ordinal,
      text: command.text,
      version: 1,
      deleted: false,
      createdAt: instant,
      updatedAt: instant,
      createdSeq: cycle.seq + 1,
    });
    if (command.type === "message.reply") thread.version++;
  } else if (command.type === "message.edit" || command.type === "message.delete") {
    const message = cycle.messages.find(
      (entry) => entry.id === command.messageId && entry.threadId === thread!.id,
    );
    if (!message || message.actorId !== actorId) reviewError("UNAVAILABLE");
    if (message.deleted || (command.type === "message.edit" && message.text === command.text))
      reviewError("VALIDATION_ERROR");
    message.text = command.type === "message.delete" ? "" : command.text;
    message.deleted = command.type === "message.delete";
    message.version++;
    message.updatedAt = instant;
    thread!.version++;
  } else if (command.type === "thread.resolve") {
    if (role !== "author") reviewError("UNAVAILABLE");
    if (thread!.resolved === command.resolved) reviewError("VALIDATION_ERROR");
    thread!.resolved = command.resolved;
    thread!.version++;
  } else {
    if (role !== "author") reviewError("UNAVAILABLE");
    if (command.expectedReviewSeq !== cycle.seq) reviewError("CONFLICT");
    if (command.approved && cycle.threads.some((entry) => !entry.resolved)) reviewError("CONFLICT");
    if (command.approved ? cycle.approvedSeq === cycle.seq : cycle.approvedSeq === null)
      reviewError("VALIDATION_ERROR");
    cycle.approvedBy = command.approved ? actorId : null;
    cycle.approvedAt = command.approved ? instant : null;
    cycle.approvedSeq = command.approved ? cycle.seq + 1 : null;
  }
  if (thread) thread.updatedAt = instant;
  cycle.seq++;
  reviewCapacity(cycle);
  return {
    operationId: mutation.operationId,
    reviewSeq: cycle.seq,
    type: command.type,
    threadId: "threadId" in command ? command.threadId : null,
    messageId: "messageId" in command ? command.messageId : null,
  };
}
