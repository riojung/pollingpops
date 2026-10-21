import { ApiClientError, isRetryableReadError } from "../../lib/api";
import { fetchIdeaBoardImage } from "../../lib/idea-board-client";

type ImageRead = {
  key: string;
  boardId: string;
  mediaId: string;
  token?: string;
  controller: AbortController;
  consumers: number;
  attempts: number;
  status: "queued" | "running" | "waiting" | "complete" | "failed";
  timer?: ReturnType<typeof setTimeout>;
  promise: Promise<Blob>;
  resolve: (blob: Blob) => void;
  reject: (reason: unknown) => void;
};

const reads = new Map<string, ImageRead>();
const queue: ImageRead[] = [];
let activeReads = 0;

function retryDelay(error: unknown, attempts: number): number | null {
  if (attempts >= 4 || !isRetryableReadError(error)) return null;
  const seconds = error instanceof ApiClientError ? error.retryAfterSeconds : undefined;
  // A longer Retry-After is surfaced for an explicit later retry, never retried early.
  if (seconds !== undefined && seconds > 60) return null;
  return Math.max(1, seconds ?? 2 ** (attempts - 1)) * 1000;
}

function drainQueue() {
  while (activeReads < 3 && queue.length) {
    const read = queue.shift()!;
    if (!read.consumers || read.controller.signal.aborted) continue;
    activeReads++;
    read.status = "running";
    read.attempts++;
    void fetchIdeaBoardImage(read.boardId, read.mediaId, read.token, read.controller.signal)
      .then((blob) => {
        if (read.controller.signal.aborted) return;
        read.status = "complete";
        read.resolve(blob);
      })
      .catch((error: unknown) => {
        if (read.controller.signal.aborted) return;
        const delay = retryDelay(error, read.attempts);
        if (delay !== null) {
          read.status = "waiting";
          read.timer = setTimeout(() => {
            read.timer = undefined;
            if (!read.consumers || read.controller.signal.aborted) return;
            read.status = "queued";
            queue.push(read);
            drainQueue();
          }, delay);
        } else {
          read.status = "failed";
          read.reject(error);
        }
      })
      .finally(() => {
        activeReads--;
        drainQueue();
      });
  }
}

/** Share an eligible read while its projected cards are mounted; retain no cache after release. */
export function readBoardIdeaImage(boardId: string, mediaId: string, token?: string) {
  const key = JSON.stringify([boardId, mediaId, token ?? null]);
  let read = reads.get(key);
  if (!read || read.status === "failed") {
    let resolve: (blob: Blob) => void = () => {};
    let reject: (reason: unknown) => void = () => {};
    const promise = new Promise<Blob>((accept, decline) => {
      resolve = accept;
      reject = decline;
    });
    read = {
      key,
      boardId,
      mediaId,
      token,
      controller: new AbortController(),
      consumers: 0,
      attempts: 0,
      status: "queued",
      promise,
      resolve,
      reject,
    };
    reads.set(key, read);
    queue.push(read);
  }
  const current = read;
  current.consumers++;
  drainQueue();
  let released = false;
  return {
    promise: current.promise,
    release() {
      if (released) return;
      released = true;
      current.consumers--;
      if (current.consumers) return;
      current.controller.abort();
      if (current.timer) clearTimeout(current.timer);
      if (reads.get(key) === current) reads.delete(key);
      const queued = queue.indexOf(current);
      if (queued !== -1) queue.splice(queued, 1);
      current.reject(new DOMException("Image read was canceled", "AbortError"));
    },
  };
}
