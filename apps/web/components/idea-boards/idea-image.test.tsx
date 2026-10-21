import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { boardId } from "../../test-utils/idea-board";
import { BoardIdeaImage } from "./idea-content";

type Hooks = {
  cursor: number;
  slots: unknown[];
  effects: Array<{ index: number; effect: ReactModule.EffectCallback }>;
};
const fixtures = vi.hoisted(() => ({ hooks: null as Hooks | null, fetchImage: vi.fn() }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index] as T,
        (value: T | ((previous: T) => T)) => {
          hooks.slots[index] =
            typeof value === "function"
              ? (value as (previous: T) => T)(hooks.slots[index] as T)
              : value;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial ?? {} };
      return hooks.slots[index];
    },
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: ReactModule.DependencyList) => {
      const hooks = fixtures.hooks;
      if (!hooks) {
        react.useEffect(effect, dependencies);
        return;
      }
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as ReactModule.DependencyList | undefined;
      if (
        !previous ||
        !dependencies ||
        dependencies.some((value, key) => !Object.is(value, previous[key]))
      )
        hooks.effects.push({ index, effect });
      hooks.slots[index] = dependencies;
    },
  };
});
vi.mock("../../lib/idea-board-client", () => ({ fetchIdeaBoardImage: fixtures.fetchImage }));
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ t: (key: keyof typeof english) => english[key] }),
}));

const cleanups: Array<() => void> = [];
function view() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  const props = {
    boardId,
    mediaId: "00000000-0000-4000-8000-000000000005",
    alt: "Private drawing",
    guestToken: "ab".repeat(32),
  };
  const effects = new Map<number, () => void>();
  const result = {
    props,
    render() {
      hooks.cursor = 0;
      hooks.effects = [];
      fixtures.hooks = hooks;
      try {
        return renderToStaticMarkup(BoardIdeaImage(props));
      } finally {
        fixtures.hooks = null;
      }
    },
    flushEffects() {
      for (const { index, effect } of hooks.effects) {
        effects.get(index)?.();
        const cleanup = effect();
        if (cleanup) effects.set(index, cleanup);
        else effects.delete(index);
      }
      hooks.effects = [];
    },
    mount() {
      result.render();
      result.flushEffects();
      result.render();
      result.flushEffects();
    },
    unmount() {
      effects.forEach((cleanup) => cleanup());
      effects.clear();
    },
  };
  cleanups.push(result.unmount);
  return result;
}
async function settle() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
afterEach(async () => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  await settle();
  fixtures.hooks = null;
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("board image lifetime", () => {
  it("renders an authorized blob URL and revokes it when the projected image disappears", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    fixtures.fetchImage.mockResolvedValue(new Blob(["synthetic image"], { type: "image/png" }));
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:private-image");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const image = view();
    image.mount();
    await settle();
    const markup = image.render();
    expect(markup).toContain('src="blob:private-image"');
    expect(markup).not.toContain("abababab");
    expect(create).toHaveBeenCalledOnce();
    const signal = fixtures.fetchImage.mock.calls[0]![3] as AbortSignal;
    expect(signal.aborted).toBe(false);
    image.unmount();
    expect(signal.aborted).toBe(true);
    expect(revoke).toHaveBeenCalledWith("blob:private-image");
  });

  it("waits until a card enters the viewport before reading bytes", async () => {
    let notify: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    fixtures.fetchImage.mockResolvedValue(new Blob(["visible image"], { type: "image/png" }));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:visible-image");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const image = view();
    image.mount();
    await settle();
    expect(fixtures.fetchImage).not.toHaveBeenCalled();
    notify([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    image.render();
    image.flushEffects();
    expect(fixtures.fetchImage).not.toHaveBeenCalled();
    notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    image.render();
    image.flushEffects();
    await settle();
    expect(fixtures.fetchImage).toHaveBeenCalledOnce();
    expect(image.render()).toContain('src="blob:visible-image"');
    expect(disconnect).toHaveBeenCalled();
  });

  it("ignores an image read that completes after unmount", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    let resolve: (blob: Blob) => void = () => {};
    fixtures.fetchImage.mockReturnValue(
      new Promise<Blob>((done) => {
        resolve = done;
      }),
    );
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:late-image");
    const image = view();
    image.mount();
    image.unmount();
    resolve(new Blob(["late image"], { type: "image/png" }));
    await settle();
    expect(create).not.toHaveBeenCalled();
  });
});
