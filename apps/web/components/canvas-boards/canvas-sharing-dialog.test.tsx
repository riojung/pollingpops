import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type * as SharingModule from "./canvas-sharing-client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  supportedLocales,
  type BoardInvitationBatchResponse,
  type CanvasBoardView,
} from "@openround/contracts";
import { ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import {
  canvasSharingEnglishMessages,
  canvasSharingMessages,
} from "../../lib/i18n/canvas-sharing-messages";
import { BoardEmailInvitations } from "../idea-boards/guest-invitation-dialog";
import { CanvasShareDialog } from "./canvas-share-dialog";
import { canvasBoard, canvasId } from "./canvas-test-fixtures";

interface Slot {
  dependencies?: readonly unknown[];
  cleanup?: () => void;
}
interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  send: vi.fn(),
  readSharing: vi.fn(),
  locale: "en-CA" as (typeof supportedLocales)[number],
}));
vi.mock("./canvas-sharing-client", async (original) => ({
  ...(await original<typeof SharingModule>()),
  sendBoardInvitations: mocked.send,
  readCanvasSharing: mocked.readSharing,
}));
vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    locale: mocked.locale,
    t: (key: keyof typeof english) => english[key] ?? key,
  }),
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useId: () => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useId();
      const index = hooks.cursor++;
      hooks.slots[index] ??= `sharing-${index}`;
      return hooks.slots[index];
    },
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index],
        (next: T | ((previous: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function"
              ? (next as (previous: T) => T)(hooks.slots[index] as T)
              : next;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useEffect(effect, dependencies);
      const index = hooks.cursor++,
        previous = hooks.slots[index] as Slot | undefined;
      if (
        !previous ||
        !dependencies ||
        !previous.dependencies ||
        dependencies.some((value, position) => !Object.is(value, previous.dependencies![position]))
      )
        hooks.effects.push(() => {
          previous?.cleanup?.();
          const cleanup = effect();
          hooks.slots[index] = { dependencies, ...(cleanup ? { cleanup } : {}) };
        });
    },
    useCallback: (callback: (...args: never[]) => unknown, dependencies: readonly unknown[]) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useCallback(callback, dependencies);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as
        { value: typeof callback; dependencies: readonly unknown[] } | undefined;
      if (
        !previous ||
        dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))
      )
        hooks.slots[index] = { value: callback, dependencies };
      return (hooks.slots[index] as { value: typeof callback }).value;
    },
  };
});
function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<Record<string, unknown>>(node)
    ? text(node.props.children as ReactNode)
    : "";
}
const cleanups: Array<() => void> = [];
function harness(kind: "guests" | "collaborators" = "collaborators") {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  const refresh = vi.fn(),
    lock = vi.fn();
  let tree: ReactNode;
  let revokedInvitationIds: string[] = [];
  function render() {
    hooks.cursor = 0;
    hooks.effects = [];
    mocked.hooks = hooks;
    try {
      const content = BoardEmailInvitations({
        target: { kind, id: canvasId },
        onRefresh: refresh,
        onLockChange: lock,
        revokedInvitationIds,
      });
      tree = (content.type as (props: typeof content.props) => ReactNode)(content.props);
    } finally {
      mocked.hooks = null;
    }
    hooks.effects.forEach((effect) => effect());
    return renderToStaticMarkup(tree);
  }
  const find = (predicate: (element: ReactElement<Record<string, unknown>>) => boolean) => {
    const result = elements(tree).find(predicate);
    if (!result) throw new Error("Expected sharing control");
    return result;
  };
  const change = (type: string, value: string) => {
    (
      find((element) => element.type === type).props.onChange as (event: {
        target: { value: string };
      }) => void
    )({ target: { value } });
    render();
  };
  const submit = async () => {
    (
      find((element) => element.type === "form").props.onSubmit as (event: {
        preventDefault: () => void;
      }) => void
    )({ preventDefault() {} });
    for (let count = 0; count < 8; count++) await Promise.resolve();
    return render();
  };
  const close = () => hooks.slots.forEach((slot) => (slot as Slot | undefined)?.cleanup?.());
  cleanups.push(close);
  render();
  return {
    render,
    change,
    submit,
    find,
    refresh,
    lock,
    close,
    revokeInvitation: (id: string) => {
      revokedInvitationIds = [...revokedInvitationIds, id];
      return render();
    },
  };
}
function sharingHarness() {
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  let tree: ReactNode;
  let board = canvasBoard;
  const onClose = vi.fn();
  const render = (next?: CanvasBoardView) => {
    if (next) board = next;
    hooks.cursor = 0;
    hooks.effects = [];
    mocked.hooks = hooks;
    try {
      const content = CanvasShareDialog({ board, onClose, onRefresh: vi.fn() })!;
      tree = (content.type as (props: typeof content.props) => ReactNode)(content.props);
    } finally {
      mocked.hooks = null;
    }
    hooks.effects.forEach((effect) => effect());
    return renderToStaticMarkup(tree);
  };
  cleanups.push(() => hooks.slots.forEach((slot) => (slot as Slot | undefined)?.cleanup?.()));
  const find = (predicate: (element: ReactElement<Record<string, unknown>>) => boolean) => {
    const result = elements(tree).find(predicate);
    if (!result) throw new Error("Expected sharing control");
    return result;
  };
  render();
  return {
    render,
    find,
    onClose,
    rows: () => elements(tree).filter((element) => element.type === "li"),
  };
}
function response(
  statuses: BoardInvitationBatchResponse["results"][number]["status"][],
): BoardInvitationBatchResponse {
  return {
    batchId: canvasId,
    complete: !statuses.includes("pending"),
    results: statuses.map((status, index) => ({
      email: `${index === 0 ? "first" : "second"}@example.test`,
      status,
    })),
  };
}
beforeEach(() => {
  mocked.locale = "en-CA";
  vi.stubGlobal("window", Object.assign(new EventTarget(), { confirm: vi.fn() }));
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  mocked.hooks = null;
});

describe("sharing invitation workflow", () => {
  it("validates the entire list before sending and never submits a partial valid subset", async () => {
    const page = harness();
    page.change("textarea", "first@example.test, invalid");
    expect(await page.submit()).toContain(canvasSharingEnglishMessages.emailInvalid);
    expect(mocked.send).not.toHaveBeenCalled();
    page.change("textarea", "FIRST@example.test\nfirst@example.test, second@example.test");
    mocked.send.mockResolvedValue(response(["sent", "pending"]));
    await page.submit();
    expect(mocked.send.mock.calls[0]![1]).toEqual({
      operationId: expect.any(String),
      emails: ["first@example.test", "second@example.test"],
      role: "editor",
    });
    expect(page.find((element) => element.type === "textarea").props.disabled).toBe(true);
    expect(page.find((element) => element.type === "select").props.disabled).toBe(true);
    expect(page.lock).toHaveBeenLastCalledWith(true);
  });
  it("retains the same operation, recipient list and role across partial pending results", async () => {
    const page = harness();
    page.change("textarea", "first@example.test, second@example.test");
    page.change("select", "viewer");
    mocked.send
      .mockResolvedValueOnce(response(["sent", "pending"]))
      .mockResolvedValueOnce(response(["sent", "failed"]));
    const first = await page.submit();
    expect(first).toContain("Sent");
    expect(first).toContain("Pending");
    await page.submit();
    expect(mocked.send.mock.calls[0]![1]).toBe(mocked.send.mock.calls[1]![1]);
    expect(mocked.send.mock.calls[1]![1].role).toBe("viewer");
    expect(page.lock).toHaveBeenLastCalledWith(false);
    expect(
      page.find((element) => element.type === "button" && element.props.type === "submit").props
        .disabled,
    ).toBe(true);
    expect(page.refresh).toHaveBeenCalledTimes(2);
  });
  it("removes known-revoked result links without changing the pending retry envelope", async () => {
    const page = harness();
    page.change("textarea", "first@example.test, second@example.test");
    const first = response(["sent", "pending"]);
    first.results[0]!.invitationId = canvasId;
    mocked.send.mockResolvedValueOnce(first).mockResolvedValueOnce({
      ...first,
      complete: true,
      results: [first.results[0], { ...first.results[1], status: "sent" }],
    });
    expect(await page.submit()).toContain(`/canvas/invitations/${canvasId}`);
    expect(page.revokeInvitation(canvasId)).not.toContain(`/canvas/invitations/${canvasId}`);
    expect(page.find((element) => element.type === "textarea").props.disabled).toBe(true);
    expect(await page.submit()).not.toContain(`/canvas/invitations/${canvasId}`);
    expect(mocked.send.mock.calls[0]![1]).toBe(mocked.send.mock.calls[1]![1]);
    expect(page.lock).toHaveBeenLastCalledWith(false);
  });
  it("keeps unknown delivery terminal and requires explicit confirmation before a fresh batch", async () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal("window", Object.assign(new EventTarget(), { confirm }));
    const page = harness("guests");
    page.change("textarea", "first@example.test");
    mocked.send.mockResolvedValue(response(["unknown"]));
    const html = await page.submit();
    expect(html).toContain(canvasSharingEnglishMessages.unknownHelp);
    expect(
      page.find((element) => element.type === "button" && element.props.type === "submit").props
        .disabled,
    ).toBe(true);
    const reset = () =>
      (
        page.find(
          (element) =>
            element.type === "button" && text(element) === canvasSharingEnglishMessages.newBatch,
        ).props.onClick as () => void
      )();
    reset();
    page.render();
    expect(page.find((element) => element.type === "textarea").props.disabled).toBe(true);
    reset();
    page.render();
    expect(confirm).toHaveBeenCalledWith(canvasSharingEnglishMessages.newBatchConfirm);
    expect(page.find((element) => element.type === "textarea").props.value).toBe("");
    expect(page.find((element) => element.type === "textarea").props.disabled).toBe(false);
    expect(mocked.send).toHaveBeenCalledTimes(1);
  });
  it("keeps an uncertain transport failure retryable with the exact intent", async () => {
    const page = harness();
    page.change("textarea", "first@example.test");
    mocked.send
      .mockRejectedValueOnce(new TypeError("Connection ended"))
      .mockResolvedValueOnce(response(["sent"]));
    expect(await page.submit()).toContain(canvasSharingEnglishMessages.notConfirmed);
    await page.submit();
    expect(mocked.send.mock.calls[0]![1]).toBe(mocked.send.mock.calls[1]![1]);
  });
  it("does not automatically retry terminal request errors", async () => {
    const page = harness();
    page.change("textarea", "first@example.test");
    mocked.send.mockRejectedValue(new ApiClientError("Denied", "FORBIDDEN", 403));
    expect(await page.submit()).toContain(canvasSharingEnglishMessages.requestFailed);
    await page.submit();
    expect(mocked.send).toHaveBeenCalledTimes(1);
    expect(page.lock).toHaveBeenLastCalledWith(false);
  });
  it("releases the imperative lock after a fast complete response without an intermediate render", async () => {
    const page = harness();
    page.change("textarea", "first@example.test");
    mocked.send.mockResolvedValue(response(["sent"]));
    await page.submit();
    expect(page.lock.mock.calls.some(([locked]) => locked === true)).toBe(true);
    expect(page.lock).toHaveBeenLastCalledWith(false);
    expect(
      page.find((element) => element.type === "button" && element.props.type === "submit").props
        .disabled,
    ).toBe(true);
  });
  it("serializes sends and ignores acknowledgements after the request context unmounts", async () => {
    let resolve!: (value: BoardInvitationBatchResponse) => void;
    mocked.send.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const page = harness();
    page.change("textarea", "first@example.test");
    await page.submit();
    await page.submit();
    expect(mocked.send).toHaveBeenCalledTimes(1);
    const signal = mocked.send.mock.calls[0]![2] as AbortSignal;
    page.close();
    expect(signal.aborted).toBe(true);
    resolve(response(["sent"]));
    for (let count = 0; count < 8; count++) await Promise.resolve();
    expect(page.refresh).not.toHaveBeenCalled();
  });
  it("aborts a pending email batch immediately when authorization changes", async () => {
    let resolve!: (value: BoardInvitationBatchResponse) => void;
    mocked.send.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const page = harness();
    page.change("textarea", "first@example.test");
    await page.submit();
    const signal = mocked.send.mock.calls[0]![2] as AbortSignal;
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    expect(signal.aborted).toBe(true);
    resolve(response(["sent"]));
    for (let count = 0; count < 8; count++) await Promise.resolve();
    expect(page.refresh).not.toHaveBeenCalled();
  });
  it("shows guest participation and forwarding boundaries with no editing-role controls", () => {
    const html = renderToStaticMarkup(
      <BoardEmailInvitations target={{ kind: "guests", id: canvasId }} />,
    );
    expect(html).toContain(canvasSharingEnglishMessages.guestHelp);
    expect(html).toContain(canvasSharingEnglishMessages.guestWarning);
    expect(html).toContain(canvasSharingEnglishMessages.guestEmails);
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Revoke");
  });
  it("uses a fresh resource boundary and removes sharing after access is lost", () => {
    const props = { board: canvasBoard, onClose: vi.fn(), onRefresh: vi.fn() };
    const first = CanvasShareDialog(props)!;
    expect(
      CanvasShareDialog({
        ...props,
        board: { ...canvasBoard, id: "00000000-0000-4000-8000-000000000011" },
      })!.key,
    ).not.toBe(first.key);
    expect(BoardEmailInvitations({ target: { kind: "guests", id: canvasId } }).key).not.toBe(
      BoardEmailInvitations({ target: { kind: "collaborators", id: canvasId } }).key,
    );
    expect(
      CanvasShareDialog({
        ...props,
        board: { ...canvasBoard, capabilities: { ...canvasBoard.capabilities, share: false } },
      }),
    ).toBeNull();
  });
  it("renders the full-screen share dialog without any WorkspaceProvider", () => {
    const html = renderToStaticMarkup(
      <CanvasShareDialog
        board={canvasBoard}
        onClose={() => undefined}
        onRefresh={() => undefined}
      />,
    );
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain(canvasSharingEnglishMessages.collaborators);
    expect(html).toContain(
      renderToStaticMarkup(<span>{canvasSharingEnglishMessages.emails}</span>),
    );
  });
  it("uses an origin 404 to hide Groups while retaining collaborator invitations", async () => {
    mocked.readSharing.mockRejectedValue(new ApiClientError("Unavailable", "NOT_FOUND", 404));
    const page = sharingHarness();
    expect(mocked.readSharing).toHaveBeenCalledExactlyOnceWith(
      canvasBoard.id,
      expect.any(AbortSignal),
    );
    for (let count = 0; count < 8; count++) await Promise.resolve();
    const html = page.render();
    expect(html).not.toContain(canvasSharingEnglishMessages.groups);
    expect(html).not.toContain(canvasSharingEnglishMessages.loadFailed);
    expect(html).toContain(
      renderToStaticMarkup(<span>{canvasSharingEnglishMessages.emails}</span>),
    );
    expect(html).toContain(canvasSharingEnglishMessages.send);
  });
  it("isolates an origin 503 as a retryable group error without blocking collaborator invitations", async () => {
    mocked.readSharing.mockRejectedValue(new ApiClientError("Unavailable", "UNAVAILABLE", 503));
    const page = sharingHarness();
    for (let count = 0; count < 8; count++) await Promise.resolve();
    const html = page.render();
    expect(mocked.readSharing).toHaveBeenCalledExactlyOnceWith(
      canvasBoard.id,
      expect.any(AbortSignal),
    );
    expect(html).toContain(canvasSharingEnglishMessages.groups);
    expect(html).toContain(canvasSharingEnglishMessages.loadFailed);
    expect(html).toContain(
      renderToStaticMarkup(<span>{canvasSharingEnglishMessages.emails}</span>),
    );
    expect(
      page.find(
        (element) =>
          element.type === "button" &&
          element.props.role === "tab" &&
          text(element) === canvasSharingEnglishMessages.collaborators,
      ).props.disabled,
    ).toBe(false);
  });
  it("aborts origin reads and closes the dialog on an authorization-context change", async () => {
    let resolve!: (value: { groups: unknown[]; availableGroups: unknown[] }) => void;
    mocked.readSharing.mockImplementation(
      (_id, signal: AbortSignal) =>
        new Promise((done) => {
          expect(signal.aborted).toBe(false);
          resolve = done;
        }),
    );
    const page = sharingHarness();
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    expect(page.onClose).toHaveBeenCalledOnce();
    expect((mocked.readSharing.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
    resolve({ groups: [], availableGroups: [] });
    for (let count = 0; count < 8; count++) await Promise.resolve();
    expect(page.render()).not.toContain(canvasSharingEnglishMessages.groups);
  });
  it("refreshes group access on tab entry and live board changes without looping or replacing selected controls", async () => {
    const availableGroups = [{ id: canvasId, name: "Synthetic facilitators", memberCount: 2 }];
    const group = {
      groupId: canvasId,
      name: "Synthetic facilitators",
      memberCount: 2,
      role: "viewer",
      createdAt: "2026-11-01T00:00:00.000Z",
    };
    let resolve!: (value: { groups: unknown[]; availableGroups: typeof availableGroups }) => void;
    mocked.readSharing
      .mockResolvedValueOnce({ groups: [group], availableGroups })
      .mockResolvedValueOnce({ groups: [{ ...group, role: "editor" }], availableGroups })
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
    const page = sharingHarness();
    for (let count = 0; count < 8; count++) await Promise.resolve();
    page.render();
    expect(mocked.readSharing).toHaveBeenCalledTimes(1);
    const tab = page.find(
      (element) =>
        element.props.role === "tab" && text(element) === canvasSharingEnglishMessages.groups,
    );
    (tab.props.onClick as () => void)();
    page.render();
    for (let count = 0; count < 8; count++) await Promise.resolve();
    page.render();
    expect(mocked.readSharing).toHaveBeenCalledTimes(2);
    expect(page.rows().map(text).join(" ")).toContain("Canvas editor");
    const checkbox = page.find(
      (element) => element.type === "input" && element.props.type === "checkbox",
    );
    (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({
      target: { checked: true },
    });
    page.render();
    page.render({ ...canvasBoard, canvasSeq: canvasBoard.canvasSeq + 1 });
    expect(mocked.readSharing).toHaveBeenCalledTimes(3);
    page.render();
    expect(
      page.find((element) => element.type === "input" && element.props.type === "checkbox").props
        .checked,
    ).toBe(true);
    resolve({ groups: [], availableGroups });
    for (let count = 0; count < 8; count++) await Promise.resolve();
    page.render();
    page.render();
    expect(page.rows()).toEqual([]);
    expect(mocked.readSharing).toHaveBeenCalledTimes(3);
  });
  it.each(supportedLocales)("provides every sharing message in %s", (locale) => {
    const copy = canvasSharingMessages(locale);
    expect(Object.keys(copy)).toEqual(Object.keys(canvasSharingEnglishMessages));
    expect(Object.values(copy).every((value) => typeof value === "string" && value.trim())).toBe(
      true,
    );
    expect(copy.selected).toContain("{count}");
  });
});
