import { describe, expect, it, vi } from "vitest";
import { JobRunner, type ScheduledJob } from "../src/job-runner.js";

describe("background job isolation", () => {
  it("coalesces overlapping work and drains before shutdown", async () => {
    let complete!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const run = vi.fn(() => {
      markStarted();
      return new Promise<void>((resolve) => {
        complete = resolve;
      });
    });
    const job: ScheduledJob = { name: "reports", intervalMs: 100, run };
    const runner = new JobRunner([job], vi.fn());
    const first = runner.run(job);
    expect(runner.run(job)).toBe(first);
    await started;
    expect(run).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stop = runner.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    complete();
    await stop;
    expect(stopped).toBe(true);
    await runner.run(job);
    expect(run).toHaveBeenCalledTimes(1);
    await first;
  });

  it("allows recovery after failure without blocking another queue", async () => {
    const error = new Error("provider unavailable");
    const onError = vi.fn();
    const failing: ScheduledJob = {
      name: "billing",
      intervalMs: 100,
      run: vi.fn().mockRejectedValue(error),
    };
    const healthy: ScheduledJob = {
      name: "retention",
      intervalMs: 100,
      run: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new JobRunner([failing, healthy], onError);
    await Promise.all([runner.run(failing), runner.run(healthy)]);
    await runner.run(failing);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(healthy.run).toHaveBeenCalledTimes(1);
    await runner.stop();
  });

  it("rejects duplicate queue names", () => {
    const job: ScheduledJob = { name: "billing", intervalMs: 100, run: async () => undefined };
    expect(() => new JobRunner([job, job], vi.fn())).toThrow("unique names");
  });

  it("honors a durable queue pause and resumes after it is cleared", async () => {
    const job: ScheduledJob = {
      name: "reports",
      intervalMs: 100,
      run: vi.fn().mockResolvedValue(undefined),
    };
    let paused = true;
    const runner = new JobRunner([job], vi.fn(), async () => !paused);
    await runner.run(job);
    expect(job.run).not.toHaveBeenCalled();
    paused = false;
    await runner.run(job);
    expect(job.run).toHaveBeenCalledTimes(1);
    await runner.stop();
  });
});
