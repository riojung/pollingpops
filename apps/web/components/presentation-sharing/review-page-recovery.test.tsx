import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type { PresentationReview, PresentationReviewFeedback } from "@openround/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import { presentationReviewTokenKey } from "../../lib/presentation-sharing-client";
import type * as ShareClient from "../../lib/presentation-sharing-client";
import { PresentationReviewPage } from "./review-page";
import { PresentationFeedbackPanel, PresentationFeedbackThread } from "./feedback-panel";

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
  feedbackAccess: vi.fn(),
  feedback: vi.fn(),
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
vi.mock("../../lib/presentation-review-feedback-client", () => ({
  fetchPresentationReviewerAccess: mocked.feedbackAccess,
  fetchPresentationReviewerFeedback: mocked.feedback,
  fetchPresentationAuthorFeedback: vi.fn(),
  enablePresentationReview: vi.fn(),
  mutatePresentationAuthorFeedback: vi.fn(),
  mutatePresentationReviewerFeedback: vi.fn(),
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
function feedbackFixture(viewerKey = "a".repeat(64)): PresentationReviewFeedback {
  return {
    schemaVersion: 1,
    shareId,
    versionId,
    version: 1,
    reviewSeq: 1,
    status: "open",
    viewerKey,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    serverTime: new Date().toISOString(),
    capabilities: { enable: false, comment: true, resolve: false, approve: false },
    approval: { state: "not_approved", approvedAt: null, approvedReviewSeq: null },
    threads: [
      {
        id: "00000000-0000-4000-8000-000000000006",
        blockId: reviewFixture().blocks[0]!.id,
        blockIndex: 0,
        version: 1,
        resolved: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [
          {
            id: "00000000-0000-4000-8000-000000000007",
            text: "An existing comment",
            authorLabel: "Reviewer 1",
            authorRole: "reviewer",
            isOwn: true,
            version: 1,
            deleted: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
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
function mount(initialShareId = shareId, includeFeedback = false) {
  const hooks: Hooks = {
    cursor: 0,
    slots: [],
    dependencies: new Map(),
    effects: [],
    cleanups: new Map(),
  };
  const children = new Map<string, Hooks>();
  function expand(
    node: ReactNode,
    path: string,
    seen: Set<string>,
  ): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node))
      return node.flatMap((child, index) =>
        expand(
          child,
          `${path}:${isValidElement(child) && child.key !== null ? child.key : index}`,
          seen,
        ),
      );
    if (!isValidElement<Record<string, unknown>>(node)) return [];
    if (node.type !== PresentationFeedbackPanel && node.type !== PresentationFeedbackThread)
      return [node, ...expand(node.props.children as ReactNode, path, seen)];
    const componentPath = `${path}:${node.type === PresentationFeedbackPanel ? "panel" : "thread"}`;
    seen.add(componentPath);
    let child = children.get(componentPath);
    if (!child) {
      child = { cursor: 0, slots: [], dependencies: new Map(), effects: [], cleanups: new Map() };
      children.set(componentPath, child);
    }
    child.cursor = 0;
    child.effects = [];
    mocked.hooks = child;
    let tree: ReactNode;
    try {
      tree =
        node.type === PresentationFeedbackPanel
          ? PresentationFeedbackPanel(node.props as Parameters<typeof PresentationFeedbackPanel>[0])
          : PresentationFeedbackThread(
              node.props as Parameters<typeof PresentationFeedbackThread>[0],
            );
    } finally {
      mocked.hooks = null;
    }
    for (const { index, effect } of child.effects) {
      child.cleanups.get(index)?.();
      child.cleanups.set(index, effect());
    }
    return [node, ...expand(tree, componentPath, seen)];
  }
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
    if (!includeFeedback) return elements(tree);
    const seen = new Set<string>();
    const expanded = expand(tree, "review", seen);
    for (const [path, child] of children)
      if (!seen.has(path)) {
        for (const cleanup of child.cleanups.values()) cleanup?.();
        children.delete(path);
      }
    return expanded;
  }
  const page = {
    render,
    text: () =>
      render()
        .map((element) => text(element.props.children as ReactNode))
        .join(" "),
    close() {
      for (const child of children.values())
        for (const cleanup of child.cleanups.values()) cleanup?.();
      children.clear();
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
  mocked.feedbackAccess.mockReset().mockResolvedValue({ enabled: true });
  mocked.feedback.mockReset().mockResolvedValue(feedbackFixture());
  return {
    storage,
    history,
    location,
    listeners,
    dispatch(name: "focus" | "hashchange" | typeof AUTH_CHANGE_EVENT) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener();
    },
  };
}
async function settle(page: ReturnType<typeof mount>) {
  await vi.advanceTimersByTimeAsync(0);
  page.render();
}
function feedbackField(page: ReturnType<typeof mount>, label: string) {
  const field = page
    .render()
    .find(
      (element) => element.type === "label" && text(element.props.children as ReactNode) === label,
    );
  return elements(field).find((element) => element.type === "textarea");
}
function fillFeedbackField(page: ReturnType<typeof mount>, label: string, value: string) {
  const field = feedbackField(page, label);
  expect(field).toBeDefined();
  (field!.props.onChange as (event: unknown) => void)({ target: { value } });
}
function editFeedback(page: ReturnType<typeof mount>) {
  const edit = page
    .render()
    .find(
      (element) =>
        element.type === "button" && text(element.props.children as ReactNode) === "Edit",
    );
  expect(edit).toBeDefined();
  (edit!.props.onClick as () => void)();
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
  it("retains unsent reply and edit text through delayed, completed, and transient parent focus revalidation", async () => {
    const environment = setup();
    const page = mount(shareId, true);
    await settle(page);
    await settle(page);
    await settle(page);
    fillFeedbackField(page, "Reply to this thread", "Unsubmitted reply");
    editFeedback(page);
    fillFeedbackField(page, "Edit comment", "Unsaved comment edit");
    let finish!: (value: PresentationReview) => void;
    mocked.review.mockImplementationOnce(
      () =>
        new Promise<PresentationReview>((resolve) => {
          finish = resolve;
        }),
    );
    environment.dispatch("focus");
    expect(feedbackField(page, "Reply to this thread")?.props.value).toBe("Unsubmitted reply");
    expect(feedbackField(page, "Edit comment")?.props.value).toBe("Unsaved comment edit");
    finish(reviewFixture());
    await settle(page);
    expect(feedbackField(page, "Reply to this thread")?.props.value).toBe("Unsubmitted reply");
    expect(feedbackField(page, "Edit comment")?.props.value).toBe("Unsaved comment edit");
    mocked.review.mockRejectedValueOnce(
      new ApiClientError("Try later", "TEMPORARILY_UNAVAILABLE", 503),
    );
    environment.dispatch("focus");
    await settle(page);
    expect(page.text()).toContain("Recovered private presentation");
    expect(feedbackField(page, "Reply to this thread")?.props.value).toBe("Unsubmitted reply");
    expect(feedbackField(page, "Edit comment")?.props.value).toBe("Unsaved comment edit");
  });
  it.each(["bearer", "version", "revocation", "expiry", "account", "silent account"] as const)(
    "clears unsent discussion drafts after a %s change",
    async (change) => {
      const environment = setup();
      const page = mount(shareId, true);
      await settle(page);
      await settle(page);
      await settle(page);
      fillFeedbackField(page, "Reply to this thread", "Old private reply");
      editFeedback(page);
      fillFeedbackField(page, "Edit comment", "Old private edit");
      if (change === "bearer") {
        environment.location.href += `#token=${replacementToken}`;
        environment.dispatch("hashchange");
        expect(feedbackField(page, "Reply to this thread")).toBeUndefined();
      } else if (change === "revocation") {
        mocked.review.mockRejectedValueOnce(
          new ApiClientError("Revoked", "PRESENTATION_UNAVAILABLE", 404),
        );
        environment.dispatch("focus");
      } else if (change === "version") {
        mocked.review.mockResolvedValueOnce({ ...reviewFixture(), versionId: otherShareId });
        environment.dispatch("focus");
      } else if (change === "expiry") {
        await vi.advanceTimersByTimeAsync(86_400_001);
      } else {
        mocked.feedback.mockResolvedValueOnce(feedbackFixture("b".repeat(64)));
        environment.dispatch(change === "account" ? AUTH_CHANGE_EVENT : "focus");
      }
      await settle(page);
      await settle(page);
      await settle(page);
      expect(feedbackField(page, "Edit comment")).toBeUndefined();
      if (["revocation", "version", "expiry"].includes(change)) {
        expect(feedbackField(page, "Reply to this thread")).toBeUndefined();
        expect(page.text()).toContain("unavailable or has expired");
      } else expect(feedbackField(page, "Reply to this thread")?.props.value).toBe("");
    },
  );
  it("keeps feedback outside the keyed page section while updating the current composer target", async () => {
    setup();
    const fixture = reviewFixture();
    const nextBlockId = "00000000-0000-4000-8000-000000000005";
    fixture.blocks.push({ ...fixture.blocks[0]!, id: nextBlockId });
    mocked.review.mockResolvedValueOnce(fixture);
    mocked.access.mockResolvedValueOnce({ versionId, expiresAt: fixture.expiresAt });
    const page = mount();
    await settle(page);
    const first = page.render().find((element) => element.type === PresentationFeedbackPanel)!;
    expect(first.props).toMatchObject({
      mode: "reviewer",
      blockId: fixture.blocks[0]!.id,
      blockIndex: 0,
      versionId,
    });
    const section = page
      .render()
      .find((element) => element.props["aria-label"] === "Current presentation page")!;
    expect(section.key).toBe(fixture.blocks[0]!.id);
    expect(elements(section).some((element) => element.type === PresentationFeedbackPanel)).toBe(
      false,
    );
    const next = page
      .render()
      .find(
        (element) =>
          element.type === "button" && text(element.props.children as ReactNode) === "Next page",
      )!;
    (next.props.onClick as () => void)();
    await settle(page);
    const second = page.render().find((element) => element.type === PresentationFeedbackPanel)!;
    expect(second.key).toBe(first.key);
    expect(second.props).toMatchObject({ blockId: nextBlockId, blockIndex: 1, versionId });
    (second.props.onAccessLost as () => void)();
    expect(page.text()).not.toContain("Recovered private presentation");
    expect(page.render().some((element) => element.type === PresentationFeedbackPanel)).toBe(false);
  });
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
  ])(
    "retains the current review and credential after a transient focus failure: %s",
    async (failure) => {
      const environment = setup();
      const page = mount();
      await settle(page);
      mocked.review.mockRejectedValueOnce(failure);
      environment.dispatch("focus");
      await settle(page);
      expect(mocked.review).toHaveBeenCalledTimes(2);
      expectRequest(1);
      expect(page.text()).toContain("Recovered private presentation");
      expect(environment.storage.removeItem).not.toHaveBeenCalled();

      environment.dispatch("focus");
      await settle(page);
      expect(mocked.review).toHaveBeenCalledTimes(3);
      expectRequest(2);
      expect(page.text()).toContain("Recovered private presentation");
    },
  );

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
