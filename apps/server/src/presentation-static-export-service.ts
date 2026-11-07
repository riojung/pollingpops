import {
  PRESENTATION_STATIC_EXPORT_LIMITS as limits,
  PresentationStaticExportRequestSchema,
  PresentationStaticExportSourceSchema,
  type PresentationStaticExportRequest,
  type PresentationStaticExportErrorCode,
  type PresentationReview,
} from "@openround/contracts";
import type {
  CreatorContext,
  MediaAssetRecord,
  PresentationRepository,
  PresentationVersionRecord,
  Repository,
} from "@openround/db";
import type { StorageService } from "./storage.js";
import {
  presentationReviewMediaIds,
  projectPresentationReview,
} from "./presentation-sharing-projection.js";
import {
  renderPresentationStatic,
  PresentationStaticExportError,
} from "./presentation-static-renderer.js";
export class PresentationStaticExportRequestError extends Error {
  constructor(
    public readonly code: PresentationStaticExportErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
export type PresentationStaticRenderer = typeof renderPresentationStatic;
export interface PresentationStaticExportDependencies {
  repository: Repository;
  presentations: PresentationRepository;
  storage: Pick<StorageService, "readImage">;
  featureEnabled: (workspaceId: string) => Promise<boolean>;
  render?: PresentationStaticRenderer;
  deadlineMs?: number;
}
export interface PresentationStaticExportAccess {
  reauthorize: () => Promise<CreatorContext | null>;
  signal?: AbortSignal;
}
const unavailable = () =>
  new PresentationStaticExportRequestError(
    "EXPORT_UNAVAILABLE",
    404,
    "This published presentation is unavailable",
  );
const mediaUnavailable = () =>
  new PresentationStaticExportRequestError(
    "EXPORT_MEDIA_UNAVAILABLE",
    409,
    "A published image is unavailable or changed. Retry after checking its scan status.",
  );
const outputTypes = {
  pdf: "application/pdf",
  png: "image/png",
  html: "text/html",
  offline_html: "text/html",
} as const;
function assetUnchanged(actual: MediaAssetRecord | null, expected: MediaAssetRecord) {
  return (
    !!actual &&
    actual.scanStatus === "clean" &&
    !actual.deletionStartedAt &&
    actual.id === expected.id &&
    actual.objectKey === expected.objectKey &&
    actual.mimeType === expected.mimeType &&
    actual.sizeBytes === expected.sizeBytes
  );
}
export class PresentationStaticExportService {
  private active = 0;
  private render: PresentationStaticRenderer;
  private deadlineMs: number;
  constructor(private deps: PresentationStaticExportDependencies) {
    this.render = deps.render ?? renderPresentationStatic;
    this.deadlineMs = deps.deadlineMs ?? 30_000;
    if (!Number.isFinite(this.deadlineMs) || this.deadlineMs < 1 || this.deadlineMs > 60_000)
      throw new Error("Invalid static export deadline");
  }
  private async authorize(actor: CreatorContext, access: PresentationStaticExportAccess) {
    const session = await access.reauthorize();
    if (!session || session.userId !== actor.userId || session.workspaceId !== actor.workspaceId)
      throw unavailable();
    const member = await this.deps.repository.getCreatorByUserId(actor.userId, actor.workspaceId);
    if (!member) throw unavailable();
    if (!["owner", "editor"].includes(member.role))
      throw new PresentationStaticExportRequestError(
        "EXPORT_FORBIDDEN",
        403,
        "An owner or editor is required to export presentations",
      );
    if (
      (await this.deps.repository.workspaceDeletionStarted(actor.workspaceId)) ||
      !(await this.deps.featureEnabled(actor.workspaceId))
    )
      throw unavailable();
  }
  private async source(
    actor: CreatorContext,
    presentationId: string,
    versionId: string,
    access: PresentationStaticExportAccess,
    expected?: PresentationVersionRecord,
  ) {
    await this.authorize(actor, access);
    const [parent, version] = await Promise.all([
      this.deps.presentations.getPresentation(actor.workspaceId, presentationId),
      this.deps.presentations.getPresentationVersion(actor.workspaceId, versionId),
    ]);
    if (
      !parent ||
      !version ||
      version.presentationId !== presentationId ||
      version.workspaceId !== actor.workspaceId ||
      (expected &&
        (version.contentHash !== expected.contentHash || version.version !== expected.version))
    )
      throw unavailable();
    return version;
  }
  private review(version: PresentationVersionRecord) {
    // This is a recipient projection, not a share capability. Static artifacts have no link expiry.
    return projectPresentationReview(version, { expiresAt: version.publishedAt });
  }
  async metadata(
    actor: CreatorContext,
    presentationId: string,
    versionId: string,
    access: PresentationStaticExportAccess,
  ) {
    const version = await this.source(
        actor,
        presentationId.toLowerCase(),
        versionId.toLowerCase(),
        access,
      ),
      review = this.review(version);
    const source = PresentationStaticExportSourceSchema.parse({
      versionId: version.id,
      version: version.version,
      title: review.title,
      pages: review.blocks.map((block, index) => {
        const title =
          block.kind === "question"
            ? block.question.prompt
            : block.scene?.nodes.find((node) => node.type === "text" && node.role === "title")
                  ?.type === "text"
              ? (
                  block.scene.nodes.find(
                    (node) => node.type === "text" && node.role === "title",
                  ) as { text: string }
                ).text
              : block.textElements.find((element) => element.role === "title")?.text;
        return { blockId: block.id, title: (title?.trim() || `Page ${index + 1}`).slice(0, 160) };
      }),
    });
    await this.source(
      actor,
      presentationId.toLowerCase(),
      versionId.toLowerCase(),
      access,
      version,
    );
    return source;
  }
  async export(
    actor: CreatorContext,
    presentationId: string,
    value: PresentationStaticExportRequest,
    access: PresentationStaticExportAccess,
  ) {
    const input = PresentationStaticExportRequestSchema.parse(value);
    presentationId = presentationId.toLowerCase();
    const deadline = new AbortController();
    let expired = false,
      acquired = false;
    const signal = access.signal
      ? AbortSignal.any([access.signal, deadline.signal])
      : deadline.signal;
    const timer = setTimeout(() => {
      expired = true;
      deadline.abort();
    }, this.deadlineMs);
    timer.unref?.();
    const check = () => {
      if (signal.aborted)
        throw new PresentationStaticExportRequestError(
          "EXPORT_CANCELLED",
          expired ? 504 : 408,
          expired
            ? "The export exceeded its time limit. Try a smaller deck."
            : "The export was cancelled",
        );
    };
    try {
      check();
      await this.authorize(actor, access);
      check();
      if (this.active >= 2)
        throw new PresentationStaticExportRequestError(
          "EXPORT_BUSY",
          503,
          "Two exports are already running. Try again shortly.",
          1,
        );
      this.active++;
      acquired = true;
      const version = await this.source(actor, presentationId, input.versionId, access);
      check();
      let review = this.review(version);
      if (input.format === "png") {
        const selected = review.blocks.find((block) => block.id.toLowerCase() === input.blockId);
        if (!selected)
          throw new PresentationStaticExportRequestError(
            "EXPORT_INVALID",
            422,
            "Choose a page from this published version",
          );
        review = {
          ...review,
          blocks: [selected],
          sections: review.sections
            .map((section) => ({
              ...section,
              blockIds: section.blockIds.filter(
                (id) => id.toLowerCase() === selected.id.toLowerCase(),
              ),
            }))
            .filter((section) => section.blockIds.length),
        };
      }
      if (review.blocks.length > limits.maxPages)
        throw new PresentationStaticExportRequestError(
          "EXPORT_LIMIT",
          413,
          "Static exports support at most 100 published pages",
        );
      const ids = [...presentationReviewMediaIds(review)];
      if (ids.length > limits.maxImages)
        throw new PresentationStaticExportRequestError(
          "EXPORT_LIMIT",
          413,
          "Static exports support at most 40 unique images",
        );
      const assets = new Map<string, MediaAssetRecord>();
      let total = 0;
      for (const id of ids) {
        check();
        const asset = await this.deps.repository.getMediaAsset(actor.workspaceId, id);
        check();
        if (
          !asset ||
          asset.scanStatus !== "clean" ||
          asset.deletionStartedAt ||
          !Number.isInteger(asset.sizeBytes) ||
          asset.sizeBytes <= 0 ||
          asset.sizeBytes > limits.maxImageBytes ||
          !["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType)
        )
          throw mediaUnavailable();
        total += asset.sizeBytes;
        if (total > limits.maxImageTotalBytes)
          throw new PresentationStaticExportRequestError(
            "EXPORT_LIMIT",
            413,
            "Static exports support at most 40 MiB of images",
          );
        assets.set(id, asset);
      }
      const images = new Map<string, { bytes: Buffer; contentType: string }>();
      for (const [id, asset] of assets) {
        await this.source(actor, presentationId, input.versionId, access, version);
        check();
        if (!assetUnchanged(await this.deps.repository.getMediaAsset(actor.workspaceId, id), asset))
          throw mediaUnavailable();
        check();
        let bytes: Buffer;
        try {
          bytes = await this.deps.storage.readImage(asset);
        } catch {
          check();
          throw mediaUnavailable();
        }
        check();
        if (
          bytes.byteLength !== asset.sizeBytes ||
          !assetUnchanged(await this.deps.repository.getMediaAsset(actor.workspaceId, id), asset)
        )
          throw mediaUnavailable();
        await this.source(actor, presentationId, input.versionId, access, version);
        check();
        images.set(id, { bytes, contentType: asset.mimeType });
      }
      let result: Awaited<ReturnType<PresentationStaticRenderer>>;
      try {
        result = await this.render({
          review: review as PresentationReview,
          images,
          format: input.format,
          ...(input.blockId ? { blockId: input.blockId } : {}),
          signal,
        });
      } catch (error) {
        check();
        throw error;
      }
      check();
      if (
        result.extension !== (input.format === "offline_html" ? "html" : input.format) ||
        result.contentType.split(";", 1)[0] !== outputTypes[input.format] ||
        !Buffer.isBuffer(result.bytes)
      )
        throw new PresentationStaticExportRequestError(
          "EXPORT_INVALID",
          422,
          "The renderer returned an invalid export",
        );
      if (result.bytes.byteLength > limits.maxOutputBytes)
        throw new PresentationStaticExportRequestError(
          "EXPORT_LIMIT",
          413,
          "The static export exceeds 40 MiB",
        );
      await this.source(actor, presentationId, input.versionId, access, version);
      for (const [id, asset] of assets) {
        check();
        if (!assetUnchanged(await this.deps.repository.getMediaAsset(actor.workspaceId, id), asset))
          throw mediaUnavailable();
      }
      check();
      return {
        bytes: result.bytes,
        contentType: outputTypes[input.format],
        extension: result.extension,
      };
    } catch (error) {
      if (error instanceof PresentationStaticExportError) {
        const statuses = {
          EXPORT_INVALID: 422,
          EXPORT_LIMIT: 413,
          EXPORT_MEDIA_UNAVAILABLE: 409,
          EXPORT_CANCELLED: 408,
        } as const;
        throw new PresentationStaticExportRequestError(
          error.code,
          statuses[error.code],
          error.message,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (acquired) this.active--;
    }
  }
}
