import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  qnaDefaults,
  qnaDisplayName,
  qnaInitialStatus,
  qnaIsPublic,
  qnaQuestionVisible,
  ScopedQnaCommandSchema,
  ScopedQnaReceiptSchema,
  ScopedAudienceEventSchema,
  ScopedQnaPageSchema,
  PresentationAudienceAvailabilitySchema,
} from "../src/index.js";
describe("shared Q&A policy and scoped protocol", () => {
  it("validates rollout discovery without allowing contradictory or future states", () => {
    expect(
      PresentationAudienceAvailabilitySchema.safeParse({
        schemaVersion: 1,
        available: true,
        activated: false,
        canActivate: true,
      }).success,
    ).toBe(true);
    for (const value of [
      { schemaVersion: 2, available: true, activated: false, canActivate: true },
      { schemaVersion: 1, available: false, activated: true, canActivate: false },
      { schemaVersion: 1, available: true, activated: true, canActivate: true },
      { schemaVersion: 1, available: false, activated: false, canActivate: true },
    ])
      expect(PresentationAudienceAvailabilitySchema.safeParse(value).success).toBe(false);
  });
  it("preserves segment defaults and facilitator-visible learning aliases", () => {
    expect(qnaDefaults("education")).toEqual({
      enabled: true,
      displayMode: "anonymous_public",
      moderationMode: "pre",
      participantReplies: false,
    });
    expect(qnaDefaults("workplace")).toEqual({
      enabled: true,
      displayMode: "alias_public",
      moderationMode: "post",
      participantReplies: true,
    });
    expect(qnaInitialStatus("pre")).toBe("pending");
    expect(qnaInitialStatus("post")).toBe("published");
    expect(
      qnaDisplayName({
        alias: "Alias",
        moderator: true,
        mine: false,
        displayMode: "anonymous_public",
      }),
    ).toBe("Alias");
    expect(
      qnaDisplayName({
        alias: "Alias",
        moderator: false,
        mine: true,
        displayMode: "anonymous_public",
      }),
    ).toBe("You");
    expect(
      qnaDisplayName({
        alias: "Alias",
        moderator: false,
        mine: false,
        displayMode: "anonymous_public",
      }),
    ).toBe("Anonymous");
  });
  it.each(["pending", "published", "answered", "dismissed", "removed"])(
    "applies the same visibility rule to %s questions in either repository",
    (status) => {
      expect(qnaQuestionVisible(status, true, false)).toBe(true);
      expect(qnaQuestionVisible(status, false, true)).toBe(true);
      expect(qnaQuestionVisible(status, false, false)).toBe(qnaIsPublic(status));
    },
  );
  it("requires idempotency, host revision fences and a compatible response version", () => {
    const idempotencyKey = randomUUID();
    const creation = { type: "question.create", body: "Question", idempotencyKey };
    expect(ScopedQnaCommandSchema.safeParse(creation).success).toBe(true);
    expect(ScopedQnaCommandSchema.safeParse({ ...creation, actorId: randomUUID() }).success).toBe(
      false,
    );
    expect(ScopedQnaCommandSchema.safeParse({ ...creation, body: "x".repeat(1_001) }).success).toBe(
      false,
    );
    expect(
      ScopedQnaCommandSchema.safeParse({
        type: "settings.update",
        idempotencyKey,
        settings: {
          enabled: true,
          displayMode: "alias_public",
          moderationMode: "post",
          participantReplies: false,
        },
      }).success,
    ).toBe(false);
    const receipt = { schemaVersion: 1, idempotencyKey, resourceId: randomUUID(), audienceSeq: 1 };
    expect(ScopedQnaReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(ScopedQnaReceiptSchema.safeParse({ ...receipt, schemaVersion: 2 }).success).toBe(false);
    expect(ScopedQnaPageSchema.safeParse({ schemaVersion: 2 }).success).toBe(false);
  });
  it("allows only metadata invalidations, never arbitrary Q&A content in the outbox", () => {
    const event = {
      schemaVersion: 1,
      eventId: randomUUID(),
      scopeId: randomUUID(),
      audienceSeq: 2,
      serverTime: new Date().toISOString(),
      type: "audience.qna.updated",
      payload: { kind: "presentation" },
    };
    expect(ScopedAudienceEventSchema.safeParse(event).success).toBe(true);
    expect(
      ScopedAudienceEventSchema.safeParse({
        ...event,
        payload: { kind: "presentation", body: "Private" },
      }).success,
    ).toBe(false);
    expect(
      ScopedAudienceEventSchema.safeParse({ ...event, type: "qna.question.created" }).success,
    ).toBe(false);
  });
});
