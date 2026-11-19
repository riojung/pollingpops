import { randomUUID } from "node:crypto";
import { LibraryShareSummarySchema, type LibraryShareSummary } from "@openround/contracts";
import {
  createPlatformRepository,
  LibrarySharingError,
  type CreatorContext,
  type LibraryShareRecord,
  type LibraryShareSummaryRecord,
  type LibrarySharingRepository,
  type MediaAssetCreateInput,
  type MediaAssetRecord,
  type Repository,
} from "@openround/db";
import type { AppConfig } from "./config.js";
import { workspaceFeatureEnabled } from "./feature-policy.js";
import type { StorageService } from "./storage.js";
import {
  librarySnapshotMediaIds,
  projectLibraryReader,
  reusableLibrarySnapshot,
  rewriteLibraryMedia,
} from "./library-sharing-projection.js";

const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
const unavailable = () => new LibrarySharingError("NOT_FOUND", "Library item is unavailable");

export class LibrarySharingMediaBusyError extends Error {
  constructor() {
    super("Images are busy. Try again shortly.");
  }
}

export class LibrarySharingCopyBusyError extends Error {
  constructor() {
    super("Copies are busy. Try again shortly.");
  }
}

export class LibrarySharingService {
  private activeReads = 0;
  private activeCopies = 0;
  constructor(
    private deps: {
      repository: Repository;
      shares: LibrarySharingRepository;
      storage: Pick<StorageService, "readImage" | "cloneLibraryImage" | "deleteLibraryImageClone">;
      config: AppConfig;
      featureEnabled?: (
        workspaceId: string,
        artifactType: LibraryShareSummary["artifactType"],
      ) => Promise<boolean>;
    },
  ) {}

  private async creationEnabled(
    workspaceId: string,
    artifactType: LibraryShareSummary["artifactType"],
  ) {
    if (this.deps.featureEnabled) return this.deps.featureEnabled(workspaceId, artifactType);
    return (
      artifactType === "round" ||
      workspaceFeatureEnabled(
        this.deps.repository,
        this.deps.config,
        workspaceId,
        artifactType === "presentation" ? "presentations" : "surveys",
      )
    );
  }

  async summary(share: LibraryShareSummaryRecord, creator: CreatorContext | null, forCopy = false) {
    // The internal record also holds the private pinned snapshot; whitelist summary fields.
    const summary = LibraryShareSummarySchema.parse(
      Object.fromEntries(
        Object.keys(LibraryShareSummarySchema.shape).map((key) => [
          key,
          share[key as keyof LibraryShareSummary],
        ]),
      ),
    );
    // Discovery uses only the internal schema discriminator, never the snapshot body.
    // Actual copies defer the page grant to the repository's accepted-receipt check.
    const paged = share.surveySchemaVersion === 3;
    const canAttemptCopy =
      forCopy || paged ? summary.permission === "use" : summary.capabilities.copy;
    let copyUnavailableReason: string | null = canAttemptCopy
      ? null
      : (summary.copyUnavailableReason ?? null);
    if (canAttemptCopy) {
      if (!creator || creator.role === "viewer") {
        copyUnavailableReason =
          "Choose an organization workspace where you can create content to use a copy.";
      } else {
        const organization = await createPlatformRepository(
          this.deps.repository,
        ).getOrganizationForWorkspace(creator.workspaceId);
        if (organization?.id !== summary.organizationId)
          copyUnavailableReason = "Switch to a workspace in this organization to use a copy.";
        else if (!(await this.creationEnabled(creator.workspaceId, summary.artifactType)))
          copyUnavailableReason =
            "Creating this content type is not enabled in your active workspace.";
        else if (
          !forCopy &&
          paged &&
          !(await workspaceFeatureEnabled(
            this.deps.repository,
            this.deps.config,
            creator.workspaceId,
            "surveyPages",
          ))
        )
          copyUnavailableReason = "Creating paged Survey copies is not enabled yet";
      }
    }
    return {
      ...summary,
      capabilities: {
        ...summary.capabilities,
        copy: canAttemptCopy && !copyUnavailableReason,
      },
      copyUnavailableReason,
    };
  }

  async reader(actorId: string, id: string, creator: CreatorContext | null) {
    const share = await this.deps.shares.read({ actorId, id, now: new Date() });
    if (!share) throw unavailable();
    return { share: await this.summary(share, creator), ...projectLibraryReader(share) };
  }

  async media(actorId: string, id: string, mediaId: string) {
    const share = await this.deps.shares.read({ actorId, id, now: new Date() });
    mediaId = mediaId.toLowerCase();
    if (!share || !librarySnapshotMediaIds(projectLibraryReader(share)).has(mediaId))
      throw unavailable();
    const asset = await this.deps.repository.getMediaAsset(share.sourceWorkspaceId, mediaId);
    if (
      !asset ||
      asset.scanStatus !== "clean" ||
      asset.deletionStartedAt ||
      asset.sizeBytes > 10 * 1024 * 1024
    )
      throw unavailable();
    if (this.activeReads >= 4) throw new LibrarySharingMediaBusyError();
    this.activeReads++;
    try {
      const bytes = await this.deps.storage.readImage(asset);
      const current = await this.deps.shares.read({ actorId, id, now: new Date() });
      const fresh = await this.deps.repository.getMediaAsset(share.sourceWorkspaceId, mediaId);
      if (
        !current ||
        current.versionId !== share.versionId ||
        !librarySnapshotMediaIds(projectLibraryReader(current)).has(mediaId) ||
        !fresh ||
        fresh.scanStatus !== "clean" ||
        fresh.deletionStartedAt ||
        fresh.objectKey !== asset.objectKey ||
        fresh.sizeBytes !== bytes.byteLength ||
        fresh.mimeType !== asset.mimeType
      )
        throw unavailable();
      return { bytes, contentType: asset.mimeType };
    } catch {
      throw unavailable();
    } finally {
      this.activeReads--;
    }
  }

  async copy(creator: CreatorContext, id: string, requestId: string) {
    const visible = await this.deps.shares.read({ actorId: creator.userId, id, now: new Date() });
    if (!visible) throw unavailable();
    const summary = await this.summary(visible, creator, true);
    if (!summary.capabilities.copy)
      throw new LibrarySharingError(
        "FORBIDDEN",
        summary.copyUnavailableReason ?? "This item is shared for viewing only.",
      );
    if (this.activeCopies >= 4) throw new LibrarySharingCopyBusyError();
    this.activeCopies++;
    const written: MediaAssetRecord[] = [];
    let submitted = false;
    try {
      const snapshot = reusableLibrarySnapshot(visible.snapshot);
      const replacements = new Map<string, string>();
      const mediaAssets: MediaAssetCreateInput[] = [];
      const sourceMedia: MediaAssetRecord[] = [];
      const mediaIds = [...librarySnapshotMediaIds(snapshot)];
      if (mediaIds.length > 50)
        throw new LibrarySharingError("VALIDATION_ERROR", "Use a copy with 50 images or fewer.");
      for (const mediaId of mediaIds) {
        const source = await this.deps.repository.getMediaAsset(visible.sourceWorkspaceId, mediaId);
        if (
          !source ||
          source.scanStatus !== "clean" ||
          source.deletionStartedAt ||
          source.sizeBytes > 10 * 1024 * 1024
        )
          throw unavailable();
        sourceMedia.push(source);
      }
      if (sourceMedia.reduce((total, asset) => total + asset.sizeBytes, 0) > 50 * 1024 * 1024)
        throw new LibrarySharingError(
          "VALIDATION_ERROR",
          "Use a copy with 50 MB of images or less.",
        );
      // Storage work happens before the short database authorization/commit transaction.
      for (const source of sourceMedia) {
        const cloneId = randomUUID();
        const destination: MediaAssetRecord & MediaAssetCreateInput = {
          ...source,
          id: cloneId,
          workspaceId: creator.workspaceId,
          objectKey: `media/${creator.workspaceId}/${cloneId}.${extensions[source.mimeType]}`,
          createdAt: new Date(),
          deletionStartedAt: null,
          finalizedAt: null,
        };
        written.push(destination);
        await this.deps.storage.cloneLibraryImage(source, destination);
        replacements.set(source.id.toLowerCase(), cloneId);
        mediaAssets.push(destination);
      }
      const materialized = {
        snapshot: rewriteLibraryMedia(snapshot, replacements),
        mediaAssets,
        sourceMedia,
      };
      if (!(await this.creationEnabled(creator.workspaceId, visible.artifactType)))
        throw new LibrarySharingError(
          "FORBIDDEN",
          "Creating this content type is no longer enabled in your active workspace.",
        );
      submitted = true;
      const result = await this.deps.shares.copy(
        {
          actorId: creator.userId,
          id,
          destinationWorkspaceId: creator.workspaceId,
          requestId,
          expectedVersionId: visible.versionId,
          maximumSurveySchemaVersion: (await workspaceFeatureEnabled(
            this.deps.repository,
            this.deps.config,
            creator.workspaceId,
            "surveyPages",
          ))
            ? 3
            : 2,
          now: new Date(),
        },
        async (share: LibraryShareRecord) => {
          if (
            share.versionId !== visible.versionId ||
            share.sourceWorkspaceId !== visible.sourceWorkspaceId
          )
            throw unavailable();
          return materialized;
        },
      );
      if (result.replayed)
        await Promise.allSettled(
          written.map((asset) => this.deps.storage.deleteLibraryImageClone(asset)),
        );
      return {
        ...result,
        workspaceId: creator.workspaceId,
        href:
          result.artifactType === "round"
            ? `/quiz/${result.artifactId}`
            : result.artifactType === "presentation"
              ? `/presentation/${result.artifactId}`
              : `/surveys/${result.artifactId}`,
      };
    } catch (error) {
      // A typed repository rejection guarantees rollback. Unknown commit failures may have
      // succeeded, so keep those objects rather than deleting a durable draft's images.
      if (!submitted || error instanceof LibrarySharingError)
        await Promise.allSettled(
          written.map((asset) => this.deps.storage.deleteLibraryImageClone(asset)),
        );
      throw error;
    } finally {
      this.activeCopies--;
    }
  }
}
