import { z } from "zod";
export const PRESENTATION_STATIC_EXPORT_LIMITS = {
  maxPages: 100,
  width: 1280,
  height: 720,
  maxImages: 40,
  maxImageBytes: 10 * 1024 * 1024,
  maxImageTotalBytes: 40 * 1024 * 1024,
  maxOutputBytes: 40 * 1024 * 1024,
} as const;
export const PresentationStaticExportFormatSchema = z.enum(["pdf", "png", "html"]);
export type PresentationStaticExportFormat = z.infer<typeof PresentationStaticExportFormatSchema>;
export const PresentationStaticExportRequestSchema = z
  .object({
    versionId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    format: PresentationStaticExportFormatSchema,
    blockId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase())
      .optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.format === "png" && !input.blockId)
      ctx.addIssue({
        code: "custom",
        path: ["blockId"],
        message: "Choose a published page for PNG export",
      });
    if (input.format !== "png" && input.blockId !== undefined)
      ctx.addIssue({
        code: "custom",
        path: ["blockId"],
        message: "PDF and HTML export the complete published deck",
      });
  });
export type PresentationStaticExportRequest = z.infer<typeof PresentationStaticExportRequestSchema>;
export const PresentationStaticExportSourceSchema = z
  .object({
    versionId: z.string().uuid(),
    version: z.number().int().positive(),
    title: z.string().max(160),
    pages: z
      .array(z.object({ blockId: z.string().uuid(), title: z.string().max(160) }).strict())
      .min(1)
      .max(200),
  })
  .strict();
export type PresentationStaticExportSource = z.infer<typeof PresentationStaticExportSourceSchema>;
export const PresentationStaticExportErrorCodeSchema = z.enum([
  "EXPORT_INVALID",
  "EXPORT_LIMIT",
  "EXPORT_MEDIA_UNAVAILABLE",
  "EXPORT_CANCELLED",
  "EXPORT_UNAVAILABLE",
  "EXPORT_FORBIDDEN",
  "EXPORT_BUSY",
  "EXPORT_RATE_LIMITED",
]);
export type PresentationStaticExportErrorCode = z.infer<
  typeof PresentationStaticExportErrorCodeSchema
>;
export const PresentationStaticExportFailureSchema = z
  .object({
    error: z
      .object({ code: PresentationStaticExportErrorCodeSchema, message: z.string().max(300) })
      .strict(),
  })
  .strict();
