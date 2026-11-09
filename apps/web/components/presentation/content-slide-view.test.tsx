import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  contentSlideMediaFrame,
  type ContentSlideFrame,
  type ContentSlideLayout,
} from "@openround/contracts";
import { createContentBlock } from "../../lib/presentation-builder";
import { ContentSlideView } from "./content-slide-view";

const layouts: ContentSlideLayout[] = [
  "title",
  "title_body",
  "media",
  "quote",
  "section",
  "callout",
];

function renderedFrames(markup: string) {
  return [...markup.matchAll(/data-frame="([^"]+)"/g)].map(
    ([, value]) => JSON.parse(value!.replaceAll("&quot;", '"')) as ContentSlideFrame,
  );
}

function overlapsMedia(frame: ContentSlideFrame) {
  return (
    frame.x < contentSlideMediaFrame.x + contentSlideMediaFrame.width &&
    frame.x + frame.width > contentSlideMediaFrame.x &&
    frame.y < contentSlideMediaFrame.y + contentSlideMediaFrame.height &&
    frame.y + frame.height > contentSlideMediaFrame.y
  );
}

function EmptyMedia() {
  return null;
}

function slideFixture() {
  const block = createContentBlock();
  block.textElements = [
    {
      ...block.textElements[0]!,
      text: "Audience takeaway",
      region: "bottom_left",
      order: 0,
      frame: { x: 2, y: 70, width: 28, height: 20 },
    },
    {
      ...block.textElements[1]!,
      text: "Start with the evidence",
      region: "top_right",
      order: 0,
      frame: { x: 68, y: 5, width: 28, height: 20 },
    },
    {
      id: "second-body",
      role: "body",
      text: "Then explain the decision",
      region: "middle_left",
      order: 0,
      frame: { x: 2, y: 40, width: 28, height: 20 },
    },
  ];
  return block;
}

describe("ContentSlideView", () => {
  it("opts legacy slides into inert thumbnail artwork without editor controls", () => {
    const block = slideFixture();
    const markup = renderToStaticMarkup(
      <ContentSlideView block={block} variant="editor" staticThumbnail />,
    );
    expect(markup).toContain('data-static-thumbnail="true"');
    expect(markup).toContain('inert=""');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("Start with the evidence");
    expect(markup).toContain('style="left:68%;top:5%;width:28%;height:20%"');
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<textarea");
    const ordinary = renderToStaticMarkup(<ContentSlideView block={block} variant="preview" />);
    expect(ordinary).not.toContain("data-static-thumbnail");
    expect(ordinary).not.toContain('inert=""');
  });

  it.each(["constructor", "toString", "__proto__"])(
    "resolves opaque element ID %s without reading inherited transient properties",
    (id) => {
      const block = slideFixture();
      block.textElements[0]!.id = id;
      const markup = renderToStaticMarkup(<ContentSlideView block={block} variant="editor" />);
      expect(markup).not.toContain("undefined%");
      expect(markup).toContain('style="left:2%;top:70%;width:28%;height:20%"');
    },
  );
  it.each(["editor", "preview", "live"] as const)(
    "renders %s text in the shared top-to-bottom, left-to-right region order",
    (variant) => {
      const markup = renderToStaticMarkup(
        <ContentSlideView block={slideFixture()} variant={variant} />,
      );
      const first = markup.indexOf("Start with the evidence");
      const second = markup.indexOf("Then explain the decision");
      const third = markup.indexOf("Audience takeaway");

      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(second);
      expect(second).toBeLessThan(third);
      expect(markup.match(/data-region=/g)).toHaveLength(9);
    },
  );

  it("exposes keyboard movement handles only while editing", () => {
    const editor = renderToStaticMarkup(
      <ContentSlideView block={slideFixture()} variant="editor" />,
    );
    const live = renderToStaticMarkup(<ContentSlideView block={slideFixture()} variant="live" />);

    expect(editor).toContain("Move Slide title. Drag to position or use arrow keys to nudge.");
    expect(live).not.toContain("Move Slide title.");
  });

  it.each(["editor", "preview", "live"] as const)(
    "gives every named region and text group a valid group role in %s mode",
    (variant) => {
      const markup = renderToStaticMarkup(
        <ContentSlideView block={slideFixture()} variant={variant} />,
      );
      const labelledDivs = markup.match(/<div\b[^>]*aria-label="[^"]*"[^>]*>/g) ?? [];

      expect(labelledDivs).toHaveLength(12);
      expect(labelledDivs.every((tag) => tag.includes('role="group"'))).toBe(true);
      expect(markup).toContain('aria-label="Top left region"');
      expect(markup).toContain('aria-label="Slide title, Bottom left"');
    },
  );

  it("uses the same resolved percentage frames in editor, preview, and live output", () => {
    const block = slideFixture();
    const arrangements = (["editor", "preview", "live"] as const).map((variant) => {
      const markup = renderToStaticMarkup(<ContentSlideView block={block} variant={variant} />);
      return markup.match(/data-frame="[^"]*"/g);
    });

    expect(arrangements[0]).toEqual(arrangements[1]);
    expect(arrangements[1]).toEqual(arrangements[2]);
    expect(arrangements[0]).toContain(
      'data-frame="{&quot;x&quot;:2,&quot;y&quot;:70,&quot;width&quot;:28,&quot;height&quot;:20}"',
    );
  });

  it("shows the editor grid by default and supports hiding it", () => {
    const block = slideFixture();
    const editor = renderToStaticMarkup(<ContentSlideView block={block} variant="editor" />);
    const hiddenEditor = renderToStaticMarkup(
      <ContentSlideView block={block} showGuides={false} variant="editor" />,
    );
    const preview = renderToStaticMarkup(<ContentSlideView block={block} variant="preview" />);

    expect(editor).toContain('aria-hidden="true"');
    expect(editor).toContain('viewBox="0 0 100 100"');
    expect(hiddenEditor).not.toContain('viewBox="0 0 100 100"');
    expect(preview).not.toContain('viewBox="0 0 100 100"');
  });

  it("exposes a keyboard-operable resize handle for the selected editor element", () => {
    const block = slideFixture();
    const markup = renderToStaticMarkup(
      <ContentSlideView
        block={block}
        onChangeFrame={() => {}}
        selectedElementId={block.textElements[0]!.id}
        variant="editor"
      />,
    );

    expect(markup).toContain(
      'aria-label="Resize Slide title. Use arrow keys to change width and height."',
    );
  });

  it.each(layouts)(
    "keeps %s text frames outside the reserved image area across variants",
    (layout) => {
      for (const frameMode of ["legacy", "unsafe-explicit"] as const) {
        const block = createContentBlock(layout);
        block.mediaId = `media-${layout}`;
        block.textElements = block.textElements.map((element, index) => {
          if (frameMode === "legacy") {
            const legacyElement = { ...element };
            delete legacyElement.frame;
            return legacyElement;
          }
          return {
            ...element,
            frame:
              index === 0
                ? { x: 62, y: 76, width: 22, height: 12 }
                : { x: 75, y: 80, width: 20, height: 14 },
          };
        });

        const media = <img alt="Slide illustration" src="/slide-illustration.png" />;
        const markups = (["editor", "preview", "live"] as const).map((variant) =>
          renderToStaticMarkup(<ContentSlideView block={block} media={media} variant={variant} />),
        );
        const frames = markups.map(renderedFrames);

        expect(frames[0]).toEqual(frames[1]);
        expect(frames[1]).toEqual(frames[2]);
        expect(frames[0]).toHaveLength(block.textElements.length);
        expect(frames[0]!.every((frame) => !overlapsMedia(frame))).toBe(true);
        for (const markup of markups) {
          expect(markup).toContain(
            'data-media-frame="{&quot;x&quot;:60,&quot;y&quot;:75,&quot;width&quot;:36,&quot;height&quot;:22}"',
          );
          expect(markup).toContain('style="left:60%;top:75%;width:36%;height:22%"');
        }
        expect(markups[0]).toContain('aria-hidden="true"');
        expect(markups[0]).toContain('data-media-bay="true"');
        expect(markups[0]).toContain("Image area");
        expect(markups[1]).not.toContain('data-media-bay="true"');
        expect(markups[2]).not.toContain('data-media-bay="true"');
      }
    },
  );

  it("treats an explicit null media ID as authoritative when a media component renders null", () => {
    const block = createContentBlock("title_body");
    block.mediaId = null;
    const emptyMedia = <EmptyMedia />;

    for (const variant of ["editor", "preview", "live"] as const) {
      const withoutMedia = renderToStaticMarkup(
        <ContentSlideView block={block} variant={variant} />,
      );
      const withEmptyMediaNode = renderToStaticMarkup(
        <ContentSlideView block={block} media={emptyMedia} variant={variant} />,
      );

      expect(renderedFrames(withEmptyMediaNode)).toEqual(renderedFrames(withoutMedia));
      expect(withEmptyMediaNode).not.toContain('data-media-bay="true"');
      expect(withEmptyMediaNode).not.toContain("Image area");
      expect(withEmptyMediaNode).not.toContain("data-media-frame=");
    }
  });

  it("reserves the media bay from media ID before the image component is available", () => {
    const block = createContentBlock("title_body");
    block.mediaId = "pending-image";
    block.textElements = block.textElements.map((element, index) => ({
      ...element,
      frame:
        index === 0
          ? { x: 62, y: 76, width: 22, height: 12 }
          : { x: 75, y: 80, width: 20, height: 14 },
    }));

    const markups = (["editor", "preview", "live"] as const).map((variant) =>
      renderToStaticMarkup(<ContentSlideView block={block} variant={variant} />),
    );
    const frames = markups.map(renderedFrames);

    expect(frames[0]).toEqual(frames[1]);
    expect(frames[1]).toEqual(frames[2]);
    expect(frames[0]!.every((frame) => !overlapsMedia(frame))).toBe(true);
    expect(markups[0]).toContain('data-media-bay="true"');
    expect(markups[0]).toContain("Image area");
    expect(markups[0]).not.toContain("data-media-frame=");
    expect(markups[1]).not.toContain('data-media-bay="true"');
    expect(markups[2]).not.toContain('data-media-bay="true"');
  });
});
