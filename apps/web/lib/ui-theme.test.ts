import { readFileSync } from "node:fs";
import { colorContrastRatio } from "@openround/contracts";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function tokens(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1];
  if (!block) throw new Error(`Missing theme: ${selector}`);
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]),
  );
}

const light = tokens(":root");
const dark = { ...light, ...tokens('html[data-color-mode="dark"]') };
const surfaces = [
  "--ui-canvas",
  "--ui-surface",
  "--ui-surface-raised",
  "--ui-surface-soft",
  "--ui-surface-hover",
];

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("%s interface theme", (_mode, theme) => {
  it("uses neutral working surfaces rather than pink or plum washes", () => {
    for (const surface of surfaces) {
      const hex = theme[surface]!;
      expect(hex).toMatch(/^#[\da-f]{6}$/i);
      const rgb = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
      expect(Math.max(...rgb) - Math.min(...rgb)).toBeLessThanOrEqual(18);
    }
  });

  it("keeps all normal text, muted labels and neutral secondary controls at AA contrast", () => {
    for (const text of ["--ui-text", "--ui-text-strong", "--ui-text-subtle", "--ui-text-muted"]) {
      for (const surface of surfaces) {
        expect(colorContrastRatio(theme[text]!, theme[surface]!)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps primary actions, mint selections, statuses and hero copy readable", () => {
    for (const [foreground, background] of [
      ["--ui-on-accent", "--ui-accent"],
      ["--ui-on-accent", "--ui-accent-hover"],
      ["--ui-accent-ink", "--ui-accent-soft"],
      ["--ui-success-text", "--ui-success-bg"],
      ["--ui-warning-text", "--ui-warning-bg"],
      ["--ui-danger-text", "--ui-danger-bg"],
      ["--ui-violet-text", "--ui-violet-bg"],
      ...["--ui-hero-start", "--ui-hero-mid", "--ui-hero-end"].flatMap((background) => [
        ["--ui-on-hero", background],
        ["--ui-on-hero-muted", background],
      ]),
    ]) {
      expect(colorContrastRatio(theme[foreground!]!, theme[background!]!)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("keeps focus rings and input boundaries visible on working surfaces", () => {
    for (const surface of surfaces) {
      expect(colorContrastRatio(theme["--ui-focus"]!, theme[surface]!)).toBeGreaterThanOrEqual(3);
      expect(
        colorContrastRatio(theme["--ui-border-strong"]!, theme[surface]!),
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps mint text links readable on every working surface", () => {
    for (const surface of surfaces) {
      expect(colorContrastRatio(theme["--ui-accent-ink"]!, theme[surface]!)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
});

it("retains experience-scoped tokens instead of recoloring frozen live themes", () => {
  const scoped = tokens(".live-shell[data-pattern],\n.experience-preview[data-pattern]");
  expect(scoped["--ui-canvas"]).toBe("var(--experience-canvas)");
  expect(scoped["--ui-text"]).toBe("var(--experience-text)");
  expect(scoped["--ui-accent"]).toBe("var(--experience-accent)");
  expect(scoped["--ui-on-accent"]).toBe("#ffffff");
});
