import {
  colorContrastRatio,
  type BrandTheme,
  type ExperienceThemeTokens,
} from "@openround/contracts";

export const workspaceThemePresets = Object.freeze([
  { id: "classic", primaryColor: "#0B2239", accentColor: "#075E63" },
  { id: "pop", primaryColor: "#39243C", accentColor: "#AC2855" },
  { id: "ocean", primaryColor: "#17334A", accentColor: "#006B80" },
  { id: "forest", primaryColor: "#183C31", accentColor: "#176B50" },
  { id: "violet", primaryColor: "#35284E", accentColor: "#7043A0" },
  { id: "sunset", primaryColor: "#4A2926", accentColor: "#A43E25" },
  { id: "slate", primaryColor: "#283342", accentColor: "#4F6077" },
  { id: "sand", primaryColor: "#4A3825", accentColor: "#856116" },
] as const);

function mix(first: string, second: string, secondWeight: number): string {
  const channels = [1, 3, 5].map((offset) => {
    const firstChannel = Number.parseInt(first.slice(offset, offset + 2), 16);
    const secondChannel = Number.parseInt(second.slice(offset, offset + 2), 16);
    return Math.round(firstChannel * (1 - secondWeight) + secondChannel * secondWeight)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`.toUpperCase();
}

function readableInk(
  color: string,
  backgrounds: readonly string[],
  target: "#000000" | "#FFFFFF",
  minimum: number,
): string {
  for (let step = 0; step <= 100; step += 1) {
    const candidate = mix(color, target, step / 100);
    if (backgrounds.every((background) => colorContrastRatio(candidate, background) >= minimum)) {
      return candidate;
    }
  }
  return target;
}

/** New rooms opt in explicitly; stored themes without a mode keep their authored palette. */
export function workspaceThemeTokens(
  authored: ExperienceThemeTokens,
  brand: BrandTheme,
): ExperienceThemeTokens {
  if (!brand.colorMode) {
    return { ...authored, primary: brand.primaryColor, accent: brand.accentColor };
  }

  const dark = brand.colorMode === "dark";
  const canvas = dark
    ? mix("#090B11", brand.primaryColor, 0.22)
    : mix("#FFFFFF", brand.primaryColor, 0.06);
  const surface = dark
    ? mix("#151922", brand.primaryColor, 0.3)
    : mix("#FFFFFF", brand.primaryColor, 0.015);
  const surfaceStrong = dark
    ? mix("#202632", brand.accentColor, 0.28)
    : mix("#FFFFFF", brand.accentColor, 0.12);
  const backgrounds = [canvas, surface, surfaceStrong];
  const target = dark ? "#FFFFFF" : "#000000";

  return {
    ...authored,
    canvas,
    surface,
    surfaceStrong,
    text: readableInk(
      dark ? mix(brand.primaryColor, "#FFFFFF", 0.92) : brand.primaryColor,
      backgrounds,
      target,
      7,
    ),
    mutedText: readableInk(
      mix(brand.primaryColor, "#FFFFFF", dark ? 0.65 : 0.3),
      backgrounds,
      target,
      4.5,
    ),
    // Primary is also used for labels and focus rings, so it must read on every surface.
    primary: readableInk(
      dark ? mix(brand.primaryColor, "#FFFFFF", 0.8) : brand.primaryColor,
      backgrounds,
      target,
      4.5,
    ),
    primaryFill: brand.primaryColor,
    // Buttons keep the validated brand fill and their existing white labels.
    accent: brand.accentColor,
  };
}
