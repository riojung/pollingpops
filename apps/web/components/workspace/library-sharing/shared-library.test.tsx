import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Client from "./client";
import { SharedLibrary } from "./shared-library";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
}
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null, list: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
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
  useEffect: (effect: ReactModule.EffectCallback, deps: ReactModule.DependencyList) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as
      { deps: ReactModule.DependencyList; cleanup?: () => void } | undefined;
    if (
      previous &&
      previous.deps.length === deps.length &&
      deps.every((value, offset) => Object.is(previous.deps[offset], value))
    )
      return;
    const slot: { deps: ReactModule.DependencyList; cleanup?: () => void } = { deps };
    hooks.slots[index] = slot;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      slot.cleanup = effect() || undefined;
    });
  },
}));
vi.mock("../../locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: string) => key }),
}));
vi.mock("../workspace-provider", () => ({
  useWorkspace: () => ({
    creator: { userId: "actor", workspaceId: "workspace" },
    workspace: null,
    management: null,
    canEdit: true,
  }),
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof Client>()),
  listLibraryShares: mocked.list,
}));
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function mount(initialQuery: string) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  let query = initialQuery;
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      return elements(SharedLibrary({ scope: "shared", type: "rounds", query }));
    } finally {
      mocked.hooks = null;
    }
  }
  function flushEffects() {
    const effects = hooks.effects.splice(0);
    effects.forEach((effect) => effect());
  }
  return {
    render,
    flushEffects,
    navigate(next: string) {
      query = next;
      render();
      flushEffects();
    },
    titles: () =>
      render()
        .filter((element) => element.type === "h2")
        .map((element) => element.props.children),
    search: () =>
      render().find((element) => element.type === "input" && element.props.type === "search")!,
  };
}
beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  mocked.list.mockReset().mockResolvedValue({
    shares: [
      {
        id: "north",
        artifactType: "round",
        title: "North readiness",
        description: "",
        organizationName: "Organization",
        sourceWorkspaceName: "Source",
        message: "",
        permission: "view",
        progress: "new",
        dueAt: null,
      },
      {
        id: "south",
        artifactType: "round",
        title: "South follow-up",
        description: "",
        organizationName: "Organization",
        sourceWorkspaceName: "Source",
        message: "",
        permission: "view",
        progress: "new",
        dueAt: null,
      },
    ],
    nextCursor: null,
  });
});
afterEach(() => {
  mocked.hooks = null;
  vi.unstubAllGlobals();
});

describe("shared collection header search", () => {
  it("initializes from q and filters loaded cards when header navigation changes or clears q", async () => {
    const library = mount("north");
    expect(library.search().props.value).toBe("north");
    library.flushEffects();
    await vi.waitFor(() => expect(library.titles()).toEqual(["North readiness"]));
    library.navigate("south");
    expect(library.search().props.value).toBe("south");
    expect(library.titles()).toEqual(["South follow-up"]);
    library.navigate("");
    expect(library.search().props.value).toBe("");
    expect(library.titles()).toEqual(["North readiness", "South follow-up"]);
    expect(mocked.list).toHaveBeenCalledTimes(1);
  });
});
