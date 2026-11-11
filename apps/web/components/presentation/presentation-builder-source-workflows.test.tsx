import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type { PresentationDraft, SupportedLocale } from "@openround/contracts";
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
  canEdit: true,
  locale: "en-CA" as SupportedLocale,
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
  useLocale: () => ({ locale: mocked.locale, t: (key: string) => key }),
}));
vi.mock("../workspace/workspace-provider", () => ({
  useWorkspace: () => ({
    creator: { userId: "actor", workspaceId: "workspace" },
    canEdit: mocked.canEdit,
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
import { PresentationQuestionStarters } from "./presentation-question-starters";
import { PresentationQuestionSuggestions } from "./presentation-question-suggestions";
import { PresentationVisualImport } from "./presentation-visual-import";
import { AuthoringAssistant } from "../authoring-assistant";
import { sourceWorkflowsCopy } from "./source-workflows-copy";

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
    return elements(Editor({ presentationId: "presentation" }));
  };
  const reload = async () => {
    const review = render().find((node) => node.type === PresentationAssistance)!;
    mocked.request.mockResolvedValueOnce({
      presentation: { id: "presentation", status: "draft", draft: initialDraft, draftRevision: 3 },
    });
    await (review.props.onReloadDraft as () => Promise<void>)();
  };
  return { render, reload };
}
function sourceButton(nodes: ReturnType<typeof elements>) {
  return nodes.find(
    (node) =>
      node.type === "button" &&
      elements(node.props.children as ReactNode).some(
        (child) => child.props.children === "delivery.presentationBuilder.fromTrustedSource",
      ),
  )!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.canEdit = true;
  mocked.locale = "en-CA";
  mocked.save.mockResolvedValue(undefined);
  mocked.clear.mockResolvedValue(undefined);
});

describe("source workflow editor integration", () => {
  it("projects locale into the three review tools without changing the authored draft", () => {
    const block = createNativeContentBlock();
    const original = draft([block]);
    const before = structuredClone(original);
    const view = editor(original);
    for (const locale of ["ko-KR", "de-DE", "en-CA"] as const) {
      mocked.locale = locale;
      const nodes = view.render();
      for (const component of [
        PresentationQuestionStarters,
        PresentationQuestionSuggestions,
        PresentationVisualImport,
      ])
        expect(nodes.find((node) => node.type === component)?.props.locale).toBe(locale);
      expect(
        nodes.find(
          (node) =>
            node.props.label === sourceWorkflowsCopy(locale)("Slide ideas & audience activities"),
        ),
      ).toBeDefined();
    }
    expect(original).toEqual(before);
    expect(mocked.request).not.toHaveBeenCalled();
  });

  it("uses current permission in an open trusted-source proposal and retains its insertion target", async () => {
    const original = draft([createNativeContentBlock()]);
    const before = structuredClone(original);
    const view = editor(original);
    await view.reload();
    await (sourceButton(view.render()).props.onClick as () => Promise<void>)();
    const initial = view.render().find((node) => node.type === AuthoringAssistant)!;
    expect(initial.props.canEdit).toBe(true);
    const target = initial.props.insertionTarget as Record<string, unknown>;
    mocked.canEdit = false;
    mocked.locale = "ko-KR";
    const nodes = view.render();
    const assistant = nodes.find((node) => node.type === AuthoringAssistant)!;
    expect(assistant.props.canEdit).toBe(false);
    expect(assistant.props.insertionTarget).toMatchObject({
      presentationId: target.presentationId,
      expectedRevision: target.expectedRevision,
      afterBlockId: target.afterBlockId,
    });
    expect(
      nodes.find((node) => node.props["aria-labelledby"] === "source-import-title")?.props.lang,
    ).toBe("ko-KR");
    expect(original).toEqual(before);
    expect(mocked.request).toHaveBeenCalledOnce();
  });

  it("rejects an earlier trusted-source opener after permission is revoked", async () => {
    const view = editor(draft([createNativeContentBlock()]));
    await view.reload();
    const earlier = sourceButton(view.render()).props.onClick as () => Promise<void>;
    mocked.canEdit = false;
    view.render();
    await earlier();
    expect(view.render().find((node) => node.type === AuthoringAssistant)).toBeUndefined();
    expect(mocked.request).toHaveBeenCalledOnce();
  });

  it("does not open a proposal after permission changes during its prerequisite save", async () => {
    const original = draft([createNativeContentBlock()]);
    const view = editor(original);
    await view.reload();
    const title = view
      .render()
      .find((node) => node.type === "input" && node.props.value === original.title)!;
    (title.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "Updated before source import" },
    });
    let acknowledge!: (value: unknown) => void;
    mocked.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const opening = (sourceButton(view.render()).props.onClick as () => Promise<void>)();
    await vi.waitFor(() => expect(mocked.request).toHaveBeenCalledTimes(2));
    const attempted = JSON.parse(mocked.request.mock.calls[1]![1].body as string) as {
      draft: PresentationDraft;
    };
    expect(attempted.draft.title).toBe("Updated before source import");
    mocked.canEdit = false;
    view.render();
    acknowledge({
      presentation: {
        id: "presentation",
        status: "draft",
        draft: attempted.draft,
        draftRevision: 4,
      },
    });
    await opening;
    // The button deliberately returns void; wait for the prerequisite operation to settle.
    await vi.waitFor(() => expect(sourceButton(view.render()).props.disabled).toBe(false));
    expect(view.render().find((node) => node.type === AuthoringAssistant)).toBeUndefined();
    expect(mocked.request).toHaveBeenCalledTimes(2);
  });
});
