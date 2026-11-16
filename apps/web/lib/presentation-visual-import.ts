import {
  PRESENTATION_VISUAL_IMPORT_MAX_PDF_BYTES,
  PRESENTATION_VISUAL_IMPORT_MAX_IMAGE_BYTES,
  PRESENTATION_VISUAL_IMPORT_MAX_TOTAL_BYTES,
  PRESENTATION_VISUAL_IMPORT_MAX_PAGES,
} from "@openround/contracts";

export interface VisualImportLimits {
  maxPdfBytes: number;
  maxImageBytes: number;
  maxImageSetBytes: number;
  maxPages: number;
}

export const defaultVisualImportLimits: VisualImportLimits = {
  maxPdfBytes: PRESENTATION_VISUAL_IMPORT_MAX_PDF_BYTES,
  maxImageBytes: PRESENTATION_VISUAL_IMPORT_MAX_IMAGE_BYTES,
  maxImageSetBytes: PRESENTATION_VISUAL_IMPORT_MAX_TOTAL_BYTES,
  maxPages: PRESENTATION_VISUAL_IMPORT_MAX_PAGES,
};

export interface VisualPageReview {
  title: string;
  alternativeText: string;
  accessibleText: string;
  readingOrderReviewed: boolean;
}

export function visualImportFileError(
  files: ReadonlyArray<Pick<File, "name" | "type" | "size">>,
  limits = defaultVisualImportLimits,
): string | null {
  if (!files.length) return "Choose one PDF or a set of images.";
  const pdf = files.some((file) => file.type === "application/pdf");
  if (pdf) {
    if (files.length !== 1) return "Import one PDF at a time, separately from images.";
    if (!files[0]!.size || files[0]!.size > limits.maxPdfBytes)
      return `Choose a PDF no larger than ${limits.maxPdfBytes / 1_000_000} MB.`;
    return null;
  }
  if (files.length > limits.maxPages) return `Choose at most ${limits.maxPages} images.`;
  if (files.some((file) => !["image/png", "image/jpeg", "image/webp"].includes(file.type)))
    return "Choose a PDF, PNG, JPEG or WebP file. Export other slide formats as PDF first.";
  if (files.some((file) => !file.size || file.size > limits.maxImageBytes))
    return "Each image must contain data and be no larger than 10 MiB.";
  if (files.reduce((total, file) => total + file.size, 0) > limits.maxImageSetBytes)
    return `Keep the image set within ${limits.maxImageSetBytes / 1_000_000} MB, or import smaller batches.`;
  return null;
}

export function moveVisualPage(order: number[], pageNumber: number, direction: -1 | 1) {
  const index = order.indexOf(pageNumber);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= order.length) return order;
  const result = [...order];
  [result[index], result[next]] = [result[next]!, result[index]!];
  return result;
}

export function visualReviewComplete(review: VisualPageReview | undefined) {
  return Boolean(
    review &&
    review.title.trim() &&
    review.title.length <= 160 &&
    review.alternativeText.trim() &&
    review.alternativeText.length <= 300 &&
    review.accessibleText.trim() &&
    review.accessibleText.length <= 3_000 &&
    review.readingOrderReviewed,
  );
}

/** Keep serialized bytes, not a mutable form object, until the server receipt is known. */
export class RetainedVisualImportRequest {
  private value: string | null = null;
  get body() {
    return this.value;
  }
  retain(request: unknown) {
    this.value ??= JSON.stringify(request);
    return this.value;
  }
  restore(body: string) {
    JSON.parse(body);
    this.value = body;
  }
  clear() {
    this.value = null;
  }
}

export function visualImportDefinitivelyRejected(error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  return (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 403 &&
    status !== 408 &&
    status !== 429
  );
}
