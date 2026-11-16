import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type { PresentationDraft } from "@openround/contracts";
import type * as ApiModule from "../../lib/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";

const mocked = vi.hoisted(() => ({
  hooks: null as {
    cursor: number;
    nullCursor: number;
    slots: unknown[];
    initialDraft: PresentationDraft;
  } | null,
  request: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiFetch: mocked.request,
}));
vi.mock("../../lib/builder-recovery", () => ({
  loadBuilderRecovery: vi.fn().mockResolvedValue(null),
  saveBuilderRecovery: mocked.save,
  clearBuilderRecovery: mocked.clear,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: string) => key }),
}));
vi.mock("../workspace/workspace-provider", () => ({
  useWorkspace: () => ({
    creator: { userId: "actor", workspaceId: "workspace" },
    canEdit: true,
    productFeatures: {},
    refreshAccount: vi.fn(),
  }),
}));
// Keep real component closures and deferred React state; skip unrelated mount effects and children.
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = mocked.hooks!;
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) {
        let value = typeof initial === "function" ? (initial as () => T)() : initial;
        if (value === null && hooks.nullCursor < 3) {
          value = [
            { id: "presentation", status: "draft", draft: hooks.initialDraft, draftRevision: 3 },
            hooks.initialDraft,
            hooks.initialDraft.blocks[0]?.id ?? null,
          ][hooks.nullCursor++] as T;
        }
        hooks.slots[index] = value;
      }
      return [
        hooks.slots[index],
        (value: T | ((current: T) => T)) => {
          hooks.slots[index] =
            typeof value === "function"
              ? (value as (current: T) => T)(hooks.slots[index] as T)
              : value;
        },
      ];
    },
    useRef: <T,>(value: T) => {
      const hooks = mocked.hooks!;
      const index = hooks.cursor++;
      hooks.slots[index] ??= { current: value };
      return hooks.slots[index];
    },
    useCallback: <T,>(callback: T) => callback,
    useMemo: <T,>(compute: () => T) => compute(),
    useEffect: () => undefined,
  };
});

import { PresentationBuilder } from "./presentation-builder";
import { PresentationAssistance } from "./presentation-assistance";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function draft(blocks: PresentationDraft["blocks"]): PresentationDraft {
  return {
    schemaVersion: 14,
    title: "Existing deck",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    blocks,
  };
}
function editor(initialDraft: PresentationDraft) {
  mocked.hooks = { cursor: 0, nullCursor: 0, slots: [], initialDraft };
  const wrapper = PresentationBuilder({ presentationId: "presentation" });
  const Editor = wrapper.type as (props: { presentationId: string }) => ReactNode;
  const hooks = { cursor: 0, nullCursor: 0, slots: [] as unknown[], initialDraft };
  const render = () => {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    const tree = Editor({ presentationId: "presentation" });
    const assistance = elements(tree).find((node) => node.type === PresentationAssistance)!;
    return assistance.props as unknown as ReactModule.ComponentProps<typeof PresentationAssistance>;
  };
  return { render };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.save.mockResolvedValue(undefined);
  mocked.clear.mockResolvedValue(undefined);
});

describe("Outline review saved-deck reload", () => {
  it.each(["retained", "deleted", "empty"] as const)(
    "uses the refreshed selection and revision when the prior anchor is %s",
    async (scenario) => {
      const selected = createNativeContentBlock();
      const fallback = createNativeContentBlock();
      const next = draft(
        scenario === "retained" ? [fallback, selected] : scenario === "deleted" ? [fallback] : [],
      );
      const view = editor(draft([selected]));
      const review = view.render();
      review.onResumeRequired();
      const open = view.render();
      mocked.request.mockResolvedValueOnce({
        presentation: { id: "presentation", status: "draft", draft: next, draftRevision: 8 },
      });
      await open.onReloadDraft();
      const refreshed = view.render();
      expect(refreshed.open).toBe(true);
      expect(refreshed.expectedRevision).toBe(8);
      expect(refreshed.afterBlockId).toBe(
        scenario === "retained" ? selected.id : scenario === "deleted" ? fallback.id : null,
      );
      expect(mocked.request).toHaveBeenCalledOnce();
    },
  );

  it("keeps the current review and insertion target when the saved draft cannot be loaded", async () => {
    const selected = createNativeContentBlock();
    const view = editor(draft([selected]));
    view.render().onResumeRequired();
    mocked.request.mockResolvedValueOnce({
      presentation: {
        id: "presentation",
        status: "draft",
        draft: draft([selected]),
        draftRevision: 7,
      },
    });
    await view.render().onReloadDraft();
    const previous = view.render();
    mocked.request.mockRejectedValueOnce(new Error("Connection unavailable"));
    await expect(previous.onReloadDraft()).rejects.toThrow("Your outline review is retained");
    const retained = view.render();
    expect(retained.open).toBe(true);
    expect(retained.expectedRevision).toBe(previous.expectedRevision);
    expect(retained.afterBlockId).toBe(previous.afterBlockId);
    expect(mocked.clear).toHaveBeenCalledOnce();
  });
});
