import { createHash } from "node:crypto";
import {
  CreatePresentationPracticeAssignmentSchema,
  StartPresentationPracticeAttemptSchema,
  PresentationPracticeProgressSchema,
  type CreatePresentationPracticeAssignment,
  type StartPresentationPracticeAttempt,
  type PresentationPracticeProgress,
} from "@openround/contracts";
import {
  PresentationPracticeAssignmentError,
  type CreatorContext,
  type PresentationPracticeAssignmentRecord,
  type PresentationPracticeAttemptRecord,
  type PresentationVersionRecord,
  type PresentationPracticeAssignmentRepository,
  type Repository,
} from "@openround/db";
import { hashToken } from "./security.js";
import {
  projectPresentationReview,
  presentationReviewMediaIds,
} from "./presentation-sharing-projection.js";
import type { StorageService } from "./storage.js";
import {
  practiceAssignmentMetadata,
  practiceAttemptMetadata,
  projectPresentationPracticeInsights,
} from "./presentation-practice-projection.js";

const unavailable = () => new PresentationPracticeAssignmentError("UNAVAILABLE");
export class PresentationPracticeMediaBusyError extends Error {}
function credential(value: string) {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(value) ||
    Buffer.from(value, "base64url").length !== 32 ||
    Buffer.from(value, "base64url").toString("base64url") !== value
  )
    throw unavailable();
  return hashToken(value);
}
type AssignmentSource = {
  assignment: PresentationPracticeAssignmentRecord;
  version: PresentationVersionRecord;
};
type AttemptSource = AssignmentSource & { attempt: PresentationPracticeAttemptRecord };
export class PresentationPracticeService {
  private activeReads = 0;
  constructor(
    private deps: {
      repository: Repository;
      assignments: PresentationPracticeAssignmentRepository;
      storage: Pick<StorageService, "readImage">;
      webOrigin: string;
      featureEnabled: (workspaceId: string) => Promise<boolean>;
    },
  ) {}
  private writer(actor: CreatorContext) {
    if (!["owner", "editor"].includes(actor.role)) throw unavailable();
  }
  private async enabled(workspaceId: string) {
    if (!(await this.deps.featureEnabled(workspaceId))) throw unavailable();
  }
  private preview(value: AssignmentSource) {
    return {
      assignment: practiceAssignmentMetadata(value.assignment),
      review: projectPresentationReview(value.version, value.assignment),
    };
  }
  private snapshot(value: AttemptSource) {
    return {
      ...this.preview(value),
      attempt: practiceAttemptMetadata(value.attempt, value.version),
    };
  }
  async create(
    actor: CreatorContext,
    presentationId: string,
    value: CreatePresentationPracticeAssignment,
  ) {
    this.writer(actor);
    await this.enabled(actor.workspaceId);
    presentationId = presentationId.toLowerCase();
    const input = CreatePresentationPracticeAssignmentSchema.parse(value);
    input.requestId = input.requestId.toLowerCase();
    input.versionId = input.versionId.toLowerCase();
    input.expiresAt = new Date(input.expiresAt).toISOString();
    const { token, ...request } = input;
    const tokenHash = credential(token);
    const intentHash = createHash("sha256")
      .update(JSON.stringify({ presentationId, ...request, tokenHash }))
      .digest("hex");
    const result = await this.deps.assignments.createAssignment({
      ...request,
      presentationId,
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      tokenHash,
      intentHash,
      now: new Date(),
    });
    return {
      assignment: practiceAssignmentMetadata(result.assignment),
      replayed: result.replayed,
      url: `${this.deps.webOrigin}/presentation-practice/${result.assignment.id}#token=${token}`,
    };
  }
  async list(actor: CreatorContext, presentationId: string) {
    this.writer(actor);
    await this.enabled(actor.workspaceId);
    return {
      assignments: (
        await this.deps.assignments.listAssignments(
          actor.workspaceId,
          presentationId.toLowerCase(),
          actor.userId,
        )
      ).map(practiceAssignmentMetadata),
    };
  }
  async revoke(actor: CreatorContext, presentationId: string, assignmentId: string) {
    this.writer(actor);
    if (
      !(await this.deps.assignments.revokeAssignment(
        actor.workspaceId,
        presentationId.toLowerCase(),
        assignmentId.toLowerCase(),
        actor.userId,
        new Date(),
      ))
    )
      throw unavailable();
  }
  async insights(actor: CreatorContext, presentationId: string, assignmentId: string) {
    this.writer(actor);
    await this.enabled(actor.workspaceId);
    const result = await this.deps.assignments.getPracticeInsights(
      actor.workspaceId,
      presentationId.toLowerCase(),
      assignmentId.toLowerCase(),
      actor.userId,
      new Date(),
    );
    if (!result) throw unavailable();
    await this.enabled(actor.workspaceId);
    return projectPresentationPracticeInsights(result);
  }
  private async source(assignmentId: string, token: string) {
    const result = await this.deps.assignments.getPublicAssignment(
      assignmentId.toLowerCase(),
      credential(token),
      new Date(),
    );
    if (!result) throw unavailable();
    await this.enabled(result.assignment.workspaceId);
    return result;
  }
  async read(assignmentId: string, token: string) {
    return this.preview(await this.source(assignmentId, token));
  }
  private async authorizedAccess(assignmentId: string, token: string) {
    const assignment = await this.deps.assignments.getAssignmentAccess(
      assignmentId.toLowerCase(),
      credential(token),
      new Date(),
    );
    if (!assignment) throw unavailable();
    await this.enabled(assignment.workspaceId);
    return assignment;
  }
  async access(assignmentId: string, token: string) {
    const assignment = await this.authorizedAccess(assignmentId, token);
    return { versionId: assignment.versionId, expiresAt: assignment.expiresAt.toISOString() };
  }
  async start(assignmentId: string, token: string, value: StartPresentationPracticeAttempt) {
    const assignment = await this.authorizedAccess(assignmentId, token);
    const request = StartPresentationPracticeAttemptSchema.parse(value);
    const result = await this.deps.assignments.startAttempt({
      assignmentId: assignment.id,
      assignmentTokenHash: credential(token),
      attemptId: request.attemptId.toLowerCase(),
      tokenHash: credential(request.token),
      now: new Date(),
    });
    await this.enabled(result.assignment.workspaceId);
    return {
      attempt: practiceAttemptMetadata(result.attempt, result.version),
      replayed: result.replayed,
    };
  }
  private async attemptSource(assignmentId: string, attemptId: string, token: string) {
    const result = await this.deps.assignments.getAttempt(
      assignmentId.toLowerCase(),
      attemptId.toLowerCase(),
      credential(token),
      new Date(),
    );
    if (!result) throw unavailable();
    await this.enabled(result.assignment.workspaceId);
    return result;
  }
  async attempt(assignmentId: string, attemptId: string, token: string) {
    return this.snapshot(await this.attemptSource(assignmentId, attemptId, token));
  }
  async progress(
    assignmentId: string,
    attemptId: string,
    token: string,
    value: PresentationPracticeProgress,
  ) {
    // The feature fence precedes writes; the repository repeats capability/deadline checks atomically.
    const active = await this.attemptSource(assignmentId, attemptId, token);
    const request = PresentationPracticeProgressSchema.parse(value);
    request.requestId = request.requestId.toLowerCase();
    if (request.kind !== "complete") request.blockId = request.blockId.toLowerCase();
    if (request.kind === "answer") request.choiceId = request.choiceId.toLowerCase();
    const result = await this.deps.assignments.mutateAttempt({
      assignmentId: active.assignment.id,
      attemptId: active.attempt.id,
      tokenHash: credential(token),
      mutation: request,
      now: new Date(),
    });
    return {
      attempt: practiceAttemptMetadata(result.attempt, result.version),
      replayed: result.replayed,
    };
  }
  async media(assignmentId: string, token: string, mediaId: string) {
    const value = await this.source(assignmentId, token);
    mediaId = mediaId.toLowerCase();
    if (!presentationReviewMediaIds(this.preview(value).review).has(mediaId)) throw unavailable();
    const asset = await this.deps.repository.getMediaAsset(value.assignment.workspaceId, mediaId);
    if (!asset || asset.scanStatus !== "clean" || asset.sizeBytes > 10 * 1024 * 1024)
      throw unavailable();
    if (this.activeReads >= 4) throw new PresentationPracticeMediaBusyError();
    this.activeReads++;
    try {
      const bytes = await this.deps.storage.readImage(asset);
      const current = await this.authorizedAccess(assignmentId, token);
      const fresh = await this.deps.repository.getMediaAsset(current.workspaceId, asset.id);
      if (
        current.versionId !== value.assignment.versionId ||
        !fresh ||
        fresh.scanStatus !== "clean" ||
        fresh.objectKey !== asset.objectKey ||
        fresh.sizeBytes !== bytes.byteLength ||
        bytes.byteLength > 10 * 1024 * 1024
      )
        throw unavailable();
      return { bytes, contentType: asset.mimeType };
    } catch {
      throw unavailable();
    } finally {
      this.activeReads--;
    }
  }
}
