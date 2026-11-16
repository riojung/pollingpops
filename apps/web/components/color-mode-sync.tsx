"use client";

import { useLayoutEffect } from "react";
import {
  applyColorMode,
  clearColorModePreferenceFallback,
  COLOR_MODE_APPLIED_EVENT,
  COLOR_MODE_CHANGE_EVENT,
  COLOR_MODE_STORAGE_KEY,
  getColorModePreference,
  type ColorModeAppliedDetail,
} from "../lib/color-mode";
import {
  applyInterfaceTheme,
  clearInterfaceThemePreferenceFallback,
  getInterfaceThemePreference,
  INTERFACE_THEME_CHANGE_EVENT,
  INTERFACE_THEME_STORAGE_KEY,
} from "../lib/interface-theme";

export function ColorModeSync() {
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const refresh = () => {
      const preference = getColorModePreference();
      const resolved = applyColorMode(preference, media.matches, document.documentElement);
      applyInterfaceTheme(getInterfaceThemePreference(), resolved);
      window.dispatchEvent(
        new CustomEvent<ColorModeAppliedDetail>(COLOR_MODE_APPLIED_EVENT, {
          detail: { preference, resolved },
        }),
      );
    };
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea) {
        try {
          if (event.storageArea !== window.localStorage) return;
        } catch {
          return;
        }
      }
      if (event.key === null) {
        clearColorModePreferenceFallback();
        clearInterfaceThemePreferenceFallback();
        refresh();
        return;
      }
      if (event.key === COLOR_MODE_STORAGE_KEY) {
        clearColorModePreferenceFallback();
        refresh();
      } else if (event.key === INTERFACE_THEME_STORAGE_KEY) {
        clearInterfaceThemePreferenceFallback();
        refresh();
      }
    };

    refresh();
    media.addEventListener("change", refresh);
    window.addEventListener("storage", onStorage);
    window.addEventListener(COLOR_MODE_CHANGE_EVENT, refresh);
    window.addEventListener(INTERFACE_THEME_CHANGE_EVENT, refresh);
    return () => {
      media.removeEventListener("change", refresh);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(COLOR_MODE_CHANGE_EVENT, refresh);
      window.removeEventListener(INTERFACE_THEME_CHANGE_EVENT, refresh);
    };
  }, []);

  return null;
}
