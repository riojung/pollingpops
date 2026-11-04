import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresentationTemplateGallery } from "./presentation-template-gallery";
import { PresentationTemplatePreview } from "./presentation-template-preview";
import { instantiatePresentationTemplate } from "../../lib/presentation-templates";

interface Hooks {
  cursor: number;
  slots: unknown[];
}
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null, fetch: vi.fn(), push: vi.fn() }));
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
        hooks.slots[index] as T,
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
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useEffect: (effect: ReactModule.EffectCallback, deps: ReactModule.DependencyList) => {
      if (!mocked.hooks) react.useEffect(effect, deps);
    },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocked.push }) }));
vi.mock("../../lib/api", () => ({
  apiFetch: mocked.fetch,
  humanError: (error: Error) => error.message,
}));
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: string) => key }),
}));
vi.mock("./workspace-provider", () => ({
  useWorkspace: () => ({ canEdit: true, productFeatures: { presentations: true } }),
}));
vi.mock("./product-events", () => ({
  recordAuthoringEvent: vi.fn(),
  recordCreationEvent: vi.fn(),
}));

function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function harness(render: () => ReactElement) {
  const hooks: Hooks = { cursor: 0, slots: [] };
  let tree: ReactNode;
  return {
    render() {
      hooks.cursor = 0;
      mocked.hooks = hooks;
      try {
        tree = render();
      } finally {
        mocked.hooks = null;
      }
      return tree;
    },
    find(predicate: (element: ReactElement<Record<string, unknown>>) => boolean) {
      const found = elements(tree).find(predicate);
      if (!found) throw new Error("Expected control");
      return found;
    },
    card(id: string) {
      const found = elements(tree).find((element) => element.props["data-template-id"] === id);
      if (!found) throw new Error("Expected template card");
      return found;
    },
    markup: () => renderToStaticMarkup(tree),
  };
}
function button(card: ReactNode, label: string) {
  const found = elements(card).find(
    (element) => element.type === "button" && element.props.children === label,
  );
  if (!found) throw new Error("Expected template button");
  return found;
}
async function settle() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  mocked.hooks = null;
});

describe("Presentation template gallery", () => {
  it("retries the exact accepted native draft request without creating another blank artifact", async () => {
    const id = "00000000-0000-4000-8000-000000000019";
    let saves = 0;
    mocked.fetch.mockImplementation(async (path: string) => {
      if (path === "/v1/presentations") return { presentation: { id, draftRevision: 0 } };
      saves += 1;
      if (saves === 1) throw new Error("The acknowledgement was lost");
      return { presentation: { id, draftRevision: 1 } };
    });
    const view = harness(() => PresentationTemplateGallery());
    view.render();
    const useTemplate = () =>
      (
        button(view.card("native-startup-pitch"), "templateLibrary.usePresentation").props
          .onClick as () => void
      )();
    useTemplate();
    await settle();
    view.render();
    expect(view.markup()).toContain("The acknowledgement was lost");
    useTemplate();
    await settle();
    view.render();
    expect(mocked.fetch.mock.calls.filter(([path]) => path === "/v1/presentations")).toHaveLength(
      1,
    );
    const puts = mocked.fetch.mock.calls.filter(
      ([path]) => path === `/v1/presentations/${id}/draft`,
    );
    expect(puts).toHaveLength(2);
    expect(puts[1]![1].body).toBe(puts[0]![1].body);
    const envelope = JSON.parse(puts[0]![1].body);
    expect(envelope.schemaVersion).toBe(2);
    expect(envelope.draft.schemaVersion).toBe(8);
    expect(envelope.draft.blocks).toHaveLength(8);
    expect(envelope.expectedRevision).toBe(0);
    expect(mocked.push).toHaveBeenCalledExactlyOnceWith(`/presentation/${id}`);
  });

  it("searches broad scenario labels and keeps a staged preview stable across gallery renders", () => {
    const view = harness(() => PresentationTemplateGallery());
    view.render();
    (
      button(view.card("native-startup-pitch"), "templateLibrary.previewStructure").props
        .onClick as (event: unknown) => void
    )({ currentTarget: { focus: vi.fn() } });
    view.render();
    const draft = view.find((element) => element.type === PresentationTemplatePreview).props.draft;
    (view.find((element) => element.type === "input").props.onChange as (event: unknown) => void)({
      target: { value: "startup pitch" },
    });
    view.render();
    expect(view.find((element) => element.type === PresentationTemplatePreview).props.draft).toBe(
      draft,
    );
    expect(
      elements(view.render()).filter((element) => element.props["data-template-id"]),
    ).toHaveLength(1);
    expect(view.card("native-startup-pitch")).toBeDefined();
    expect(mocked.fetch).not.toHaveBeenCalled();
  });

  it("renders twenty-one cards with twelve shared-renderer thumbnails hidden from duplicate announcements", () => {
    const view = harness(() => PresentationTemplateGallery());
    view.render();
    const html = view.markup();
    expect(html.match(/data-template-id=/g)).toHaveLength(21);
    expect(html.match(/data-native-template-thumbnail=/g)).toHaveLength(12);
    expect(html.match(/data-native-scene=/g)).toHaveLength(12);
    expect(html).not.toContain("Replace HarborTask and the workshop segment");
  });

  it("mounts only the current shared-renderer slide while navigating a complete preview", () => {
    const draft = instantiatePresentationTemplate("native-startup-pitch");
    const view = harness(() => PresentationTemplatePreview({ draft, onClose: vi.fn() }));
    const opening = draft.blocks[0];
    if (opening?.kind !== "content" || opening.scene?.nodes[0]?.type !== "text")
      throw new Error("Expected the opening title");
    view.render();
    expect(view.markup().match(/data-native-scene=/g)).toHaveLength(1);
    expect(view.markup()).toContain(opening.scene.nodes[0].text);
    const next = view.find(
      (element) => element.type === "button" && element.props.children === "Next slide",
    );
    (next.props.onClick as () => void)();
    view.render();
    expect(view.markup().match(/data-native-scene=/g)).toHaveLength(1);
    expect(view.markup()).toContain('data-template-preview-slide="2"');
    expect(view.markup()).not.toContain(opening.speakerNotes);
  });
});
