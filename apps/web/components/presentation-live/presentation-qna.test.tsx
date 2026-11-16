import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationAudienceAvailability } from "@openround/contracts";
import { englishMessages, translate, type MessageKey } from "../../lib/i18n/catalog";
import { liveDeliveryEnglishMessages } from "../../lib/i18n/domains/live-delivery";
import { PresentationQnaPanel } from "./presentation-qna";

type Hooks = { cursor: number; slots: unknown[]; effects: (() => void)[] };
const fixture = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  availability: vi.fn(),
  activate: vi.fn(),
  command: vi.fn(),
  subscribe: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  function memo<T>(factory: () => T, deps: ReactModule.DependencyList) {
    const hooks = fixture.hooks!;
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as
      { deps: ReactModule.DependencyList; value: T } | undefined;
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i])))
      hooks.slots[index] = { deps, value: factory() };
    return (hooks.slots[index] as { value: T }).value;
  }
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixture.hooks!;
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
    useRef: <T,>(initial: T) => memo(() => ({ current: initial }), []),
    useMemo: memo,
    useCallback: <T,>(callback: T, deps: ReactModule.DependencyList) => memo(() => callback, deps),
    useEffect: (effect: () => void | (() => void), deps: ReactModule.DependencyList) => {
      const hooks = fixture.hooks!;
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as
        { deps: ReactModule.DependencyList; cleanup?: () => void } | undefined;
      if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
      const slot = { deps, cleanup: undefined as (() => void) | undefined };
      hooks.slots[index] = slot;
      hooks.effects.push(() => {
        previous?.cleanup?.();
        slot.cleanup = effect() || undefined;
      });
    },
  };
});
vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    locale: "en-CA",
    t: (key: MessageKey, values?: Record<string, string | number>) =>
      translate({ ...englishMessages, ...liveDeliveryEnglishMessages }, key, values),
  }),
}));
vi.mock("../../lib/presentation-qna", () => ({
  createPresentationQnaClient: () => ({
    availability: fixture.availability,
    activate: fixture.activate,
    command: fixture.command,
  }),
}));
vi.mock("../../lib/scoped-audience-realtime", () => ({
  createScopedAudienceSubscription: fixture.subscribe,
}));
vi.mock("../qna-panel", () => ({
  QnaPanel: ({ role, scopeKind }: { role: string; scopeKind: string }) => (
    <section className="qna-panel" data-qna-role={role} data-scope-kind={scopeKind} />
  ),
}));

const active: PresentationAudienceAvailability = {
  schemaVersion: 1,
  available: true,
  activated: true,
  canActivate: false,
};
const props = {
  sessionId: "room",
  token: "PRIVATE PASS",
  role: "participant",
  closed: false,
} as const;

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function harness(overrides: Partial<ComponentProps<typeof PresentationQnaPanel>> = {}) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  const render = () => {
    hooks.cursor = 0;
    fixture.hooks = hooks;
    try {
      return PresentationQnaPanel({ ...props, ...overrides });
    } finally {
      fixture.hooks = null;
    }
  };
  const flush = async () => {
    for (const effect of hooks.effects.splice(0)) effect();
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  return {
    render,
    update(next: Partial<ComponentProps<typeof PresentationQnaPanel>>) {
      Object.assign(overrides, next);
    },
    async mount() {
      render();
      await flush();
      render();
      await flush();
      return render();
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.availability.mockResolvedValue(active);
  fixture.activate.mockResolvedValue({});
  fixture.subscribe.mockReturnValue({ stop: fixture.stop, needsPolling: () => false });
  vi.stubGlobal("window", {
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
    setTimeout: vi.fn(() => 2),
    clearTimeout: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Presentation Q&A layouts", () => {
  it("keeps the default panel closed and starts reading questions only after opening", async () => {
    const view = harness();
    const tree = await view.mount();
    const markup = renderToStaticMarkup(tree);
    expect(markup).toContain("<details><summary");
    expect(markup).not.toContain('class="qna-panel"');
    expect(fixture.subscribe).not.toHaveBeenCalled();
    const disclosure = elements(tree).find((element) => element.type === "details")!;
    (disclosure.props.onToggle as (event: { currentTarget: { open: boolean } }) => void)({
      currentTarget: { open: true },
    });
    expect(renderToStaticMarkup(view.render())).toContain('data-qna-role="participant"');
    (disclosure.props.onToggle as (event: { currentTarget: { open: boolean } }) => void)({
      currentTarget: { open: false },
    });
    expect(renderToStaticMarkup(view.render())).toContain('data-qna-role="participant"');
    expect(fixture.activate).not.toHaveBeenCalled();
  });

  it.each([
    ["participant", "participant"],
    ["host", "moderator"],
    ["companion", "observer"],
  ] as const)(
    "opens the %s sidebar directly with %s permissions and read-only discovery",
    async (role, qnaRole) => {
      const tree = await harness({ role, layout: "sidebar" }).mount();
      const markup = renderToStaticMarkup(tree);
      expect(markup).toContain('data-presentation-qna-layout="sidebar"');
      expect(markup).toContain(`data-qna-role="${qnaRole}"`);
      expect(markup).toContain('data-scope-kind="presentation"');
      expect(markup).not.toContain("<details");
      expect(markup).not.toContain("PRIVATE PASS");
      expect(fixture.availability).toHaveBeenCalledTimes(1);
      expect(fixture.subscribe).toHaveBeenCalledTimes(1);
      expect(fixture.activate).not.toHaveBeenCalled();
      expect(fixture.command).not.toHaveBeenCalled();
      if (role === "companion") expect(markup).toContain("Companion Q&amp;A is read-only.");
    },
  );

  it("keeps inactive participant Q&A waiting without activating a scope", async () => {
    fixture.availability.mockResolvedValue({ ...active, activated: false });
    const markup = renderToStaticMarkup(await harness({ layout: "sidebar" }).mount());
    expect(markup).toContain("Audience Q&amp;A will appear when the facilitator activates it.");
    expect(markup).not.toContain('class="qna-panel"');
    expect(markup).not.toContain("Activate audience Q&amp;A");
    expect(fixture.activate).not.toHaveBeenCalled();
    expect(fixture.command).not.toHaveBeenCalled();
    expect(fixture.subscribe).not.toHaveBeenCalled();
  });

  it("removes question access when the sidebar subscription denies the room pass", async () => {
    const view = harness({ layout: "sidebar" });
    await view.mount();
    const subscription = fixture.subscribe.mock.calls[0]![0] as { onAccessDenied: () => void };
    subscription.onAccessDenied();
    const markup = renderToStaticMarkup(view.render());
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Q&amp;A access has expired.");
    expect(markup).not.toContain('class="qna-panel"');
    expect(fixture.activate).not.toHaveBeenCalled();
  });

  it("reports unavailable, available and denied access while keeping errors reachable", async () => {
    const onAvailabilityChange = vi.fn();
    fixture.availability.mockResolvedValue({ ...active, available: false, activated: false });
    const view = harness({ layout: "sidebar", onAvailabilityChange });
    expect(await view.mount()).toBeNull();
    expect(onAvailabilityChange.mock.calls).toEqual([[false], [false]]);

    fixture.availability.mockResolvedValue(active);
    view.update({ token: "replacement-pass" });
    expect(renderToStaticMarkup(await view.mount())).toContain('class="qna-panel"');
    expect(onAvailabilityChange).toHaveBeenLastCalledWith(true);

    const subscription = fixture.subscribe.mock.calls[0]![0] as { onAccessDenied: () => void };
    subscription.onAccessDenied();
    expect(renderToStaticMarkup(await view.mount())).toContain('role="alert"');
    expect(onAvailabilityChange.mock.calls.slice(-2)).toEqual([[true], [true]]);
    expect(fixture.activate).not.toHaveBeenCalled();
    expect(fixture.command).not.toHaveBeenCalled();
  });

  it("reports unavailable while a replacement room pass is being checked", async () => {
    const onAvailabilityChange = vi.fn();
    const view = harness({ layout: "sidebar", onAvailabilityChange });
    await view.mount();
    expect(onAvailabilityChange).toHaveBeenLastCalledWith(true);

    fixture.availability.mockReturnValue(new Promise(() => undefined));
    view.update({ token: "replacement-pass" });
    expect(await view.mount()).toBeNull();
    expect(onAvailabilityChange).toHaveBeenLastCalledWith(false);
    expect(fixture.activate).not.toHaveBeenCalled();
    expect(fixture.command).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "requires explicit facilitator activation and preserves closed=%s",
    async (closed) => {
      fixture.availability.mockResolvedValue({ ...active, activated: false, canActivate: true });
      const view = harness({ role: "host", layout: "sidebar", closed });
      const tree = await view.mount();
      const activate = elements(tree).find((element) => element.props.className === "button")!;
      expect(activate.props.disabled).toBe(closed);
      expect(fixture.activate).not.toHaveBeenCalled();
      if (!closed) {
        await (activate.props.onClick as () => Promise<void>)();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(fixture.activate).toHaveBeenCalledTimes(1);
        expect(renderToStaticMarkup(view.render())).toContain('data-qna-role="moderator"');
      }
    },
  );
});
