import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SummarySource } from "@openround/contracts";
import { translate, type MessageKey } from "../../lib/i18n/catalog";
import { sessionSummaryEnglishMessages } from "../../lib/i18n/domains/session-summary";
import * as summaryClient from "../../lib/session-summary-client";
import { summarySource } from "../../test-utils/session-summary";
import { SessionSummaryButton } from "./summary-dialog";

interface ButtonHooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void | (() => void)>;
}

const fixtures = vi.hoisted(() => ({ hooks: null as ButtonHooks | null }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
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
    useEffect: (effect: () => void | (() => void)) => {
      if (fixtures.hooks) fixtures.hooks.effects.push(effect);
      else react.useEffect(effect);
    },
  };
});

vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    t: (key: MessageKey, values?: Record<string, string | number>) =>
      translate(sessionSummaryEnglishMessages, key, values),
  }),
}));

afterEach(() => {
  fixtures.hooks = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function buttonHarness() {
  const hooks: ButtonHooks = { cursor: 0, slots: [], effects: [] };
  let cleanup: (() => void) | undefined;
  return {
    render(source: SummarySource) {
      hooks.cursor = 0;
      hooks.effects = [];
      fixtures.hooks = hooks;
      try {
        return renderToStaticMarkup(SessionSummaryButton({ source }));
      } finally {
        fixtures.hooks = null;
      }
    },
    commitSourceEffect() {
      cleanup?.();
      const effect = hooks.effects[0];
      if (!effect) throw new Error("Expected the availability effect");
      const result = effect();
      cleanup = typeof result === "function" ? result : undefined;
    },
    unmount() {
      cleanup?.();
    },
  };
}

function deferredAvailability() {
  let resolve: (response: Response) => void;
  const promise = new Promise<Response>((complete) => {
    resolve = complete;
  });
  return {
    promise,
    complete(enabled: boolean) {
      // Body delivery can finish after the fetch promise and the current microtask queue.
      const body = new ReadableStream({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ enabled })));
            controller.close();
          }, 0);
        },
      });
      resolve(new Response(body));
    },
  };
}

describe("source-specific session summary availability", () => {
  it("hides unrelated paused sources and keeps a retained source available after an ID or kind change", async () => {
    const availability = vi.spyOn(summaryClient, "fetchSummaryAvailability");
    const retainedSource: SummarySource = {
      kind: "round",
      id: "00000000-0000-4000-8000-000000000003",
    };
    const unrelatedPresentation: SummarySource = { ...retainedSource, kind: "presentation" };
    const first = deferredAvailability();
    const retained = deferredAvailability();
    const presentation = deferredAvailability();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retained.promise)
      .mockReturnValueOnce(presentation.promise);
    vi.stubGlobal("fetch", fetchMock);
    const harness = buttonHarness();

    expect(harness.render(summarySource)).toBe("");
    harness.commitSourceEffect();
    first.complete(false);
    await availability.mock.results[0]!.value;
    expect(harness.render(summarySource)).toBe("");

    expect(harness.render(retainedSource)).toBe("");
    harness.commitSourceEffect();
    retained.complete(true);
    await vi.waitFor(() => expect(harness.render(retainedSource)).toContain("Share summary"));

    // A previous positive result must disappear during render, before the next effect runs.
    expect(harness.render(unrelatedPresentation)).toBe("");
    harness.commitSourceEffect();
    presentation.complete(false);
    await availability.mock.results[2]!.value;
    expect(harness.render(unrelatedPresentation)).toBe("");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/v1/session-summaries/features?kind=round&id=${summarySource.id}`,
      `/v1/session-summaries/features?kind=round&id=${retainedSource.id}`,
      `/v1/session-summaries/features?kind=presentation&id=${retainedSource.id}`,
    ]);
    harness.unmount();
  });

  it("aborts the old source request and ignores a late positive result for that source", async () => {
    const availability = vi.spyOn(summaryClient, "fetchSummaryAvailability");
    const currentSource: SummarySource = {
      kind: "survey",
      id: "00000000-0000-4000-8000-000000000004",
    };
    const previous = deferredAvailability();
    const current = deferredAvailability();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(previous.promise)
      .mockReturnValueOnce(current.promise);
    vi.stubGlobal("fetch", fetchMock);
    const harness = buttonHarness();
    harness.render(summarySource);
    harness.commitSourceEffect();
    const previousSignal = (fetchMock.mock.calls[0]![1] as RequestInit).signal;

    expect(harness.render(currentSource)).toBe("");
    harness.commitSourceEffect();
    expect(previousSignal?.aborted).toBe(true);
    expect(fetchMock.mock.calls[1]![0]).toBe(
      `/v1/session-summaries/features?kind=survey&id=${currentSource.id}`,
    );
    current.complete(false);
    await availability.mock.results[1]!.value;
    expect(harness.render(currentSource)).toBe("");
    // Model a transport that finishes even after its AbortSignal was cancelled.
    previous.complete(true);
    await availability.mock.results[0]!.value;
    expect(harness.render(currentSource)).toBe("");

    const currentSignal = (fetchMock.mock.calls[1]![1] as RequestInit).signal;
    harness.unmount();
    expect(currentSignal?.aborted).toBe(true);
  });
});
