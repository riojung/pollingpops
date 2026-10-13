export interface ScheduledJob {
  name: string;
  intervalMs: number;
  run(): Promise<unknown>;
}

/** Each job owns one run at a time; shutdown waits for every accepted run. */
export class JobRunner {
  private readonly running = new Map<string, Promise<void>>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private stopping = false;

  constructor(
    private readonly jobs: ScheduledJob[],
    private readonly onError: (name: string, error: unknown) => void,
    private readonly shouldRun: (name: string) => Promise<boolean> = async () => true,
  ) {
    const names = new Set<string>();
    for (const job of jobs) {
      if (names.has(job.name) || !Number.isFinite(job.intervalMs) || job.intervalMs < 1) {
        throw new Error("Jobs require unique names and positive intervals");
      }
      names.add(job.name);
    }
  }

  start() {
    if (this.stopping || this.timers.length > 0) return;
    for (const job of this.jobs) {
      void this.run(job);
      const timer = setInterval(() => void this.run(job), job.intervalMs);
      timer.unref();
      this.timers.push(timer);
    }
  }

  run(job: ScheduledJob): Promise<void> {
    if (this.stopping) return Promise.resolve();
    const prior = this.running.get(job.name);
    if (prior) return prior;
    const active = Promise.resolve()
      .then(async () => {
        if (await this.shouldRun(job.name)) await job.run();
      })
      .then(() => undefined)
      .catch((error: unknown) => this.onError(job.name, error))
      .finally(() => {
        if (this.running.get(job.name) === active) this.running.delete(job.name);
      });
    this.running.set(job.name, active);
    return active;
  }

  async stop() {
    this.stopping = true;
    for (const timer of this.timers.splice(0)) clearInterval(timer);
    await Promise.allSettled([...this.running.values()]);
  }
}
