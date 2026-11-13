import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TemplatesPage from "./page";

interface Hooks {
  cursor: number;
  slots: unknown[];
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  presentations: true,
  canEdit: true,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => {
      if (!mocked.hooks) return react.useState(initial);
      const hooks = mocked.hooks;
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (value: T) => {
          hooks.slots[index] = value;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      if (!mocked.hooks) return react.useRef(initial);
      const hooks = mocked.hooks;
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useEffect: (effect: ReactModule.EffectCallback, deps: ReactModule.DependencyList) => {
      if (!mocked.hooks) react.useEffect(effect, deps);
    },
  };
});
vi.mock("../../components/locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: string) => key }),
}));
vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    canEdit: mocked.canEdit,
    productFeatures: { presentations: mocked.presentations, surveys: true },
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
vi.mock("../../components/workspace/starter-gallery", () => ({
  StarterGallery: ({ survey }: { survey?: boolean }) => (
    <div>{survey ? "Survey content gallery" : "Round content gallery"}</div>
  ),
}));
vi.mock("../../components/workspace/presentation-template-gallery", () => ({
  PresentationTemplateGallery: () => <div>Presentation content gallery</div>,
}));
vi.mock("../../components/workspace/presentation-design-gallery", () => ({
  PresentationDesignGallery: () => <div>Presentation design gallery</div>,
}));

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function harness() {
  const hooks: Hooks = { cursor: 0, slots: [] };
  let tree: ReactNode;
  return {
    render() {
      hooks.cursor = 0;
      mocked.hooks = hooks;
      try {
        const inner = TemplatesPage().props.children as ReactElement;
        tree = (inner.type as () => ReactElement)();
      } finally {
        mocked.hooks = null;
      }
    },
    tab(id: string) {
      const tab = elements(tree).find((node) => node.props.id === `template-tab-${id}`);
      if (!tab) throw new Error("Expected tab");
      return tab;
    },
    markup: () => renderToStaticMarkup(tree),
  };
}
beforeEach(() => {
  mocked.presentations = true;
  mocked.canEdit = true;
});
afterEach(() => {
  mocked.hooks = null;
});

describe("Template library sections", () => {
  it("preserves round starting content and offers a separate Designs section", () => {
    const view = harness();
    view.render();
    expect(view.markup()).toContain("Round content gallery");
    expect(view.markup()).not.toContain("Presentation design gallery");
    expect(view.tab("rounds").props["aria-selected"]).toBe(true);
    (view.tab("designs").props.onClick as () => void)();
    view.render();
    expect(view.tab("designs").props["aria-selected"]).toBe(true);
    expect(view.markup()).toContain("Presentation design gallery");
    expect(view.markup()).not.toContain("Presentation content gallery");
    (view.tab("presentations").props.onClick as () => void)();
    view.render();
    expect(view.markup()).toContain("Presentation content gallery");
    expect(view.markup()).not.toContain("Presentation design gallery");
  });
  it("supports keyboard tab navigation including the added Designs section", () => {
    const view = harness();
    view.render();
    const preventDefault = vi.fn();
    (view.tab("rounds").props.onKeyDown as (event: unknown) => void)({
      key: "Home",
      preventDefault,
    });
    view.render();
    expect(view.tab("designs").props.tabIndex).toBe(0);
    (view.tab("designs").props.onKeyDown as (event: unknown) => void)({
      key: "ArrowLeft",
      preventDefault,
    });
    view.render();
    expect(view.tab("surveys").props.tabIndex).toBe(0);
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });
  it("keeps round creation available when presentations are disabled", () => {
    mocked.presentations = false;
    const view = harness();
    view.render();
    expect(view.markup()).toContain('href="/create?start=blank"');
    expect(view.markup()).toContain("Round content gallery");
    (view.tab("designs").props.onClick as () => void)();
    view.render();
    expect(view.markup()).toContain("templateLibrary.presentationUnavailable");
    expect(view.markup()).not.toContain('href="/create/presentation"');
  });
});
