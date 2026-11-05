import type { PresentationReview } from "@openround/contracts";
export type PresentationStaticExportErrorCode =
  "EXPORT_LIMIT" | "EXPORT_INVALID" | "EXPORT_MEDIA_UNAVAILABLE" | "EXPORT_CANCELLED";
const messages: Record<PresentationStaticExportErrorCode, string> = {
  EXPORT_LIMIT:
    "This presentation exceeds the static export limits. Select fewer pages or use smaller images.",
  EXPORT_INVALID:
    "This presentation cannot be rendered safely. Check its content and supported characters.",
  EXPORT_MEDIA_UNAVAILABLE:
    "A clean image required by this presentation is unavailable or cannot be decoded.",
  EXPORT_CANCELLED: "The presentation export was cancelled or exceeded its time limit.",
};
export class PresentationStaticExportError extends Error {
  constructor(public readonly code: PresentationStaticExportErrorCode) {
    super(messages[code]);
    this.name = "PresentationStaticExportError";
  }
}
export interface PresentationStaticRenderInput {
  review: PresentationReview;
  images: Map<string, { bytes: Buffer; contentType: string }>;
  format: "pdf" | "png" | "html";
  blockId?: string;
  signal?: AbortSignal;
}
export interface PresentationStaticRenderResult {
  bytes: Buffer;
  contentType: string;
  extension: "pdf" | "png" | "html";
}
export const PRESENTATION_STATIC_RENDER_LIMITS = Object.freeze({
  pages: 100,
  width: 1280,
  height: 720,
  outputBytes: 40 * 1024 * 1024,
  images: 40,
  imageBytes: 10 * 1024 * 1024,
  imageTotalBytes: 40 * 1024 * 1024,
  imagePixels: 16_000_000,
  imageTotalPixels: 32_000_000,
  inputBytes: 4 * 1024 * 1024,
});
export const PRESENTATION_STATIC_DISCLOSURE =
  "Static export: activities, motion, results and controls are flattened. Authored frames may clip text. Choose accessible HTML for complete text and details.";
