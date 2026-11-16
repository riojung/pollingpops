import { API_URL } from "../../../lib/api";
import { librarySharePath } from "./client";

interface WaitingImage {
  signal: AbortSignal;
  resolve: () => void;
  reject: (reason: unknown) => void;
  onAbort: () => void;
}

// Leave room within the server's four-read limit for other readers. The FIFO
// accommodates a full 200-question Round without starting every image at once.
let activeReads = 0;
const waiting: WaitingImage[] = [];

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("Image request canceled", "AbortError");
}

async function acquire(signal: AbortSignal) {
  signal.throwIfAborted();
  if (activeReads < 2) {
    activeReads++;
    return;
  }
  if (waiting.length >= 256) throw new Error("Image is temporarily unavailable");
  await new Promise<void>((resolve, reject) => {
    const entry: WaitingImage = {
      signal,
      resolve,
      reject,
      onAbort: () => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        signal.removeEventListener("abort", entry.onAbort);
        reject(abortReason(signal));
      },
    };
    waiting.push(entry);
    signal.addEventListener("abort", entry.onAbort, { once: true });
    if (signal.aborted) entry.onAbort();
  });
}

function release() {
  for (;;) {
    const next = waiting.shift();
    if (!next) {
      activeReads--;
      return;
    }
    next.signal.removeEventListener("abort", next.onAbort);
    if (next.signal.aborted) {
      next.reject(abortReason(next.signal));
      continue;
    }
    next.resolve();
    return;
  }
}

function pause(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

/** Current-session images are never cached or requested with bearer-link credentials. */
export async function fetchLibraryShareImage(
  shareId: string,
  mediaId: string,
  signal: AbortSignal,
) {
  const path = `${librarySharePath(shareId)}/media/${mediaId}`;
  librarySharePath(mediaId);
  for (let attempt = 0; attempt < 3; attempt++) {
    await acquire(signal);
    let retryDelay: number;
    try {
      signal.throwIfAborted();
      const response = await fetch(`${API_URL}${path}`, {
        credentials: "include",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal,
      });
      if (response.status === 503 || response.status === 429) {
        await response.body?.cancel().catch(() => undefined);
        if (attempt === 2) throw new Error("Image is temporarily unavailable");
        const requested = Number(response.headers.get("retry-after") ?? 1);
        const seconds = Number.isFinite(requested) ? Math.min(2, Math.max(1, requested)) : 1;
        retryDelay = seconds * 1000 + Math.floor(Math.random() * 251);
      } else {
        if (
          !response.ok ||
          !["image/png", "image/jpeg", "image/webp"].includes(
            response.headers.get("content-type")?.split(";", 1)[0] ?? "",
          )
        ) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error("Image unavailable");
        }
        const blob = await response.blob();
        signal.throwIfAborted();
        if (blob.size > 10 * 1024 * 1024) throw new Error("Image unavailable");
        return blob;
      }
    } finally {
      release();
    }
    // A busy server does not occupy a client read slot while waiting to retry.
    await pause(retryDelay, signal);
  }
  throw new Error("Image is temporarily unavailable");
}
