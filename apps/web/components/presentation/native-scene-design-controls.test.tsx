import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
import {
  PRESENTATION_SCENE_MAX_BYTES,
  PresentationSceneDraftSchema,
  type PresentationScene,
  type PresentationSceneDesign,
  type PresentationSceneNode,
} from "@openround/contracts";
import {
  createNativeContentBlock,
  createNativeRevealNode,
} from "../../lib/presentation-native-scene";
import {
  NativeSceneArrangementControls,
  NativeSceneDesignControls,
  NativeSceneImageDesignControls,
  NativeSceneLayoutControls,
} from "./native-scene-design-controls";

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
});
function render(component: () => ReactNode) {
  mocked.hooks!.cursor = 0;
  return component();
}

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
function button(tree: ReactNode, label: string) {
  return elements(tree).find(
    (element) =>
      element.type === "button" &&
      (element.props["aria-label"] ?? text(element.props.children as ReactNode)) === label,
  )!;
}
function input(tree: ReactNode, label: string) {
  const element = elements(tree).find(
    (element) =>
      element.type === "label" &&
      text(element.props.children as ReactNode)
        .trim()
        .startsWith(label),
  )!;
  return elements(element).find(
    (element) => element.type === "select" || element.type === "input",
  )!;
}
function click(element: ReactElement<Record<string, unknown>>) {
  (element.props.onClick as () => void)();
}
function change(element: ReactElement<Record<string, unknown>>, target: Record<string, unknown>) {
  (element.props.onChange as (event: unknown) => void)({ target });
}

const design: PresentationSceneDesign = { theme: "midnight", font: "serif", spacing: "compact" };

describe("native design controls", () => {
  it("requires explicit opt in before exposing theme fields and creates one history edit", () => {
    const scene = createNativeContentBlock().scene!;
    const original = structuredClone(scene);
    const onChange = vi.fn();
    const tree = NativeSceneDesignControls({ scene, onChange });
    expect(elements(tree).some((element) => element.type === "select")).toBe(false);
    click(button(tree, "Enable slide design"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toMatchObject({
      schemaVersion: 3,
      design: { theme: "paper", font: "sans", spacing: "relaxed" },
    });
    expect(scene).toEqual(original);
  });

  it("changes one design property and passes the complete current design to the deck callback", () => {
    const scene: PresentationScene = {
      ...createNativeContentBlock().scene!,
      schemaVersion: 3,
      design,
    };
    const onChange = vi.fn(),
      onApplyDesignToDeck = vi.fn();
    const tree = NativeSceneDesignControls({ scene, onChange, onApplyDesignToDeck });
    change(input(tree, "Slide theme"), { value: "ocean" });
    expect(onChange.mock.calls[0]![0].design).toEqual({ ...design, theme: "ocean" });
    expect(onChange.mock.calls[0]![0].nodes).toEqual(scene.nodes);
    click(button(tree, "Apply design to all native slides"));
    expect(onApplyDesignToDeck).toHaveBeenCalledExactlyOnceWith(design);
  });

  it("offers named palette previews without adding history for the active palette", () => {
    const scene: PresentationScene = {
      ...createNativeContentBlock().scene!,
      schemaVersion: 3,
      design,
    };
    const onChange = vi.fn();
    const tree = NativeSceneDesignControls({ scene, onChange });
    expect(button(tree, "Use Midnight theme").props["aria-pressed"]).toBe(true);
    expect(button(tree, "Use Ocean theme").props["aria-pressed"]).toBe(false);
    click(button(tree, "Use Midnight theme"));
    expect(onChange).not.toHaveBeenCalled();
    click(button(tree, "Use Ocean theme"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toMatchObject({
      design: { ...design, theme: "ocean" },
      nodes: scene.nodes,
      readingOrder: scene.readingOrder,
    });
    for (const label of ["Slide theme", "Slide font", "Slide spacing"])
      expect(input(tree, label).type).toBe("select");
  });

  it("disables inapplicable layouts and explains the required objects", () => {
    const scene = createNativeContentBlock().scene!;
    const onChange = vi.fn();
    const tree = NativeSceneLayoutControls({ scene, onChange });
    expect(text(tree)).toContain("Requires a title and one body text object.");
    const layout = button(tree, "Title and body");
    expect(layout.props.disabled).toBe(true);
    click(layout);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("retains interaction controls through theme and image-fit changes", () => {
    const reveal = { ...createNativeRevealNode(), label: "Show detail", body: "Audience detail" };
    const image = {
      id: "image",
      type: "image" as const,
      mediaId: "11111111-1111-4111-8111-111111111111",
      altText: "Evidence",
      frame: { x: 10, y: 30, width: 40, height: 50 },
    };
    const scene: PresentationScene = {
      ...createNativeContentBlock().scene!,
      schemaVersion: 5,
      design,
    };
    scene.nodes.push(reveal, image);
    scene.readingOrder.push(reveal.id, image.id);
    const onChange = vi.fn();
    change(input(NativeSceneDesignControls({ scene, onChange }), "Slide theme"), {
      value: "ocean",
    });
    change(input(NativeSceneImageDesignControls({ scene, node: image, onChange }), "Image fit"), {
      value: "cover",
    });
    expect(onChange).toHaveBeenCalledTimes(2);
    for (const [changed] of onChange.mock.calls) {
      expect(changed.schemaVersion).toBe(5);
      expect(changed.nodes).toContainEqual(reveal);
      expect(PresentationSceneDraftSchema.safeParse(changed).success).toBe(true);
    }
  });

  it("protects arrangement thresholds and keeps connector layers unavailable", () => {
    const scene = createNativeContentBlock().scene!;
    const onChange = vi.fn();
    const tree = NativeSceneArrangementControls({
      scene,
      selectedIds: scene.readingOrder,
      selectedId: scene.readingOrder[0]!,
      onChange,
    });
    for (const label of [
      "Align left",
      "Distribute horizontally",
      "Send object to back",
      "Bring object to front",
    ]) {
      expect(button(tree, label).props.disabled).toBe(true);
      click(button(tree, label));
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opts image fitting into scene 3, bounds focal coordinates and removes crop metadata for contain", () => {
    const scene = createNativeContentBlock().scene!;
    const node = {
      id: "image",
      type: "image" as const,
      mediaId: "11111111-1111-4111-8111-111111111111",
      altText: "Evidence",
      frame: { x: 10, y: 30, width: 40, height: 50 },
    };
    scene.nodes.push(node);
    scene.readingOrder.push(node.id);
    const onChange = vi.fn();
    let tree = NativeSceneImageDesignControls({ scene, node, onChange });
    change(input(tree, "Image fit"), { value: "cover" });
    const next = onChange.mock.calls[0]![0] as PresentationScene;
    const image = next.nodes.find((node) => node.type === "image")!;
    expect(next.schemaVersion).toBe(3);
    expect(image).toMatchObject({
      fit: "cover",
      focalPoint: { x: 50, y: 50 },
      altText: "Evidence",
    });
    tree = NativeSceneImageDesignControls({ scene: { ...next, design }, node: image, onChange });
    change(input(tree, "Image focal X (%)"), { valueAsNumber: 150 });
    expect(onChange.mock.calls[1]![0].nodes.at(-1).focalPoint).toEqual({ x: 100, y: 50 });
    change(input(tree, "Image focal Y (%)"), { valueAsNumber: Number.NaN });
    expect(onChange).toHaveBeenCalledTimes(2);
    change(input(tree, "Image fit"), { value: "contain" });
    expect(onChange.mock.calls[2]![0].nodes.at(-1)).not.toHaveProperty("focalPoint");
    expect(onChange.mock.calls[2]![0]).toMatchObject({ schemaVersion: 3, design });
    expect(scene.nodes.at(-1)).toEqual(node);
    expect(node).not.toHaveProperty("fit");
  });
});

type ImageNode = Extract<PresentationSceneNode, { type: "image" }>;
function budgetFixture({
  design,
  fit,
  focalPoint,
  bytes = PRESENTATION_SCENE_MAX_BYTES - 1,
}: {
  design?: PresentationSceneDesign;
  fit?: ImageNode["fit"];
  focalPoint?: ImageNode["focalPoint"];
  bytes?: number;
} = {}): PresentationScene {
  const scene = createNativeContentBlock().scene!;
  if (design || fit) scene.schemaVersion = 3;
  if (design) scene.design = design;
  const image: ImageNode = {
    id: "image",
    type: "image",
    mediaId: "11111111-1111-4111-8111-111111111111",
    altText: "Evidence",
    frame: { x: 10, y: 30, width: 40, height: 50 },
    ...(fit ? { fit } : {}),
    ...(focalPoint ? { focalPoint } : {}),
  };
  scene.nodes.push(image);
  for (let i = 0; i < 35; i++)
    scene.nodes.push({
      id: `body-${i}`,
      type: "text",
      role: "body",
      text: "",
      frame: { x: 10, y: 30, width: 40, height: 50 },
    });
  scene.readingOrder = scene.nodes.map((node) => node.id);
  let remaining = bytes - new TextEncoder().encode(JSON.stringify(scene)).byteLength;
  for (const node of scene.nodes) {
    if (node.type !== "text" || node.role !== "body") continue;
    const count = Math.min(4000, remaining);
    node.text = "a".repeat(count);
    remaining -= count;
  }
  expect(remaining).toBe(0);
  expect(new TextEncoder().encode(JSON.stringify(scene)).byteLength).toBe(bytes);
  expect(PresentationSceneDraftSchema.safeParse(scene).success).toBe(true);
  return scene;
}
function imageNode(scene: PresentationScene): ImageNode {
  return scene.nodes.find((node): node is ImageNode => node.type === "image")!;
}
function alert(tree: ReactNode) {
  return elements(tree).find((element) => element.props.role === "alert");
}
function shorten(scene: PresentationScene): PresentationScene {
  const next = structuredClone(scene);
  const body = next.nodes.find((node) => node.type === "text" && node.role === "body");
  if (body?.type === "text") body.text = body.text.slice(256);
  return next;
}

describe("native design scene budget recovery", () => {
  it("rejects design opt-in at 131071 bytes without exceptions or history edits, then allows correction", () => {
    let scene = budgetFixture();
    const original = structuredClone(scene);
    const onChange = vi.fn();
    const component = () => NativeSceneDesignControls({ scene, onChange });
    let tree = render(component);
    expect(() => click(button(tree, "Enable slide design"))).not.toThrow();
    tree = render(component);
    expect(text(alert(tree))).toContain(
      "This design change exceeds the slide’s limits. Shorten some text or remove an object, then try again.",
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(scene).toEqual(original);
    scene = shorten(scene);
    tree = render(component);
    click(button(tree, "Enable slide design"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toMatchObject({
      schemaVersion: 3,
      design: { theme: "paper", font: "sans", spacing: "relaxed" },
    });
    expect(alert(render(component))).toBeUndefined();
  });

  it("recovers from a longer theme at 131071 bytes with a fitting theme and clears its alert", () => {
    const scene = budgetFixture({ design: { theme: "paper", font: "sans", spacing: "relaxed" } });
    const original = structuredClone(scene);
    const onChange = vi.fn();
    const component = () => NativeSceneDesignControls({ scene, onChange });
    let tree = render(component);
    expect(() => change(input(tree, "Slide theme"), { value: "midnight" })).not.toThrow();
    tree = render(component);
    expect(alert(tree)).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
    expect(scene).toEqual(original);
    change(input(tree, "Slide theme"), { value: "ocean" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].design.theme).toBe("ocean");
    expect(alert(render(component))).toBeUndefined();
  });

  it("validates palette preview actions against the scene budget", () => {
    const scene = budgetFixture({ design: { theme: "paper", font: "sans", spacing: "relaxed" } });
    const original = structuredClone(scene);
    const onChange = vi.fn();
    const component = () => NativeSceneDesignControls({ scene, onChange });
    click(button(render(component), "Use Midnight theme"));
    expect(alert(render(component))).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
    expect(scene).toEqual(original);
    click(button(render(component), "Use Ocean theme"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].design.theme).toBe("ocean");
    expect(alert(render(component))).toBeUndefined();
  });

  it("handles font validation at the full budget and allows equal-size spacing changes", () => {
    const scene = budgetFixture({
      design: { theme: "paper", font: "sans", spacing: "relaxed" },
      bytes: PRESENTATION_SCENE_MAX_BYTES,
    });
    const onChange = vi.fn();
    const component = () => NativeSceneDesignControls({ scene, onChange });
    let tree = render(component);
    expect(() => change(input(tree, "Slide font"), { value: "serif" })).not.toThrow();
    tree = render(component);
    expect(alert(tree)).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
    change(input(tree, "Slide spacing"), { value: "compact" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].design.spacing).toBe("compact");
    expect(alert(render(component))).toBeUndefined();
  });

  it("rejects image cover at 131071 bytes, preserves the source, and succeeds after shortening text", () => {
    let scene = budgetFixture();
    const original = structuredClone(scene);
    const onChange = vi.fn();
    const component = () =>
      NativeSceneImageDesignControls({ scene, node: imageNode(scene), onChange });
    let tree = render(component);
    expect(() => change(input(tree, "Image fit"), { value: "cover" })).not.toThrow();
    tree = render(component);
    expect(text(alert(tree))).toContain(
      "This image change exceeds the slide’s limits. Shorten some text or remove an object, then try again.",
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(scene).toEqual(original);
    scene = shorten(scene);
    tree = render(component);
    change(input(tree, "Image fit"), { value: "cover" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(imageNode(onChange.mock.calls[0]![0])).toMatchObject({
      fit: "cover",
      focalPoint: { x: 50, y: 50 },
    });
    expect(alert(render(component))).toBeUndefined();
  });

  it("rejects focal JSON growth at 131071 bytes and keeps the history key on a successful correction", () => {
    const scene = budgetFixture({ fit: "cover", focalPoint: { x: 0, y: 0 } });
    const original = structuredClone(scene);
    const onChange = vi.fn();
    const component = () =>
      NativeSceneImageDesignControls({ scene, node: imageNode(scene), onChange });
    let tree = render(component);
    expect(() => change(input(tree, "Image focal X (%)"), { valueAsNumber: 99.99 })).not.toThrow();
    tree = render(component);
    expect(alert(tree)).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
    expect(scene).toEqual(original);
    change(input(tree, "Image focal X (%)"), { valueAsNumber: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![1]).toBe("native:image:focal:x");
    expect(imageNode(onChange.mock.calls[0]![0]).focalPoint).toEqual({ x: 1, y: 0 });
    expect(alert(render(component))).toBeUndefined();
  });

  it("does not swallow onChange programming errors as validation feedback", () => {
    const scene = createNativeContentBlock().scene!;
    const onChange = vi.fn(() => {
      throw new Error("onChange failed");
    });
    const tree = render(() => NativeSceneDesignControls({ scene, onChange }));
    expect(() => click(button(tree, "Enable slide design"))).toThrow("onChange failed");
    expect(alert(render(() => NativeSceneDesignControls({ scene, onChange })))).toBeUndefined();
    mocked.hooks = { cursor: 0, slots: [] };
    const withImage = shorten(budgetFixture());
    const imageTree = render(() =>
      NativeSceneImageDesignControls({ scene: withImage, node: imageNode(withImage), onChange }),
    );
    expect(() => change(input(imageTree, "Image fit"), { value: "cover" })).toThrow(
      "onChange failed",
    );
  });
});
