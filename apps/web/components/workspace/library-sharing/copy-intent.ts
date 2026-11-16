import { clientUuid } from "../../../lib/uuid";

// Keep unresolved intents across React remounts when tab storage is unavailable.
// Null also prevents failed storage removal from reviving a settled request.
const pendingCopies = new Map<string, string | null>();
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function libraryCopyIntentKey(actorId: string, workspaceId: string, shareId: string) {
  return `openround:library-copy:${JSON.stringify([actorId, workspaceId, shareId])}`;
}

export function acquireLibraryCopyIntent(key: string) {
  let requestId = pendingCopies.get(key);
  if (!pendingCopies.has(key)) {
    try {
      const saved = window.sessionStorage.getItem(key);
      if (saved && requestIdPattern.test(saved)) requestId = saved;
    } catch {
      /* The in-memory intent still survives component remounts. */
    }
  }
  requestId ??= clientUuid();
  pendingCopies.set(key, requestId);
  try {
    window.sessionStorage.setItem(key, requestId);
  } catch {
    /* Keep the exact request in memory when per-tab storage is unavailable. */
  }
  return requestId;
}

export function settleLibraryCopyIntent(key: string, requestId: string) {
  // A late result must not clear a newer copy's retry information.
  if (pendingCopies.has(key) && pendingCopies.get(key) !== requestId) return;
  pendingCopies.set(key, null);
  try {
    if (window.sessionStorage.getItem(key) === requestId) window.sessionStorage.removeItem(key);
  } catch {
    /* The in-memory tombstone remains authoritative for this tab. */
  }
}
