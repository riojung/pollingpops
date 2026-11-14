import type { ContentSlideDraft, PresentationDraft, SupportedLocale } from "@openround/contracts";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  presentationDesignCopy,
  presentationDesignDraftCopy,
} from "../../lib/i18n/presentation-design-copy";
import { createDesignDraft, PRESENTATION_DESIGNS } from "../../lib/presentation-designs";
import { PRESENTATION_DESIGN_CATEGORIES } from "../../lib/presentation-design-categories";
import { presentationDesignApplicationCopy } from "../../lib/i18n/presentation-design-application-copy";
import {
  createDesignedNativeContentBlock,
  createNativeRevealNode,
} from "../../lib/presentation-native-scene";
import {
  PresentationDesignArtwork,
  PresentationDesignGallery,
  PresentationDesignPreview,
  type PresentationDesignGalleryProps,
} from "./presentation-design-gallery";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: ReactModule.EffectCallback[];
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  request: vi.fn(),
  push: vi.fn(),
  canEdit: true,
  presentations: true,
  locale: "en-CA" as SupportedLocale,
  userId: "00000000-0000-4000-8000-000000000101",
  workspaceId: "00000000-0000-4000-8000-000000000901",
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useId: () => (mocked.hooks ? "design-results" : react.useId()),
    useMemo: <T,>(factory: () => T, deps: ReactModule.DependencyList) =>
      mocked.hooks ? factory() : react.useMemo(factory, deps),
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
      else mocked.hooks.effects.push(effect);
    },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocked.push }) }));
vi.mock("../../lib/api", () => ({
  apiFetch: mocked.request,
  humanError: (error: Error) => error.message,
}));
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: mocked.locale }) }));
vi.mock("./workspace-provider", () => ({
  useWorkspace: () => ({
    canEdit: mocked.canEdit,
    creator: { userId: mocked.userId, workspaceId: mocked.workspaceId },
    productFeatures: { presentations: mocked.presentations },
  }),
}));
vi.mock("./product-events", () => ({
  recordAuthoringEvent: vi.fn(),
  recordCreationEvent: vi.fn(),
}));

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function harness(render: () => ReactElement) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  let cleanups: Array<() => void> = [];
  let tree: ReactNode;
  return {
    render() {
      hooks.cursor = 0;
      hooks.effects = [];
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
      if (!found) throw new Error("Expected design control");
      return found;
    },
    mountEffects() {
      cleanups = hooks.effects
        .map((effect) => effect())
        .filter((cleanup): cleanup is () => void => typeof cleanup === "function");
    },
    unmount() {
      cleanups.forEach((cleanup) => cleanup());
    },
    markup: () => renderToStaticMarkup(tree),
  };
}
function click(element: ReactElement<Record<string, unknown>>) {
  (element.props.onClick as (event: unknown) => void)({ currentTarget: { focus: vi.fn() } });
}
async function settle() {
  for (let count = 0; count < 12; count++) await Promise.resolve();
}
function gallery(props: PresentationDesignGalleryProps = {}) {
  return harness(() => PresentationDesignGallery(props));
}
const presentationId = "00000000-0000-4000-8000-000000000081";

let actorSequence = 100;
const tabStorage = new Map<string, string>();
beforeEach(() => {
  vi.clearAllMocks();
  mocked.locale = "en-CA";
  mocked.userId = `00000000-0000-4000-8000-${(++actorSequence).toString().padStart(12, "0")}`;
  tabStorage.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => tabStorage.get(key) ?? null,
    setItem: (key: string, value: string) => tabStorage.set(key, value),
    removeItem: (key: string) => tabStorage.delete(key),
  });
  mocked.canEdit = true;
  mocked.presentations = true;
});
afterEach(() => {
  mocked.hooks = null;
  vi.unstubAllGlobals();
});

describe("Presentation design library", () => {
  it("renders a compact first page with real static covers and stable preview identities", () => {
    const first = renderToStaticMarkup(<PresentationDesignGallery />);
    const second = renderToStaticMarkup(<PresentationDesignGallery />);
    for (const family of PRESENTATION_DESIGNS.slice(0, 12))
      expect(first).toContain(`data-design-card="${family.id}"`);
    expect(first.match(/data-static-thumbnail="true"/g)).toHaveLength(12);
    expect(first).toContain(presentationDesignDraftCopy("studio", "en-CA").slides.cover.title);
    for (const family of PRESENTATION_DESIGNS.slice(0, 12))
      expect(first).toContain(presentationDesignCopy().purposes[family.id]);
    expect(first).toBe(second);
    expect(mocked.request).not.toHaveBeenCalled();
  });

  it("filters by translated style and search without mutating or saving a presentation", () => {
    const view = gallery();
    view.render();
    click(view.find((node) => node.type === "button" && node.props.children === "Bold"));
    view.render();
    expect(view.markup()).toContain('data-design-card="midnight"');
    expect(view.markup()).toContain('data-design-card="signal"');
    expect(view.markup()).not.toContain('data-design-card="studio"');
    (view.find((node) => node.type === "input").props.onChange as (event: unknown) => void)({
      target: { value: "midnight" },
    });
    view.render();
    expect(view.markup()).not.toContain('data-design-card="signal"');
    click(view.find((node) => node.type === "button" && node.props.children === "Clear filters"));
    view.render();
    expect(view.markup()).toContain('data-design-card="studio"');
    expect(mocked.request).not.toHaveBeenCalled();
  });

  it("offers every category as a compact filter and searches beyond the first page", () => {
    const view = gallery();
    view.render();
    const copy = presentationDesignCopy();
    for (const id of PRESENTATION_DESIGN_CATEGORIES)
      expect(
        view.find((node) => node.type === "button" && node.props.children === copy.categories[id]),
      ).toBeDefined();
    click(
      view.find((node) => node.type === "button" && node.props.children === copy.categories.nature),
    );
    view.render();
    expect(view.markup()).toContain('data-design-card="botanica"');
    expect(view.markup()).not.toContain('data-design-card="ledger"');
    expect(mocked.request).not.toHaveBeenCalled();
  });

  it("reveals additional collections and searches the complete catalog after resetting filters", () => {
    const view = gallery();
    view.render();
    expect(view.markup().match(/data-design-card=/g)).toHaveLength(12);
    expect(view.markup()).not.toContain('data-design-card="beacon"');
    click(
      view.find((node) => node.type === "button" && node.props.children === "Show more designs"),
    );
    view.render();
    expect(view.markup().match(/data-design-card=/g)).toHaveLength(24);
    expect(view.markup()).toContain('data-design-card="beacon"');
    click(view.find((node) => node.type === "button" && node.props.children === "Minimal"));
    view.render();
    click(view.find((node) => node.type === "button" && node.props.children === "Clear filters"));
    view.render();
    expect(view.markup().match(/data-design-card=/g)).toHaveLength(12);
    (view.find((node) => node.type === "input").props.onChange as (event: unknown) => void)({
      target: { value: "nonprofit" },
    });
    view.render();
    expect(view.markup().match(/data-design-card=/g)).toHaveLength(1);
    expect(view.markup()).toContain('data-design-card="beacon"');
    expect(mocked.request).not.toHaveBeenCalled();
  });

  it("retries the same created draft, revision and UUID after a lost save acknowledgement", async () => {
    let saves = 0;
    mocked.request.mockImplementation(async (path: string) => {
      if (path === "/v1/presentations")
        return { presentation: { id: presentationId, draftRevision: 4 } };
      if (++saves === 1) throw new Error("Acknowledgement lost");
      return {};
    });
    const view = gallery();
    view.render();
    click(view.find((node) => node.props["data-design-create"] === "studio"));
    click(view.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    view.render();
    expect(view.markup()).toContain("Acknowledgement lost");
    mocked.locale = "ko-KR";
    view.render();
    click(view.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    const posts = mocked.request.mock.calls.filter((call) => call[0] === "/v1/presentations");
    const puts = mocked.request.mock.calls.filter((call) => call[1].method === "PUT");
    expect(posts).toHaveLength(1);
    expect(puts).toHaveLength(2);
    expect(puts[0]).toEqual(puts[1]);
    const payload = JSON.parse(puts[0]![1].body);
    expect(payload.expectedRevision).toBe(0);
    expect(payload.mutationId).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i,
    );
    expect(payload.draft.blocks).toHaveLength(8);
    expect(payload.draft.title).toBe(presentationDesignDraftCopy("studio", "en-CA").title);
    expect(mocked.push).toHaveBeenCalledWith(`/presentation/${presentationId}`);
  });

  it("stops before saving when edit permission changes and resumes the pending draft", async () => {
    let resolveCreate!: (value: unknown) => void;
    mocked.request.mockImplementation((path: string) =>
      path === "/v1/presentations"
        ? new Promise((resolve) => {
            resolveCreate = resolve;
          })
        : Promise.resolve({}),
    );
    const view = gallery();
    view.render();
    click(view.find((node) => node.props["data-design-create"] === "studio"));
    mocked.canEdit = false;
    view.render();
    resolveCreate({ presentation: { id: presentationId, draftRevision: 0 } });
    await settle();
    view.render();
    expect(mocked.request).toHaveBeenCalledTimes(1);
    expect(mocked.push).not.toHaveBeenCalled();
    mocked.canEdit = true;
    view.render();
    click(view.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    expect(mocked.request).toHaveBeenCalledTimes(2);
    expect(mocked.request.mock.calls[1]![0]).toBe(`/v1/presentations/${presentationId}/draft`);
  });

  it("replays a frozen creation intent across a lost POST acknowledgement and gallery remount", async () => {
    let posts = 0;
    mocked.request.mockImplementation(async (path: string) => {
      if (path === "/v1/presentations") {
        if (++posts === 1) throw new Error("Creation acknowledgement lost");
        return { presentation: { id: presentationId, draftRevision: 7 } };
      }
      return {};
    });
    const first = gallery();
    first.render();
    click(first.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    expect(tabStorage.size).toBe(1);
    const second = gallery();
    second.render();
    click(second.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    const postCalls = mocked.request.mock.calls.filter((call) => call[0] === "/v1/presentations");
    expect(postCalls).toHaveLength(2);
    expect(postCalls[0]).toEqual(postCalls[1]);
    const post = JSON.parse(postCalls[0]![1].body);
    expect(post.creationContext).toEqual({
      actorId: mocked.userId,
      workspaceId: mocked.workspaceId,
    });
    expect(post.creationRequestId).toMatch(/^[\da-f-]{36}$/i);
    const put = mocked.request.mock.calls.find((call) => call[1].method === "PUT")!;
    expect(JSON.parse(put[1].body).expectedRevision).toBe(0);
    expect(tabStorage.size).toBe(0);
  });

  it("does not reuse another actor’s pending request", async () => {
    mocked.request.mockRejectedValue(new Error("Offline"));
    const view = gallery();
    view.render();
    click(view.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    const first = JSON.parse(mocked.request.mock.calls[0]![1].body);
    mocked.userId = "00000000-0000-4000-8000-000000000777";
    view.render();
    click(view.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    const second = JSON.parse(mocked.request.mock.calls[1]![1].body);
    expect(second.creationRequestId).not.toBe(first.creationRequestId);
    expect(second.creationContext.actorId).toBe(mocked.userId);
  });

  it.each(["Revision conflict", "Presentation not found"])(
    "can explicitly start another after a retained target fails with %s",
    async (reason) => {
      const freshId = "00000000-0000-4000-8000-000000000082";
      let posts = 0;
      mocked.request.mockImplementation(async (path: string) => {
        if (path === "/v1/presentations")
          return { presentation: { id: ++posts === 1 ? presentationId : freshId } };
        if (path === `/v1/presentations/${presentationId}/draft`) throw new Error(reason);
        return {};
      });
      const first = gallery();
      first.render();
      first.mountEffects();
      click(first.find((node) => node.props["data-design-create"] === "studio"));
      await settle();
      first.render();
      expect(first.markup()).toContain(`/presentation/${presentationId}`);
      expect(first.markup()).toContain(presentationDesignCopy("en-CA").startAnotherHint);
      first.unmount();

      // Returning from the existing draft still retries the exact revision-zero intent.
      const second = gallery();
      second.render();
      click(second.find((node) => node.props["data-design-create"] === "studio"));
      await settle();
      expect(mocked.request.mock.calls[1]).toEqual(mocked.request.mock.calls[2]);
      expect(posts).toBe(1);
      expect(mocked.push).not.toHaveBeenCalled();

      second.render();
      click(second.find((node) => node.props["data-design-restart"] === "studio"));
      await settle();
      const postCalls = mocked.request.mock.calls.filter((call) => call[1].method === "POST");
      expect(postCalls).toHaveLength(2);
      expect(JSON.parse(postCalls[0]![1].body).creationRequestId).not.toBe(
        JSON.parse(postCalls[1]![1].body).creationRequestId,
      );
      const oldSave = JSON.parse(mocked.request.mock.calls[1]![1].body);
      const freshSave = JSON.parse(mocked.request.mock.calls[4]![1].body);
      expect(freshSave.expectedRevision).toBe(0);
      expect(freshSave.mutationId).not.toBe(oldSave.mutationId);
      expect(freshSave.draft.blocks).toHaveLength(8);
      expect(freshSave.draft.blocks[0].id).not.toBe(oldSave.draft.blocks[0].id);
      expect(mocked.request.mock.calls.map((call) => call[0])).toEqual([
        "/v1/presentations",
        `/v1/presentations/${presentationId}/draft`,
        `/v1/presentations/${presentationId}/draft`,
        "/v1/presentations",
        `/v1/presentations/${freshId}/draft`,
      ]);
      expect(tabStorage.size).toBe(0);
      expect(mocked.push).toHaveBeenCalledWith(`/presentation/${freshId}`);
    },
  );

  it("keeps a fresh intent authoritative when retiring persisted recovery fails", async () => {
    const freshId = "00000000-0000-4000-8000-000000000083";
    let posts = 0;
    mocked.request.mockImplementation(async (path: string) => {
      if (path === "/v1/presentations") {
        posts++;
        if (posts === 2) throw new Error("New acknowledgement lost");
        return { presentation: { id: posts === 1 ? presentationId : freshId } };
      }
      if (path === `/v1/presentations/${presentationId}/draft`)
        throw new Error("Revision conflict");
      return {};
    });
    const first = gallery();
    first.render();
    click(first.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    const staleStoredRequest = [...tabStorage.values()][0];
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => tabStorage.get(key) ?? null,
      setItem: () => {
        throw new Error("Storage unavailable");
      },
      removeItem: () => {
        throw new Error("Storage unavailable");
      },
    });
    first.render();
    click(first.find((node) => node.props["data-design-restart"] === "studio"));
    await settle();
    first.render();
    expect(first.markup()).toContain("New acknowledgement lost");
    expect(first.markup()).not.toContain(`/presentation/${presentationId}`);
    const second = gallery();
    second.render();
    second.mountEffects();
    click(second.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    expect(mocked.request.mock.calls[2]).toEqual(mocked.request.mock.calls[3]);
    expect(mocked.push).toHaveBeenCalledWith(`/presentation/${freshId}`);
    expect([...tabStorage.values()][0]).toBe(staleStoredRequest);
    second.unmount();
    const third = gallery();
    third.render();
    click(third.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    expect(mocked.request.mock.calls[5]![0]).toBe("/v1/presentations");
    expect(JSON.parse(mocked.request.mock.calls[5]![1].body).creationRequestId).not.toBe(
      JSON.parse(mocked.request.mock.calls[0]![1].body).creationRequestId,
    );
  });

  it("scopes recovery to its design and owner and blocks stale reset handlers", async () => {
    mocked.request.mockRejectedValue(new Error("Offline"));
    const view = gallery();
    view.render();
    click(view.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    view.render();
    const restart = view.find((node) => node.props["data-design-restart"] === "studio");
    click(view.find((node) => node.props["aria-label"] === "Preview design: Midnight"));
    view.render();
    const unrelated = view.find((node) => node.type === PresentationDesignPreview);
    expect(unrelated.props.creationError).toBeUndefined();
    expect(unrelated.props.recoveryHref).toBeUndefined();
    expect(unrelated.props.onRestart).toBeUndefined();
    click(view.find((node) => node.props["aria-label"] === "Preview design: Studio"));
    view.render();
    expect(view.find((node) => node.type === PresentationDesignPreview).props.onRestart).toEqual(
      expect.any(Function),
    );
    mocked.canEdit = false;
    view.render();
    expect(view.find((node) => node.props["data-design-restart"] === "studio").props.disabled).toBe(
      true,
    );
    click(restart);
    expect(mocked.request).toHaveBeenCalledTimes(1);
    mocked.canEdit = true;
    mocked.userId = "00000000-0000-4000-8000-000000000888";
    view.render();
    expect(view.markup()).not.toContain("data-design-restart");
    click(restart);
    expect(mocked.request).toHaveBeenCalledTimes(1);
  });

  it("fences late creation acknowledgements after unmount and resumes the known target safely", async () => {
    let resolveCreate!: (value: unknown) => void;
    mocked.request.mockImplementation((path: string) =>
      path === "/v1/presentations"
        ? new Promise((resolve) => {
            resolveCreate = resolve;
          })
        : Promise.resolve({}),
    );
    const first = gallery();
    first.render();
    first.mountEffects();
    click(first.find((node) => node.props["data-design-create"] === "studio"));
    first.unmount();
    resolveCreate({ presentation: { id: presentationId, draftRevision: 0 } });
    await settle();
    expect(mocked.request).toHaveBeenCalledTimes(1);
    expect(mocked.push).not.toHaveBeenCalled();
    const second = gallery();
    second.render();
    click(second.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    expect(mocked.request).toHaveBeenCalledTimes(2);
    expect(mocked.request.mock.calls[1]![0]).toBe(`/v1/presentations/${presentationId}/draft`);
    expect(mocked.push).toHaveBeenCalledWith(`/presentation/${presentationId}`);
  });

  it("keeps exact retry recovery when tab storage is unavailable", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("Storage unavailable");
      },
      setItem: () => {
        throw new Error("Storage unavailable");
      },
      removeItem: () => {
        throw new Error("Storage unavailable");
      },
    });
    let posts = 0;
    mocked.request.mockImplementation(async (path: string) => {
      if (path === "/v1/presentations") {
        if (++posts === 1) throw new Error("Creation acknowledgement lost");
        return { presentation: { id: presentationId } };
      }
      return {};
    });
    const first = gallery();
    first.render();
    click(first.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    const second = gallery();
    second.render();
    click(second.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    expect(mocked.request.mock.calls[0]).toEqual(mocked.request.mock.calls[1]);
    expect(mocked.push).toHaveBeenCalledWith(`/presentation/${presentationId}`);
  });

  it("does not navigate after a save completes in an unmounted gallery", async () => {
    let resolveSave!: (value: unknown) => void;
    mocked.request.mockImplementation((path: string) =>
      path === "/v1/presentations"
        ? Promise.resolve({ presentation: { id: presentationId } })
        : new Promise((resolve) => {
            resolveSave = resolve;
          }),
    );
    const view = gallery();
    view.render();
    view.mountEffects();
    click(view.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    view.unmount();
    resolveSave({});
    await settle();
    expect(mocked.push).not.toHaveBeenCalled();
    expect(tabStorage.size).toBe(1);
  });

  it("keeps successful creation disabled until navigation unmounts and permits a later new creation", async () => {
    mocked.request.mockImplementation(async (path: string) =>
      path === "/v1/presentations" ? { presentation: { id: presentationId } } : {},
    );
    const first = gallery();
    first.render();
    first.mountEffects();
    const firstButton = first.find((node) => node.props["data-design-create"] === "studio");
    click(firstButton);
    await settle();
    first.render();
    expect(mocked.request).toHaveBeenCalledTimes(2);
    expect(first.find((node) => node.props["data-design-create"] === "studio").props.disabled).toBe(
      true,
    );
    click(firstButton);
    await settle();
    expect(mocked.request).toHaveBeenCalledTimes(2);
    first.unmount();
    const second = gallery();
    second.render();
    click(second.find((node) => node.props["data-design-create"] === "studio"));
    await settle();
    expect(mocked.request).toHaveBeenCalledTimes(4);
    const posts = mocked.request.mock.calls.filter((call) => call[0] === "/v1/presentations");
    expect(JSON.parse(posts[0]![1].body).creationRequestId).not.toBe(
      JSON.parse(posts[1]![1].body).creationRequestId,
    );
  });

  it("allows read-only previews and freezes sample language while the interface changes", () => {
    mocked.canEdit = false;
    const view = gallery();
    view.render();
    expect(view.markup()).not.toContain("data-design-create");
    click(view.find((node) => node.props["aria-label"] === "Preview design: Studio"));
    view.render();
    const preview = view.find((node) => node.type === PresentationDesignPreview).props.preview;
    mocked.locale = "fr-FR";
    view.render();
    const next = view.find((node) => node.type === PresentationDesignPreview);
    expect(next.props.preview).toBe(preview);
    expect(next.props.disabled).toBe(true);
    expect(mocked.request).not.toHaveBeenCalled();
  });
});

describe("Design preview actions", () => {
  function setup(overrides: Partial<Parameters<typeof PresentationDesignPreview>[0]> = {}) {
    const draft = createDesignDraft("studio", presentationDesignCopy().sampleDraft);
    const props: Parameters<typeof PresentationDesignPreview>[0] = {
      preview: {
        id: "midnight",
        locale: "en-CA",
        draft: createDesignDraft("midnight", presentationDesignCopy().sampleDraft),
      },
      currentDraft: draft,
      selectedBlockId: draft.blocks[0]!.id,
      onClose: vi.fn(),
      onCreate: vi.fn(),
      onApply: vi.fn(),
      onInsert: vi.fn(),
      ...overrides,
    };
    const view = harness(() => PresentationDesignPreview(props));
    view.render();
    return { view, props };
  }

  it("previews actual current content and dispatches style application without inserting sample text", () => {
    const ownCopy = presentationDesignCopy().sampleDraft;
    ownCopy.slides.cover = {
      title: "Our actual product story",
      body: "Keep this exact authored sentence.",
    };
    const ownDraft = createDesignDraft("studio", ownCopy);
    const original = JSON.stringify(ownDraft);
    const { view, props } = setup({
      currentDraft: ownDraft,
      selectedBlockId: ownDraft.blocks[0]!.id,
    });
    click(view.find((node) => node.props["data-design-application-choice"] === "style"));
    view.render();
    const artwork = view.find((node) => node.type === PresentationDesignArtwork);
    const previewBlock = artwork.props.block as PresentationDraft["blocks"][number];
    expect(JSON.stringify(previewBlock)).toContain("Our actual product story");
    expect(JSON.stringify(previewBlock)).not.toContain("Make room for your next idea");
    expect(JSON.stringify(ownDraft)).toBe(original);
    expect(view.markup()).toContain(presentationDesignCopy().inheritanceNotice);
    click(view.find((node) => node.props["data-design-apply"] === "midnight"));
    expect(props.onApply).toHaveBeenCalledWith("midnight", "deck", "style");
    expect(props.onInsert).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(mocked.request).not.toHaveBeenCalled();
  });

  it("defaults to full design, previews the chosen mode without a mutation and applies that mode", () => {
    const content = createDesignedNativeContentBlock();
    for (const node of content.scene!.nodes)
      if (node.type === "text")
        node.text =
          node.role === "title" ? "Our current story" : "Preserve this authored explanation.";
    const currentDraft = {
      ...createDesignDraft("studio", presentationDesignCopy().sampleDraft),
      blocks: [content],
    };
    const { view, props } = setup({ currentDraft, selectedBlockId: content.id });
    const original = JSON.stringify(props.currentDraft);
    const layoutChoice = view.find(
      (node) => node.props["data-design-application-choice"] === "layout",
    );
    expect(layoutChoice.props["aria-pressed"]).toBe(true);
    expect(view.find((node) => node.props["data-design-apply"] === "midnight").props.children).toBe(
      "Apply design",
    );
    const fullPreview = view.find((node) => node.type === PresentationDesignArtwork).props
      .block as ContentSlideDraft;
    const title = (block: ContentSlideDraft) => {
      const node = block.scene!.nodes.find((node) => node.type === "text" && node.role === "title");
      if (node?.type !== "text") throw new Error("Expected title fixture");
      return node;
    };
    expect(title(fullPreview).frame).not.toEqual(title(content).frame);
    expect(props.onApply).not.toHaveBeenCalled();
    click(view.find((node) => node.props["data-design-application-choice"] === "style"));
    view.render();
    const stylePreview = view.find((node) => node.type === PresentationDesignArtwork).props
      .block as ContentSlideDraft;
    expect(title(stylePreview).frame).toEqual(title(content).frame);
    expect(JSON.stringify(fullPreview)).not.toBe(JSON.stringify(stylePreview));
    expect(view.find((node) => node.props["data-design-apply"] === "midnight").props.children).toBe(
      "Apply style",
    );
    click(view.find((node) => node.props["data-design-application-choice"] === "layout"));
    view.render();
    expect(JSON.stringify(props.currentDraft)).toBe(original);
    click(view.find((node) => node.props["data-design-apply"] === "midnight"));
    expect(props.onApply).toHaveBeenCalledExactlyOnceWith("midnight", "deck", "layout");
    expect(mocked.request).not.toHaveBeenCalled();
  });

  it("explains retained complex layouts only when the full design preview retains them", () => {
    const currentDraft = createDesignDraft("studio", presentationDesignCopy().sampleDraft);
    const first = currentDraft.blocks[0]!;
    if (first.kind !== "content" || !first.scene) throw new Error("Expected native fixture");
    const reveal = createNativeRevealNode();
    first.scene.nodes.push(reveal);
    first.scene.readingOrder.push(reveal.id);
    const { view } = setup({ currentDraft, selectedBlockId: first.id });
    expect(view.find((node) => node.props["data-design-retained-layout"] === true)).toBeDefined();
    expect(view.markup()).toContain(
      presentationDesignApplicationCopy().retainedLayoutNotice.split("{count}")[1]!,
    );
    click(view.find((node) => node.props["data-design-application-choice"] === "style"));
    view.render();
    expect(view.markup()).not.toContain("data-design-retained-layout");
  });

  it("keeps rejected actions open and offers insertion only for an explicitly chosen sample layout", () => {
    const onApply = vi.fn(() => false);
    const { view, props } = setup({ onApply });
    click(view.find((node) => node.props["data-design-apply"] === "midnight"));
    expect(props.onClose).not.toHaveBeenCalled();
    click(view.find((node) => node.type === "button" && node.props.children === "Layout samples"));
    view.render();
    click(view.find((node) => node.props["data-design-layout"] === "data"));
    view.render();
    expect(view.find((node) => node.props["data-design-insert"] === "data")).toBeDefined();
    expect(view.markup()).toContain("<td>72</td>");
    expect(view.markup()).toContain(
      "<caption>Illustrative values. Replace them with your own data.</caption>",
    );
    click(view.find((node) => node.props["data-design-insert"] === "data"));
    expect(props.onInsert).toHaveBeenCalledWith("midnight", "data");
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("forwards the authenticated image renderer and exposes creation failures inside the dialog", () => {
    const renderSceneImage = vi.fn(() => <img src="/example-image" alt="Actual authored image" />);
    const onRestart = vi.fn();
    const { view } = setup({
      renderSceneImage,
      creationError: "Could not save this draft",
      recoveryHref: "/presentation/existing-draft",
      onRestart,
    });
    expect(
      view.find((node) => node.type === PresentationDesignArtwork).props.renderSceneImage,
    ).toBe(renderSceneImage);
    expect(view.markup()).toContain("Could not save this draft");
    expect(view.markup()).toContain('href="/presentation/existing-draft"');
    expect(view.markup()).toContain("Open draft");
    expect(view.markup()).toContain(presentationDesignCopy("en-CA").startAnotherHint);
    click(view.find((node) => node.props["data-design-restart"] === "midnight"));
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it("honours disabled actions even if a stale handler is invoked and supports cancel dismissal", () => {
    const onRestart = vi.fn();
    const { view, props } = setup({ disabled: true, onRestart, creationError: "Offline" });
    click(view.find((node) => node.props["data-design-apply"] === "midnight"));
    expect(props.onApply).not.toHaveBeenCalled();
    click(view.find((node) => node.props["data-design-restart"] === "midnight"));
    expect(onRestart).not.toHaveBeenCalled();
    const preventDefault = vi.fn();
    (view.find((node) => node.type === "dialog").props.onCancel as (event: unknown) => void)({
      preventDefault,
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
