import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  presentationTextAssistanceSourceDigest,
} from "@openround/contracts";
import {
  OpenAiCompatiblePresentationTextAssistanceProvider,
  presentationTextAssistanceProviderAvailable,
  validatePresentationTextAssistanceOutput,
} from "../src/presentation-text-assistance-provider.js";

const input = {
  originalText: "  Agree on a shared purpose before starting the project.  ",
  blockId: "10000000-0000-4000-8000-000000000001",
  nodeId: "Selected:Title",
  role: "title" as const,
  operation: "shorten" as const,
  provider: "approved-provider",
  model: "approved-model",
  generatedAt: new Date("2026-11-05T12:00:00Z"),
};
afterEach(() => vi.unstubAllGlobals());
describe("Presentation text assistance provider", () => {
  it("adds only a canonical translation target to the provider prompt and keeps the source annotation private", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ text: "Objectif commun" }) } }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const provider = new OpenAiCompatiblePresentationTextAssistanceProvider(
      "https://approved.example",
      undefined,
      input.model,
      input.provider,
    );
    await provider.generate({
      text: input.originalText,
      role: input.role,
      operation: "translate",
      targetLanguage: "fr",
    });
    const body = JSON.parse(fetcher.mock.calls[0]![1].body);
    expect(JSON.parse(body.messages[1].content)).toEqual({
      text: input.originalText,
      role: input.role,
      operation: "translate",
      targetLanguage: "fr",
    });
    expect(body.max_tokens).toBe(2_048);
    const proposal = validatePresentationTextAssistanceOutput({
      ...input,
      operation: "translate",
      targetLanguage: "fr",
      sourceLanguage: null,
      raw: { text: input.originalText },
    });
    expect(proposal).toMatchObject({
      targetLanguage: "fr",
      sourceLanguage: null,
      originalText: input.originalText,
      text: input.originalText,
    });
  });
  it("preserves exact original and proposed whitespace, binding unverified wording and both digests", () => {
    const text = "  Agree on a shared purpose.  ";
    const proposal = validatePresentationTextAssistanceOutput({ ...input, raw: { text } });
    expect(proposal).toMatchObject({
      originalText: input.originalText,
      text,
      nodeId: input.nodeId,
      reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
    });
    expect(proposal.sourceDigest).toBe(presentationTextAssistanceSourceDigest(input.originalText));
    expect(proposal.outputDigest).toBe(presentationTextAssistanceSourceDigest(text));
    expect(presentationTextAssistanceSourceDigest(input.originalText.trim())).not.toBe(
      proposal.sourceDigest,
    );
  });
  it.each([
    "unchanged",
    "blank",
    "not shorter",
    "title bound",
    "body bound",
    "extra field",
    "oversized output",
  ])("rejects invalid generated wording: %s", (failure) => {
    const raw: Record<string, unknown> = { text: "Agree on a shared purpose." };
    let role: "title" | "body" = "title";
    if (failure === "unchanged") raw.text = input.originalText;
    if (failure === "blank") raw.text = "   ";
    if (failure === "not shorter") raw.text = "x".repeat(input.originalText.length);
    if (failure === "title bound") raw.text = "x".repeat(161);
    if (failure === "body bound") {
      role = "body";
      raw.text = "x".repeat(4_001);
    }
    if (failure === "extra field") raw.notes = "PRIVATE extra information";
    if (failure === "oversized output") raw.text = "x".repeat(64 * 1_024);
    expect(() => validatePresentationTextAssistanceOutput({ ...input, role, raw })).toThrow();
  });
  it("reuses approved identity bounds and caps prompt input, tokens, response and transport deadline", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ text: "Shared purpose" }) } }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const provider = new OpenAiCompatiblePresentationTextAssistanceProvider(
      "https://approved.example/v1/chat/completions",
      "private-key",
      input.model,
      input.provider,
    );
    expect(presentationTextAssistanceProviderAvailable(provider)).toBe(true);
    expect(
      presentationTextAssistanceProviderAvailable({
        providerName: "p",
        modelName: "x".repeat(121),
      }),
    ).toBe(false);
    const selected = { text: input.originalText, role: input.role, operation: input.operation };
    await expect(provider.generate(selected)).resolves.toEqual({ text: "Shared purpose" });
    const [endpoint, request] = fetcher.mock.calls[0]! as [string, RequestInit];
    expect(endpoint).toBe("https://approved.example/v1/chat/completions");
    expect(request.redirect).toBe("error");
    expect(request.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(request.body as string);
    expect(body).toMatchObject({
      model: input.model,
      max_tokens: 2_048,
      response_format: { type: "json_object" },
    });
    expect(JSON.parse(body.messages[1].content)).toEqual(selected);
    await expect(provider.generate({ ...selected, text: "x".repeat(161) })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(["status", "oversized header", "oversized stream", "invalid JSON", "missing output"])(
    "rejects transport failure: %s",
    async (failure) => {
      const response =
        failure === "status"
          ? new Response("PRIVATE provider detail", { status: 500 })
          : failure === "oversized header"
            ? new Response("{}", { headers: { "content-length": "65537" } })
            : failure === "oversized stream"
              ? new Response("x".repeat(64 * 1_024 + 1))
              : failure === "invalid JSON"
                ? new Response("PRIVATE malformed body")
                : new Response("{}");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      const provider = new OpenAiCompatiblePresentationTextAssistanceProvider(
        "https://approved.example",
        undefined,
        input.model,
        input.provider,
      );
      await expect(
        provider.generate({
          text: input.originalText,
          role: input.role,
          operation: input.operation,
        }),
      ).rejects.toThrow();
    },
  );
});
