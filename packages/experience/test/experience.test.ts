import { describe, expect, it } from "vitest";
import {
  BrandThemeSchema,
  colorContrastRatio,
  ExperienceThemeSnapshotSchema,
  RoundCategorySchema,
  ExperiencePresetIdSchema,
} from "@openround/contracts";
import {
  experiencePresets,
  getExperiencePreset,
  presetForCategory,
  resolveExperienceTheme,
  workspaceThemePresets,
} from "../src/index.js";

describe("versioned experience presets", () => {
  it("ships immutable accessible presets with a recommendation for every category", () => {
    expect(experiencePresets.map((preset) => preset.preset.id)).toStrictEqual([
      "pops",
      "focus",
      "campus",
      "studio",
      "blueprint",
      "signal",
      "spark",
      "observatory",
      "breath",
      "gallery",
      "summit",
      "grove",
      "commons",
      "midnight",
    ]);
    expect(presetForCategory("technical")).toBe("blueprint");
    expect(experiencePresets.map(({ preset }) => preset.id)).toEqual(
      ExperiencePresetIdSchema.options,
    );
    for (const category of RoundCategorySchema.options) {
      expect(getExperiencePreset(presetForCategory(category))).toBeDefined();
    }
    expect(Object.isFrozen(experiencePresets)).toBe(true);
    for (const preset of experiencePresets) {
      expect(Object.isFrozen(preset)).toBe(true);
      expect(Object.isFrozen(preset.tokens)).toBe(true);
      expect(Object.isFrozen(preset.tokens.choiceColors)).toBe(true);
    }
  });

  it("supports readable authored dark palettes and preserves topic metadata independently of the look", () => {
    for (const preset of experiencePresets) {
      const theme = resolveExperienceTheme({ category: "community", presetId: preset.preset.id });
      expect(theme.category).toBe("community");
      expect(theme.preset).toEqual(preset.preset);
      for (const background of [
        preset.tokens.canvas,
        preset.tokens.surface,
        preset.tokens.surfaceStrong,
      ]) {
        for (const foreground of [
          preset.tokens.text,
          preset.tokens.mutedText,
          preset.tokens.primary,
        ]) {
          expect(
            colorContrastRatio(foreground, background),
            `${preset.preset.id}:${foreground}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const fill of [
        preset.tokens.primaryFill ?? preset.tokens.primary,
        preset.tokens.accent,
        ...preset.tokens.choiceColors,
      ]) {
        expect(colorContrastRatio(fill, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const id of ["observatory", "summit", "midnight"] as const) {
      expect(
        colorContrastRatio(getExperiencePreset(id).tokens.canvas, "#FFFFFF"),
      ).toBeGreaterThanOrEqual(7);
    }
  });

  it("layers validated workspace brand colours without changing other tokens", () => {
    const resolved = resolveExperienceTheme({
      category: "business",
      soundEnabled: true,
      brandTheme: {
        organizationName: "Northern Learning",
        primaryColor: "#0B2239",
        accentColor: "#075E63",
      },
    });
    expect(resolved).toMatchObject({
      preset: { id: "studio", version: 1 },
      soundEnabled: true,
      tokens: { primary: "#0B2239", accent: "#075E63", pattern: "none" },
    });
  });

  it("does not enable unavailable sound cues", () => {
    expect(resolveExperienceTheme({ category: "general", soundEnabled: true }).soundEnabled).toBe(
      false,
    );
  });

  it("offers Candy Pop without replacing stored legacy preset tokens", () => {
    const current = resolveExperienceTheme({ category: "general" });
    expect(current.preset).toEqual({ id: "pops", version: 1 });
    expect(ExperienceThemeSnapshotSchema.safeParse(current).success).toBe(true);
    expect(current.motion).toBe("calm");
    expect(colorContrastRatio(current.tokens.mutedText, current.tokens.canvas)).toBeGreaterThan(
      4.5,
    );
    expect(colorContrastRatio(current.tokens.accent, "#FFFFFF")).toBeGreaterThan(4.5);

    const legacy = resolveExperienceTheme({ category: "general", presetId: "focus" });
    expect(legacy.preset).toEqual({ id: "focus", version: 1 });
    expect(legacy.tokens.canvas).toBe("#F7F4EC");
    expect(legacy.tokens).toEqual(getExperiencePreset("focus").tokens);
  });

  it("keeps every legacy preset and workspace override byte-for-byte compatible", () => {
    for (const preset of experiencePresets.slice(0, 7)) {
      const legacyBrand = {
        organizationName: "Legacy workspace",
        primaryColor: "#0B2239",
        accentColor: "#087375",
      };
      expect(
        resolveExperienceTheme({ category: preset.category, presetId: preset.preset.id }).tokens,
      ).toEqual(preset.tokens);
      expect(
        resolveExperienceTheme({
          category: preset.category,
          presetId: preset.preset.id,
          brandTheme: legacyBrand,
        }).tokens,
      ).toEqual({
        ...preset.tokens,
        primary: legacyBrand.primaryColor,
        accent: legacyBrand.accentColor,
      });
    }
  });

  it("keeps new authored dark palettes readable with legacy workspace brand records", () => {
    for (const id of ["observatory", "summit", "midnight"] as const) {
      for (const brand of workspaceThemePresets) {
        const authored = getExperiencePreset(id);
        const { tokens } = resolveExperienceTheme({
          category: "general",
          presetId: id,
          brandTheme: { organizationName: "Legacy workspace", ...brand },
        });
        expect(tokens.canvas).toBe(authored.tokens.canvas);
        expect(tokens.primaryFill).toBe(brand.primaryColor);
        expect(tokens.accent).toBe(brand.accentColor);
        for (const background of [tokens.canvas, tokens.surface, tokens.surfaceStrong]) {
          expect(colorContrastRatio(tokens.primary, background)).toBeGreaterThanOrEqual(4.5);
        }
        expect(colorContrastRatio(tokens.primaryFill!, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("ships eight workspace colour families while retaining the original three choices", () => {
    expect(workspaceThemePresets.map(({ id }) => id)).toEqual([
      "classic",
      "pop",
      "ocean",
      "forest",
      "violet",
      "sunset",
      "slate",
      "sand",
    ]);
    expect(workspaceThemePresets.slice(1, 4)).toEqual([
      { id: "pop", primaryColor: "#39243C", accentColor: "#AC2855" },
      { id: "ocean", primaryColor: "#17334A", accentColor: "#006B80" },
      { id: "forest", primaryColor: "#183C31", accentColor: "#176B50" },
    ]);
    for (const preset of workspaceThemePresets) {
      expect(BrandThemeSchema.safeParse({ organizationName: "Workspace", ...preset }).success).toBe(
        true,
      );
    }
  });

  it("derives readable complete light and dark palettes without changing authored styling", () => {
    const colors = [
      ...workspaceThemePresets,
      { primaryColor: "#767676", accentColor: "#767676" },
      { primaryColor: "#000000", accentColor: "#000000" },
      { primaryColor: "#EC0000", accentColor: "#008600" },
      { primaryColor: "#0000FF", accentColor: "#0000FF" },
    ];
    for (const colorset of colors) {
      for (const colorMode of ["light", "dark"] as const) {
        const brandTheme = BrandThemeSchema.parse({
          organizationName: "Northern Learning",
          ...colorset,
          colorMode,
        });
        for (const preset of experiencePresets) {
          const input = { category: preset.category, presetId: preset.preset.id, brandTheme };
          const resolved = resolveExperienceTheme(input);
          const { tokens } = resolved;
          expect(ExperienceThemeSnapshotSchema.parse(resolved)).toEqual(resolved);
          expect(resolveExperienceTheme(input)).toEqual(resolved);
          expect(tokens).toMatchObject({
            pattern: preset.tokens.pattern,
            typography: preset.tokens.typography,
            corners: preset.tokens.corners,
            choiceColors: preset.tokens.choiceColors,
            primaryFill: brandTheme.primaryColor,
            accent: brandTheme.accentColor,
          });
          for (const background of [tokens.canvas, tokens.surface, tokens.surfaceStrong]) {
            expect(colorContrastRatio(tokens.text, background)).toBeGreaterThanOrEqual(7);
            expect(colorContrastRatio(tokens.mutedText, background)).toBeGreaterThanOrEqual(4.5);
            expect(colorContrastRatio(tokens.primary, background)).toBeGreaterThanOrEqual(4.5);
            expect(colorContrastRatio("#FFFFFF", background) > 4.5).toBe(colorMode === "dark");
          }
          expect(colorContrastRatio(tokens.accent, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
          expect(colorContrastRatio(tokens.primaryFill!, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("keeps previously resolved room tokens frozen when workspace choices change", () => {
    const original = {
      organizationName: "Northern Learning",
      ...workspaceThemePresets[1],
      colorMode: "light" as const,
    };
    const room = resolveExperienceTheme({ category: "general", brandTheme: original });
    const storedTokens = structuredClone(room.tokens);
    const nextRoom = resolveExperienceTheme({
      category: "general",
      brandTheme: { ...original, ...workspaceThemePresets[2], colorMode: "dark" },
    });
    expect(room.tokens).toEqual(storedTokens);
    expect(nextRoom.tokens.canvas).not.toEqual(room.tokens.canvas);
    expect(getExperiencePreset("pops").tokens.canvas).toBe("#FFF8EF");
  });
});
