import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type { PresentationDraft } from "@openround/contracts";
import type * as ApiModule from "../../lib/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecoverableOperationQueue } from "../../lib/recoverable-operation-queue";

interface Slot {
  value: unknown;
  deps?: readonly unknown[];
  cleanup?: void | (() => void);
}
interface Hooks {
  cursor: number;
  slots: Slot[];
  dirty: boolean;
  effects: Array<() => void>;
}
const fixture = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  request: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn() },
  workspace: {
    creator: { userId: "actor", workspaceId: "workspace" } as {
      userId: string;
      workspaceId: string;
    } | null,
    canEdit: true,
    productFeatures: { presentations: true },
    refreshAccount: vi.fn(),
  },
}));

function sameDeps(left: readonly unknown[] | undefined, right: readonly unknown[] | undefined) {
  return (
    left &&
    right &&
    left.length === right.length &&
    left.every((value, i) => Object.is(value, right[i]))
  );
}

// Run the real editor and assistance effects with deferred state, including child-before-parent
// mount order. This keeps recovery, queue draining, permission fences and explicit submission real.
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixture.hooks!;
      const index = hooks.cursor++;
      hooks.slots[index] ??= {
        value: typeof initial === "function" ? (initial as () => T)() : initial,
      };
      return [
        hooks.slots[index]!.value as T,
        (next: T | ((current: T) => T)) => {
          const current = hooks.slots[index]!.value as T;
          const value = typeof next === "function" ? (next as (current: T) => T)(current) : next;
          if (!Object.is(current, value)) hooks.dirty = true;
          hooks.slots[index]!.value = value;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = fixture.hooks!;
      const index = hooks.cursor++;
      hooks.slots[index] ??= { value: { current: initial } };
      return hooks.slots[index]!.value;
    },
    useMemo: <T,>(compute: () => T, deps: readonly unknown[]) => {
      const hooks = fixture.hooks!;
      const index = hooks.cursor++;
      if (!sameDeps(hooks.slots[index]?.deps, deps))
        hooks.slots[index] = { value: compute(), deps };
      return hooks.slots[index]!.value as T;
    },
    useCallback: <T,>(callback: T, deps: readonly unknown[]) => {
      const hooks = fixture.hooks!;
      const index = hooks.cursor++;
      if (!sameDeps(hooks.slots[index]?.deps, deps)) hooks.slots[index] = { value: callback, deps };
      return hooks.slots[index]!.value as T;
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const hooks = fixture.hooks!;
      const index = hooks.cursor++;
      const previous = hooks.slots[index];
      if (sameDeps(previous?.deps, deps)) return;
      hooks.slots[index] = { value: null, deps };
      hooks.effects.push(() => {
        previous?.cleanup?.();
        hooks.slots[index]!.cleanup = effect();
      });
    },
  };
});
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiFetch: fixture.request,
}));
vi.mock("../../lib/builder-recovery", () => ({
  loadBuilderRecovery: fixture.load,
  saveBuilderRecovery: fixture.save,
  clearBuilderRecovery: fixture.clear,
}));
vi.mock("next/navigation", () => ({ useRouter: () => fixture.router }));
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: string) => key }),
}));
vi.mock("../workspace/workspace-provider", () => ({ useWorkspace: () => fixture.workspace }));

import { ApiClientError } from "../../lib/api";
import { PresentationBuilder } from "./presentation-builder";
import { PresentationAssistance } from "./presentation-assistance";
import { PresentationVisualImport } from "./presentation-visual-import";

const presentationId = "10000000-0000-4000-8000-000000000001";
const jobId = "20000000-0000-4000-8000-000000000001";
const slideId = "30000000-0000-4000-8000-000000000001";
const savedDraft: PresentationDraft = {
  schemaVersion: 14,
  title: "Saved native deck",
  description: "",
  experiencePreset: { id: "focus", version: 1 },
  blocks: [],
};
let storage: Map<string, string>;

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function host(): Hooks {
  return { cursor: 0, slots: [], dirty: true, effects: [] };
}
function render<T>(hooks: Hooks, component: () => T): T {
  hooks.cursor = 0;
  hooks.dirty = false;
  fixture.hooks = hooks;
  return component();
}
function effects(hooks: Hooks) {
  for (const effect of hooks.effects.splice(0)) effect();
}
function editor(startOutline = true) {
  const wrapper = render(host(), () => PresentationBuilder({ presentationId, startOutline }));
  const Editor = wrapper.type as (props: ComponentProps<typeof PresentationBuilder>) => ReactNode;
  const parent = host();
  const child = host();
  const visual = host();
  let tree: ReactNode;
  let modal: ReactNode;
  let assistance: ComponentProps<typeof PresentationAssistance> | undefined;
  const update = () => {
    tree = render(parent, () => Editor({ presentationId, startOutline }));
    const visualNode = elements(tree).find((element) => element.type === PresentationVisualImport);
    if (visualNode) {
      render(visual, () =>
        PresentationVisualImport(
          visualNode.props as unknown as ComponentProps<typeof PresentationVisualImport>,
        ),
      );
      effects(visual);
    }
    const node = elements(tree).find((element) => element.type === PresentationAssistance);
    if (node) {
      assistance = node.props as unknown as ComponentProps<typeof PresentationAssistance>;
      modal = render(child, () => PresentationAssistance(assistance!));
      effects(child);
    }
    effects(parent);
  };
  return {
    update,
    requestStartOutline() {
      startOutline = true;
      parent.dirty = true;
    },
    async settle() {
      for (let turn = 0; turn < 40; turn++) {
        if (parent.dirty || child.dirty || visual.dirty) update();
        await Promise.resolve();
      }
    },
    get assistance() {
      return assistance!;
    },
    get nodes() {
      return elements(tree);
    },
    get modalNodes() {
      return elements(modal);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.workspace.creator = { userId: "actor", workspaceId: "workspace" };
  fixture.workspace.canEdit = true;
  fixture.workspace.productFeatures = { presentations: true };
  fixture.load.mockResolvedValue(null);
  fixture.save.mockResolvedValue(undefined);
  fixture.clear.mockResolvedValue(undefined);
  fixture.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === `/v1/presentations/${presentationId}`)
      return {
        presentation: { id: presentationId, draft: savedDraft, draftRevision: 4, status: "draft" },
      };
    if (path === "/v1/quizzes") return { quizzes: [] };
    if (path === "/v1/features") return { mediaUploads: false };
    if (path.includes("/presentation-assistance/status"))
      return {
        status: {
          enabled: true,
          monthlyLimit: 10,
          used: 0,
          remaining: 10,
          active: 0,
          maxActiveJobs: 2,
          minimumSlides: 3,
          maximumSlides: 8,
        },
      };
    if (path.includes("/presentation-assistance/jobs/") && !init?.method)
      throw new ApiClientError("Not found", "NOT_FOUND", 404);
    if (path.endsWith("/presentation-assistance/jobs") && init?.method === "POST")
      throw new Error("Stop after observing explicit generation");
    throw new Error(`Unexpected request: ${path}`);
  });
  storage = new Map();
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout: vi.fn(),
    clearTimeout: vi.fn(),
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("document", { activeElement: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deckRecoveryWrites() {
  return fixture.save.mock.calls.filter(([key]) => key.startsWith("presentation:"));
}

describe("Saved-deck outline handoff", () => {
  it("opens once after loading and queue draining, clears only the local query, and requires explicit generation", async () => {
    let release!: () => void;
    const drain = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(RecoverableOperationQueue.prototype, "enqueue").mockImplementationOnce(() => drain);
    const view = editor();
    await view.settle();
    expect(view.assistance.open).toBe(false);
    expect(fixture.router.replace).not.toHaveBeenCalled();
    release();
    await view.settle();
    expect(view.assistance.open).toBe(true);
    expect(view.assistance.expectedRevision).toBe(4);
    expect(view.assistance.afterBlockId).toBeNull();
    expect(fixture.router.replace).toHaveBeenCalledExactlyOnceWith(
      `/presentation/${presentationId}`,
    );
    expect(deckRecoveryWrites()).toEqual([]);
    expect(fixture.request.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    expect(fixture.request.mock.calls.filter(([path]) => path.includes("/jobs"))).toEqual([]);
    const input = view.modalNodes.find((node) => node.type === "input")!;
    const outline = view.modalNodes.find((node) => node.type === "textarea")!;
    (input.props.onChange as (event: unknown) => void)({ target: { value: "Review outline" } });
    (outline.props.onChange as (event: unknown) => void)({
      target: {
        value:
          "A complete author-reviewed outline with enough facts for three short native slides.",
      },
    });
    await view.settle();
    expect(fixture.request.mock.calls.filter(([path]) => path.includes("/jobs"))).toEqual([]);
    const form = view.modalNodes.find((node) => node.type === "form")!;
    (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
    await view.settle();
    expect(
      fixture.request.mock.calls.filter(
        ([path, init]) => path.endsWith("/jobs") && init?.method === "POST",
      ),
    ).toHaveLength(1);
    view.assistance.onClose();
    await view.settle();
    expect(view.assistance.open).toBe(false);
    expect(fixture.router.replace).toHaveBeenCalledTimes(1);
  });

  it("retries deferred opening after visual-import recovery resolves, without consuming the query early", async () => {
    let finishRecovery!: (value: null) => void;
    const recovery = new Promise<null>((resolve) => {
      finishRecovery = resolve;
    });
    fixture.load.mockImplementation((key: string) =>
      key.startsWith("visual-import:") ? recovery : Promise.resolve(null),
    );
    const drain = vi.spyOn(RecoverableOperationQueue.prototype, "enqueue");
    const view = editor();
    await view.settle();
    // The child marks recovery pending after the clean render has already scheduled opening.
    expect(drain).toHaveBeenCalled();
    expect(view.assistance.open).toBe(false);
    expect(fixture.router.replace).not.toHaveBeenCalled();
    finishRecovery(null);
    await view.settle();
    expect(view.assistance.open).toBe(true);
    expect(fixture.router.replace).toHaveBeenCalledExactlyOnceWith(
      `/presentation/${presentationId}`,
    );
    expect(deckRecoveryWrites()).toEqual([]);
    expect(fixture.request.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    expect(fixture.request.mock.calls.some(([path]) => path.includes("/jobs"))).toBe(false);
    view.assistance.onClose();
    await view.settle();
    expect(view.assistance.open).toBe(false);
    expect(fixture.router.replace).toHaveBeenCalledTimes(1);
  });

  it.each(["read-only", "feature-disabled"])(
    "leaves the manual control visible for %s editors",
    async (gate) => {
      fixture.workspace.canEdit = gate !== "read-only";
      fixture.workspace.productFeatures.presentations = gate !== "feature-disabled";
      const view = editor();
      await view.settle();
      expect(view.assistance.open).toBe(false);
      expect(
        view.nodes.some(
          (node) => node.type === "button" && node.props.children === "Outline to slides",
        ),
      ).toBe(true);
      expect(fixture.router.replace).not.toHaveBeenCalled();
      expect(
        fixture.request.mock.calls.filter(([path]) => path.includes("presentation-assistance")),
      ).toEqual([]);
    },
  );

  it("waits for an existing preview to close before opening assistance", async () => {
    const view = editor(false);
    await view.settle();
    const previewButton = view.nodes.find(
      (node) => node.type === "button" && node.props.children === "delivery.common.preview",
    )!;
    (previewButton.props.onClick as () => void)();
    view.requestStartOutline();
    await view.settle();
    expect(view.assistance.open).toBe(false);
    expect(fixture.router.replace).not.toHaveBeenCalled();
    const preview = view.nodes.find(
      (node) => typeof node.type === "function" && node.type.name === "PresentationPreview",
    )!;
    (preview.props.onClose as () => void)();
    await view.settle();
    expect(view.assistance.open).toBe(true);
    expect(fixture.router.replace).toHaveBeenCalledTimes(1);
  });

  it("retains the query after failed preparation and lets the author open assistance manually", async () => {
    const drain = vi
      .spyOn(RecoverableOperationQueue.prototype, "enqueue")
      .mockRejectedValueOnce(new Error("Save preparation unavailable"));
    const view = editor();
    await view.settle();
    expect(view.assistance.open).toBe(false);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(fixture.router.replace).not.toHaveBeenCalled();
    const manual = view.nodes.find(
      (node) => node.type === "button" && node.props.children === "Outline to slides",
    )!;
    (manual.props.onClick as () => void)();
    await view.settle();
    expect(view.assistance.open).toBe(true);
    expect(fixture.router.replace).toHaveBeenCalledExactlyOnceWith(
      `/presentation/${presentationId}`,
    );
  });

  it.each(["local-copy", "pending-save", "conflict"])(
    "preserves %s recovery and defers the automatic handoff",
    async (gate) => {
      const local = { ...savedDraft, title: "Unsaved local work" };
      fixture.load.mockImplementation(async (key: string) => {
        if (gate === "local-copy" && key === `presentation:${presentationId}`)
          return { key, revision: 4, savedAt: "2026-11-06T12:00:00Z", draft: local };
        if (gate !== "local-copy" && key.endsWith(":pending-save"))
          return {
            key,
            revision: 4,
            savedAt: "2026-11-06T12:00:00Z",
            draft:
              gate === "conflict"
                ? { invalid: true }
                : {
                    schemaVersion: 2,
                    expectedRevision: 4,
                    mutationId: jobId,
                    draft: local,
                  },
          };
        return null;
      });
      const view = editor();
      await view.settle();
      expect(view.assistance.open).toBe(false);
      expect(fixture.router.replace).not.toHaveBeenCalled();
      expect(deckRecoveryWrites()).toEqual([]);
      expect(fixture.clear).not.toHaveBeenCalled();
      expect(
        view.nodes.some(
          (node) => node.type === "button" && node.props.children === "Outline to slides",
        ),
      ).toBe(true);
      expect(fixture.request.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    },
  );

  it("defers opening when editor permission changes during preparation and resumes only after it is restored", async () => {
    let release!: () => void;
    const drain = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(RecoverableOperationQueue.prototype, "enqueue").mockImplementationOnce(() => drain);
    const view = editor();
    await view.settle();
    fixture.workspace.canEdit = false;
    view.update();
    release();
    await view.settle();
    expect(view.assistance.open).toBe(false);
    expect(fixture.router.replace).not.toHaveBeenCalled();
    fixture.workspace.canEdit = true;
    view.update();
    await view.settle();
    expect(view.assistance.open).toBe(true);
    expect(fixture.router.replace).toHaveBeenCalledExactlyOnceWith(
      `/presentation/${presentationId}`,
    );
  });

  it("lets pending assistance recovery open once without a second launch after it closes", async () => {
    storage.set(
      `presentation-assistance:actor:workspace:${presentationId}`,
      JSON.stringify({
        schemaVersion: 1,
        jobId,
        sourceName: "Recovered outline",
        slideCount: 3,
        sourceDigest: "a".repeat(64),
        selectionInitialized: true,
        selectedSlideIds: [slideId],
        insertProjectionHash: "b".repeat(64),
        insertBody: JSON.stringify({
          schemaVersion: 1,
          jobId,
          proposalHash: "c".repeat(64),
          selectedSlideIds: [slideId],
          reviewed: true,
          expectedRevision: 4,
          mutationId: jobId,
          afterBlockId: null,
        }),
      }),
    );
    const drain = vi.spyOn(RecoverableOperationQueue.prototype, "enqueue");
    const view = editor();
    await view.settle();
    expect(view.assistance.open).toBe(true);
    expect(drain).not.toHaveBeenCalled();
    expect(fixture.router.replace).toHaveBeenCalledExactlyOnceWith(
      `/presentation/${presentationId}`,
    );
    view.assistance.onClose();
    view.assistance.onPendingChange(false);
    await view.settle();
    expect(view.assistance.open).toBe(false);
    expect(drain).not.toHaveBeenCalled();
    expect(fixture.router.replace).toHaveBeenCalledTimes(1);
  });

  it("keeps ordinary editor visits manual and isolates the handoff by actor and saved deck", async () => {
    const view = editor(false);
    await view.settle();
    expect(view.assistance.open).toBe(false);
    const first = render(host(), () => PresentationBuilder({ presentationId, startOutline: true }));
    fixture.workspace.creator = { userId: "other-actor", workspaceId: "workspace" };
    const second = render(host(), () =>
      PresentationBuilder({ presentationId, startOutline: true }),
    );
    expect(second.key).not.toBe(first.key);
    const nextDeck = render(host(), () =>
      PresentationBuilder({ presentationId: jobId, startOutline: true }),
    );
    expect(nextDeck.key).not.toBe(second.key);
    fixture.workspace.creator = null;
    const waiting = render(host(), () =>
      PresentationBuilder({ presentationId, startOutline: true }),
    );
    expect(waiting.type).toBe("main");
    expect(fixture.router.replace).not.toHaveBeenCalled();
  });
});
