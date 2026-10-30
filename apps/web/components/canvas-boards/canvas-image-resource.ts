import { ApiClientError, isRetryableReadError } from "../../lib/api";
import { fetchCanvasImage } from "./canvas-assets-client";

type Read = {
  key: string;
  boardId: string;
  mediaId: string;
  guest?: { sourceBoardId: string; token: string };
  controller: AbortController;
  consumers: number;
  attempts: number;
  timer?: ReturnType<typeof setTimeout>;
  queued: boolean;
  promise: Promise<Blob>;
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
};
const reads = new Map<string, Read>();
const queue: Read[] = [];
let running = 0;
function pump() {
  while (running < 3 && queue.length) {
    const read = queue.shift()!;
    read.queued = false;
    if (read.controller.signal.aborted || !read.consumers) continue;
    running++;
    read.attempts++;
    void fetchCanvasImage(read.boardId, read.mediaId, read.controller.signal, read.guest)
      .then((blob) => {
        if (!read.controller.signal.aborted) read.resolve(blob);
      })
      .catch((error: unknown) => {
        if (read.controller.signal.aborted) return;
        const after = error instanceof ApiClientError ? error.retryAfterSeconds : undefined;
        if (
          read.attempts < 4 &&
          isRetryableReadError(error) &&
          (after === undefined || after <= 60)
        ) {
          read.timer = setTimeout(
            () => {
              read.timer = undefined;
              if (read.controller.signal.aborted || !read.consumers) return;
              read.queued = true;
              queue.push(read);
              pump();
            },
            Math.max(1, after ?? 2 ** (read.attempts - 1)) * 1000,
          );
        } else {
          reads.delete(read.key);
          read.reject(error);
        }
      })
      .finally(() => {
        running--;
        pump();
      });
  }
}

/** Share only mounted, authorized reads; no blob remains cached after the last release. */
export function readCanvasImage(
  boardId: string,
  mediaId: string,
  guest?: { sourceBoardId: string; token: string },
) {
  const key = JSON.stringify([
    boardId,
    mediaId,
    guest?.sourceBoardId ?? null,
    guest?.token ?? null,
  ]);
  let read = reads.get(key);
  if (!read) {
    let resolve: Read["resolve"] = () => {},
      reject: Read["reject"] = () => {};
    const promise = new Promise<Blob>((accept, decline) => {
      resolve = accept;
      reject = decline;
    });
    read = {
      key,
      boardId,
      mediaId,
      guest,
      controller: new AbortController(),
      consumers: 0,
      attempts: 0,
      queued: true,
      promise,
      resolve,
      reject,
    };
    reads.set(key, read);
    queue.push(read);
  }
  const current = read;
  current.consumers++;
  pump();
  let released = false;
  return {
    promise: current.promise,
    release() {
      if (released) return;
      released = true;
      if (--current.consumers) return;
      current.controller.abort();
      if (current.timer) clearTimeout(current.timer);
      if (reads.get(key) === current) reads.delete(key);
      const queued = queue.indexOf(current);
      if (queued >= 0) queue.splice(queued, 1);
      current.reject(new DOMException("Canvas image read canceled", "AbortError"));
    },
  };
}
