import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PresentationSceneDraftSchema,
  type PresentationScene,
  type PresentationSceneNode,
  type SupportedLocale,
} from "@openround/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createNativeContentBlock,
  createNativeLinkNode,
  createNativeRevealNode,
  createNativeDialogNode,
  createNativeNavigationNode,
  createNativeHotspotNode,
} from "../../lib/presentation-native-scene";
import { NativeSceneInteractionEditor } from "./native-scene-interaction-editor";
import { NativeInteractionSummary } from "./native-interaction-summary";
import { nativeInteractionCopy } from "./native-interaction-copy";

const mocked = vi.hoisted(() => ({ hooks: null as { cursor: number; slots: unknown[] } | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index] as T,
        (next: T | ((value: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function" ? (next as (value: T) => T)(hooks.slots[index] as T) : next;
        },
      ];
    },
  };
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

type InteractionNode = Extract<
  PresentationSceneNode,
  { type: "link" | "reveal" | "hotspot" | "dialog" | "navigation" }
>;

function harness(
  initial: InteractionNode,
  accept = () => true,
  onPreview?: () => void,
  options: { locale?: SupportedLocale; disabled?: boolean } = {},
) {
  let locale = options.locale;
  let disabled = options.disabled;
  let navigationTargets = [
    { id: "11111111-1111-4111-8111-111111111111", title: "Next checkpoint" },
  ];
  const base = createNativeContentBlock().scene!;
  let scene: PresentationScene = {
    ...base,
    schemaVersion: ["hotspot", "dialog", "navigation"].includes(initial.type) ? 6 : 5,
    nodes: [...base.nodes, initial],
    readingOrder: [...base.readingOrder, initial.id],
  };
  let selected: string | null = initial.id;
  const hooks = { cursor: 0, slots: [] as unknown[] };
  let tree: ReactNode;
  const onChange = vi.fn((next: PresentationScene, _field?: string) => {
    if (!accept()) return false;
    expect(PresentationSceneDraftSchema.safeParse(next).success).toBe(true);
    scene = next;
    return true;
  });
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      tree = NativeSceneInteractionEditor({
        scene,
        locale,
        disabled,
        node: (scene.nodes.find((item) => item.id === selected) as InteractionNode) ?? null,
        onChange,
        onPreview,
        navigationTargets,
      });
    } finally {
      mocked.hooks = null;
    }
  }
  function control(label: string) {
    const found = elements(tree).find((element) => element.props["aria-label"] === label);
    if (!found) throw new Error(`Missing ${label}`);
    return found;
  }
  render();
  return {
    onChange,
    control,
    locale(next: SupportedLocale) {
      locale = next;
      render();
    },
    disabled(next: boolean) {
      disabled = next;
      render();
    },
    targets(next: typeof navigationTargets) {
      navigationTargets = next;
      render();
    },
    source(next: PresentationScene) {
      scene = next;
      render();
    },
    get scene() {
      return scene;
    },
    change(label: string, value: string) {
      (control(label).props.onChange as (event: unknown) => void)({ target: { value } });
      render();
    },
    select(id: string | null) {
      selected = id;
      render();
    },
    upstream(update: (node: InteractionNode) => InteractionNode) {
      scene = {
        ...scene,
        nodes: scene.nodes.map((item) =>
          item.id === initial.id ? update(item as InteractionNode) : item,
        ),
      };
      render();
    },
    markup() {
      return renderToStaticMarkup(tree);
    },
    overview() {
      return elements(tree).find((element) => element.type === NativeInteractionSummary)!;
    },
    alerts() {
      return elements(tree)
        .filter((element) => element.props.role === "alert")
        .map((element) => element.props.children)
        .join(" ");
    },
  };
}

describe("native audience interaction editing", () => {
  it.each(["https://user:secret@example.com", "https://example.com/rejected"])(
    "retains the slide-wide preview barrier for an unsaved URL after selecting another action (%s)",
    (entry) => {
      const link = {
        ...createNativeLinkNode(),
        label: "Source",
        href: "https://example.com/saved",
      };
      const editor = harness(link, () => false, vi.fn());
      const reveal = {
        ...createNativeRevealNode(),
        label: "Show evidence",
        body: "Audience content",
      };
      editor.scene.nodes.push(reveal);
      editor.scene.readingOrder.push(reveal.id);
      editor.change("Link URL", entry);
      editor.select(reveal.id);
      expect(editor.overview().props.previewUnavailableReason).toContain("unsaved link entries");
      expect(editor.markup()).toContain("Preview this slide</button>");
      expect(editor.markup()).toMatch(/<button[^>]*disabled=""[^>]*>Preview this slide/);
      editor.upstream((node) =>
        node.type === "link" ? { ...node, href: "https://example.com/recovered" } : node,
      );
      expect(editor.overview().props.previewUnavailableReason).toBeUndefined();
      expect(editor.markup()).not.toContain("unsaved link entries");
    },
  );
  it("promotes an existing local reveal to broadcast without losing audience content", () => {
    const reveal = { ...createNativeRevealNode(), label: "Evidence", body: "Audience evidence" };
    const editor = harness(reveal);
    editor.change("Reveal audience", "broadcast");
    expect(editor.scene.schemaVersion).toBe(6);
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      scope: "broadcast",
      label: reveal.label,
      body: reveal.body,
    });
    expect(editor.onChange.mock.calls[0]?.[1]).toBe(`native:${reveal.id}:scope`);
  });
  it("edits detail fields independently and stores a stable internal target ID", () => {
    const dialog = createNativeDialogNode();
    const editor = harness(dialog);
    editor.change("Detail button label", "Inspect");
    editor.change("Detail title", "Evidence detail");
    editor.change("Detail audience content", "Plain audience body");
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      type: "dialog",
      label: "Inspect",
      detailTitle: "Evidence detail",
      body: "Plain audience body",
    });
    expect(editor.onChange.mock.calls.map((call) => call[1])).toEqual([
      `native:${dialog.id}:label`,
      `native:${dialog.id}:detailTitle`,
      `native:${dialog.id}:body`,
    ]);
    const link = createNativeNavigationNode();
    const navigation = harness(link);
    navigation.change("Target slide or activity", "11111111-1111-4111-8111-111111111111");
    expect(navigation.scene.nodes.at(-1)).toMatchObject({
      type: "navigation",
      targetBlockId: "11111111-1111-4111-8111-111111111111",
    });
  });
  it("retains an unsafe URL locally across selection and geometry changes, then saves a corrected URL into field history", () => {
    const link = { ...createNativeLinkNode(), href: "https://example.com/original" };
    const editor = harness(link);
    editor.change("Link URL", "javascript:alert(1)");
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(editor.scene.nodes.at(-1)).toMatchObject({ href: link.href });
    expect(editor.control("Link URL").props).toMatchObject({
      value: "javascript:alert(1)",
      "aria-invalid": true,
    });
    expect(editor.alerts()).toContain("not saved");
    editor.select(null);
    editor.select(link.id);
    editor.upstream((node) => ({ ...node, frame: { ...node.frame, x: 60 } }));
    expect(editor.control("Link URL").props.value).toBe("javascript:alert(1)");
    editor.change("Link URL", "https://example.com/corrected");
    expect(editor.alerts()).toBe("");
    expect(editor.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ schemaVersion: 5 }),
      `native:${link.id}:href`,
    );
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      href: "https://example.com/corrected",
      frame: { x: 60 },
    });
    expect(editor.markup()).not.toContain("<a ");
  });

  it("retains a rejected safe URL for retry and honors upstream Undo/Redo destinations", () => {
    let accepted = false;
    const link = { ...createNativeLinkNode(), href: "https://example.com/original" };
    const editor = harness(link, () => accepted);
    editor.change("Link URL", "https://example.com/next");
    expect(editor.alerts()).toContain("entry is retained");
    expect(editor.control("Link URL").props.value).toBe("https://example.com/next");
    accepted = true;
    editor.change("Link URL", "https://example.com/next");
    expect(editor.scene.nodes.at(-1)).toMatchObject({ href: "https://example.com/next" });
    editor.change("Link URL", "https://unfinished ");
    editor.upstream((node) => (node.type === "link" ? { ...node, href: link.href } : node));
    expect(editor.control("Link URL").props.value).toBe(link.href);
    expect(editor.alerts()).toBe("");
    editor.upstream((node) =>
      node.type === "link" ? { ...node, href: "https://example.com/next" } : node,
    );
    expect(editor.control("Link URL").props.value).toBe("https://example.com/next");
    editor.change("Link URL", "");
    expect(editor.scene.nodes.at(-1)).toMatchObject({ href: "" });
  });

  it("edits reveal labels and audience content with separate history fields and no active disclosure", () => {
    const reveal = createNativeRevealNode();
    const editor = harness(reveal);
    editor.change("Reveal panel label", "Read the explanation");
    editor.change("Revealed audience content", "First line\nSecond line");
    expect(editor.onChange.mock.calls.map((call) => call[1])).toEqual([
      `native:${reveal.id}:label`,
      `native:${reveal.id}:body`,
    ]);
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      label: "Read the explanation",
      body: "First line\nSecond line",
      scope: "local",
    });
    expect(editor.control("Revealed audience content").props["data-native-text-input"]).toBe(
      "true",
    );
    expect(editor.markup()).toContain("available to every viewer");
    expect(editor.markup()).not.toContain("<button");
  });
  it("keeps an active unsafe URL and its source fence across locale changes, while translating validation and the preview barrier", () => {
    const link = {
      ...createNativeLinkNode(),
      label: "External link",
      href: "https://example.com/original",
    };
    const preview = vi.fn();
    const editor = harness(link, () => true, preview);
    const before = JSON.stringify(editor.scene);
    const rawEntry = "https://user:secret@example.com/{label} unfinished";
    editor.change("Link URL", rawEntry);
    const errorId = editor.control("Link URL").props["aria-describedby"];
    editor.locale("ko-KR");
    expect(editor.control("링크 URL").props).toMatchObject({
      value: rawEntry,
      "aria-invalid": true,
      "aria-describedby": errorId,
      lang: "",
    });
    expect(editor.control("링크 레이블").props).toMatchObject({ value: "External link", lang: "" });
    expect(editor.alerts()).toBe(
      nativeInteractionCopy("ko-KR")(
        "This URL is not saved. Use a complete HTTP or HTTPS link without spaces or sign-in credentials.",
      ),
    );
    expect(editor.markup()).toContain(
      "미리보기 전에 이 슬라이드에서 저장되지 않은 링크 입력을 수정하세요.",
    );
    expect(editor.markup()).toMatch(/<button[^>]*disabled=""[^>]*>이 슬라이드 미리보기/);
    expect(JSON.stringify(editor.scene)).toBe(before);
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    editor.locale("de-DE");
    expect(editor.control("Link-URL").props.value).toBe(rawEntry);
    editor.upstream((node) =>
      node.type === "link" ? { ...node, href: "https://example.com/recovered" } : node,
    );
    expect(editor.control("Link-URL").props).toMatchObject({
      value: "https://example.com/recovered",
      "aria-invalid": false,
    });
    expect(editor.alerts()).toBe("");
    editor.change("Link-URL", "https://example.com/final");
    expect(editor.onChange.mock.calls.at(-1)?.[1]).toBe(`native:${link.id}:href`);
    expect(editor.scene.nodes.at(-1)).toMatchObject({ href: "https://example.com/final" });
  });

  it("translates a rejected safe URL entry without retrying or saving it on a locale change", () => {
    const link = { ...createNativeLinkNode(), label: "Read", href: "https://example.com/original" };
    const editor = harness(link, () => false, vi.fn());
    editor.change("Link URL", "https://example.com/next");
    expect(editor.onChange).toHaveBeenCalledOnce();
    editor.locale("ko-KR");
    expect(editor.alerts()).toContain("입력한 내용은 유지됩니다");
    expect(editor.control("링크 URL").props.value).toBe("https://example.com/next");
    expect(editor.onChange).toHaveBeenCalledOnce();
    const reveal = {
      ...createNativeRevealNode(),
      id: link.id,
      label: "Reveal panel",
      body: "Authored content",
    };
    editor.source({
      ...editor.scene,
      nodes: editor.scene.nodes.map((node) => (node.id === link.id ? reveal : node)),
    });
    expect(editor.markup()).not.toContain("저장되지 않은 링크 입력");
    expect(editor.overview().props.previewUnavailableReason).toBeUndefined();
  });

  it("keeps unavailable target IDs and raw authored target titles while changing localized controls", () => {
    const targetId = "11111111-1111-4111-8111-111111111111";
    const navigation = {
      ...createNativeNavigationNode(),
      label: "Slide link",
      targetBlockId: targetId,
    };
    const editor = harness(navigation, () => true, vi.fn(), { locale: "ko-KR" });
    editor.targets([{ id: targetId, title: "Choose target" }]);
    expect(editor.markup()).toContain(
      `<option value="${targetId}" lang="" selected="">Choose target</option>`,
    );
    editor.targets([]);
    expect(editor.control("대상 슬라이드 또는 활동").props.value).toBe(targetId);
    expect(editor.markup()).toContain("사용할 수 없는 대상 — 다른 대상 선택");
    expect(editor.markup()).toContain("사용 가능한 대상 슬라이드 또는 활동을 선택하세요.");
    expect(editor.markup()).toMatch(/<button[^>]*disabled=""[^>]*>이 슬라이드 미리보기/);
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      targetBlockId: targetId,
      label: "Slide link",
    });
    expect(editor.onChange).not.toHaveBeenCalled();
  });

  it("preserves read-only authoring guards while leaving a ready localized preview available", () => {
    const node = {
      ...createNativeRevealNode(),
      label: "Reveal panel",
      body: "Authored audience content",
    };
    const preview = vi.fn();
    const editor = harness(node, () => true, preview, { locale: "ko-KR", disabled: true });
    const before = JSON.stringify(editor.scene);
    expect(editor.markup()).toContain('<fieldset disabled=""');
    expect(editor.markup()).toContain('<span lang="">Reveal panel</span>');
    expect(editor.markup()).toContain("이 슬라이드에서 실행할 준비가 되었습니다.");
    editor.change("공개 패널 레이블", "Changed");
    editor.change("공개 대상", "broadcast");
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(JSON.stringify(editor.scene)).toBe(before);
    const overview = NativeInteractionSummary(
      editor.overview().props as Parameters<typeof NativeInteractionSummary>[0],
    );
    const button = elements(overview).find((element) => element.type === "button")!;
    expect(button.props.disabled).toBe(false);
    const focus = vi.fn();
    (button.props.onClick as (event: unknown) => void)({ currentTarget: { focus } });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(preview).toHaveBeenCalledOnce();
    const link = harness(
      { ...createNativeLinkNode(), label: "Read", href: "https://example.com" },
      () => true,
      preview,
      { locale: "ko-KR", disabled: true },
    );
    link.change("링크 URL", "javascript:alert(1)");
    expect(link.onChange).not.toHaveBeenCalled();
    expect(link.control("링크 URL").props.value).toBe("https://example.com");
    expect(link.alerts()).toBe("");
  });

  it("uses localized hotspot image fallbacks and rotation guidance without changing image associations or frames", () => {
    const image = {
      id: "author-image",
      type: "image" as const,
      mediaId: "media",
      altText: "Image",
      rotation: 15,
      frame: { x: 10, y: 10, width: 70, height: 70 },
    };
    const hotspot = {
      ...createNativeHotspotNode(image),
      label: "Image hotspot",
      detailTitle: "Detail dialog",
      body: "Authored content",
    };
    const editor = harness(hotspot, () => true, undefined, { locale: "ko-KR" });
    const secondImage = { ...image, id: "unlabeled-image", altText: "", rotation: 0 };
    editor.source({ ...editor.scene, nodes: [...editor.scene.nodes, image, secondImage] });
    const before = JSON.stringify(editor.scene);
    expect(editor.markup()).toContain(
      '<option value="author-image" lang="" selected="">Image · 게시 전에 0°로 회전하세요</option>',
    );
    expect(editor.markup()).toContain(
      '<option value="unlabeled-image" lang="ko-KR">이미지</option>',
    );
    editor.locale("ja-JP");
    expect(JSON.stringify(editor.scene)).toBe(before);
    expect(editor.control("ホットスポットの画像").props.value).toBe(image.id);
    expect(editor.onChange).not.toHaveBeenCalled();
  });
});
