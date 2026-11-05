import { z } from "zod";

export const PRESENTATION_VISUAL_IMPORT_MAX_FILES = 40;
export const PRESENTATION_VISUAL_IMPORT_MAX_PAGES = 40;
export const PRESENTATION_VISUAL_IMPORT_MAX_PDF_BYTES = 6_000_000;
export const PRESENTATION_VISUAL_IMPORT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const PRESENTATION_VISUAL_IMPORT_MAX_TOTAL_BYTES = 20_000_000;
export const PRESENTATION_VISUAL_IMPORT_RETENTION_MS = 24 * 60 * 60_000;
export const PRESENTATION_VISUAL_IMPORT_MAX_ACTIVE_JOBS = 3;
export const PRESENTATION_VISUAL_IMPORT_MAX_DAILY_JOBS = 10;

export const PresentationVisualImportMimeTypeSchema = z.enum([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export const PresentationVisualImportFileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => value.length <= 200, "Text exceeds its UTF-16 character limit"),
    mimeType: PresentationVisualImportMimeTypeSchema,
    base64: z
      .string()
      .min(4)
      .max(Math.ceil(PRESENTATION_VISUAL_IMPORT_MAX_IMAGE_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .refine((value) => value.length % 4 === 0, "Invalid base64 source"),
  })
  .strict();
export const CreatePresentationVisualImportSchema = z
  .object({
    requestId: z.string().uuid(),
    files: z
      .array(PresentationVisualImportFileSchema)
      .min(1)
      .max(PRESENTATION_VISUAL_IMPORT_MAX_FILES),
    retainOriginal: z.literal(false).default(false),
  })
  .strict()
  .superRefine((input, ctx) => {
    let total = 0;
    for (const [index, file] of input.files.entries()) {
      const size =
        (file.base64.length / 4) * 3 -
        (file.base64.endsWith("==") ? 2 : file.base64.endsWith("=") ? 1 : 0);
      total += size;
      if (
        size < 1 ||
        size >
          (file.mimeType === "application/pdf"
            ? PRESENTATION_VISUAL_IMPORT_MAX_PDF_BYTES
            : PRESENTATION_VISUAL_IMPORT_MAX_IMAGE_BYTES)
      )
        ctx.addIssue({
          code: "custom",
          message: "The source exceeds its file-size limit",
          path: ["files", index, "base64"],
        });
    }
    if (total > PRESENTATION_VISUAL_IMPORT_MAX_TOTAL_BYTES)
      ctx.addIssue({
        code: "custom",
        message: "Visual import sources must total 20 MB or less",
        path: ["files"],
      });
    if (input.files.some((file) => file.mimeType === "application/pdf") && input.files.length !== 1)
      ctx.addIssue({
        code: "custom",
        message: "Import one PDF or a set of images",
        path: ["files"],
      });
  });
export type CreatePresentationVisualImport = z.infer<typeof CreatePresentationVisualImportSchema>;

export const PresentationVisualImportPageSchema = z
  .object({
    pageNumber: z.number().int().min(1).max(PRESENTATION_VISUAL_IMPORT_MAX_PAGES),
    mediaId: z.string().uuid(),
    width: z.number().int().min(1).max(1600),
    height: z.number().int().min(1).max(1600),
    extractedText: z
      .string()
      .max(6000)
      .refine((value) => value.length <= 6000, "Text exceeds its UTF-16 character limit"),
    warnings: z
      .array(
        z
          .string()
          .min(1)
          .max(300)
          .refine((value) => value.length <= 300, "Text exceeds its UTF-16 character limit"),
      )
      .max(10),
  })
  .strict()
  .refine(
    (page) => page.width * page.height <= 2_000_000,
    "Converted pages must fit the pixel budget",
  );
export type PresentationVisualImportPage = z.infer<typeof PresentationVisualImportPageSchema>;
export const PresentationVisualImportJobSchema = z
  .object({
    id: z.string().uuid(),
    presentationId: z.string().uuid(),
    status: z.enum(["pending", "processing", "ready", "failed", "canceled"]),
    attempts: z.number().int().nonnegative(),
    sourceType: z.enum(["pdf", "image_set"]),
    sourceName: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value.length <= 200, "Text exceeds its UTF-16 character limit"),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    fileCount: z.number().int().min(1).max(40),
    pageCount: z.number().int().min(0).max(40),
    pages: z.array(PresentationVisualImportPageSchema).max(40),
    warnings: z
      .array(
        z
          .string()
          .min(1)
          .max(300)
          .refine((value) => value.length <= 300, "Text exceeds its UTF-16 character limit"),
      )
      .max(40),
    error: z
      .object({
        code: z
          .string()
          .min(1)
          .max(80)
          .refine((value) => value.length <= 80, "Text exceeds its UTF-16 character limit"),
        message: z
          .string()
          .min(1)
          .max(300)
          .refine((value) => value.length <= 300, "Text exceeds its UTF-16 character limit"),
      })
      .strict()
      .nullable(),
    retainOriginal: z.literal(false),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict()
  .superRefine((job, ctx) => {
    if (
      job.pageCount !== job.pages.length ||
      new Set(job.pages.map((page) => page.pageNumber)).size !== job.pages.length ||
      new Set(job.pages.map((page) => page.mediaId.toLowerCase())).size !== job.pages.length ||
      (job.status !== "ready" && job.pages.length > 0) ||
      (job.status === "ready" && !job.pages.length) ||
      job.pages.reduce((total, page) => total + page.width * page.height, 0) > 60_000_000
    )
      ctx.addIssue({
        code: "custom",
        message: "Visual import pages must match a ready conversion",
        path: ["pages"],
      });
  });
export type PresentationVisualImportJob = z.infer<typeof PresentationVisualImportJobSchema>;

export const InsertPresentationVisualImportSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    mutationId: z.string().uuid(),
    afterBlockId: z.string().uuid().nullable().default(null),
    fidelityAccepted: z.literal(true),
    pages: z
      .array(
        z
          .object({
            pageNumber: z.number().int().min(1).max(40),
            title: z
              .string()
              .trim()
              .min(1)
              .max(160)
              .refine((value) => value.length <= 160, "Text exceeds its UTF-16 character limit"),
            alternativeText: z
              .string()
              .trim()
              .min(1)
              .max(300)
              .refine((value) => value.length <= 300, "Text exceeds its UTF-16 character limit"),
            accessibleText: z
              .string()
              .trim()
              .min(1)
              .max(3000)
              .refine((value) => value.length <= 3000, "Text exceeds its UTF-16 character limit"),
            readingOrderReviewed: z.literal(true),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict()
  .refine(
    (input) => new Set(input.pages.map((page) => page.pageNumber)).size === input.pages.length,
    "Select each converted page once",
  );
export type InsertPresentationVisualImport = z.infer<typeof InsertPresentationVisualImportSchema>;
