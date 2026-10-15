import { Worker } from "node:worker_threads";
import type { AggregateSessionSummary } from "@openround/contracts";
import { validateSessionSummaryExport } from "./session-summary-export-validation.js";
import {
  SessionSummaryExportError,
  type SessionSummaryExportErrorCode,
  type SessionSummaryRenderOptions,
  type SessionSummaryExportResult,
} from "./session-summary-export-types.js";
export { SessionSummaryExportError } from "./session-summary-export-types.js";
export type {
  SessionSummaryRenderOptions,
  SessionSummaryExportResult,
} from "./session-summary-export-types.js";

export interface SessionSummaryExportService {
  render(
    summary: AggregateSessionSummary,
    options: SessionSummaryRenderOptions & { signal?: AbortSignal },
  ): Promise<SessionSummaryExportResult>;
  close(): Promise<void>;
}
type Job = {
  id: number;
  summary: AggregateSessionSummary;
  options: SessionSummaryRenderOptions;
  resolve: (result: SessionSummaryExportResult) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
  timer?: ReturnType<typeof setTimeout>;
};
type WorkerReply = {
  id: number;
  result?: Omit<SessionSummaryExportResult, "bytes"> & { bytes: Uint8Array };
  error?: { code: SessionSummaryExportErrorCode; message: string };
};

/** One warm worker, one active render, and a bounded queue per server process. */
export function createSessionSummaryExportService(
  options: { timeoutMs?: number; maxQueued?: number } = {},
): SessionSummaryExportService {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxQueued = options.maxQueued ?? 4;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000 ||
    !Number.isInteger(maxQueued) ||
    maxQueued < 0 ||
    maxQueued > 16
  ) {
    throw new SessionSummaryExportError(
      "EXPORT_INVALID",
      "Invalid summary renderer service limits",
    );
  }
  let worker: Worker | undefined;
  let active: Job | undefined;
  let stopping: Promise<void> | undefined;
  let closed = false;
  let nextId = 0;
  const queued: Job[] = [];
  function clean(job: Job) {
    if (job.timer) clearTimeout(job.timer);
    if (job.abort) job.signal?.removeEventListener("abort", job.abort);
  }
  function settle(error?: Error, result?: SessionSummaryExportResult) {
    const job = active;
    active = undefined;
    if (job) {
      clean(job);
      if (error) job.reject(error);
      else if (result) job.resolve(result);
    }
    worker?.unref();
  }
  function stopWorker() {
    const previous = worker;
    worker = undefined;
    if (previous) {
      previous.removeAllListeners();
      previous.on("error", () => undefined);
      stopping = previous.terminate().then(
        () => undefined,
        () => undefined,
      );
      void stopping.finally(() => {
        stopping = undefined;
        pump();
      });
    }
  }
  function pump() {
    if (closed || active || stopping || !queued.length) return;
    active = queued.shift()!;
    if (!worker) {
      const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
      try {
        worker = new Worker(
          new URL(`./session-summary-export-worker.${extension}`, import.meta.url),
          {
            execArgv: extension === "ts" ? ["--import", "tsx"] : [],
            resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
          },
        );
      } catch {
        settle(
          new SessionSummaryExportError(
            "EXPORT_FAILED",
            "The summary export worker could not start",
          ),
        );
        queueMicrotask(pump);
        return;
      }
      worker.on("message", (message: WorkerReply) => {
        if (message.id !== active?.id) return;
        if (message.result)
          settle(undefined, {
            ...message.result,
            bytes: Buffer.from(
              message.result.bytes.buffer,
              message.result.bytes.byteOffset,
              message.result.bytes.byteLength,
            ),
          });
        else
          settle(
            new SessionSummaryExportError(
              message.error?.code ?? "EXPORT_FAILED",
              message.error?.message ?? "The summary export failed",
            ),
          );
        pump();
      });
      worker.on("error", () => {
        settle(new SessionSummaryExportError("EXPORT_FAILED", "The summary export worker failed"));
        stopWorker();
      });
      worker.on("exit", () => {
        worker = undefined;
        settle(new SessionSummaryExportError("EXPORT_FAILED", "The summary export worker exited"));
        pump();
      });
    }
    const job = active;
    job.timer = setTimeout(() => {
      settle(
        new SessionSummaryExportError(
          "EXPORT_TIMEOUT",
          "The summary export exceeded its time limit",
        ),
      );
      stopWorker();
    }, timeoutMs);
    worker.ref();
    try {
      worker.postMessage({ id: job.id, summary: job.summary, options: job.options });
    } catch {
      settle(new SessionSummaryExportError("EXPORT_FAILED", "The summary export worker failed"));
      stopWorker();
    }
  }
  return {
    async render(summary, renderOptions) {
      if (closed)
        throw new SessionSummaryExportError(
          "EXPORT_CLOSED",
          "The summary export service is closed",
        );
      if (renderOptions.signal?.aborted)
        throw new SessionSummaryExportError("EXPORT_ABORTED", "The summary export was cancelled");
      if ((active || stopping) && queued.length >= maxQueued) {
        throw new SessionSummaryExportError(
          "EXPORT_BUSY",
          "The summary renderer is busy. Try again shortly",
        );
      }
      const checked = validateSessionSummaryExport(summary, renderOptions);
      return await new Promise<SessionSummaryExportResult>((resolve, reject) => {
        const job: Job = {
          id: ++nextId,
          summary: checked,
          options: {
            format: renderOptions.format,
            locale: renderOptions.locale,
            ...(renderOptions.questionIndex === undefined
              ? {}
              : { questionIndex: renderOptions.questionIndex }),
          },
          signal: renderOptions.signal,
          resolve,
          reject,
        };
        job.abort = () => {
          const error = new SessionSummaryExportError(
            "EXPORT_ABORTED",
            "The summary export was cancelled",
          );
          if (active === job) {
            settle(error);
            stopWorker();
          } else {
            const index = queued.indexOf(job);
            if (index !== -1) {
              queued.splice(index, 1);
              clean(job);
              reject(error);
            }
          }
        };
        job.signal?.addEventListener("abort", job.abort, { once: true });
        queued.push(job);
        pump();
      });
    },
    async close() {
      closed = true;
      const error = new SessionSummaryExportError(
        "EXPORT_CLOSED",
        "The summary export service is closed",
      );
      settle(error);
      for (const job of queued.splice(0)) {
        clean(job);
        job.reject(error);
      }
      stopWorker();
      await stopping;
    },
  };
}
