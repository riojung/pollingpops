import type { PresentationSessionRepository } from "@openround/db";
import type { MetricsService } from "./metrics.js";
import type { ReportWorkerProductEvents, ReportWorkerResult } from "./report-worker.js";
import { generatePresentationReport } from "./presentation-reporting.js";

export class PresentationReportWorker {
  constructor(
    private readonly sessions: PresentationSessionRepository,
    private readonly leaseMs: number,
    private readonly metrics?: MetricsService,
    private readonly productEvents?: ReportWorkerProductEvents,
  ) {}

  async runOnce(now = new Date()): Promise<ReportWorkerResult> {
    const job = await this.sessions.claimReportJob(now, new Date(now.getTime() + this.leaseMs));
    if (!job) return "idle";

    try {
      const session = await this.sessions.getSessionById(job.sessionId);
      if (!session || session.workspaceId !== job.workspaceId) {
        throw new Error("The Presentation report session no longer exists");
      }
      const [participants, responses, timeline] = await Promise.all([
        this.sessions.listParticipants(job.sessionId),
        this.sessions.listResponses(job.sessionId),
        this.sessions.listTimeline(job.sessionId),
      ]);
      const report = generatePresentationReport({ session, participants, responses, timeline });
      await this.sessions.completeReportJob(job, {
        reportId: job.reportId,
        sessionId: job.sessionId,
        schemaVersion: report.schemaVersion,
        payload: report,
        generatedAt: now,
      });
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
                dimensions: { artifactType: "presentation" },
              },
            ],
          });
        }
      } catch {
        // A ready report remains authoritative when best-effort telemetry is unavailable.
      }
      return "completed";
    } catch (error) {
      const failed = job.attempts >= 5;
      const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, job.attempts - 1));
      await this.sessions.retryReportJob(
        job,
        error instanceof Error ? error.message : "Unknown Presentation report generation error",
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
