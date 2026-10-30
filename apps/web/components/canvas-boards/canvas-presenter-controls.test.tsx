import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CanvasGuestPresenterViewSchema,
  CanvasObjectSchema,
  CanvasPresenterViewSchema,
  type CanvasPresenterMutation,
} from "@openround/contracts";
import { AUTH_CHANGE_EVENT } from "../../lib/api";
import { CanvasPresenterControls } from "./canvas-presenter-controls";
import type { useCanvasPresenter } from "./use-canvas-presenter";
import { canvasBoard, canvasId, canvasObject } from "./canvas-test-fixtures";

interface EffectSlot {
  effect: true;
  dependencies?: readonly unknown[];
  cleanup?: () => void;
}
interface Hooks {
  cursor: number;
  slots: unknown[];
  pending: Array<() => void>;
  dirty: boolean;
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  state: null as unknown as ReturnType<typeof useCanvasPresenter>,
  read: vi.fn(),
  command: vi.fn(),
  uuid: vi.fn(),
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (!mocked.hooks) return react.useState(initial);
      const hooks = mocked.hooks,
        index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = {
          value: typeof initial === "function" ? (initial as () => T)() : initial,
        };
      const slot = hooks.slots[index] as { value: T };
      return [
        slot.value,
        (value: T | ((previous: T) => T)) => {
          const next =
            typeof value === "function" ? (value as (previous: T) => T)(slot.value) : value;
          if (!Object.is(slot.value, next)) {
            slot.value = next;
            hooks.dirty = true;
          }
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      if (!mocked.hooks) return react.useRef(initial);
      const hooks = mocked.hooks,
        index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      if (!mocked.hooks) return react.useEffect(effect, dependencies);
      const hooks = mocked.hooks,
        index = hooks.cursor++;
      const previous = hooks.slots[index] as EffectSlot | undefined;
      if (
        !previous ||
        !dependencies ||
        !previous.dependencies ||
        dependencies.length !== previous.dependencies.length ||
        dependencies.some((item, i) => !Object.is(item, previous.dependencies![i]))
      ) {
        hooks.pending.push(() => {
          previous?.cleanup?.();
          const cleanup = effect();
          hooks.slots[index] = {
            effect: true,
            dependencies: dependencies ? [...dependencies] : undefined,
            cleanup: typeof cleanup === "function" ? cleanup : undefined,
          } satisfies EffectSlot;
        });
      }
    },
  };
});
vi.mock("./use-canvas-presenter", () => ({
  useCanvasPresenter: (...args: unknown[]) => {
    mocked.read(...args);
    return mocked.state;
  },
}));
vi.mock("../../lib/uuid", () => ({ clientUuid: mocked.uuid }));
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));

const remoteSession = "00000000-0000-4000-8000-000000000201";
const nextSession = "00000000-0000-4000-8000-000000000202";
const sourceId = "00000000-0000-4000-8000-000000000203";
const teamRegion = { x: 20, y: 30, width: 800, height: 600 };
const privateRegion = { x: 5000, y: 7000, width: 400, height: 300 };
function presenter(overrides: Record<string, unknown> = {}) {
  return CanvasPresenterViewSchema.parse({
    schemaVersion: 1,
    boardId: canvasId,
    serverNow: "2026-10-01T00:00:00.000Z",
    revision: 1,
    active: true,
    sessionId: remoteSession,
    presenterId: canvasBoard.ownerUserId,
    audience: "team",
    frameId: null,
    viewport: teamRegion,
    expiresAt: "2026-10-01T00:00:15.000Z",
    ...overrides,
  });
}
function inactive() {
  return presenter({
    active: false,
    revision: 0,
    sessionId: null,
    presenterId: null,
    viewport: null,
    expiresAt: null,
  });
}
function find(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return predicate(node) ? node : find(node.props.children as ReactNode, predicate);
}
const mounted: Array<{ unmount: () => void }> = [];
function harness(initial: Partial<Parameters<typeof CanvasPresenterControls>[0]> = {}) {
  const hooks: Hooks = { cursor: 0, slots: [], pending: [], dirty: false };
  const onFollow = vi.fn();
  let props: Parameters<typeof CanvasPresenterControls>[0] = {
    boardId: canvasId,
    objects: [],
    canPresent: true,
    viewportRegion: teamRegion,
    onFollow,
    ...initial,
  };
  let tree: ReactNode;
  let identity: string | null = null;
  function cleanup() {
    for (const slot of hooks.slots)
      if (slot && typeof slot === "object" && "effect" in slot) (slot as EffectSlot).cleanup?.();
    hooks.slots = [];
    hooks.pending = [];
  }
  const view = {
    onFollow,
    render(next: Partial<typeof props> = {}) {
      props = { ...props, ...next };
      let passes = 0;
      do {
        hooks.cursor = 0;
        hooks.pending = [];
        hooks.dirty = false;
        mocked.hooks = hooks;
        try {
          const root = CanvasPresenterControls(props);
          if (identity !== root.key) {
            cleanup();
            identity = root.key;
          }
          tree = (root.type as (properties: unknown) => ReactNode)(root.props);
        } finally {
          mocked.hooks = null;
        }
        for (const effect of hooks.pending) effect();
        if (++passes > 20) throw new Error("Presenter effect did not settle");
      } while (hooks.dirty);
      return renderToStaticMarkup(tree);
    },
    button(label: string) {
      const button = find(
        tree,
        (element) => element.type === "button" && element.props.children === label,
      );
      if (!button) throw new Error(`Missing button ${label}`);
      return button.props;
    },
    click(label: string) {
      const button = view.button(label);
      if (button.disabled) throw new Error(`Disabled button ${label}`);
      (button.onClick as () => void)();
      return view.render();
    },
    event(name: string, key?: string) {
      const event = new Event(name);
      if (key) Object.assign(event, { key });
      window.dispatchEvent(event);
      return view.render();
    },
    unmount: cleanup,
  };
  mounted.push(view);
  return view;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  let sequence = 600;
  mocked.uuid.mockImplementation(
    () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  );
  mocked.command.mockResolvedValue(true);
  mocked.state = {
    view: presenter(),
    error: false,
    working: false,
    command: mocked.command,
    refresh: vi.fn(),
  };
});
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
  mocked.hooks = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("explicit local-tab presentation ownership and optional following", () => {
  it.each([canvasBoard.ownerUserId, "00000000-0000-4000-8000-000000000299"])(
    "does not adopt or heartbeat an existing presenter session for creator %s",
    async (presenterId) => {
      mocked.state.view = presenter({ presenterId });
      const view = harness();
      const html = view.render();
      expect(html).toContain("A presenter is sharing a view");
      expect(html).not.toContain("You are presenting");
      expect(view.button("Follow presenter")["aria-pressed"]).toBe(false);
      expect(view.onFollow.mock.calls.every(([region]) => region === null)).toBe(true);
      await vi.advanceTimersByTimeAsync(6000);
      expect(mocked.command).not.toHaveBeenCalled();
    },
  );

  it("starts ownership only through an explicit local action and heartbeats only its acknowledged lease using the latest region", async () => {
    mocked.state.view = inactive();
    const view = harness();
    view.render();
    view.click("Present my view");
    const start = mocked.command.mock.calls[0]![0] as CanvasPresenterMutation;
    expect(start).toMatchObject({
      schemaVersion: 1,
      expectedRevision: 0,
      command: { type: "start", audience: "team", frameId: null, viewport: teamRegion },
    });
    expect(start.operationId).toBe(start.sessionId);
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocked.command).toHaveBeenCalledOnce();
    mocked.state.view = presenter({ sessionId: start.sessionId });
    expect(view.render()).toContain("You are presenting");
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocked.command.mock.calls[1]![0]).toMatchObject({
      expectedRevision: 1,
      sessionId: start.sessionId,
      command: { type: "update", audience: "team", frameId: null, viewport: teamRegion },
    });
    mocked.state.view = presenter({ sessionId: start.sessionId, revision: 2 });
    view.render({ viewportRegion: privateRegion });
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocked.command.mock.calls[2]![0]).toMatchObject({
      expectedRevision: 2,
      sessionId: start.sessionId,
      command: { type: "update", viewport: privateRegion },
    });
    mocked.state.view = presenter({ sessionId: nextSession, revision: 3 });
    expect(view.render()).not.toContain("You are presenting");
    const sent = mocked.command.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocked.command).toHaveBeenCalledTimes(sent);
    expect(view.button("Follow presenter")["aria-pressed"]).toBe(false);
  });

  it("clears local ownership and following on auth change without sending a command under the new auth context", async () => {
    mocked.state.view = inactive();
    const view = harness();
    view.render();
    view.click("Present my view");
    const start = mocked.command.mock.calls[0]![0] as CanvasPresenterMutation;
    mocked.state.view = presenter({ sessionId: start.sessionId });
    expect(view.render()).toContain("You are presenting");
    expect(view.event(AUTH_CHANGE_EVENT)).not.toContain("You are presenting");
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocked.command).toHaveBeenCalledOnce();
    view.click("Follow presenter");
    expect(view.onFollow).toHaveBeenLastCalledWith(teamRegion);
    view.event(AUTH_CHANGE_EVENT);
    expect(view.button("Follow presenter")["aria-pressed"]).toBe(false);
    expect(view.onFollow).toHaveBeenLastCalledWith(null);
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocked.command).toHaveBeenCalledOnce();
  });

  it("publishes and refreshes only selected frame cues without a private viewport and stops heartbeat after role loss", async () => {
    mocked.state.view = inactive();
    const first = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "frame",
      visibility: "published",
    });
    const second = { ...first, id: sourceId, x: 800 };
    const view = harness({
      sourceBoardId: sourceId,
      objects: [first, second],
      publishedFrameId: first.id,
      viewportRegion: privateRegion,
    });
    view.render();
    view.click("Present selected frame to guests");
    const start = mocked.command.mock.calls[0]![0] as CanvasPresenterMutation;
    expect(start.command).toEqual({
      type: "start",
      audience: "published",
      frameId: first.id,
      viewport: null,
    });
    mocked.state.view = presenter({
      sessionId: start.sessionId,
      audience: "published",
      frameId: first.id,
      viewport: null,
    });
    view.render({ publishedFrameId: second.id });
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocked.command.mock.calls[1]![0]).toMatchObject({
      sessionId: start.sessionId,
      command: { type: "update", audience: "published", frameId: second.id, viewport: null },
    });
    view.render({ canPresent: false });
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocked.command).toHaveBeenCalledTimes(2);
  });

  it("requires an explicit follow opt-in, follows current updates, and exits on manual navigation, Escape, or a different lease", () => {
    const view = harness({ canPresent: false });
    view.render();
    expect(view.onFollow.mock.calls.every(([region]) => region === null)).toBe(true);
    view.click("Follow presenter");
    expect(view.onFollow).toHaveBeenLastCalledWith(teamRegion);
    expect(view.button("Stop following")["aria-pressed"]).toBe(true);
    mocked.state.view = presenter({ viewport: privateRegion, revision: 2 });
    view.render();
    expect(view.onFollow).toHaveBeenLastCalledWith(privateRegion);
    view.render({ cancelKey: 1 });
    expect(view.onFollow).toHaveBeenLastCalledWith(null);
    expect(view.button("Follow presenter")["aria-pressed"]).toBe(false);
    view.click("Follow presenter");
    view.event("keydown", "ArrowRight");
    expect(view.button("Stop following")["aria-pressed"]).toBe(true);
    view.event("keydown", "Escape");
    expect(view.onFollow).toHaveBeenLastCalledWith(null);
    expect(view.button("Follow presenter")["aria-pressed"]).toBe(false);
    view.click("Follow presenter");
    mocked.state.view = presenter({ sessionId: nextSession });
    view.render();
    expect(view.onFollow).toHaveBeenLastCalledWith(null);
    expect(view.button("Follow presenter")["aria-pressed"]).toBe(false);
    expect(mocked.command).not.toHaveBeenCalled();
  });

  it("never offers guest broadcast commands or uses a private local viewport when following a published frame", async () => {
    const frame = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "frame",
      visibility: "published",
      rotation: 90,
    });
    const { presenterId: _presenterId, ...published } = presenter({
      audience: "published",
      frameId: frame.id,
      viewport: null,
    });
    void _presenterId;
    mocked.state.view = CanvasGuestPresenterViewSchema.parse(published);
    const guest = { sourceBoardId: sourceId, token: "a".repeat(64) };
    const view = harness({
      canPresent: true,
      guestToken: guest.token,
      sourceBoardId: guest.sourceBoardId,
      viewportRegion: privateRegion,
      objects: [frame],
      publishedFrameId: frame.id,
    });
    const html = view.render();
    expect(mocked.read).toHaveBeenLastCalledWith(canvasId, guest);
    for (const label of ["Present my view", "Present selected frame to guests", "Stop presenting"])
      expect(html).not.toContain(`>${label}</button>`);
    view.click("Follow presenter");
    const followed = view.onFollow.mock.calls.at(-1)![0];
    expect(followed.x).toBeCloseTo(40);
    expect(followed.y).toBeCloseTo(10);
    expect(followed.width).toBeCloseTo(160);
    expect(followed.height).toBeCloseTo(200);
    expect(view.onFollow).not.toHaveBeenCalledWith(privateRegion);
    await vi.advanceTimersByTimeAsync(6000);
    expect(mocked.command).not.toHaveBeenCalled();
  });

  it("disables guest follow when the published target is absent instead of substituting local viewport data", () => {
    const { presenterId: _presenterId, ...published } = presenter({
      audience: "published",
      frameId: canvasObject.id,
      viewport: null,
    });
    void _presenterId;
    mocked.state.view = CanvasGuestPresenterViewSchema.parse(published);
    const view = harness({
      guestToken: "a".repeat(64),
      sourceBoardId: sourceId,
      viewportRegion: privateRegion,
      objects: [],
    });
    view.render();
    expect(view.button("Follow presenter").disabled).toBe(true);
    expect(view.onFollow.mock.calls.every(([region]) => region === null)).toBe(true);
    expect(mocked.command).not.toHaveBeenCalled();
  });

  it("cleans up an explicitly owned heartbeat and follow state when unmounted", async () => {
    mocked.state.view = inactive();
    const view = harness();
    view.render();
    view.click("Present my view");
    const start = mocked.command.mock.calls[0]![0] as CanvasPresenterMutation;
    mocked.state.view = presenter({ sessionId: start.sessionId });
    view.render();
    view.unmount();
    expect(view.onFollow).toHaveBeenLastCalledWith(null);
    await vi.advanceTimersByTimeAsync(6000);
    expect(mocked.command).toHaveBeenCalledOnce();
  });
});
