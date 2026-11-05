import { createHash } from "node:crypto";
import { CreatePresentationShareSchema, type CreatePresentationShare } from "@openround/contracts";
import {
  PresentationShareError,
  type CreatorContext,
  type PresentationShareRepository,
  type Repository,
} from "@openround/db";
import { hashToken } from "./security.js";
import {
  projectPresentationReview,
  presentationReviewMediaIds,
} from "./presentation-sharing-projection.js";
import type { StorageService } from "./storage.js";
export interface PresentationSharingDependencies {
  repository: Repository;
  shares: PresentationShareRepository;
  storage: Pick<StorageService, "readImage">;
  webOrigin: string;
  featureEnabled: (workspaceId: string) => Promise<boolean>;
}
const unavailable = () => new PresentationShareError("UNAVAILABLE");
export class PresentationShareMediaBusyError extends Error {
  constructor() {
    super("Images are busy. Try again shortly.");
  }
}
export function presentationShareMetadata(
  share: Awaited<ReturnType<PresentationShareRepository["createShare"]>>["share"],
) {
  return {
    id: share.id,
    versionId: share.versionId,
    createdAt: share.createdAt.toISOString(),
    expiresAt: share.expiresAt.toISOString(),
    revokedAt: share.revokedAt?.toISOString() ?? null,
  };
}
export class PresentationSharingService {
  private activeReads = 0;
  constructor(private deps: PresentationSharingDependencies) {}
  private writer(actor: CreatorContext) {
    if (!["owner", "editor"].includes(actor.role)) throw unavailable();
  }
  async create(actor: CreatorContext, presentationId: string, value: CreatePresentationShare) {
    presentationId = presentationId.toLowerCase();
    this.writer(actor);
    if (!(await this.deps.featureEnabled(actor.workspaceId))) throw unavailable();
    const input = CreatePresentationShareSchema.parse(value);
    input.versionId = input.versionId.toLowerCase();
    input.requestId = input.requestId.toLowerCase();
    input.expiresAt = new Date(input.expiresAt).toISOString();
    const { token, ...request } = input;
    if (
      Buffer.from(token, "base64url").length !== 32 ||
      Buffer.from(token, "base64url").toString("base64url") !== token
    )
      throw unavailable();
    const tokenHash = hashToken(token);
    const intentHash = createHash("sha256")
      .update(
        JSON.stringify({
          presentationId,
          versionId: input.versionId,
          expiresAt: input.expiresAt,
          tokenHash,
        }),
      )
      .digest("hex");
    const result = await this.deps.shares.createShare({
      ...request,
      presentationId,
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      intentHash,
      tokenHash,
      now: new Date(),
    });
    return {
      share: presentationShareMetadata(result.share),
      replayed: result.replayed,
      url: `${this.deps.webOrigin}/presentation-review/${result.share.id}#token=${token}`,
    };
  }
  async list(actor: CreatorContext, presentationId: string) {
    presentationId = presentationId.toLowerCase();
    this.writer(actor);
    return {
      shares: (
        await this.deps.shares.listShares(actor.workspaceId, presentationId, actor.userId)
      ).map(presentationShareMetadata),
    };
  }
  async revoke(actor: CreatorContext, presentationId: string, shareId: string) {
    presentationId = presentationId.toLowerCase();
    shareId = shareId.toLowerCase();
    this.writer(actor);
    if (
      !(await this.deps.shares.revokeShare(
        actor.workspaceId,
        presentationId,
        shareId,
        actor.userId,
        new Date(),
      ))
    )
      throw unavailable();
  }
  private async authorized(shareId: string, token: string) {
    shareId = shareId.toLowerCase();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable();
    const value = await this.deps.shares.getPublicShare(shareId, hashToken(token), new Date());
    if (!value || !(await this.deps.featureEnabled(value.share.workspaceId))) throw unavailable();
    return value;
  }
  async review(shareId: string, token: string) {
    const value = await this.authorized(shareId, token);
    return projectPresentationReview(value.version, value.share);
  }
  private async accessShare(shareId: string, token: string) {
    shareId = shareId.toLowerCase();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable();
    const share = await this.deps.shares.getPublicShareAccess(
      shareId,
      hashToken(token),
      new Date(),
    );
    if (!share || !(await this.deps.featureEnabled(share.workspaceId))) throw unavailable();
    return share;
  }
  async access(shareId: string, token: string) {
    const share = await this.accessShare(shareId, token);
    return { versionId: share.versionId, expiresAt: share.expiresAt.toISOString() };
  }
  async media(shareId: string, token: string, mediaId: string) {
    const value = await this.authorized(shareId, token),
      review = projectPresentationReview(value.version, value.share);
    if (!presentationReviewMediaIds(review).has(mediaId.toLowerCase())) throw unavailable();
    const asset = await this.deps.repository.getMediaAsset(
      value.share.workspaceId,
      mediaId.toLowerCase(),
    );
    if (!asset || asset.scanStatus !== "clean" || asset.sizeBytes > 10 * 1024 * 1024)
      throw unavailable();
    if (this.activeReads >= 4) throw new PresentationShareMediaBusyError();
    this.activeReads++;
    try {
      const bytes = await this.deps.storage.readImage(asset);
      const current = await this.accessShare(shareId, token);
      const fresh = await this.deps.repository.getMediaAsset(current.workspaceId, asset.id);
      if (
        current.versionId !== value.share.versionId ||
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
