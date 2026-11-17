import { colorContrastRatio } from "@openround/contracts";
import {
  experiencePresets,
  resolveExperienceTheme,
  workspaceThemePresets,
} from "@openround/experience";
import { describe, expect, it } from "vitest";
import { experienceThemeStyle } from "./theme";

describe("frozen experience CSS tokens", () => {
  it("derives native control appearance and a readable header from every unbranded preset", () => {
    for (const preset of experiencePresets) {
      const theme = resolveExperienceTheme({
        category: preset.category,
        presetId: preset.preset.id,
      });
      const style = experienceThemeStyle(theme)!;
      expect(style["--experience-surface"]).toBe(preset.tokens.surface);
      expect(style["--experience-text"]).toBe(preset.tokens.text);
      expect(style["--experience-color-scheme"]).toBe(
        colorContrastRatio(preset.tokens.surface, "#000000") >=
          colorContrastRatio(preset.tokens.surface, "#FFFFFF")
          ? "light"
          : "dark",
      );
      expect(
        colorContrastRatio(style["--experience-header-fill"]!, "#FFFFFF"),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("keeps readable dark-mode primary ink separate from white-label fills", () => {
    for (const preset of workspaceThemePresets) {
      const theme = resolveExperienceTheme({
        category: "general",
        brandTheme: { ...preset, organizationName: "Example workspace", colorMode: "dark" },
      });
      const style = experienceThemeStyle(theme)!;
      expect(style["--experience-primary-fill"]).toBe(preset.primaryColor);
      expect(style["--experience-primary"]).toBe(theme.tokens.primary);
      expect(
        colorContrastRatio(style["--experience-primary-fill"]!, "#ffffff"),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        colorContrastRatio(style["--experience-primary"]!, style["--experience-surface"]!),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("falls back to the original primary for older snapshots without a fill token", () => {
    const legacy = resolveExperienceTheme({ category: "general" });
    expect(legacy.tokens.primaryFill).toBeUndefined();
    expect(experienceThemeStyle(legacy)?.["--experience-primary-fill"]).toBe(legacy.tokens.primary);
    expect(experienceThemeStyle(null)).toBeUndefined();
  });
});
