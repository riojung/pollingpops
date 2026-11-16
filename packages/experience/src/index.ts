import {
  ExperiencePresetSummarySchema,
  colorContrastRatio,
  type BrandTheme,
  type ExperiencePresetId,
  type ExperiencePresetSummary,
  type ExperienceThemeSnapshot,
  type RoundCategory,
} from "@openround/contracts";
import { workspaceThemeTokens } from "./workspace-themes";

export { workspaceThemePresets } from "./workspace-themes";

const presetDefinitions = [
  {
    preset: { id: "pops", version: 1 },
    name: "Candy Pop",
    description:
      "The Polling Pops signature: berry, cream, and mint with clear, calm interactions.",
    category: "general",
    motion: "calm",
    soundCue: "none",
    tokens: {
      canvas: "#FFF8EF",
      surface: "#FFFFFF",
      surfaceStrong: "#FCE0E8",
      text: "#39243C",
      mutedText: "#71596E",
      primary: "#39243C",
      accent: "#AC2855",
      choiceColors: ["#AC2855", "#146552", "#695018", "#395A96", "#73448D", "#914329"],
      pattern: "dots",
      typography: "playful",
      corners: "round",
    },
  },
  {
    preset: { id: "focus", version: 1 },
    name: "Focus",
    description: "A warm, calm canvas that keeps attention on the checkpoint.",
    category: "general",
    motion: "calm",
    soundCue: "none",
    tokens: {
      canvas: "#F7F4EC",
      surface: "#FFFFFF",
      surfaceStrong: "#DCEEEE",
      text: "#0B2239",
      mutedText: "#425B72",
      primary: "#075E63",
      accent: "#8A3D22",
      choiceColors: ["#075E63", "#7B3657", "#6D4B0C", "#345594", "#553D8A", "#23613F"],
      pattern: "dots",
      typography: "humanist",
      corners: "soft",
    },
  },
  {
    preset: { id: "campus", version: 1 },
    name: "Campus",
    description: "A friendly academic treatment with notebook rhythm and clear hierarchy.",
    category: "education",
    motion: "standard",
    soundCue: "subtle",
    tokens: {
      canvas: "#F4F1E8",
      surface: "#FFFEFA",
      surfaceStrong: "#DCE8F1",
      text: "#102A43",
      mutedText: "#486581",
      primary: "#165C7D",
      accent: "#8A3C55",
      choiceColors: ["#165C7D", "#8A3C55", "#6F4D13", "#3B568C", "#5C4488", "#2E6848"],
      pattern: "stripes",
      typography: "academic",
      corners: "soft",
    },
  },
  {
    preset: { id: "studio", version: 1 },
    name: "Studio",
    description: "A restrained workshop palette for professional facilitation and team learning.",
    category: "business",
    motion: "calm",
    soundCue: "subtle",
    tokens: {
      canvas: "#EEF2F3",
      surface: "#FFFFFF",
      surfaceStrong: "#D7E4E5",
      text: "#102D32",
      mutedText: "#49666B",
      primary: "#0B5B61",
      accent: "#8B3E2F",
      choiceColors: ["#0B5B61", "#7C3B58", "#6B4D13", "#36588E", "#60428A", "#2B6549"],
      pattern: "none",
      typography: "studio",
      corners: "compact",
    },
  },
  {
    preset: { id: "blueprint", version: 1 },
    name: "Blueprint",
    description: "A structured technical grid for STEM, systems, and engineering topics.",
    category: "technical",
    motion: "standard",
    soundCue: "subtle",
    tokens: {
      canvas: "#EAF3F7",
      surface: "#FFFFFF",
      surfaceStrong: "#CFE4ED",
      text: "#092A3A",
      mutedText: "#3F6170",
      primary: "#075A78",
      accent: "#7A3F77",
      choiceColors: ["#075A78", "#77405F", "#6C4C0A", "#315890", "#54428A", "#22634A"],
      pattern: "grid",
      typography: "technical",
      corners: "compact",
    },
  },
  {
    preset: { id: "signal", version: 1 },
    name: "Signal",
    description: "A high-contrast, low-motion treatment for safety and compliance contexts.",
    category: "safety_compliance",
    motion: "calm",
    soundCue: "none",
    tokens: {
      canvas: "#FFF8D8",
      surface: "#FFFFFF",
      surfaceStrong: "#F4E7A4",
      text: "#17202A",
      mutedText: "#3D4B57",
      primary: "#173F5F",
      accent: "#8A351E",
      choiceColors: ["#173F5F", "#77354D", "#694900", "#2F5688", "#563D80", "#255D3C"],
      pattern: "signals",
      typography: "signal",
      corners: "compact",
    },
  },
  {
    preset: { id: "spark", version: 1 },
    name: "Spark",
    description: "A bright, rounded experience for warm-ups, celebrations, and icebreakers.",
    category: "icebreaker",
    motion: "lively",
    soundCue: "celebration",
    tokens: {
      canvas: "#FFF1EB",
      surface: "#FFFFFF",
      surfaceStrong: "#F8DCD7",
      text: "#2D1836",
      mutedText: "#624E69",
      primary: "#6D3575",
      accent: "#9A3E28",
      choiceColors: ["#6D3575", "#8D3654", "#725000", "#355A96", "#57418E", "#286448"],
      pattern: "confetti",
      typography: "playful",
      corners: "round",
    },
  },
] as const satisfies readonly ExperiencePresetSummary[];

const categoryDefaults: Record<RoundCategory, ExperiencePresetId> = {
  general: "pops",
  education: "campus",
  business: "studio",
  technical: "blueprint",
  safety_compliance: "signal",
  icebreaker: "spark",
};

function validatePreset(preset: ExperiencePresetSummary) {
  const parsed = ExperiencePresetSummarySchema.parse(preset);
  const { tokens } = parsed;
  if (colorContrastRatio(tokens.text, tokens.canvas) < 4.5) {
    throw new Error(`${parsed.preset.id} text does not meet canvas contrast`);
  }
  if (colorContrastRatio(tokens.text, tokens.surface) < 4.5) {
    throw new Error(`${parsed.preset.id} text does not meet surface contrast`);
  }
  for (const choice of tokens.choiceColors) {
    if (colorContrastRatio(choice, "#FFFFFF") < 4.5) {
      throw new Error(`${parsed.preset.id} choice colour ${choice} does not support white text`);
    }
  }
  Object.freeze(parsed.tokens.choiceColors);
  Object.freeze(parsed.tokens);
  Object.freeze(parsed.preset);
  return Object.freeze(parsed);
}

export const experiencePresets = Object.freeze(presetDefinitions.map(validatePreset));

export function presetForCategory(category: RoundCategory): ExperiencePresetId {
  return categoryDefaults[category];
}

export function getExperiencePreset(id: ExperiencePresetId): ExperiencePresetSummary {
  const preset = experiencePresets.find((candidate) => candidate.preset.id === id);
  if (!preset) throw new Error(`Unsupported experience preset: ${id}`);
  return preset;
}

export function resolveExperienceTheme(input: {
  category: RoundCategory;
  presetId?: ExperiencePresetId;
  soundEnabled?: boolean;
  brandTheme?: BrandTheme | null;
}): ExperienceThemeSnapshot {
  const preset = getExperiencePreset(input.presetId ?? presetForCategory(input.category));
  return {
    preset: preset.preset,
    name: preset.name,
    category: input.category,
    motion: preset.motion,
    soundCue: preset.soundCue,
    soundEnabled: Boolean(input.soundEnabled && preset.soundCue !== "none"),
    tokens: input.brandTheme
      ? workspaceThemeTokens(preset.tokens, input.brandTheme)
      : preset.tokens,
  };
}
