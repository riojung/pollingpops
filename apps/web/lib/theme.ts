import type { BrandTheme, ExperienceThemeSnapshot } from "@openround/contracts";
import type { CSSProperties } from "react";

type ThemeProperties = CSSProperties & {
  "--brand-primary"?: string;
  "--brand-accent"?: string;
  "--experience-canvas"?: string;
  "--experience-surface"?: string;
  "--experience-surface-strong"?: string;
  "--experience-text"?: string;
  "--experience-muted"?: string;
  "--experience-primary"?: string;
  "--experience-primary-fill"?: string;
  "--experience-accent"?: string;
  "--choice-1"?: string;
  "--choice-2"?: string;
  "--choice-3"?: string;
  "--choice-4"?: string;
  "--choice-5"?: string;
  "--choice-6"?: string;
};

export function liveThemeStyle(theme: BrandTheme | null | undefined): ThemeProperties | undefined {
  return theme
    ? {
        "--brand-primary": theme.primaryColor,
        "--brand-accent": theme.accentColor,
      }
    : undefined;
}

export function experienceThemeStyle(
  theme: ExperienceThemeSnapshot | null | undefined,
): ThemeProperties | undefined {
  if (!theme) return undefined;
  return {
    "--experience-canvas": theme.tokens.canvas,
    "--experience-surface": theme.tokens.surface,
    "--experience-surface-strong": theme.tokens.surfaceStrong,
    "--experience-text": theme.tokens.text,
    "--experience-muted": theme.tokens.mutedText,
    "--experience-primary": theme.tokens.primary,
    "--experience-primary-fill": theme.tokens.primaryFill ?? theme.tokens.primary,
    "--experience-accent": theme.tokens.accent,
    "--choice-1": theme.tokens.choiceColors[0],
    "--choice-2": theme.tokens.choiceColors[1],
    "--choice-3": theme.tokens.choiceColors[2],
    "--choice-4": theme.tokens.choiceColors[3],
    "--choice-5": theme.tokens.choiceColors[4],
    "--choice-6": theme.tokens.choiceColors[5],
  };
}
