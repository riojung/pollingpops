import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EnablePresentationReviewSchema,
  PresentationReviewFeedbackMutationSchema,
  type PresentationReviewFeedback,
  type PresentationReviewFeedbackMutation,
} from "@openround/contracts";
import { ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import {
  PresentationFeedbackPanel,
  PresentationFeedbackThread,
  presentationFeedbackRecoveryKey,
} from "./feedback-panel";

interface Hooks {
  cursor: number;
  slots: unknown[];
  dependencies: Map<number, readonly unknown[] | undefined>;
  effects: Array<{ index: number; effect: ReactModule.EffectCallback }>;
  cleanups: Map<number, void | (() => void)>;
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  author: vi.fn(),
  enable: vi.fn(),
  authorMutation: vi.fn(),
  access: vi.fn(),
  reviewer: vi.fn(),
  reviewerMutation: vi.fn(),
  shareAccess: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useRef: <T,>(initial: T) => {
    if (!mocked.hooks) return { current: initial };
    const hooks = mocked.hooks,
      index = hooks.cursor++;
    hooks.slots[index] ??= { current: initial };
    return hooks.slots[index];
  },
  useState: <T,>(initial: T) => {
    if (!mocked.hooks) return [initial, vi.fn()];
    const hooks = mocked.hooks,
      index = hooks.cursor++;
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
    if (!mocked.hooks) return;
    const hooks = mocked.hooks,
      index = hooks.cursor++,
      previous = hooks.dependencies.get(index);
    if (
      !hooks.dependencies.has(index) ||
      !dependencies ||
      dependencies.some((value, i) => value !== previous?.[i])
    )
      hooks.effects.push({ index, effect });
    hooks.dependencies.set(index, dependencies);
  },
}));
vi.mock("../../lib/presentation-review-feedback-client", () => ({
  fetchPresentationAuthorFeedback: mocked.author,
  enablePresentationReview: mocked.enable,
  mutatePresentationAuthorFeedback: mocked.authorMutation,
  fetchPresentationReviewerAccess: mocked.access,
  fetchPresentationReviewerFeedback: mocked.reviewer,
  mutatePresentationReviewerFeedback: mocked.reviewerMutation,
}));
vi.mock("../../lib/presentation-sharing-client", () => ({
  fetchPresentationShareAccess: mocked.shareAccess,
}));
const shareId = "00000000-0000-4000-8000-000000000001",
  versionId = "00000000-0000-4000-8000-000000000002",
  presentationId = "00000000-0000-4000-8000-000000000003",
  blockId = "00000000-0000-4000-8000-000000000004",
  secondBlockId = "00000000-0000-4000-8000-000000000005";
const viewerKey = "a".repeat(64),
  otherViewer = "b".repeat(64),
  token = "secret-token";
function fixture(overrides: Partial<PresentationReviewFeedback> = {}): PresentationReviewFeedback {
  return {
    schemaVersion: 1,
    shareId,
    versionId,
    version: 3,
    reviewSeq: 1,
    status: "open",
    viewerKey,
    expiresAt: "2027-01-01T00:00:00.000Z",
    serverTime: "2026-11-05T00:00:00.000Z",
    capabilities: { enable: false, comment: true, resolve: false, approve: false },
    approval: { state: "not_approved", approvedAt: null, approvedReviewSeq: null },
    threads: [],
    ...overrides,
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
const mounted = new Set<{ close: () => void }>();
function mountHarness<Props>(Component: (props: Props) => ReactNode, initial: Props) {
  let props = initial;
  const hooks: Hooks = {
    cursor: 0,
    slots: [],
    dependencies: new Map(),
    effects: [],
    cleanups: new Map(),
  };
  function render(next = props) {
    props = next;
    hooks.cursor = 0;
    hooks.effects = [];
    mocked.hooks = hooks;
    let tree: ReactNode;
    try {
      tree = Component(props);
    } finally {
      mocked.hooks = null;
    }
    for (const { index, effect } of hooks.effects) {
      hooks.cleanups.get(index)?.();
      hooks.cleanups.set(index, effect());
    }
    return elements(tree);
  }
  const panel = {
    render,
    text: () => text(render()[0]),
    click(label: string) {
      const button = render().find(
        (element) =>
          element.type === "button" && text(element.props.children as ReactNode) === label,
      );
      expect(button).toBeDefined();
      expect(button?.props.disabled).not.toBe(true);
      (button!.props.onClick as () => void)();
    },
    type(value: string) {
      const textarea = render().find((element) => element.type === "textarea")!;
      (textarea.props.onChange as (event: unknown) => void)({ target: { value } });
    },
    submit() {
      (
        render().find((element) => element.type === "form")!.props.onSubmit as (
          event: unknown,
        ) => void
      )({ preventDefault: vi.fn() });
    },
    close() {
      for (const cleanup of hooks.cleanups.values()) cleanup?.();
      hooks.cleanups.clear();
      mounted.delete(panel);
    },
  };
  mounted.add(panel);
  render();
  return panel;
}
function mount(initial: Parameters<typeof PresentationFeedbackPanel>[0]) {
  return mountHarness(PresentationFeedbackPanel, initial);
}
const reviewerProps = {
  mode: "reviewer" as const,
  shareId,
  versionId,
  token,
  blockId,
  blockIndex: 0,
  onAccessLost: vi.fn(),
};
function setup() {
  const stored = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal("window", {
    addEventListener: (key: string, fn: () => void) => {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)!.add(fn);
    },
    removeEventListener: (key: string, fn: () => void) => listeners.get(key)?.delete(fn),
  });
  for (const mock of Object.values(mocked)) if (typeof mock === "function") mock.mockReset();
  mocked.access.mockResolvedValue({ enabled: true, signInRequired: true, versionId });
  mocked.author.mockResolvedValue(fixture());
  mocked.reviewer.mockResolvedValue(fixture());
  mocked.shareAccess.mockResolvedValue({ versionId, expiresAt: "2027-01-01T00:00:00.000Z" });
  reviewerProps.onAccessLost.mockReset();
  return {
    stored,
    dispatch: (name: string) => {
      for (const fn of listeners.get(name) ?? []) fn();
    },
  };
}
async function ready(panel: ReturnType<typeof mount>) {
  await vi.waitFor(() => expect(panel.text()).toContain("Published version 3"));
}
afterEach(() => {
  for (const panel of [...mounted]) panel.close();
  mocked.hooks = null;
  vi.unstubAllGlobals();
});

describe("Presentation review feedback recovery", () => {
  it("releases an abandoned empty draft so a new comment anchors to the current page", async () => {
    setup();
    const panel = mount(reviewerProps);
    await ready(panel);
    panel.type("An abandoned comment on page one");
    panel.type("");
    panel.render({ ...reviewerProps, blockId: secondBlockId, blockIndex: 1 });
    panel.type("A new comment on page two");
    expect(panel.text()).toContain("Commenting on published page 2");
    mocked.reviewerMutation.mockResolvedValueOnce({ feedback: fixture(), replayed: false });
    panel.submit();
    await vi.waitFor(() => expect(mocked.reviewerMutation).toHaveBeenCalledOnce());
    expect(mocked.reviewerMutation.mock.calls[0]![2].command).toMatchObject({
      type: "thread.create",
      blockId: secondBlockId,
      text: "A new comment on page two",
    });
  });
  it("enables and posts valid distinct IDs when crypto.randomUUID is unavailable", async () => {
    setup();
    const secureCrypto = globalThis.crypto;
    const getRandomValues = vi.fn(secureCrypto.getRandomValues.bind(secureCrypto));
    vi.stubGlobal("crypto", { getRandomValues });
    mocked.author.mockResolvedValue(
      fixture({
        status: "not_enabled",
        reviewSeq: 0,
        capabilities: { enable: true, comment: false, resolve: false, approve: false },
      }),
    );
    mocked.enable.mockResolvedValueOnce({ feedback: fixture(), replayed: false });
    const author = mount({ mode: "author", presentationId, shareId, versionId });
    await ready(author);
    author.click("Enable comments");
    await vi.waitFor(() => expect(mocked.enable).toHaveBeenCalledOnce());
    const enable = EnablePresentationReviewSchema.parse(mocked.enable.mock.calls[0]![2]);
    author.close();

    mocked.reviewerMutation.mockResolvedValueOnce({ feedback: fixture(), replayed: false });
    const reviewer = mount(reviewerProps);
    await ready(reviewer);
    reviewer.type("Review this page without the optional UUID API.");
    reviewer.submit();
    await vi.waitFor(() => expect(mocked.reviewerMutation).toHaveBeenCalledOnce());
    const mutation = PresentationReviewFeedbackMutationSchema.parse(
      mocked.reviewerMutation.mock.calls[0]![2],
    );
    expect(mutation.command.type).toBe("thread.create");
    if (mutation.command.type !== "thread.create") throw new Error("Expected a page comment");
    expect(
      new Set([
        enable.operationId,
        mutation.operationId,
        mutation.command.threadId,
        mutation.command.messageId,
      ]).size,
    ).toBe(4);
    expect(mutation.command).toMatchObject({
      blockId,
      text: "Review this page without the optional UUID API.",
    });
    expect(getRandomValues).toHaveBeenCalledTimes(4);
  });
  it("retains the original page and exact mutation across navigation, lost acknowledgement, and reload", async () => {
    const { stored } = setup();
    mocked.reviewerMutation.mockRejectedValueOnce(new TypeError("Lost acknowledgement"));
    const first = mount(reviewerProps);
    await ready(first);
    expect(mocked.reviewer).toHaveBeenCalled(); // Policy signInRequired does not force an authenticated user to sign in.
    first.type("Please clarify this opening.");
    first.render({ ...reviewerProps, blockId: secondBlockId, blockIndex: 1 });
    expect(first.text()).toContain("Commenting on published page 1");
    first.submit();
    await vi.waitFor(() => expect(first.text()).toContain("Retry pending action"));
    const original = mocked.reviewerMutation.mock
      .calls[0]![2] as PresentationReviewFeedbackMutation;
    expect(original.command).toMatchObject({
      type: "thread.create",
      blockId,
      text: "Please clarify this opening.",
    });
    expect(original.viewerKey).toBe(viewerKey);
    expect(stored.get(presentationFeedbackRecoveryKey("reviewer", shareId))).not.toContain(token);
    first.close();
    const second = mount({ ...reviewerProps, blockId: secondBlockId, blockIndex: 1 });
    await ready(second);
    expect(mocked.reviewerMutation).toHaveBeenCalledTimes(1);
    expect(second.text()).toContain("Commenting on published page 1");
    mocked.reviewerMutation.mockResolvedValueOnce({ feedback: fixture(), replayed: true });
    second.click("Retry pending action");
    await vi.waitFor(() => expect(second.text()).not.toContain("Retry pending action"));
    expect(mocked.reviewerMutation.mock.calls[1]![2]).toEqual(original);
    expect(second.render().find((element) => element.type === "textarea")?.props.value).toBe("");
  });
  it("clears a previous account's pending intent before replay and never posts it under the new viewer", async () => {
    const { stored } = setup();
    mocked.reviewerMutation.mockRejectedValueOnce(new TypeError("Lost acknowledgement"));
    const panel = mount(reviewerProps);
    await ready(panel);
    panel.type("Private unsent text");
    panel.submit();
    await vi.waitFor(() => expect(panel.text()).toContain("Retry pending action"));
    mocked.reviewer.mockResolvedValueOnce(fixture({ viewerKey: otherViewer }));
    panel.click("Retry pending action");
    await vi.waitFor(() => expect(panel.text()).toContain("Your account changed"));
    expect(mocked.reviewerMutation).toHaveBeenCalledTimes(1);
    expect(panel.text()).not.toContain("Retry pending action");
    expect(stored.get(presentationFeedbackRecoveryKey("reviewer", shareId))).not.toContain(
      "Private unsent text",
    );
  });
  it("retains text and its page anchor on a confirmed conflict without silently resubmitting", async () => {
    setup();
    mocked.reviewerMutation.mockRejectedValueOnce(
      new ApiClientError("Changed", "PRESENTATION_REVIEW_CONFLICT", 409),
    );
    const panel = mount(reviewerProps);
    await ready(panel);
    panel.type("Keep this comment");
    panel.submit();
    await vi.waitFor(() => expect(panel.text()).toContain("Your text is retained"));
    panel.render({ ...reviewerProps, blockId: secondBlockId, blockIndex: 1 });
    panel.click("Refresh feedback");
    await ready(panel);
    expect(panel.render().find((element) => element.type === "textarea")?.props.value).toBe(
      "Keep this comment",
    );
    expect(panel.text()).toContain("Commenting on published page 1");
    expect(mocked.reviewerMutation).toHaveBeenCalledTimes(1);
  });
  it("recovers the exact enable intent after a lost acknowledgement", async () => {
    setup();
    const disabled = fixture({
      status: "not_enabled",
      reviewSeq: 0,
      capabilities: { enable: true, comment: false, resolve: false, approve: false },
    });
    mocked.author.mockResolvedValue(disabled);
    mocked.enable.mockRejectedValueOnce(new TypeError("Lost acknowledgement"));
    const props = { mode: "author" as const, presentationId, shareId, versionId };
    const first = mount(props);
    await ready(first);
    first.click("Enable comments");
    await vi.waitFor(() => expect(first.text()).toContain("Retry pending action"));
    const original = mocked.enable.mock.calls[0]![2];
    first.close();
    const second = mount(props);
    await ready(second);
    mocked.enable.mockResolvedValueOnce({ feedback: fixture(), replayed: true });
    second.click("Retry pending action");
    await vi.waitFor(() => expect(second.text()).not.toContain("Retry pending action"));
    expect(mocked.enable.mock.calls[1]![2]).toEqual(original);
  });
  it("uses a clean sign-in return path only after the signed feedback read returns 401", async () => {
    setup();
    mocked.reviewer.mockRejectedValueOnce(new ApiClientError("Sign in", "UNAUTHORIZED", 401));
    const panel = mount(reviewerProps);
    await vi.waitFor(() => expect(panel.text()).toContain("Sign in to comment"));
    expect(panel.render().find((element) => element.type === "a")?.props.href).toBe(
      `/signin?returnTo=${encodeURIComponent(`/presentation-review/${shareId}`)}`,
    );
    expect(reviewerProps.onAccessLost).not.toHaveBeenCalled();
  });
  it("keeps E08 viewing valid on an older server but clears all feedback when the share is revoked", async () => {
    setup();
    mocked.access.mockRejectedValueOnce(new ApiClientError("Missing route", "NOT_FOUND", 404));
    const old = mount(reviewerProps);
    await vi.waitFor(() => expect(old.text()).toContain("Comments are not enabled"));
    expect(reviewerProps.onAccessLost).not.toHaveBeenCalled();
    old.close();
    mocked.access.mockRejectedValueOnce(
      new ApiClientError("Revoked", "PRESENTATION_UNAVAILABLE", 404),
    );
    mocked.shareAccess.mockRejectedValueOnce(
      new ApiClientError("Revoked", "PRESENTATION_UNAVAILABLE", 404),
    );
    mount(reviewerProps);
    await vi.waitFor(() => expect(reviewerProps.onAccessLost).toHaveBeenCalledOnce());
  });
  it("preserves an uncertain intent through a temporary older-server fallback", async () => {
    const { stored } = setup();
    mocked.reviewerMutation.mockRejectedValueOnce(new TypeError("Lost acknowledgement"));
    const first = mount(reviewerProps);
    await ready(first);
    first.type("Keep the exact intent");
    first.submit();
    await vi.waitFor(() => expect(first.text()).toContain("Retry pending action"));
    const original = mocked.reviewerMutation.mock.calls[0]![2];
    const retained = stored.get(presentationFeedbackRecoveryKey("reviewer", shareId));
    mocked.access.mockRejectedValueOnce(new ApiClientError("Older route", "NOT_FOUND", 404));
    first.click("Refresh feedback");
    await vi.waitFor(() => expect(first.text()).toContain("Comments are not enabled"));
    expect(first.text()).not.toContain("Published version");
    expect(stored.get(presentationFeedbackRecoveryKey("reviewer", shareId))).toBe(retained);
    expect(reviewerProps.onAccessLost).not.toHaveBeenCalled();
    first.close();
    const recovered = mount(reviewerProps);
    await ready(recovered);
    mocked.reviewerMutation.mockResolvedValueOnce({ feedback: fixture(), replayed: true });
    recovered.click("Retry pending action");
    await vi.waitFor(() => expect(recovered.text()).not.toContain("Retry pending action"));
    expect(mocked.reviewerMutation.mock.calls[1]![2]).toEqual(original);
  });
  it("clears local account-bound text immediately on authentication changes", async () => {
    const environment = setup();
    const panel = mount(reviewerProps);
    await ready(panel);
    panel.type("Old account text");
    mocked.reviewer.mockResolvedValueOnce(fixture({ viewerKey: otherViewer }));
    environment.dispatch(AUTH_CHANGE_EVENT);
    await ready(panel);
    expect(panel.render().find((element) => element.type === "textarea")?.props.value).toBe("");
    expect(mocked.reviewerMutation).not.toHaveBeenCalled();
  });
});

describe("Presentation feedback discussion accessibility", () => {
  it("offers replies only after an author reopens a resolved thread", async () => {
    setup();
    const thread = {
      id: "00000000-0000-4000-8000-000000000006",
      blockId,
      blockIndex: 0,
      version: 2,
      resolved: true,
      createdAt: "2026-11-05T00:00:00.000Z",
      updatedAt: "2026-11-05T00:00:00.000Z",
      messages: [
        {
          id: "00000000-0000-4000-8000-000000000007",
          text: "Original comment",
          authorLabel: "Reviewer 1",
          authorRole: "reviewer" as const,
          isOwn: false,
          version: 1,
          deleted: false,
          createdAt: "2026-11-05T00:00:00.000Z",
          updatedAt: "2026-11-05T00:00:00.000Z",
        },
      ],
    };
    const onCommand = vi.fn().mockResolvedValue(true);
    const props: Parameters<typeof PresentationFeedbackThread>[0] = {
      thread,
      comment: true,
      resolve: false,
      disabled: false,
      pending: null,
      onCommand,
    };
    const panel = mountHarness(PresentationFeedbackThread, props);
    expect(panel.render().some((element) => element.type === "textarea")).toBe(false);
    expect(panel.text()).toContain("An author must reopen this thread before you can reply.");
    panel.render({ ...props, thread: { ...thread, resolved: false, version: 3 } });
    panel.type("A reply after reopening");
    panel.submit();
    await vi.waitFor(() => expect(onCommand).toHaveBeenCalledOnce());
    expect(onCommand.mock.calls[0]![0]).toMatchObject({
      type: "message.reply",
      expectedThreadVersion: 3,
      text: "A reply after reopening",
    });
  });
  it("clears reply and edit text only on acknowledged success, including recovered retries", async () => {
    setup();
    const thread = {
      id: "00000000-0000-4000-8000-000000000006",
      blockId,
      blockIndex: 0,
      version: 2,
      resolved: false,
      createdAt: "2026-11-05T00:00:00.000Z",
      updatedAt: "2026-11-05T00:00:00.000Z",
      messages: [
        {
          id: "00000000-0000-4000-8000-000000000007",
          text: "Original comment",
          authorLabel: "Reviewer 1",
          authorRole: "reviewer" as const,
          isOwn: true,
          version: 1,
          deleted: false,
          createdAt: "2026-11-05T00:00:00.000Z",
          updatedAt: "2026-11-05T00:00:00.000Z",
        },
      ],
    };
    const onCommand = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const props: Parameters<typeof PresentationFeedbackThread>[0] = {
      thread,
      comment: true,
      resolve: false,
      disabled: false,
      pending: null,
      onCommand,
    };
    const panel = mountHarness(PresentationFeedbackThread, props);
    panel.type("Keep my reply");
    panel.submit();
    await vi.waitFor(() => expect(onCommand).toHaveBeenCalledTimes(1));
    expect(panel.render().find((element) => element.type === "textarea")?.props.value).toBe(
      "Keep my reply",
    );
    panel.submit();
    await vi.waitFor(() =>
      expect(panel.render().find((element) => element.type === "textarea")?.props.value).toBe(""),
    );
    expect(onCommand.mock.calls[1]![0]).toMatchObject({
      type: "message.reply",
      expectedThreadVersion: 2,
      text: "Keep my reply",
    });

    panel.click("Edit");
    panel.type("Revised comment");
    onCommand.mockResolvedValueOnce(false);
    panel.submit();
    await vi.waitFor(() => expect(onCommand).toHaveBeenCalledTimes(3));
    expect(panel.text()).toContain("Save edit");
    expect(panel.render().find((element) => element.type === "textarea")?.props.value).toBe(
      "Revised comment",
    );
    const command = onCommand.mock.calls[2]![0];
    panel.render({ ...props, acceptedCommand: command }); // Retry pending action ACK arrives in the parent.
    expect(panel.text()).not.toContain("Save edit");
    expect(panel.text()).toContain("Edit");
  });
  it("uses published page labels and server aliases, exposes own-message actions, and keeps closed history readable", () => {
    const thread = {
      id: "00000000-0000-4000-8000-000000000006",
      blockId,
      blockIndex: 1,
      version: 2,
      resolved: false,
      createdAt: "2026-11-05T00:00:00.000Z",
      updatedAt: "2026-11-05T00:00:00.000Z",
      messages: [
        {
          id: "00000000-0000-4000-8000-000000000007",
          text: "Could this be clearer?",
          authorLabel: "Reviewer 1",
          authorRole: "reviewer" as const,
          isOwn: true,
          version: 1,
          deleted: false,
          createdAt: "2026-11-05T00:00:00.000Z",
          updatedAt: "2026-11-05T00:00:00.000Z",
        },
      ],
    };
    const open = renderToStaticMarkup(
      <PresentationFeedbackThread
        thread={thread}
        comment
        resolve
        disabled={false}
        pending={null}
        onCommand={vi.fn()}
      />,
    );
    expect(open).toContain('aria-label="Review thread"');
    expect(open).toContain("Published page 2");
    expect(open).toContain("Reviewer 1 (you)");
    expect(open).toContain(">Edit</button>");
    expect(open).toContain(">Delete</button>");
    expect(open).toContain("Reply to this thread");
    expect(open).toContain(">Resolve</button>");
    expect(open).not.toContain(blockId);
    const closed = renderToStaticMarkup(
      <PresentationFeedbackThread
        thread={thread}
        comment={false}
        resolve={false}
        disabled
        pending={null}
        onCommand={vi.fn()}
      />,
    );
    expect(closed).toContain("Could this be clearer?");
    expect(closed).not.toContain("<button");
    expect(closed).not.toContain("<textarea");
  });
});
