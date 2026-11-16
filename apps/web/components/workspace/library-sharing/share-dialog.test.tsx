import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Client from "./client";
import { LibraryShareDialog } from "./share-dialog";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: ReactModule.EffectCallback[];
  mounted: boolean;
}
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null, create: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useId: () => "share-dialog",
  useRef: <T,>(initial: T) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    hooks.slots[index] ??= { current: initial };
    return hooks.slots[index];
  },
  useState: <T,>(initial: T | (() => T)) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    if (!(index in hooks.slots))
      hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [
      hooks.slots[index],
      (next: T | ((current: T) => T)) => {
        hooks.slots[index] =
          typeof next === "function" ? (next as (current: T) => T)(hooks.slots[index] as T) : next;
      },
    ];
  },
  useEffect: (effect: ReactModule.EffectCallback) => {
    if (!mocked.hooks!.mounted) mocked.hooks!.effects.push(effect);
  },
}));
vi.mock("../../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
vi.mock("../workspace-provider", () => ({
  useWorkspace: () => ({ creator: { userId: "actor", workspaceId: "workspace" } }),
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof Client>()),
  createLibraryShare: mocked.create,
}));
const source = {
  artifactType: "round" as const,
  artifactId: "00000000-0000-4000-8000-000000000001",
  versionId: "00000000-0000-4000-8000-000000000002",
  title: "Published Round",
};
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function mount() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [], mounted: false };
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      return elements(LibraryShareDialog({ source, onClose: vi.fn() }));
    } finally {
      mocked.hooks = null;
    }
  }
  render();
  hooks.mounted = true;
  const cleanups = hooks.effects.map((effect) => effect());
  return {
    render,
    submit() {
      (
        render().find((element) => element.type === "form")!.props.onSubmit as (event: {
          preventDefault: () => void;
        }) => void
      )({ preventDefault: vi.fn() });
    },
    close: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  mocked.create.mockReset();
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout,
    clearTimeout,
  });
});
afterEach(() => {
  mocked.hooks = null;
  vi.unstubAllGlobals();
});

describe("published share retry recovery", () => {
  it("reopens an uncertain request and retries its exact pinned publication without creating a second intent", async () => {
    mocked.create
      .mockRejectedValueOnce(new TypeError("Disconnected"))
      .mockResolvedValueOnce({ id: source.artifactId });
    const first = mount();
    first.submit();
    await vi.waitFor(() =>
      expect(first.render().some((element) => element.props.role === "alert")).toBe(true),
    );
    expect(values.size).toBe(1);
    const original = mocked.create.mock.calls[0]![0];
    expect(original).toMatchObject({
      versionId: source.versionId,
      artifactId: source.artifactId,
      audience: "organization",
      permission: "view",
    });
    first.close();
    const reopened = mount();
    expect(
      reopened
        .render()
        .filter((element) => element.type === "select")
        .every((element) => element.props.disabled === true),
    ).toBe(true);
    reopened.submit();
    await vi.waitFor(() => expect(values.size).toBe(0));
    expect(mocked.create.mock.calls[1]![0]).toEqual(original);
    reopened.close();
  });

  it("guards rapid repeated submissions before React renders a busy state", async () => {
    let finish!: (value: { id: string }) => void;
    mocked.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const dialog = mount();
    dialog.submit();
    dialog.submit();
    expect(mocked.create).toHaveBeenCalledTimes(1);
    finish({ id: source.artifactId });
    await vi.waitFor(() => expect(values.size).toBe(0));
    dialog.close();
  });
});
