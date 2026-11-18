import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TemplatesPage from "./page";
import { StarterGallery } from "../../components/workspace/starter-gallery";
import { PresentationTemplateGallery } from "../../components/workspace/presentation-template-gallery";

interface Hooks {
  cursor: number;
  slots: unknown[];
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  presentations: true,
  canEdit: true,
  surveys: true,
  search: "",
  hash: "",
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocked.search),
  useRouter: () => ({ push: mocked.push }),
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
    useSyncExternalStore: <T,>(
      subscribe: (onChange: () => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ) =>
      mocked.hooks
        ? (mocked.hash as T)
        : react.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot),
  };
});
vi.mock("../../components/locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: string) => key }),
}));
vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    canEdit: mocked.canEdit,
    productFeatures: { presentations: mocked.presentations, surveys: mocked.surveys },
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
  StarterGallery: ({ survey, collection }: { survey?: boolean; collection?: string }) => (
    <div data-test-collection={collection}>
      {survey ? "Survey content gallery" : "Round content gallery"}
    </div>
  ),
}));
vi.mock("../../components/workspace/presentation-template-gallery", () => ({
  PresentationTemplateGallery: ({ collection }: { collection?: string }) => (
    <div data-test-collection={collection}>Presentation content gallery</div>
  ),
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
        const boundary = TemplatesPage().props.children as ReactElement<{ children: ReactElement }>;
        const inner = boundary.props.children;
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
    collection(id: string) {
      const control = elements(tree).find((node) => node.props["data-collection"] === id);
      if (!control) throw new Error("Expected collection control");
      return control;
    },
    gallery() {
      const gallery = elements(tree).find(
        (node) => node.type === StarterGallery || node.type === PresentationTemplateGallery,
      );
      if (!gallery) throw new Error("Expected gallery");
      return gallery;
    },
    markup: () => renderToStaticMarkup(tree),
  };
}
beforeEach(() => {
  mocked.presentations = true;
  mocked.canEdit = true;
  mocked.surveys = true;
  mocked.search = "";
  mocked.hash = "";
  mocked.push.mockReset().mockImplementation((href: string) => {
    mocked.search = new URL(href, "https://pollingpops.test").search;
    mocked.hash = "";
  });
});
afterEach(() => {
  mocked.hooks = null;
});

describe("Template library sections", () => {
  it.each(["rounds", "surveys", "presentations"])(
    "preserves the %s gallery identity across collection navigation",
    (type) => {
      mocked.search = `?type=${type}&collection=team-meetings`;
      const view = harness();
      view.render();
      const identity = view.gallery().key;
      (view.collection("all").props.onClick as () => void)();
      view.render();
      expect(view.gallery().key).toBe(identity);
      expect(view.gallery().props.collection).toBeNull();
      (view.collection("team-meetings").props.onClick as () => void)();
      view.render();
      expect(view.gallery().key).toBe(identity);
      expect(view.gallery().props.collection).toBe("team-meetings");
    },
  );
  it("keeps the selected collection in format navigation, reloads and browser history", () => {
    mocked.search = "?campaign=meeting&type=rounds&collection=team-meetings";
    const view = harness();
    view.render();
    expect(view.collection("team-meetings").props["aria-pressed"]).toBe(true);
    expect(view.markup()).toContain('data-test-collection="team-meetings"');
    (view.tab("presentations").props.onClick as () => void)();
    expect(mocked.push).toHaveBeenLastCalledWith(
      "/templates?campaign=meeting&type=presentations&collection=team-meetings",
      { scroll: false },
    );
    view.render();
    expect(view.markup()).toContain("Presentation content gallery");
    expect(view.markup()).toContain('data-test-collection="team-meetings"');
    mocked.search = "?campaign=meeting&type=rounds&collection=team-meetings";
    view.render();
    expect(view.tab("rounds").props["aria-selected"]).toBe(true);
    (view.collection("all").props.onClick as () => void)();
    expect(mocked.push).toHaveBeenLastCalledWith("/templates?campaign=meeting&type=rounds", {
      scroll: false,
    });
    view.render();
    expect(view.collection("all").props["aria-pressed"]).toBe(true);
  });

  it("returns from Designs to the collection's Rounds and clears collection filtering on Designs", () => {
    mocked.search = "?type=designs&campaign=meeting";
    const view = harness();
    view.render();
    (view.collection("team-meetings").props.onClick as () => void)();
    expect(mocked.push).toHaveBeenLastCalledWith(
      "/templates?type=rounds&campaign=meeting&collection=team-meetings",
      { scroll: false },
    );
    view.render();
    (view.tab("designs").props.onClick as () => void)();
    expect(mocked.push).toHaveBeenLastCalledWith("/templates?type=designs&campaign=meeting", {
      scroll: false,
    });
    mocked.search = "?type=surveys&collection=unknown";
    view.render();
    expect(view.collection("all").props["aria-pressed"]).toBe(true);
    expect(view.markup()).not.toContain("data-test-collection=");
  });
  it.each(["rounds", "presentations", "surveys", "designs"])(
    "opens the linked %s section directly",
    (type) => {
      mocked.search = `?type=${type}`;
      const view = harness();
      view.render();
      expect(view.tab(type).props["aria-selected"]).toBe(true);
    },
  );
  it("follows URL changes in a mounted catalog and preserves unrelated search parameters", () => {
    mocked.search = "?campaign=intro&type=presentations";
    const view = harness();
    view.render();
    (view.tab("surveys").props.onClick as () => void)();
    expect(mocked.push).toHaveBeenCalledWith("/templates?campaign=intro&type=surveys", {
      scroll: false,
    });
    view.render();
    expect(view.tab("surveys").props["aria-selected"]).toBe(true);
    mocked.search = "?campaign=intro&type=presentations";
    view.render();
    expect(view.tab("presentations").props["aria-selected"]).toBe(true);
    expect(view.markup()).not.toContain("Survey content gallery");
  });
  it("retains the legacy Designs hash only when there is no explicit format", () => {
    mocked.hash = "#designs";
    const view = harness();
    view.render();
    expect(view.tab("designs").props["aria-selected"]).toBe(true);
    mocked.search = "?type=surveys";
    view.render();
    expect(view.tab("surveys").props["aria-selected"]).toBe(true);
    mocked.search = "?type=unsupported";
    view.render();
    expect(view.tab("rounds").props["aria-selected"]).toBe(true);
  });
  it("keeps paused formats browseable without offering creation", () => {
    mocked.surveys = false;
    mocked.search = "?type=surveys";
    const view = harness();
    view.render();
    expect(view.tab("surveys").props["aria-selected"]).toBe(true);
    expect(view.markup()).toContain("templateLibrary.surveyUnavailable");
    expect(view.markup()).not.toContain('href="/surveys/new"');
    mocked.canEdit = false;
    mocked.surveys = true;
    view.render();
    expect(view.markup()).not.toContain("templateLibrary.startBlank");
  });
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
