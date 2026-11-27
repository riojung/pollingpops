export type RoundLibraryView = "grid" | "list";

export const DEFAULT_ROUND_LIBRARY_VIEW: RoundLibraryView = "grid";

export function roundLibraryViewStorageKey(workspaceId: string) {
  return `openround:round-library-view:v1:${workspaceId}`;
}

export function readRoundLibraryView(workspaceId: string): RoundLibraryView {
  try {
    const saved = window.localStorage.getItem(roundLibraryViewStorageKey(workspaceId));
    return saved === "list" || saved === "grid" ? saved : DEFAULT_ROUND_LIBRARY_VIEW;
  } catch {
    return DEFAULT_ROUND_LIBRARY_VIEW;
  }
}

export function writeRoundLibraryView(workspaceId: string, view: RoundLibraryView) {
  try {
    window.localStorage.setItem(roundLibraryViewStorageKey(workspaceId), view);
  } catch {
    // A blocked storage API must not prevent the library view from changing in memory.
  }
}
