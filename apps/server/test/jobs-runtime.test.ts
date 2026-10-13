import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthoringWorker } from "../src/authoring-worker.js";
import { ConfigSchema } from "../src/config.js";
import { createJobsRuntime } from "../src/jobs-runtime.js";
import { PresentationReportWorker } from "../src/presentation-report-worker.js";
import { ReportWorker } from "../src/report-worker.js";
import { RetentionService } from "../src/retention.js";

const config = ConfigSchema.parse({
  NODE_ENV: "test",
  ALLOW_IN_MEMORY: "true",
  REPORT_WORKER_INTERVAL_MS: "60000",
  AUTHORING_WORKER_INTERVAL_MS: "60000",
  RETENTION_INTERVAL_MINUTES: "5",
  BUSINESS_BILLING_WORKER_INTERVAL_MS: "60000",
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("dedicated jobs runtime worker controls", () => {
  it("pauses and resumes local product workers with the business platform disabled by default", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const reports = vi.spyOn(ReportWorker.prototype, "runUntilIdle");
    const presentationReports = vi.spyOn(PresentationReportWorker.prototype, "runUntilIdle");
    const authoring = vi.spyOn(AuthoringWorker.prototype, "runUntilIdle");
    const retention = vi.spyOn(RetentionService.prototype, "run");
    const onError = vi.fn();
    const runtime = await createJobsRuntime(config, onError);
    try {
      expect(config.BUSINESS_PLATFORM_ENABLED).toBe(false);
      const workerIds = ["reports", "authoring", "retention"];
      for (const id of workerIds) await runtime.platform.setWorkerControl(id, true);

      runtime.runner.start();
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      for (const worker of [reports, presentationReports, authoring, retention]) {
        expect(worker).not.toHaveBeenCalled();
      }

      for (const id of workerIds) await runtime.platform.setWorkerControl(id, false);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      for (const worker of [reports, presentationReports, authoring, retention]) {
        expect(worker).toHaveBeenCalled();
      }
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
    }
  });

  it.each([
    ["billing", "billing-reconciliation"],
    ["billing-reconciliation", "billing-reconciliation"],
    ["integrations", "business-integrations"],
  ])("uses the durable %s control alias %s while commerce is disabled", async (name, controlId) => {
    const onError = vi.fn();
    const runtime = await createJobsRuntime(config, onError);
    const run = vi.fn().mockResolvedValue(undefined);
    const job = { name, intervalMs: 1_000, run };
    try {
      await runtime.platform.setWorkerControl(controlId, true);
      await runtime.runner.run(job);
      expect(run).not.toHaveBeenCalled();

      await runtime.platform.setWorkerControl(controlId, false);
      await runtime.runner.run(job);
      expect(run).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
    }
  });

  it("keeps hosted billing disabled even when a Stripe client is configured", async () => {
    const billingConfig = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      BILLING_MODE: "stripe",
      STRIPE_SECRET_KEY: "sk_test_jobs_runtime",
      STRIPE_WEBHOOK_SECRET: "whsec_jobs_runtime",
      STRIPE_PRO_PRICE_ID: "price_jobs_runtime",
    });
    const onError = vi.fn();
    const runtime = await createJobsRuntime(billingConfig, onError);
    const claimBillingEvent = vi.spyOn(runtime.platform, "claimBillingEvent");
    const listPendingPurchases = vi.spyOn(runtime.platform, "listPendingPurchases");
    const listSubscriptions = vi.spyOn(runtime.platform, "listSubscriptions");
    try {
      runtime.runner.start();
      await runtime.runner.stop();
      expect(claimBillingEvent).not.toHaveBeenCalled();
      expect(listPendingPurchases).not.toHaveBeenCalled();
      expect(listSubscriptions).not.toHaveBeenCalled();
      expect(await runtime.platform.listOffers()).toEqual([]);
      expect(await runtime.platform.listHeartbeats()).toContainEqual(
        expect.objectContaining({
          id: "platform-billing",
          details: expect.objectContaining({ enabled: false }),
        }),
      );
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
    }
  });
});
