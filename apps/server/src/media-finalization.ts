import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { MediaAssetRecord, Repository } from "@openround/db";
import type { MetricsService } from "./metrics.js";
import type { StorageService } from "./storage.js";

export class MediaFinalizationConflictError extends Error {
  constructor(
    message = "The upload is unavailable or the scanner could not complete; retry shortly",
  ) {
    super(message);
  }
}

/** Shared by creator and board uploads after the caller authorizes ownership. */
export async function completeMediaFinalization<T>(
  input: {
    workspaceId: string;
    asset: MediaAssetRecord;
    actorId: string | null;
    requestId: string;
    log: FastifyBaseLogger;
    repository: Repository;
    storage: StorageService;
    metrics: Pick<MetricsService, "recordMediaFinalization">;
  },
  respond: (asset: MediaAssetRecord) => T | Promise<T>,
): Promise<T> {
  const { workspaceId, asset, actorId, requestId, log, repository, storage, metrics } = input;
  const id = asset.id;
  const finalizationToken = randomUUID();
  let finalizationCommitted = false;
  let failureCleanupAllowed = true;
  try {
    const claimed = await repository.claimMediaAssetFinalization(
      workspaceId,
      id,
      finalizationToken,
    );
    if (!claimed) {
      throw new MediaFinalizationConflictError("Media state changed; retry shortly");
    }
    const result = await storage.finalize(claimed, finalizationToken);
    if (result.scanStatus === "clean") {
      // A clean row is externally visible and may be referenced immediately. Make the winner
      // lifecycle-safe before the conditional database commit can acknowledge it.
      await storage.commitFinalizationCandidate(claimed, finalizationToken, result.objectKey);
    }
    let updated: Awaited<ReturnType<Repository["updateMediaAsset"]>>;
    try {
      updated = await repository.updateMediaAsset(workspaceId, id, {
        ...result,
        finalizationToken,
        finalizedAt: new Date(),
      });
    } catch (updateError) {
      // A dropped connection can hide a committed CAS. Reconcile before deleting the candidate;
      // otherwise a clean row could be left pointing at an object we just removed.
      failureCleanupAllowed = false;
      const authoritative = await repository.getMediaAsset(workspaceId, id).catch(() => null);
      const committedThisAttempt =
        authoritative !== null &&
        ((result.scanStatus === "clean" &&
          authoritative.scanStatus === "clean" &&
          authoritative.objectKey === result.objectKey) ||
          (result.scanStatus === "rejected" && authoritative.scanStatus === "rejected"));
      if (committedThisAttempt) {
        updated = authoritative;
        finalizationCommitted = true;
      } else {
        // This conditional release succeeds only while this attempt still owns the lease. If
        // ownership or the authoritative read is uncertain, preserve the private candidate for
        // retry/retention instead of risking deletion of a committed winner.
        failureCleanupAllowed = await repository
          .releaseMediaAssetFinalization(workspaceId, id, finalizationToken)
          .catch(() => false);
        throw updateError;
      }
    }
    if (!updated) {
      await storage
        .deleteFinalizationCandidate(
          claimed,
          finalizationToken,
          result.scanStatus === "clean" ? result.objectKey : undefined,
        )
        .catch((cleanupError) => {
          log.error(
            {
              errorType: cleanupError instanceof Error ? cleanupError.name : "unknown",
              mediaId: id,
            },
            "stale media finalization candidate cleanup deferred",
          );
        });
      throw new MediaFinalizationConflictError("Media state changed; retry shortly");
    }
    finalizationCommitted = true;
    try {
      await storage.cleanupFinalization(updated);
      if (updated.scanStatus === "clean") {
        await repository.completeInlineMediaObjectCleanup(updated, new Date());
      }
    } catch (cleanupError) {
      log.error(
        {
          errorType: cleanupError instanceof Error ? cleanupError.name : "unknown",
          mediaId: id,
        },
        "media finalization object cleanup deferred",
      );
    }
    await repository
      .recordAudit({
        workspaceId,
        actorId,
        action: `media.${result.scanStatus}`,
        targetType: "media_asset",
        targetId: id,
        requestId,
      })
      .catch((auditError) => {
        log.error(
          {
            errorType: auditError instanceof Error ? auditError.name : "unknown",
            mediaId: id,
          },
          "media finalization audit write failed after authoritative commit",
        );
      });
    metrics.recordMediaFinalization(result.scanStatus);
    return await respond(updated);
  } catch (error) {
    if (error instanceof MediaFinalizationConflictError) throw error;
    if (!finalizationCommitted) {
      if (failureCleanupAllowed) {
        await storage.deleteFinalizationCandidate(asset, finalizationToken).catch(() => undefined);
        await repository
          .releaseMediaAssetFinalization(workspaceId, id, finalizationToken)
          .catch(() => undefined);
      }
      metrics.recordMediaFinalization("error");
    }
    log.warn(
      { err: error, mediaId: id, finalizationCommitted },
      finalizationCommitted
        ? "media finalization committed but response delivery failed"
        : "media finalization deferred",
    );
    throw new MediaFinalizationConflictError();
  }
}
