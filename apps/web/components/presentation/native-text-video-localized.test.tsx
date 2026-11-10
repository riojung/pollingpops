import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  supportedLocales,
  type PresentationScene,
  type PresentationSceneNode,
} from "@openround/contracts";
import { NativeRichTextEditor } from "./native-rich-text-editor";
import { NativeSceneVideoControls } from "./native-scene-video-controls";
import { nativeTextVideoCopy } from "./native-text-video-copy";

const authored: Extract<PresentationSceneNode, { type: "text" }> = {
  id: "authored-fr",
  type: "text",
  role: "body",
  text: "Original English text\nTexte français",
  lang: "fr",
  richText: {
    paragraphs: [
      {
        kind: "bullet",
        runs: [
          {
            text: "Original English text",
            bold: true,
            href: "https://example.com/original?lang=fr",
          },
        ],
      },
      { kind: "numbered", runs: [{ text: "Texte français", italic: true }] },
    ],
  },
  frame: { x: 8, y: 35, width: 55, height: 25 },
};
const scene: PresentationScene = {
  schemaVersion: 7,
  aspectRatio: "16:9",
  nodes: [authored],
  readingOrder: [authored.id],
};
const encoded = (value: string) => renderToStaticMarkup(<>{value}</>);

describe("localized native text and video markup", () => {
  it.each(supportedLocales)("renders localized controls with authored language in %s", (locale) => {
    const before = structuredClone(scene);
    const onChange = vi.fn();
    const onSelect = vi.fn();
    const copy = nativeTextVideoCopy(locale);
    const rich = renderToStaticMarkup(
      <NativeRichTextEditor node={authored} locale={locale} onChange={onChange} />,
    );
    const video = renderToStaticMarkup(
      <NativeSceneVideoControls
        scene={scene}
        locale={locale}
        canAdd
        onChange={onChange}
        onSelect={onSelect}
      />,
    );
    expect(rich).toContain(`<div lang="${locale}"`);
    expect(rich).toContain('textarea lang="fr"');
    expect(rich).toContain(`aria-label="${encoded(copy("Node text"))}"`);
    expect(rich).toContain(`aria-label="${encoded(copy("Text formatting"))}"`);
    expect(rich).toContain(`aria-label="${encoded(copy("Paragraph style"))}"`);
    expect(rich).toContain(`aria-label="${encoded(copy("Link address"))}"`);
    expect(rich).toContain('<input lang=""');
    expect(rich).toContain(encoded(authored.text));
    for (const key of ["Bold", "Italic", "Apply link", "Remove link", "Remove formatting"] as const)
      expect(rich).toContain(`>${encoded(copy(key))}</button>`);
    for (const [value, key] of [
      ["", "Choose for selected paragraphs"],
      ["paragraph", "Paragraph"],
      ["bullet", "Bulleted list"],
      ["numbered", "Numbered list"],
    ] as const)
      expect(rich).toMatch(
        new RegExp(`<option value="${value}"[^>]*>${encoded(copy(key))}</option>`),
      );
    expect(video).toContain(`<fieldset lang="${locale}"`);
    expect(video).toContain(`<legend>${encoded(copy("External video"))}</legend>`);
    for (const key of [
      "Video title",
      "Video HTTPS link",
      "Captions or transcript HTTPS link",
    ] as const)
      expect(video).toContain(`<label>${encoded(copy(key))}<input lang=""`);
    expect(video).toContain(`>${encoded(copy("Add external video link"))}</button>`);
    expect(scene).toEqual(before);
    expect(onChange).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps title formatting options bounded and marks unannotated authored text as unknown", () => {
    const { lang: _language, ...unmarked } = authored;
    void _language;
    const html = renderToStaticMarkup(
      <NativeRichTextEditor
        node={{ ...unmarked, role: "title" }}
        locale="ko-KR"
        onChange={vi.fn()}
      />,
    );
    expect(html).toContain('textarea lang=""');
    expect(html).toContain('aria-label="네이티브 슬라이드 제목"');
    expect(html).not.toContain('value="bullet"');
    expect(html).not.toContain('value="numbered"');
    expect(html).toContain(encoded(authored.text));
  });
});
