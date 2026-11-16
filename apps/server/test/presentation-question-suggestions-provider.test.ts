import { afterEach, describe, expect, it, vi } from "vitest";
import { PresentationQuestionSuggestionSourceSchema } from "@openround/contracts";
import {
  OpenAiCompatiblePresentationQuestionSuggestionsProvider,
  questionSuggestionsProviderInput,
  validatePresentationQuestionSuggestionsOutput,
  presentationQuestionSuggestionsProviderAvailable,
} from "../src/presentation-question-suggestions-provider.js";
const source = PresentationQuestionSuggestionSourceSchema.parse({
  blockId: "10000000-0000-4000-8000-000000000001",
  title: { nodeId: "PRIVATE_TITLE_ID", text: "Shared purpose", lang: "fr" },
  body: [
    {
      nodeId: "PRIVATE_BODY_ID",
      text: "Agree on a purpose.\nChoose a reviewer.",
      lang: null,
      paragraphs: [
        { kind: "paragraph", text: "Agree on a purpose." },
        { kind: "bullet", text: "Choose a reviewer." },
      ],
    },
  ],
  readingOrder: ["PRIVATE_TITLE_ID", "PRIVATE_BODY_ID"],
});
const generated = {
  suggestions: [
    {
      kind: "discussion",
      prompt: "How could agreeing on a purpose affect your group?",
      citations: [{ locator: "body 1 paragraph 1", excerpt: "Agree on a purpose." }],
    },
    {
      kind: "reflection",
      prompt: "How would you choose a reviewer for your work?",
      citations: [{ locator: "body 1 paragraph 2", excerpt: "Choose a reviewer." }],
    },
  ],
};
const validate = (raw: unknown) =>
  validatePresentationQuestionSuggestionsOutput({
    raw,
    source,
    provider: "approved",
    model: "bounded-model",
    generatedAt: new Date("2026-11-07T12:00:00Z"),
  });
afterEach(() => vi.unstubAllGlobals());
describe("Presentation question suggestions provider", () => {
  it("sends only selected visible title/body section wording using the existing bounded approved provider", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(generated) } }] }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const provider = new OpenAiCompatiblePresentationQuestionSuggestionsProvider(
      "https://approved.example",
      undefined,
      "bounded-model",
      "approved",
    );
    expect(presentationQuestionSuggestionsProviderAvailable(provider)).toBe(true);
    const minimal = questionSuggestionsProviderInput(source);
    expect(minimal).toEqual({
      title: "Shared purpose",
      sections: [
        { locator: "body 1 paragraph 1", text: "Agree on a purpose." },
        { locator: "body 1 paragraph 2", text: "Choose a reviewer." },
      ],
      outputLanguage: "en",
    });
    expect(await provider.generate(minimal)).toEqual(generated);
    const request = fetcher.mock.calls[0]![1] as RequestInit,
      body = JSON.parse(request.body as string);
    expect(JSON.parse(body.messages[1].content)).toEqual(minimal);
    expect(body.max_tokens).toBe(2048);
    expect(request.redirect).toBe("error");
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(body)).not.toContain("PRIVATE_");
    expect(JSON.stringify(body)).not.toContain('"lang"');
    const proposal = validate(generated);
    expect(proposal.source).toEqual(source);
    expect(proposal.suggestions.map((s) => s.kind)).toEqual(["discussion", "reflection"]);
    expect(
      presentationQuestionSuggestionsProviderAvailable({
        providerName: "approved",
        modelName: "x".repeat(121),
      }),
    ).toBe(false);
  });
  it.each([
    "extra",
    "one",
    "wrong kind",
    "same prompt",
    "invented quote",
    "wrong locator",
    "title only",
    "oversized",
  ])("rejects invalid generated output: %s", (failure) => {
    const raw = structuredClone(generated) as Record<string, unknown> & typeof generated;
    if (failure === "extra") raw.secret = "unapproved field";
    if (failure === "one") raw.suggestions.pop();
    if (failure === "wrong kind") raw.suggestions[0]!.kind = "reflection";
    if (failure === "same prompt") raw.suggestions[1]!.prompt = raw.suggestions[0]!.prompt;
    if (failure === "invented quote")
      raw.suggestions[0]!.citations[0]!.excerpt = "Invented evidence";
    if (failure === "wrong locator")
      raw.suggestions[0]!.citations[0]!.locator = "body 8 paragraph 1";
    if (failure === "title only")
      raw.suggestions[0]!.citations = [{ locator: "title", excerpt: "Shared purpose" }];
    if (failure === "oversized") raw.suggestions[0]!.prompt = "x".repeat(65537);
    expect(() => validate(raw)).toThrow();
  });
  it.each(["status", "oversized header", "oversized stream", "malformed JSON", "missing output"])(
    "rejects bounded transport failure: %s",
    async (failure) => {
      const response =
        failure === "status"
          ? new Response("PRIVATE provider failure", { status: 500 })
          : failure === "oversized header"
            ? new Response("{}", { headers: { "content-length": "65537" } })
            : failure === "oversized stream"
              ? new Response("x".repeat(65537))
              : failure === "malformed JSON"
                ? new Response("PRIVATE malformed response")
                : new Response("{}");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      const provider = new OpenAiCompatiblePresentationQuestionSuggestionsProvider(
        "https://approved.example",
        undefined,
        "bounded-model",
        "approved",
      );
      await expect(provider.generate(questionSuggestionsProviderInput(source))).rejects.toThrow();
    },
  );
});
