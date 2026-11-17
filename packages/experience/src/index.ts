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
  {
    preset: { id: "observatory", version: 1 },
    name: "Observatory",
    description: "A deep indigo canvas for scientific discovery, evidence, and big questions.",
    category: "science",
    motion: "standard",
    soundCue: "subtle",
    tokens: {
      canvas: "#11192E",
      surface: "#1B2540",
      surfaceStrong: "#2A3756",
      text: "#F1F4FF",
      mutedText: "#BECBE4",
      primary: "#AFCFFF",
      primaryFill: "#234D86",
      accent: "#234D86",
      choiceColors: ["#234D86", "#493D83", "#176459", "#7A4337", "#77354D", "#425674"],
      pattern: "grid",
      typography: "technical",
      corners: "compact",
    },
  },
  {
    preset: { id: "breath", version: 1 },
    name: "Breath",
    description: "A soft sage and linen palette for reflective wellbeing conversations.",
    category: "health_wellbeing",
    motion: "calm",
    soundCue: "none",
    tokens: {
      canvas: "#F2F6EF",
      surface: "#FFFFFF",
      surfaceStrong: "#DDE9DB",
      text: "#233D32",
      mutedText: "#4F6558",
      primary: "#315E47",
      accent: "#79512D",
      choiceColors: ["#315E47", "#735164", "#77521C", "#3C5D77", "#61517F", "#7B4D3A"],
      pattern: "none",
      typography: "humanist",
      corners: "round",
    },
  },
  {
    preset: { id: "gallery", version: 1 },
    name: "Gallery",
    description: "A warm paper and plum palette for creative practice, arts, and culture.",
    category: "arts_culture",
    motion: "standard",
    soundCue: "subtle",
    tokens: {
      canvas: "#FAF2E8",
      surface: "#FFFDFA",
      surfaceStrong: "#EDDDD4",
      text: "#412639",
      mutedText: "#765466",
      primary: "#763C65",
      accent: "#9B4228",
      choiceColors: ["#763C65", "#246257", "#9B4228", "#3D5283", "#873D4A", "#5D5B26"],
      pattern: "stripes",
      typography: "academic",
      corners: "soft",
    },
  },
  {
    preset: { id: "summit", version: 1 },
    name: "Summit",
    description: "A dark slate and ice palette for strategy, leadership, and clear decisions.",
    category: "leadership",
    motion: "calm",
    soundCue: "subtle",
    tokens: {
      canvas: "#14252C",
      surface: "#1D333D",
      surfaceStrong: "#294650",
      text: "#EFF8FA",
      mutedText: "#BAD1D8",
      primary: "#A5DDE7",
      primaryFill: "#215967",
      accent: "#215967",
      choiceColors: ["#215967", "#425674", "#684278", "#76511B", "#2F5688", "#315E47"],
      pattern: "none",
      typography: "studio",
      corners: "compact",
    },
  },
  {
    preset: { id: "grove", version: 1 },
    name: "Grove",
    description: "A natural green and sand palette for sustainability and shared futures.",
    category: "sustainability",
    motion: "calm",
    soundCue: "none",
    tokens: {
      canvas: "#F3F4E8",
      surface: "#FFFFF9",
      surfaceStrong: "#E1E8CC",
      text: "#293D20",
      mutedText: "#536344",
      primary: "#426124",
      accent: "#86521E",
      choiceColors: ["#426124", "#86521E", "#315C69", "#794052", "#5D4B8B", "#506036"],
      pattern: "dots",
      typography: "humanist",
      corners: "soft",
    },
  },
  {
    preset: { id: "commons", version: 1 },
    name: "Commons",
    description: "A welcoming terracotta and cream palette for community conversations.",
    category: "community",
    motion: "standard",
    soundCue: "subtle",
    tokens: {
      canvas: "#FFF4EA",
      surface: "#FFFDFA",
      surfaceStrong: "#F1DFCE",
      text: "#4C2F26",
      mutedText: "#79584A",
      primary: "#93482D",
      accent: "#5D4B8B",
      choiceColors: ["#93482D", "#5D4B8B", "#2E6259", "#79551F", "#35567D", "#793B53"],
      pattern: "confetti",
      typography: "playful",
      corners: "round",
    },
  },
  {
    preset: { id: "midnight", version: 1 },
    name: "Midnight",
    description:
      "A quiet charcoal and lavender palette for evening sessions and focused discussion.",
    category: "general",
    motion: "calm",
    soundCue: "none",
    tokens: {
      canvas: "#1D1B29",
      surface: "#292638",
      surfaceStrong: "#39334A",
      text: "#F6F1FF",
      mutedText: "#D0C4DF",
      primary: "#D6BFFF",
      primaryFill: "#64498A",
      accent: "#64498A",
      choiceColors: ["#64498A", "#355C7D", "#7C405D", "#286153", "#70531D", "#775044"],
      pattern: "dots",
      typography: "humanist",
      corners: "soft",
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
  science: "observatory",
  health_wellbeing: "breath",
  arts_culture: "gallery",
  leadership: "summit",
  sustainability: "grove",
  community: "commons",
};

function validatePreset(preset: ExperiencePresetSummary) {
  const parsed = ExperiencePresetSummarySchema.parse(preset);
  const { tokens } = parsed;
  for (const background of [tokens.canvas, tokens.surface, tokens.surfaceStrong]) {
    for (const foreground of [tokens.text, tokens.mutedText, tokens.primary]) {
      if (colorContrastRatio(foreground, background) < 4.5) {
        throw new Error(
          `${parsed.preset.id} foreground ${foreground} does not meet surface contrast`,
        );
      }
    }
  }
  for (const fill of [tokens.primaryFill ?? tokens.primary, tokens.accent]) {
    if (colorContrastRatio(fill, "#FFFFFF") < 4.5) {
      throw new Error(`${parsed.preset.id} button fill ${fill} does not support white text`);
    }
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
