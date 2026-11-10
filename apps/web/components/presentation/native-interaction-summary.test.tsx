import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { supportedLocales, type PresentationScene } from "@openround/contracts";
import { nativeInteractionCopy } from "./native-interaction-copy";
import {
  createNativeContentBlock,
  createNativeRevealNode,
  createNativeLinkNode,
  createNativeDialogNode,
  createNativeHotspotNode,
  createNativeNavigationNode,
} from "../../lib/presentation-native-scene";
import { describeNativeInteraction, NativeInteractionSummary } from "./native-interaction-summary";

function elements(tree: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, any>>(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}
const scene = createNativeContentBlock().scene!;
const targets = [{ id: "ABCDEFAB-1111-4111-8111-111111111111", title: "Decision checkpoint" }];

describe("interaction authoring overview", () => {
  it("distinguishes local, live broadcast and preview reveal scope without mutating the scene", () => {
    const node = { ...createNativeRevealNode(), label: "Show evidence", body: "Public evidence" };
    const before = JSON.stringify(scene);
    const local = describeNativeInteraction(scene, node, []);
    const shared = describeNativeInteraction(scene, { ...node, scope: "broadcast" }, []);
    expect(local.audience).toContain("own screen");
    expect(shared.trigger).toContain("facilitator");
    expect(shared.audience).toContain("Live: reveal for everyone");
    expect(shared.audience).toContain("Preview and shared links: this screen only");
    expect(shared.issues).toEqual([]);
    expect(JSON.stringify(scene)).toBe(before);
  });
  it("explains safe external links and refuses incomplete or unsafe destinations", () => {
    const node = {
      ...createNativeLinkNode(),
      label: "Visit source",
      href: "https://example.com/source",
    };
    expect(describeNativeInteraction(scene, node, []).result).toContain("in a new tab");
    for (const href of ["", "javascript:alert(1)", "https://user:password@example.com"]) {
      const summary = describeNativeInteraction(scene, { ...node, href }, []);
      expect(summary.issues).toHaveLength(1);
      expect(summary.result).not.toContain(href || "javascript:");
    }
  });
  it("resolves navigation only against supplied available targets, case-insensitively", () => {
    const node = {
      ...createNativeNavigationNode(),
      label: "Decide",
      targetBlockId: targets[0]!.id.toLowerCase(),
    };
    expect(describeNativeInteraction(scene, node, targets)).toMatchObject({
      result: "Go to “Decision checkpoint”.",
      issues: [],
    });
    expect(describeNativeInteraction(scene, node, []).issues).toContain(
      "Choose an available target slide or activity.",
    );
    expect(describeNativeInteraction(scene, node, targets).audience).toContain(
      "Live: move everyone",
    );
  });
  it("requires detail titles and audience content before a dialog can be tried", () => {
    const node = { ...createNativeDialogNode(), label: "Inspect" };
    expect(describeNativeInteraction(scene, node, []).issues).toHaveLength(2);
    expect(
      describeNativeInteraction(
        scene,
        { ...node, detailTitle: "Evidence", body: "Public detail" },
        [],
      ).issues,
    ).toEqual([]);
  });
  it("checks hotspot image association, rotation and complete frame containment", () => {
    const image = {
      id: "image",
      type: "image" as const,
      mediaId: "media",
      altText: null,
      frame: { x: 10, y: 30, width: 70, height: 50 },
    };
    const source: PresentationScene = {
      ...scene,
      schemaVersion: 6,
      nodes: [...scene.nodes, image],
      readingOrder: [...scene.readingOrder, image.id],
    };
    const node = {
      ...createNativeHotspotNode(image),
      label: "Inspect",
      detailTitle: "Evidence",
      body: "Public detail",
    };
    expect(describeNativeInteraction(source, node, []).issues).toEqual([]);
    expect(describeNativeInteraction(source, node, []).trigger).toContain("the linked image");
    for (const invalid of [
      { ...node, imageNodeId: "missing" },
      { ...node, rotation: 15 },
      { ...node, frame: { ...node.frame, x: 0 } },
    ])
      expect(describeNativeInteraction(source, invalid, []).issues).toHaveLength(1);
    const rotated = {
      ...source,
      nodes: source.nodes.map((n) => (n.id === image.id ? { ...image, rotation: 15 } : n)),
    };
    expect(describeNativeInteraction(rotated, node, []).issues).toHaveLength(1);
  });
  it("focuses the invoking action before opening preview and preserves the complete draft", () => {
    const node = { ...createNativeRevealNode(), label: "Show", body: "Complete content" };
    const focus = vi.fn(),
      preview = vi.fn(() => expect(focus).toHaveBeenCalledOnce());
    const tree = NativeInteractionSummary({ scene, node, onPreview: preview });
    const button = elements(tree).find((element) => element.type === "button")!;
    expect(button.props.disabled).toBe(false);
    button.props.onClick({ currentTarget: { focus } });
    expect(preview).toHaveBeenCalledOnce();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("does not start a live session or publish changes");
  });
  it("blocks preview while a draft/link entry is unavailable, even for a valid selected action", () => {
    const node = { ...createNativeRevealNode(), label: "Show", body: "Evidence" };
    const preview = vi.fn();
    const tree = NativeInteractionSummary({
      scene,
      node,
      onPreview: preview,
      previewUnavailableReason: "Correct the unsaved link entries on this slide before previewing.",
    });
    const button = elements(tree).find((element) => element.type === "button")!;
    expect(button.props.disabled).toBe(true);
    button.props.onClick({ currentTarget: { focus: vi.fn() } });
    expect(preview).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(tree)).toContain("unsaved link entries");
  });
  it.each(supportedLocales)(
    "localizes ready and blocked previews from current structured source data in %s",
    (locale) => {
      const copy = nativeInteractionCopy(locale);
      const node = {
        ...createNativeNavigationNode(),
        label: "Slide link",
        targetBlockId: targets[0]!.id.toLowerCase(),
      };
      const sourceBefore = JSON.stringify(scene);
      const preview = vi.fn();
      const ready = NativeInteractionSummary({
        scene,
        node,
        locale,
        navigationTargets: targets,
        onPreview: preview,
      });
      const button = elements(ready).find((element) => element.type === "button")!;
      expect(button.props.disabled).toBe(false);
      const focus = vi.fn();
      button.props.onClick({ currentTarget: { focus } });
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(preview).toHaveBeenCalledOnce();
      const html = renderToStaticMarkup(ready);
      expect(html).toContain(`lang="${locale}"`);
      expect(html).toContain(copy("Ready to try on this slide."));
      expect(html).toContain(copy("Preview this slide"));
      expect(html).toContain('<span lang="">Slide link</span>');
      expect(html).toContain('<span lang="">Decision checkpoint</span>');
      const unavailable = NativeInteractionSummary({
        scene,
        node,
        locale,
        navigationTargets: [],
        onPreview: preview,
      });
      const blockedButton = elements(unavailable).find((element) => element.type === "button")!;
      expect(blockedButton.props.disabled).toBe(true);
      blockedButton.props.onClick({ currentTarget: { focus } });
      expect(preview).toHaveBeenCalledOnce();
      const blockedHtml = renderToStaticMarkup(unavailable);
      expect(blockedHtml).toContain(copy("Choose an available target slide or activity."));
      expect(blockedHtml).not.toContain("Decision checkpoint");
      expect(blockedHtml).not.toContain(copy("Ready to try on this slide."));
      expect(JSON.stringify(scene)).toBe(sourceBefore);
    },
  );

  it("preserves authored collisions and placeholder-like text with explicit language boundaries", () => {
    const node = {
      ...createNativeDialogNode(),
      label: "Reveal panel {title}",
      detailTitle: "Detail dialog",
      body: "PRIVATE BODY NEVER IN OVERVIEW",
    };
    const html = renderToStaticMarkup(
      NativeInteractionSummary({ scene, node, locale: "ko-KR", onPreview: vi.fn() }),
    );
    expect(html).toContain('<span lang="">Reveal panel {title}</span>');
    expect(html).toContain('<span lang="">Detail dialog</span>');
    expect(html).toContain("상세 대화상자");
    expect(html).not.toContain("PRIVATE BODY");
    const navigation = {
      ...createNativeNavigationNode(),
      label: "the interaction",
      targetBlockId: targets[0]!.id,
    };
    const targetHtml = renderToStaticMarkup(
      NativeInteractionSummary({
        scene,
        node: navigation,
        navigationTargets: [{ ...targets[0]!, title: "Choose a slide or activity" }],
        locale: "ko-KR",
      }),
    );
    expect(targetHtml).toContain('<span lang="">the interaction</span>');
    expect(targetHtml).toContain('<span lang="">Choose a slide or activity</span>');
    const unlabeled = renderToStaticMarkup(
      NativeInteractionSummary({
        scene,
        node: { ...node, label: " ", detailTitle: " " },
        locale: "ko-KR",
      }),
    );
    expect(unlabeled).toContain("“상호작용”");
    expect(unlabeled).not.toContain('<span lang="">상호작용</span>');
    expect(unlabeled).toContain("상세 제목을 추가하세요.");
  });

  it("keeps URLs raw and non-executable while translating the surrounding result", () => {
    const node = {
      ...createNativeLinkNode(),
      label: "External link",
      href: "https://example.com/Detail-dialog?label={title}&other=Reveal",
    };
    const html = renderToStaticMarkup(NativeInteractionSummary({ scene, node, locale: "ko-KR" }));
    expect(html).toContain(
      '<span lang="">https://example.com/Detail-dialog?label={title}&amp;other=Reveal</span>',
    );
    expect(html).toContain("새 탭에서");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<a ");
    const unsafe = renderToStaticMarkup(
      NativeInteractionSummary({
        scene,
        node: { ...node, href: "javascript:alert(1)" },
        locale: "ko-KR",
      }),
    );
    expect(unsafe).toContain("완전하고 안전한 HTTP 또는 HTTPS URL을 추가하세요.");
    expect(unsafe).not.toContain("javascript:");
  });

  it("uses localized known preview guidance and retains unknown diagnostics explicitly as English", () => {
    const node = { ...createNativeRevealNode(), label: "Show", body: "Audience content" };
    for (const reason of [
      "Show this slide before previewing it.",
      "Finish the pending edit before previewing.",
      "Correct the unsaved link entries on this slide before previewing.",
    ] as const) {
      const html = renderToStaticMarkup(
        NativeInteractionSummary({
          scene,
          node,
          locale: "ko-KR",
          onPreview: vi.fn(),
          previewUnavailableReason: reason,
        }),
      );
      expect(html).toContain(nativeInteractionCopy("ko-KR")(reason));
      expect(html).toContain('<li lang="ko-KR">');
      expect(html).toMatch(/<button[^>]*disabled=""/);
    }
    const unknown = "Unexpected preview source: Detail dialog {id}";
    const html = renderToStaticMarkup(
      NativeInteractionSummary({
        scene,
        node,
        locale: "ko-KR",
        onPreview: vi.fn(),
        previewUnavailableReason: unknown,
      }),
    );
    expect(html).toContain(`<li lang="en-CA">${unknown}</li>`);
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it("refreshes localized hotspot source and containment guidance without exposing stale image text", () => {
    const image = {
      id: "image",
      type: "image" as const,
      mediaId: "media",
      altText: "the linked image",
      frame: { x: 10, y: 30, width: 70, height: 50 },
    };
    const source = { ...scene, nodes: [...scene.nodes, image] };
    const node = {
      ...createNativeHotspotNode(image),
      label: "Image hotspot",
      detailTitle: "Detail dialog",
      body: "NEVER EXPOSE BODY",
    };
    const valid = renderToStaticMarkup(
      NativeInteractionSummary({ scene: source, node, locale: "ko-KR", onPreview: vi.fn() }),
    );
    expect(valid).toContain('<span lang="">the linked image</span>');
    expect(valid).toContain("이 슬라이드에서 실행할 준비가 되었습니다.");
    const wrongType = {
      ...source,
      nodes: source.nodes.map((candidate) =>
        candidate.id === image.id ? { ...createNativeRevealNode(), id: image.id } : candidate,
      ),
    };
    const stale = renderToStaticMarkup(
      NativeInteractionSummary({ scene: wrongType, node, locale: "ko-KR", onPreview: vi.fn() }),
    );
    expect(stale).toContain("이 핫스폿의 이미지를 선택하세요.");
    expect(stale).not.toContain("the linked image");
    const moved = renderToStaticMarkup(
      NativeInteractionSummary({
        scene: source,
        node: { ...node, frame: { ...node.frame, x: 0 } },
        locale: "ko-KR",
        onPreview: vi.fn(),
      }),
    );
    expect(moved).toContain("핫스폿을 회전하지 않은 이미지 안에 유지하세요.");
    expect(moved).toMatch(/<button[^>]*disabled=""/);
    for (const html of [valid, stale, moved]) expect(html).not.toContain("NEVER EXPOSE BODY");
  });
});
