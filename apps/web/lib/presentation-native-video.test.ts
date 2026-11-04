import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { presentationRichTextToPlainText } from "@openround/contracts";
import { NativeRichTextView } from "../components/presentation/native-rich-text-view";
import { createNativeVideoLink } from "./presentation-native-video";

const video = "https://example.com/video";
const transcript = "https://example.com/transcript";

afterEach(() => vi.unstubAllGlobals());

describe("explicit external video links", () => {
  it("creates matching structured/plain text, complete destinations and an explicit fallback without fetching providers", () => {
    const fetch = vi.fn(() => {
      throw new Error("Unexpected provider request");
    });
    vi.stubGlobal("fetch", fetch);
    const node = createNativeVideoLink(
      "  Review <evidence>  ",
      " https://EXAMPLE.com/a/../video ",
      transcript,
    );
    if (node.type !== "text" || !node.richText) throw new Error("Expected rich text");
    expect(node.role).toBe("body");
    expect(node.text).toBe(presentationRichTextToPlainText(node.richText));
    expect(node.text).toContain(`External video: Review <evidence> — ${video}`);
    expect(node.text).toContain(`Captions / transcript: ${transcript}`);
    expect(node.text).toContain("If playback is unavailable, use the captions or transcript link.");
    const markup = renderToStaticMarkup(
      createElement(NativeRichTextView, { richText: node.richText }),
    );
    expect(markup).toContain("Review &lt;evidence&gt;");
    expect(markup.match(/<a /g)).toHaveLength(2);
    expect(markup).toContain(`href="${video}"`);
    expect(markup).toContain(`href="${transcript}"`);
    expect(markup).toContain(
      'target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"',
    );
    expect(markup).not.toMatch(/<iframe|<script|<video|<embed|<object/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "http://example.com/video",
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///video",
    "//example.com/video",
    "/video",
    "https://user:password@example.com/video",
    "https://user@example.com/video",
    "not a URL",
  ])("rejects unsafe or incomplete destination %j for either link", (unsafe) => {
    expect(() => createNativeVideoLink("Review evidence", unsafe, transcript)).toThrow();
    expect(() => createNativeVideoLink("Review evidence", video, unsafe)).toThrow();
  });

  it("requires a nonblank title within160 characters", () => {
    for (const title of ["", "  ", "x".repeat(161)])
      expect(() => createNativeVideoLink(title, video, transcript)).toThrow("at most 160");
    const node = createNativeVideoLink("x".repeat(160), video, transcript);
    expect(node.type === "text" && node.text).toContain("x".repeat(160));
  });

  it("accepts each2048-character HTTPS destination and rejects either destination beyond the bound", () => {
    const base = "https://example.com/";
    const bounded = base + "x".repeat(2048 - base.length);
    expect(() => createNativeVideoLink("Video", bounded, transcript)).not.toThrow();
    expect(() => createNativeVideoLink("Video", video, bounded)).not.toThrow();
    expect(() => createNativeVideoLink("Video", bounded + "x", transcript)).toThrow("2048");
    expect(() => createNativeVideoLink("Video", video, bounded + "x")).toThrow("2048");
  });
});
