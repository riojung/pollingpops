import { describe, expect, it } from "vitest";
import {
  AnswerSubmitSchema,
  JoinRequestSchema,
  SyncRequestSchema,
  RoundClientCapabilitiesSchema,
  RoundClientCapabilitiesQuerySchema,
  RoundProtocolSchema,
  canUseRoundProtocol,
  currentRoundClientCapabilities,
  legacyRoundProtocol,
  deriveRoundProtocol,
} from "../src/index";

const required = {
  schemaVersion: 1 as const,
  minimumClientVersion: 3 as const,
  requiredCapabilities: ["poll.multiselect" as const],
};
const capable = { protocolVersion: 3 as const, capabilities: ["poll.multiselect" as const] };
const id = "00000000-0000-4000-8000-000000000001";
describe("Round protocol compatibility", () => {
  it("retains implicit legacy clients while updated clients advertise multiple-selection polls", () => {
    expect(canUseRoundProtocol(undefined, undefined)).toBe(true);
    expect(canUseRoundProtocol(legacyRoundProtocol(), undefined)).toBe(true);
    expect(currentRoundClientCapabilities()).toEqual({
      protocolVersion: 3,
      capabilities: [
        "poll.multiselect",
        "response.ranking",
        "response.open_text",
        "response.word_cloud",
      ],
    });
    expect(canUseRoundProtocol(required, currentRoundClientCapabilities())).toBe(true);
    expect(canUseRoundProtocol(required, undefined)).toBe(false);
    expect(deriveRoundProtocol({ questions: [{ type: "poll" }] })).toEqual(legacyRoundProtocol());
    expect(deriveRoundProtocol({ questions: [{ type: "poll", maxSelections: 2 }] })).toEqual(
      required,
    );
  });
  it("requires both the protocol version and every frozen response capability", () => {
    expect(canUseRoundProtocol(required, undefined)).toBe(false);
    expect(canUseRoundProtocol(required, { protocolVersion: 3, capabilities: [] })).toBe(false);
    expect(canUseRoundProtocol(required, capable)).toBe(true);
    expect(canUseRoundProtocol(undefined, capable)).toBe(true);
  });
  it("rejects future versions, unknown or duplicated capabilities, and contradictory profiles", () => {
    for (const input of [
      { protocolVersion: 4, capabilities: [] },
      { protocolVersion: 3, capabilities: ["unknown"] },
      { protocolVersion: 3, capabilities: ["poll.multiselect", "poll.multiselect"] },
      { protocolVersion: 2, capabilities: ["poll.multiselect"] },
      { ...capable, extra: true },
    ])
      expect(RoundClientCapabilitiesSchema.safeParse(input).success).toBe(false);
    expect(RoundProtocolSchema.safeParse({ ...required, schemaVersion: 2 }).success).toBe(false);
    expect(RoundProtocolSchema.safeParse({ ...required, minimumClientVersion: 2 }).success).toBe(
      false,
    );
  });
  it("bounds and validates REST query JSON", () => {
    expect(RoundClientCapabilitiesQuerySchema.parse(JSON.stringify(capable))).toEqual(capable);
    expect(RoundClientCapabilitiesQuerySchema.parse(undefined)).toBeUndefined();
    for (const input of [
      "{",
      "null",
      "x".repeat(257),
      JSON.stringify({ protocolVersion: 99, capabilities: [] }),
    ])
      expect(RoundClientCapabilitiesQuerySchema.safeParse(input).success).toBe(false);
  });
  it("preserves legacy join, sync and choiceId requests without adding defaults", () => {
    expect(JoinRequestSchema.parse({ code: "1234567" })).not.toHaveProperty("clientCapabilities");
    expect(
      SyncRequestSchema.parse({ sessionId: id, role: "host", hostToken: "a".repeat(32) }),
    ).not.toHaveProperty("clientCapabilities");
    expect(
      AnswerSubmitSchema.parse({
        sessionId: id,
        roundId: id,
        participantToken: "a".repeat(32),
        idempotencyKey: "legacy-key",
        choiceId: id,
      }),
    ).not.toHaveProperty("clientCapabilities");
  });
  it("accepts bounded multiple live poll selections for server-side authored-limit validation", () => {
    expect(
      AnswerSubmitSchema.safeParse({
        sessionId: id,
        roundId: id,
        participantToken: "a".repeat(32),
        idempotencyKey: "poll-key",
        clientCapabilities: capable,
        response: { kind: "poll", choiceIds: [id, "00000000-0000-4000-8000-000000000002"] },
      }).success,
    ).toBe(true);
  });
  it("returns independent profiles so callers cannot change the shared defaults", () => {
    const first = legacyRoundProtocol();
    first.minimumClientVersion = 3;
    expect(legacyRoundProtocol().minimumClientVersion).toBe(2);
  });
});
