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
type AssetKind = "image" | "svg" | "link";
function fillAssetDraft(view: ReturnType<typeof harness>, kind: AssetKind) {
  const tree = view.render();
  const change = (element: ReactElement<Record<string, unknown>>, value: string) =>
    (element.props.onChange as (event: unknown) => void)({ target: { value } });
  if (kind === "link") {
    change(
      find(tree, (element) => element.type === "input" && element.props.type === "url")!,
      "https://example.test/drawing",
    );
    change(
      find(tree, (element) => element.type === "input" && element.props.maxLength === 2000)!,
      "Drawing reference",
    );
    return null;
  }
  const source = new File(
    [kind === "svg" ? "<svg/>" : "png"],
    kind === "svg" ? "drawing.svg" : "drawing.png",
    { type: kind === "svg" ? "image/svg+xml" : "image/png" },
  );
  const file = find(tree, (element) => element.type === "input" && element.props.type === "file")!;
  (file.props.onChange as (event: unknown) => void)({ target: { files: [source] } });
  change(
    find(tree, (element) => element.type === "textarea")!,
    "A drawing",
  );
  return source;
}
function submitDraft(view: ReturnType<typeof harness>) {
  const form = find(view.render(), (element) => element.type === "form")!;
  (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
  return form;
}
async function settle() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
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

describe("asset mutation handoff", () => {
  it.each(["image", "svg", "link"] as const)(
    "closes and clears the %s draft when the editor retains an uncertain create",
    async (kind) => {
      const props: Partial<Parameters<typeof CanvasAssetTools>[0]> = {
        openRequest: { kind, id: 1 },
        hideButtons: true,
      };
      const view = harness(props);
      let finish!: (result: boolean) => void;
      view.onCreate.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      );
      mocks.rasterize.mockResolvedValue(new File(["png"], "drawing.png", { type: "image/png" }));
      mocks.upload.mockResolvedValue({
        mediaId: "00000000-0000-4000-8000-000000000099",
        altText: "A drawing",
      });
      view.render();
      fillAssetDraft(view, kind);
      // Rapid submit events must hand off only one object/upload.
      const form = submitDraft(view);
      (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
      await settle();
      expect(view.onCreate).toHaveBeenCalledOnce();
      expect(mocks.upload).toHaveBeenCalledTimes(kind === "link" ? 0 : 1);
      expect(find(view.render(), (element) => element.type === "dialog")).toBeDefined();
      finish(false);
      await settle();
      expect(find(view.render(), (element) => element.type === "dialog")).toBeUndefined();
      // The retained editor mutation disables new dialogs until its retry/discard resolves.
      props.disabled = true;
      props.openRequest = { kind, id: 2 };
      view.render();
      expect(find(view.render(), (element) => element.type === "dialog")).toBeUndefined();
      props.disabled = false;
      props.openRequest = { kind, id: 3 };
      view.render();
      const fresh = view.render();
      expect(find(fresh, (element) => element.type === "dialog")).toBeDefined();
      expect(find(fresh, (element) => element.props.role === "alert")).toBeUndefined();
      if (kind === "link") {
        expect(
          find(fresh, (element) => element.type === "input" && element.props.type === "url")!.props
            .value,
        ).toBe("");
        expect(
          find(fresh, (element) => element.type === "input" && element.props.maxLength === 2000)!
            .props.value,
        ).toBe("");
      } else {
        expect(find(fresh, (element) => element.type === "textarea")!.props.value).toBe("");
        expect(
          find(fresh, (element) => element.type === "button" && element.props.type === "submit")!
            .props.disabled,
        ).toBe(true);
        submitDraft(view);
        await settle();
      }
      expect(view.onCreate).toHaveBeenCalledOnce();
      expect(mocks.upload).toHaveBeenCalledTimes(kind === "link" ? 0 : 1);
      expect(mocks.rasterize).toHaveBeenCalledTimes(kind === "svg" ? 1 : 0);
    },
  );
  it.each(["image", "link"] as const)("closes a successful %s create", async (kind) => {
    const view = harness({ openRequest: { kind, id: 1 }, hideButtons: true });
    mocks.upload.mockResolvedValue({
      mediaId: "00000000-0000-4000-8000-000000000099",
      altText: "A drawing",
    });
    view.render();
    fillAssetDraft(view, kind);
    submitDraft(view);
    await settle();
    expect(view.onCreate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: kind,
        ...(kind === "link"
          ? { url: "https://example.test/drawing", text: "Drawing reference" }
          : {}),
      }),
    );
    expect(find(view.render(), (element) => element.type === "dialog")).toBeUndefined();
  });
  it.each(["image", "svg"] as const)(
    "retains a recoverable %s draft when upload or SVG conversion fails before handoff",
    async (kind) => {
      const view = harness({ openRequest: { kind, id: 1 }, hideButtons: true });
      if (kind === "image") mocks.upload.mockRejectedValueOnce(new Error("Upload failed"));
      else mocks.rasterize.mockRejectedValueOnce(new Error("Unsupported SVG"));
      view.render();
      const source = fillAssetDraft(view, kind);
      submitDraft(view);
      await settle();
      const failed = view.render();
      expect(find(failed, (element) => element.type === "dialog")).toBeDefined();
      expect(find(failed, (element) => element.props.role === "alert")).toBeDefined();
      expect(find(failed, (element) => element.type === "textarea")!.props.value).toBe("A drawing");
      expect(
        find(failed, (element) => element.type === "button" && element.props.type === "submit")!
          .props.disabled,
      ).toBe(false);
      expect(view.onCreate).not.toHaveBeenCalled();
      mocks.rasterize.mockResolvedValue(new File(["png"], "drawing.png", { type: "image/png" }));
      mocks.upload.mockResolvedValue({
        mediaId: "00000000-0000-4000-8000-000000000099",
        altText: "A drawing",
      });
      // The same retained file can be retried without choosing it again.
      submitDraft(view);
      await settle();
      if (kind === "svg")
        expect(mocks.rasterize).toHaveBeenLastCalledWith(source, expect.any(AbortSignal));
      else
        expect(mocks.upload).toHaveBeenLastCalledWith(
          canvasBoard.id,
          source,
          "A drawing",
          expect.any(AbortSignal),
        );
      expect(view.onCreate).toHaveBeenCalledOnce();
      expect(find(view.render(), (element) => element.type === "dialog")).toBeUndefined();
    },
  );
  it("retains invalid link fields for correction before any mutation handoff", async () => {
    const view = harness({ openRequest: { kind: "link", id: 1 }, hideButtons: true });
    view.render();
    fillAssetDraft(view, "link");
    const url = find(
      view.render(),
      (element) => element.type === "input" && element.props.type === "url",
    )!;
    (url.props.onChange as (event: unknown) => void)({
      target: { value: "https://user:password@example.test/drawing" },
    });
    submitDraft(view);
    await settle();
    const failed = view.render();
    expect(find(failed, (element) => element.props.role === "alert")).toBeDefined();
    expect(
      find(failed, (element) => element.type === "input" && element.props.type === "url")!.props
        .value,
    ).toBe("https://user:password@example.test/drawing");
    expect(
      find(failed, (element) => element.type === "input" && element.props.maxLength === 2000)!.props
        .value,
    ).toBe("Drawing reference");
    expect(view.onCreate).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    (url.props.onChange as (event: unknown) => void)({
      target: { value: "https://example.test/drawing" },
    });
    submitDraft(view);
    await settle();
    expect(view.onCreate).toHaveBeenCalledOnce();
    expect(find(view.render(), (element) => element.type === "dialog")).toBeUndefined();
  });
});
