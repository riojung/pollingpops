import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type * as ApiModule from "../../lib/api";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_CHANGE_EVENT } from "../../lib/api";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
  cleanups: Array<() => void>;
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  request: vi.fn(),
  router: { push: vi.fn() },
  canEdit: true,
  feature: true,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (!mocked.hooks) return react.useState(initial);
      const hooks = mocked.hooks;
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index] as T,
        (value: T | ((old: T) => T)) => {
          hooks.slots[index] =
            typeof value === "function" ? (value as (old: T) => T)(hooks.slots[index] as T) : value;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      if (!mocked.hooks) return react.useRef(initial);
      const index = mocked.hooks.cursor++;
      mocked.hooks.slots[index] ??= { current: initial };
      return mocked.hooks.slots[index];
    },
    useEffect: (effect: ReactModule.EffectCallback, deps: ReactModule.DependencyList) => {
      if (!mocked.hooks) return react.useEffect(effect, deps);
      const hooks = mocked.hooks;
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as ReactModule.DependencyList | undefined;
      if (!previous || deps.some((value, i) => value !== previous[i])) {
        hooks.slots[index] = deps;
        hooks.effects.push(() => {
          const cleanup = effect();
          if (cleanup) hooks.cleanups.push(cleanup);
        });
      }
    },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => mocked.router }));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiFetch: mocked.request,
}));
vi.mock("./workspace-provider", () => ({
  useWorkspace: () => ({
    creator: { userId: mocked.userId, workspaceId: mocked.workspaceId },
    canEdit: mocked.canEdit,
    productFeatures: { presentations: mocked.feature },
  }),
}));

import { PresentationOutlineStart } from "./presentation-outline-start";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function harness() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [], cleanups: [] };
  let tree: ReactNode;
  const render = () => {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      tree = PresentationOutlineStart();
    } finally {
      mocked.hooks = null;
    }
    hooks.effects.splice(0).forEach((effect) => effect());
    return renderToStaticMarkup(tree);
  };
  const find = (predicate: (element: ReactElement<Record<string, unknown>>) => boolean) => {
    const found = elements(tree).find(predicate);
    if (!found) throw new Error("Expected control");
    return found;
  };
  return {
    render,
    button: (name: string) =>
      find((node) => node.type === "button" && node.props.children === name),
    title: () => find((node) => node.type === "input"),
    submit: async () => {
      await (
        find((node) => node.type === "form").props.onSubmit as (event: unknown) => Promise<void>
      )({ preventDefault: vi.fn() });
    },
    click: async (name: string) => {
      await (
        find((node) => node.type === "button" && node.props.children === name).props
          .onClick as () => Promise<void> | void
      )();
    },
    unmount: () => hooks.cleanups.forEach((cleanup) => cleanup()),
  };
}
const entries = new Map<string, string>();
const storage = {
  getItem: vi.fn((key: string) => entries.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    entries.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    entries.delete(key);
  }),
};
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
beforeEach(() => {
  vi.clearAllMocks();
  entries.clear();
  mocked.canEdit = true;
  mocked.feature = true;
  mocked.workspaceId = "00000000-0000-4000-8000-000000000002";
  mocked.request.mockResolvedValue({
    presentation: { id: "00000000-0000-4000-8000-000000000003" },
  });
  storage.getItem.mockImplementation((key) => entries.get(key) ?? null);
  storage.setItem.mockImplementation((key, value) => {
    entries.set(key, value);
  });
  const target = new EventTarget();
  Object.assign(target, { sessionStorage: storage });
  vi.stubGlobal("window", target);
});
afterEach(() => {
  mocked.hooks = null;
  vi.unstubAllGlobals();
});

describe("outline-first creation panel", () => {
  it("explains the saved-draft boundary and offers an accessible explicit title form without creating on mount", () => {
    const view = harness();
    expect(view.render()).toContain("Checking draft recovery");
    const markup = view.render();
    expect(markup).toContain('lang="en-CA"');
    expect(markup).toContain('aria-labelledby="outline-start-title"');
    expect(markup).toContain("Presentation title");
    expect(markup).toContain("Create draft and continue");
    expect(markup).toContain("does not use an AI job");
    expect(markup).toContain("Your draft stays in your Library");
    expect(markup).toContain("Nothing is published automatically");
    expect(view.button("Create draft and continue").props.disabled).toBe(true);
    expect(mocked.request).not.toHaveBeenCalled();
    view.unmount();
  });

  it("recovers a lost acknowledgement across remount with the same request and keeps a known draft on Back", async () => {
    mocked.request.mockRejectedValueOnce(new TypeError("Connection lost"));
    const first = harness();
    first.render();
    first.render();
    (first.title().props.onChange as (event: unknown) => void)({
      target: { value: "Launch outline" },
    });
    first.render();
    await first.submit();
    await settle();
    expect(first.render()).toContain("Retry draft creation");
    expect(first.title().props.readOnly).toBe(true);
    expect(mocked.router.push).not.toHaveBeenCalled();
    const body = mocked.request.mock.calls[0]![1].body;
    first.unmount();
    const recovered = harness();
    recovered.render();
    recovered.render();
    await recovered.click("Retry draft creation");
    await settle();
    expect(mocked.request.mock.calls[1]![1].body).toBe(body);
    expect(mocked.request.mock.calls[1]![0]).toBe("/v1/presentations/outline-drafts");
    expect(mocked.router.push).toHaveBeenCalledWith(
      "/presentation/00000000-0000-4000-8000-000000000003?start=outline",
    );
    recovered.unmount();
    const back = harness();
    back.render();
    expect(back.render()).toContain("Open saved draft");
    await back.click("Open saved draft");
    expect(mocked.request).toHaveBeenCalledTimes(2);
    expect(mocked.router.push).toHaveBeenCalledTimes(2);
    await back.click("Start another");
    expect(back.render()).toContain("Create draft and continue");
    expect(entries.size).toBe(0);
    back.unmount();
  });

  it.each(["viewer", "feature disabled"])("blocks explicit creation for %s", async (scenario) => {
    mocked.canEdit = scenario !== "viewer";
    mocked.feature = scenario !== "feature disabled";
    const view = harness();
    view.render();
    view.render();
    (view.title().props.onChange as (event: unknown) => void)({ target: { value: "Blocked" } });
    view.render();
    expect(view.button("Create draft and continue").props.disabled).toBe(true);
    await view.submit();
    expect(mocked.request).not.toHaveBeenCalled();
    view.unmount();
  });

  it("shows recoverable storage feedback without sending a create request", async () => {
    storage.getItem.mockImplementation(() => {
      throw new Error("Restricted");
    });
    const view = harness();
    view.render();
    expect(view.render()).toContain("Allow tab storage");
    expect(view.render()).not.toContain("Create draft and continue");
    storage.getItem.mockImplementation((key) => entries.get(key) ?? null);
    await view.click("Retry tab recovery");
    expect(view.render()).toContain("Create draft and continue");
    expect(mocked.request).not.toHaveBeenCalled();
    view.unmount();
  });

  it("offers only explicit Start another after a definitive deleted draft receipt", async () => {
    const { ApiClientError } = await import("../../lib/api");
    mocked.request.mockRejectedValueOnce(new ApiClientError("Draft deleted", "GONE", 410));
    const view = harness();
    view.render();
    view.render();
    (view.title().props.onChange as (event: unknown) => void)({
      target: { value: "Deleted draft" },
    });
    view.render();
    await view.submit();
    await settle();
    const markup = view.render();
    expect(markup).toContain("The draft from this request was deleted");
    expect(markup).toContain("Start another");
    expect(markup).not.toContain("Retry draft creation");
    expect(markup).not.toContain("Open saved draft");
    await view.click("Start another");
    expect(view.render()).toContain("Create draft and continue");
    view.unmount();
  });

  it("scrubs the title and fences an accepted response after sign-in changes", async () => {
    let finish!: (value: unknown) => void;
    mocked.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = harness();
    view.render();
    view.render();
    (view.title().props.onChange as (event: unknown) => void)({
      target: { value: "Private title" },
    });
    view.render();
    await view.submit();
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    const markup = view.render();
    expect(markup).toContain("Your sign-in changed");
    expect(markup).not.toContain("Private title");
    finish({ presentation: { id: "00000000-0000-4000-8000-000000000003" } });
    await settle();
    expect(mocked.router.push).not.toHaveBeenCalled();
    view.unmount();
  });

  it("hides the previous workspace title immediately and fences its late acknowledgement", async () => {
    let finish!: (value: unknown) => void;
    mocked.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = harness();
    view.render();
    view.render();
    (view.title().props.onChange as (event: unknown) => void)({
      target: { value: "Other workspace title" },
    });
    view.render();
    await view.submit();
    const body = JSON.parse(mocked.request.mock.calls[0]![1].body);
    expect(body.creationContext.workspaceId).toBe(mocked.workspaceId);
    mocked.workspaceId = "00000000-0000-4000-8000-000000000004";
    expect(view.render()).not.toContain("Other workspace title");
    finish({ presentation: { id: "00000000-0000-4000-8000-000000000003" } });
    await settle();
    expect(mocked.router.push).not.toHaveBeenCalled();
    expect(view.render()).toContain("Create draft and continue");
    expect(view.render()).not.toContain("Other workspace title");
    view.unmount();
  });
});
