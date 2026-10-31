import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { CanvasDraftRecovery } from "./canvas-draft-recovery";
import { canvasObjectDraft } from "./canvas-draft";
import { canvasObject } from "./canvas-test-fixtures";
interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: ReactModule.EffectCallback[];
}
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null }));
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
        hooks.slots[index],
        (value: T | ((old: T) => T)) => {
          hooks.slots[index] =
            typeof value === "function" ? (value as (old: T) => T)(hooks.slots[index] as T) : value;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      if (!mocked.hooks) return react.useRef(initial);
      const hooks = mocked.hooks;
      const index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useEffect: (effect: ReactModule.EffectCallback) => {
      if (mocked.hooks) mocked.hooks.effects.push(effect);
      else react.useEffect(effect);
    },
  };
});
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: keyof typeof english) => english[key] ?? key }),
}));
const draft = { ...canvasObjectDraft(canvasObject), text: "共同で計画する — 내 로컬 초안" };
function harness(onDiscard: () => void) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  let tree: ReactNode;
  const cleanup: Array<() => void> = [];
  return {
    render() {
      hooks.cursor = 0;
      hooks.effects = [];
      mocked.hooks = hooks;
      try {
        tree = CanvasDraftRecovery({ draft, reason: "missing", onDiscard });
      } finally {
        mocked.hooks = null;
      }
      return renderToStaticMarkup(tree);
    },
    mount() {
      hooks.effects.forEach((effect) => {
        const result = effect();
        if (result) cleanup.push(result);
      });
    },
    find(predicate: (element: ReactElement<Record<string, unknown>>) => boolean) {
      function visit(node: ReactNode): ReactElement<Record<string, unknown>> | undefined {
        if (Array.isArray(node)) {
          for (const child of node) {
            const found = visit(child);
            if (found) return found;
          }
          return;
        }
        if (!isValidElement<Record<string, unknown>>(node)) return;
        return predicate(node) ? node : visit(node.props.children as ReactNode);
      }
      const found = visit(tree);
      if (!found) throw new Error("Control missing");
      return found;
    },
    unmount() {
      cleanup.forEach((effect) => effect());
    },
  };
}
async function settle() {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}
beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  mocked.hooks = null;
  vi.unstubAllGlobals();
});
describe("removed canvas target recovery UI", () => {
  it("keeps manual connector settings recoverable without exposing opaque endpoint IDs", () => {
    const proposal = {
      ...draft,
      text: "",
      routing: "elbow" as const,
      lineStyle: "dashed" as const,
      startMarker: "arrow" as const,
      endMarker: "none" as const,
      lineColor: "blue" as const,
      fromId: "private-object-id",
      fromAnchor: "right" as const,
      fromX: 20.5,
      fromY: 40.25,
      toId: "",
      toX: 200,
      toY: 300,
    };
    const html = renderToStaticMarkup(
      <CanvasDraftRecovery draft={proposal} reason="missing" onDiscard={() => undefined} />,
    );
    expect(html).toContain("Route: Elbow");
    expect(html).toContain("Line style: Dashed");
    expect(html).toContain("Start marker: Arrow");
    expect(html).toContain("Source port: Right");
    expect(html).toContain("20.5");
    expect(html).not.toContain("private-object-id");
    expect(html).toContain("Copy draft text");
  });
  it("retains selectable local text and shows no save or recreate action", () => {
    const html = renderToStaticMarkup(
      <CanvasDraftRecovery draft={draft} reason="missing" onDiscard={() => undefined} />,
    );
    expect(html).toContain("Object no longer available");
    expect(html).toContain(draft.text);
    expect(html).toMatch(/readonly=""/i);
    expect(html).toContain("Copy draft text");
    expect(html).toContain("Discard my draft");
    expect(html).not.toContain("Save changes");
    expect(html).not.toContain("Apply reviewed change");
  });
  it("selects the retained text for manual copying when clipboard access is denied", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Permission denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const onDiscard = vi.fn();
    const view = harness(onDiscard);
    view.render();
    view.mount();
    const focus = vi.fn(),
      select = vi.fn();
    (
      view.find((element) => element.type === "textarea").props.ref as { current: unknown }
    ).current = { focus, select };
    (
      view.find(
        (element) => element.type === "button" && element.props.children === "Copy draft text",
      ).props.onClick as () => void
    )();
    await settle();
    expect(writeText).toHaveBeenCalledWith(draft.text);
    expect(focus).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledOnce();
    expect(view.render()).toContain("copy it manually");
    expect(onDiscard).not.toHaveBeenCalled();
    view.unmount();
  });
  it("copies only the local text and discards only after the explicit button action", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const onDiscard = vi.fn();
    const view = harness(onDiscard);
    view.render();
    view.mount();
    (
      view.find(
        (element) => element.type === "button" && element.props.children === "Copy draft text",
      ).props.onClick as () => void
    )();
    await settle();
    expect(writeText).toHaveBeenCalledWith(draft.text);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(view.render()).toContain("Draft text copied.");
    (
      view.find(
        (element) => element.type === "button" && element.props.children === "Discard my draft",
      ).props.onClick as () => void
    )();
    expect(onDiscard).toHaveBeenCalledOnce();
    view.unmount();
  });
});
