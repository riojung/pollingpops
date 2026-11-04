import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readPresentationTextModeration,
  readPresentationTextResults,
  retainPresentationTextModerationIntent,
  sendPresentationTextModeration,
  validatePresentationTextModerationAck,
} from "./presentation-text-client";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ apiFetch }));
const sessionId = "11111111-1111-4111-8111-111111111111";
const blockId = "22222222-2222-4222-8222-222222222222";
const responseId = "33333333-3333-4333-8333-333333333333";
const questionId = "44444444-4444-4444-8444-444444444444";
const commandId = "55555555-5555-4555-8555-555555555555";
const fence = { sessionId, revision: 3, seq: 7 };
const item = {
  responseId,
  blockId,
  questionId,
  questionPrompt: "Explain a priority",
  textValue: "Private queue text",
  status: "pending" as const,
  moderationVersion: 0,
  submittedAt: "2026-11-04T12:00:00.000Z",
  authorAlias: "Guest",
};
const page = { ...fence, phase: "question_open", items: [item], nextCursor: null };
const result = {
  ...fence,
  blockId,
  type: "open_text",
  visible: true,
  approvedRespondents: 5,
  items: [{ textValue: "Approved text" }],
  terms: [],
  nextCursor: null,
};
const input = {
  sessionId,
  blockId,
  responseId,
  credential: "host-fixture-credential",
  request: {
    commandId,
    expectedRevision: 3,
    expectedModerationVersion: 0,
    status: "approved" as const,
  },
};
const ack = {
  ...fence,
  seq: 8,
  accepted: true,
  duplicate: false,
  receipt: {
    commandId,
    responseId,
    blockId,
    previousStatus: "pending",
    status: "approved",
    expectedRevision: 3,
    expectedModerationVersion: 0,
    resultingModerationVersion: 1,
    acceptedAt: "2026-11-04T12:01:00.000Z",
  },
  response: { responseId, blockId, status: "approved", moderationVersion: 1 },
};

beforeEach(() => apiFetch.mockReset());

describe("Presentation text transports", () => {
  it("reads a private scoped queue with only its explicit host bearer and no cookie fallback", async () => {
    apiFetch.mockResolvedValue(page);
    expect(
      await readPresentationTextModeration({
        ...fence,
        credential: input.credential,
        blockId,
        status: "pending",
      }),
    ).toEqual(page);
    const [path, options] = apiFetch.mock.calls[0]!;
    expect(path).toContain(`/v1/presentation-sessions/${sessionId}/response-moderation?`);
    const query = new URL(path, "https://test.invalid").searchParams;
    expect(Object.fromEntries(query)).toEqual({ status: "pending", limit: "10", blockId });
    expect(options).toMatchObject({
      credentials: "omit",
      cache: "no-store",
      headers: { authorization: `Bearer ${input.credential}` },
    });
    await expect(
      readPresentationTextModeration({ ...fence, credential: "", status: "pending" }),
    ).rejects.toThrow("Reconnect");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...page, seq: 6 },
    { ...page, sessionId: questionId },
    { ...page, revision: 2 },
    { ...page, items: [{ ...item, blockId: questionId }] },
    { ...page, items: [{ ...item, status: "approved" }] },
    { ...page, items: [{ ...item, status: "removed", textValue: "Erased body" }] },
  ])("rejects stale, mismatched or body-bearing removed private pages", async (value) => {
    apiFetch.mockResolvedValue(value);
    await expect(
      readPresentationTextModeration({
        ...fence,
        blockId,
        credential: input.credential,
        status: "pending",
      }),
    ).rejects.toThrow();
  });

  it.each(["host", "participant", "companion", "stage"] as const)(
    "reads current results as %s without cookies",
    async (projection) => {
      apiFetch.mockResolvedValue(result);
      expect(
        await readPresentationTextResults({
          ...fence,
          blockId,
          type: "open_text",
          projection,
          credential: "scoped-fixture-credential",
        }),
      ).toEqual(result);
      const [path, options] = apiFetch.mock.calls[0]!;
      expect(path).toContain(`/v1/presentation-sessions/${sessionId}/response-results?`);
      expect(Object.fromEntries(new URL(path, "https://test.invalid").searchParams)).toEqual({
        blockId,
        role: projection,
        limit: "50",
      });
      expect(options.credentials).toBe("omit");
      expect(options.headers).toEqual({ authorization: "Bearer scoped-fixture-credential" });
    },
  );

  it("allows cookies only for the explicit creator result projection", async () => {
    apiFetch.mockResolvedValue(result);
    await readPresentationTextResults({
      ...fence,
      blockId,
      type: "open_text",
      projection: "creator",
    });
    expect(apiFetch.mock.calls[0]![1]).toMatchObject({ credentials: "include", cache: "no-store" });
    expect(apiFetch.mock.calls[0]![1]).not.toHaveProperty("headers");
  });

  it.each([
    { ...result, seq: 6 },
    { ...result, blockId: questionId },
    { ...result, type: "word_cloud" },
    { ...result, approvedRespondents: 4 },
    { ...result, visible: false },
    { ...result, items: [{ textValue: "Approved text", responseId }] },
  ])("rejects old/wrong/small-sample results instead of displaying their text", async (value) => {
    apiFetch.mockResolvedValue(value);
    await expect(
      readPresentationTextResults({
        ...fence,
        blockId,
        type: "open_text",
        projection: "participant",
        credential: "participant-fixture",
      }),
    ).rejects.toThrow();
  });

  it("retains a write unchanged after lost acknowledgement and validates the retry receipt", async () => {
    const retained = retainPresentationTextModerationIntent(input);
    expect(Object.isFrozen(retained)).toBe(true);
    expect(Object.isFrozen(retained.request)).toBe(true);
    apiFetch.mockRejectedValueOnce(new Error("Acknowledgement lost"));
    await expect(sendPresentationTextModeration(retained)).rejects.toThrow("Acknowledgement lost");
    apiFetch.mockResolvedValueOnce({ ...ack, duplicate: true });
    expect((await sendPresentationTextModeration(retained)).duplicate).toBe(true);
    expect(apiFetch.mock.calls[0]).toEqual(apiFetch.mock.calls[1]);
    expect(apiFetch.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { authorization: `Bearer ${input.credential}` },
      body: JSON.stringify(input.request),
    });
  });

  it("accepts the immutable original receipt with newer current moderation metadata", () => {
    expect(
      validatePresentationTextModerationAck(input, {
        ...ack,
        duplicate: true,
        seq: 9,
        response: { responseId, blockId, status: "removed", moderationVersion: 2 },
      }).receipt,
    ).toEqual(ack.receipt);
  });

  it.each([
    { ...ack, accepted: false },
    { ...ack, sessionId: questionId },
    { ...ack, receipt: { ...ack.receipt, commandId: questionId } },
    { ...ack, receipt: { ...ack.receipt, blockId: questionId } },
    { ...ack, receipt: { ...ack.receipt, expectedRevision: 2 } },
    { ...ack, response: { ...ack.response, moderationVersion: 0 } },
  ])("does not claim success for an unrelated or incoherent acknowledgement", (value) => {
    expect(() => validatePresentationTextModerationAck(input, value)).toThrow();
  });
});
