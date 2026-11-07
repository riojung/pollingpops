import { createPresentationTextAssistanceRepository, type Repository } from "@openround/db";
import { PRESENTATION_TEXT_ASSISTANCE_MAX_ATTEMPTS } from "@openround/contracts";
import type { PresentationTextAssistanceService } from "./presentation-text-assistance-service.js";
import {
  validatePresentationTextAssistanceOutput,
  type PresentationTextAssistanceProvider,
} from "./presentation-text-assistance-provider.js";

export type PresentationTextAssistanceWorkerResult =
  "idle" | "completed" | "retry_scheduled" | "failed" | "superseded";

export class PresentationTextAssistanceWorker {
  private jobs;
  constructor(
    repository: Repository,
    private readonly provider: PresentationTextAssistanceProvider | null,
    private readonly service: PresentationTextAssistanceService,
    private readonly leaseMs: number,
  ) {
    this.jobs = createPresentationTextAssistanceRepository(repository);
  }

  async runOnce(now = new Date()): Promise<PresentationTextAssistanceWorkerResult> {
    const started = performance.now();
    const currentTime = () => new Date(now.getTime() + Math.max(0, performance.now() - started));
    await this.jobs.purgeExpired(now);
    if (!this.provider) return "idle";
    const job = await this.jobs.claim(now, new Date(now.getTime() + this.leaseMs));
    if (!job) return "idle";
    const fence = { jobId: job.id, attempt: job.attempt, leaseToken: job.leaseToken };
    const unavailable = async () =>
      (await this.jobs.fail({
        ...fence,
        now: currentTime(),
        errorCode: "SOURCE_UNAVAILABLE",
        terminal: true,
      }))
        ? ("failed" as const)
        : ("superseded" as const);
    try {
      await this.service.authorize(
        { userId: job.createdBy, workspaceId: job.workspaceId },
        job.presentationId,
      );
    } catch {
      return unavailable();
    }
    let raw: unknown;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      raw = await Promise.race([
        this.provider.generate({
          text: job.originalText,
          role: job.role,
          ...(job.operation === "translate"
            ? { operation: "translate" as const, targetLanguage: job.targetLanguage! }
            : { operation: job.operation }),
        }),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error("Provider deadline exceeded")), 45_000);
        }),
      ]);
    } catch {
      const terminal = job.attempt >= PRESENTATION_TEXT_ASSISTANCE_MAX_ATTEMPTS;
      const failedAt = currentTime();
      const updated = await this.jobs.fail({
        ...fence,
        now: failedAt,
        errorCode: "PROVIDER_UNAVAILABLE",
        terminal,
        availableAt: new Date(
          failedAt.getTime() + Math.min(60_000, 2_000 * 2 ** Math.max(0, job.attempt - 1)),
        ),
      });
      return !updated ? "superseded" : terminal ? "failed" : "retry_scheduled";
    } finally {
      if (deadline) clearTimeout(deadline);
    }
    let proposal;
    try {
      proposal = validatePresentationTextAssistanceOutput({
        raw,
        originalText: job.originalText,
        blockId: job.blockId,
        nodeId: job.nodeId,
        role: job.role,
        operation: job.operation,
        provider: this.provider.providerName,
        model: this.provider.modelName,
        generatedAt: currentTime(),
        ...(job.operation === "translate"
          ? { targetLanguage: job.targetLanguage, sourceLanguage: job.sourceLanguage }
          : {}),
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
      return unavailable();
    }
    return (await this.jobs.complete({ ...fence, now: currentTime(), proposal }))
      ? "completed"
      : "superseded";
  }

  async runUntilIdle(limit = 1) {
    const results: PresentationTextAssistanceWorkerResult[] = [];
    for (let index = 0; index < limit; index++) {
      const result = await this.runOnce();
      results.push(result);
      if (result !== "completed") break;
    }
    return results;
  }
}
