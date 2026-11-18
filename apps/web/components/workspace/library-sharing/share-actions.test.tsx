import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type { LibraryShareSummary } from "@openround/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Client from "./client";
import type * as ActionsModule from "./share-actions";
import type * as ApiModule from "../../../lib/api";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  creator: { userId: "actor-a", workspaceId: "workspace-a" } as {
    userId: string;
    workspaceId: string;
  } | null,
  copy: vi.fn(),
  progress: vi.fn(),
  push: vi.fn(),
}));
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocked.push }) }));
vi.mock("../../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
vi.mock("../workspace-provider", () => ({ useWorkspace: () => ({ creator: mocked.creator }) }));
vi.mock("./client", async (original) => ({
  ...(await original<typeof Client>()),
  copyLibraryShare: mocked.copy,
  updateLibraryShareProgress: mocked.progress,
}));

const share: LibraryShareSummary = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  organizationName: "Organization",
  sourceWorkspaceId: "00000000-0000-4000-8000-000000000003",
  sourceWorkspaceName: "Source",
  artifactType: "round",
  artifactId: "00000000-0000-4000-8000-000000000004",
  versionId: "00000000-0000-4000-8000-000000000005",
  title: "Shared Round",
  description: "",
  sharedAt: "2026-11-16T12:00:00.000Z",
  permission: "use",
  audience: "people",
  message: "",
  dueAt: null,
  progress: "new",
  capabilities: { view: true, copy: true, manage: false },
};
const copied = {
  artifactType: "round",
  artifactId: "00000000-0000-4000-8000-000000000006",
  workspaceId: "workspace-a",
  href: "/quiz/copied-round",
};
let Actions: typeof ActionsModule.LibraryShareActions;
let ApiClientError: typeof ApiModule.ApiClientError;
let values: Map<string, string>;
const cleanups: Array<() => void> = [];
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function content(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(content).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? content(node.props.children) : "";
}
function mount(value = share, onAccessChanged?: () => void) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    let result;
    try {
      result = elements(
        Actions({ share: value, onChange: vi.fn(), onRevoked: vi.fn(), onAccessChanged }),
      );
    } finally {
      mocked.hooks = null;
    }
    const effects = hooks.effects.splice(0);
    effects.forEach((effect) => effect());
    return result;
  }
  const close = () =>
    hooks.slots.forEach((slot) => (slot as { cleanup?: () => void })?.cleanup?.());
  cleanups.push(close);
  render();
  return {
    render,
    close,
    click(label = "Use a copy") {
      const button = render().find(
        (element) =>
          element.type === "button" && content(element.props.children as ReactNode) === label,
      )!;
      expect(button, label).toBeDefined();
      (button.props.onClick as () => void)();
    },
    failed: () => render().some((element) => element.props.role === "alert"),
  };
}
beforeEach(async () => {
  vi.resetModules();
  mocked.creator = { userId: "actor-a", workspaceId: "workspace-a" };
  mocked.copy.mockReset();
  mocked.progress.mockReset();
  mocked.push.mockReset();
  values = new Map();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  Actions = (await import("./share-actions")).LibraryShareActions;
  ApiClientError = (await import("../../../lib/api")).ApiClientError;
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  mocked.hooks = null;
  vi.unstubAllGlobals();
});

describe("independent-copy request recovery", () => {
  it.each([401, 403, 404])(
    "revalidates a current share after authority failure %i without settling a copy intent",
    async (status) => {
      const accessChanged = vi.fn();
      mocked.copy.mockRejectedValue(new ApiClientError("Access changed", "FORBIDDEN", status));
      const actions = mount(share, accessChanged);
      actions.click();
      await vi.waitFor(() => expect(accessChanged).toHaveBeenCalledOnce());
      expect(actions.failed()).toBe(true);
      expect(mocked.push).not.toHaveBeenCalled();
      const firstRequest = mocked.copy.mock.calls[0]![1];
      mocked.copy.mockResolvedValue(copied);
      mount().click();
      await vi.waitFor(() => expect(mocked.push).toHaveBeenCalledOnce());
      expect(mocked.copy.mock.calls[1]![1]).toBe(firstRequest);
    },
  );

  it.each([500, 503])(
    "keeps uncertain %i errors local without invalidating collection authority",
    async (status) => {
      const accessChanged = vi.fn();
      mocked.copy.mockRejectedValue(new ApiClientError("Unavailable", "UNAVAILABLE", status));
      const actions = mount(share, accessChanged);
      actions.click();
      await vi.waitFor(() => expect(actions.failed()).toBe(true));
      expect(accessChanged).not.toHaveBeenCalled();
    },
  );

  it("does not invalidate the new context when an old action fails after workspace changes", async () => {
    let reject!: (error: unknown) => void;
    mocked.copy.mockReturnValue(
      new Promise((_resolve, no) => {
        reject = no;
      }),
    );
    const accessChanged = vi.fn();
    const actions = mount(share, accessChanged);
    actions.click();
    mocked.creator = { userId: "actor-a", workspaceId: "workspace-b" };
    actions.render();
    reject(new ApiClientError("Forbidden", "FORBIDDEN", 403));
    await Promise.resolve();
    expect(accessChanged).not.toHaveBeenCalled();
  });
  it("replays a committed copy after its response is lost and focus remounts the actions", async () => {
    const committed = new Set<string>();
    mocked.copy.mockImplementation(async (_id: string, requestId: string) => {
      if (!committed.has(requestId)) {
        committed.add(requestId);
        throw new TypeError("Response lost after commit");
      }
      return copied;
    });
    const first = mount();
    first.click();
    await vi.waitFor(() => expect(first.failed()).toBe(true));
    first.close();
    const retry = mount();
    retry.click();
    await vi.waitFor(() => expect(mocked.push).toHaveBeenCalledWith(copied.href));
    expect(mocked.copy.mock.calls[1]![1]).toBe(mocked.copy.mock.calls[0]![1]);
    expect(committed.size).toBe(1);
    expect(values.size).toBe(0);
  });

  it("restores a pending copy from tab storage after the JavaScript runtime reloads", async () => {
    mocked.copy.mockRejectedValueOnce(new TypeError("Response lost")).mockResolvedValueOnce(copied);
    const first = mount();
    first.click();
    await vi.waitFor(() => expect(first.failed()).toBe(true));
    const requestId = mocked.copy.mock.calls[0]![1];
    expect([...values.values()]).toContain(requestId);
    first.close();
    vi.resetModules();
    Actions = (await import("./share-actions")).LibraryShareActions;
    mount().click();
    await vi.waitFor(() => expect(mocked.push).toHaveBeenCalledWith(copied.href));
    expect(mocked.copy.mock.calls[1]![1]).toBe(requestId);
  });

  it("retains the request across aborted cleanup and prevents rapid duplicate submissions", async () => {
    mocked.copy
      .mockImplementationOnce(
        (_id: string, _requestId: string, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new DOMException("Canceled", "AbortError")),
            );
          }),
      )
      .mockResolvedValueOnce(copied);
    const first = mount();
    const click = first
      .render()
      .find(
        (element) =>
          element.type === "button" &&
          content(element.props.children as ReactNode) === "Use a copy",
      )!.props.onClick as () => void;
    click();
    click();
    expect(mocked.copy).toHaveBeenCalledTimes(1);
    const requestId = mocked.copy.mock.calls[0]![1];
    first.close();
    await Promise.resolve();
    mount().click();
    await vi.waitFor(() => expect(mocked.push).toHaveBeenCalledWith(copied.href));
    expect(mocked.copy.mock.calls[1]![1]).toBe(requestId);
  });

  it("keeps in-memory recovery across remounts when session storage is unavailable", async () => {
    vi.stubGlobal("window", {
      get sessionStorage() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
    mocked.copy.mockRejectedValueOnce(new TypeError("Response lost")).mockResolvedValueOnce(copied);
    const first = mount();
    first.click();
    await vi.waitFor(() => expect(first.failed()).toBe(true));
    first.close();
    mount().click();
    await vi.waitFor(() => expect(mocked.push).toHaveBeenCalledWith(copied.href));
    expect(mocked.copy.mock.calls[1]![1]).toBe(mocked.copy.mock.calls[0]![1]);
  });

  it.each([429, 500, 503])("preserves the exact copy request after HTTP %s", async (status) => {
    mocked.copy
      .mockRejectedValueOnce(new ApiClientError("Retry", "UNAVAILABLE", status))
      .mockResolvedValueOnce(copied);
    const first = mount();
    first.click();
    await vi.waitFor(() => expect(first.failed()).toBe(true));
    first.close();
    mount().click();
    await vi.waitFor(() => expect(mocked.copy).toHaveBeenCalledTimes(2));
    expect(mocked.copy.mock.calls[1]![1]).toBe(mocked.copy.mock.calls[0]![1]);
  });

  it("isolates unresolved requests by authenticated actor, destination workspace, and share", async () => {
    mocked.copy.mockRejectedValue(new TypeError("Response lost"));
    async function attempt(userId: string, workspaceId: string, value = share) {
      mocked.creator = { userId, workspaceId };
      const actions = mount(value);
      actions.click();
      await vi.waitFor(() => expect(actions.failed()).toBe(true));
      actions.close();
      return mocked.copy.mock.calls.at(-1)![1];
    }
    const original = await attempt("actor-a", "workspace-a");
    const otherActor = await attempt("actor-b", "workspace-a");
    const otherWorkspace = await attempt("actor-a", "workspace-b");
    const otherShare = await attempt("actor-a", "workspace-a", {
      ...share,
      id: share.organizationId,
    });
    expect(new Set([original, otherActor, otherWorkspace, otherShare]).size).toBe(4);
    expect(await attempt("actor-a", "workspace-a")).toBe(original);
  });

  it.each([401, 403])(
    "reuses a lost acknowledgement's request after HTTP %s and restored access",
    async (status) => {
      mocked.copy
        .mockRejectedValueOnce(new TypeError("Response lost after commit"))
        .mockRejectedValueOnce(
          new ApiClientError("Access temporarily unavailable", "FORBIDDEN", status),
        )
        .mockResolvedValueOnce(copied);
      const first = mount();
      first.click();
      await vi.waitFor(() => expect(first.failed()).toBe(true));
      first.close();
      const denied = mount();
      denied.click();
      await vi.waitFor(() => expect(denied.failed()).toBe(true));
      denied.close();
      mount().click();
      await vi.waitFor(() => expect(mocked.push).toHaveBeenCalledWith(copied.href));
      expect(new Set(mocked.copy.mock.calls.map((call) => call[1])).size).toBe(1);
      expect(values.size).toBe(0);
    },
  );

  it("clears confirmed success and a permanently conflicting request before an intentional new copy", async () => {
    mocked.copy
      .mockResolvedValueOnce(copied)
      .mockRejectedValueOnce(
        new ApiClientError("Already used for another copy", "IDEMPOTENCY_CONFLICT", 409),
      )
      .mockResolvedValueOnce(copied);
    const first = mount();
    first.click();
    await vi.waitFor(() => expect(mocked.push).toHaveBeenCalledTimes(1));
    first.close();
    const second = mount();
    second.click();
    await vi.waitFor(() => expect(second.failed()).toBe(true));
    expect(values.size).toBe(0);
    second.close();
    mount().click();
    await vi.waitFor(() => expect(mocked.push).toHaveBeenCalledTimes(2));
    expect(new Set(mocked.copy.mock.calls.map((call) => call[1])).size).toBe(3);
  });

  it("keeps a newer workspace action busy when an older workspace acknowledgement arrives", async () => {
    const finish: Array<(result: typeof copied) => void> = [];
    mocked.copy.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    const actions = mount();
    actions.click();
    mocked.creator = { userId: "actor-a", workspaceId: "workspace-b" };
    actions.render();
    actions.click();
    finish[0]!(copied);
    await Promise.resolve();
    expect(mocked.push).not.toHaveBeenCalled();
    const busyButton = actions
      .render()
      .find(
        (element) =>
          element.type === "button" && content(element.props.children as ReactNode) === "Loading…",
      )!;
    expect(busyButton.props.disabled).toBe(true);
    (busyButton.props.onClick as () => void)();
    expect(mocked.copy).toHaveBeenCalledTimes(2);
    finish[1]!({ ...copied, workspaceId: "workspace-b", href: "/quiz/workspace-b-copy" });
    await vi.waitFor(() => expect(mocked.push).toHaveBeenCalledWith("/quiz/workspace-b-copy"));
    expect(mocked.copy.mock.calls[0]![1]).not.toBe(mocked.copy.mock.calls[1]![1]);
  });
});
