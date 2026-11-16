import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  layoutEffects: [] as Array<() => void | (() => void)>,
}));

vi.mock("react", () => ({
  useLayoutEffect: (effect: () => void | (() => void)) => {
    hooks.layoutEffects.push(effect);
  },
}));

import {
  applyColorModePreference,
  COLOR_MODE_CHANGE_EVENT,
  COLOR_MODE_STORAGE_KEY,
  getColorModePreference,
} from "../lib/color-mode";
import {
  applyInterfaceThemePreference,
  getInterfaceThemePreference,
  getInterfaceThemeStyle,
  INTERFACE_THEME_CHANGE_EVENT,
  INTERFACE_THEME_STORAGE_KEY,
} from "../lib/interface-theme";
import { ColorModeSync } from "./color-mode-sync";

function browserFixture() {
  const state = { prefersDark: true, storageWritable: true };
  const properties = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string>,
    style: {
      colorScheme: "",
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
  };
  const stored = new Map([
    [COLOR_MODE_STORAGE_KEY, "system"],
    [INTERFACE_THEME_STORAGE_KEY, "classic"],
  ]);
  const mediaListeners = new Map<string, EventListener>();
  const windowListeners = new Map<string, EventListener>();
  const media = {
    get matches() {
      return state.prefersDark;
    },
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      mediaListeners.set(type, listener);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      if (mediaListeners.get(type) === listener) mediaListeners.delete(type);
    }),
  };
  const localStorage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (!state.storageWritable) throw new Error("blocked");
      stored.set(key, value);
    },
  };
  const fakeWindow = {
    localStorage,
    matchMedia: vi.fn(() => media),
    dispatchEvent: vi.fn((event: Event) => {
      windowListeners.get(event.type)?.(event);
      return true;
    }),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      windowListeners.set(type, listener);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      if (windowListeners.get(type) === listener) windowListeners.delete(type);
    }),
  };
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("window", fakeWindow);
  const storageEvent = (key: string | null) => {
    windowListeners.get("storage")?.({ key, storageArea: localStorage } as unknown as StorageEvent);
  };
  const changeSystemMode = (dark: boolean) => {
    state.prefersDark = dark;
    mediaListeners.get("change")?.(new Event("change"));
  };
  return {
    state,
    root,
    properties,
    stored,
    mediaListeners,
    windowListeners,
    storageEvent,
    changeSystemMode,
  };
}

function mountEffect() {
  expect(ColorModeSync()).toBeNull();
  const cleanup = hooks.layoutEffects.at(-1)?.();
  if (typeof cleanup !== "function") throw new Error("Expected an effect cleanup");
  return cleanup;
}

describe("ColorModeSync", () => {
  afterEach(() => {
    hooks.layoutEffects.length = 0;
    vi.unstubAllGlobals();
  });

  it("reapplies the initial mode on a Strict Mode remount and cleans up listeners", () => {
    const fixture = browserFixture();
    const { root, mediaListeners, windowListeners } = fixture;
    const firstCleanup = mountEffect();
    expect(root.dataset).toEqual({
      colorMode: "dark",
      colorModePreference: "system",
      interfaceTheme: "classic",
    });
    expect(root.style.colorScheme).toBe("dark");
    expect(mediaListeners.has("change")).toBe(true);
    for (const type of ["storage", COLOR_MODE_CHANGE_EVENT, INTERFACE_THEME_CHANGE_EVENT]) {
      expect(windowListeners.has(type)).toBe(true);
    }
    firstCleanup();
    expect(mediaListeners.size).toBe(0);
    expect(windowListeners.size).toBe(0);

    delete root.dataset.colorMode;
    delete root.dataset.colorModePreference;
    delete root.dataset.interfaceTheme;
    root.style.colorScheme = "";
    const secondCleanup = mountEffect();
    expect(root.dataset).toEqual({
      colorMode: "dark",
      colorModePreference: "system",
      interfaceTheme: "classic",
    });
    fixture.changeSystemMode(false);
    expect(root.dataset).toEqual({
      colorMode: "light",
      colorModePreference: "system",
      interfaceTheme: "classic",
    });
    expect(root.style.colorScheme).toBe("light");
    secondCleanup();
  });

  it("synchronizes saved families with OS mode changes and changes in another tab", () => {
    const fixture = browserFixture();
    fixture.stored.set(INTERFACE_THEME_STORAGE_KEY, "ocean");
    const cleanup = mountEffect();
    expect(fixture.properties.get("--ui-accent")).toBe(
      getInterfaceThemeStyle("ocean", "dark")["--ui-accent"],
    );
    fixture.changeSystemMode(false);
    expect(fixture.properties.get("--ui-accent")).toBe(
      getInterfaceThemeStyle("ocean", "light")["--ui-accent"],
    );
    fixture.stored.set(INTERFACE_THEME_STORAGE_KEY, "pop");
    fixture.storageEvent(INTERFACE_THEME_STORAGE_KEY);
    expect(fixture.root.dataset.interfaceTheme).toBe("pop");
    expect(fixture.properties.get("--ui-accent")).toBe(
      getInterfaceThemeStyle("pop", "light")["--ui-accent"],
    );
    fixture.stored.set(COLOR_MODE_STORAGE_KEY, "dark");
    fixture.storageEvent(COLOR_MODE_STORAGE_KEY);
    expect(fixture.properties.get("--ui-accent")).toBe(
      getInterfaceThemeStyle("pop", "dark")["--ui-accent"],
    );
    fixture.stored.clear();
    fixture.storageEvent(null);
    expect(fixture.root.dataset).toEqual({
      colorMode: "light",
      colorModePreference: "system",
      interfaceTheme: "classic",
    });
    expect(fixture.properties.size).toBe(0);
    cleanup();
  });

  it("keeps unsaved in-tab choices through re-syncs and system changes when storage writes fail", () => {
    const fixture = browserFixture();
    const cleanup = mountEffect();
    fixture.state.storageWritable = false;
    applyColorModePreference("dark");
    applyInterfaceThemePreference("forest");
    fixture.changeSystemMode(false);
    expect(getColorModePreference()).toBe("dark");
    expect(getInterfaceThemePreference()).toBe("forest");
    expect(fixture.root.dataset).toEqual({
      colorMode: "dark",
      colorModePreference: "dark",
      interfaceTheme: "forest",
    });
    applyColorModePreference("system");
    expect(fixture.root.dataset.colorMode).toBe("light");
    expect(fixture.properties.get("--ui-accent")).toBe(
      getInterfaceThemeStyle("forest", "light")["--ui-accent"],
    );
    fixture.changeSystemMode(true);
    expect(fixture.root.dataset.colorMode).toBe("dark");
    expect(fixture.properties.get("--ui-accent")).toBe(
      getInterfaceThemeStyle("forest", "dark")["--ui-accent"],
    );
    cleanup();
  });
});
