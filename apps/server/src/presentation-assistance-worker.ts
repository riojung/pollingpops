import { createPresentationAssistanceRepository, type Repository } from "@openround/db";
import { PRESENTATION_ASSISTANCE_MAX_ATTEMPTS } from "@openround/contracts";
import type { PresentationAssistanceService } from "./presentation-assistance-service.js";
import {
  validatePresentationAssistanceOutput,
  type PresentationAssistanceProvider,
} from "./presentation-assistance-provider.js";

export type PresentationAssistanceWorkerResult =
  "idle" | "completed" | "retry_scheduled" | "failed" | "superseded";

export class PresentationAssistanceWorker {
  private jobs;
  constructor(
    repository: Repository,
    private readonly provider: PresentationAssistanceProvider | null,
    private readonly service: PresentationAssistanceService,
    private readonly leaseMs: number,
  ) {
    this.jobs = createPresentationAssistanceRepository(repository);
  }

  async runOnce(now = new Date()): Promise<PresentationAssistanceWorkerResult> {
    const started = performance.now();
    const currentTime = () => new Date(now.getTime() + Math.max(0, performance.now() - started));
    await this.jobs.purgeExpired(now);
    if (!this.provider) return "idle";
    const job = await this.jobs.claim(now, new Date(now.getTime() + this.leaseMs));
    if (!job) return "idle";
    const fence = { jobId: job.id, attempt: job.attempt, leaseToken: job.leaseToken, now };
    try {
      await this.service.authorize(
        { userId: job.createdBy, workspaceId: job.workspaceId },
        job.presentationId,
      );
    } catch {
      return (await this.jobs.fail({ ...fence, errorCode: "SOURCE_UNAVAILABLE", terminal: true }))
        ? "failed"
        : "superseded";
    }
    let raw: unknown;
    try {
      raw = await this.provider.generate({
        sourceName: job.sourceName,
        outline: job.outline,
        slideCount: job.slideCount,
      });
    } catch {
      const terminal = job.attempt >= PRESENTATION_ASSISTANCE_MAX_ATTEMPTS;
      const updated = await this.jobs.fail({
        ...fence,
        now: currentTime(),
        errorCode: "PROVIDER_UNAVAILABLE",
        terminal,
        availableAt: new Date(
          currentTime().getTime() + Math.min(60_000, 2_000 * 2 ** Math.max(0, job.attempt - 1)),
        ),
      });
      return !updated ? "superseded" : terminal ? "failed" : "retry_scheduled";
    }
    let proposal;
    try {
      proposal = validatePresentationAssistanceOutput({
        raw,
        sourceName: job.sourceName,
        outline: job.outline,
        slideCount: job.slideCount,
        provider: this.provider.providerName,
        model: this.provider.modelName,
        generatedAt: currentTime(),
      });
    } catch {
      return (await this.jobs.fail({
        ...fence,
        now: currentTime(),
        errorCode: "INVALID_OUTPUT",
        terminal: true,
      }))
        ? "failed"
        : "superseded";
    }
    try {
      await this.service.authorize(
        { userId: job.createdBy, workspaceId: job.workspaceId },
        job.presentationId,
      );
    } catch {
      return (await this.jobs.fail({
        ...fence,
        now: currentTime(),
        errorCode: "SOURCE_UNAVAILABLE",
        terminal: true,
      }))
        ? "failed"
        : "superseded";
    }
    return (await this.jobs.complete({ ...fence, now: currentTime(), proposal }))
      ? "completed"
      : "superseded";
  }

  async runUntilIdle(limit = 1) {
    const results: PresentationAssistanceWorkerResult[] = [];
    for (let index = 0; index < limit; index++) {
      const result = await this.runOnce();
      results.push(result);
      if (result !== "completed") break;
    }
    return results;
  }
}
