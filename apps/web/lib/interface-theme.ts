import type { CSSProperties } from "react";
import { workspaceThemePresets } from "@openround/experience";
import type { ResolvedColorMode } from "./color-mode";

export const INTERFACE_THEME_STORAGE_KEY = "openround:interface-theme";
export const INTERFACE_THEME_CHANGE_EVENT = "openround:interface-theme-change";

export const interfaceThemePresets = [
  { id: "classic", name: "Classic", description: "Quiet neutrals with a fresh mint detail." },
  { id: "pop", name: "Candy Pop", description: "Berry actions and a playful plum highlight." },
  { id: "ocean", name: "Ocean", description: "Deep blue and a clear teal current." },
  { id: "forest", name: "Forest", description: "Grounded evergreen with fresh green details." },
  { id: "violet", name: "Violet", description: "Rich purple and a soft lavender glow." },
  { id: "sunset", name: "Sunset", description: "Warm terracotta and a deep copper glow." },
  { id: "slate", name: "Slate", description: "Cool blue-grey for a focused workspace." },
  { id: "sand", name: "Sand", description: "Golden ochre with warm earth details." },
] as const;

export type InterfaceThemeId = (typeof interfaceThemePresets)[number]["id"];
export type InterfaceThemeStyle = CSSProperties & Record<`--ui-${string}`, string>;
type ThemeTokens = Record<`--ui-${string}`, string>;

// Mirror the default CSS for isolated previews. The drift test keeps this map
// aligned while the default interface continues to use its existing CSS tokens.
const lightBase: ThemeTokens = {
  "--ui-brand-glow": "rgba(249, 104, 138, 0.18)",
  "--ui-canvas": "#f6f7f9",
  "--ui-canvas-glow": "rgba(20, 101, 82, 0.12)",
  "--ui-surface": "#ffffff",
  "--ui-surface-raised": "#ffffff",
  "--ui-surface-soft": "#f1f3f5",
  "--ui-surface-hover": "#e9edf1",
  "--ui-surface-translucent": "rgba(255, 255, 255, 0.94)",
  "--ui-border": "#dce1e7",
  "--ui-border-subtle": "#e9edf1",
  "--ui-border-strong": "#7c8592",
  "--ui-text": "#303640",
  "--ui-text-strong": "#242931",
  "--ui-text-subtle": "#58616e",
  "--ui-text-muted": "#616b78",
  "--ui-accent": "#262b33",
  "--ui-accent-hover": "#3c434d",
  "--ui-accent-soft": "#e6f2ec",
  "--ui-accent-ink": "#146552",
  "--ui-focus": "#146552",
  "--ui-on-accent": "#ffffff",
  "--ui-overlay": "rgba(24, 29, 36, 0.52)",
  "--ui-shadow-sm": "0 1px 3px rgba(24, 29, 36, 0.04)",
  "--ui-shadow-md": "0 8px 24px rgba(24, 29, 36, 0.07)",
  "--ui-shadow-lg": "0 20px 56px rgba(24, 29, 36, 0.12)",
  "--ui-success-bg": "#dcfce7",
  "--ui-success-text": "#166534",
  "--ui-info-bg": "#e6f0ff",
  "--ui-info-text": "#2058a5",
  "--ui-warning-bg": "#fff3c4",
  "--ui-warning-text": "#8a4b08",
  "--ui-danger-bg": "#fff1f0",
  "--ui-danger-text": "#991b1b",
  "--ui-danger-border": "#fecaca",
  "--ui-violet-bg": "#efe9ff",
  "--ui-violet-text": "#6941c6",
  "--ui-kind-round-bg": "var(--ui-surface-soft)",
  "--ui-kind-round-text": "var(--ui-text-strong)",
  "--ui-kind-presentation-bg": "var(--ui-surface-soft)",
  "--ui-kind-presentation-text": "var(--ui-text-strong)",
  "--ui-kind-survey-bg": "var(--ui-surface-soft)",
  "--ui-kind-survey-text": "var(--ui-text-strong)",
  "--ui-kind-practice-bg": "var(--ui-surface-soft)",
  "--ui-kind-practice-text": "var(--ui-text-strong)",
  "--ui-skeleton-base": "#e8eef2",
  "--ui-skeleton-highlight": "#f6f9fb",
  "--ui-hero-start": "#242931",
  "--ui-hero-mid": "#2e363e",
  "--ui-hero-end": "#263e38",
  "--ui-hero-glow-warm": "rgba(249, 104, 138, 0.08)",
  "--ui-hero-glow-teal": "rgba(156, 222, 188, 0.14)",
  "--ui-on-hero": "#ffffff",
  "--ui-on-hero-muted": "#dde5e3",
  "--ui-on-hero-border": "rgba(255, 255, 255, 0.25)",
  "--ui-on-hero-surface": "rgba(255, 255, 255, 0.1)",
};

const darkBase: ThemeTokens = {
  "--ui-brand-glow": "rgba(249, 104, 138, 0.12)",
  "--ui-canvas": "#16191e",
  "--ui-canvas-glow": "rgba(156, 222, 188, 0.12)",
  "--ui-surface": "#20242b",
  "--ui-surface-raised": "#292e36",
  "--ui-surface-soft": "#262b33",
  "--ui-surface-hover": "#303640",
  "--ui-surface-translucent": "rgba(32, 36, 43, 0.96)",
  "--ui-border": "#3d444f",
  "--ui-border-subtle": "#303640",
  "--ui-border-strong": "#798595",
  "--ui-text": "#e8ebf0",
  "--ui-text-strong": "#f6f7f9",
  "--ui-text-subtle": "#b8c0cb",
  "--ui-text-muted": "#a4afbc",
  "--ui-accent": "#edf0f4",
  "--ui-accent-hover": "#ffffff",
  "--ui-accent-soft": "#253b34",
  "--ui-accent-ink": "#b9eace",
  "--ui-focus": "#9cdebc",
  "--ui-on-accent": "#20242b",
  "--ui-overlay": "rgba(0, 7, 10, 0.72)",
  "--ui-shadow-sm": "0 10px 28px rgba(0, 0, 0, 0.2)",
  "--ui-shadow-md": "0 18px 42px rgba(0, 0, 0, 0.27)",
  "--ui-shadow-lg": "0 24px 70px rgba(0, 0, 0, 0.36)",
  "--ui-success-bg": "#133b31",
  "--ui-success-text": "#8ae1bf",
  "--ui-info-bg": "#203655",
  "--ui-info-text": "#a5c8ff",
  "--ui-warning-bg": "#412f16",
  "--ui-warning-text": "#f4c66d",
  "--ui-danger-bg": "#45201f",
  "--ui-danger-text": "#ffb4ae",
  "--ui-danger-border": "#7b3a36",
  "--ui-violet-bg": "#30264d",
  "--ui-violet-text": "#d5c3ff",
  "--ui-kind-round-bg": "var(--ui-surface-soft)",
  "--ui-kind-round-text": "var(--ui-text-strong)",
  "--ui-kind-presentation-bg": "var(--ui-surface-soft)",
  "--ui-kind-presentation-text": "var(--ui-text-strong)",
  "--ui-kind-survey-bg": "var(--ui-surface-soft)",
  "--ui-kind-survey-text": "var(--ui-text-strong)",
  "--ui-kind-practice-bg": "var(--ui-surface-soft)",
  "--ui-kind-practice-text": "var(--ui-text-strong)",
  "--ui-skeleton-base": "#262b33",
  "--ui-skeleton-highlight": "#353c47",
  "--ui-hero-start": "#242931",
  "--ui-hero-mid": "#2e363e",
  "--ui-hero-end": "#263e38",
  "--ui-hero-glow-warm": "rgba(249, 104, 138, 0.06)",
  "--ui-hero-glow-teal": "rgba(156, 222, 188, 0.12)",
  "--ui-on-hero": "#f7fbfa",
  "--ui-on-hero-muted": "#dde5e3",
  "--ui-on-hero-border": "rgba(213, 240, 237, 0.28)",
  "--ui-on-hero-surface": "rgba(210, 241, 237, 0.1)",
};

// Working surfaces, text, borders and semantic status colors stay neutral and stable.
const palettes = Object.fromEntries(
  workspaceThemePresets.map(({ id, primaryColor, accentColor }) => [
    id,
    { primary: primaryColor.toLowerCase(), accent: accentColor.toLowerCase() },
  ]),
) as Record<InterfaceThemeId, { primary: string; accent: string }>;

function channels(hex: string): number[] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function mix(first: string, second: string, amount: number): string {
  const other = channels(second);
  return `#${channels(first)
    .map((channel, index) =>
      Math.round(channel * (1 - amount) + other[index]! * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function rgba(hex: string, alpha: number): string {
  return `rgba(${channels(hex).join(", ")}, ${alpha})`;
}

function themeOverrides(id: InterfaceThemeId, mode: ResolvedColorMode): ThemeTokens {
  if (id === "classic") return {};
  const { primary, accent } = palettes[id];
  const dark = mode === "dark";
  const ink = dark ? mix(accent, "#ffffff", 0.75) : accent;
  return {
    "--ui-accent": dark ? ink : accent,
    "--ui-accent-hover": dark ? mix(accent, "#ffffff", 0.87) : mix(accent, "#000000", 0.16),
    "--ui-accent-soft": dark ? mix("#20242b", accent, 0.22) : mix("#ffffff", accent, 0.08),
    "--ui-accent-ink": ink,
    "--ui-focus": ink,
    "--ui-on-accent": dark ? "#20242b" : "#ffffff",
    "--ui-brand-glow": rgba(accent, dark ? 0.1 : 0.08),
    "--ui-canvas-glow": rgba(accent, dark ? 0.1 : 0.08),
    "--ui-hero-start": dark ? mix(primary, "#000000", 0.12) : primary,
    "--ui-hero-mid": mix(primary, accent, dark ? 0.12 : 0.2),
    "--ui-hero-end": mix(primary, accent, dark ? 0.22 : 0.35),
    "--ui-hero-glow-warm": rgba(accent, dark ? 0.06 : 0.08),
    "--ui-hero-glow-teal": rgba(ink, dark ? 0.1 : 0.12),
    "--ui-on-hero-muted": "#e8ebf0",
  };
}

const themeOverridesByMode = Object.fromEntries(
  interfaceThemePresets.map(({ id }) => [
    id,
    { light: themeOverrides(id, "light"), dark: themeOverrides(id, "dark") },
  ]),
) as Record<InterfaceThemeId, Record<ResolvedColorMode, ThemeTokens>>;
const overrideNames = Object.keys(themeOverridesByMode.pop.light);
const preferenceFallbacks = new WeakMap<Window, InterfaceThemeId>();

export function normalizeInterfaceThemeId(value: unknown): InterfaceThemeId {
  return interfaceThemePresets.some(({ id }) => id === value)
    ? (value as InterfaceThemeId)
    : "classic";
}

export function getInterfaceThemeStyle(
  id: InterfaceThemeId,
  mode: ResolvedColorMode,
): InterfaceThemeStyle {
  return {
    colorScheme: mode,
    ...(mode === "dark" ? darkBase : lightBase),
    ...themeOverridesByMode[normalizeInterfaceThemeId(id)][mode],
  };
}

export function getInterfaceThemePreference(): InterfaceThemeId {
  if (typeof window === "undefined") return "classic";
  const fallback = preferenceFallbacks.get(window);
  if (fallback) return fallback;
  try {
    return normalizeInterfaceThemeId(window.localStorage.getItem(INTERFACE_THEME_STORAGE_KEY));
  } catch {
    return normalizeInterfaceThemeId(document.documentElement.dataset.interfaceTheme);
  }
}

export function clearInterfaceThemePreferenceFallback(): void {
  if (typeof window !== "undefined") preferenceFallbacks.delete(window);
}

export function applyInterfaceTheme(
  id: InterfaceThemeId,
  mode: ResolvedColorMode,
  target: HTMLElement = document.documentElement,
): void {
  const theme = normalizeInterfaceThemeId(id);
  target.dataset.interfaceTheme = theme;
  // Remove the previous family's overrides, including when returning to Classic.
  for (const name of overrideNames) target.style.removeProperty(name);
  for (const [name, value] of Object.entries(themeOverridesByMode[theme][mode])) {
    target.style.setProperty(name, value);
  }
}

export function applyInterfaceThemePreference(id: InterfaceThemeId): void {
  if (typeof window === "undefined") return;
  const theme = normalizeInterfaceThemeId(id);
  try {
    window.localStorage.setItem(INTERFACE_THEME_STORAGE_KEY, theme);
    preferenceFallbacks.delete(window);
  } catch {
    preferenceFallbacks.set(window, theme);
  }
  const root = document.documentElement;
  const mode = root.dataset.colorMode === "dark" ? "dark" : "light";
  applyInterfaceTheme(theme, mode, root);
  window.dispatchEvent(new Event(INTERFACE_THEME_CHANGE_EVENT));
}

// Serialize only trusted tokens. Storage contributes an allowlisted ID, never CSS.
// Runs in the root head immediately after the existing color-mode bootstrap.
export const INTERFACE_THEME_BOOTSTRAP_SCRIPT = `(function(){var t=${JSON.stringify(themeOverridesByMode)};var p="classic";try{p=localStorage.getItem("${INTERFACE_THEME_STORAGE_KEY}")}catch(e){}if(!Object.prototype.hasOwnProperty.call(t,p))p="classic";var r=document.documentElement;var m=r.dataset.colorMode==="dark"?"dark":"light";r.dataset.interfaceTheme=p;var s=t[p][m];for(var k in s)r.style.setProperty(k,s[k])})()`;
