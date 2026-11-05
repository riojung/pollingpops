import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PresentationSceneNodeSchema, type PresentationScene } from "@openround/contracts";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import { ContentSlideView } from "./content-slide-view";
import { NativeSceneView } from "./native-scene-view";
import {
  containNativeInteractionKey,
  NativeSceneInteractionView,
  type NativeInteractionNode,
} from "./native-scene-interaction-view";

const mocked = vi.hoisted(() => ({ hooks: null as { cursor: number; slots: unknown[] } | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useId: () => (mocked.hooks ? "local-panel-id" : react.useId()),
    useState: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index] as T,
        (next: T | ((current: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function"
              ? (next as (current: T) => T)(hooks.slots[index] as T)
              : next;
        },
      ];
    },
  };
});

const reveal: NativeInteractionNode = {
  id: "reveal",
  type: "reveal",
  scope: "local",
  label: "Evidence details",
  body: "<script>Plain audience content</script>\nAdditional evidence",
  frame: { x: 8, y: 30, width: 60, height: 50 },
};
const link: NativeInteractionNode = {
  id: "link",
  type: "link",
  label: "Read the source",
  href: "https://example.test/evidence",
  frame: { x: 70, y: 30, width: 22, height: 20 },
};
function sceneFixture(): PresentationScene {
  const scene = createNativeContentBlock().scene!;
  return {
    ...scene,
    schemaVersion: 5,
    nodes: [...scene.nodes, reveal, link],
    readingOrder: [...scene.readingOrder, reveal.id, link.id],
  };
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function panel() {
  const hooks = { cursor: 0, slots: [] as unknown[] };
  let tree: ReactNode;
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      tree = NativeSceneInteractionView({ node: reveal });
    } finally {
      mocked.hooks = null;
    }
  }
  render();
  return {
    get markup() {
      return renderToStaticMarkup(tree);
    },
    toggle() {
      const button = elements(tree).find((element) => element.type === "button")!;
      (button.props.onClick as () => void)();
      render();
    },
  };
}

describe("viewer-local native interactions", () => {
  it("starts closed with no audience body in the DOM, expands plain text and removes it when hidden", () => {
    const view = panel();
    expect(view.markup).toContain('aria-expanded="false"');
    expect(view.markup).toContain('aria-controls="local-panel-id"');
    expect(view.markup).not.toContain("Plain audience content");
    view.toggle();
    expect(view.markup).toContain('aria-expanded="true"');
    expect(view.markup).toContain("&lt;script&gt;Plain audience content&lt;/script&gt;");
    expect(view.markup).not.toContain("<script>");
    expect(view.markup).toContain('role="region"');
    view.toggle();
    expect(view.markup).not.toContain("Plain audience content");
  });
  it("keeps separate viewers independent", () => {
    const first = panel();
    const second = panel();
    first.toggle();
    expect(first.markup).toContain('aria-expanded="true"');
    expect(second.markup).toContain('aria-expanded="false"');
  });
  it("uses native anchors only for safe public URLs with visible new-tab notice", () => {
    const markup = renderToStaticMarkup(<NativeSceneInteractionView node={link} />);
    expect(markup).toContain('href="https://example.test/evidence"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain("Opens in a new tab");
  });
  it("matches the contract's Unicode code-point URL boundary", () => {
    const prefix = "https://example.test/";
    const href = prefix + "😀".repeat(2_048 - Array.from(prefix).length);
    expect(Array.from(href)).toHaveLength(2_048);
    expect(href.length).toBeGreaterThan(2_048);
    const valid = { ...link, href };
    expect(PresentationSceneNodeSchema.safeParse(valid).success).toBe(true);
    expect(renderToStaticMarkup(<NativeSceneInteractionView node={valid} />)).toContain(
      `href="${href}"`,
    );
    const overLimit = { ...link, href: `${href}😀` };
    expect(PresentationSceneNodeSchema.safeParse(overLimit).success).toBe(false);
    expect(renderToStaticMarkup(<NativeSceneInteractionView node={overLimit} />)).not.toContain(
      "<a ",
    );
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "//example.test",
    "https://user:password@example.test",
    "https://example.test/a b",
    "https://example.test/\\unsafe",
    "",
    `https://example.test/${"x".repeat(2_048)}`,
  ])("refuses unsafe URL %s at render time", (href) => {
    expect(
      renderToStaticMarkup(<NativeSceneInteractionView node={{ ...link, href }} />),
    ).not.toContain("<a ");
  });
  it("makes editor previews inert while preserving visible audience copy", () => {
    const scene = sceneFixture();
    const markup = renderToStaticMarkup(<NativeSceneView scene={scene} onSelect={() => {}} />);
    expect(markup).toContain("Plain audience content");
    expect(markup).not.toContain('href="https://example.test');
    expect(markup).not.toContain("aria-expanded");
    expect(markup).not.toContain("Show accessible outline");
    const contentMarkup = renderToStaticMarkup(
      <ContentSlideView block={{ ...createNativeContentBlock(), scene }} variant="editor" />,
    );
    expect(contentMarkup).not.toContain("aria-expanded");
    expect(contentMarkup).not.toContain("<a ");
  });
  it("provides one outline toggle and equivalent controls in semantic reading order, excluding private notes", () => {
    const markup = renderToStaticMarkup(
      <ContentSlideView
        block={
          {
            ...createNativeContentBlock(),
            scene: sceneFixture(),
            speakerNotes: "PRIVATE facilitator cue",
          } as Parameters<typeof ContentSlideView>[0]["block"]
        }
        variant="live"
      />,
    );
    expect(markup).toContain("Show accessible outline");
    expect(markup).toContain("Panels open only on this screen");
    expect(markup.match(/aria-expanded="false"/g)).toHaveLength(1);
    expect(markup.indexOf('data-node-id="reveal"')).toBeLessThan(
      markup.indexOf('data-node-id="link"'),
    );
    expect(markup).not.toContain("Plain audience content");
    expect(markup).not.toContain("PRIVATE");
  });
  it("keys delivery state by actual source and scene content while keeping equal polling snapshots stable", () => {
    const scene = sceneFixture();
    const first = NativeSceneView({ scene, interactionSourceKey: "session:block:live" });
    expect(
      NativeSceneView({ scene: structuredClone(scene), interactionSourceKey: "session:block:live" })
        .key,
    ).toEqual(first.key);
    expect(
      NativeSceneView({ scene, interactionSourceKey: "session:duplicate:live" }).key,
    ).not.toEqual(first.key);
    expect(
      NativeSceneView({ scene, interactionSourceKey: "session:block:fallback" }).key,
    ).not.toEqual(first.key);
    const nextScene = structuredClone(scene);
    nextScene.readingOrder.reverse();
    expect(
      NativeSceneView({ scene: nextScene, interactionSourceKey: "session:block:live" }).key,
    ).not.toEqual(first.key);
    const onSelect = () => {};
    expect(NativeSceneView({ scene, onSelect }).key).toEqual(
      NativeSceneView({ scene: nextScene, onSelect }).key,
    );
  });
  it.each([
    " ",
    "Enter",
    "ArrowRight",
    "ArrowDown",
    "ArrowLeft",
    "ArrowUp",
    "PageDown",
    "Home",
    "End",
  ])("contains %j without preventing native button/link/scroll behavior", (key) => {
    const event = { key, stopPropagation: vi.fn(), preventDefault: vi.fn() };
    containNativeInteractionKey(
      event as unknown as Parameters<typeof containNativeInteractionKey>[0],
    );
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
