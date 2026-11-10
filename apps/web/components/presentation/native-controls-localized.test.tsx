import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PresentationScene, SupportedLocale } from "@openround/contracts";
import { LocaleProvider } from "../locale-provider";
import { englishMessages, localeDomains } from "../../lib/i18n/catalog";
import { NativeSceneEditor } from "./native-scene-editor";
import { createNativeRevealNode } from "../../lib/presentation-native-scene";
import { NativeSceneSelectionControls } from "./native-scene-selection-controls";
import {
  NativeSceneDesignControls,
  NativeSceneLayoutControls,
  NativeSceneArrangementControls,
  NativeSceneImageDesignControls,
} from "./native-scene-design-controls";
import { NativeSceneCompositionControls } from "./native-scene-composition-controls";
import {
  NativeSceneFitFeedback,
  nativeFitFeedbackText,
  type NativeFitFeedback,
} from "./native-scene-fit-feedback";

const measured = vi.hoisted(() => ({ feedback: null as NativeFitFeedback | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) =>
      typeof initial === "string" &&
      initial.startsWith("Check text fit after changing") &&
      measured.feedback
        ? [measured.feedback, () => {}]
        : react.useState(initial),
  };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/presentation/test" }));
const scene: PresentationScene = {
  schemaVersion: 4,
  aspectRatio: "16:9",
  design: { theme: "paper", font: "sans", spacing: "relaxed" },
  nodes: [
    {
      id: "title",
      type: "text",
      role: "title",
      text: "Authored English title",
      frame: { x: 8, y: 5, width: 84, height: 20 },
    },
    {
      id: "body",
      type: "text",
      role: "body",
      text: "Body text",
      frame: { x: 8, y: 35, width: 40, height: 30 },
    },
    {
      id: "shape",
      type: "shape",
      shape: "rounded_rectangle",
      label: "Original decision",
      color: "blue",
      frame: { x: 55, y: 40, width: 25, height: 20 },
    },
    {
      id: "fallback",
      type: "shape",
      shape: "rectangle",
      label: "",
      color: "green",
      frame: { x: 55, y: 70, width: 25, height: 20 },
    },
    {
      id: "image",
      type: "image",
      mediaId: "11111111-1111-4111-8111-111111111111",
      altText: "Original image",
      frame: { x: 8, y: 70, width: 40, height: 20 },
      fit: "cover",
      focalPoint: { x: 50, y: 50 },
    },
  ],
  readingOrder: ["title", "body", "shape", "fallback", "image"],
  groups: [{ id: "group", nodeIds: ["body", "shape"] }],
};

describe("native controls real localized rendering", () => {
  it.each(["en-CA", "ko-KR"] as SupportedLocale[])(
    "renders controls, guidance, values and authored boundaries in %s with no document writes",
    (locale) => {
      const changed = vi.fn(),
        before = structuredClone(scene);
      const image = scene.nodes.find((node) => node.type === "image")!;
      const html = renderToStaticMarkup(
        <LocaleProvider
          initialLocale={locale}
          initialMessages={englishMessages}
          initialDomains={localeDomains}
        >
          <NativeSceneSelectionControls
            scene={scene}
            selectedNodeIds={["body", "shape"]}
            onSelect={vi.fn()}
            onPointerDown={vi.fn()}
            onGeometryKey={vi.fn()}
          />
          <NativeSceneDesignControls
            scene={scene}
            onChange={changed}
            onApplyDesignToDeck={changed}
          />
          <NativeSceneLayoutControls scene={scene} onChange={changed} />
          <NativeSceneArrangementControls
            scene={scene}
            selectedIds={["body", "shape"]}
            selectedId="shape"
            onChange={changed}
          />
          <NativeSceneCompositionControls
            scene={scene}
            selectedIds={["body", "shape"]}
            selectedId="shape"
            onChange={changed}
          />
          <NativeSceneImageDesignControls scene={scene} node={image} onChange={changed} />
          <NativeSceneFitFeedback scene={scene} root={{ current: null }} />
        </LocaleProvider>,
      );
      expect(html).toContain('lang=""');
      expect(html).toContain('value="body" lang="">2. Body text');
      expect(html).toContain("Original decision");
      expect(html).toContain('value="sans" selected=""');
      expect(html).toContain('value="relaxed" selected=""');
      expect(html).toContain('value="cover" selected=""');
      if (locale === "ko-KR") {
        for (const text of [
          "선택한 개체 컨트롤",
          "캔버스 개체",
          "그룹 크기 조절",
          "슬라이드 글꼴",
          "시스템 산세리프",
          "네이티브 레이아웃",
          "개체 배치",
          "그룹화와 회전",
          "이미지 초점 X",
          "화살표 키",
          "텍스트가 맞는지 확인하세요",
        ])
          expect(html).toContain(text);
        expect(html).toContain("사각형 도형");
        expect(html).not.toContain("Use 종이 theme");
      } else {
        expect(html).toContain('aria-label="Resize group 1. Use arrow keys to change size."');
        expect(html).toContain('aria-label="Use Paper theme"');
        expect(html).toContain("Check text fit after changing");
      }
      expect(scene).toEqual(before);
      expect(changed).not.toHaveBeenCalled();
    },
  );
  it("relocalizes measured overflow descriptors without translating authored fallback words", () => {
    const feedback = { nodes: [scene.nodes[1]!], data: false };
    expect(nativeFitFeedbackText("en-CA", feedback)).toContain("Body text exceeds its frame");
    expect(nativeFitFeedbackText("ko-KR", feedback)).toContain("Body text이(가) 프레임을 넘습니다");
    expect(nativeFitFeedbackText("ko-KR", feedback)).toContain("텍스트 프레임을 키우거나");
    expect(nativeFitFeedbackText("ko-KR", { nodes: [scene.nodes[0]!], data: true })).toContain(
      "슬라이드 제목이(가)",
    );
  });
  it("keeps viewer interaction preview outside disabled editing fields in the real editor markup", () => {
    const reveal = createNativeRevealNode();
    reveal.label = "Authored reveal label";
    reveal.body = "Authored reveal content";
    const viewerScene: PresentationScene = {
      ...scene,
      schemaVersion: 6,
      nodes: [reveal, ...scene.nodes],
      readingOrder: [...scene.readingOrder, reveal.id],
    };
    const change = vi.fn(),
      preview = vi.fn();
    const html = renderToStaticMarkup(
      <LocaleProvider
        initialLocale="en-CA"
        initialMessages={englishMessages}
        initialDomains={localeDomains}
      >
        <NativeSceneEditor
          scene={viewerScene}
          canEdit={false}
          onChange={change}
          renderImage={() => null}
          uploadsEnabled
          mediaState="idle"
          onUploadImage={vi.fn()}
          onPreviewInteraction={preview}
        />
      </LocaleProvider>,
    );
    const disabled: boolean[] = [];
    let previewFound = false,
      fieldsFound = false,
      deleteFound = false;
    // Check actual HTML fieldset inheritance, including every nested editor boundary.
    for (const match of html.matchAll(
      /<fieldset\b[^>]*>|<\/fieldset>|<button\b[^>]*>[\s\S]*?<\/button>|<input\b[^>]*>/g,
    )) {
      const token = match[0];
      if (token.startsWith("<fieldset")) disabled.push(/\sdisabled(?:=|\s|>)/.test(token));
      else if (token === "</fieldset>") disabled.pop();
      else if (token.includes("Preview this slide")) {
        previewFound = true;
        expect(disabled.some(Boolean)).toBe(false);
        expect(token).not.toMatch(/\sdisabled(?:=|\s|>)/);
      } else if (token.includes('aria-label="Reveal panel label"')) {
        fieldsFound = true;
        expect(disabled.some(Boolean)).toBe(true);
      } else if (token.includes("Delete object")) {
        deleteFound = true;
        expect(token).toContain('disabled=""');
      }
    }
    expect(previewFound && fieldsFound && deleteFound).toBe(true);
    expect(html).toContain("Authored reveal label");
    expect(change).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
  });
  it("renders authoritative authored language on picker options and measured fit spans", () => {
    const markedScene: PresentationScene = {
      ...scene,
      nodes: scene.nodes.map((node): PresentationScene["nodes"][number] =>
        node.type === "text" ? { ...node, lang: "fr" } : node,
      ),
    };
    const before = structuredClone(markedScene);
    const onSelect = vi.fn(),
      geometry = vi.fn();
    measured.feedback = {
      nodes: [markedScene.nodes[0]!, markedScene.nodes[1]!, markedScene.nodes[2]!],
      data: false,
    };
    try {
      const html = renderToStaticMarkup(
        <LocaleProvider
          initialLocale="ko-KR"
          initialMessages={englishMessages}
          initialDomains={localeDomains}
        >
          <NativeSceneSelectionControls
            scene={markedScene}
            selectedNodeIds={["body"]}
            onSelect={onSelect}
            onPointerDown={vi.fn()}
            onGeometryKey={geometry}
          />
          <NativeSceneFitFeedback scene={markedScene} root={{ current: null }} />
        </LocaleProvider>,
      );
      expect(html).toContain('value="body" lang="fr" selected="">2. Body text');
      expect(html).toContain('<span lang="fr">, Body text</span>');
      expect(html).toContain('<span lang="">, Original decision</span>');
      expect(html).toContain('<span lang="ko-KR">슬라이드 제목</span>');
      expect(html).toContain('value="title" lang="ko-KR">1. 슬라이드 제목');
      expect(markedScene).toEqual(before);
      expect(onSelect).not.toHaveBeenCalled();
      expect(geometry).not.toHaveBeenCalled();
    } finally {
      measured.feedback = null;
    }
  });
});
