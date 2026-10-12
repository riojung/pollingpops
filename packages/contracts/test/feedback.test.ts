import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FeedbackSubmissionSchema, FeedbackPageCursorSchema, feedbackPage } from "../src/index.js";
describe("privacy-safe product feedback", () => {
  it("strictly versions feedback pagination markers", () => {
    const cursor = { schemaVersion: 1, id: randomUUID(), createdAt: new Date().toISOString() };
    expect(FeedbackPageCursorSchema.parse(cursor)).toEqual(cursor);
    for (const invalid of [
      { ...cursor, schemaVersion: 2 },
      { ...cursor, createdAt: "yesterday" },
      { ...cursor, secret: "unsupported" },
    ])
      expect(FeedbackPageCursorSchema.safeParse(invalid).success).toBe(false);
  });
  it("removes credentials, queries, fragments, and object identifiers from page context", () => {
    expect(feedbackPage("/surveys/rooms/secret-room?token=private#alias")).toBe(
      "/surveys/rooms/:id",
    );
    expect(feedbackPage("/unknown-user-name/quiz/private-id")).toBe("/:id/quiz/:id");
    expect(feedbackPage("/library?email=secret@example.com")).toBe("/library");
  });
  it("validates bounded plain-text reports and defaults contact permission off", () => {
    const input = {
      idempotencyKey: randomUUID(),
      category: "bug",
      message: "  Search did not find my Survey.  ",
      page: "/library?token=secret",
    };
    expect(FeedbackSubmissionSchema.parse(input)).toMatchObject({
      page: "/library",
      message: "Search did not find my Survey.",
      allowContact: false,
    });
    for (const message of ["short", "x".repeat(4001), "Hidden\u202etext is invalid"])
      expect(FeedbackSubmissionSchema.safeParse({ ...input, message }).success).toBe(false);
    expect(FeedbackSubmissionSchema.safeParse({ ...input, logs: "private" }).success).toBe(false);
  });
});
