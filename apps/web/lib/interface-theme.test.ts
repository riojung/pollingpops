import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { colorContrastRatio } from "@openround/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COLOR_MODE_BOOTSTRAP_SCRIPT, COLOR_MODE_STORAGE_KEY } from "./color-mode";
import {
  applyInterfaceTheme,
  applyInterfaceThemePreference,
  getInterfaceThemePreference,
  getInterfaceThemeStyle,
  interfaceThemePresets,
  INTERFACE_THEME_CHANGE_EVENT,
  INTERFACE_THEME_STORAGE_KEY,
  normalizeInterfaceThemeId,
  type InterfaceThemeId,
} from "./interface-theme";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const surfaces = [
  "--ui-canvas",
  "--ui-surface",
  "--ui-surface-raised",
  "--ui-surface-soft",
  "--ui-surface-hover",
] as const;

function cssTokens(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1];
  if (!block) throw new Error(`Missing theme: ${selector}`);
  return Object.fromEntries(
    [...block.matchAll(/(--ui-[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name!,
      value!.trim(),
    ]),
  );
}

function rootFixture() {
  const properties = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string>,
    style: {
      colorScheme: "",
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
  };
  return { root, properties };
}

afterEach(() => vi.unstubAllGlobals());

it("keeps isolated Classic previews aligned with every default CSS token", () => {
  const light = cssTokens(":root");
  const dark = { ...light, ...cssTokens('html[data-color-mode="dark"]') };
  for (const [mode, expected] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    expect(getInterfaceThemeStyle("classic", mode)).toEqual({ colorScheme: mode, ...expected });
  }
});

describe.each(interfaceThemePresets)("$name interface palette", ({ id }) => {
  it.each(["light", "dark"] as const)(
    "keeps %s text, actions and keyboard focus readable",
    (mode) => {
      const theme = getInterfaceThemeStyle(id, mode);
      for (const surface of surfaces) {
        for (const text of [
          "--ui-text",
          "--ui-text-strong",
          "--ui-text-subtle",
          "--ui-text-muted",
          "--ui-accent-ink",
        ] as const) {
          expect(
            colorContrastRatio(theme[text]!, theme[surface]!),
            `${id} ${mode} ${text} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        for (const boundary of ["--ui-focus", "--ui-border-strong"] as const) {
          expect(colorContrastRatio(theme[boundary]!, theme[surface]!)).toBeGreaterThanOrEqual(3);
        }
        const rgb = [1, 3, 5].map((offset) =>
          Number.parseInt(theme[surface]!.slice(offset, offset + 2), 16),
        );
        expect(Math.max(...rgb) - Math.min(...rgb)).toBeLessThanOrEqual(18);
      }
      for (const [text, background] of [
        ["--ui-on-accent", "--ui-accent"],
        ["--ui-on-accent", "--ui-accent-hover"],
        ["--ui-accent-ink", "--ui-accent-soft"],
        ["--ui-success-text", "--ui-success-bg"],
        ["--ui-info-text", "--ui-info-bg"],
        ["--ui-warning-text", "--ui-warning-bg"],
        ["--ui-danger-text", "--ui-danger-bg"],
        ["--ui-violet-text", "--ui-violet-bg"],
        ...["--ui-hero-start", "--ui-hero-mid", "--ui-hero-end"].flatMap((background) => [
          ["--ui-on-hero", background],
          ["--ui-on-hero-muted", background],
        ]),
      ]) {
        expect(
          colorContrastRatio(
            theme[text as `--ui-${string}`]!,
            theme[background as `--ui-${string}`]!,
          ),
        ).toBeGreaterThanOrEqual(4.5);
      }

      const glow = theme["--ui-brand-glow"]!.match(/^rgba\((\d+), (\d+), (\d+), (0\.\d+)\)$/);
      expect(glow).not.toBeNull();
      const alpha = Number(glow![4]);
      const blended = [1, 2, 3]
        .map((channel, index) => {
          const base = Number.parseInt(
            theme["--ui-surface"]!.slice(1 + index * 2, 3 + index * 2),
            16,
          );
          return Math.round(Number(glow![channel]) * alpha + base * (1 - alpha))
            .toString(16)
            .padStart(2, "0");
        })
        .join("");
      for (const text of ["--ui-text-muted", "--ui-text-subtle", "--ui-accent-ink"] as const) {
        expect(colorContrastRatio(theme[text]!, `#${blended}`)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("provides a complete mode-specific preview without inheriting the active family", () => {
    const light = getInterfaceThemeStyle(id, "light");
    const dark = getInterfaceThemeStyle(id, "dark");
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
    expect(light["--ui-canvas"]).not.toBe(dark["--ui-canvas"]);
    expect(light["--ui-accent"]).not.toBe(dark["--ui-accent"]);
    for (const key of Object.keys(light).filter((key) =>
      /--ui-(success|info|warning|danger|violet)-/.test(key),
    )) {
      expect(light[key as `--ui-${string}`]).toBe(
        getInterfaceThemeStyle("classic", "light")[key as `--ui-${string}`],
      );
      expect(dark[key as `--ui-${string}`]).toBe(
        getInterfaceThemeStyle("classic", "dark")[key as `--ui-${string}`],
      );
    }
  });
});

it("gives every family a distinct action, selection and hero palette", () => {
  for (const mode of ["light", "dark"] as const) {
    for (const token of ["--ui-accent", "--ui-accent-soft", "--ui-hero-end"] as const) {
      expect(
        new Set(interfaceThemePresets.map(({ id }) => getInterfaceThemeStyle(id, mode)[token]))
          .size,
      ).toBe(interfaceThemePresets.length);
    }
  }
});

it.each(["__proto__", "toString", "ocean;--ui-text:red", undefined])(
  "allowlists stored IDs instead of interpreting %s as CSS",
  (value) => expect(normalizeInterfaceThemeId(value)).toBe("classic"),
);

it("bootstraps the selected family in its resolved mode before hydration", () => {
  const { root, properties } = rootFixture();
  const values = new Map([
    [COLOR_MODE_STORAGE_KEY, "system"],
    [INTERFACE_THEME_STORAGE_KEY, "ocean"],
  ]);
  runInNewContext(COLOR_MODE_BOOTSTRAP_SCRIPT, {
    document: { documentElement: root },
    window: { matchMedia: () => ({ matches: true }) },
    localStorage: { getItem: (key: string) => values.get(key) },
  });
  expect(root.dataset).toMatchObject({
    colorMode: "dark",
    colorModePreference: "system",
    interfaceTheme: "ocean",
  });
  expect(properties.get("--ui-accent")).toBe(
    getInterfaceThemeStyle("ocean", "dark")["--ui-accent"],
  );
});

it("boots with safe defaults when storage access is unavailable", () => {
  const { root, properties } = rootFixture();
  runInNewContext(COLOR_MODE_BOOTSTRAP_SCRIPT, {
    document: { documentElement: root },
    window: { matchMedia: () => ({ matches: true }) },
    localStorage: {
      getItem: () => {
        throw new Error("blocked");
      },
    },
  });
  expect(root.dataset).toMatchObject({
    colorMode: "dark",
    colorModePreference: "system",
    interfaceTheme: "classic",
  });
  expect(properties.size).toBe(0);
});

it.each(["__proto__", "toString", "red; background:url(bad)"])(
  "rejects unknown bootstrap ID %s",
  (id) => {
    const { root, properties } = rootFixture();
    runInNewContext(COLOR_MODE_BOOTSTRAP_SCRIPT, {
      document: { documentElement: root },
      window: { matchMedia: () => ({ matches: false }) },
      localStorage: {
        getItem: (key: string) => (key === INTERFACE_THEME_STORAGE_KEY ? id : "light"),
      },
    });
    expect(root.dataset.interfaceTheme).toBe("classic");
    expect(properties.size).toBe(0);
  },
);

it("removes family overrides when Classic is restored", () => {
  const { root, properties } = rootFixture();
  applyInterfaceTheme("pop", "dark", root as unknown as HTMLElement);
  expect(properties.size).toBeGreaterThan(0);
  applyInterfaceTheme("classic", "dark", root as unknown as HTMLElement);
  expect(properties.size).toBe(0);
  expect(root.dataset.interfaceTheme).toBe("classic");
});

it("retains in-tab preference and notifies subscribers when only storage writes are blocked", () => {
  const { root, properties } = rootFixture();
  root.dataset.colorMode = "dark";
  const dispatchEvent = vi.fn();
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("window", {
    localStorage: {
      getItem: () => "classic",
      setItem: () => {
        throw new Error("blocked");
      },
    },
    dispatchEvent,
  });
  applyInterfaceThemePreference("forest");
  expect(getInterfaceThemePreference()).toBe("forest");
  expect(properties.get("--ui-accent")).toBe(
    getInterfaceThemeStyle("forest", "dark")["--ui-accent"],
  );
  expect(dispatchEvent.mock.calls[0]?.[0].type).toBe(INTERFACE_THEME_CHANGE_EVENT);
  applyInterfaceThemePreference("not-a-theme" as InterfaceThemeId);
  expect(getInterfaceThemePreference()).toBe("classic");
});

it("uses safe defaults when browser storage or a browser is unavailable", () => {
  expect(getInterfaceThemePreference()).toBe("classic");
  const { root } = rootFixture();
  root.dataset.interfaceTheme = "sand";
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("window", {
    get localStorage() {
      throw new Error("blocked");
    },
  });
  expect(getInterfaceThemePreference()).toBe("sand");
});
