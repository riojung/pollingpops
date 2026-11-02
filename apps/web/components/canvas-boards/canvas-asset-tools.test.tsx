import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasAssetTools } from "./canvas-asset-tools";
import { canvasBoard } from "./canvas-test-fixtures";
interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
}
const mocks = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  upload: vi.fn(),
  rasterize: vi.fn(),
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => {
      if (!mocks.hooks) return react.useState(initial);
      const hooks = mocks.hooks,
        index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (value: T) => {
          hooks.slots[index] = value;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      if (!mocks.hooks) return react.useRef(initial);
      const hooks = mocks.hooks,
        index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      if (!mocks.hooks) return react.useEffect(effect, dependencies);
      const hooks = mocks.hooks,
        index = hooks.cursor++;
      const previous = hooks.slots[index] as readonly unknown[] | undefined;
      if (!previous || dependencies?.some((value, dependency) => value !== previous[dependency]))
        hooks.effects.push(() => {
          effect();
        });
      hooks.slots[index] = dependencies;
    },
  };
});
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: string) => key }),
}));
vi.mock("../navigation-guard", () => ({ useNavigationBlocker: () => undefined }));
vi.mock("./canvas-assets-client", () => ({ uploadCanvasImage: mocks.upload }));
vi.mock("./canvas-svg-import", () => ({ rasterizeCanvasSvg: mocks.rasterize }));
function find(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return predicate(node) ? node : find(node.props.children as ReactNode, predicate);
}
function harness(props: Partial<Parameters<typeof CanvasAssetTools>[0]> = {}) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  const onCreate = vi.fn().mockResolvedValue(true);
  return {
    onCreate,
    render() {
      hooks.cursor = 0;
      hooks.effects = [];
      mocks.hooks = hooks;
      try {
        const tree = CanvasAssetTools({
          board: { ...canvasBoard, imageUploadsAvailable: true },
          onCreate,
          ...props,
        });
        for (const effect of hooks.effects) effect();
        return tree;
      } finally {
        mocks.hooks = null;
      }
    },
  };
}
beforeEach(() => {
  vi.stubGlobal("document", { activeElement: null });
  mocks.upload.mockReset();
  mocks.rasterize.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
describe("canvas asset palette requests", () => {
  it("rasterizes SVG before the existing image upload and creates an image object", async () => {
    const source = new File(["<svg/>"], "drawing.svg", { type: "image/svg+xml" });
    const png = new File(["png"], "drawing.png", { type: "image/png" });
    mocks.rasterize.mockResolvedValue(png);
    mocks.upload.mockResolvedValue({
      mediaId: "00000000-0000-4000-8000-000000000099",
      altText: "A drawing",
    });
    const view = harness({ openRequest: { kind: "svg", id: 1 }, hideButtons: true });
    view.render();
    const tree = view.render();
    const file = find(
      tree,
      (element) => element.type === "input" && element.props.type === "file",
    )!;
    expect(file.props.accept).toBe(".svg,image/svg+xml");
    (file.props.onChange as (event: unknown) => void)({ target: { files: [source] } });
    const description = find(tree, (element) => element.type === "textarea")!;
    (description.props.onChange as (event: unknown) => void)({ target: { value: "A drawing" } });
    const form = find(view.render(), (element) => element.type === "form")!;
    (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
    for (let index = 0; index < 20; index++) await Promise.resolve();
    expect(mocks.rasterize).toHaveBeenCalledWith(source, expect.any(AbortSignal));
    expect(mocks.upload).toHaveBeenCalledWith(
      canvasBoard.id,
      png,
      "A drawing",
      expect.any(AbortSignal),
    );
    expect(view.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "image",
        mediaId: "00000000-0000-4000-8000-000000000099",
        altText: "A drawing",
      }),
    );
    expect(find(view.render(), (element) => element.type === "dialog")).toBeUndefined();
  });
  it("does not open SVG import when upload storage is unavailable", () => {
    const view = harness({
      board: { ...canvasBoard, imageUploadsAvailable: false },
      openRequest: { kind: "svg", id: 1 },
      hideButtons: true,
    });
    view.render();
    expect(find(view.render(), (element) => element.type === "dialog")).toBeUndefined();
    expect(mocks.rasterize).not.toHaveBeenCalled();
  });
});
