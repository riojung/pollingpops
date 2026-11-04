import { z } from "zod";

export const PRESENTATION_RICH_TEXT_MAX_PARAGRAPHS = 100;
export const PRESENTATION_RICH_TEXT_MAX_RUNS_PER_PARAGRAPH = 100;
export const PRESENTATION_RICH_TEXT_MAX_RUNS = 500;
export const PRESENTATION_RICH_TEXT_MAX_CHARACTERS = 4_000;

/** External links are explicit absolute web URLs, never HTML, credentials or executable schemes. */
export function isSafePresentationLink(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || /[\s\\\p{Cc}]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

const runText = z
  .string()
  .max(PRESENTATION_RICH_TEXT_MAX_CHARACTERS)
  .refine(
    (value) =>
      !Array.from(value).some((character) => {
        const code = character.codePointAt(0)!;
        return code === 127 || (code < 32 && code !== 9);
      }),
    { message: "Use text without line breaks or control characters inside a run" },
  );

export const PresentationRichTextRunSchema = z
  .object({
    text: runText,
    bold: z.literal(true).optional(),
    italic: z.literal(true).optional(),
    href: z
      .string()
      .max(2_048)
      .refine(isSafePresentationLink, {
        message: "Use an absolute HTTP or HTTPS link without credentials or whitespace",
      })
      .optional(),
  })
  .strict();
export type PresentationRichTextRun = z.infer<typeof PresentationRichTextRunSchema>;

export const PresentationRichTextParagraphSchema = z
  .object({
    kind: z.enum(["paragraph", "bullet", "numbered"]),
    runs: z
      .array(PresentationRichTextRunSchema)
      .min(1)
      .max(PRESENTATION_RICH_TEXT_MAX_RUNS_PER_PARAGRAPH),
  })
  .strict();
export type PresentationRichTextParagraph = z.infer<typeof PresentationRichTextParagraphSchema>;

export const PresentationRichTextSchema = z
  .object({
    paragraphs: z
      .array(PresentationRichTextParagraphSchema)
      .min(1)
      .max(PRESENTATION_RICH_TEXT_MAX_PARAGRAPHS),
  })
  .strict()
  .superRefine((richText, context) => {
    if (
      richText.paragraphs.reduce((total, paragraph) => total + paragraph.runs.length, 0) >
      PRESENTATION_RICH_TEXT_MAX_RUNS
    ) {
      context.addIssue({ code: "custom", message: "Use at most 500 text runs per object" });
    }
    if (presentationRichTextToPlainText(richText).length > PRESENTATION_RICH_TEXT_MAX_CHARACTERS) {
      context.addIssue({ code: "custom", message: "Use at most 4,000 text characters per object" });
    }
  });
export type PresentationRichText = z.infer<typeof PresentationRichTextSchema>;

/** The exact fallback used by titles, reports and plain-text editing. List markers are semantic. */
export function presentationRichTextToPlainText(richText: PresentationRichText): string {
  return richText.paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
    .join("\n");
}

/** Explicit authoring conversion only; readers never normalize historical plain text. */
export function plainTextToPresentationRichText(text: string): PresentationRichText {
  return PresentationRichTextSchema.parse({
    paragraphs: text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => ({
        kind: "paragraph",
        runs: [{ text: line }],
      })),
  });
}
