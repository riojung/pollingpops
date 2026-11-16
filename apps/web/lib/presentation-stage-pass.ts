type StageStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const presentationStagePassKey = (sessionId: string) =>
  `openround:presentation-stage:${sessionId}`;

/** Scrub the launch secret before networking; only this tab retains the read-only pass. */
export function capturePresentationStagePass({
  sessionId,
  location,
  history,
  storage,
}: {
  sessionId: string;
  location: Pick<Location, "href">;
  history: Pick<History, "state" | "replaceState">;
  storage: StageStorage;
}) {
  const url = new URL(location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.has("pass")) {
    const candidate = fragment.get("pass");
    url.hash = "";
    history.replaceState(history.state, "", `${url.pathname}${url.search}`);
    const pass =
      candidate && candidate.length >= 32 && candidate.length <= 1_000 ? candidate : null;
    try {
      if (pass) storage.setItem(presentationStagePassKey(sessionId), pass);
      else storage.removeItem(presentationStagePassKey(sessionId));
    } catch {
      // Restricted storage still permits this launch; refreshing requires another launch.
    }
    return pass;
  }
  try {
    return storage.getItem(presentationStagePassKey(sessionId));
  } catch {
    return null;
  }
}

export function rejectPresentationStagePass(
  storage: StageStorage,
  sessionId: string,
  rejectedPass: string,
) {
  try {
    if (storage.getItem(presentationStagePassKey(sessionId)) !== rejectedPass) return false;
    storage.removeItem(presentationStagePassKey(sessionId));
  } catch {
    // The caller also clears its in-memory pass after a terminal rejection.
  }
  return true;
}

export function presentationStageLaunchUrl(origin: string, sessionId: string, pass: string) {
  const url = new URL(`/presentation-session/${encodeURIComponent(sessionId)}/stage`, origin);
  url.hash = new URLSearchParams({ pass }).toString();
  return url.href;
}
