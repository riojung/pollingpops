export const PRESENTATION_NAVIGATOR_DEFAULT_WIDTH = 280;
export const PRESENTATION_NAVIGATOR_MIN_WIDTH = 200;
export const PRESENTATION_NAVIGATOR_MAX_WIDTH = 440;
export const PRESENTATION_NAVIGATOR_WIDTH_KEY = "openround:presentation-navigator-width";

export function presentationNavigatorMaxWidth(workspaceWidth: number, inspectorWidth: number) {
  return Math.max(
    PRESENTATION_NAVIGATOR_MIN_WIDTH,
    Math.min(PRESENTATION_NAVIGATOR_MAX_WIDTH, Math.floor(workspaceWidth - inspectorWidth - 368)),
  );
}

export function clampPresentationNavigatorWidth(width: number, maximum: number) {
  return Math.max(
    PRESENTATION_NAVIGATOR_MIN_WIDTH,
    Math.min(
      maximum,
      Number.isFinite(width) ? Math.round(width) : PRESENTATION_NAVIGATOR_DEFAULT_WIDTH,
    ),
  );
}

export function readPresentationNavigatorWidth(storage: Pick<Storage, "getItem">) {
  try {
    const value = storage.getItem(PRESENTATION_NAVIGATOR_WIDTH_KEY);
    return value === null || !value.trim()
      ? PRESENTATION_NAVIGATOR_DEFAULT_WIDTH
      : clampPresentationNavigatorWidth(Number(value), PRESENTATION_NAVIGATOR_MAX_WIDTH);
  } catch {
    return PRESENTATION_NAVIGATOR_DEFAULT_WIDTH;
  }
}

export function savePresentationNavigatorWidth(storage: Pick<Storage, "setItem">, width: number) {
  try {
    storage.setItem(PRESENTATION_NAVIGATOR_WIDTH_KEY, String(width));
  } catch {
    // A blocked or full preference store must not disable the editor.
  }
}
