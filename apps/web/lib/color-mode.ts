import {
  applyInterfaceTheme,
  getInterfaceThemePreference,
  INTERFACE_THEME_BOOTSTRAP_SCRIPT,
} from "./interface-theme";

export const COLOR_MODE_STORAGE_KEY = "openround:color-mode";
export const COLOR_MODE_CHANGE_EVENT = "openround:color-mode-change";
export const COLOR_MODE_APPLIED_EVENT = "openround:color-mode-applied";

export type ColorModePreference = "light" | "dark" | "system";
export type ResolvedColorMode = "light" | "dark";

const preferenceFallbacks = new WeakMap<Window, ColorModePreference>();

export interface ColorModeAppliedDetail {
  preference: ColorModePreference;
  resolved: ResolvedColorMode;
}

interface ColorModeTarget {
  dataset: {
    colorMode?: string;
    colorModePreference?: string;
  };
  style: {
    colorScheme: string;
  };
}

export function normalizeColorModePreference(value: unknown): ColorModePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveColorMode(
  preference: ColorModePreference,
  systemPrefersDark: boolean,
): ResolvedColorMode {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function applyColorMode(
  preference: ColorModePreference,
  systemPrefersDark: boolean,
  target: ColorModeTarget,
): ResolvedColorMode {
  const resolved = resolveColorMode(preference, systemPrefersDark);
  target.dataset.colorMode = resolved;
  target.dataset.colorModePreference = preference;
  target.style.colorScheme = resolved;
  return resolved;
}

export function getColorModePreference(): ColorModePreference {
  if (typeof window === "undefined") return "system";
  const fallback = preferenceFallbacks.get(window);
  if (fallback) return fallback;
  try {
    return normalizeColorModePreference(window.localStorage.getItem(COLOR_MODE_STORAGE_KEY));
  } catch {
    return normalizeColorModePreference(document.documentElement.dataset.colorModePreference);
  }
}

export function clearColorModePreferenceFallback(): void {
  if (typeof window !== "undefined") preferenceFallbacks.delete(window);
}

export function applyColorModePreference(preference: ColorModePreference): ResolvedColorMode {
  const next = normalizeColorModePreference(preference);
  if (typeof window === "undefined") return resolveColorMode(next, false);
  try {
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, next);
    preferenceFallbacks.delete(window);
  } catch {
    // Keep in-tab choices through OS changes even when writes alone are blocked.
    preferenceFallbacks.set(window, next);
  }
  const resolved = applyColorMode(
    next,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
    document.documentElement,
  );
  applyInterfaceTheme(getInterfaceThemePreference(), resolved);
  window.dispatchEvent(new Event(COLOR_MODE_CHANGE_EVENT));
  return resolved;
}

export const COLOR_MODE_BOOTSTRAP_SCRIPT = `(function(){var k="${COLOR_MODE_STORAGE_KEY}";var p="system";try{p=localStorage.getItem(k)}catch(e){}if(p!=="light"&&p!=="dark"&&p!=="system")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";var r=document.documentElement;r.dataset.colorMode=d;r.dataset.colorModePreference=p;r.style.colorScheme=d})();${INTERFACE_THEME_BOOTSTRAP_SCRIPT}`;
