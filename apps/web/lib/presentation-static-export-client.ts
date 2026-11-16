import {
  PresentationStaticExportRequestSchema,
  PresentationStaticExportSourceSchema,
  PRESENTATION_STATIC_EXPORT_LIMITS,
  type PresentationStaticExportRequest,
} from "@openround/contracts";
import { API_URL, ApiClientError, apiFetch } from "./api";

export type { PresentationStaticExportRequest } from "@openround/contracts";
export type PresentationStaticExportFormat = PresentationStaticExportRequest["format"];

export const PRESENTATION_STATIC_EXPORT_MAX_BYTES =
  PRESENTATION_STATIC_EXPORT_LIMITS.maxOutputBytes;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mimeTypes: Record<PresentationStaticExportFormat, string> = {
  pdf: "application/pdf",
  png: "image/png",
  html: "text/html",
  offline_html: "text/html",
};
const filenames: Record<PresentationStaticExportFormat, string> = {
  pdf: "polling-pops-presentation.pdf",
  png: "polling-pops-presentation.png",
  html: "polling-pops-presentation.html",
  offline_html: "polling-pops-presentation-offline.html",
};

export async function fetchPresentationStaticExportSource(
  presentationId: string,
  versionId: string,
  signal: AbortSignal,
) {
  if (!uuid.test(presentationId) || !uuid.test(versionId))
    throw new Error("Choose a published presentation before exporting.");
  const raw = await apiFetch<unknown>(
    `/v1/presentations/${encodeURIComponent(presentationId)}/exports/source?versionId=${encodeURIComponent(versionId)}`,
    { signal, cache: "no-store" },
  );
  const parsed = PresentationStaticExportSourceSchema.safeParse(raw);
  if (!parsed.success || parsed.data.versionId.toLowerCase() !== versionId.toLowerCase())
    throw new Error("The published pages could not be verified. Close this dialog and try again.");
  return parsed.data;
}

async function readBoundedResponse(response: Response, limit: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw new Error("This export exceeds the 40 MiB download limit. No file was downloaded.");
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = () => void reader.cancel(signal.reason).catch(() => undefined);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("This export exceeds the 40 MiB download limit. No file was downloaded.");
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchPresentationStaticExport(
  presentationId: string,
  request: PresentationStaticExportRequest,
  signal: AbortSignal,
) {
  const parsed = PresentationStaticExportRequestSchema.safeParse(request);
  if (!uuid.test(presentationId) || !parsed.success)
    throw new Error("Choose a published presentation and page before exporting.");
  signal.throwIfAborted();
  const body = parsed.data;
  const format = body.format;
  const response = await fetch(
    `${API_URL}/v1/presentations/${encodeURIComponent(presentationId)}/exports`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: mimeTypes[format] },
      body: JSON.stringify(body),
      signal,
    },
  );
  signal.throwIfAborted();
  if (!response.ok) {
    let message = `Export failed (${response.status}). Try again.`,
      code: string | undefined;
    try {
      const bytes = await readBoundedResponse(response, 64 * 1024, signal);
      const error = (
        JSON.parse(new TextDecoder().decode(bytes)) as {
          error?: { message?: unknown; code?: unknown };
        }
      ).error;
      if (typeof error?.message === "string") message = error.message;
      if (typeof error?.code === "string") code = error.code;
    } catch {
      signal.throwIfAborted();
    }
    throw new ApiClientError(message, code, response.status);
  }
  if (
    response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
    mimeTypes[format]
  ) {
    await response.body?.cancel();
    throw new Error("The export returned an unexpected file type. No file was downloaded.");
  }
  const bytes = await readBoundedResponse(response, PRESENTATION_STATIC_EXPORT_MAX_BYTES, signal);
  if (!bytes.length) throw new Error("The export was empty. No file was downloaded.");
  return { blob: new Blob([bytes], { type: mimeTypes[format] }), format };
}

/** Fixed filenames avoid treating a title or response header as a local path. */
export function downloadPresentationStaticExport({
  blob,
  format,
}: {
  blob: Blob;
  format: PresentationStaticExportFormat;
}) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  let released = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    if (released) return;
    released = true;
    if (timer !== undefined) clearTimeout(timer);
    URL.revokeObjectURL(url);
  };
  try {
    anchor.href = url;
    anchor.download = filenames[format];
    document.body.append(anchor);
    anchor.click();
    timer = setTimeout(release, 0);
  } catch (error) {
    release();
    throw error;
  } finally {
    anchor.remove();
  }
  return release;
}
