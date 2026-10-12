import {
  createFeedbackRepository,
  MEDIA_DELETION_TOMBSTONE_HOLD_MS,
  type Repository,
} from "@openround/db";
import type { StorageService } from "./storage.js";
import type { MetricsService } from "./metrics.js";

const MEDIA_OBJECT_CLEANUP_BATCH_LIMIT = 100;
const MEDIA_OBJECT_CLEANUP_RETRY_MS = 60 * 60_000;

export interface RetentionResult {
  expiredLiveSessions: number;
  purgedSessions: number;
  purgedPracticeAssignments: number;
  purgedAuditEvents: number;
  purgedProductEvents: number;
  purgedMedia: number;
  failedMedia: number;
}

export class RetentionService {
  constructor(
    private readonly repository: Repository,
    private readonly storage: Pick<StorageService, "configured" | "deleteAsset"> &
      Partial<Pick<StorageService, "cleanupFinalization" | "deleteWorkspaceMediaObjects">>,
    private readonly quarantineRetentionHours: number,
    private readonly metrics?: MetricsService,
    private readonly onSessionsPurged?: (sessionIds: string[]) => Promise<void>,
    private readonly auditRetentionDays = 365,
    private readonly unattachedMediaGraceDays = 7,
  ) {}

  async run(now = new Date()): Promise<RetentionResult> {
    const runStartedAt = performance.now();
    // Preserve the injected clock used by retention tests while advancing long-running sweeps
    // enough that newly acquired claims never begin with an already-expired lease.
    const currentRunTime = () =>
      new Date(
        now.getTime() + Math.max(0, Math.floor((performance.now() - runStartedAt) / 1_000)) * 1_000,
      );
    const expiredLiveSessionIds = await this.repository.expireLiveSessions(now);
    const purgedSessionIds = await this.repository.purgeExpired(now);
    const purgedPracticeAssignments = await this.repository.purgeExpiredPracticeAssignments(now);
    const invalidatedSessionIds = [...new Set([...expiredLiveSessionIds, ...purgedSessionIds])];
    if (invalidatedSessionIds.length > 0) {
      await this.onSessionsPurged?.(invalidatedSessionIds);
    }
    const expiredLiveSessions = expiredLiveSessionIds.length;
    const purgedSessions = purgedSessionIds.length;
    const auditCutoff = new Date(now.getTime() - this.auditRetentionDays * 24 * 60 * 60 * 1_000);
    const purgedAuditEvents = await this.repository.purgeAuditEvents(auditCutoff);
    const purgedProductEvents = await this.repository.purgeProductEvents(now);
    await createFeedbackRepository(this.repository).purge(now);
    const cutoff = new Date(now.getTime() - this.quarantineRetentionHours * 60 * 60 * 1_000);
    const unattachedCutoff = new Date(
      now.getTime() - this.unattachedMediaGraceDays * 24 * 60 * 60 * 1_000,
    );
    const [staleQuarantineMedia, unattachedMedia, workspaceDeletionJobs] = await Promise.all([
      this.repository.listStaleMedia(cutoff, 100),
      this.repository.listUnattachedMedia(unattachedCutoff, 100),
      this.repository.listDueWorkspaceMediaDeletionJobs(now, 100),
    ]);
    const staleMedia = [
      ...new Map(
        [...staleQuarantineMedia, ...unattachedMedia].map((asset) => [asset.id, asset]),
      ).values(),
    ]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, 100);
    if (!this.storage.configured) {
      const objectCleanupClaims = await this.repository.claimMediaObjectCleanupCandidates(
        currentRunTime(),
        MEDIA_OBJECT_CLEANUP_BATCH_LIMIT,
      );
      await Promise.all(
        objectCleanupClaims.map((claim) =>
          this.repository
            .deferMediaObjectCleanupClaim(
              claim,
              new Date(currentRunTime().getTime() + MEDIA_OBJECT_CLEANUP_RETRY_MS),
            )
            .catch(() => false),
        ),
      );
      const result = {
        expiredLiveSessions,
        purgedSessions,
        purgedPracticeAssignments,
        purgedAuditEvents,
        purgedProductEvents,
        purgedMedia: 0,
        failedMedia: new Set([
          ...staleMedia.map(({ id }) => id),
          ...objectCleanupClaims.map(({ asset }) => asset.id),
          ...workspaceDeletionJobs.map(({ workspaceId }) => workspaceId),
        ]).size,
      };
      this.metrics?.recordRetention(result);
      return result;
    }

    let purgedMedia = 0;
    let failedMedia = 0;
    for (const job of workspaceDeletionJobs) {
      try {
        if (!this.storage.deleteWorkspaceMediaObjects) {
          throw new Error("Workspace media cleanup is unavailable");
        }
        // `purgedMedia` counts logical media rows. A workspace sweep can remove multiple physical
        // object candidates for the same row, so do not mix object-key counts into that metric.
        await this.storage.deleteWorkspaceMediaObjects(job.workspaceId);
        await this.repository.completeWorkspaceMediaDeletionJob(
          job.workspaceId,
          job.deletionStartedAt,
        );
      } catch {
        // The durable prefix-sweep job survives workspace/account cascade and retries later.
        failedMedia += 1;
      }
    }
    for (const asset of staleMedia) {
      const claimed = await this.repository.claimMediaAssetDeletion(
        asset.workspaceId,
        asset.id,
        now,
      );
      if (!claimed) continue;
      try {
        await this.storage.deleteAsset(claimed);
        const tombstoneMature =
          claimed.deletionStartedAt !== null &&
          now.getTime() - claimed.deletionStartedAt.getTime() >= MEDIA_DELETION_TOMBSTONE_HOLD_MS;
        if (tombstoneMature) {
          if (!(await this.repository.deleteMediaAsset(asset.workspaceId, asset.id, now))) {
            throw new Error("mature media tombstone metadata was not deleted");
          }
          purgedMedia += 1;
        }
      } catch {
        // The durable deleting tombstone remains visible to later retention retries.
        failedMedia += 1;
      }
    }
    // Durable deletion tombstones take priority over repair of already-published clean media.
    // Claim each candidate just before object-store work, rather than holding a whole batch of
    // five-minute leases while earlier candidates perform network operations.
    for (let processed = 0; processed < MEDIA_OBJECT_CLEANUP_BATCH_LIMIT; processed += 1) {
      const [claim] = await this.repository.claimMediaObjectCleanupCandidates(currentRunTime(), 1);
      if (!claim) break;
      try {
        if (!this.storage.cleanupFinalization) {
          throw new Error("Media finalization cleanup is unavailable");
        }
        await this.storage.cleanupFinalization(claim.asset, async () => {
          if (!(await this.repository.renewMediaObjectCleanupClaim(claim, currentRunTime()))) {
            throw new Error("Media object cleanup claim changed during object-store work");
          }
        });
        const completed = await this.repository.completeMediaObjectCleanupClaim(
          claim,
          currentRunTime(),
        );
        if (!completed) {
          const current = await this.repository.getMediaAsset(
            claim.asset.workspaceId,
            claim.asset.id,
          );
          if (
            current?.scanStatus === "clean" &&
            current.objectKey === claim.asset.objectKey &&
            current.finalizedAt?.getTime() === claim.asset.finalizedAt?.getTime()
          ) {
            throw new Error("Media object cleanup claim changed before completion");
          }
        }
      } catch {
        await this.repository
          .deferMediaObjectCleanupClaim(
            claim,
            new Date(currentRunTime().getTime() + MEDIA_OBJECT_CLEANUP_RETRY_MS),
          )
          .catch(() => false);
        failedMedia += 1;
      }
    }
    const result = {
      expiredLiveSessions,
      purgedSessions,
      purgedPracticeAssignments,
      purgedAuditEvents,
      purgedProductEvents,
      purgedMedia,
      failedMedia,
    };
    this.metrics?.recordRetention(result);
    return result;
  }
}
