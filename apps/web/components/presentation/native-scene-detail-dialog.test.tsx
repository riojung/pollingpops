import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeSceneDetailDialog } from "./native-scene-detail-dialog";

const mocked = vi.hoisted(() => ({
  effects: [] as ReactModule.EffectCallback[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useId: () => "detail-title",
  useRef: <T,>(current: T) => ({ current }),
  useLayoutEffect: (effect: ReactModule.EffectCallback) => mocked.effects.push(effect),
}));

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

afterEach(() => {
  mocked.effects.length = 0;
  vi.unstubAllGlobals();
});

describe("native scene detail focus", () => {
  it.each(["Escape", "Close details"])(
    "returns focus to the actual trigger after %s when a touch click left the body focused",
    (action) => {
      const documentState = { activeElement: null as unknown };
      class FocusTarget {
        isConnected = true;
        disabled = false;
        focus = vi.fn(() => {
          documentState.activeElement = this;
        });
      }
      documentState.activeElement = new FocusTarget();
      vi.stubGlobal("document", documentState);
      vi.stubGlobal("HTMLElement", FocusTarget);
      const trigger = new FocusTarget();
      const dialog = { showModal: vi.fn(), close: vi.fn() };
      const closeButton = new FocusTarget();
      const onClose = vi.fn();
      const tree = NativeSceneDetailDialog({
        title: "Evidence details",
        body: "Audience evidence",
        returnFocusRef: { current: trigger as unknown as HTMLButtonElement },
        onClose,
      });
      const nodes = elements(tree);
      const dialogElement = nodes.find((element) => element.type === "dialog")!;
      const closeElement = nodes.find((element) => element.type === "button")!;
      (dialogElement.props.ref as ReactModule.RefObject<unknown>).current = dialog;
      (closeElement.props.ref as ReactModule.RefObject<unknown>).current = closeButton;
      const cleanup = mocked.effects[0]!();
      expect(dialog.showModal).toHaveBeenCalledOnce();
      expect(documentState.activeElement).toBe(closeButton);

      if (action === "Escape") {
        const event = { preventDefault: vi.fn() };
        (dialogElement.props.onCancel as (event: unknown) => void)(event);
        expect(event.preventDefault).toHaveBeenCalledOnce();
      } else {
        (closeElement.props.onClick as () => void)();
      }

      expect(onClose).toHaveBeenCalledOnce();
      cleanup?.();
      expect(dialog.close).toHaveBeenCalledOnce();
      expect(trigger.focus).toHaveBeenCalledOnce();
      expect(documentState.activeElement).toBe(trigger);
    },
  );
});
