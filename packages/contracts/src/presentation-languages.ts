import { z } from "zod";

/** Canonical horizontal-writing languages supported by the bounded translation workflow. */
export const PresentationTextLanguageSchema = z.enum([
  "en",
  "fr",
  "es",
  "de",
  "it",
  "pt",
  "nl",
  "pl",
  "ja",
  "ko",
  "zh-Hans",
  "zh-Hant",
]);
export type PresentationTextLanguage = z.infer<typeof PresentationTextLanguageSchema>;
export const PRESENTATION_TEXT_LANGUAGE_LABELS = {
  en: "English",
  fr: "French",
  es: "Spanish",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ja: "Japanese",
  ko: "Korean",
  "zh-Hans": "Chinese (Simplified)",
  "zh-Hant": "Chinese (Traditional)",
} as const satisfies Record<PresentationTextLanguage, string>;
export const PRESENTATION_TEXT_LANGUAGES: ReadonlyArray<{
  readonly code: PresentationTextLanguage;
  readonly label: string;
}> = PresentationTextLanguageSchema.options.map((code) => ({
  code,
  label: PRESENTATION_TEXT_LANGUAGE_LABELS[code],
}));
export function presentationTextLanguageLabel(code: PresentationTextLanguage): string {
  return PRESENTATION_TEXT_LANGUAGE_LABELS[code];
}
