import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PresentationReadingReportSchema } from "../src/index.js";

function report() {
  return {
    schemaVersion: 1,
    assignment: {
      id: randomUUID(),
      mode: "reading",
      versionId: randomUUID(),
      createdAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      revokedAt: null,
    },
    generatedAt: new Date().toISOString(),
    minimumAttempts: 5,
    startedAttempts: 10,
    completedAttempts: 5,
    inProgressAttempts: 5,
    pages: [
      { blockId: randomUUID(), pageNumber: 1, readAttempts: 10 },
      { blockId: randomUUID(), pageNumber: 2, readAttempts: 5 },
    ],
  };
}
describe("Reading insight contracts", () => {
  it("accepts counts-only frozen page coverage and suppresses small total samples", () => {
    const value = report();
    expect(PresentationReadingReportSchema.safeParse(value).success).toBe(true);
    const suppressed = {
      ...value,
      startedAttempts: null,
      completedAttempts: null,
      inProgressAttempts: null,
      pages: value.pages.map((page) => ({ ...page, readAttempts: null })),
    };
    expect(PresentationReadingReportSchema.safeParse(suppressed).success).toBe(true);
    expect(
      PresentationReadingReportSchema.safeParse({ ...suppressed, completedAttempts: 0 }).success,
    ).toBe(false);
    for (const privateField of [
      "attempts",
      "tokenHash",
      "readRevisions",
      "speakerNotes",
      "answers",
    ])
      expect(
        PresentationReadingReportSchema.safeParse({ ...value, [privateField]: [] }).success,
      ).toBe(false);
  });
  it("rejects direct and complementary small cells and inconsistent denominators", () => {
    const value = report();
    for (const changed of [
      { startedAttempts: 4 },
      { completedAttempts: 1, inProgressAttempts: 9 },
      { completedAttempts: null },
      { completedAttempts: 5, inProgressAttempts: 6 },
      { pages: [{ ...value.pages[0], readAttempts: 9 }] },
      { pages: [{ ...value.pages[0], readAttempts: 11 }] },
      { pages: [{ ...value.pages[0], readAttempts: 0 }] },
    ])
      expect(PresentationReadingReportSchema.safeParse({ ...value, ...changed }).success).toBe(
        false,
      );
    expect(
      PresentationReadingReportSchema.safeParse({
        ...value,
        completedAttempts: 10,
        inProgressAttempts: 0,
        pages: value.pages.map((page) => ({ ...page, readAttempts: 10 })),
      }).success,
    ).toBe(true);
  });
  it("requires bounded unique frozen reading order and rejects nested private fields", () => {
    const value = report();
    for (const pages of [
      [],
      [value.pages[0], { ...value.pages[0], pageNumber: 2 }],
      [{ ...value.pages[0], pageNumber: 2 }],
      [{ ...value.pages[0], attemptIds: [randomUUID()] }],
    ])
      expect(PresentationReadingReportSchema.safeParse({ ...value, pages }).success).toBe(false);
  });
  it("prevents revealing small in-progress page groups by subtracting completed attempts", () => {
    const value = report();
    expect(
      PresentationReadingReportSchema.safeParse({
        ...value,
        startedAttempts: 15,
        inProgressAttempts: 10,
        pages: [{ ...value.pages[0], readAttempts: 6 }],
      }).success,
    ).toBe(false);
    expect(
      PresentationReadingReportSchema.safeParse({
        ...value,
        startedAttempts: 15,
        inProgressAttempts: 10,
        pages: [{ ...value.pages[0], readAttempts: null }],
      }).success,
    ).toBe(true);
  });
});
