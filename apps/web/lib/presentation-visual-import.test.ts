import { describe, expect, it } from "vitest";
import {
  defaultVisualImportLimits,
  moveVisualPage,
  RetainedVisualImportRequest,
  visualImportDefinitivelyRejected,
  visualImportFileError,
  visualReviewComplete,
} from "./presentation-visual-import";

const image = { name: "slide.png", type: "image/png", size: 100 };
describe("Presentation visual import review", () => {
  it("checks PDF/image-set boundaries before reading or posting files", () => {
    expect(visualImportFileError([image])).toBeNull();
    expect(
      visualImportFileError([{ ...image, type: "application/pdf", size: 6_000_000 }]),
    ).toBeNull();
    expect(
      visualImportFileError([{ ...image, type: "application/pdf", size: 6_000_001 }]),
    ).toContain("6 MB");
    expect(visualImportFileError([image, { ...image, type: "application/pdf" }])).toContain(
      "separately",
    );
    expect(visualImportFileError(Array.from({ length: 41 }, () => image))).toContain("40");
    expect(visualImportFileError([{ ...image, size: 0 }])).toContain("contain data");
    expect(visualImportFileError([{ ...image, size: 10_485_761 }])).toContain("10 MiB");
    expect(
      visualImportFileError(Array.from({ length: 3 }, () => ({ ...image, size: 7_000_000 }))),
    ).toContain("20 MB");
    expect(visualImportFileError([{ ...image, type: "image/svg+xml" }])).toContain("Export");
    expect(defaultVisualImportLimits.maxImageSetBytes).toBe(20_000_000);
  });
  it("reorders the selected pages without changing page identity or the original order", () => {
    const original = [3, 1, 2];
    expect(moveVisualPage(original, 1, -1)).toEqual([1, 3, 2]);
    expect(moveVisualPage(original, 2, 1)).toBe(original);
    expect(moveVisualPage(original, 9, -1)).toBe(original);
    expect(original).toEqual([3, 1, 2]);
  });
  it("requires an author-reviewed reading version separately from short image alt", () => {
    const review = {
      title: "Page",
      alternativeText: "Chart",
      accessibleText: "Values and conclusion.",
      readingOrderReviewed: true,
    };
    expect(visualReviewComplete(review)).toBe(true);
    expect(visualReviewComplete({ ...review, accessibleText: " " })).toBe(false);
    expect(visualReviewComplete({ ...review, readingOrderReviewed: false })).toBe(false);
    expect(visualReviewComplete({ ...review, alternativeText: "a".repeat(301) })).toBe(false);
    expect(visualReviewComplete({ ...review, accessibleText: "a".repeat(3001) })).toBe(false);
    expect(visualReviewComplete({ ...review, title: "a".repeat(161) })).toBe(false);
  });
  it("retains exactly the same upload and insertion bytes even when a newer form/anchor is supplied", () => {
    const pending = new RetainedVisualImportRequest();
    const first = {
      mutationId: "one",
      expectedRevision: 4,
      afterBlockId: "original",
      pages: [{ pageNumber: 3 }],
    };
    const body = pending.retain(first);
    first.pages[0]!.pageNumber = 1;
    expect(pending.retain({ mutationId: "two", afterBlockId: "changed" })).toBe(body);
    const restored = new RetainedVisualImportRequest();
    restored.restore(body);
    expect(restored.body).toBe(body);
    expect(JSON.parse(body).pages).toEqual([{ pageNumber: 3 }]);
    pending.clear();
    expect(pending.retain({ mutationId: "two" })).not.toBe(body);
  });
  it("keeps uncertain/timeout/rate-limited requests and releases only definite client rejection", () => {
    for (const error of [
      new Error("lost acknowledgement"),
      { status: 500 },
      { status: 401 },
      { status: 403 },
      { status: 408 },
      { status: 429 },
    ])
      expect(visualImportDefinitivelyRejected(error)).toBe(false);
    expect(visualImportDefinitivelyRejected({ status: 409 })).toBe(true);
    expect(visualImportDefinitivelyRejected({ status: 422 })).toBe(true);
  });
});
