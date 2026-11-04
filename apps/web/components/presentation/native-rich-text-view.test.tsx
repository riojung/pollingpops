import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type PresentationRichText } from "@openround/contracts";
import { NativeRichTextView } from "./native-rich-text-view";
import { NativeSceneView } from "./native-scene-view";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";

const richText: PresentationRichText = {
  paragraphs: [
    {
      kind: "paragraph",
      runs: [
        { text: "Review ", bold: true },
        { text: "the plan", italic: true, href: "https://example.com/plan" },
      ],
    },
    { kind: "bullet", runs: [{ text: "First decision" }] },
    { kind: "bullet", runs: [{ text: "Second decision" }] },
    { kind: "numbered", runs: [{ text: "Confirm owner" }] },
    { kind: "paragraph", runs: [{ text: "<script>bad()</script>" }] },
  ],
};

describe("native rich-text delivery", () => {
  it("renders semantic emphasis and contiguous lists with safe isolated links", () => {
    const markup = renderToStaticMarkup(<NativeRichTextView richText={richText} />);
    expect(markup).toContain("<strong>Review </strong>");
    expect(markup).toContain("<em>the plan</em>");
    expect(markup).toContain(
      '<a href="https://example.com/plan" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">',
    );
    expect(markup).toContain("<ul><li>First decision</li><li>Second decision</li></ul>");
    expect(markup).toContain("<ol><li>Confirm owner</li></ol>");
    expect(markup).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<button");
  });

  it("does not activate unvalidated protocols even when given malformed runtime props", () => {
    const invalid = {
      paragraphs: [
        { kind: "paragraph" as const, runs: [{ text: "Unsafe", href: "javascript:alert(1)" }] },
      ],
    };
    const markup = renderToStaticMarkup(<NativeRichTextView richText={invalid} />);
    expect(markup).toContain("Unsafe");
    expect(markup).not.toContain("<a");
    expect(markup).not.toContain("javascript");
  });

  it("keeps one title heading with inline breaks, and dispatches formatted scenes through the shared renderer", () => {
    const title = {
      paragraphs: [
        { kind: "paragraph" as const, runs: [{ text: "Project", bold: true as const }] },
        { kind: "paragraph" as const, runs: [{ text: "update" }] },
      ],
    };
    const titleMarkup = renderToStaticMarkup(<NativeRichTextView richText={title} title />);
    expect(titleMarkup).toMatch(/<h1[^>]*><strong>Project<\/strong><br\/>update<\/h1>/);
    expect(titleMarkup).not.toContain("<p");
    const block = createNativeContentBlock();
    const node = block.scene!.nodes[0]!;
    if (node.type !== "text") throw new Error("fixture");
    block.scene!.schemaVersion = 2;
    node.richText = title;
    node.text = "Project\nupdate";
    expect(renderToStaticMarkup(<NativeSceneView scene={block.scene!} />)).toContain(
      "<strong>Project</strong>",
    );
  });
});
