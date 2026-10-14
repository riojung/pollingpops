import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RestoreRoundDraftHistorySchema, RoundDraftMutationSchema } from "../src/index.js";

describe("Round draft mutation contracts", () => {
  it("requires a versioned idempotency envelope", () => {
    const mutationId = randomUUID();
    expect(
      RoundDraftMutationSchema.parse({
        draft: { title: "Draft", description: "", questions: [] },
        expectedRevision: 3,
        mutationId,
        schemaVersion: 1,
      }),
    ).toMatchObject({ expectedRevision: 3, mutationId, schemaVersion: 1 });
    expect(
      RoundDraftMutationSchema.safeParse({
        draft: { title: "Draft", description: "", questions: [] },
        expectedRevision: 3,
        mutationId,
        schemaVersion: 5,
      }).success,
    ).toBe(false);
  });

  it("fences history restores with the current revision and mutation ID", () => {
    const mutationId = randomUUID();
    expect(RestoreRoundDraftHistorySchema.parse({ expectedRevision: 7, mutationId })).toEqual({
      expectedRevision: 7,
      mutationId,
    });
  });
});
