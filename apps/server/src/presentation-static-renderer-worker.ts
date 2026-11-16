import { parentPort } from "node:worker_threads";
import type { renderPresentationStaticCore as RenderCore } from "./presentation-static-renderer-core.js";
import {
  PresentationStaticExportError,
  type PresentationStaticRenderInput,
} from "./presentation-static-renderer-types.js";
if (!parentPort) throw new Error("Static renderer requires a parent worker port");
const port = parentPort;
const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
const { renderPresentationStaticCore } = (await import(
  new URL(`./presentation-static-renderer-core.${extension}`, import.meta.url).href
)) as { renderPresentationStaticCore: typeof RenderCore };
port.once("message", async (input: PresentationStaticRenderInput) => {
  try {
    input.images = new Map(
      [...input.images].map(([id, value]) => [id, { ...value, bytes: Buffer.from(value.bytes) }]),
    );
    const result = await renderPresentationStaticCore(input);
    const bytes = Uint8Array.from(result.bytes);
    port.postMessage({ result: { ...result, bytes } }, [bytes.buffer]);
  } catch (error) {
    port.postMessage({
      error: {
        code: error instanceof PresentationStaticExportError ? error.code : "EXPORT_INVALID",
      },
    });
  }
});
