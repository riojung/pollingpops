import type * as ReactModule from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import { NativeSceneFitFeedback } from "./native-scene-fit-feedback";

const mocked = vi.hoisted(() => ({
  feedback: "",
  cleanup: null as null | (() => void),
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: (initial: string) => {
      mocked.feedback = initial;
      return [
        initial,
        (value: string) => {
          mocked.feedback = value;
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
});
