import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type { PresentationReview } from "@openround/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../lib/api";
import { presentationReviewTokenKey } from "../../lib/presentation-sharing-client";
import type * as ShareClient from "../../lib/presentation-sharing-client";
import { PresentationReviewPage } from "./review-page";

interface Hooks {
  cursor: number;
  slots: unknown[];
  dependencies: Map<number, readonly unknown[] | undefined>;
  effects: Array<{ index: number; effect: ReactModule.EffectCallback }>;
  cleanups: Map<number, void | (() => void)>;
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  review: vi.fn(),
  access: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useRef: <T,>(initial: T) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    hooks.slots[index] ??= { current: initial };
    return hooks.slots[index];
  },
  useState: <T,>(initial: T) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (next: T | ((current: T) => T)) => {
        hooks.slots[index] =
          typeof next === "function" ? (next as (current: T) => T)(hooks.slots[index] as T) : next;
      },
    ];
  },
  useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    const previous = hooks.dependencies.get(index);
    if (
      !hooks.dependencies.has(index) ||
      !dependencies ||
      dependencies.some((value, dependency) => value !== previous?.[dependency])
    )
      hooks.effects.push({ index, effect });
    hooks.dependencies.set(index, dependencies);
  },
}));
vi.mock("../../lib/presentation-sharing-client", async (original) => ({
  ...(await original<typeof ShareClient>()),
  fetchPresentationReview: mocked.review,
  fetchPresentationShareAccess: mocked.access,
}));

const shareId = "00000000-0000-4000-8000-000000000001";
const otherShareId = "00000000-0000-4000-8000-000000000002";
const versionId = "00000000-0000-4000-8000-000000000003";
const launchToken = "A".repeat(43);
const replacementToken = "B".repeat(43);
const mounted = new Set<{ close: () => void }>();

function reviewFixture(): PresentationReview {
  return {
    schemaVersion: 1,
    versionId,
    version: 1,
    title: "Recovered private presentation",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    sections: [],
    blocks: [
      {
        id: "00000000-0000-4000-8000-000000000004",
        kind: "question",
        question: {
          type: "poll",
          prompt: "Review this evidence",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  };
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
}
function mount(initialShareId = shareId) {
  const hooks: Hooks = {
    cursor: 0,
    slots: [],
    dependencies: new Map(),
    effects: [],
    cleanups: new Map(),
  };
  let currentShareId = initialShareId;
  function render(nextShareId = currentShareId) {
    currentShareId = nextShareId;
    hooks.cursor = 0;
    hooks.effects = [];
    mocked.hooks = hooks;
    let tree: ReactNode;
    try {
      tree = PresentationReviewPage({ shareId: currentShareId });
    } finally {
      mocked.hooks = null;
    }
    for (const { index, effect } of hooks.effects) {
      hooks.cleanups.get(index)?.();
      hooks.cleanups.set(index, effect());
    }
    return elements(tree);
  }
  const page = {
    render,
    text: () =>
      render()
        .map((element) => text(element.props.children as ReactNode))
        .join(" "),
    close() {
      for (const cleanup of hooks.cleanups.values()) cleanup?.();
      hooks.cleanups.clear();
      mounted.delete(page);
    },
  };
  mounted.add(page);
  render();
  return page;
}
function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T12:00:00.000Z"));
  const location = {
    href: `https://example.test/presentation-review/${shareId}#token=${launchToken}`,
  };
  const storage = {
    getItem: vi.fn(() => {
      throw new Error("Storage unavailable");
    }),
    setItem: vi.fn(() => {
      throw new Error("Storage unavailable");
    }),
    removeItem: vi.fn(() => {
      throw new Error("Storage unavailable");
    }),
  };
  const history = {
    state: null,
    replaceState: vi.fn((_state: unknown, _unused: string, path: string) => {
      location.href = new URL(path, location.href).href;
    }),
  };
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("window", {
    location,
    history,
    sessionStorage: storage,
    setTimeout,
    addEventListener: (name: string, listener: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    removeEventListener: (name: string, listener: () => void) => {
      listeners.get(name)?.delete(listener);
    },
  });
  mocked.review.mockReset().mockResolvedValue(reviewFixture());
  mocked.access.mockReset();
  return {
    storage,
    history,
    location,
    listeners,
    dispatch(name: "focus" | "hashchange") {
      for (const listener of [...(listeners.get(name) ?? [])]) listener();
    },
  };
}
async function settle(page: ReturnType<typeof mount>) {
  await vi.advanceTimersByTimeAsync(0);
  page.render();
}
function expectRequest(index: number, id = shareId, token = launchToken) {
  expect(mocked.review.mock.calls[index]?.slice(0, 2)).toEqual([id, token]);
  expect(mocked.review.mock.calls[index]?.[2]).toBeInstanceOf(AbortSignal);
}
afterEach(() => {
  for (const page of [...mounted]) page.close();
  mocked.hooks = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("private review recovery without per-tab storage", () => {
  it("opens the URL token, scrubs it, and uses the same credential when focus reloads", async () => {
    const environment = setup();
    const page = mount();
    await settle(page);
    expect(page.text()).toContain("Recovered private presentation");
    expect(mocked.review).toHaveBeenCalledTimes(1);
    expectRequest(0);
    expect(environment.storage.setItem).toHaveBeenCalledWith(
      presentationReviewTokenKey(shareId),
      launchToken,
    );
    expect(new URL(environment.location.href).hash).toBe("");
    expect(environment.history.replaceState).toHaveBeenCalledOnce();

    environment.dispatch("focus");
    await settle(page);
    expect(mocked.review).toHaveBeenCalledTimes(2);
    expectRequest(1);
    expect(environment.storage.getItem).toHaveBeenCalledWith(presentationReviewTokenKey(shareId));
    expect(page.text()).toContain("Recovered private presentation");
  });

  it.each([401, 403, 404, 410])(
    "clears the in-memory credential after authoritative denial %s and never reuses it on focus",
    async (status) => {
      const environment = setup();
      const page = mount();
      await settle(page);
      mocked.review.mockRejectedValueOnce(
        new ApiClientError("Unavailable", "PRESENTATION_UNAVAILABLE", status),
      );
      environment.dispatch("focus");
      await settle(page);
      expect(mocked.review).toHaveBeenCalledTimes(2);
      expectRequest(1);
      expect(page.text()).not.toContain("Recovered private presentation");
      expect(page.text()).toContain("unavailable or has expired");
      expect(environment.storage.removeItem).toHaveBeenCalledWith(
        presentationReviewTokenKey(shareId),
      );

      environment.dispatch("focus");
      await settle(page);
      expect(mocked.review).toHaveBeenCalledTimes(2);
      expect(page.text()).not.toContain("Recovered private presentation");
    },
  );

  it.each([
    new TypeError("Network unavailable"),
    new ApiClientError("Try later", "TEMPORARILY_UNAVAILABLE", 503),
  ])("retains the credential after a transient reload failure: %s", async (failure) => {
    const environment = setup();
    const page = mount();
    await settle(page);
    mocked.review.mockRejectedValueOnce(failure);
    environment.dispatch("focus");
    await settle(page);
    expect(mocked.review).toHaveBeenCalledTimes(2);
    expectRequest(1);
    expect(page.text()).not.toContain("Recovered private presentation");
    expect(environment.storage.removeItem).not.toHaveBeenCalled();

    environment.dispatch("focus");
    await settle(page);
    expect(mocked.review).toHaveBeenCalledTimes(3);
    expectRequest(2);
    expect(page.text()).toContain("Recovered private presentation");
  });

  it.each([
    "#token=invalid",
    `#token=${launchToken}&token=${replacementToken}`,
    `?token=${launchToken}`,
  ])(
    "rejects an explicit invalid incoming credential instead of reusing the old one: %s",
    async (incoming) => {
      const environment = setup();
      const page = mount();
      await settle(page);
      environment.location.href = `https://example.test/presentation-review/${shareId}${incoming}`;
      environment.dispatch("hashchange");
      await settle(page);
      expect(mocked.review).toHaveBeenCalledTimes(1);
      expect(page.text()).not.toContain("Recovered private presentation");
      expect(new URL(environment.location.href).hash).toBe("");
      expect(new URL(environment.location.href).searchParams.has("token")).toBe(false);

      environment.dispatch("focus");
      await settle(page);
      expect(mocked.review).toHaveBeenCalledTimes(1);
    },
  );

  it("replaces the in-memory credential with a valid new fragment and retains that replacement", async () => {
    const environment = setup();
    const page = mount();
    await settle(page);
    environment.location.href += `#token=${replacementToken}`;
    environment.dispatch("hashchange");
    await settle(page);
    expect(mocked.review).toHaveBeenCalledTimes(2);
    expectRequest(1, shareId, replacementToken);
    expect(new URL(environment.location.href).hash).toBe("");

    environment.dispatch("focus");
    await settle(page);
    expect(mocked.review).toHaveBeenCalledTimes(3);
    expectRequest(2, shareId, replacementToken);
    expect(page.text()).toContain("Recovered private presentation");
  });

  it("clears the credential when the share effect changes or unmounts", async () => {
    const environment = setup();
    const page = mount();
    await settle(page);
    const firstSignal = mocked.review.mock.calls[0]![2] as AbortSignal;
    environment.location.href = `https://example.test/presentation-review/${otherShareId}`;
    page.render(otherShareId);
    await settle(page);
    expect(firstSignal.aborted).toBe(true);
    expect(environment.listeners.get("focus")?.size).toBe(1);
    expect(page.text()).not.toContain("Recovered private presentation");
    environment.dispatch("focus");
    await settle(page);
    expect(mocked.review).toHaveBeenCalledTimes(1);

    environment.location.href += `#token=${replacementToken}`;
    environment.dispatch("hashchange");
    await settle(page);
    expect(mocked.review).toHaveBeenCalledTimes(2);
    expectRequest(1, otherShareId, replacementToken);
    const otherSignal = mocked.review.mock.calls[1]![2] as AbortSignal;
    page.close();
    expect(otherSignal.aborted).toBe(true);
    expect(environment.listeners.get("focus")?.size).toBe(0);
    expect(environment.listeners.get("hashchange")?.size).toBe(0);
    environment.dispatch("focus");
    await vi.advanceTimersByTimeAsync(0);
    expect(mocked.review).toHaveBeenCalledTimes(2);

    const reopened = mount(otherShareId);
    await settle(reopened);
    expect(mocked.review).toHaveBeenCalledTimes(2);
    expect(reopened.text()).not.toContain("Recovered private presentation");
  });
});
