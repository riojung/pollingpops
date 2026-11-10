import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PresentationScene, SupportedLocale } from "@openround/contracts";
import { LocaleProvider } from "../locale-provider";
import { englishMessages, localeDomains } from "../../lib/i18n/catalog";
import { createNativeRevealNode } from "../../lib/presentation-native-scene";
import { NativeSceneEditor } from "./native-scene-editor";
import { nativeEditorCopy } from "./native-editor-copy";
import { nativeTextVideoCopy } from "./native-text-video-copy";
import { nativeInteractionCopy } from "./native-interaction-copy";

vi.mock("next/navigation", () => ({ usePathname: () => "/presentation/localized-native-editor" }));

const base: PresentationScene = {
  schemaVersion: 7,
  aspectRatio: "16:9",
  nodes: [
    {
      id: "Authored:BODY",
      type: "text",
      role: "body",
      text: "Original English evidence",
      lang: "es",
      frame: { x: 8, y: 35, width: 45, height: 25 },
    },
    {
      id: "Authored:TITLE",
      type: "text",
      role: "title",
      text: "Original English title",
      lang: "fr",
      frame: { x: 8, y: 5, width: 84, height: 20 },
    },
    {
      id: "Authored:SHAPE",
      type: "shape",
      shape: "rounded_rectangle",
      color: "blue",
      label: "rounded rectangle shape",
      frame: { x: 60, y: 40, width: 25, height: 25 },
    },
    {
      id: "Authored:CONNECTION",
      type: "connector",
      label: "Original English connection",
      color: "green",
      from: { nodeId: "Authored:BODY", anchor: "right" },
      to: { nodeId: "Authored:SHAPE", anchor: "left" },
    },
  ],
  readingOrder: ["Authored:TITLE", "Authored:BODY", "Authored:SHAPE", "Authored:CONNECTION"],
};

function markup(locale: SupportedLocale, scene = base, canEdit = true) {
  const change = vi.fn(),
    upload = vi.fn();
  const html = renderToStaticMarkup(
    <LocaleProvider
      initialLocale={locale}
      initialMessages={englishMessages}
      initialDomains={localeDomains}
    >
      <NativeSceneEditor
        scene={scene}
        canEdit={canEdit}
        onChange={change}
        renderImage={() => null}
        uploadsEnabled={false}
        mediaState="idle"
        onUploadImage={upload}
        onPreviewInteraction={vi.fn()}
        onTextAssistance={vi.fn()}
      />
    </LocaleProvider>,
  );
  return { html, change, upload };
}

/** Inspect language inheritance in real server-rendered markup, including display:contents boundaries. */
function languageAt(html: string, marker: string) {
  const stack: { tag: string; language?: string }[] = [];
  const voids = new Set([
    "input",
    "img",
    "br",
    "hr",
    "meta",
    "link",
    "source",
    "area",
    "base",
    "wbr",
  ]);
  for (const match of html.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
    const token = match[0];
    if (!token.startsWith("<")) {
      if (token.includes(marker))
        return [...stack].reverse().find((entry) => entry.language !== undefined)?.language;
      continue;
    }
    const tag = /^<\/?([a-z0-9-]+)/i.exec(token)![1]!;
    if (token.startsWith("</")) {
      stack.pop();
      continue;
    }
    const language = /\slang="([^"]*)"/.exec(token)?.[1];
    if (token.includes(marker))
      return (
        language ?? [...stack].reverse().find((entry) => entry.language !== undefined)?.language
      );
    if (!voids.has(tag) && !token.endsWith("/>")) stack.push({ tag, language });
  }
  throw new Error(`Missing language marker: ${marker}`);
}

describe("native editor real localized shell", () => {
  it.each(["en-CA", "ko-KR", "de-DE"] as SupportedLocale[])(
    "localizes the %s shell while preserving authored content, codes and language boundaries",
    (locale) => {
      const before = structuredClone(base),
        copy = nativeEditorCopy(locale);
      const { html, change, upload } = markup(locale);
      expect(html).toContain(`aria-label="${copy("Native slide editor")}" lang="${locale}"`);
      expect(html).toContain(copy("Editing on this slide"));
      expect(html).toContain(copy("Writing assistance"));
      expect(html).toContain(copy("Insert slide objects"));
      expect(html).toContain(copy("Object {field} (%)", { field: copy("width") }));
      expect(html).toContain(copy("Uploads are unavailable until malware scanning is configured."));
      expect(html).toContain(
        'value="Authored:BODY" lang="es" selected="">Original English evidence',
      );
      expect(html).toContain('value="Authored:SHAPE" lang="">rounded rectangle shape');
      expect(html).toContain('value="es" selected=""');
      expect(html).toContain('lang="es" maxLength="4000">Original English evidence</textarea>');
      expect(html).toContain('value="zh-Hans"');
      if (locale === "ko-KR") {
        for (const text of [
          "네이티브 슬라이드 편집기",
          "이 슬라이드 편집 중",
          "슬라이드 개체 삽입",
          "글쓰기 지원",
        ])
          expect(html).toContain(text);
        expect(html).toContain('value="fr">프랑스어');
      } else if (locale === "en-CA") expect(html).toContain('value="zh-Hans">Chinese (Simplified)');
      expect(languageAt(html, nativeTextVideoCopy(locale)("External video"))).toBe(locale);
      expect(languageAt(html, 'data-native-scene-canvas="true"')).toBe("en-CA");
      expect(base).toEqual(before);
      expect(change).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
    },
  );

  it("renders translated enum labels with exact stored values and raw authored labels", () => {
    const shape = base.nodes.find((node) => node.type === "shape")!;
    const shapeScene = {
      ...base,
      nodes: [shape, ...base.nodes.filter((node) => node.id !== shape.id)],
    };
    const before = structuredClone(shapeScene);
    const { html, change } = markup("ko-KR", shapeScene);
    expect(html).toContain('value="rounded_rectangle" selected="">둥근 사각형');
    expect(html).toContain('value="blue" selected=""');
    expect(html).toContain('lang="" maxLength="200" value="rounded rectangle shape"');
    expect(shapeScene).toEqual(before);
    expect(change).not.toHaveBeenCalled();
  });

  it("passes the locale to specialized editors and the authoring map while retaining the audience boundary", () => {
    const richScene: PresentationScene = {
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === "Authored:BODY" && node.type === "text"
          ? {
              ...node,
              richText: { paragraphs: [{ kind: "paragraph", runs: [{ text: node.text }] }] },
            }
          : node,
      ),
    };
    expect(
      languageAt(
        markup("ko-KR", richScene).html,
        `aria-label="${nativeTextVideoCopy("ko-KR")("Text formatting")}"`,
      ),
    ).toBe("ko-KR");
    const reveal = createNativeRevealNode();
    reveal.label = "Original English reveal";
    reveal.body = "Raw authored details";
    const interactionScene: PresentationScene = {
      ...base,
      nodes: [reveal, ...base.nodes],
      readingOrder: [...base.readingOrder, reveal.id],
    };
    const { html, change } = markup("ko-KR", interactionScene, false);
    expect(
      languageAt(html, `aria-label="${nativeInteractionCopy("ko-KR")("Interaction overview")}"`),
    ).toBe("ko-KR");
    expect(
      languageAt(html, `aria-label="${nativeInteractionCopy("ko-KR")("Interaction map")}"`),
    ).toBe("ko-KR");
    expect(html).toContain("Original English reveal");
    expect(html).toContain(nativeInteractionCopy("ko-KR")("Preview this slide"));
    expect(change).not.toHaveBeenCalled();
  });
});
