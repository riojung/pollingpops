import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  IdeaBoardCreateSchema,
  IdeaBoardBodySchema,
  IdeaBoardHostCommandSchema,
  IdeaBoardVoteSchema,
  IdeaBoardViewSchema,
  IdeaBoardStoredSchema,
} from "../src/idea-boards.js";

describe("standalone idea board contracts", () => {
  it("defaults to anonymous moderated hidden collection and rejects future versions and invalid bounds", () => {
    expect(IdeaBoardCreateSchema.parse({ title: "  Next steps  " })).toEqual({
      schemaVersion: 1,
      title: "Next steps",
      description: "",
      identityMode: "anonymous",
      moderationEnabled: true,
      ideasVisible: false,
      voteBudget: 3,
      windowDays: 7,
    });
    for (const input of [
      { schemaVersion: 2 },
      { title: "a".repeat(161) },
      { description: "a".repeat(2001) },
      { voteBudget: 0 },
      { voteBudget: 11 },
      { windowDays: 31 },
      { identityMode: "email" },
      { participantLimit: 1000 },
    ])
      expect(IdeaBoardCreateSchema.safeParse({ title: "Plan", ...input }).success).toBe(false);
    expect(IdeaBoardBodySchema.parse("  Cafe\u0301 <b>literal</b>  ")).toBe("Café <b>literal</b>");
    for (const body of [" ", "a".repeat(1001), "private\u0000body"])
      expect(IdeaBoardBodySchema.safeParse(body).success).toBe(false);
  });
  it("requires explicit distinct permitted shape for ballots and fenced command types", () => {
    const ideaId = randomUUID();
    const ballot = { ideaIds: [ideaId], expectedRevision: 0, idempotencyKey: randomUUID() };
    expect(IdeaBoardVoteSchema.parse(ballot).schemaVersion).toBe(1);
    expect(IdeaBoardVoteSchema.safeParse({ ...ballot, ideaIds: [ideaId, ideaId] }).success).toBe(
      false,
    );
    expect(IdeaBoardVoteSchema.safeParse({ ...ballot, expectedRevision: -1 }).success).toBe(false);
    expect(IdeaBoardHostCommandSchema.safeParse({ type: "reopen" }).success).toBe(false);
    expect(
      IdeaBoardHostCommandSchema.safeParse({ type: "moderate", ideaId, status: "pending" }).success,
    ).toBe(false);
    expect(
      IdeaBoardHostCommandSchema.safeParse({
        type: "group.create",
        id: randomUUID(),
        name: "a".repeat(81),
      }).success,
    ).toBe(false);
  });
  it("keeps public schemas strict and rejects unknown stored schema versions", () => {
    expect(IdeaBoardViewSchema.safeParse({ schemaVersion: 2 }).success).toBe(false);
    expect(IdeaBoardStoredSchema.safeParse({ schemaVersion: 2 }).success).toBe(false);
  });
});
