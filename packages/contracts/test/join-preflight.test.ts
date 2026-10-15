import { describe, expect, it } from "vitest";
import { JoinPreflightRequestSchema, JoinPreflightResponseSchema } from "../src/index.js";

describe("join preflight contracts", () => {
  it("accepts only a seven-digit code", () => {
    expect(JoinPreflightRequestSchema.parse({ code: " 1234567 " })).toEqual({ code: "1234567" });
    expect(JoinPreflightRequestSchema.safeParse({ code: "123456" }).success).toBe(false);
    expect(
      JoinPreflightRequestSchema.safeParse({ code: "1234567", nickname: "Learner" }).success,
    ).toBe(false);
  });

  it("defaults legacy responses to the canonical Round destination", () => {
    expect(JoinPreflightResponseSchema.parse({ nicknamePolicy: "friendly_only" })).toEqual({
      nicknamePolicy: "friendly_only",
      artifactType: "round",
      destination: "/join",
      passwordRequired: false,
    });
    expect(
      JoinPreflightResponseSchema.parse({
        nicknamePolicy: "custom",
        artifactType: "presentation",
        destination: "/join",
      }),
    ).toMatchObject({ artifactType: "presentation", destination: "/join" });
    expect(
      JoinPreflightResponseSchema.safeParse({
        nicknamePolicy: "custom",
        artifactType: "presentation",
        destination: "https://example.com/join",
      }).success,
    ).toBe(false);
    expect(
      JoinPreflightResponseSchema.safeParse({
        nicknamePolicy: "custom",
        title: "Private Round title",
        participantCount: 12,
        workspaceId: "00000000-0000-4000-8000-000000000001",
        phase: "lobby",
      }).success,
    ).toBe(false);
  });
});
