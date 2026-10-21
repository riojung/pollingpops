import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { IdeaBoardIdea } from "@openround/contracts";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { boardFixture, boardId } from "../../test-utils/idea-board";
import { IdeaContent } from "./idea-content";
import { IdeaBoardIdeas } from "./idea-list";
import { emptySketch, newSketchElement } from "./sketch-model";

vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    t: (key: keyof typeof english, values: Record<string, string | number> = {}) =>
      english[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`)),
  }),
}));

const richIdea: IdeaBoardIdea = {
  ...boardFixture.ideas[0]!,
  attachments: [{ mediaId: "00000000-0000-4000-8000-000000000005", alt: "A useful diagram" }],
  links: [{ url: "https://example.com/post", label: "Reference <post>" }],
  sketch: {
    ...emptySketch(),
    elements: [
      newSketchElement(
        "text",
        "00000000-0000-4000-8000-000000000004",
        "<script>alert('diagram')</script>",
      ),
    ],
  },
};

describe("rich idea content", () => {
  it("renders escaped typed drawings and safe external domain cards without executing embeds", () => {
    const markup = renderToStaticMarkup(
      <IdeaContent boardId={boardId} idea={richIdea} guestToken={"ab".repeat(32)} />,
    );
    expect(markup).toContain("Reference &lt;post&gt;");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).toContain("example.com");
    expect(markup).toContain("A useful diagram");
    expect(markup).not.toMatch(/<script|<iframe|javascript:|abababab/);
  });

  it("does not render removed content even if a stale caller supplies rich fields", () => {
    expect(
      renderToStaticMarkup(
        <IdeaContent boardId={boardId} idea={{ ...richIdea, status: "removed" }} />,
      ),
    ).toBe("");
  });

  it("keeps attachment links and drawing buttons outside the native ballot label", () => {
    const markup = renderToStaticMarkup(
      <IdeaBoardIdeas
        board={{ ...boardFixture, status: "voting", ideas: [richIdea] }}
        selected={[]}
        onSelect={() => {}}
      />,
    );
    const label = markup.match(/<label\b[^>]*>[\s\S]*?<\/label>/)?.[0];
    expect(label).toContain('type="checkbox"');
    expect(label).toContain(richIdea.body);
    expect(label).not.toMatch(/<a\b|<button\b|<svg\b/);
    expect(markup).toContain("Expand drawing");
  });

  it("rejects unsupported protocols and credential-bearing links defensively", () => {
    const markup = renderToStaticMarkup(
      <IdeaContent
        boardId={boardId}
        idea={{
          ...richIdea,
          links: [{ url: "javascript:alert(1)" }, { url: "https://secret@example.com" }],
        }}
      />,
    );
    expect(markup).not.toContain("href=");
  });

  it("renders a selected link image once inside its link card", () => {
    const markup = renderToStaticMarkup(
      <IdeaContent
        boardId={boardId}
        idea={{
          ...richIdea,
          links: [{ ...richIdea.links![0]!, imageMediaId: richIdea.attachments![0]!.mediaId }],
        }}
      />,
    );
    const card = markup.match(/<a\b[^>]*>[\s\S]*?<\/a>/)?.[0];
    expect(card).toContain("Loading image");
    expect(markup.match(/<figure\b/g)).toHaveLength(1);
    expect(card).not.toContain("<button");
  });
});
