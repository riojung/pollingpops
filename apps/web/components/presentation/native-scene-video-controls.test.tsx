import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_SCENE_MAX_BYTES,
  PresentationSceneDraftSchema,
  type PresentationScene,
  type SupportedLocale,
} from "@openround/contracts";
import * as nativeVideo from "../../lib/presentation-native-video";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import { createNativeChartNode, createNativeTableNode } from "../../lib/presentation-native-data";
import { NativeSceneVideoControls } from "./native-scene-video-controls";
import { nativeTextVideoCopy, type NativeTextVideoCopyKey } from "./native-text-video-copy";

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
        (next: T) => {
          hooks.slots[index] = next;
        },
      ];
    },
  };
});
beforeEach(() => {
  mocked.hooks = { cursor: 0, slots: [] };
});
afterEach(() => {
  mocked.hooks = null;
  vi.restoreAllMocks();
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<Record<string, unknown>>(node)) return text(node.props.children as ReactNode);
  return typeof node === "string" ? node : "";
}
function sceneFixture(): PresentationScene {
  const scene = createNativeContentBlock().scene!;
  const table = { ...createNativeTableNode(), rotation: 5 };
  const chart = createNativeChartNode();
  return {
    ...scene,
    schemaVersion: 4,
    design: { theme: "midnight", font: "serif", spacing: "compact" },
    groups: [{ id: "data-group", nodeIds: [table.id, chart.id] }],
    nodes: [...scene.nodes, table, chart],
    readingOrder: [...scene.readingOrder, table.id, chart.id],
  };
}
function fullScene(): PresentationScene {
  const scene = sceneFixture();
  for (let index = 0; index < 35; index += 1)
    scene.nodes.push({
      id: `body-${index}`,
      type: "text",
      role: "body",
      text: "",
      frame: { x: 10, y: 30, width: 40, height: 50 },
    });
  scene.readingOrder = scene.nodes.map((node) => node.id);
  let remaining =
    PRESENTATION_SCENE_MAX_BYTES - 1 - new TextEncoder().encode(JSON.stringify(scene)).byteLength;
  for (const node of scene.nodes) {
    if (node.type !== "text" || node.role !== "body") continue;
    const length = Math.min(4000, remaining);
    node.text = "x".repeat(length);
    remaining -= length;
  }
  expect(remaining).toBe(0);
  expect(PresentationSceneDraftSchema.safeParse(scene).success).toBe(true);
  return scene;
}

function harness(initial = sceneFixture(), accept?: () => boolean | void, canAdd = true) {
  let scene = initial;
  let locale: SupportedLocale = "en-CA";
  let tree: ReactNode;
  const onSelect = vi.fn();
  const onChange = vi.fn((next: PresentationScene) => {
    if (accept?.() === false) return false;
    scene = next;
  });
  function render() {
    mocked.hooks!.cursor = 0;
    tree = NativeSceneVideoControls({ scene, canAdd, onChange, onSelect, locale });
  }
  function input(label: NativeTextVideoCopyKey) {
    const field = elements(tree).find(
      (element) =>
        element.type === "label" && text(element).startsWith(nativeTextVideoCopy(locale)(label)),
    );
    const found = elements(field).find((element) => element.type === "input");
    if (!found) throw new Error(`Missing ${label}`);
    return found;
  }
  function button() {
    const found = elements(tree).find((element) => element.type === "button");
    if (!found) throw new Error("Missing video action");
    return found;
  }
  render();
  return {
    onChange,
    onSelect,
    render,
    setLocale(next: SupportedLocale) {
      locale = next;
      render();
    },
    find(predicate: (element: ReactElement<Record<string, unknown>>) => boolean) {
      const found = elements(tree).find(predicate);
      if (!found) throw new Error("Missing video control");
      return found;
    },
    input,
    get scene() {
      return scene;
    },
    value(label: NativeTextVideoCopyKey) {
      return input(label).props.value;
    },
    change(label: NativeTextVideoCopyKey, value: string) {
      (input(label).props.onChange as (event: unknown) => void)({ target: { value } });
      render();
    },
    click() {
      (button().props.onClick as () => void)();
      render();
    },
    disabled() {
      return button().props.disabled;
    },
    error() {
      return text(elements(tree).find((element) => element.props.role === "alert"));
    },
    upstream(next: PresentationScene) {
      scene = next;
      render();
    },
  };
}
function fill(editor: ReturnType<typeof harness>) {
  editor.change("Video title", "Review evidence");
  editor.change("Video HTTPS link", "https://example.com/video");
  editor.change("Captions or transcript HTTPS link", "https://example.com/transcript");
}

describe("native external video controls", () => {
  it("retranslates active validation and retains all draft entries without adding a node", () => {
    const scene = sceneFixture();
    scene.schemaVersion = 7;
    const title = scene.nodes.find((node) => node.type === "text");
    if (title?.type !== "text") throw new Error("Missing authored title");
    title.lang = "fr";
    title.text = "Titre de la diapositive";
    const before = structuredClone(scene);
    const editor = harness(scene);
    fill(editor);
    editor.change("Video title", "Titre original 日本語");
    editor.change("Video HTTPS link", "https://user:secret@example.com/video");
    editor.click();
    editor.setLocale("ko-KR");
    expect(editor.error()).toBe("인증 정보가 포함되지 않은 HTTPS 링크를 사용하세요.");
    expect(editor.find((element) => element.props.role === "alert").props.lang).toBe("ko-KR");
    expect(editor.find((element) => element.type === "fieldset").props.lang).toBe("ko-KR");
    expect(text(editor.find((element) => element.type === "legend"))).toBe("외부 동영상");
    expect(text(editor.find((element) => element.type === "button"))).toBe("외부 동영상 링크 추가");
    for (const key of [
      "Video title",
      "Video HTTPS link",
      "Captions or transcript HTTPS link",
    ] as const)
      expect(editor.input(key).props.lang).toBe("");
    expect(editor.value("Video title")).toBe("Titre original 日本語");
    expect(editor.value("Video HTTPS link")).toBe("https://user:secret@example.com/video");
    expect(editor.value("Captions or transcript HTTPS link")).toBe(
      "https://example.com/transcript",
    );
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(editor.onSelect).not.toHaveBeenCalled();
    expect(scene).toEqual(before);
    editor.change("Video HTTPS link", "https://example.com/video?language=fr");
    editor.click();
    const video = editor.scene.nodes.at(-1);
    if (video?.type !== "text") throw new Error("Missing new video node");
    expect(video.text).toContain("External video: Titre original 日本語");
    expect(video.richText!.paragraphs[0]!.runs[0]!.href).toBe(
      "https://example.com/video?language=fr",
    );
    expect(video.richText!.paragraphs[1]!.runs[0]!.href).toBe("https://example.com/transcript");
    expect(editor.scene.nodes.slice(0, -1)).toEqual(before.nodes);
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    expect(editor.error()).toBe("");
  });

  it("translates retained parent rejection after locale changes and retries only on explicit add", () => {
    let accepted = false;
    const editor = harness(sceneFixture(), () => accepted);
    fill(editor);
    editor.click();
    editor.setLocale("ko-KR");
    expect(editor.error()).toBe(
      "프레젠테이션에 이 링크를 추가할 수 없습니다. 입력한 내용은 유지됩니다. 콘텐츠를 줄이고 다시 시도하세요.",
    );
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    expect(editor.value("Video title")).toBe("Review evidence");
    expect(editor.value("Captions or transcript HTTPS link")).toBe(
      "https://example.com/transcript",
    );
    accepted = true;
    editor.setLocale("ja-JP");
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    expect(editor.onSelect).not.toHaveBeenCalled();
    editor.click();
    expect(editor.onChange).toHaveBeenCalledTimes(2);
    expect(editor.onSelect).toHaveBeenCalledTimes(1);
    expect(editor.value("Video title")).toBe("");
  });

  it.each([
    ["Video title", "X".repeat(161), "동영상 제목은 160자 이내로 입력하세요."],
    [
      "Video HTTPS link",
      `https://example.com/${"x".repeat(2048)}`,
      "각 HTTPS 링크는 2048자 이내로 입력하세요.",
    ],
    ["Video HTTPS link", "malformed URL", "완전한 HTTPS 링크를 입력하세요."],
    [
      "Captions or transcript HTTPS link",
      "http://example.com/transcript",
      "인증 정보가 포함되지 않은 HTTPS 링크를 사용하세요.",
    ],
  ] as const)(
    "localizes known validation for %s without changing entries",
    (field, value, error) => {
      const editor = harness();
      fill(editor);
      editor.change(field, value);
      editor.setLocale("ko-KR");
      editor.click();
      expect(editor.error()).toBe(error);
      expect(editor.value(field)).toBe(value);
      expect(editor.onChange).not.toHaveBeenCalled();
      expect(editor.onSelect).not.toHaveBeenCalled();
    },
  );

  it("retains unknown library diagnostics verbatim with explicit English language", () => {
    const editor = harness();
    fill(editor);
    vi.spyOn(nativeVideo, "createNativeVideoLink").mockImplementationOnce(() => {
      throw new Error("Unknown video diagnostic {title}: original value");
    });
    editor.click();
    editor.setLocale("ko-KR");
    expect(editor.error()).toBe("Unknown video diagnostic {title}: original value");
    expect(editor.find((element) => element.props.role === "alert").props.lang).toBe("en-CA");
    expect(editor.value("Video title")).toBe("Review evidence");
    expect(editor.onChange).not.toHaveBeenCalled();
  });

  it("retains malformed entries, recovers visibly and preserves scene4 groups/data/rotation on success", () => {
    const scene = sceneFixture();
    const original = structuredClone(scene);
    const editor = harness(scene);
    fill(editor);
    editor.change("Video HTTPS link", "malformed URL");
    editor.click();
    expect(editor.error()).not.toBe("");
    expect(editor.value("Video title")).toBe("Review evidence");
    expect(editor.value("Video HTTPS link")).toBe("malformed URL");
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.change("Video HTTPS link", "https://example.com/video");
    editor.change("Captions or transcript HTTPS link", "http://example.com/transcript");
    editor.click();
    expect(editor.error()).toContain("HTTPS");
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.change("Captions or transcript HTTPS link", "https://example.com/transcript");
    editor.click();
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    expect(editor.scene.schemaVersion).toBe(4);
    expect(editor.scene.groups).toEqual(original.groups);
    expect(editor.scene.design).toEqual(original.design);
    expect(editor.scene.nodes.slice(0, -1)).toEqual(original.nodes);
    expect(editor.scene.readingOrder.slice(0, -1)).toEqual(original.readingOrder);
    expect(editor.onSelect).toHaveBeenCalledExactlyOnceWith(editor.scene.nodes.at(-1)!.id);
    expect(scene).toEqual(original);
    expect(editor.value("Video title")).toBe("");
    expect(editor.error()).toBe("");
  });

  it("rejects scene byte growth without a callback or lost entries and succeeds after content is shortened", () => {
    const scene = fullScene();
    const original = structuredClone(scene);
    const editor = harness(scene);
    fill(editor);
    editor.click();
    expect(editor.error()).toContain("slide’s limits");
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(editor.onSelect).not.toHaveBeenCalled();
    expect(editor.value("Video HTTPS link")).toBe("https://example.com/video");
    expect(scene).toEqual(original);
    const shorter = structuredClone(scene);
    const body = shorter.nodes.find((node) => node.type === "text" && node.role === "body");
    if (body?.type !== "text") throw new Error("Missing budget text");
    body.text = "";
    editor.upstream(shorter);
    editor.click();
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    expect(editor.error()).toBe("");
  });

  it("keeps declined entries available and retries only when the parent accepts them", () => {
    let accepted = false;
    const editor = harness(sceneFixture(), () => accepted);
    fill(editor);
    editor.click();
    expect(editor.error()).toContain("Your entries are retained");
    expect(editor.value("Video title")).toBe("Review evidence");
    expect(editor.value("Captions or transcript HTTPS link")).toBe(
      "https://example.com/transcript",
    );
    expect(editor.onSelect).not.toHaveBeenCalled();
    accepted = true;
    editor.click();
    expect(editor.onChange).toHaveBeenCalledTimes(2);
    expect(editor.onSelect).toHaveBeenCalledTimes(1);
    expect(editor.error()).toBe("");
    expect(editor.value("Video HTTPS link")).toBe("");
  });

  it("propagates programming callback errors without clearing entered links or selecting a node", () => {
    const editor = harness(sceneFixture(), () => {
      throw new Error("Parent update failed");
    });
    fill(editor);
    expect(() => editor.click()).toThrow("Parent update failed");
    editor.render();
    expect(editor.error()).toBe("");
    expect(editor.value("Video title")).toBe("Review evidence");
    expect(editor.value("Video HTTPS link")).toBe("https://example.com/video");
    expect(editor.onSelect).not.toHaveBeenCalled();
  });

  it("keeps adding unavailable when the caller has no capacity", () => {
    const editor = harness(sceneFixture(), undefined, false);
    fill(editor);
    expect(editor.disabled()).toBe(true);
    editor.click();
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(editor.onSelect).not.toHaveBeenCalled();
  });
});
