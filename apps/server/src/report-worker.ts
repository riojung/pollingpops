import type { Repository } from "@openround/db";
import type { MetricsService } from "./metrics.js";
import type { ProductEventDispatcher } from "./product-events.js";
import { generateReport } from "./reporting.js";

export type ReportWorkerResult = "idle" | "completed" | "retry_scheduled" | "failed";

export interface ReportWorkerProductEvents {
  dispatcher: ProductEventDispatcher;
  workspaceEnabled: (workspaceId: string) => boolean | Promise<boolean>;
}

export class ReportWorker {
  constructor(
    private readonly repository: Repository,
    private readonly leaseMs: number,
    private readonly metrics?: MetricsService,
    private readonly productEvents?: ReportWorkerProductEvents,
  ) {}

  async runOnce(now = new Date()): Promise<ReportWorkerResult> {
    const job = await this.repository.claimReportJob(now, new Date(now.getTime() + this.leaseMs));
    if (!job) return "idle";

    try {
      const session = await this.repository.getSessionById(job.sessionId);
      if (!session || session.workspaceId !== job.workspaceId) {
        throw new Error("The report session no longer exists");
      }
      const evidence = await this.repository.getSessionEvidence(job.workspaceId, job.sessionId);
      const report = generateReport(session.state, job.expiresAt, {
        id: job.reportId,
        evidence,
        generatedAt: now,
      });
      await this.repository.completeReportJob(job, report);
      this.metrics?.reportGenerated();
      try {
        if (await this.productEvents?.workspaceEnabled(job.workspaceId)) {
          this.productEvents!.dispatcher.enqueue({
            workspaceId: job.workspaceId,
            now,
            events: [
              {
                name: "report_reconciled",
                occurredAt: now.toISOString(),
                dimensions: { artifactType: "round" },
              },
            ],
          });
        }
      } catch {
        // Report readiness is authoritative; best-effort telemetry cannot roll it back.
      }
      return "completed";
    } catch (error) {
      const failed = job.attempts >= 5;
      const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, job.attempts - 1));
      await this.repository.retryReportJob(
        job,
        error instanceof Error ? error.message : "Unknown report generation error",
        new Date(now.getTime() + delayMs),
        failed,
      );
      return failed ? "failed" : "retry_scheduled";
    }
  }

  async runUntilIdle(limit = 100) {
    const results: ReportWorkerResult[] = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await this.runOnce();
      results.push(result);
      if (result === "idle" || result === "retry_scheduled" || result === "failed") break;
    }
    return results;
  }
}
