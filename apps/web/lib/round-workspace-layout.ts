export const ROUND_PANE_STORAGE_KEY = "pollingpops:round-editor-panes:v1";
export const ROUND_PANES = {
  navigation: { initial: 260, min: 216, max: 420 },
  tools: { initial: 320, min: 280, max: 440 },
} as const;
export type RoundPane = keyof typeof ROUND_PANES;
export type RoundPaneWidths = { navigation: number; tools: number };

export function roundPaneWidth(
  pane: RoundPane,
  value: number,
  workspaceWidth?: number,
  otherWidth = 0,
) {
  const limits = ROUND_PANES[pane];
  const room = workspaceWidth === undefined ? limits.max : workspaceWidth - otherWidth - 16 - 360;
  const maximum = Math.max(limits.min, Math.min(limits.max, room));
  return Math.round(
    Math.min(maximum, Math.max(limits.min, Number.isFinite(value) ? value : limits.initial)),
  );
}

export function readRoundPaneWidths(raw: string | null): RoundPaneWidths {
  const defaults = { navigation: ROUND_PANES.navigation.initial, tools: ROUND_PANES.tools.initial };
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaults;
    const record = parsed as Record<string, unknown>;
    return {
      navigation: roundPaneWidth(
        "navigation",
        typeof record.navigation === "number" ? record.navigation : defaults.navigation,
      ),
      tools: roundPaneWidth(
        "tools",
        typeof record.tools === "number" ? record.tools : defaults.tools,
      ),
    };
  } catch {
    return defaults;
  }
}
