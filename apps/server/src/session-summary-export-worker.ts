import { parentPort } from "node:worker_threads";
import type { AggregateSessionSummary } from "@openround/contracts";
import type { renderSessionSummary as RenderSessionSummary } from "./session-summary-renderer.js";
import {
  SessionSummaryExportError,
  type SessionSummaryRenderOptions,
} from "./session-summary-export-types.js";

if (!parentPort) throw new Error("Session summary export worker requires a parent port");
const port = parentPort;
const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
const { renderSessionSummary } = (await import(
  new URL(`./session-summary-renderer.${extension}`, import.meta.url).href
)) as { renderSessionSummary: typeof RenderSessionSummary };

port.on(
  "message",
  async (input: {
    id: number;
    summary: AggregateSessionSummary;
    options: SessionSummaryRenderOptions;
  }) => {
    try {
      const result = await renderSessionSummary(input.summary, input.options);
      // Transfer a fresh owned ArrayBuffer, never a pooled Buffer or native external allocation.
      const bytes = Uint8Array.from(result.bytes);
      port.postMessage({ id: input.id, result: { ...result, bytes } }, [bytes.buffer]);
    } catch (error) {
      port.postMessage({
        id: input.id,
        error: {
          code: error instanceof SessionSummaryExportError ? error.code : "EXPORT_FAILED",
          message:
            error instanceof SessionSummaryExportError
              ? error.message
              : "The summary export could not be generated",
        },
      });
    }
  },
);
