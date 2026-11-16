import type * as ReactModule from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import {
  NativeSceneFitFeedback,
  nativeFitFeedbackText,
  type NativeFitFeedback,
} from "./native-scene-fit-feedback";
import { createNativeTableNode } from "../../lib/presentation-native-data";

const mocked = vi.hoisted(() => ({
  feedback: "",
  cleanup: null as null | (() => void),
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: (initial: NativeFitFeedback) => {
      mocked.feedback = nativeFitFeedbackText("en-CA", initial);
      return [
        initial,
        (value: NativeFitFeedback) => {
          mocked.feedback = nativeFitFeedbackText("en-CA", value);
        },
      ];
    },
    useEffect: (callback: () => void | (() => void)) => {
      mocked.cleanup = callback() ?? null;
    },
  };
});
afterEach(() => {
  mocked.cleanup?.();
  vi.unstubAllGlobals();
});

describe("measured native text fit feedback", () => {
  it("uses an explicit comparison locale with the provider language as its default", () => {
    const scene = createNativeContentBlock().scene!;
    const root = { current: null };
    const selected = renderToStaticMarkup(
      <NativeSceneFitFeedback root={root} scene={scene} locale="ko-KR" />,
    );
    const fallback = renderToStaticMarkup(<NativeSceneFitFeedback root={root} scene={scene} />);
    expect(selected).toContain('lang="ko-KR"');
    expect(selected).not.toContain("Check text fit after changing");
    expect(selected).toContain("텍스트");
    expect(fallback).toContain('lang="en-CA"');
    expect(fallback).toContain("Check text fit after changing");
  });
  it("reports actual data overflow by caption and rechecks it after resize", () => {
    const scene = createNativeContentBlock().scene!;
    const table = createNativeTableNode();
    table.caption = "Comparison";
    scene.schemaVersion = 4;
    scene.nodes.push(table);
    scene.readingOrder.push(table.id);
    const content = { scrollHeight: 220, clientHeight: 100, scrollWidth: 200, clientWidth: 200 };
    const node = { firstElementChild: content, dataset: { nodeId: table.id } };
    const stage = { clientWidth: 900, querySelectorAll: () => [node] };
    let resize = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    NativeSceneFitFeedback({
      scene,
      root: { current: { querySelector: () => stage } as unknown as HTMLDivElement },
    });
    expect(mocked.feedback).toContain("Comparison exceeds its frame");
    expect(mocked.feedback).toContain("data tables remain scrollable");
    content.clientHeight = 220;
    resize();
    expect(mocked.feedback).toContain("Text and data fit");
  });
  it("reports actual overflow, updates on resize and releases the observer", () => {
    const scene = createNativeContentBlock().scene!;
    const content = { scrollHeight: 150, clientHeight: 100, scrollWidth: 200, clientWidth: 200 };
    const text = { firstElementChild: content, dataset: { nodeId: scene.nodes[0]!.id } };
    const stage = { clientWidth: 900, querySelectorAll: () => [text] };
    const observe = vi.fn(),
      disconnect = vi.fn();
    let resize: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    NativeSceneFitFeedback({
      scene,
      root: { current: { querySelector: () => stage } as unknown as HTMLDivElement },
    });
    expect(mocked.feedback).toContain("Slide title exceeds its frame");
    expect(mocked.feedback).toContain("Full text remains scrollable");
    expect(observe).toHaveBeenCalledWith(stage);
    content.scrollHeight = 100;
    resize();
    expect(mocked.feedback).toContain("All text fits the current preview");
    mocked.cleanup?.();
    expect(disconnect).toHaveBeenCalled();
  });

  it("keeps actionable guidance instead of claiming text fits an unmeasurable preview", () => {
    const scene = createNativeContentBlock().scene!;
    vi.stubGlobal("ResizeObserver", undefined);
    const stage = { clientWidth: 0, querySelectorAll: () => [] };
    NativeSceneFitFeedback({
      scene,
      root: { current: { querySelector: () => stage } as unknown as HTMLDivElement },
    });
    expect(mocked.feedback).toContain("Check text fit");
    expect(mocked.feedback).not.toContain("All text fits");
  });
  function browserStage({ narrow = false, fixed = false, loading = false, outline = false } = {}) {
    const scene = createNativeContentBlock().scene!;
    const content = { scrollHeight: 100, clientHeight: 100, scrollWidth: 200, clientWidth: 200 };
    const node = { firstElementChild: content, dataset: { nodeId: scene.nodes[0]!.id } };
    const fontListeners = new Map<string, () => void>();
    const windowListeners = new Map<string, () => void>();
    let ready!: () => void;
    const fonts = {
      status: loading ? "loading" : "loaded",
      ready: new Promise<void>((resolve) => {
        ready = resolve;
      }),
      addEventListener: vi.fn((name: string, callback: () => void) =>
        fontListeners.set(name, callback),
      ),
      removeEventListener: vi.fn(),
    };
    const owner = {
      matchMedia: () => ({ matches: narrow }),
      addEventListener: vi.fn((name: string, callback: () => void) =>
        windowListeners.set(name, callback),
      ),
      removeEventListener: vi.fn(),
      requestAnimationFrame: vi.fn(() => 4),
      cancelAnimationFrame: vi.fn(),
    };
    const stage = {
      clientWidth: 1280,
      dataset: {
        nativeFixedLayout: fixed ? "true" : undefined,
        nativeOutline: outline ? "true" : undefined,
      },
      ownerDocument: { defaultView: owner, fonts },
      querySelectorAll: () => [node],
    };
    NativeSceneFitFeedback({
      scene,
      root: { current: { querySelector: () => stage } as unknown as HTMLDivElement },
    });
    return { stage, content, fonts, owner, fontListeners, windowListeners, ready };
  }
  it("does not mistake a narrow semantic reading stack for proof that the wide slide fits", () => {
    const h = browserStage({ narrow: true });
    expect(mocked.feedback).toContain("Wide slide fit cannot be checked");
    expect(mocked.feedback).not.toContain("All text fits");
    h.stage.dataset.nativeFixedLayout = "true";
    h.windowListeners.get("resize")!();
    expect(mocked.feedback).toContain("All text fits the current preview");
    h.content.scrollHeight = 240;
    h.windowListeners.get("resize")!();
    expect(mocked.feedback).toContain("exceeds its frame");
  });
  it("does not use an accessible outline on a wide screen as proof of framed text fit", () => {
    const h = browserStage({ fixed: true, outline: true });
    expect(mocked.feedback).toContain("Wide slide fit cannot be checked");
    h.stage.dataset.nativeOutline = undefined;
    h.windowListeners.get("resize")!();
    expect(mocked.feedback).toContain("All text fits");
  });
  it("waits for real fonts and remeasures on subsequent font loading and viewport changes", async () => {
    const h = browserStage({ fixed: true, loading: true });
    expect(mocked.feedback).toContain("waiting for slide fonts");
    expect(mocked.feedback).not.toContain("All text fits");
    h.fonts.status = "loaded";
    h.content.scrollHeight = 230;
    h.ready();
    await Promise.resolve();
    expect(mocked.feedback).toContain("exceeds its frame");
    h.fonts.status = "loading";
    h.fontListeners.get("loading")!();
    expect(mocked.feedback).toContain("waiting for slide fonts");
    h.fonts.status = "loaded";
    h.content.scrollHeight = 100;
    h.fontListeners.get("loadingdone")!();
    expect(mocked.feedback).toContain("All text fits");
    h.stage.clientWidth = 0;
    h.windowListeners.get("resize")!();
    expect(mocked.feedback).toContain("Check text fit");
    expect(mocked.feedback).not.toContain("All text fits");
  });
  it("does not report a fit for unmeasurable content or publish late font results after cleanup", async () => {
    const h = browserStage({ fixed: true, loading: true });
    h.fonts.status = "loaded";
    h.content.clientHeight = 0;
    h.fontListeners.get("loadingdone")!();
    expect(mocked.feedback).toContain("Check text fit");
    const callback = h.fontListeners.get("loadingdone")!;
    mocked.cleanup?.();
    mocked.feedback = "Preview closed";
    h.content.clientHeight = 100;
    callback();
    h.ready();
    await Promise.resolve();
    expect(mocked.feedback).toBe("Preview closed");
    expect(h.owner.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(h.fonts.removeEventListener).toHaveBeenCalledWith("loadingdone", expect.any(Function));
    expect(h.owner.cancelAnimationFrame).toHaveBeenCalledWith(4);
  });
});
