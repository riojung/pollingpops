import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  supportedLocales,
  type PresentationScene,
  type SupportedLocale,
} from "@openround/contracts";

const language = vi.hoisted(() => ({ locale: "en-CA" as SupportedLocale }));
vi.mock("../locale-provider", () => ({ useLocale: () => language }));
import { NativeSceneSelectionControls } from "./native-scene-selection-controls";
import { nativeControlsCopy } from "./native-controls-copy";
import { nativeSelectionCopy } from "./native-selection-copy";
import { EditorIcon } from "./presentation-editor-chrome";

function fixture(): PresentationScene {
  const frame = { x: 10, y: 30, width: 30, height: 30 };
  return {
    schemaVersion: 6,
    aspectRatio: "16:9",
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "Complete title",
        frame,
      },
      {
        id: "body",
        type: "text",
        role: "body",
        text: "Body text",
        lang: "en",
        frame,
        rotation: 15,
      },
      {
        id: "image",
        type: "image",
        mediaId: "11111111-1111-4111-8111-111111111111",
        altText: "Authored image description",
        frame,
      },
      { id: "shape", type: "shape", shape: "rectangle", color: "blue", label: "Image", frame },
      {
        id: "table",
        type: "table",
        caption: "Authored table",
        headers: ["A"],
        rows: [["1"]],
        frame,
      },
      {
        id: "chart",
        type: "chart",
        chartType: "bar",
        title: "Authored chart",
        summary: "Authored summary",
        categories: ["A"],
        series: [{ name: "Count", values: [1] }],
        frame,
      },
      {
        id: "reveal",
        type: "reveal",
        scope: "local",
        label: "Authored reveal",
        body: "Detail",
        frame,
      },
      { id: "link", type: "link", label: "Authored link", href: "https://example.com", frame },
      {
        id: "hotspot",
        type: "hotspot",
        label: "Authored hotspot",
        scope: "local",
        imageNodeId: "image",
        detailTitle: "Detail",
        body: "Evidence",
        frame,
      },
      {
        id: "dialog",
        type: "dialog",
        scope: "local",
        label: "Authored dialog",
        detailTitle: "Detail",
        body: "Evidence",
        frame,
      },
      {
        id: "navigation",
        type: "navigation",
        label: "Authored navigation",
        targetBlockId: null,
        frame,
      },
      {
        id: "edge",
        type: "connector",
        from: { nodeId: "title", anchor: "bottom" },
        to: { nodeId: "body", anchor: "top" },
        label: "Supports",
        color: "blue",
      },
    ],
    readingOrder: [
      "title",
      "body",
      "image",
      "shape",
      "table",
      "chart",
      "reveal",
      "link",
      "hotspot",
      "dialog",
      "navigation",
      "edge",
    ],
  };
}
function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function controls({
  selectedNodeIds = ["body"],
  scene = fixture(),
  disabled = false,
  withArrange = true,
}: {
  selectedNodeIds?: string[];
  scene?: PresentationScene;
  disabled?: boolean;
  withArrange?: boolean;
} = {}) {
  const onSelect = vi.fn(),
    onArrange = vi.fn();
  const tree = NativeSceneSelectionControls({
    scene,
    selectedNodeIds,
    disabled,
    onSelect,
    ...(withArrange ? { onArrange } : {}),
  });
  const all = elements(tree);
  return {
    tree,
    all,
    scene,
    onSelect,
    onArrange,
    buttons: all.filter((node) => node.type === "button"),
    select: all.find((node) => node.type === "select")!,
    help: all.find((node) => node.type === "details")!,
  };
}

beforeEach(() => {
  language.locale = "en-CA";
});

describe("compact native selection strip", () => {
  it("offers every object in reading order with the stable Canvas object name", () => {
    const scene = fixture();
    scene.nodes.reverse();
    const view = controls({ scene });
    expect(view.select.props.value).toBe("body");
    expect(
      view.all.filter((node) => node.type === "option").map((node) => node.props.value),
    ).toEqual(scene.readingOrder);
    const markup = renderToStaticMarkup(view.tree);
    expect(markup).toContain('aria-label="Selected object controls"');
    expect(markup).toContain("Canvas object");
    view.select.props.onChange({ target: { value: "title" } });
    expect(view.onSelect).toHaveBeenCalledExactlyOnceWith("title");
    expect(view.onArrange).not.toHaveBeenCalled();
  });

  it.each(fixture().nodes)("shows the $type icon when $id is selected", (node) => {
    const view = controls({ selectedNodeIds: [node.id] });
    expect(view.select.props.value).toBe(node.id);
    const label = view.all.find((element) => element.type === "label")!;
    expect(elements(label).find((element) => element.type === EditorIcon)?.props.name).toBe(
      node.type,
    );
    expect(view.buttons).toHaveLength(node.type === "connector" ? 0 : 1);
  });

  it("delegates Arrange without mutating content or adding geometry gesture buttons", () => {
    const view = controls();
    const before = structuredClone(view.scene);
    expect(view.buttons).toHaveLength(1);
    expect(view.buttons[0]!.props["aria-label"]).toBe("Arrange objects");
    expect(view.buttons[0]!.props.title).toBe("Arrange objects");
    view.buttons[0]!.props.onClick();
    expect(view.onArrange).toHaveBeenCalledExactlyOnceWith();
    expect(view.onSelect).not.toHaveBeenCalled();
    expect(view.all.some((element) => element.props.onPointerDown || element.props.onKeyDown)).toBe(
      false,
    );
    expect(view.scene).toEqual(before);
    expect(controls({ withArrange: false }).buttons).toHaveLength(0);
  });

  it("uses a collapsed native disclosure for pointer and keyboard help", () => {
    const view = controls();
    expect(view.help.props.open).toBeUndefined();
    const summary = elements(view.help).find((element) => element.type === "summary")!;
    expect(summary.props["aria-label"]).toBe("Object shortcuts");
    const helpMarkup = renderToStaticMarkup(view.help);
    expect(helpMarkup).toContain("drag objects to move them or corner handles to resize");
    expect(helpMarkup).toContain("Focus the canvas and use arrow keys");
    expect(helpMarkup).toContain("hold Shift for larger steps");
    expect(helpMarkup).toContain("Use Arrange for exact position and size");
    expect(view.all.filter((element) => element.type === "p")).toEqual(
      elements(view.help).filter((element) => element.type === "p"),
    );
  });

  it("keeps connectors selectable and gives connection help without geometry guidance", () => {
    const view = controls({ selectedNodeIds: ["edge"] });
    expect(view.select.props.value).toBe("edge");
    expect(view.buttons).toHaveLength(0);
    const helpMarkup = renderToStaticMarkup(view.help);
    expect(helpMarkup).toContain("Connections follow their objects");
    expect(helpMarkup).not.toMatch(/arrow keys|corner handles|exact position/);
  });

  it("shows persistent group numbering and counts, with multi-selection guidance", () => {
    const scene = fixture();
    scene.groups = [
      { id: "first", nodeIds: ["image", "shape"] },
      { id: "second", nodeIds: ["title", "body"] },
    ];
    const view = controls({ scene, selectedNodeIds: ["title", "body"] });
    const markup = renderToStaticMarkup(view.tree);
    expect(markup).toContain("Group 2 · 2");
    expect(markup).toContain("Group 2, 2 objects");
    expect(markup).toContain("Move affects all selected objects");
    expect(view.select.props.value).toBe("body");
    const mixed = controls({
      scene,
      selectedNodeIds: ["title", "body", "image", "image", "deleted"],
    });
    const context = mixed.all.find((element) => element.props["data-native-selection-context"]);
    expect(context).toBeUndefined();
    const selectedMixed = controls({ scene, selectedNodeIds: ["title", "body", "image", "image"] });
    const mixedMarkup = renderToStaticMarkup(selectedMixed.tree);
    expect(mixedMarkup).toContain("3 selected");
    expect(mixedMarkup).not.toContain("Group 1 ·");
  });

  it("keeps read-only object selection enabled and hides editing instructions in help", () => {
    const view = controls({ disabled: true });
    expect(view.select.props.disabled).toBeUndefined();
    expect(view.buttons[0]!.props.disabled).toBe(true);
    view.select.props.onChange({ target: { value: "edge" } });
    expect(view.onSelect).toHaveBeenCalledWith("edge");
    const helpMarkup = renderToStaticMarkup(view.help);
    expect(helpMarkup).toContain("Read-only. You can select objects and preview the slide.");
    expect(helpMarkup).not.toMatch(/arrow keys|corner handles/);
  });

  it.each([{ selectedNodeIds: [] }, { selectedNodeIds: ["removed"] }])(
    "handles empty or removed selection $selectedNodeIds",
    ({ selectedNodeIds }) => {
      const view = controls({ selectedNodeIds });
      expect(view.select.props.value).toBe("");
      expect(view.buttons).toHaveLength(0);
      expect(renderToStaticMarkup(view.help)).toContain("Choose an object");
      expect(view.all.find((element) => element.type === "option")?.props.value).toBe("");
    },
  );

  it.each(supportedLocales)(
    "localizes strip chrome and preserves authored labels and language in %s",
    (locale) => {
      language.locale = locale;
      const scene = fixture();
      scene.groups = [{ id: "group", nodeIds: ["title", "body"] }];
      const view = controls({ scene, selectedNodeIds: ["title", "body"] });
      const markup = renderToStaticMarkup(view.tree);
      expect(markup).toContain(`lang="${locale}"`);
      expect(markup).toContain(nativeControlsCopy(locale)("Canvas object"));
      expect(markup).toContain(nativeSelectionCopy(locale)("Object shortcuts"));
      expect(markup).toContain(
        nativeSelectionCopy(locale)("Group {number} · {count}", { number: 1, count: 2 }),
      );
      const body = view.all.find(
        (element) => element.type === "option" && element.props.value === "body",
      )!;
      expect(body.props.lang).toBe("en");
      expect(renderToStaticMarkup(body)).toContain("2. Body text");
      const shape = view.all.find(
        (element) => element.type === "option" && element.props.value === "shape",
      )!;
      expect(shape.props.lang).toBe("");
      expect(renderToStaticMarkup(shape)).toContain("4. Image");
      expect(markup).toContain("Authored image description");
    },
  );
});
