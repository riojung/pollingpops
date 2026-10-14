import { describe, expect, it } from "vitest";
import { textResponseError, textResponseReceipt } from "./text-response";
import { currentTextRead } from "./text-response-client";
import { participantResponseView, legacyResponseRequiresSubmit } from "./participant-response";

describe("moderated text submission", () => {
  it("validates normalized UTF-16 limits, blank responses and forbidden controls", () => {
    expect(textResponseError("open_text", " \n\t ")).toBe("empty");
    expect(textResponseError("open_text", "é".repeat(1000))).toBeNull();
    expect(textResponseError("open_text", "e\u0301".repeat(1000))).toBeNull();
    expect(textResponseError("open_text", "😀".repeat(501))).toBe("length");
    expect(textResponseError("word_cloud", "a".repeat(81))).toBe("length");
    expect(textResponseError("open_text", "One\nTwo\tThree")).toBeNull();
    expect(textResponseError("word_cloud", "One\nTwo")).toBe("characters");
    expect(textResponseError("open_text", "a\u0000b")).toBe("characters");
  });

  it("restores a saved receipt from a body-free marker with no text value in the view", () => {
    const view = participantResponseView(null, null, null, null, true);
    expect(view).toMatchObject({ saved: true, choiceIds: [], numericValue: "", ratingValue: null });
    expect(Object.keys(view)).not.toContain("textValue");
    expect(textResponseReceipt("pending")).toBe("live.text.receiptPending");
    expect(textResponseReceipt("approved")).toBe("live.text.receiptApproved");
    expect(textResponseReceipt("removed")).toBe("live.text.receiptRemoved");
    expect(legacyResponseRequiresSubmit({ type: "open_text", confidence: "off" })).toBe(true);
    expect(legacyResponseRequiresSubmit({ type: "word_cloud", confidence: "off" })).toBe(true);
  });
});

describe("text read privacy", () => {
  const state = {
    key: "room/version1/page1",
    credential: "current-credential",
    data: { body: "Approved response" },
    error: "",
  };
  it("clears visible content immediately on room-version, page or authorization-context changes", () => {
    expect(currentTextRead(state, state.key, state.credential)).toBe(state);
    expect(currentTextRead(state, "room/version2/page1", state.credential)).toBeNull();
    expect(currentTextRead(state, "room/version1/page2", state.credential)).toBeNull();
    expect(currentTextRead(state, state.key, "revoked-credential")).toBeNull();
    expect(currentTextRead(null, state.key, state.credential)).toBeNull();
  });
});
