import { timingSafeEqual } from "node:crypto";
import type { PresentationReviewFeedbackMutation } from "@openround/contracts";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import {
  createPresentationRepository,
  type MemoryPresentationRepository,
} from "./presentations.js";
import {
  createPresentationShareRepository,
  type MemoryPresentationShareRepository,
} from "./presentation-shares.js";
import { PostgresPresentationReviewFeedbackRepository } from "./presentation-review-feedback-postgres.js";
import type { Repository } from "./types.js";
import type {
  PresentationReviewAuthorContext,
  PresentationReviewReviewerContext,
  PresentationReviewFeedbackRepository,
} from "./presentation-review-feedback-types.js";
import {
  applyReview,
  emptyReview,
  reviewCapacity,
  reviewEnableRequest,
  reviewError,
  reviewHash,
  reviewId,
  reviewProjection,
  reviewReplay,
  reviewRequest,
  reviewViewerKey,
  type ReviewCycle,
  type ReviewReceipt,
  type ReviewRole,
  type ReviewSource,
} from "./presentation-review-feedback-state.js";
export * from "./presentation-review-feedback-types.js";
type Stored = {
  workspaceId: string;
  presentationId: string;
  inviterId: string;
  cycle: ReviewCycle;
};
export class MemoryPresentationReviewFeedbackRepository
  implements PresentationReviewFeedbackRepository, MemoryRepositoryLifecycleExtension
{
  private readonly cycles = new Map<string, Stored>();
  private readonly receipts = new Map<string, ReviewReceipt>();
  private readonly erasedActors = new Set<string>();
  private shares: MemoryPresentationShareRepository;
  private presentations: MemoryPresentationRepository;
  constructor(private parent: MemoryRepository) {
    this.shares = createPresentationShareRepository(parent) as MemoryPresentationShareRepository;
    this.presentations = createPresentationRepository(parent) as MemoryPresentationRepository;
  }
  private user(actorId: string) {
    const user = this.parent.users.get(actorId);
    return !!user && !user.deletedAt && !this.erasedActors.has(actorId);
  }
  private member(workspaceId: string, actorId: string) {
    const user = this.parent.users.get(actorId),
      member = this.parent.workspaceMembers.get(`${workspaceId}:${actorId}`);
    return (
      !!user &&
      !user.deletedAt &&
      !this.erasedActors.has(actorId) &&
      !!member &&
      ["owner", "editor"].includes(user.workspaceId === workspaceId ? user.role : member.role)
    );
  }
  private source(
    input: {
      shareId: string;
      actorId?: string;
      tokenHash?: string;
      workspaceId?: string;
      presentationId?: string;
      now: Date;
    },
    role?: ReviewRole,
  ): ReviewSource {
    if (role && !input.actorId) return reviewError("UNAVAILABLE");
    const share = this.shares.reviewShareRecord(reviewId(input.shareId));
    if (
      !share ||
      !Number.isFinite(input.now.getTime()) ||
      !this.parent.workspaces.has(share.workspaceId) ||
      this.parent.workspaceMediaDeletionClaims.has(share.workspaceId) ||
      (input.actorId && !this.user(reviewId(input.actorId)))
    )
      return reviewError("UNAVAILABLE");
    const parent = this.presentations.presentations.get(share.presentationId),
      version = this.presentations.versions.get(share.versionId);
    if (
      !parent ||
      !version ||
      version.workspaceId !== share.workspaceId ||
      version.presentationId !== share.presentationId ||
      !this.parent.hasLibraryArtifact(share.workspaceId, "presentation", share.presentationId)
    )
      return reviewError("UNAVAILABLE");
    const active =
      !share.revokedAt &&
      share.expiresAt > input.now &&
      parent.status !== "archived" &&
      this.member(share.workspaceId, share.actorId);
    if (role === "author") {
      if (
        !input.actorId ||
        input.workspaceId !== share.workspaceId ||
        reviewId(input.presentationId ?? "") !== share.presentationId ||
        !this.member(share.workspaceId, reviewId(input.actorId))
      )
        return reviewError("UNAVAILABLE");
    } else {
      if (
        !input.tokenHash ||
        !/^[a-f0-9]{64}$/.test(input.tokenHash) ||
        !timingSafeEqual(Buffer.from(share.tokenHash), Buffer.from(input.tokenHash)) ||
        !active
      )
        return reviewError("UNAVAILABLE");
    }
    const visible = version.content.blocks.flatMap((block, index) =>
      block.kind === "content" && block.hidden ? [] : [{ id: block.id, index }],
    );
    return {
      share,
      active,
      version: version.version,
      blockIds: visible.map((block) => block.id),
      blockIndexes: visible.map((block) => block.index),
    };
  }
  async getReviewAccess(input: {
    shareId: string;
    tokenHash: string;
    actorId?: string;
    now: Date;
  }) {
    const source = this.source(input),
      enabled = this.cycles.has(source.share.id);
    return {
      workspaceId: source.share.workspaceId,
      access: {
        schemaVersion: 1 as const,
        shareId: source.share.id,
        versionId: source.share.versionId,
        enabled,
        signInRequired: enabled && !input.actorId,
        expiresAt: source.share.expiresAt.toISOString(),
      },
    };
  }
  async getAuthorReview(input: PresentationReviewAuthorContext) {
    const source = this.source(input, "author");
    return {
      workspaceId: source.share.workspaceId,
      feedback: reviewProjection(
        source,
        this.cycles.get(source.share.id)?.cycle ?? null,
        reviewId(input.actorId),
        "author",
        input.now,
      ),
    };
  }
  async getReviewerReview(input: PresentationReviewReviewerContext) {
    const source = this.source(input, "reviewer");
    return {
      workspaceId: source.share.workspaceId,
      feedback: reviewProjection(
        source,
        this.cycles.get(source.share.id)?.cycle ?? null,
        reviewId(input.actorId),
        "reviewer",
        input.now,
      ),
    };
  }
  async enableReview(
    input: PresentationReviewAuthorContext & {
      request: Parameters<PresentationReviewFeedbackRepository["enableReview"]>[0]["request"];
    },
  ) {
    const source = this.source(input, "author"),
      request = reviewEnableRequest(input.request),
      actorId = reviewId(input.actorId);
    if (!source.active || request.versionId !== source.share.versionId)
      return reviewError("UNAVAILABLE");
    const receiptKey = `${source.share.id}:${actorId}:${request.operationId}`,
      hash = reviewHash(source.share.id, "author", { type: "review.enable", ...request });
    const previous = reviewReplay(this.receipts.get(receiptKey) ?? null, hash);
    const cycle = structuredClone(
      this.cycles.get(source.share.id)?.cycle ?? emptyReview(source.share.id),
    );
    if (previous)
      return {
        workspaceId: source.share.workspaceId,
        result: {
          feedback: reviewProjection(source, cycle, actorId, "author", input.now),
          receipt: previous,
          replayed: true,
        },
      };
    reviewCapacity(cycle);
    const receipt = {
      operationId: request.operationId,
      reviewSeq: cycle.seq,
      type: "review.enable" as const,
      threadId: null,
      messageId: null,
    };
    cycle.receiptCount++;
    this.cycles.set(source.share.id, {
      workspaceId: source.share.workspaceId,
      presentationId: source.share.presentationId,
      inviterId: source.share.actorId,
      cycle,
    });
    this.receipts.set(receiptKey, { actorId, operationId: request.operationId, hash, receipt });
    return {
      workspaceId: source.share.workspaceId,
      result: {
        feedback: reviewProjection(source, cycle, actorId, "author", input.now),
        receipt,
        replayed: false,
      },
    };
  }
  private mutate(
    input: (PresentationReviewAuthorContext | PresentationReviewReviewerContext) & {
      mutation: PresentationReviewFeedbackMutation;
    },
    role: ReviewRole,
  ) {
    const source = this.source(input, role),
      actorId = reviewId(input.actorId),
      mutation = reviewRequest(input.mutation);
    if (
      !source.active ||
      mutation.versionId !== source.share.versionId ||
      mutation.viewerKey !== reviewViewerKey(source.share.id, actorId)
    )
      return reviewError("UNAVAILABLE");
    const stored = this.cycles.get(source.share.id);
    if (!stored) return reviewError("UNAVAILABLE");
    const receiptKey = `${source.share.id}:${actorId}:${mutation.operationId}`,
      hash = reviewHash(source.share.id, role, mutation);
    const previous = reviewReplay(this.receipts.get(receiptKey) ?? null, hash);
    if (previous)
      return {
        workspaceId: source.share.workspaceId,
        result: {
          feedback: reviewProjection(source, stored.cycle, actorId, role, input.now),
          receipt: previous,
          replayed: true,
        },
      };
    const cycle = structuredClone(stored.cycle),
      receipt = applyReview(cycle, source, actorId, role, mutation, input.now);
    cycle.receiptCount++;
    this.cycles.set(source.share.id, { ...stored, cycle });
    this.receipts.set(receiptKey, { actorId, operationId: mutation.operationId, hash, receipt });
    return {
      workspaceId: source.share.workspaceId,
      result: {
        feedback: reviewProjection(source, cycle, actorId, role, input.now),
        receipt,
        replayed: false,
      },
    };
  }
  async mutateAuthorReview(
    input: Parameters<PresentationReviewFeedbackRepository["mutateAuthorReview"]>[0],
  ) {
    return this.mutate(input, "author");
  }
  async mutateReviewerReview(
    input: Parameters<PresentationReviewFeedbackRepository["mutateReviewerReview"]>[0],
  ) {
    return this.mutate(input, "reviewer");
  }
  private remove(shareId: string) {
    this.cycles.delete(shareId);
    for (const [key] of this.receipts) if (key.startsWith(`${shareId}:`)) this.receipts.delete(key);
  }
  deleteLibraryArtifactMetadata(workspaceId: string, type: string, id: string) {
    if (type === "presentation")
      for (const [shareId, stored] of this.cycles)
        if (stored.workspaceId === workspaceId && stored.presentationId === id)
          this.remove(shareId);
  }
  exportAccount({ ownedWorkspaceIds, userId }: MemoryRepositoryLifecycleContext) {
    return {
      presentationReviewCycles: [...this.cycles.values()]
        .filter((stored) => ownedWorkspaceIds.has(stored.workspaceId))
        .map(({ workspaceId, presentationId, cycle }) => ({
          workspaceId,
          presentationId,
          shareId: cycle.shareId,
          reviewSeq: cycle.seq,
          approvedAt: cycle.approvedAt,
        })),
      presentationReviewMessages: [...this.cycles.values()].flatMap(({ workspaceId, cycle }) =>
        cycle.messages
          .filter((message) => ownedWorkspaceIds.has(workspaceId) || message.actorId === userId)
          .map((message) => ({ workspaceId, shareId: cycle.shareId, ...structuredClone(message) })),
      ),
    };
  }
  deleteAccount({ ownedWorkspaceIds, userId }: MemoryRepositoryLifecycleContext) {
    // Other lifecycle extensions may yield before the parent marks the identity deleted.
    this.erasedActors.add(userId);
    const instant = new Date().toISOString();
    for (const [shareId, stored] of this.cycles) {
      if (ownedWorkspaceIds.has(stored.workspaceId) || stored.inviterId === userId) {
        this.remove(shareId);
        continue;
      }
      let changed = false;
      const affected = new Set<string>();
      for (const message of stored.cycle.messages)
        if (message.actorId === userId) {
          message.actorId = null;
          message.text = "";
          message.deleted = true;
          message.version++;
          message.updatedAt = instant;
          affected.add(message.threadId);
          changed = true;
        }
      for (const thread of stored.cycle.threads)
        if (affected.has(thread.id)) {
          thread.version++;
          thread.updatedAt = instant;
        }
      if (stored.cycle.approvedBy === userId) {
        stored.cycle.approvedBy = null;
        stored.cycle.approvedAt = null;
        stored.cycle.approvedSeq = null;
        changed = true;
      }
      if (changed) stored.cycle.seq++;
    }
    for (const [key, receipt] of this.receipts)
      if (receipt.actorId === userId) {
        this.receipts.delete(key);
        const stored = this.cycles.get(key.split(":")[0]!);
        if (stored) stored.cycle.receiptCount--;
      }
  }
  purgeExpired(now: Date) {
    for (const [shareId] of this.cycles) {
      const share = this.shares.reviewShareRecord(shareId);
      if (!share || share.expiresAt.getTime() <= now.getTime() - 7 * 86400000) this.remove(shareId);
    }
    return [];
  }
}
export function createPresentationReviewFeedbackRepository(
  repository: Repository,
): PresentationReviewFeedbackRepository {
  if (repository instanceof PostgresRepository)
    return new PostgresPresentationReviewFeedbackRepository(repository);
  if (repository instanceof MemoryRepository)
    return repository.getOrCreateLifecycleExtension(
      "presentation-review-feedback",
      () => new MemoryPresentationReviewFeedbackRepository(repository),
    );
  throw new Error("Unsupported Presentation review repository");
}
