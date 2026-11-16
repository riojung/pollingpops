import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface EffectSlot {
  dependencies?: readonly unknown[];
  cleanup?: () => void;
}
interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
}
const fixture = vi.hoisted(() => ({ hooks: null as Hooks | null, read: vi.fn() }));
vi.mock("../../lib/api", () => ({
  apiFetch: fixture.read,
  AUTH_CHANGE_EVENT: "pollingpops:auth-change",
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T>(initial: T) => {
      if (!fixture.hooks) return react.useState(initial);
      const hooks = fixture.hooks,
        index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (value: T | ((old: T) => T)) => {
          hooks.slots[index] =
            typeof value === "function" ? (value as (old: T) => T)(hooks.slots[index] as T) : value;
        },
      ];
    },
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      if (!fixture.hooks) return react.useEffect(effect, dependencies);
      const hooks = fixture.hooks,
        index = hooks.cursor++;
      const previous = hooks.slots[index] as EffectSlot | undefined;
      if (
        previous &&
        dependencies?.every((value, i) => Object.is(value, previous.dependencies?.[i]))
      )
        return;
      previous?.cleanup?.();
      const slot: EffectSlot = { dependencies };
      hooks.slots[index] = slot;
      hooks.effects.push(() => {
        slot.cleanup = effect() || undefined;
      });
    },
  };
});
import {
  parsePublicationInfo,
  usePresentationPublicationInfo,
} from "./presentation-publication-info";
const listeners = new Set<() => void>();
const publication = { id: "publication-a", version: 2, publishedAt: "2026-10-11T12:00:00.000Z" };
beforeEach(() => {
  fixture.hooks = { cursor: 0, slots: [], effects: [] };
  fixture.read.mockReset();
  listeners.clear();
  vi.stubGlobal("window", {
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  });
});
afterEach(() => {
  fixture.hooks = null;
  vi.unstubAllGlobals();
});
function render(actor: string, version = "publication-a") {
  fixture.hooks!.cursor = 0;
  const result = usePresentationPublicationInfo(actor, "deck", version);
  fixture.hooks!.effects.splice(0).forEach((effect) => effect());
  return result;
}
async function flush() {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

describe("publication metadata authority", () => {
  it("accepts only the expected immutable version and strips unrelated server data", () => {
    expect(
      parsePublicationInfo(
        { publication: { ...publication, speakerNotes: "PRIVATE" } },
        publication.id,
      ),
    ).toEqual(publication);
    expect(parsePublicationInfo({ publication }, "another-version")).toBeNull();
    expect(
      parsePublicationInfo(
        { publication: { ...publication, publishedAt: "not-a-date" } },
        publication.id,
      ),
    ).toBeNull();
    expect(
      parsePublicationInfo({ publication: { ...publication, version: 0 } }, publication.id),
    ).toBeNull();
    expect(parsePublicationInfo({ publication: null }, publication.id)).toBeNull();
  });

  it("aborts and ignores a delayed response after the actor changes, then permits explicit retry", async () => {
    const requests: Array<{ resolve: (value: unknown) => void; signal: AbortSignal }> = [];
    fixture.read.mockImplementation(
      (_path: string, init: RequestInit) =>
        new Promise((resolve) => requests.push({ resolve, signal: init.signal as AbortSignal })),
    );
    render("owner:workspace-a");
    expect(render("viewer:workspace-b").state.status).toBe("loading");
    expect(requests[0]!.signal.aborted).toBe(true);
    requests[0]!.resolve({ publication });
    await flush();
    expect(render("viewer:workspace-b").state.status).toBe("loading");
    requests[1]!.resolve({ publication });
    await flush();
    expect(render("viewer:workspace-b").state.publication).toEqual(publication);
    listeners.forEach((listener) => listener());
    expect(requests[1]!.signal.aborted).toBe(true);
    const revoked = render("viewer:workspace-b");
    expect(revoked.state.status).toBe("unavailable");
    revoked.retry();
    render("viewer:workspace-b");
    expect(requests).toHaveLength(3);
    requests[2]!.resolve({ publication: { ...publication, id: "new-coauthor-publication" } });
    await flush();
    expect(render("viewer:workspace-b").state.status).toBe("unavailable");
  });
});
