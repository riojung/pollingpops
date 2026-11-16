import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ContentSlideDraft, SupportedLocale } from "@openround/contracts";
import { ContentSlideView } from "./content-slide-view";
import { nativeAudienceCopy } from "./native-audience-copy";

const context = vi.hoisted(() => ({ locale: "ko-KR" as SupportedLocale }));
vi.mock("../locale-provider", () => ({ useLocale: () => context }));

function content(): ContentSlideDraft {
  return {
    id: "audience-content",
    kind: "content",
    layout: "title_body",
    textElements: [],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "PRIVATE author note",
    scene: {
      schemaVersion: 7,
      aspectRatio: "16:9",
      nodes: [
        {
          id: "spanish",
          type: "text",
          role: "title",
          text: "Contenido original",
          lang: "es",
          frame: { x: 5, y: 5, width: 90, height: 20 },
        },
        {
          id: "local-detail",
          type: "dialog",
          scope: "local",
          label: "Open details on this screen",
          detailTitle: "Original detail title",
          body: "Original detail content",
          frame: { x: 5, y: 30, width: 90, height: 40 },
        },
      ],
      readingOrder: ["spanish", "local-detail"],
    },
  };
}

describe("ContentSlideView application language boundary", () => {
  it("uses the provider language for native controls while retaining authored collisions", () => {
    const block = content(),
      before = JSON.stringify(block);
    const markup = renderToStaticMarkup(<ContentSlideView block={block} variant="live" />);
    expect(markup).toContain(nativeAudienceCopy("ko-KR")("Open details on this screen"));
    expect(markup).toContain('lang="ko-KR"');
    expect(markup).toContain('lang="es"');
    expect(markup).toContain('lang="">Open details on this screen</span>');
    expect(markup).toContain("Contenido original");
    expect(markup).not.toContain("PRIVATE author note");
    expect(JSON.stringify(block)).toBe(before);
  });

  it("honors an explicit renderer language without rewriting the content", () => {
    const block = content(),
      before = JSON.stringify(block);
    const markup = renderToStaticMarkup(
      <ContentSlideView block={block} variant="preview" locale="de-DE" />,
    );
    expect(markup).toContain(nativeAudienceCopy("de-DE")("Open details on this screen"));
    expect(markup).toContain('lang="de-DE"');
    expect(markup).toContain('lang="es"');
    expect(markup).not.toContain(nativeAudienceCopy("ko-KR")("Open details on this screen"));
    expect(JSON.stringify(block)).toBe(before);
  });

  it("retains the legacy renderer's explicit language boundary", () => {
    const block = { ...content(), scene: undefined };
    const markup = renderToStaticMarkup(<ContentSlideView block={block} variant="preview" />);
    expect(markup).toContain('lang="en-CA"');
  });
});
