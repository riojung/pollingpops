import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreatedSummaryShare,
  SummarySource,
  SummaryShareMetadata,
} from "@openround/contracts";
import { ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import { SESSION_EXPIRED_EVENT, SESSION_LOGOUT_EVENT } from "../../lib/idle-session";
import { translate, type MessageKey } from "../../lib/i18n/catalog";
import {
  sessionSummaryEnglishMessages,
  loadSessionSummaryMessages,
} from "../../lib/i18n/domains/session-summary";
import * as summaryClient from "../../lib/session-summary-client";
import { summaryPreviewFixture, summarySource } from "../../test-utils/session-summary";
import { SessionSummaryButton, SessionSummaryDialog } from "./summary-dialog";
import { SessionSummaryView } from "./summary-view";

interface Slot {
  value?: unknown;
  deps?: readonly unknown[];
  cleanup?: void | (() => void);
}
interface Hooks {
  cursor: number;
  slots: Slot[];
  effects: Array<() => void>;
  updates: number;
}
const fixtures = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  locale: "en-CA",
  messages: {} as Record<string, string>,
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  const mockEffect =
    (original: typeof react.useEffect) =>
    (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const hooks = fixtures.hooks;
      if (!hooks) return original(effect, deps);
      const index = hooks.cursor++,
        previous = hooks.slots[index];
      if (
        deps &&
        previous?.deps &&
        deps.length === previous.deps.length &&
        deps.every((value, offset) => Object.is(value, previous.deps![offset]))
      )
        return;
      hooks.slots[index] = { deps };
      hooks.effects.push(() => {
        previous?.cleanup?.();
        hooks.slots[index]!.cleanup = effect();
      });
    };
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= {
        value: typeof initial === "function" ? (initial as () => T)() : initial,
      };
      return [
        hooks.slots[index]!.value as T,
        (next: T | ((current: T) => T)) => {
          const previous = hooks.slots[index]!.value as T;
          hooks.slots[index]!.value =
            typeof next === "function" ? (next as (current: T) => T)(previous) : next;
          hooks.updates += 1;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= { value: { current: initial } };
      return hooks.slots[index]!.value;
    },
    useEffect: mockEffect(react.useEffect),
    useLayoutEffect: mockEffect(react.useLayoutEffect),
  };
});
vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    locale: fixtures.locale,
    t: (key: MessageKey, values?: Record<string, string | number>) =>
      translate(fixtures.messages, key, values),
  }),
}));
const authorityEvents = [
  AUTH_CHANGE_EVENT,
  SESSION_EXPIRED_EVENT,
  SESSION_LOGOUT_EVENT,
  "polling-pops:workspace-updated",
];
let windowEvents: EventTarget;
beforeEach(() => {
  fixtures.locale = "en-CA";
  fixtures.messages = sessionSummaryEnglishMessages;
  windowEvents = new EventTarget();
  vi.stubGlobal("window", windowEvents);
  vi.stubGlobal("document", { activeElement: null, body: {} });
  vi.stubGlobal("HTMLElement", class {});
});
afterEach(() => {
  fixtures.hooks = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
function hooks(): Hooks {
  return { cursor: 0, slots: [], effects: [], updates: 0 };
}
function dispose(state: Hooks) {
  for (const slot of state.slots) slot.cleanup?.();
}
function execute(state: Hooks, render: () => ReactNode) {
  state.cursor = 0;
  fixtures.hooks = state;
  try {
    return render();
  } finally {
    fixtures.hooks = null;
  }
}
function summaryHarness(
  kind: "button" | "dialog" = "button",
  initial = summarySource as SummarySource,
) {
  const root = hooks();
  let source = initial,
    child: { key: string | null; state: Hooks } | null = null,
    tree: ReactNode;
  const onClose = vi.fn();
  const refs = new Map<
    { current: unknown },
    { isConnected: boolean; focus: () => void; showModal: () => void; close: () => void }
  >();
  function render(nextSource = source) {
    source = nextSource;
    const output = execute(root, () =>
      kind === "button"
        ? SessionSummaryButton({ source })
        : SessionSummaryDialog({ source, onClose }),
    );
    if (
      kind === "dialog" &&
      isValidElement<Record<string, unknown>>(output) &&
      typeof output.type === "function"
    ) {
      if (!child || child.key !== output.key) {
        if (child) dispose(child.state);
        child = { key: output.key, state: hooks() };
      }
      tree = execute(child.state, () =>
        (output.type as (props: Record<string, unknown>) => ReactNode)(output.props),
      );
    } else {
      if (child) dispose(child.state);
      child = null;
      tree = output;
    }
    const connected = new Set<{ current: unknown }>();
    for (const node of elements(tree)) {
      if (typeof node.type !== "string" || !node.props.ref || typeof node.props.ref !== "object")
        continue;
      const ref = node.props.ref as { current: unknown };
      connected.add(ref);
      let target = refs.get(ref);
      if (!target) {
        target = {
          isConnected: true,
          focus: () => {
            Object.assign(document, { activeElement: target });
          },
          showModal: vi.fn(),
          close: vi.fn(),
        };
        refs.set(ref, target);
      }
      target.isConnected = true;
      ref.current = target;
    }
    for (const [ref, target] of refs)
      if (!connected.has(ref)) {
        target.isConnected = false;
        ref.current = null;
        if (document.activeElement === (target as unknown as Element))
          Object.assign(document, { activeElement: document.body });
      }
    root.effects.splice(0).forEach((effect) => effect());
    child?.state.effects.splice(0).forEach((effect) => effect());
    return tree;
  }
  return {
    render,
    nodes() {
      return elements(render());
    },
    markup() {
      return renderToStaticMarkup(render());
    },
    button(label: string) {
      const button = elements(render()).find(
        (node) => node.type === "button" && text(node.props.children as ReactNode) === label,
      );
      if (!button) throw new Error(`Missing button ${label}`);
      return button;
    },
    click(label: string) {
      (this.button(label).props.onClick as (event: unknown) => void)({
        currentTarget: { focus: vi.fn() },
      });
      render();
    },
    edit(id: string, value: string) {
      const input = elements(render()).find((node) => node.props.id === id)!;
      (input.props.onChange as (event: unknown) => void)({ target: { value } });
      render();
    },
    async submit() {
      const form = elements(render()).find((node) => node.type === "form")!;
      (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
      await this.settle();
    },
    async settle() {
      for (let count = 0; count < 12; count += 1) {
        await Promise.resolve();
        render();
      }
    },
    updates() {
      return root.updates + (child?.state.updates ?? 0);
    },
    unmount() {
      dispose(root);
      if (child) dispose(child.state);
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const share: SummaryShareMetadata = {
  id: "00000000-0000-4000-8000-000000000002",
  createdAt: "2026-10-14T12:00:00.000Z",
  expiresAt: "2099-10-18T12:00:00.000Z",
  revokedAt: null,
  allowDownloads: true,
};
const created: CreatedSummaryShare = {
  share,
  url: `https://example.test/summary/${share.id}#token=${"x".repeat(64)}`,
  replayed: false,
};
function readyDialog() {
  const preview = vi
    .spyOn(summaryClient, "fetchSummaryPreview")
    .mockResolvedValue(summaryPreviewFixture);
  const shares = vi.spyOn(summaryClient, "fetchSummaryShares").mockResolvedValue([]);
  const create = vi.spyOn(summaryClient, "createSummaryShare").mockResolvedValue(created);
  const revoke = vi.spyOn(summaryClient, "revokeSummaryShare").mockResolvedValue(undefined);
  return { preview, shares, create, revoke };
}

describe("source-specific session summary availability", () => {
  it("retries failed availability without creating or opening a summary", async () => {
    const availability = vi
      .spyOn(summaryClient, "fetchSummaryAvailability")
      .mockRejectedValueOnce(new TypeError("Offline"))
      .mockResolvedValue(true);
    const create = vi.spyOn(summaryClient, "createSummaryShare"),
      preview = vi.spyOn(summaryClient, "fetchSummaryPreview");
    const h = summaryHarness();
    expect(renderToStaticMarkup(h.render())).toBe("");
    await h.settle();
    expect(h.markup()).toContain(sessionSummaryEnglishMessages["summary.availabilityFailed"]);
    expect(h.markup()).not.toContain("Share summary");
    h.click(sessionSummaryEnglishMessages["summary.retryAvailability"]);
    await h.settle();
    expect(h.markup()).toContain("Share summary");
    expect(availability).toHaveBeenCalledTimes(2);
    expect(
      availability.mock.calls.every(
        ([source, signal]) => source.id === summarySource.id && signal instanceof AbortSignal,
      ),
    ).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    h.unmount();
  });
  it("hides disabled sources and ignores late results after an ID or kind change", async () => {
    const old = deferred<boolean>(),
      current = deferred<boolean>();
    const availability = vi
      .spyOn(summaryClient, "fetchSummaryAvailability")
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise)
      .mockResolvedValue(true);
    const h = summaryHarness();
    h.render();
    const oldSignal = availability.mock.calls[0]![1]!;
    const other: SummarySource = { kind: "presentation", id: summarySource.id };
    expect(renderToStaticMarkup(h.render(other))).toBe("");
    expect(oldSignal.aborted).toBe(true);
    current.resolve(false);
    await h.settle();
    old.resolve(true);
    await h.settle();
    expect(h.markup()).toBe("");
    h.render({ ...other, id: share.id });
    await h.settle();
    expect(h.markup()).toContain("Share summary");
    expect(availability.mock.calls.map(([source]) => source)).toEqual([
      summarySource,
      other,
      { ...other, id: share.id },
    ]);
    h.unmount();
  });
  it.each(authorityEvents)(
    "invalidates availability on %s and ignores the old reply",
    async (event) => {
      const old = deferred<boolean>(),
        current = deferred<boolean>();
      const availability = vi
        .spyOn(summaryClient, "fetchSummaryAvailability")
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise);
      const h = summaryHarness();
      h.render();
      windowEvents.dispatchEvent(new Event(event));
      h.render();
      old.resolve(true);
      await h.settle();
      expect(h.markup()).toBe("");
      if (event === SESSION_EXPIRED_EVENT || event === SESSION_LOGOUT_EVENT) {
        expect(availability).toHaveBeenCalledTimes(1);
        windowEvents.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
        h.render();
      }
      current.resolve(true);
      await h.settle();
      expect(h.markup()).toContain("Share summary");
      const signal = availability.mock.calls[1]![1]!;
      h.unmount();
      expect(signal.aborted).toBe(true);
    },
  );
  it.each([SESSION_EXPIRED_EVENT, SESSION_LOGOUT_EVENT])(
    "does not loop availability requests when a failed read emits %s",
    async (event) => {
      const availability = vi
        .spyOn(summaryClient, "fetchSummaryAvailability")
        .mockImplementation(async () => {
          windowEvents.dispatchEvent(new Event(event));
          throw new ApiClientError("Session expired", "SESSION_EXPIRED", 401);
        });
      const h = summaryHarness();
      h.render();
      await h.settle();
      await h.settle();
      expect(availability).toHaveBeenCalledTimes(1);
      expect(h.markup()).toBe("");
      h.render({ kind: "survey", id: share.id });
      await h.settle();
      expect(availability).toHaveBeenCalledTimes(2);
      h.unmount();
    },
  );
  it("keeps a pending availability retry focused and transfers focus only when that retry is replaced", async () => {
    const available = deferred<boolean>();
    vi.spyOn(summaryClient, "fetchSummaryAvailability")
      .mockRejectedValueOnce(new TypeError("Offline"))
      .mockReturnValueOnce(available.promise);
    const h = summaryHarness();
    h.render();
    await h.settle();
    const retryLabel = sessionSummaryEnglishMessages["summary.retryAvailability"];
    const retry = (h.button(retryLabel).props.ref as { current: HTMLElement }).current;
    retry.focus();
    h.click(retryLabel);
    expect(h.button(retryLabel).props["aria-disabled"]).toBe(true);
    expect(document.activeElement).toBe(retry);
    available.resolve(true);
    await h.settle();
    expect(document.activeElement).toBe(
      (h.button("Share summary").props.ref as { current: HTMLElement }).current,
    );
    h.unmount();
  });
  it("aborts on unmount and ignores a transport that resolves after cancellation", async () => {
    const late = deferred<boolean>(),
      availability = vi
        .spyOn(summaryClient, "fetchSummaryAvailability")
        .mockReturnValue(late.promise);
    const h = summaryHarness();
    h.render();
    h.unmount();
    const updates = h.updates();
    late.resolve(true);
    await Promise.resolve();
    expect(availability.mock.calls[0]![1]!.aborted).toBe(true);
    expect(h.updates()).toBe(updates);
  });
});

describe("independent summary read recovery", () => {
  it.each([true, false])(
    "keeps preview retry in place and transfers focus only if it still owns focus (%s)",
    async (keepFocus) => {
      const api = readyDialog(),
        pending = deferred<typeof summaryPreviewFixture>();
      api.preview
        .mockRejectedValueOnce(new TypeError("Offline"))
        .mockReturnValueOnce(pending.promise);
      const h = summaryHarness("dialog");
      h.render();
      await h.settle();
      const label = sessionSummaryEnglishMessages["summary.retryPreview"];
      const retry = (h.button(label).props.ref as { current: HTMLElement }).current;
      retry.focus();
      h.click(label);
      expect(h.button(label).props["aria-disabled"]).toBe(true);
      expect(document.activeElement).toBe(retry);
      const close = (h.button("Close").props.ref as { current: HTMLElement }).current;
      if (!keepFocus) close.focus();
      pending.resolve(summaryPreviewFixture);
      await h.settle();
      const pane = h
        .nodes()
        .find(
          (node) => node.props["aria-label"] === "Session summary" && node.props.role === "region",
        )!;
      expect(document.activeElement).toBe(
        keepFocus ? (pane.props.ref as { current: HTMLElement }).current : close,
      );
      h.unmount();
    },
  );
  it("preserves preview and authored notes when the list fails and retries only the list", async () => {
    const api = readyDialog();
    api.shares.mockRejectedValueOnce(new TypeError("Offline"));
    const h = summaryHarness("dialog");
    h.render();
    await h.settle();
    expect(h.nodes().some((node) => node.type === SessionSummaryView)).toBe(true);
    expect(h.markup()).toContain(sessionSummaryEnglishMessages["summary.linksFailed"]);
    expect(h.markup()).not.toContain(sessionSummaryEnglishMessages["summary.noLinks"]);
    h.edit("summary-next-steps", "Keep these authored next steps.");
    const pending = deferred<SummaryShareMetadata[]>();
    api.shares.mockReturnValueOnce(pending.promise);
    h.click("Refresh links");
    expect(h.button("Refresh links").props["aria-disabled"]).toBe(true);
    expect(h.button("Refresh links").props.disabled).toBeUndefined();
    h.click("Refresh links");
    expect(api.shares).toHaveBeenCalledTimes(2);
    pending.resolve([]);
    await h.settle();
    expect(h.button("Refresh links").props["aria-disabled"]).toBe(false);
    expect(h.markup()).toContain("Keep these authored next steps.");
    expect(h.markup()).toContain(sessionSummaryEnglishMessages["summary.noLinks"]);
    expect(api.preview).toHaveBeenCalledTimes(1);
    expect(api.shares).toHaveBeenCalledTimes(2);
    expect(api.create).not.toHaveBeenCalled();
    expect(api.revoke).not.toHaveBeenCalled();
    h.unmount();
  });
  it("retries preview independently of a successful link list", async () => {
    const api = readyDialog();
    api.preview.mockRejectedValueOnce(new TypeError("Offline"));
    api.shares.mockResolvedValue([share]);
    const h = summaryHarness("dialog");
    h.render();
    await h.settle();
    expect(h.markup()).toContain(sessionSummaryEnglishMessages["summary.previewFailed"]);
    expect(h.nodes().some((node) => node.type === "form")).toBe(false);
    expect(h.nodes().some((node) => node.type === "li" && node.key === share.id)).toBe(true);
    h.click(sessionSummaryEnglishMessages["summary.retryPreview"]);
    await h.settle();
    expect(h.nodes().some((node) => node.type === "form")).toBe(true);
    expect(api.preview).toHaveBeenCalledTimes(2);
    expect(api.shares).toHaveBeenCalledTimes(1);
    expect(api.create).not.toHaveBeenCalled();
    h.unmount();
  });
  it("ignores overlapping stale list replies and retains rows through a failed refresh", async () => {
    const api = readyDialog();
    api.shares.mockResolvedValueOnce([share]);
    const h = summaryHarness("dialog");
    h.render();
    await h.settle();
    const old = deferred<SummaryShareMetadata[]>(),
      current = deferred<SummaryShareMetadata[]>();
    api.shares.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const click = h.button("Refresh links").props.onClick as () => void;
    click();
    click();
    expect(api.shares.mock.calls[1]![1]!.aborted).toBe(true);
    current.resolve([{ ...share, revokedAt: "2026-11-25T12:00:00.000Z" }]);
    await h.settle();
    old.resolve([share]);
    await h.settle();
    expect(h.markup()).toContain("Revoked");
    api.shares.mockRejectedValueOnce(new TypeError("Offline"));
    h.click("Refresh links");
    await h.settle();
    expect(h.markup()).toContain("Revoked");
    expect(h.markup()).toContain(sessionSummaryEnglishMessages["summary.linksFailed"]);
    h.unmount();
  });
  it("retains exact uncertain write intent, authored form and receipt through read retries", async () => {
    const api = readyDialog(),
      h = summaryHarness("dialog");
    h.render();
    await h.settle();
    h.edit("summary-next-steps", "Preserved organizer next steps.");
    api.create.mockRejectedValueOnce(new TypeError("Lost acknowledgement"));
    api.shares.mockRejectedValueOnce(new TypeError("Offline"));
    await h.submit();
    const request = api.create.mock.calls[0]![1];
    expect(h.markup()).toContain("Preserved organizer next steps.");
    h.click("Refresh links");
    await h.settle();
    expect(api.create).toHaveBeenCalledTimes(1);
    await h.submit();
    expect(api.create.mock.calls[1]![1]).toEqual(request);
    expect(h.nodes().find((node) => node.props.id === "summary-created-link")?.props.value).toBe(
      created.url,
    );
    api.shares.mockRejectedValueOnce(new TypeError("Offline"));
    h.click("Refresh links");
    await h.settle();
    expect(h.nodes().find((node) => node.props.id === "summary-created-link")?.props.value).toBe(
      created.url,
    );
    expect(h.markup()).toContain("Preserved organizer next steps.");
    expect(api.create).toHaveBeenCalledTimes(2);
    h.unmount();
  });
  it.each([
    [404, "feature_disabled"],
    [402, "exports_entitlement"],
  ] as const)(
    "preserves a previous receipt and the draft when sharing is denied with %s",
    async (status, reason) => {
      const api = readyDialog(),
        h = summaryHarness("dialog");
      h.render();
      await h.settle();
      await h.submit();
      h.edit("summary-next-steps", "Keep my new draft notes.");
      api.create.mockRejectedValueOnce(
        new ApiClientError("Sharing unavailable", "SUMMARY_SHARING_UNAVAILABLE", status),
      );
      api.preview.mockRejectedValueOnce(new TypeError("Preview temporarily unavailable"));
      api.shares.mockResolvedValue([share]);
      await h.submit();

      expect(h.nodes().find((node) => node.props.id === "summary-created-link")?.props.value).toBe(
        created.url,
      );
      expect(h.markup()).toContain("Keep my new draft notes.");
      expect(h.button("Create share link").props.disabled).toBe(true);
      expect(h.nodes().some((node) => node.type === "li" && node.key === share.id)).toBe(true);
      await h.submit();
      expect(api.create).toHaveBeenCalledTimes(2);

      api.preview.mockResolvedValue({
        ...summaryPreviewFixture,
        capabilities: {
          ...summaryPreviewFixture.capabilities,
          canCreateShare: false,
          reasonCodes: [reason],
        },
      });
      h.click(sessionSummaryEnglishMessages["summary.retryPreview"]);
      await h.settle();
      expect(h.markup()).toContain(sessionSummaryEnglishMessages[`summary.reason.${reason}`]);
      expect(h.markup()).toContain("Keep my new draft notes.");
      expect(h.nodes().find((node) => node.props.id === "summary-created-link")?.props.value).toBe(
        created.url,
      );
      expect(api.create).toHaveBeenCalledTimes(2);
      expect(api.preview).toHaveBeenCalledTimes(3);
      expect(api.shares).toHaveBeenCalledTimes(3);
      h.unmount();
    },
  );
  it("localizes a mounted failure without refetching or replacing authored form data", async () => {
    const api = readyDialog(),
      h = summaryHarness("dialog");
    h.render();
    await h.settle();
    h.edit("summary-next-steps", "Authored wording remains unchanged.");
    api.shares.mockRejectedValueOnce(new TypeError("Offline"));
    h.click("Refresh links");
    await h.settle();
    fixtures.locale = "ko-KR";
    fixtures.messages = await loadSessionSummaryMessages("ko-KR");
    expect(h.markup()).toContain(fixtures.messages["summary.linksFailed"]);
    expect(h.markup()).toContain("Authored wording remains unchanged.");
    expect(api.preview).toHaveBeenCalledTimes(1);
    expect(api.shares).toHaveBeenCalledTimes(2);
    h.unmount();
  });
  it.each([401, 403, 404, 410])(
    "clears private data on a terminal %s denial and ignores late sibling success",
    async (status) => {
      const api = readyDialog(),
        preview = deferred<typeof summaryPreviewFixture>();
      api.preview.mockReturnValueOnce(preview.promise);
      api.shares.mockRejectedValueOnce(new ApiClientError("Unavailable", "DENIED", status));
      const h = summaryHarness("dialog");
      h.render();
      await h.settle();
      expect(api.preview.mock.calls[0]![1].aborted).toBe(true);
      preview.resolve(summaryPreviewFixture);
      await h.settle();
      expect(
        h.nodes().some((node) => node.type === SessionSummaryView || node.type === "form"),
      ).toBe(false);
      h.click(sessionSummaryEnglishMessages["summary.retryPreview"]);
      await h.settle();
      expect(h.nodes().some((node) => node.type === SessionSummaryView)).toBe(true);
      expect(api.create).not.toHaveBeenCalled();
      h.unmount();
    },
  );
  it("drops late preview and list results after changing the source", async () => {
    const api = readyDialog(),
      oldPreview = deferred<typeof summaryPreviewFixture>(),
      oldShares = deferred<SummaryShareMetadata[]>();
    api.preview.mockReturnValueOnce(oldPreview.promise);
    api.shares.mockReturnValueOnce(oldShares.promise);
    const h = summaryHarness("dialog");
    h.render();
    const source: SummarySource = { kind: "presentation", id: share.id };
    api.preview.mockResolvedValue({
      ...summaryPreviewFixture,
      source,
      summary: { ...summaryPreviewFixture.summary, kind: "presentation", title: "Current source" },
    });
    h.render(source);
    await h.settle();
    oldPreview.resolve(summaryPreviewFixture);
    oldShares.resolve([share]);
    await h.settle();
    expect(api.preview.mock.calls[0]![1].aborted).toBe(true);
    expect(api.shares.mock.calls[0]![1]!.aborted).toBe(true);
    expect(h.markup()).toContain("Current source");
    expect(h.markup()).not.toContain(summaryPreviewFixture.summary.title);
    expect(h.nodes().some((node) => node.type === "li" && node.key === share.id)).toBe(false);
    h.unmount();
  });
  it.each(authorityEvents)(
    "clears context on %s and ignores an old write receipt",
    async (event) => {
      const api = readyDialog(),
        h = summaryHarness("dialog");
      h.render();
      await h.settle();
      h.edit("summary-next-steps", "Private old-context notes");
      const pending = deferred<CreatedSummaryShare>();
      api.create.mockReturnValueOnce(pending.promise);
      await h.submit();
      const staleForm = h.nodes().find((node) => node.type === "form")!;
      windowEvents.dispatchEvent(new Event(event));
      (staleForm.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
      expect(api.create).toHaveBeenCalledTimes(1);
      h.render();
      await h.settle();
      if (event === SESSION_EXPIRED_EVENT || event === SESSION_LOGOUT_EVENT) {
        expect(h.markup()).toBe("");
        expect(api.preview).toHaveBeenCalledTimes(1);
        windowEvents.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
        h.render();
        await h.settle();
      }
      pending.resolve(created);
      await h.settle();
      expect(h.markup()).not.toContain("Private old-context notes");
      expect(h.nodes().some((node) => node.props.id === "summary-created-link")).toBe(false);
      h.unmount();
    },
  );
  it("ignores late write completion after unmount", async () => {
    const api = readyDialog(),
      h = summaryHarness("dialog");
    h.render();
    await h.settle();
    const pending = deferred<CreatedSummaryShare>();
    api.create.mockReturnValueOnce(pending.promise);
    await h.submit();
    h.unmount();
    const updates = h.updates();
    pending.resolve(created);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.updates()).toBe(updates);
    expect(api.shares).toHaveBeenCalledTimes(1);
  });
});
