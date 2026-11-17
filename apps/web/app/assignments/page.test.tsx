import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { supportedLocales, type FollowupSummary, type SupportedLocale } from "@openround/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effectCursor: number;
  effects: Array<() => void>;
  effectSlots: Array<{ dependencies?: readonly unknown[]; cleanup?: () => void }>;
}
const fixtures = vi.hoisted(() => ({
  fetch: vi.fn(),
  locale: "en-CA" as SupportedLocale,
  userId: "creator-a",
  workspaceId: "workspace-a",
  role: "owner",
  canEdit: true,
  accountLoading: false,
  assignments: true,
  hooks: null as Hooks | null,
  showModal: vi.fn(),
  closeModal: vi.fn(),
}));
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
    useRef: <T,>(initial: T) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useEffect: (
      effect: Parameters<typeof react.useEffect>[0],
      dependencies?: readonly unknown[],
    ) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useEffect(effect, dependencies);
      const index = hooks.effectCursor++;
      const previous = hooks.effectSlots[index];
      if (
        previous?.dependencies &&
        dependencies?.length === previous.dependencies.length &&
        dependencies.every((value, position) => Object.is(value, previous.dependencies![position]))
      )
        return;
      const slot = { dependencies, cleanup: undefined as (() => void) | undefined };
      hooks.effectSlots[index] = slot;
      hooks.effects.push(() => {
        previous?.cleanup?.();
        slot.cleanup = effect() || undefined;
      });
    },
  };
});
vi.mock("../../components/locale-provider", async () => {
  const { englishMessages, translate } = await import("../../lib/i18n/catalog");
  return {
    useLocale: () => ({
      locale: fixtures.locale,
      t: (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
        key.startsWith("pages.common.status.")
          ? key.slice("pages.common.status.".length).replace(/^./, (value) => value.toUpperCase())
          : key === "pages.assignments.chooseRound"
            ? "Choose a Round"
            : translate(englishMessages, key, values),
    }),
  };
});
vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    creator: { userId: fixtures.userId, workspaceId: fixtures.workspaceId, role: fixtures.role },
    canEdit: fixtures.canEdit,
    loading: fixtures.accountLoading,
    productFeatures: { practiceAssignments: fixtures.assignments },
  }),
}));
vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children, actions }: { children: ReactNode; actions: ReactNode }) => (
    <main>
      {actions}
      {children}
    </main>
  ),
}));
vi.mock("../../lib/api", () => ({
  apiFetch: fixtures.fetch,
  humanError: (error: Error) => error.message,
}));

import Page from "./page";
import { assignmentsDirectoryCopy } from "../../lib/i18n/assignments-directory-copy";

function assignment(id = "assignment-a", title = "Published assignment — 日本語"): FollowupSummary {
  return {
    id,
    title,
    purpose: "assignment",
    trustMode: "learning",
    sourceSessionId: null,
    sourceReportId: null,
    sourceQuizVersionId: "version-a",
    quizId: "round-a",
    recoveryPackSource: null,
    status: "open",
    conceptKeys: [],
    checkpointCount: 2,
    attemptCount: 5,
    completedAttemptCount: 3,
    opensAt: "2026-11-01T09:00:00Z",
    closesAt: "2026-11-30T09:00:00Z",
    expiresAt: "2027-11-01T09:00:00Z",
    createdAt: "2026-11-01T09:00:00Z",
  };
}
function page(items = [assignment()], nextCursor: string | null = null) {
  return { items, nextCursor };
}
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [
    node,
    ...nodes(node.props.children as ReactNode),
    ...nodes(node.props.actions as ReactNode),
  ];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
function button(tree: ReactNode, name: string) {
  const found = nodes(tree).find((node) => node.type === "button" && text(node).includes(name));
  if (!found) throw new Error(`Missing button: ${name}`);
  return found.props as ComponentProps<"button">;
}
function click(tree: ReactNode, name: string, opener?: HTMLElement) {
  const currentTarget =
    opener ?? Object.assign(new HTMLElement(), { isConnected: true, focus() {} });
  button(tree, name).onClick?.({ currentTarget } as never);
}
function search(tree: ReactNode, value: string) {
  const found = nodes(tree).find((node) => node.type === "input" && node.props.type === "search");
  if (!found) throw new Error("Missing search");
  (found.props as ComponentProps<"input">).onChange?.({ target: { value } } as never);
}
function titles(tree: ReactNode) {
  return nodes(tree)
    .filter((node) => node.type === "article")
    .map((node) => text(node));
}
const cleanups: Array<() => void> = [];
function harness(
  component?: ReactElement<
    Record<string, unknown>,
    (props: Record<string, unknown>) => ReactElement
  >,
) {
  const hooks: Hooks = { cursor: 0, slots: [], effectCursor: 0, effects: [], effectSlots: [] };
  const unmount = () =>
    hooks.effectSlots.forEach((slot) => {
      slot.cleanup?.();
      slot.cleanup = undefined;
    });
  cleanups.push(unmount);
  return {
    render: () => {
      const element =
        component ??
        (Page().props.children as ReactElement<
          Record<string, unknown>,
          (props: Record<string, unknown>) => ReactElement
        >);
      hooks.cursor = 0;
      hooks.effectCursor = 0;
      fixtures.hooks = hooks;
      try {
        const tree = element.type(element.props);
        for (const node of nodes(tree)) {
          const ref = node.props.ref as { current: unknown } | undefined;
          if (ref && node.type === "dialog")
            ref.current = {
              showModal: fixtures.showModal,
              close: fixtures.closeModal,
              querySelector: () => ({ focus() {} }),
            };
        }
        return tree;
      } finally {
        fixtures.hooks = null;
      }
    },
    flushEffects: () => hooks.effects.splice(0).forEach((effect) => effect()),
    unmount,
  };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
async function loaded(response = page()) {
  fixtures.fetch.mockResolvedValueOnce(response);
  const state = harness();
  state.render();
  state.flushEffects();
  await settle();
  state.render();
  state.flushEffects();
  return state;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function request(index = -1) {
  const call = fixtures.fetch.mock.calls.at(index)!;
  return {
    query: new URL(call[0] as string, "https://example.test").searchParams,
    signal: call[1]?.signal as AbortSignal,
  };
}
function chooser(tree: ReactNode) {
  const found = nodes(tree).find(
    (node) => typeof node.type === "function" && node.type.name === "RoundChooser",
  );
  if (!found) throw new Error("Missing published Round chooser");
  return harness(
    found as ReactElement<
      Record<string, unknown>,
      (props: Record<string, unknown>) => ReactElement
    >,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  fixtures.locale = "en-CA";
  fixtures.userId = "creator-a";
  fixtures.workspaceId = "workspace-a";
  fixtures.role = "owner";
  fixtures.canEdit = true;
  fixtures.accountLoading = false;
  fixtures.assignments = true;
  fixtures.hooks = null;
  fixtures.fetch.mockReset().mockResolvedValue(page());
  fixtures.showModal.mockReset();
  fixtures.closeModal.mockReset();
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("assignments directory requests and access", () => {
  it("requests assignments only, debounces trimmed search and sends the selected server status", async () => {
    const state = await loaded();
    expect(Object.fromEntries(request().query)).toEqual({ purpose: "assignment", limit: "25" });
    search(state.render(), "  Photosynthesis & 中文  ");
    state.render();
    state.flushEffects();
    await vi.advanceTimersByTimeAsync(249);
    state.render();
    state.flushEffects();
    expect(fixtures.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    state.render();
    state.flushEffects();
    await settle();
    expect(Object.fromEntries(request().query)).toEqual({
      purpose: "assignment",
      limit: "25",
      search: "Photosynthesis & 中文",
    });
    click(state.render(), "Scheduled");
    state.render();
    state.flushEffects();
    await settle();
    expect(Object.fromEntries(request().query)).toEqual({
      purpose: "assignment",
      limit: "25",
      search: "Photosynthesis & 中文",
      status: "scheduled",
    });
    const calls = fixtures.fetch.mock.calls.length;
    fixtures.locale = "ko-KR";
    state.render();
    state.flushEffects();
    expect(fixtures.fetch).toHaveBeenCalledTimes(calls);
  });

  it.each(["role", "workspace", "actor", "loading"])(
    "suppresses stale reads and private listing after an authority %s change",
    async (kind) => {
      const pending = deferred<ReturnType<typeof page>>();
      fixtures.fetch.mockReturnValueOnce(pending.promise);
      const state = harness();
      state.render();
      state.flushEffects();
      const previousSignal = request().signal;
      if (kind === "role") {
        fixtures.role = "viewer";
        fixtures.canEdit = false;
      }
      if (kind === "workspace") fixtures.workspaceId = "workspace-b";
      if (kind === "actor") fixtures.userId = "creator-b";
      if (kind === "loading") fixtures.accountLoading = true;
      fixtures.fetch.mockResolvedValueOnce(
        page([assignment("new", "Current authority assignment")]),
      );
      expect(titles(state.render())).toHaveLength(0);
      state.flushEffects();
      expect(previousSignal.aborted).toBe(true);
      pending.resolve(page([assignment("stale", "Stale private assignment")]));
      await settle();
      expect(titles(state.render()).join("")).not.toContain("Stale private assignment");
      if (kind !== "loading")
        expect(titles(state.render()).join("")).toContain("Current authority assignment");
    },
  );

  it("ignores an earlier status response and error even before its effect cleanup runs", async () => {
    const first = deferred<ReturnType<typeof page>>();
    fixtures.fetch.mockReturnValueOnce(first.promise);
    const state = harness();
    state.render();
    state.flushEffects();
    click(state.render(), "Closed");
    state.render();
    first.reject(new Error("Outdated request detail"));
    await settle();
    expect(text(state.render())).not.toContain("Outdated request detail");
    fixtures.fetch.mockResolvedValueOnce(page([assignment("closed", "Closed query assignment")]));
    state.flushEffects();
    await settle();
    expect(titles(state.render()).join("")).toContain("Closed query assignment");
    expect(request().query.get("status")).toBe("closed");
  });

  it("still lists and links existing assignments while creation is paused", async () => {
    fixtures.assignments = false;
    const state = await loaded();
    const tree = state.render();
    expect(fixtures.fetch).toHaveBeenCalledTimes(1);
    expect(titles(tree)).toHaveLength(1);
    expect(text(tree)).toContain(
      "Creation is paused for this workspace. Existing assignments can still be managed.",
    );
    expect(nodes(tree).some((node) => node.props.href === "/practice/assignment-a")).toBe(true);
    expect(
      nodes(tree).some(
        (node) => node.type === "button" && text(node).includes("Create assignment"),
      ),
    ).toBe(false);
    expect(text(tree)).toContain(
      "Attempts include anonymous participation and may not represent unique people.",
    );
  });

  it("preserves read-only listing for viewers and hides the creation action", async () => {
    fixtures.role = "viewer";
    fixtures.canEdit = false;
    const state = await loaded();
    const tree = state.render();
    expect(titles(tree)).toHaveLength(1);
    expect(
      nodes(tree).some(
        (node) => node.type === "button" && text(node).includes("Create assignment"),
      ),
    ).toBe(false);
  });
});

describe("assignment cursor pagination and retry", () => {
  it("appends unique assignments using the cursor and suppresses duplicate pagination requests", async () => {
    const state = await loaded(page([assignment()], "opaque cursor + / 中文"));
    const pending = deferred<ReturnType<typeof page>>();
    fixtures.fetch.mockReturnValueOnce(pending.promise);
    const load = button(state.render(), "Load more assignments");
    load.onClick?.({} as never);
    load.onClick?.({} as never);
    expect(fixtures.fetch).toHaveBeenCalledTimes(2);
    expect(request().query.get("cursor")).toBe("opaque cursor + / 中文");
    expect(request().query.get("purpose")).toBe("assignment");
    pending.resolve(
      page([assignment(), assignment("assignment-b", "Second assignment")], "cursor-c"),
    );
    await settle();
    const tree = state.render();
    expect(titles(tree)).toHaveLength(2);
    expect(titles(tree).join("")).toContain("Second assignment");
    expect(text(tree)).toContain("Showing 2");
    expect(button(tree, "Load more assignments").disabled).toBe(false);
  });

  it("keeps prior assignments after a page failure and retries the same cursor", async () => {
    const state = await loaded(page([assignment()], "cursor-next"));
    fixtures.fetch.mockRejectedValueOnce(new Error("Temporary page failure"));
    click(state.render(), "Load more assignments");
    await settle();
    let tree = state.render();
    expect(titles(tree)).toHaveLength(1);
    expect(text(tree)).toContain("Temporary page failure");
    fixtures.fetch.mockResolvedValueOnce(page([assignment("assignment-b", "Recovered page")]));
    click(tree, "Retry");
    await settle();
    tree = state.render();
    expect(request().query.get("cursor")).toBe("cursor-next");
    expect(titles(tree)).toHaveLength(2);
    expect(text(tree)).not.toContain("Temporary page failure");
    expect(
      nodes(tree).some(
        (node) => node.type === "button" && text(node).includes("Load more assignments"),
      ),
    ).toBe(false);
  });

  it("retries initial reads and clears filters without replaying mutation requests", async () => {
    fixtures.fetch.mockRejectedValueOnce(new Error("Initial request failed"));
    const state = harness();
    state.render();
    state.flushEffects();
    await settle();
    expect(text(state.render())).toContain("Initial request failed");
    fixtures.fetch.mockResolvedValueOnce(page([]));
    click(state.render(), "Retry");
    state.render();
    state.flushEffects();
    await settle();
    click(state.render(), "Expired");
    state.render();
    state.flushEffects();
    await settle();
    fixtures.fetch.mockResolvedValueOnce(page([]));
    click(state.render(), "Refresh");
    state.render();
    state.flushEffects();
    await settle();
    expect(text(state.render())).toContain("No matching assignments");
    click(state.render(), "Clear filters");
    state.render();
    state.flushEffects();
    await settle();
    expect(request().query.has("status")).toBe(false);
    expect(request().query.has("search")).toBe(false);
    expect(fixtures.fetch.mock.calls.every((call) => call[1]?.method === undefined)).toBe(true);
  });

  it.each(["status", "workspace"])(
    "aborts an outstanding cursor page when %s changes",
    async (kind) => {
      const state = await loaded(page([assignment()], "cursor-next"));
      const pending = deferred<ReturnType<typeof page>>();
      fixtures.fetch.mockReturnValueOnce(pending.promise);
      click(state.render(), "Load more assignments");
      const previousSignal = request().signal;
      if (kind === "status") click(state.render(), "Closed");
      else fixtures.workspaceId = "workspace-b";
      fixtures.fetch.mockResolvedValueOnce(page([assignment("new-query", "Fresh query")]));
      expect(titles(state.render())).toHaveLength(0);
      state.flushEffects();
      expect(previousSignal.aborted).toBe(true);
      pending.resolve(page([assignment("stale-page", "Stale cursor assignment")]));
      await settle();
      const tree = state.render();
      expect(titles(tree)).toHaveLength(1);
      expect(titles(tree).join("")).toContain("Fresh query");
      expect(text(tree)).not.toContain("Stale cursor assignment");
      expect(request().query.has("cursor")).toBe(false);
    },
  );
});

describe("published Round creation chooser", () => {
  it.each(["Create assignment", "Choose a Round"])(
    "returns focus to the explicit %s opener when Safari activeElement differs",
    async (trigger) => {
      const state = await loaded(trigger === "Choose a Round" ? page([]) : page());
      const focusOpener = vi.fn();
      const focusPrevious = vi.fn();
      const opener = Object.assign(new HTMLElement(), { isConnected: true, focus: focusOpener });
      const previous = Object.assign(new HTMLElement(), {
        isConnected: true,
        focus: focusPrevious,
      });
      vi.stubGlobal("document", { activeElement: previous });
      click(state.render(), trigger, opener);
      const tree = state.render();
      const element = nodes(tree).find(
        (node) => typeof node.type === "function" && node.type.name === "RoundChooser",
      )!;
      expect(element.props.returnFocusTo).toBe(opener);
      const modal = chooser(tree);
      fixtures.fetch.mockResolvedValueOnce({ quizzes: [] });
      modal.render();
      modal.flushEffects();
      await settle();
      expect(fixtures.showModal).toHaveBeenCalledOnce();
      expect(focusOpener).not.toHaveBeenCalled();
      click(modal.render(), "Close");
      state.render();
      modal.unmount();
      expect(fixtures.closeModal).toHaveBeenCalledOnce();
      expect(focusOpener).toHaveBeenCalledOnce();
      expect(focusPrevious).not.toHaveBeenCalled();
    },
  );

  it("offers only published Rounds with a current version and searches titles locally", async () => {
    const state = await loaded();
    click(state.render(), "Create assignment");
    const modal = chooser(state.render());
    fixtures.fetch.mockResolvedValueOnce({
      quizzes: [
        {
          id: "published",
          title: "Biology — 日本語",
          status: "published",
          currentVersionId: "version-a",
        },
        { id: "other", title: "Geometry", status: "published", currentVersionId: "version-b" },
        { id: "draft", title: "Private draft", status: "draft", currentVersionId: "version-c" },
        {
          id: "missing",
          title: "Missing published version",
          status: "published",
          currentVersionId: null,
        },
        {
          id: "archived",
          title: "Archived Round",
          status: "archived",
          currentVersionId: "version-d",
        },
      ],
    });
    modal.render();
    modal.flushEffects();
    await settle();
    let tree = modal.render();
    expect(fixtures.showModal).toHaveBeenCalledOnce();
    expect(fixtures.fetch.mock.calls.at(-1)?.[0]).toBe("/v1/quizzes");
    expect(
      nodes(tree)
        .filter(
          (node) => typeof node.props.href === "string" && node.props.href.startsWith("/quiz/"),
        )
        .map((node) => node.props.href),
    ).toEqual(["/quiz/published/assign", "/quiz/other/assign"]);
    expect(text(tree)).not.toContain("Private draft");
    expect(text(tree)).not.toContain("Missing published version");
    const requests = fixtures.fetch.mock.calls.length;
    search(tree, "  BIOLOGY  ");
    tree = modal.render();
    modal.flushEffects();
    expect(text(tree)).toContain("Biology — 日本語");
    expect(text(tree)).not.toContain("Geometry");
    for (const locale of supportedLocales) {
      fixtures.locale = locale;
      tree = modal.render();
      modal.flushEffects();
      expect(text(tree)).toContain(assignmentsDirectoryCopy(locale)("Choose a published Round"));
    }
    expect(fixtures.fetch).toHaveBeenCalledTimes(requests);
    click(tree, assignmentsDirectoryCopy(fixtures.locale)("Close"));
    expect(
      nodes(state.render()).some(
        (node) => typeof node.type === "function" && node.type.name === "RoundChooser",
      ),
    ).toBe(false);
  });

  it("supports read retry and ignores a chooser response after unmount", async () => {
    const state = await loaded();
    click(state.render(), "Create assignment");
    const modal = chooser(state.render());
    fixtures.fetch.mockRejectedValueOnce(new Error("Round list unavailable"));
    modal.render();
    modal.flushEffects();
    await settle();
    expect(text(modal.render())).toContain("Round list unavailable");
    const pending = deferred<{
      quizzes: Array<{ id: string; title: string; status: string; currentVersionId: string }>;
    }>();
    fixtures.fetch.mockReturnValueOnce(pending.promise);
    click(modal.render(), "Retry");
    modal.render();
    modal.flushEffects();
    const signal = request().signal;
    modal.unmount();
    expect(signal.aborted).toBe(true);
    expect(fixtures.closeModal).toHaveBeenCalledOnce();
    pending.resolve({
      quizzes: [
        {
          id: "late",
          title: "Late private Round",
          status: "published",
          currentVersionId: "version-a",
        },
      ],
    });
    await settle();
    expect(text(modal.render())).not.toContain("Late private Round");
  });
});
