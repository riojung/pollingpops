import { apiFetch, AUTH_CHANGE_EVENT } from "../../lib/api";

export interface PresentationThumbnailMediaScope {
  actorKey: string;
  presentationId: string;
}
export type ThumbnailMediaSnapshot =
  { status: "loading" } | { status: "ready"; source: string } | { status: "unavailable" };
type Listener = (snapshot: ThumbnailMediaSnapshot) => void;
type Read = {
  key: string;
  scope: PresentationThumbnailMediaScope;
  mediaId: string;
  listeners: Set<Listener>;
  snapshot: ThumbnailMediaSnapshot;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  queued: boolean;
  active: boolean;
};
const reads = new Map<string, Read>();
const queue: Read[] = [];
let running = 0;
let removeEvents: (() => void) | undefined;
// Storage authorizes these URLs for five minutes. Mounted readers reauthorize earlier;
// no signed URL survives the last reader, an account change, or a failed refresh.
const REAUTHORIZE_MS = 4 * 60 * 1000;
const MAX_CONCURRENT = 3;
const EXPIRY_MARGIN_MS = 30 * 1000;
function refreshDelay(url: URL) {
  const stamped = url.searchParams.get("X-Amz-Date");
  const expires = url.searchParams.get("X-Amz-Expires");
  if (stamped === null && expires === null) return REAUTHORIZE_MS;
  const match = stamped?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match || !expires || !/^\d+$/.test(expires)) return 0;
  const signedAt = Date.parse(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`,
  );
  return Math.min(
    REAUTHORIZE_MS,
    signedAt + Number(expires) * 1000 - Date.now() - EXPIRY_MARGIN_MS,
  );
}

function notify(read: Read, snapshot: ThumbnailMediaSnapshot) {
  if (!read.active) return;
  read.snapshot = snapshot;
  read.listeners.forEach((listener) => listener(snapshot));
}
function forget(read: Read) {
  read.active = false;
  read.controller.abort();
  if (read.timer) clearTimeout(read.timer);
  if (reads.get(read.key) === read) reads.delete(read.key);
  const waiting = queue.indexOf(read);
  if (waiting >= 0) queue.splice(waiting, 1);
  read.snapshot = { status: "unavailable" };
  read.listeners.clear();
  if (!reads.size) {
    removeEvents?.();
    removeEvents = undefined;
  }
}
function invalidate() {
  for (const read of [...reads.values()]) {
    notify(read, { status: "unavailable" });
    forget(read);
  }
}
function listen() {
  if (removeEvents || typeof window === "undefined") return;
  const auth = () => invalidate();
  const workspace = () => invalidate();
  window.addEventListener(AUTH_CHANGE_EVENT, auth);
  window.addEventListener("polling-pops:workspace-updated", workspace);
  removeEvents = () => {
    window.removeEventListener(AUTH_CHANGE_EVENT, auth);
    window.removeEventListener("polling-pops:workspace-updated", workspace);
  };
}
function enqueue(read: Read) {
  if (!read.active || read.queued || !read.listeners.size) return;
  read.queued = true;
  notify(read, { status: "loading" });
  queue.push(read);
  pump();
}
function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const read = queue.shift()!;
    read.queued = false;
    if (!read.active || !read.listeners.size) continue;
    const controller = new AbortController();
    read.controller = controller;
    running++;
    void apiFetch<{ downloadUrl: string }>(`/v1/media/${encodeURIComponent(read.mediaId)}`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(({ downloadUrl }) => {
        if (!read.active || controller.signal.aborted) return;
        const url = new URL(downloadUrl);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash)
          throw new Error("Image unavailable");
        const delay = refreshDelay(url);
        if (!Number.isFinite(delay) || delay <= 0) throw new Error("Image authorization expired");
        notify(read, { status: "ready", source: url.href });
        read.timer = setTimeout(() => {
          read.timer = undefined;
          enqueue(read);
        }, delay);
      })
      .catch(() => {
        if (read.active && !controller.signal.aborted) notify(read, { status: "unavailable" });
      })
      .finally(() => {
        running--;
        pump();
      });
  }
}

/** Only mounted readers share authorization; failures are terminal until a fresh mount. */
export function readPresentationThumbnailMedia(
  scope: PresentationThumbnailMediaScope,
  mediaId: string,
  listener: Listener,
) {
  if (!scope.actorKey || scope.actorKey === ":" || !scope.presentationId || !mediaId) {
    listener({ status: "unavailable" });
    return { release() {}, imageFailed(_source: string) {} };
  }
  const key = JSON.stringify([scope.actorKey, scope.presentationId, mediaId]);
  let read = reads.get(key);
  if (!read) {
    read = {
      key,
      scope: { ...scope },
      mediaId,
      listeners: new Set(),
      snapshot: { status: "loading" },
      controller: new AbortController(),
      queued: false,
      active: true,
    };
    reads.set(key, read);
    listen();
  }
  const current = read;
  const first = !current.listeners.size;
  current.listeners.add(listener);
  listener(current.snapshot);
  if (first) enqueue(current);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      current.listeners.delete(listener);
      if (!current.listeners.size) forget(current);
    },
    imageFailed(source: string) {
      if (
        !current.active ||
        current.snapshot.status !== "ready" ||
        current.snapshot.source !== source
      )
        return;
      if (current.timer) clearTimeout(current.timer);
      current.timer = undefined;
      notify(current, { status: "unavailable" });
    },
  };
}
