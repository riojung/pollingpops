/** Tab-scoped setup only: never store authentication or guest credentials here. */
const prefix = "pollingpops:canvas-setup:v1:";
let cleanupEpoch = 0;
let verifiedUser: string | null = null;
export function canvasCreationSetupEpoch() {
  return cleanupEpoch;
}
export class CanvasCreationStorageError extends Error {}
function key(userId: string, workspaceId: string) {
  return `${prefix}${userId}:${workspaceId}`;
}
export function readCanvasCreationSetup(userId: string, workspaceId: string): unknown {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(key(userId, workspaceId));
  } catch {
    throw new CanvasCreationStorageError();
  }
  if (!raw) return null;
  if (raw.length > 16_384) throw new Error("Invalid saved setup");
  return JSON.parse(raw);
}
export function saveCanvasCreationSetup(userId: string, workspaceId: string, value: unknown) {
  const raw = JSON.stringify(value);
  if (raw.length > 16_384) throw new Error("Saved setup is too large");
  window.sessionStorage.setItem(key(userId, workspaceId), raw);
}
export function removeCanvasCreationSetup(userId: string, workspaceId: string) {
  window.sessionStorage.removeItem(key(userId, workspaceId));
}
/** Cleanup is best effort: storage may have been disabled after creation began. */
export function clearCanvasCreationSetups(userId: string) {
  // An in-flight response must not restore setup after successful logout.
  cleanupEpoch++;
  clearMatching((entry) => entry.startsWith(`${prefix}${userId}:`));
}
export function clearAllCanvasCreationSetups() {
  cleanupEpoch++;
  clearMatching((entry) => entry.startsWith(prefix));
}
export function clearOtherCanvasCreationSetups(userId: string) {
  if (verifiedUser && verifiedUser !== userId) cleanupEpoch++;
  verifiedUser = userId;
  clearMatching((entry) => entry.startsWith(prefix) && !entry.startsWith(`${prefix}${userId}:`));
}
function clearMatching(matches: (entry: string) => boolean) {
  try {
    const storage = window.sessionStorage;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const entry of keys) if (entry && matches(entry)) storage.removeItem(entry);
  } catch {
    // No network operation depends on cleanup being available.
  }
}
