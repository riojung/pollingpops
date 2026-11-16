import { Worker } from "node:worker_threads";
import { PresentationReviewSchema } from "@openround/contracts";
import {
  PresentationStaticExportError,
  PRESENTATION_STATIC_RENDER_LIMITS as limits,
  type PresentationStaticRenderInput,
  type PresentationStaticRenderResult,
  type PresentationStaticExportErrorCode,
} from "./presentation-static-renderer-types.js";
export {
  PresentationStaticExportError,
  PRESENTATION_STATIC_RENDER_LIMITS,
  PRESENTATION_STATIC_DISCLOSURE,
  PRESENTATION_OFFLINE_DISCLOSURE,
} from "./presentation-static-renderer-types.js";
export type {
  PresentationStaticRenderInput,
  PresentationStaticRenderResult,
  PresentationStaticExportErrorCode,
} from "./presentation-static-renderer-types.js";

/** Each render owns a disposable worker. Cancellation settles only after that worker exits. */
export async function renderPresentationStatic(
  input: PresentationStaticRenderInput,
): Promise<PresentationStaticRenderResult> {
  if (input.signal?.aborted) throw new PresentationStaticExportError("EXPORT_CANCELLED");
  const checked = PresentationReviewSchema.safeParse(input.review);
  if (
    !checked.success ||
    !["pdf", "png", "html", "offline_html"].includes(input.format) ||
    !(input.images instanceof Map)
  )
    throw new PresentationStaticExportError("EXPORT_INVALID");
  if (
    new Set(checked.data.blocks.map((block) => block.id.toLowerCase())).size !==
    checked.data.blocks.length
  )
    throw new PresentationStaticExportError("EXPORT_INVALID");
  if (Buffer.byteLength(JSON.stringify(checked.data)) > limits.inputBytes)
    throw new PresentationStaticExportError("EXPORT_LIMIT");
  if (input.images.size > limits.images) throw new PresentationStaticExportError("EXPORT_LIMIT");
  let total = 0;
  for (const value of input.images.values()) {
    if (
      !value ||
      !Buffer.isBuffer(value.bytes) ||
      !["image/png", "image/jpeg", "image/webp"].includes(value.contentType)
    )
      throw new PresentationStaticExportError("EXPORT_MEDIA_UNAVAILABLE");
    total += value.bytes.byteLength;
    if (value.bytes.byteLength > limits.imageBytes || total > limits.imageTotalBytes)
      throw new PresentationStaticExportError("EXPORT_LIMIT");
  }
  if (
    (input.format === "png" && !input.blockId) ||
    (input.format === "offline_html" && input.blockId !== undefined) ||
    (input.blockId &&
      !checked.data.blocks.some((block) => block.id.toLowerCase() === input.blockId!.toLowerCase()))
  )
    throw new PresentationStaticExportError("EXPORT_INVALID");
  if ((input.blockId ? 1 : checked.data.blocks.length) > limits.pages)
    throw new PresentationStaticExportError("EXPORT_LIMIT");
  return await new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
      worker = new Worker(
        new URL(`./presentation-static-renderer-worker.${extension}`, import.meta.url),
        {
          execArgv: extension === "ts" ? ["--import", "tsx"] : [],
          resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
        },
      );
    } catch {
      reject(new PresentationStaticExportError("EXPORT_INVALID"));
      return;
    }
    let settled = false;
    const finish = async (
      error?: PresentationStaticExportError,
      result?: PresentationStaticRenderResult,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      worker.removeAllListeners();
      worker.on("error", () => undefined);
      try {
        await worker.terminate();
      } catch {
        /* An exited worker already released its render resources. */
      }
      if (input.signal?.aborted) reject(new PresentationStaticExportError("EXPORT_CANCELLED"));
      else if (error) reject(error);
      else if (result) resolve(result);
      else reject(new PresentationStaticExportError("EXPORT_INVALID"));
    };
    const abort = () => {
      void finish(new PresentationStaticExportError("EXPORT_CANCELLED"));
    };
    const timer = setTimeout(abort, 30_000);
    input.signal?.addEventListener("abort", abort, { once: true });
    worker.once("error", (error) => {
      void finish(
        new PresentationStaticExportError(
          error !== null &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ERR_WORKER_OUT_OF_MEMORY"
            ? "EXPORT_LIMIT"
            : "EXPORT_INVALID",
        ),
      );
    });
    worker.once("exit", () => {
      void finish(new PresentationStaticExportError("EXPORT_INVALID"));
    });
    worker.once(
      "message",
      (message: {
        result?: Omit<PresentationStaticRenderResult, "bytes"> & { bytes: Uint8Array };
        error?: { code: PresentationStaticExportErrorCode };
      }) => {
        if (message.error) {
          void finish(new PresentationStaticExportError(message.error.code));
          return;
        }
        if (!message.result || message.result.bytes.byteLength > limits.outputBytes) {
          void finish(new PresentationStaticExportError("EXPORT_LIMIT"));
          return;
        }
        void finish(undefined, {
          ...message.result,
          bytes: Buffer.from(
            message.result.bytes.buffer,
            message.result.bytes.byteOffset,
            message.result.bytes.byteLength,
          ),
        });
      },
    );
    if (input.signal?.aborted) abort();
    else
      try {
        worker.postMessage({
          review: checked.data,
          images: input.images,
          format: input.format,
          ...(input.blockId ? { blockId: input.blockId } : {}),
        });
      } catch {
        void finish(new PresentationStaticExportError("EXPORT_INVALID"));
      }
  });
}
