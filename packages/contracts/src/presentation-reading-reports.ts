import { z } from "zod";
import {
  PresentationAssignmentMetadataSchema,
  PRESENTATION_READING_MAX_ATTEMPTS,
  PRESENTATION_READING_MAX_BLOCKS,
} from "./presentation-assignments";

export const PRESENTATION_READING_REPORT_MINIMUM = 5;
const count = z.number().int().min(0).max(PRESENTATION_READING_MAX_ATTEMPTS);
const visibleCount = count.refine(
  (value) => value === 0 || value >= PRESENTATION_READING_REPORT_MINIMUM,
);
export const PresentationReadingReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    assignment: PresentationAssignmentMetadataSchema,
    generatedAt: z.string().datetime(),
    minimumAttempts: z.literal(PRESENTATION_READING_REPORT_MINIMUM),
    startedAttempts: count.min(PRESENTATION_READING_REPORT_MINIMUM).nullable(),
    completedAttempts: visibleCount.nullable(),
    inProgressAttempts: visibleCount.nullable(),
    pages: z
      .array(
        z
          .object({
            blockId: z.string().uuid(),
            pageNumber: z.number().int().min(1).max(PRESENTATION_READING_MAX_BLOCKS),
            readAttempts: visibleCount.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(PRESENTATION_READING_MAX_BLOCKS),
  })
  .strict()
  .superRefine((value, ctx) => {
    const reject = (message: string) => ctx.addIssue({ code: "custom", message });
    if (
      new Set(value.pages.map((page) => page.blockId.toLowerCase())).size !== value.pages.length ||
      value.pages.some((page, index) => page.pageNumber !== index + 1)
    )
      reject("Reading report pages must be unique and in frozen reading order");
    if (value.startedAttempts === null) {
      if (
        value.completedAttempts !== null ||
        value.inProgressAttempts !== null ||
        value.pages.some((page) => page.readAttempts !== null)
      )
        reject("Small attempt samples must suppress all counts");
      return;
    }
    if ((value.completedAttempts === null) !== (value.inProgressAttempts === null))
      reject("Complementary completion counts must be suppressed together");
    if (
      value.completedAttempts !== null &&
      value.inProgressAttempts !== null &&
      value.completedAttempts + value.inProgressAttempts !== value.startedAttempts
    )
      reject("Completion counts must partition started attempts");
    for (const page of value.pages) {
      if (page.readAttempts === null) continue;
      const unread = value.startedAttempts - page.readAttempts;
      if (unread < 0 || (unread !== 0 && unread < PRESENTATION_READING_REPORT_MINIMUM))
        reject("Page coverage must also suppress small complementary groups");
      if (value.completedAttempts !== null && page.readAttempts < value.completedAttempts)
        reject("Every completed attempt must acknowledge every page");
      if (value.completedAttempts !== null) {
        const inProgressRead = page.readAttempts - value.completedAttempts;
        if (inProgressRead > 0 && inProgressRead < PRESENTATION_READING_REPORT_MINIMUM)
          reject("Page coverage must suppress small groups after excluding completed attempts");
      }
    }
  });
export type PresentationReadingReport = z.infer<typeof PresentationReadingReportSchema>;
