import type { ReactElement } from "react";
import type * as ReactModule from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedLibraryImage } from "./shared-reader";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: ReactModule.EffectCallback[];
  mounted: boolean;
}
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null }));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useState: <T,>(initial: T) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (next: T) => (hooks.slots[index] = next)];
  },
  useEffect: (effect: ReactModule.EffectCallback) => {
    if (!mocked.hooks!.mounted) mocked.hooks!.effects.push(effect);
  },
}));
vi.mock("../../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));

function mountImage(index: number) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [], mounted: false };
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      return SharedLibraryImage({
        shareId: "00000000-0000-4000-8000-000000000001",
        mediaId: `00000000-0000-4000-8000-${(index + 2).toString(16).padStart(12, "0")}`,
        alt: `Published image ${index}`,
      }) as ReactElement<{ src: string }>;
    } finally {
      mocked.hooks = null;
    }
  }
  render();
  hooks.mounted = true;
  const cleanups = hooks.effects.map((effect) => effect());
  return { render, close: () => cleanups.forEach((cleanup) => cleanup?.()) };
}

afterEach(() => {
  mocked.hooks = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shared reader image bursts", () => {
  it("loads eight mounted images under a four-read server limit and cleans up their object URLs", async () => {
    let active = 0;
    let peak = 0;
    const fetchMock = vi.fn(async () => {
      if (active >= 4) return new Response("busy", { status: 503 });
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    let sequence = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:shared-image-${++sequence}`);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const images = Array.from({ length: 8 }, (_, index) => mountImage(index));
    try {
      await vi.waitFor(() =>
        expect(images.map((entry) => entry.render().type)).toEqual(Array(8).fill("img")),
      );
      expect(peak).toBe(2);
      expect(fetchMock).toHaveBeenCalledTimes(8);
      expect(new Set(images.map((entry) => entry.render().props.src)).size).toBe(8);
    } finally {
      images.forEach((entry) => entry.close());
    }
    expect(revoke).toHaveBeenCalledTimes(8);
  });
});
