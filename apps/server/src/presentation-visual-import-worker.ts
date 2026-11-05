import { randomUUID } from "node:crypto";
import pino from "pino";
import type { FastifyBaseLogger } from "fastify";
import {
  createPresentationVisualImportRepository,
  type MediaAssetCreateInput,
  type Repository,
} from "@openround/db";
import type { MetricsService } from "./metrics.js";
import { completeMediaFinalization } from "./media-finalization.js";
import type { StorageService } from "./storage.js";
import {
  convertPresentationVisualIsolated,
  presentationVisualConversionAvailable,
  PresentationVisualConversionError,
  type PresentationVisualPage,
} from "./presentation-visual-converter.js";

export class PresentationVisualImportWorker {
  private readonly imports;
  constructor(
    private readonly repository: Repository,
    private readonly storage: StorageService,
    private readonly log: FastifyBaseLogger = pino({ level: "silent" }),
    private readonly metrics: Pick<MetricsService, "recordMediaFinalization"> = {
      recordMediaFinalization: () => undefined,
    },
    private readonly converter = convertPresentationVisualIsolated,
  ) {
    this.imports = createPresentationVisualImportRepository(repository);
  }

  async runOnce(now = new Date()) {
    if (
      !this.storage.mediaUploadsEnabled ||
      !presentationVisualConversionAvailable() ||
      !(await this.repository.getOperationalFeatures()).mediaUploads
    )
      return "idle";
    const job = await this.imports.claim(now, new Date(now.getTime() + 10 * 60_000));
    if (!job) return "idle";
    const fence = { jobId: job.id, attempt: job.attempt, leaseToken: job.leaseToken };
    if (job.attempt > 3) {
      await this.imports.retry({
        ...fence,
        errorCode: "attempt_limit",
        errorMessage:
          "Visual import could not finish after three attempts. Upload the source again.",
        availableAt: new Date(),
        failed: true,
      });
      return "failed";
    }
    try {
      const pages: PresentationVisualPage[] = [];
      const warnings = new Set([
        "Visual pages are raster images, not editable source objects. Animation, audio, video and active links are not preserved.",
        "Each selected page adds a visual slide and an author-reviewed editable reading slide. Pages are fitted into the presentation stage without cropping.",
        "Extracted text is a suggestion, not an accessible equivalent. Review reading order, meaning, diagrams and missing text; OCR is not provided.",
        "Originals are erased after conversion, terminal failure or cancellation. Pending originals expire after 24 hours and are removed by the retention sweep; previews also expire after 24 hours.",
      ]);
      let pixels = 0;
      let outputBytes = 0;
      const started = performance.now();
      for (const file of job.files) {
        if (performance.now() - started > 120_000)
          throw new PresentationVisualConversionError("timeout");
        const result = await this.converter(
          {
            kind: file.mimeType === "application/pdf" ? "pdf" : "image",
            bytes: file.bytes,
            mimeType: file.mimeType,
          },
          Math.min(45_000, Math.max(1, 120_000 - (performance.now() - started))),
        );
        for (const page of result.pages) {
          pixels += page.width * page.height;
          outputBytes += page.png.byteLength;
          if (pages.length >= 40 || pixels > 60_000_000 || outputBytes > 40 * 1024 * 1024)
            throw new PresentationVisualConversionError("limit");
          pages.push({ ...page, pageNumber: pages.length + 1 });
        }
        result.warnings.forEach((warning) => warnings.add(warning));
      }
      const assets: MediaAssetCreateInput[] = pages.map((page) => {
        const id = randomUUID();
        return {
          id,
          workspaceId: job.workspaceId,
          objectKey: `quarantine/${job.workspaceId}/${id}.png`,
          mimeType: "image/png",
          sizeBytes: page.png.byteLength,
          scanStatus: "pending",
          altText: "Converted visual page; review its description before insertion",
          createdAt: new Date(),
        };
      });
      // Reserve every asset and its lifecycle edge before any object can be written.
      if (!(await this.imports.reservePageAssets({ ...fence, assets }))) return "superseded";
      for (const [index, asset] of assets.entries()) {
        if (performance.now() - started > 5 * 60_000)
          throw new PresentationVisualConversionError("timeout");
        const current = await this.imports.get(job.workspaceId, job.presentationId, job.id);
        if (current?.status !== "processing" || current.attempts !== job.attempt)
          return "superseded";
        const record = await this.repository.getMediaAsset(job.workspaceId, asset.id);
        if (!record) return "superseded";
        await this.storage.writeVisualImportPage(record, pages[index]!.png);
        const clean = await completeMediaFinalization(
          {
            workspaceId: job.workspaceId,
            asset: record,
            actorId: job.createdBy,
            requestId: job.id,
            log: this.log,
            repository: this.repository,
            storage: this.storage,
            metrics: this.metrics,
          },
          (finalized) => finalized.scanStatus === "clean",
        );
        if (!clean) throw new PresentationVisualConversionError("malformed");
      }
      const completed = await this.imports.complete({
        ...fence,
        pages: pages.map((page, index) => ({
          pageNumber: page.pageNumber,
          mediaId: assets[index]!.id,
          width: page.width,
          height: page.height,
          extractedText: page.extractedText,
          warnings: page.extractedText.trim()
            ? []
            : ["No text was extracted. Write a readable description before importing this page."],
        })),
        warnings: [...warnings].slice(0, 40),
      });
      return completed ? "completed" : "superseded";
    } catch (error) {
      const invalid = error instanceof PresentationVisualConversionError;
      const failed = invalid || job.attempt >= 3;
      const updated = await this.imports.retry({
        ...fence,
        errorCode: invalid ? error.code : "storage_unavailable",
        errorMessage: invalid
          ? error.message
          : "Visual import could not finish. Retry later or upload the source again.",
        availableAt: new Date(Date.now() + 10_000 * job.attempt),
        failed,
      });
      return !updated ? "superseded" : failed ? "failed" : "retry_scheduled";
    }
  }

  async runUntilIdle(limit = 3) {
    const results: string[] = [];
    for (let index = 0; index < limit; index++) {
      const result = await this.runOnce();
      results.push(result);
      if (result !== "completed") break;
    }
    return results;
  }
}
