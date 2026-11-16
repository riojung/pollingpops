import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PresentationSceneNodeSchema,
  supportedLocales,
  type PresentationScene,
  type SupportedLocale,
} from "@openround/contracts";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import { ContentSlideView } from "./content-slide-view";
import { NativeSceneView } from "./native-scene-view";
import {
  containNativeInteractionKey,
  NativeSceneInteractionView,
  type NativeInteractionNode,
  type NativeSceneInteractionRuntime,
} from "./native-scene-interaction-view";
import { NativeSceneDetailDialog } from "./native-scene-detail-dialog";
import { nativeAudienceCopy } from "./native-audience-copy";
import { localizeBranchNavigationFeedback } from "./branch-navigation-copy";

const mocked = vi.hoisted(() => ({ hooks: null as { cursor: number; slots: unknown[] } | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useId: () => (mocked.hooks ? "local-panel-id" : react.useId()),
    useRef: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
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
function panel(
  node: NativeInteractionNode = reveal,
  runtime?: NativeSceneInteractionRuntime,
  locale: SupportedLocale = "en-CA",
) {
  const hooks = { cursor: 0, slots: [] as unknown[] };
  let tree: ReactNode;
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      tree = NativeSceneInteractionView({ node, runtime, locale });
    } finally {
      mocked.hooks = null;
    }
  }
  render();
  return {
    refresh: render,
    get markup() {
      return renderToStaticMarkup(tree);
    },
    toggle() {
      const button = elements(tree).find((element) => element.type === "button")!;
      (button.props.onClick as () => void)();
      render();
    },
    closeDetails() {
      const dialog = elements(tree).find((element) => element.type === NativeSceneDetailDialog)!;
      (dialog.props.onClose as () => void)();
      render();
    },
  };
}

describe("viewer-local native interactions", () => {
  it.each(supportedLocales)(
    "localizes reveal and dialog state controls without changing authored text or commands in %s",
    (locale) => {
      const copy = nativeAudienceCopy(locale);
      const node = { ...reveal, label: "Reveal panel" };
      const original = structuredClone(node);
      const onNavigate = vi.fn();
      const onSetReveal = vi.fn();
      const view = panel(node, { mode: "review", onNavigate, onSetReveal }, locale);
      expect(view.markup).toContain('<span lang="">Reveal panel</span>');
      expect(view.markup).toContain(copy("Show on this screen"));
      expect(view.markup).toContain(`lang="${locale}"`);
      expect(view.markup).not.toContain("Plain audience content");
      view.toggle();
      expect(view.markup).toContain(copy("Hide on this screen"));
      expect(view.markup).toContain('<p lang="">&lt;script&gt;Plain audience content');
      const detail = panel(
        { ...node, type: "dialog", scope: "local", detailTitle: "Close details" },
        undefined,
        locale,
      );
      expect(detail.markup).toContain(copy("Open details on this screen"));
      detail.toggle();
      expect(detail.markup).toMatch(/<h2 lang=""[^>]*>Close details<\/h2>/);
      expect(detail.markup).toContain(`>${copy("Close details")}</button>`);
      detail.closeDetails();
      expect(detail.markup).not.toContain("<dialog");
      expect(onNavigate).not.toHaveBeenCalled();
      expect(onSetReveal).not.toHaveBeenCalled();
      expect(node).toEqual(original);
    },
  );

  it("localizes canonical navigation feedback and keeps unknown service diagnostics explicitly English", () => {
    const targetBlockId = "11111111-1111-4111-8111-111111111111";
    const node: NativeInteractionNode = {
      id: "navigation",
      type: "navigation",
      label: "Go to slide",
      targetBlockId,
      frame: reveal.frame,
    };
    const onNavigate = vi.fn();
    for (const blockedReason of [
      "Complete the linked recheck before navigating.",
      "Unrecognized diagnostic {title}",
    ]) {
      const reason = localizeBranchNavigationFeedback("ko-KR", blockedReason);
      const view = panel(
        node,
        {
          mode: "live_staff",
          onNavigate,
          navigationTargets: [{ blockId: targetBlockId, available: false, blockedReason }],
        },
        "ko-KR",
      );
      expect(view.markup).toContain(`lang="${reason.lang}"`);
      expect(view.markup).toContain(reason.text);
      expect(view.markup).toContain('<span lang="">Go to slide</span>');
      view.toggle();
    }
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("keeps selected-language audience broadcast and navigation controls inert and staff state authoritative", () => {
    const onSetReveal = vi.fn();
    const onNavigate = vi.fn();
    const node = { ...reveal, scope: "broadcast" as const };
    const revealedNodeIds: string[] = [];
    const audience = panel(node, { mode: "live_audience", onSetReveal, revealedNodeIds }, "ko-KR");
    expect(audience.markup).toContain('disabled=""');
    expect(audience.markup).toContain(nativeAudienceCopy("ko-KR")("Show for everyone"));
    audience.toggle();
    expect(audience.markup).not.toContain("Plain audience content");
    expect(onSetReveal).not.toHaveBeenCalled();
    const staff = panel(node, { mode: "live_staff", onSetReveal, revealedNodeIds }, "ko-KR");
    staff.toggle();
    expect(onSetReveal).toHaveBeenCalledExactlyOnceWith(node.id, true);
    expect(staff.markup).toContain('aria-expanded="false"');
    revealedNodeIds.push(node.id);
    staff.refresh();
    expect(staff.markup).toContain(nativeAudienceCopy("ko-KR")("Hide for everyone"));
    const targetBlockId = "11111111-1111-4111-8111-111111111111";
    const navigation = panel(
      {
        id: "navigation",
        type: "navigation",
        label: "Read next",
        targetBlockId,
        frame: reveal.frame,
      },
      {
        mode: "live_audience",
        onNavigate,
        navigationTargets: [{ blockId: targetBlockId, available: true, blockedReason: null }],
      },
      "ko-KR",
    );
    navigation.toggle();
    expect(navigation.markup).toContain(
      nativeAudienceCopy("ko-KR")("The facilitator controls slide navigation."),
    );
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it.each(["hotspot", "dialog"] as const)(
    "opens %s details locally as escaped text and removes closed content",
    (type) => {
      const base = {
        id: "detail",
        scope: "local" as const,
        label: "Inspect evidence",
        detailTitle: "Evidence detail",
        body: "<script>Audience detail</script>",
        frame: reveal.frame,
      };
      const node: NativeInteractionNode =
        type === "hotspot" ? { ...base, type, imageNodeId: "image" } : { ...base, type };
      const onNavigate = vi.fn();
      const onSetReveal = vi.fn();
      const view = panel(node, { mode: "live_staff", onNavigate, onSetReveal });
      expect(view.markup).not.toContain("Audience detail");
      view.toggle();
      expect(view.markup).toContain("&lt;script&gt;Audience detail&lt;/script&gt;");
      expect(view.markup).toContain('aria-modal="true"');
      expect(view.markup).toContain("Close details");
      view.closeDetails();
      expect(view.markup).not.toContain("Audience detail");
      expect(onNavigate).not.toHaveBeenCalled();
      expect(onSetReveal).not.toHaveBeenCalled();
    },
  );
  it("uses absolute staff broadcast intent and authoritative state while review stays local", () => {
    const node = { ...reveal, scope: "broadcast" as const };
    const onSetReveal = vi.fn();
    const revealedNodeIds: string[] = [];
    const staff = panel(node, { mode: "live_staff", revealedNodeIds, onSetReveal });
    staff.toggle();
    expect(onSetReveal).toHaveBeenCalledExactlyOnceWith(node.id, true);
    expect(staff.markup).toContain('aria-expanded="false"');
    revealedNodeIds.push(node.id);
    staff.refresh();
    expect(staff.markup).toContain('aria-expanded="true"');
    staff.toggle();
    expect(onSetReveal).toHaveBeenLastCalledWith(node.id, false);
    const review = panel(node, { mode: "review", onSetReveal });
    review.toggle();
    expect(review.markup).toContain('aria-expanded="true"');
    expect(onSetReveal).toHaveBeenCalledTimes(2);
  });
  it("keeps audience navigation inert even when a callback is supplied, and authorizes review targets", () => {
    const targetBlockId = "11111111-1111-4111-8111-111111111111";
    const node: NativeInteractionNode = {
      id: "navigation",
      type: "navigation",
      label: "Read next",
      targetBlockId,
      frame: reveal.frame,
    };
    const onNavigate = vi.fn();
    const runtime = {
      onNavigate,
      navigationTargets: [{ blockId: targetBlockId, available: true, blockedReason: null }],
    };
    const audience = panel(node, { ...runtime, mode: "live_audience" });
    expect(audience.markup).toContain('disabled=""');
    audience.toggle();
    expect(onNavigate).not.toHaveBeenCalled();
    const review = panel(node, { ...runtime, mode: "review" });
    review.toggle();
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(node.id, targetBlockId);
  });
  it("keeps local state identity stable only for redacted audience broadcast body changes", () => {
    const scene = structuredClone(sceneFixture());
    scene.schemaVersion = 6;
    const node = scene.nodes.find((node) => node.type === "reveal")!;
    if (node.type !== "reveal") throw new Error("Reveal required");
    node.scope = "broadcast";
    node.body = "";
    const opened = structuredClone(scene);
    const openNode = opened.nodes.find((node) => node.type === "reveal")!;
    if (openNode.type !== "reveal") throw new Error("Reveal required");
    openNode.body = "Authorized audience body";
    const runtime = { mode: "live_audience" as const };
    expect(
      NativeSceneView({ scene, interactionSourceKey: "same", interactionRuntime: runtime }).key,
    ).toBe(
      NativeSceneView({ scene: opened, interactionSourceKey: "same", interactionRuntime: runtime })
        .key,
    );
    expect(NativeSceneView({ scene, interactionSourceKey: "same" }).key).not.toBe(
      NativeSceneView({ scene: opened, interactionSourceKey: "same" }).key,
    );
  });
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
