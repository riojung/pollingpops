import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BoardInvitationBatchResponseSchema,
  CanvasBoardInvitationBatchSchema,
  IdeaBoardInvitationBatchSchema,
} from "../src/board-invitations.js";

describe("board email invitation contracts", () => {
  it("normalizes and freezes one canonical deduplicated recipient order", () => {
    expect(
      IdeaBoardInvitationBatchSchema.parse({
        operationId: randomUUID(),
        emails: [" B@example.test ", "a@example.test", "b@EXAMPLE.test"],
      }).emails,
    ).toEqual(["a@example.test", "b@example.test"]);
  });
  it("bounds raw request size and rejects credential/identity extras", () => {
    const input = { operationId: randomUUID(), emails: ["a@example.test"] };
    expect(
      IdeaBoardInvitationBatchSchema.safeParse({ ...input, token: "guest-credential" }).success,
    ).toBe(false);
    expect(
      IdeaBoardInvitationBatchSchema.safeParse({ ...input, alias: "participant" }).success,
    ).toBe(false);
    expect(
      IdeaBoardInvitationBatchSchema.safeParse({
        ...input,
        emails: Array(21).fill("a@example.test"),
      }).success,
    ).toBe(false);
    expect(IdeaBoardInvitationBatchSchema.safeParse({ ...input, emails: [] }).success).toBe(false);
    expect(CanvasBoardInvitationBatchSchema.safeParse({ ...input, role: "owner" }).success).toBe(
      false,
    );
  });
  it("represents uncertainty separately from pending without exposing provider diagnostics", () => {
    const result = {
      batchId: randomUUID(),
      results: [{ email: "a@example.test", status: "unknown", errorCode: "DELIVERY_UNKNOWN" }],
      complete: true,
    };
    expect(BoardInvitationBatchResponseSchema.parse(result)).toEqual(result);
    expect(
      BoardInvitationBatchResponseSchema.safeParse({
        ...result,
        results: [{ ...result.results[0], errorCode: "SMTP password failed" }],
      }).success,
    ).toBe(false);
  });
});
