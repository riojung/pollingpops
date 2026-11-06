import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPresentationShareIntent,
  presentationShareIntent,
  savePresentationShareIntent,
} from "../../lib/presentation-sharing-client";
import type * as ShareClient from "../../lib/presentation-sharing-client";
import { ApiClientError } from "../../lib/api";
import { PresentationShareDialog } from "./share-dialog";
import { PresentationFeedbackPanel } from "./feedback-panel";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: ReactModule.EffectCallback[];
  mounted: boolean;
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  create: vi.fn(),
  list: vi.fn(),
  revoke: vi.fn(),
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
  useEffect: (effect: ReactModule.EffectCallback) => {
    if (!mocked.hooks!.mounted) mocked.hooks!.effects.push(effect);
  },
}));
vi.mock("../../lib/presentation-sharing-client", async (original) => ({
  ...(await original<typeof ShareClient>()),
  createPresentationShare: mocked.create,
  listPresentationShares: mocked.list,
  revokePresentationShare: mocked.revoke,
}));

const presentationId = "00000000-0000-4000-8000-000000000001";
const oldVersion = "00000000-0000-4000-8000-000000000002";
const currentVersion = "00000000-0000-4000-8000-000000000003";
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
function mount() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [], mounted: false };
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      return elements(
        PresentationShareDialog({ presentationId, versionId: currentVersion, onClose: vi.fn() }),
      );
    } finally {
      mocked.hooks = null;
    }
  }
  render();
  hooks.mounted = true;
  const cleanups = hooks.effects.map((effect) => effect());
  return {
    render,
    expiry: () => render().find((element) => element.type === "select")!,
    click(label: string) {
      const button = render().find(
        (element) =>
          element.type === "button" && text(element.props.children as ReactNode) === label,
      );
      expect(button).toBeDefined();
      (button!.props.onClick as () => void)();
    },
    close: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}
function setup() {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  mocked.create.mockReset();
  mocked.list.mockReset().mockResolvedValue([]);
  mocked.revoke.mockReset();
}
afterEach(() => {
  vi.unstubAllGlobals();
  mocked.hooks = null;
});

describe("private share creation recovery", () => {
  it("opens feedback for the link's pinned version even when a newer publication exists", async () => {
    setup();
    const shareId = "00000000-0000-4000-8000-000000000004";
    mocked.list.mockResolvedValueOnce([
      {
        id: shareId,
        versionId: oldVersion,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        revokedAt: null,
      },
    ]);
    const dialog = mount();
    await vi.waitFor(() =>
      expect(
        dialog
          .render()
          .some(
            (element) =>
              element.type === "button" &&
              text(element.props.children as ReactNode) === "Review feedback",
          ),
      ).toBe(true),
    );
    dialog.click("Review feedback");
    const feedback = dialog.render().find((element) => element.type === PresentationFeedbackPanel);
    expect(feedback?.props).toMatchObject({
      mode: "author",
      presentationId,
      shareId,
      versionId: oldVersion,
    });
    expect(mocked.create).not.toHaveBeenCalled();
    dialog.close();
  });
  it("restores an editable form after the server rejects an expired unaccepted intent", async () => {
    setup();
    const expired = {
      ...presentationShareIntent(oldVersion, 1),
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    };
    savePresentationShareIntent(presentationId, expired);
    mocked.create.mockRejectedValueOnce(
      new ApiClientError("Expired", "PRESENTATION_SHARE_REQUEST_EXPIRED", 410),
    );
    const first = mount();
    expect(first.expiry().props.disabled).toBe(true);
    first.click("Retry link creation");
    await vi.waitFor(() => expect(first.expiry().props.disabled).toBe(false));
    expect(mocked.create).toHaveBeenCalledExactlyOnceWith(presentationId, expired);
    expect(loadPresentationShareIntent(presentationId)).toBeNull();
    expect(
      first
        .render()
        .some(
          (element) =>
            element.props.role === "alert" &&
            text(element.props.children as ReactNode).includes("Choose an expiry"),
        ),
    ).toBe(true);
    first.close();

    const reopened = mount();
    expect(reopened.expiry().props.disabled).toBe(false);
    expect(mocked.create).toHaveBeenCalledTimes(1);
    (reopened.expiry().props.onChange as (event: unknown) => void)({ target: { value: "30" } });
    mocked.create.mockResolvedValueOnce({
      url: "https://example.test/review",
      share: {},
      replayed: false,
    });
    reopened.click("Create link");
    await vi.waitFor(() => expect(loadPresentationShareIntent(presentationId)).toBeNull());
    const fresh = mocked.create.mock.calls[1]![1] as ReturnType<typeof presentationShareIntent>;
    expect(fresh.requestId).not.toBe(expired.requestId);
    expect(fresh.token).not.toBe(expired.token);
    expect(fresh.versionId).toBe(currentVersion);
    expect(Date.parse(fresh.expiresAt)).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    reopened.close();
  });

  it.each([
    new TypeError("Lost acknowledgement"),
    new ApiClientError("Unavailable", "PRESENTATION_UNAVAILABLE", 404),
    new ApiClientError("Conflict", "PRESENTATION_UNAVAILABLE", 409),
    new ApiClientError("Unavailable", "PRESENTATION_UNAVAILABLE", 503),
  ])(
    "preserves the exact expired intent after an unconfirmed or unrelated failure: %s",
    async (failure) => {
      setup();
      const pending = {
        ...presentationShareIntent(oldVersion, 1),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      };
      savePresentationShareIntent(presentationId, pending);
      mocked.create.mockRejectedValueOnce(failure);
      const first = mount();
      first.click("Retry link creation");
      await vi.waitFor(() =>
        expect(first.render().some((element) => element.props.role === "alert")).toBe(true),
      );
      expect(first.expiry().props.disabled).toBe(true);
      expect(loadPresentationShareIntent(presentationId)).toEqual(pending);
      first.close();

      mocked.create.mockResolvedValueOnce({
        url: "https://example.test/original",
        share: {},
        replayed: true,
      });
      const reopened = mount();
      reopened.click("Retry link creation");
      await vi.waitFor(() => expect(loadPresentationShareIntent(presentationId)).toBeNull());
      expect(mocked.create.mock.calls.map((call) => call[1])).toEqual([pending, pending]);
      reopened.close();
    },
  );
});
