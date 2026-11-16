import { PresentationSessionInsightsEnvelopeSchema } from "@openround/contracts";
import { API_URL, ApiClientError } from "./api";

export const PRESENTATION_INSIGHTS_MAX_BYTES = 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface PresentationInsightsSource {
  sessionId: string;
  presentationId: string;
  presentationVersionId: string;
}

async function readBounded(response: Response, signal: AbortSignal) {
  signal.throwIfAborted();
  if (Number(response.headers.get("content-length")) > PRESENTATION_INSIGHTS_MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("The session insights exceed the download limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The session insights response was empty.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => void reader.cancel(signal.reason).catch(() => undefined);
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > PRESENTATION_INSIGHTS_MAX_BYTES) {
        await reader.cancel();
        throw new Error("The session insights exceed the download limit.");
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function fetchPresentationSessionInsights(
  source: PresentationInsightsSource,
  signal: AbortSignal,
) {
  if (
    ![source.sessionId, source.presentationId, source.presentationVersionId].every((value) =>
      uuid.test(value),
    )
  )
    throw new Error("The session insights source could not be verified.");
  signal.throwIfAborted();
  const response = await fetch(
    `${API_URL}/v1/presentation-sessions/${encodeURIComponent(source.sessionId)}/insights`,
    {
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { accept: "application/json" },
      signal,
    },
  );
  signal.throwIfAborted();
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiClientError(
      "Additional session insights are unavailable. The existing report is still available.",
      "INSIGHTS_UNAVAILABLE",
      response.status,
    );
  }
  if (response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    await response.body?.cancel();
    throw new Error("The session insights could not be verified. Retry insights.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readBounded(response, signal));
  } catch (error) {
    signal.throwIfAborted();
    throw error instanceof Error
      ? error
      : new Error("The session insights could not be verified. Retry insights.");
  }
  const parsed = PresentationSessionInsightsEnvelopeSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error("The session insights could not be verified. Retry insights.");
  const insights = parsed.data.insights;
  if (
    insights &&
    (insights.sessionId.toLowerCase() !== source.sessionId.toLowerCase() ||
      insights.presentationId.toLowerCase() !== source.presentationId.toLowerCase() ||
      insights.presentationVersionId.toLowerCase() !== source.presentationVersionId.toLowerCase())
  )
    throw new Error(
      "These insights do not match this session and published version. Retry insights.",
    );
  return parsed.data;
}

/** The file contains a copy of the displayed aggregates, with no reusable credentials. */
export function downloadPresentationInsightsFile(contents: string, format: "csv" | "html") {
  if (new TextEncoder().encode(contents).byteLength > PRESENTATION_INSIGHTS_MAX_BYTES)
    throw new Error("This summary exceeds the 1 MiB download limit. No file was downloaded.");
  const blob = new Blob([contents], {
    type: format === "csv" ? "text/csv;charset=utf-8" : "text/html;charset=utf-8",
  });
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
    anchor.download = `polling-pops-session-${format === "csv" ? "coverage.csv" : "summary.html"}`;
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
