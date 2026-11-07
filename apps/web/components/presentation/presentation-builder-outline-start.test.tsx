import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import {
  presentationTextAssistanceSourceDigest,
  PresentationDraftSchema,
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  type PresentationDraft,
} from "@openround/contracts";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
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

import { ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import { PresentationBuilder } from "./presentation-builder";
import { PresentationAssistance } from "./presentation-assistance";
import { PresentationVisualImport } from "./presentation-visual-import";
import { PresentationTextAssistance } from "./presentation-text-assistance";
import { NativeSceneEditor } from "./native-scene-editor";
import { PresentationQuestionStarters } from "./presentation-question-starters";
import { createPresentationQuestionStarters } from "../../lib/presentation-question-starters";

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
function editor(startOutline = true, mountText = false) {
  const wrapper = render(host(), () => PresentationBuilder({ presentationId, startOutline }));
  const Editor = wrapper.type as (props: ComponentProps<typeof PresentationBuilder>) => ReactNode;
  const parent = host();
  const child = host();
  const visual = host();
  const text = host();
  let textModal: ReactNode;
  let visualModal: ReactNode;
  let tree: ReactNode;
  let modal: ReactNode;
  let assistance: ComponentProps<typeof PresentationAssistance> | undefined;
  const update = () => {
    tree = render(parent, () => Editor({ presentationId, startOutline }));
    const visualNode = elements(tree).find((element) => element.type === PresentationVisualImport);
    if (visualNode) {
      visualModal = render(visual, () =>
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
    if (mountText) {
      const textNode = elements(tree).find(
        (element) => element.type === PresentationTextAssistance,
      );
      if (textNode) {
        textModal = render(text, () =>
          PresentationTextAssistance(
            textNode.props as unknown as ComponentProps<typeof PresentationTextAssistance>,
          ),
        );
        effects(text);
      }
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
        if (parent.dirty || child.dirty || visual.dirty || (mountText && text.dirty)) update();
        await Promise.resolve();
      }
    },
    get assistance() {
      return assistance!;
    },
    get textAssistance() {
      return elements(tree).find((element) => element.type === PresentationTextAssistance)!
        .props as unknown as ComponentProps<typeof PresentationTextAssistance>;
    },
    get nativeEditor() {
      return elements(tree).find((element) => element.type === NativeSceneEditor)!
        .props as unknown as ComponentProps<typeof NativeSceneEditor>;
    },
    get nodes() {
      return elements(tree);
    },
    get modalNodes() {
      return elements(modal);
    },
    get textModalNodes() {
      return elements(textModal);
    },
    get visualModalNodes() {
      return elements(visualModal);
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
    if (
      path.includes("/presentation-assistance/status") ||
      path.includes("/presentation-text-assistance/status")
    )
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
  vi.stubGlobal("document", { activeElement: null, querySelector: vi.fn().mockReturnValue(null) });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Local question starter insertion", () => {
  function sourceFixture(full = false) {
    const block = createNativeContentBlock();
    const title = block.scene!.nodes[0]!;
    if (title.type !== "text") throw new Error("Expected title");
    title.text = "Plan the next step";
    block.scene!.nodes.push({
      id: "Body:Starter",
      type: "text",
      role: "body",
      text: "Review the scope\nAssign an owner\nSet a date",
      frame: { x: 8, y: 35, width: 84, height: 55 },
    });
    block.scene!.readingOrder.push("Body:Starter");
    const draft = PresentationDraftSchema.parse({
      ...savedDraft,
      schemaVersion: 16,
      blocks: [
        block,
        ...(full ? Array.from({ length: 199 }, () => createNativeContentBlock()) : []),
      ],
      sections: [{ id: slideId, title: "Decision", blockIds: [block.id] }],
      spatial: {
        schemaVersion: 1,
        frames: [{ blockId: block.id, x: 0, y: 0, width: 1280, height: 720 }],
      },
    });
    const previous = fixture.request.getMockImplementation()!;
    fixture.request.mockImplementation(async (path: string, init?: RequestInit) =>
      path === `/v1/presentations/${presentationId}`
        ? { presentation: { id: presentationId, draft, draftRevision: 4, status: "draft" } }
        : previous(path, init),
    );
    return { block, draft };
  }
  function controls(view: ReturnType<typeof editor>) {
    return view.nodes.find((node) => node.type === PresentationQuestionStarters)!
      .props as unknown as ComponentProps<typeof PresentationQuestionStarters>;
  }
  function lastDraft() {
    return deckRecoveryWrites().at(-1)![2] as PresentationDraft;
  }
  it("uses one ordinary Undo step, preserving source, section and spatial data", async () => {
    const source = sourceFixture();
    const view = editor(false);
    await view.settle();
    // These siblings must have distinct identities so replacing the slide canvas
    // unmounts the starter panel and closes its native dialog.
    const starterPanel = view.nodes.find((node) => node.type === PresentationQuestionStarters)!;
    const nativeEditor = view.nodes.find((node) => node.type === NativeSceneEditor)!;
    expect(starterPanel.key).not.toBe(nativeEditor.key);
    const starter = createPresentationQuestionStarters(source.block).find(
      (item) => item.type === "poll",
    )!;
    expect(controls(view).onInsert(starter)).toBe(true);
    await view.settle();
    expect(deckRecoveryWrites()).toHaveLength(1);
    const inserted = lastDraft();
    expect(inserted.blocks[0]).toEqual(source.block);
    expect(inserted.blocks[1]).toMatchObject({
      kind: "question",
      question: { type: "poll", purpose: "opinion", confidence: "off", basePoints: 0 },
    });
    expect(inserted.sections![0]!.blockIds).toEqual([source.block.id, inserted.blocks[1]!.id]);
    expect(inserted.spatial!.frames[0]).toEqual(source.draft.spatial!.frames[0]);
    expect(inserted.spatial!.frames).toHaveLength(2);
    const undo = view.nodes.find(
      (node) => node.type === "button" && node.props.children === "delivery.builder.undo",
    )!;
    expect(undo.props.disabled).toBe(false);
    (undo.props.onClick as () => void)();
    await view.settle();
    expect(lastDraft()).toEqual(source.draft);
    const redo = view.nodes.find(
      (node) => node.type === "button" && node.props.children === "delivery.builder.redo",
    )!;
    (redo.props.onClick as () => void)();
    await view.settle();
    expect(lastDraft()).toEqual(inserted);
    expect(fixture.request.mock.calls.some(([path]) => path.includes("/jobs"))).toBe(false);
  });
  it("rejects an over-capacity insertion before touching history or local recovery", async () => {
    const source = sourceFixture(true);
    const view = editor(false);
    await view.settle();
    expect(controls(view).onInsert(createPresentationQuestionStarters(source.block)[0]!)).toBe(
      false,
    );
    await view.settle();
    expect(deckRecoveryWrites()).toEqual([]);
    expect(view.nativeEditor.scene).toEqual(source.block.scene);
    expect(
      view.nodes.find(
        (node) => node.type === "button" && node.props.children === "delivery.builder.undo",
      )?.props.disabled,
    ).toBe(true);
  });
  it("rejects queued old callbacks after edit permission is lost", async () => {
    const source = sourceFixture();
    const view = editor(false);
    await view.settle();
    const originalControls = controls(view);
    fixture.workspace.canEdit = false;
    view.update();
    await view.settle();
    expect(originalControls.onInsert(createPresentationQuestionStarters(source.block)[0]!)).toBe(
      false,
    );
    expect(deckRecoveryWrites()).toEqual([]);
  });
  it("keeps the last committed callback usable after an unchanged parent render", async () => {
    const source = sourceFixture();
    const view = editor(false);
    await view.settle();
    const committed = controls(view);
    view.update();
    await view.settle();
    expect(committed.onInsert(createPresentationQuestionStarters(source.block)[0]!)).toBe(true);
    await view.settle();
    expect(lastDraft().blocks).toHaveLength(2);
  });
  it("allows frame-only edits without replacing the current geometry", async () => {
    const source = sourceFixture();
    const view = editor(false);
    await view.settle();
    const starter = createPresentationQuestionStarters(source.block)[0]!;
    const moved = structuredClone(source.block.scene!);
    const title = moved.nodes[0]!;
    if (title.type !== "text") throw new Error("Expected title");
    title.frame.x += 1;
    view.nativeEditor.onChange(moved);
    await view.settle();
    expect(controls(view).onInsert(starter)).toBe(true);
    await view.settle();
    const inserted = lastDraft();
    expect(inserted.blocks[0]).toMatchObject({ scene: moved });
  });
  it("refuses changed source text without adding another history or recovery entry", async () => {
    const source = sourceFixture();
    const view = editor(false);
    await view.settle();
    const starter = createPresentationQuestionStarters(source.block)[0]!;
    const changed = structuredClone(source.block.scene!);
    const title = changed.nodes[0]!;
    if (title.type !== "text") throw new Error("Expected title");
    title.text = "A revised decision";
    view.nativeEditor.onChange(changed);
    await view.settle();
    const before = deckRecoveryWrites().length;
    expect(controls(view).onInsert(starter)).toBe(false);
    await view.settle();
    expect(deckRecoveryWrites()).toHaveLength(before);
    expect(lastDraft().blocks).toHaveLength(1);
    expect(view.nativeEditor.scene).toEqual(changed);
  });
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

describe("Saved native text assistance", () => {
  function deckFixture() {
    const block = createNativeContentBlock();
    block.id = "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF";
    block.citations = [{ locator: "earlier source", excerpt: "Previous exact evidence" }];
    const node = block.scene!.nodes[0]!;
    node.id = "Body:ExactCase";
    if (node.type === "text") node.text = "Saved selected title";
    block.scene!.readingOrder[0] = node.id;
    let remoteDraft: PresentationDraft = { ...savedDraft, blocks: [block] };
    let remoteRevision = 4;
    const previous = fixture.request.getMockImplementation()!;
    fixture.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === `/v1/presentations/${presentationId}`)
        return {
          presentation: {
            id: presentationId,
            draft: remoteDraft,
            draftRevision: remoteRevision,
            status: "draft",
          },
        };
      return previous(path, init);
    });
    return {
      block,
      node,
      setRemote(draft: PresentationDraft, revision = 4) {
        remoteDraft = draft;
        remoteRevision = revision;
      },
      get draft() {
        return remoteDraft;
      },
    };
  }
  it("drains saved work before capturing the exact selected object and blocks competing native edits", async () => {
    const deck = deckFixture();
    const view = editor(false);
    await view.settle();
    let release!: () => void;
    const drain = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(RecoverableOperationQueue.prototype, "enqueue").mockImplementationOnce(() => drain);
    view.nativeEditor.onTextAssistance!(deck.node.id, "rewrite");
    await view.settle();
    expect(view.textAssistance.open).toBe(false);
    release();
    await view.settle();
    expect(view.textAssistance.open).toBe(true);
    expect(view.textAssistance.target).toEqual({
      blockId: deck.block.id.toLowerCase(),
      nodeId: "Body:ExactCase",
      role: "title",
      operation: "rewrite",
      text: "Saved selected title",
      expectedRevision: 4,
    });
    expect(
      fixture.request.mock.calls.some(([path]) =>
        path.includes("/presentation-text-assistance/jobs"),
      ),
    ).toBe(false);
    expect(view.nativeEditor.onChange({ ...deck.block.scene!, readingOrder: [] })).toBe(false);
    expect(view.nodes.some((node) => node.props.inert === true)).toBe(true);
  });
  it("preserves unsaved text when saving the selected source fails", async () => {
    const deck = deckFixture();
    const previous = fixture.request.getMockImplementation()!;
    fixture.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/draft") && init?.method === "PUT")
        throw new ApiClientError("Cannot save selected text", "INVALID_INPUT", 400);
      return previous(path, init);
    });
    const view = editor(false);
    await view.settle();
    const edited = {
      ...deck.block.scene!,
      nodes: deck.block.scene!.nodes.map((node) =>
        node.type === "text" ? { ...node, text: "Unsaved selected title" } : node,
      ),
    };
    expect(view.nativeEditor.onChange(edited)).toBe(true);
    await view.settle();
    view.nativeEditor.onTextAssistance!(deck.node.id, "shorten");
    await view.settle();
    expect(view.textAssistance.open).toBe(false);
    expect(view.nativeEditor.scene.nodes.find((node) => node.id === deck.node.id)).toMatchObject({
      text: "Unsaved selected title",
    });
    expect(
      fixture.request.mock.calls.some(([path]) =>
        path.includes("/presentation-text-assistance/jobs"),
      ),
    ).toBe(false);
  });
  it("reloads only the bound node and rejects a changed or deleted object without the anchor fallback", async () => {
    const deck = deckFixture();
    const view = editor(false);
    await view.settle();
    view.nativeEditor.onTextAssistance!(deck.node.id, "rewrite");
    await view.settle();
    const binding = {
      blockId: deck.block.id.toLowerCase(),
      nodeId: deck.node.id,
      role: "title" as const,
      operation: "rewrite" as const,
      sourceDigest: presentationTextAssistanceSourceDigest("Saved selected title"),
    };
    const current = await view.textAssistance.onReloadTarget(binding);
    expect(current.nodeId).toBe(deck.node.id);
    expect(current.blockId).toBe(deck.block.id.toLowerCase());
    await view.settle();
    expect(view.nativeEditor.scene).toEqual(deck.block.scene);
    expect(view.textAssistance.citations).toEqual(deck.block.citations);
    await expect(
      view.textAssistance.onReloadTarget({ ...binding, nodeId: binding.nodeId.toLowerCase() }),
    ).rejects.toThrow("changed or deleted");
    const other = createNativeContentBlock();
    deck.setRemote({ ...deck.draft, blocks: [other] });
    await expect(view.textAssistance.onReloadTarget(binding)).rejects.toThrow("changed or deleted");
    await view.settle();
    expect(view.nativeEditor.scene.nodes[0]!.id).toBe(deck.node.id);
    expect(view.textAssistance.target?.nodeId).toBe(deck.node.id);
  });
  function appliedReceipt(source: PresentationDraft) {
    const block = source.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("Expected native source");
    const node = block.scene.nodes[0]!;
    if (node.type !== "text") throw new Error("Expected title");
    const sourceDigest = presentationTextAssistanceSourceDigest(node.text);
    const acceptedDraft = PresentationDraftSchema.parse({
      ...source,
      schemaVersion: 15,
      sections: [],
      blocks: [
        {
          ...block,
          scene: {
            ...block.scene,
            nodes: block.scene.nodes.map((candidate) =>
              candidate.id === node.id && candidate.type === "text"
                ? { ...candidate, text: "Reviewed title" }
                : candidate,
            ),
          },
          textAssistance: {
            schemaVersion: 1,
            nodeId: node.id,
            role: "title",
            operation: "rewrite",
            sourceDigest,
            outputDigest: presentationTextAssistanceSourceDigest("Reviewed title"),
            provider: "fixture",
            model: "fixture-model",
            generatedAt: "2026-11-06T12:00:00.000Z",
            reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
          },
        },
      ],
    });
    return {
      blockId: block.id.toLowerCase(),
      nodeId: node.id,
      role: "title" as const,
      sourceDigest,
      acceptedRevision: 5,
      acceptedDraft,
    };
  }
  it("makes a fresh exact text application one normal Undo/Redo step with its metadata", async () => {
    const deck = deckFixture();
    const view = editor(false);
    await view.settle();
    const receipt = appliedReceipt(deck.draft);
    deck.setRemote(receipt.acceptedDraft, 5);
    await view.textAssistance.onApplied(receipt);
    await view.settle();
    expect(
      view.nodes.find(
        (node) => node.type === "button" && node.props.children === "delivery.builder.undo",
      )?.props.disabled,
    ).toBe(false);
    view.nativeEditor.onUndo!();
    await view.settle();
    expect(view.nativeEditor.scene.nodes[0]).toMatchObject({ text: "Saved selected title" });
    expect(view.nodes.some((node) => node.props["aria-label"] === "Latest AI text edit")).toBe(
      false,
    );
    view.nativeEditor.onRedo!();
    await view.settle();
    expect(view.nativeEditor.scene.nodes[0]).toMatchObject({ text: "Reviewed title" });
    expect(view.nodes.some((node) => node.props["aria-label"] === "Latest AI text edit")).toBe(
      true,
    );
  });
  it.each(["historical", "later-remote"] as const)(
    "does not fabricate an Undo checkpoint for a %s receipt",
    async (mode) => {
      const deck = deckFixture();
      const receipt = appliedReceipt(deck.draft);
      if (mode === "historical") deck.setRemote(receipt.acceptedDraft, 5);
      const view = editor(false);
      await view.settle();
      if (mode === "later-remote")
        deck.setRemote({ ...receipt.acceptedDraft, title: "Later remote edit" }, 6);
      await view.textAssistance.onApplied(receipt);
      await view.settle();
      expect(
        view.nodes.find(
          (node) => node.type === "button" && node.props.children === "delivery.builder.undo",
        )?.props.disabled,
      ).toBe(true);
      view.nativeEditor.onUndo!();
      await view.settle();
      expect(view.nativeEditor.scene.nodes[0]).toMatchObject({ text: "Reviewed title" });
      if (mode === "later-remote")
        expect(view.nodes.some((node) => node.props.value === "Later remote edit")).toBe(true);
    },
  );
  const invalidKey = `presentation-text-assistance:v1:actor:workspace:${presentationId}`;
  const resetLabel = "Reload saved deck and clear invalid recovery";
  async function openInvalidRecovery(view: ReturnType<typeof editor>) {
    await view.settle();
    const resume = view.nodes.find(
      (node) => node.type === "button" && node.props.children === "Resume text assistance",
    )!;
    (resume.props.onClick as () => void)();
    await view.settle();
    expect(
      view.textModalNodes.some((node) => node.props["aria-label"] === "Unverifiable text recovery"),
    ).toBe(true);
    const checkbox = view.textModalNodes.find(
      (node) => node.type === "input" && node.props.type === "checkbox",
    )!;
    (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    await view.settle();
  }
  function resetInvalid(view: ReturnType<typeof editor>) {
    const button = view.textModalNodes.find(
      (node) => node.type === "button" && node.props.children === resetLabel,
    )!;
    expect(button.props.disabled).toBe(false);
    (button.props.onClick as () => void)();
  }
  it.each(["{invalid request", JSON.stringify({ schemaVersion: 0 }), ""])(
    "clears only invalid text recovery %j after an explicit fresh reload, retaining failed resets and other local copies",
    async (invalid) => {
      const deck = deckFixture();
      const otherKey = `presentation-text-assistance:v1:other-actor:workspace:${presentationId}`;
      storage.set(invalidKey, invalid);
      storage.set(otherKey, "keep other actor recovery");
      const local = { ...deck.draft, title: "Earlier local recovery copy" };
      fixture.load.mockImplementation(async (key: string) =>
        key === `presentation:${presentationId}`
          ? { key, revision: 2, savedAt: "2026-11-06T12:00:00Z", draft: local }
          : null,
      );
      const view = editor(false, true);
      await openInvalidRecovery(view);
      expect(view.nativeEditor.onChange({ ...deck.block.scene!, readingOrder: [] })).toBe(false);
      const accepted = appliedReceipt(deck.draft);
      deck.setRemote(accepted.acceptedDraft, 5);
      fixture.request.mockRejectedValueOnce(new Error("Fresh reload unavailable"));
      resetInvalid(view);
      await view.settle();
      expect(storage.get(invalidKey)).toBe(invalid);
      expect(view.textAssistance.open).toBe(true);
      expect(view.nativeEditor.scene.nodes[0]).toMatchObject({ text: "Saved selected title" });
      expect(view.nativeEditor.onChange({ ...deck.block.scene!, readingOrder: [] })).toBe(false);
      resetInvalid(view);
      await view.settle();
      expect(storage.has(invalidKey)).toBe(false);
      expect(storage.get(otherKey)).toBe("keep other actor recovery");
      expect(view.textAssistance.open).toBe(false);
      expect(view.nativeEditor.scene.nodes[0]).toMatchObject({ text: "Reviewed title" });
      expect(view.nodes.some((node) => node.props["aria-label"] === "Local draft recovery")).toBe(
        true,
      );
      expect(
        fixture.clear.mock.calls.some(([key]) => key === `presentation:${presentationId}`),
      ).toBe(false);
      expect(
        fixture.request.mock.calls
          .filter(([path]) => path === `/v1/presentations/${presentationId}`)
          .at(-1)?.[1]?.cache,
      ).toBe("no-store");
      const current = view.nativeEditor.scene;
      expect(
        view.nativeEditor.onChange({
          ...current,
          nodes: current.nodes.map((node) =>
            node.type === "text" ? { ...node, text: "Manual edit after recovery" } : node,
          ),
        }),
      ).toBe(true);
    },
  );
  it.each(["read", "remove"] as const)(
    "keeps invalid recovery locked on a storage %s failure and supports explicit retry",
    async (failure) => {
      const deck = deckFixture();
      storage.set(invalidKey, "{invalid request");
      const storageFailure = vi.spyOn(
        window.sessionStorage,
        failure === "read" ? "getItem" : "removeItem",
      );
      storageFailure.mockImplementation(() => {
        throw new Error("Tab storage is blocked");
      });
      const view = editor(false, true);
      await openInvalidRecovery(view);
      resetInvalid(view);
      await view.settle();
      expect(storage.has(invalidKey)).toBe(true);
      expect(view.textAssistance.open).toBe(true);
      expect(view.nativeEditor.onChange({ ...deck.block.scene!, readingOrder: [] })).toBe(false);
      storageFailure.mockRestore();
      resetInvalid(view);
      await view.settle();
      expect(storage.has(invalidKey)).toBe(false);
      expect(view.textAssistance.open).toBe(false);
    },
  );
  it.each(["create", "apply"] as const)(
    "restores a valid pending %s request during explicit invalid-record reset instead of deleting it",
    async (mode) => {
      const deck = deckFixture();
      storage.set(invalidKey, "{invalid request");
      const view = editor(false, true);
      await openInvalidRecovery(view);
      const sourceDigest = presentationTextAssistanceSourceDigest("Saved selected title");
      const request = {
        schemaVersion: 1,
        requestId: jobId,
        presentationId,
        blockId: deck.block.id.toLowerCase(),
        nodeId: deck.node.id,
        operation: "rewrite",
        expectedRevision: 4,
        sourceDigest,
      };
      const valid = JSON.stringify({
        schemaVersion: 1,
        actorKey: "actor:workspace",
        presentationId,
        blockId: request.blockId,
        nodeId: request.nodeId,
        role: "title",
        operation: "rewrite",
        sourceDigest,
        sourceRevision: 4,
        expectedRevision: 4,
        jobId,
        createBody: JSON.stringify(request),
        createUncertain: mode === "create",
        applyBody:
          mode === "apply"
            ? JSON.stringify({
                schemaVersion: 1,
                jobId,
                proposalHash: "a".repeat(64),
                blockId: request.blockId,
                nodeId: request.nodeId,
                sourceDigest,
                reviewed: true,
                expectedRevision: 4,
                mutationId: slideId,
              })
            : null,
        outputDigest: mode === "apply" ? "b".repeat(64) : null,
        provenanceDigest: mode === "apply" ? "c".repeat(64) : null,
      });
      let finish!: (value: unknown) => void;
      fixture.request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      if (mode === "create") storage.set(invalidKey, valid);
      resetInvalid(view);
      await view.settle();
      if (mode === "apply") storage.set(invalidKey, valid);
      finish({
        presentation: { id: presentationId, draft: deck.draft, draftRevision: 4, status: "draft" },
      });
      await view.settle();
      expect(storage.get(invalidKey)).toBe(valid);
      expect(view.textAssistance.open).toBe(true);
      expect(
        view.textModalNodes.some(
          (node) =>
            node.type === "button" &&
            node.props.children ===
              (mode === "apply"
                ? "Retry exact text application"
                : "Recover or retry saved request"),
        ),
      ).toBe(true);
      expect(
        view.textModalNodes.some(
          (node) => node.props["aria-label"] === "Unverifiable text recovery",
        ),
      ).toBe(false);
      expect(view.nativeEditor.onChange({ ...deck.block.scene!, readingOrder: [] })).toBe(false);
    },
  );
  it.each(["permission", "actor"] as const)(
    "fences an invalid-record reload when the current %s changes",
    async (change) => {
      const deck = deckFixture();
      storage.set(invalidKey, "{invalid request");
      const view = editor(false, true);
      await openInvalidRecovery(view);
      let finish!: (value: unknown) => void;
      fixture.request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      resetInvalid(view);
      await view.settle();
      if (change === "permission") fixture.workspace.canEdit = false;
      else fixture.workspace.creator = { userId: "other-actor", workspaceId: "workspace" };
      view.update();
      await view.settle();
      const accepted = appliedReceipt(deck.draft);
      finish({
        presentation: {
          id: presentationId,
          draft: accepted.acceptedDraft,
          draftRevision: 5,
          status: "draft",
        },
      });
      await view.settle();
      expect(storage.has(invalidKey)).toBe(true);
      expect(view.nativeEditor.scene.nodes[0]).toMatchObject({ text: "Saved selected title" });
    },
  );
  it("fences reset adoption immediately when sign-in changes before any parent rerender", async () => {
    const deck = deckFixture();
    storage.set(invalidKey, "{invalid request");
    const view = editor(false, true);
    await openInvalidRecovery(view);
    let finish!: (value: unknown) => void;
    fixture.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    resetInvalid(view);
    await view.settle();
    const authChanged = (window.addEventListener as ReturnType<typeof vi.fn>).mock.calls
      .filter(([name]) => name === AUTH_CHANGE_EVENT)
      .at(-1)![1] as () => void;
    authChanged();
    const accepted = appliedReceipt(deck.draft);
    finish({
      presentation: {
        id: presentationId,
        draft: accepted.acceptedDraft,
        draftRevision: 5,
        status: "draft",
      },
    });
    await view.settle();
    expect(storage.has(invalidKey)).toBe(true);
    expect(view.nativeEditor.scene.nodes[0]).toMatchObject({ text: "Saved selected title" });
  });
  it("clears invalid text recovery alongside a valid pending save without overwriting its work or the newer server draft", async () => {
    const deck = deckFixture();
    storage.set(invalidKey, "{invalid request");
    const working = { ...deck.draft, title: "Pending local work" };
    const pending = { schemaVersion: 2, expectedRevision: 4, mutationId: slideId, draft: working };
    fixture.load.mockImplementation(async (key: string) =>
      key === `presentation:${presentationId}`
        ? { key, revision: 4, savedAt: "2026-11-06T12:00:00Z", draft: working }
        : key === `presentation:${presentationId}:pending-save`
          ? { key, revision: 4, savedAt: "2026-11-06T12:00:00Z", draft: pending }
          : null,
    );
    const view = editor(false, true);
    await openInvalidRecovery(view);
    const accepted = appliedReceipt(deck.draft);
    deck.setRemote(accepted.acceptedDraft, 6);
    resetInvalid(view);
    await view.settle();
    expect(storage.has(invalidKey)).toBe(false);
    expect(view.textAssistance.open).toBe(false);
    expect(view.nodes.some((node) => node.props.value === "Pending local work")).toBe(true);
    expect(
      fixture.clear.mock.calls.some(
        ([key]) =>
          key === `presentation:${presentationId}:pending-save` ||
          key === `presentation:${presentationId}`,
      ),
    ).toBe(false);
    expect(
      view.nodes.some((node) => node.props.role === "alert" && node.props.inert === false),
    ).toBe(true);
    const previous = fixture.request.getMockImplementation()!;
    fixture.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/draft") && init?.method === "PUT")
        return {
          presentation: { id: presentationId, draft: working, draftRevision: 5, status: "draft" },
        };
      return previous(path, init);
    });
    const retry = view.nodes.find(
      (node) => node.type === "button" && node.props.children === "delivery.builder.retrySave",
    )!;
    (retry.props.onClick as () => void)();
    await view.settle();
    const saves = fixture.request.mock.calls.filter(
      ([path, init]) => path.endsWith("/draft") && init?.method === "PUT",
    );
    expect(saves).toHaveLength(1);
    expect(JSON.parse(saves[0]![1].body)).toEqual(pending);
    expect(
      view.nodes.some((node) => node.type === "button" && node.props.children === "Reload current"),
    ).toBe(true);
    expect(deck.draft).toEqual(accepted.acceptedDraft);
    expect(view.nodes.some((node) => node.props.value === "Pending local work")).toBe(true);
  });
  it("lets invalid text recovery clear before resuming a coexisting exact visual insertion", async () => {
    const deck = deckFixture();
    storage.set(invalidKey, "{invalid request");
    const body = JSON.stringify({
      expectedRevision: 4,
      mutationId: slideId,
      afterBlockId: deck.block.id,
      fidelityAccepted: true,
      pages: [
        {
          pageNumber: 1,
          title: "Reviewed visual",
          alternativeText: "Earlier image",
          accessibleText: "Earlier image reading text",
          readingOrderReviewed: true,
        },
      ],
    });
    const visual = {
      createBody: null,
      insertBody: body,
      insertJobId: jobId,
      jobId,
      order: [1],
      reviews: {
        1: {
          title: "Reviewed visual",
          alternativeText: "Earlier image",
          accessibleText: "Earlier image reading text",
          readingOrderReviewed: true,
        },
      },
      fidelity: true,
    };
    fixture.load.mockImplementation(async (key: string) =>
      key.startsWith("visual-import:")
        ? { key, revision: 0, savedAt: "2026-11-06T12:00:00Z", draft: visual }
        : null,
    );
    const previous = fixture.request.getMockImplementation()!;
    fixture.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes("/visual-imports"))
        return init?.method === "POST"
          ? { insertedBlockIds: [deck.block.id] }
          : { available: true, jobs: [], limits: {} };
      return previous(path, init);
    });
    const view = editor(false, true);
    await view.settle();
    expect(view.nodes.find((node) => node.type === PresentationVisualImport)?.props.open).toBe(
      false,
    );
    await openInvalidRecovery(view);
    const accepted = appliedReceipt(deck.draft);
    deck.setRemote(accepted.acceptedDraft, 6);
    resetInvalid(view);
    await view.settle();
    expect(storage.has(invalidKey)).toBe(false);
    expect(view.textAssistance.open).toBe(false);
    expect(view.nodes.find((node) => node.type === PresentationVisualImport)?.props.open).toBe(
      true,
    );
    const retry = view.visualModalNodes.find(
      (node) => node.type === "button" && String(node.props.children).includes("Retry same"),
    )!;
    expect(retry.props.disabled).toBe(false);
    (retry.props.onClick as () => void)();
    await view.settle();
    expect(
      fixture.request.mock.calls.find(
        ([path, init]) =>
          path.endsWith(`/visual-imports/${jobId}/insert`) && init?.method === "POST",
      )?.[1]?.body,
    ).toBe(body);
    expect(view.nativeEditor.scene.nodes[0]).toMatchObject({ text: "Reviewed title" });
  });
});
