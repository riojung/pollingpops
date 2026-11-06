import {
  EnablePresentationReviewSchema,
  PresentationReviewFeedbackAccessSchema,
  PresentationReviewFeedbackMutationSchema,
  PresentationReviewFeedbackMutationResponseSchema,
  PresentationReviewFeedbackSchema,
  type EnablePresentationReview,
  type PresentationReviewFeedbackMutation,
} from "@openround/contracts";
import {
  PresentationReviewFeedbackError,
  type CreatorContext,
  type PresentationReviewAuthorContext,
  type PresentationReviewFeedbackRepository,
  type UserPrincipal,
} from "@openround/db";
import { hashToken } from "./security.js";

type AuthorRefresh = { reauthorize: () => Promise<CreatorContext | null> };
type ReviewerRefresh = { reauthorize: () => Promise<UserPrincipal | null> };
const unavailable = () => new PresentationReviewFeedbackError("UNAVAILABLE");

export class PresentationReviewFeedbackService {
  constructor(
    private deps: {
      feedback: PresentationReviewFeedbackRepository;
      featureEnabled: (workspaceId: string) => Promise<boolean>;
    },
  ) {}

  private author(
    actor: CreatorContext,
    presentationId: string,
    shareId: string,
  ): PresentationReviewAuthorContext {
    if (actor.role !== "owner" && actor.role !== "editor") throw unavailable();
    return {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      presentationId: presentationId.toLowerCase(),
      shareId: shareId.toLowerCase(),
      now: new Date(),
    };
  }
  private reviewer(actor: UserPrincipal, shareId: string, token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable();
    return {
      shareId: shareId.toLowerCase(),
      tokenHash: hashToken(token),
      actorId: actor.userId,
      now: new Date(),
    };
  }
  private async feature(workspaceId: string) {
    if (!(await this.deps.featureEnabled(workspaceId))) throw unavailable();
  }
  private async currentAuthor(actor: CreatorContext, options: AuthorRefresh) {
    const current = await options.reauthorize();
    if (
      !current ||
      current.userId !== actor.userId ||
      current.workspaceId !== actor.workspaceId ||
      !["owner", "editor"].includes(current.role)
    )
      throw unavailable();
    return current;
  }
  private async currentReviewer(actor: UserPrincipal, options: ReviewerRefresh) {
    const current = await options.reauthorize();
    if (!current || current.userId !== actor.userId) throw unavailable();
    return current;
  }

  async access(shareId: string, token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable();
    const context = () => ({
      shareId: shareId.toLowerCase(),
      tokenHash: hashToken(token),
      now: new Date(),
    });
    const first = await this.deps.feedback.getReviewAccess(context());
    await this.feature(first.workspaceId);
    const fresh = await this.deps.feedback.getReviewAccess(context());
    if (fresh.workspaceId !== first.workspaceId) throw unavailable();
    return PresentationReviewFeedbackAccessSchema.parse(fresh.access);
  }

  async authorReview(
    actor: CreatorContext,
    presentationId: string,
    shareId: string,
    options: AuthorRefresh,
  ) {
    const first = await this.deps.feedback.getAuthorReview(
      this.author(actor, presentationId, shareId),
    );
    await this.feature(first.workspaceId);
    const current = await this.currentAuthor(actor, options);
    const fresh = await this.deps.feedback.getAuthorReview(
      this.author(current, presentationId, shareId),
    );
    if (fresh.workspaceId !== first.workspaceId) throw unavailable();
    return PresentationReviewFeedbackSchema.parse(fresh.feedback);
  }

  async enable(
    actor: CreatorContext,
    presentationId: string,
    shareId: string,
    value: EnablePresentationReview,
    options: AuthorRefresh,
  ) {
    const request = EnablePresentationReviewSchema.parse(value);
    const first = await this.deps.feedback.getAuthorReview(
      this.author(actor, presentationId, shareId),
    );
    await this.feature(first.workspaceId);
    const current = await this.currentAuthor(actor, options);
    const result = await this.deps.feedback.enableReview({
      ...this.author(current, presentationId, shareId),
      request,
    });
    if (result.workspaceId !== first.workspaceId) throw unavailable();
    return PresentationReviewFeedbackMutationResponseSchema.parse(result.result);
  }

  async authorMutation(
    actor: CreatorContext,
    presentationId: string,
    shareId: string,
    value: PresentationReviewFeedbackMutation,
    options: AuthorRefresh,
  ) {
    const mutation = PresentationReviewFeedbackMutationSchema.parse(value);
    const first = await this.deps.feedback.getAuthorReview(
      this.author(actor, presentationId, shareId),
    );
    await this.feature(first.workspaceId);
    const current = await this.currentAuthor(actor, options);
    const result = await this.deps.feedback.mutateAuthorReview({
      ...this.author(current, presentationId, shareId),
      mutation,
    });
    if (result.workspaceId !== first.workspaceId) throw unavailable();
    return PresentationReviewFeedbackMutationResponseSchema.parse(result.result);
  }

  async reviewerReview(
    actor: UserPrincipal,
    shareId: string,
    token: string,
    options: ReviewerRefresh,
  ) {
    const first = await this.deps.feedback.getReviewerReview(this.reviewer(actor, shareId, token));
    await this.feature(first.workspaceId);
    const current = await this.currentReviewer(actor, options);
    const fresh = await this.deps.feedback.getReviewerReview(
      this.reviewer(current, shareId, token),
    );
    if (fresh.workspaceId !== first.workspaceId) throw unavailable();
    return PresentationReviewFeedbackSchema.parse(fresh.feedback);
  }

  async reviewerMutation(
    actor: UserPrincipal,
    shareId: string,
    token: string,
    value: PresentationReviewFeedbackMutation,
    options: ReviewerRefresh,
  ) {
    const mutation = PresentationReviewFeedbackMutationSchema.parse(value);
    const first = await this.deps.feedback.getReviewerReview(this.reviewer(actor, shareId, token));
    await this.feature(first.workspaceId);
    const current = await this.currentReviewer(actor, options);
    const result = await this.deps.feedback.mutateReviewerReview({
      ...this.reviewer(current, shareId, token),
      mutation,
    });
    if (result.workspaceId !== first.workspaceId) throw unavailable();
    return PresentationReviewFeedbackMutationResponseSchema.parse(result.result);
  }
}
