import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PresentationSceneDraftSchema,
  type PresentationScene,
  type PresentationSceneNode,
} from "@openround/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createNativeContentBlock,
  createNativeLinkNode,
  createNativeRevealNode,
  createNativeDialogNode,
  createNativeNavigationNode,
} from "../../lib/presentation-native-scene";
import { NativeSceneInteractionEditor } from "./native-scene-interaction-editor";
import { NativeInteractionSummary } from "./native-interaction-summary";

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

function harness(initial: InteractionNode, accept = () => true, onPreview?: () => void) {
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
        node: (scene.nodes.find((item) => item.id === selected) as InteractionNode) ?? null,
        onChange,
        onPreview,
        navigationTargets: [
          { id: "11111111-1111-4111-8111-111111111111", title: "Next checkpoint" },
        ],
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
});
