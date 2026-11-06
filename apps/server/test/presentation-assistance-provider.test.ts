import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESENTATION_ASSISTANCE_REVIEW_WARNING } from "@openround/contracts";
import {
  OpenAiCompatiblePresentationAssistanceProvider,
  presentationOutlineSections,
  validatePresentationAssistanceOutput,
} from "../src/presentation-assistance-provider.js";

const outline =
  "Agree on a shared purpose before starting the project.\n\nChoose an owner for every agreed action.\nReview progress together at the next meeting.";
function output() {
  return {
    slides: [
      {
        title: "Purpose",
        body: "Agree on the purpose.",
        citations: [{ locator: "outline line 1", excerpt: "Agree on a shared purpose" }],
      },
      {
        title: "Ownership",
        body: "Choose the owners.",
        citations: [{ locator: "outline line 3", excerpt: "Choose an owner" }],
      },
      {
        title: "Review",
        body: "Review progress together.",
        citations: [{ locator: "outline line 4", excerpt: "Review progress together" }],
      },
    ],
  };
}
const input = {
  sourceName: "Project outline",
  outline,
  slideCount: 3,
  provider: "approved-provider",
  model: "approved-model",
  generatedAt: new Date("2026-11-05T12:00:00Z"),
};
afterEach(() => vi.unstubAllGlobals());

describe("Presentation assistance provider", () => {
  it("validates exact outline evidence and marks every generated draft unverified", () => {
    expect(presentationOutlineSections(outline).map(({ locator }) => locator)).toEqual([
      "outline line 1",
      "outline line 3",
      "outline line 4",
    ]);
    const proposal = validatePresentationAssistanceOutput({ ...input, raw: output() });
    expect(proposal.reviewWarning).toBe(PRESENTATION_ASSISTANCE_REVIEW_WARNING);
    expect(proposal.slides).toHaveLength(3);
    expect(new Set(proposal.slides.map(({ id }) => id)).size).toBe(3);
    expect(proposal.slides[1]?.citations).toEqual(output().slides[1]!.citations);
  });

  it.each(["locator", "excerpt", "count", "geometry", "questions", "blank body", "control text"])(
    "rejects invalid or unsupported provider output: %s",
    (change) => {
      const raw = output();
      if (change === "locator") raw.slides[0]!.citations[0]!.locator = "outline line 99";
      if (change === "excerpt") raw.slides[0]!.citations[0]!.excerpt = "agree on a shared purpose";
      if (change === "count") raw.slides.push(raw.slides[0]!);
      if (change === "geometry") Object.assign(raw.slides[0]!, { frame: { x: 0 } });
      if (change === "questions") Object.assign(raw, { questions: [] });
      if (change === "blank body") raw.slides[0]!.body = " ";
      if (change === "control text") raw.slides[0]!.body = "Unsafe\u0000content";
      expect(() => validatePresentationAssistanceOutput({ ...input, raw })).toThrow();
    },
  );

  it("caps provider output tokens, prompt, response and deadline with the approved configuration", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(output()) } }] }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const provider = new OpenAiCompatiblePresentationAssistanceProvider(
      "https://approved.example/v1/chat/completions",
      "private-api-key",
      "approved-model",
      "approved-provider",
    );
    await expect(provider.generate(input)).resolves.toEqual(output());
    const [endpoint, request] = fetcher.mock.calls[0]! as [string, RequestInit];
    expect(endpoint).toBe("https://approved.example/v1/chat/completions");
    expect(request.redirect).toBe("error");
    expect(request.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(request.body as string);
    expect(body).toMatchObject({
      model: "approved-model",
      max_tokens: 4_096,
      response_format: { type: "json_object" },
    });
    expect(JSON.parse(body.messages[1].content)).toEqual({
      sourceName: input.sourceName,
      slideCount: 3,
      outline: presentationOutlineSections(outline),
    });
    await expect(provider.generate({ ...input, outline: "x".repeat(12_001) })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["status", "oversized header", "oversized stream", "invalid JSON", "missing output"])(
    "rejects bounded transport failure: %s",
    async (failure) => {
      const response =
        failure === "status"
          ? new Response("private provider detail", { status: 500 })
          : failure === "oversized header"
            ? new Response("{}", { headers: { "content-length": "999999" } })
            : failure === "oversized stream"
              ? new Response("x".repeat(128 * 1_024 + 1))
              : failure === "invalid JSON"
                ? new Response("private invalid body")
                : new Response("{}");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      const provider = new OpenAiCompatiblePresentationAssistanceProvider(
        "https://approved.example",
        undefined,
        "model",
        "provider",
      );
      await expect(provider.generate(input)).rejects.toThrow();
    },
  );
});
