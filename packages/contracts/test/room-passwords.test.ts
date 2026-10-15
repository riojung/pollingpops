import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  CreatePresentationSessionSchema,
  CreateSessionSchema,
  JoinPreflightResponseSchema,
  JoinPresentationSessionSchema,
  JoinRequestSchema,
  RoomPasswordSchema,
  type ErrorCode,
} from "../src/index.js";
import { SurveyRoomCreateSchema } from "../src/surveys.js";

describe("optional room passwords", () => {
  it("validates password admission failures through the published API error contract", () => {
    const codes = ["PASSWORD_REQUIRED", "INVALID_PASSWORD"] as const satisfies readonly ErrorCode[];
    for (const code of codes) {
      const response = { error: { code, message: "Room admission rejected" } };
      expect(ApiErrorSchema.parse(response)).toEqual(response);
    }
    expect(
      ApiErrorSchema.safeParse({ error: { code: "UNKNOWN_PASSWORD_ERROR", message: "Rejected" } })
        .success,
    ).toBe(false);
  });

  it("keeps the exact credential and bounds creation passwords", () => {
    for (const password of ["a".repeat(8), "a".repeat(128), " pass phrase "])
      expect(RoomPasswordSchema.parse(password)).toBe(password);
    for (const password of ["", "a".repeat(7), "a".repeat(129), " ".repeat(8), "\t\n".repeat(8)])
      expect(RoomPasswordSchema.safeParse(password).success).toBe(false);
  });

  it("accepts passwords only as optional creation fields, outside public settings", () => {
    const creates = [
      {
        schema: CreateSessionSchema,
        input: {
          quizId: randomUUID(),
          settings: {
            audienceLimit: 20,
            scoringMode: "accuracy",
            resultVisibility: "private",
            allowLateJoin: true,
            nicknamePolicy: "custom",
          },
        },
      },
      { schema: CreatePresentationSessionSchema, input: { presentationId: randomUUID() } },
      {
        schema: SurveyRoomCreateSchema,
        input: { idempotencyKey: randomUUID(), expectedRevision: 0 },
      },
    ];
    for (const { schema, input } of creates) {
      expect(schema.parse(input)).not.toHaveProperty("joinPassword");
      expect(schema.parse({ ...input, joinPassword: " pass phrase " })).toHaveProperty(
        "joinPassword",
        " pass phrase ",
      );
      expect(schema.safeParse({ ...input, joinPassword: "short" }).success).toBe(false);
    }
  });

  it("allows missing or empty join passwords and rejects oversized credentials", () => {
    for (const schema of [JoinRequestSchema, JoinPresentationSessionSchema]) {
      const input = { code: "1234567", nickname: "Learner" };
      expect(schema.parse(input)).not.toHaveProperty("password");
      for (const password of ["", " pass phrase ", "a".repeat(128)])
        expect(schema.parse({ ...input, password })).toHaveProperty("password", password);
      expect(schema.safeParse({ ...input, password: "a".repeat(129) }).success).toBe(false);
    }
  });

  it("defaults old preflight responses to open and exposes only a protection flag", () => {
    expect(JoinPreflightResponseSchema.parse({ nicknamePolicy: "custom" })).toHaveProperty(
      "passwordRequired",
      false,
    );
    expect(
      JoinPreflightResponseSchema.parse({ nicknamePolicy: "custom", passwordRequired: true }),
    ).toHaveProperty("passwordRequired", true);
    expect(
      JoinPreflightResponseSchema.safeParse({
        nicknamePolicy: "custom",
        joinPasswordHash: "private-verifier",
      }).success,
    ).toBe(false);
  });
});
