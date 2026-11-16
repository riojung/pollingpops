import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationDraft, SupportedLocale } from "@openround/contracts";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import { PresentationBuilder } from "./presentation-builder";
import { PresentationSectionHeader, PresentationSections } from "./presentation-sections";
import { NativeSceneEditor } from "./native-scene-editor";

interface Hooks {
  cursor: number;
  nullCursor: number;
  slots: unknown[];
  draft: PresentationDraft;
}
const fixture = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  locale: "en-CA" as SupportedLocale,
  canEdit: true,
  deferDraft: false,
  pendingDrafts: [] as Array<() => void>,
  save: vi.fn(),
}));
vi.mock("../../lib/builder-recovery", () => ({
  loadBuilderRecovery: vi.fn().mockResolvedValue(null),
  saveBuilderRecovery: fixture.save,
  clearBuilderRecovery: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ locale: fixture.locale, t: (key: string) => key }),
}));
vi.mock("../workspace/workspace-provider", () => ({
  useWorkspace: () => ({
    creator: { userId: "actor", workspaceId: "workspace" },
    canEdit: fixture.canEdit,
    productFeatures: {},
    refreshAccount: vi.fn(),
  }),
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixture.hooks!;
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) {
        let value = typeof initial === "function" ? (initial as () => T)() : initial;
        if (value === null && hooks.nullCursor < 3)
          value = [
            { id: "presentation", status: "draft", draft: hooks.draft, draftRevision: 3 },
            hooks.draft,
            hooks.draft.blocks[0]?.id ?? null,
          ][hooks.nullCursor++] as T;
        hooks.slots[index] = value;
      }
      return [
        hooks.slots[index],
        (value: T | ((current: T) => T)) => {
          const apply = () => {
            hooks.slots[index] =
              typeof value === "function"
                ? (value as (current: T) => T)(hooks.slots[index] as T)
                : value;
          };
          const current = hooks.slots[index];
          if (
            fixture.deferDraft &&
            typeof value === "function" &&
            current &&
            typeof current === "object" &&
            "blocks" in current
          )
            fixture.pendingDrafts.push(apply);
          else apply();
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = fixture.hooks!;
      const index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useCallback: <T,>(callback: T) => callback,
    useMemo: <T,>(compute: () => T) => compute(),
    useEffect: () => undefined,
  };
});
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function editor() {
  const first = createNativeContentBlock(),
    second = createNativeContentBlock();
  const initial: PresentationDraft = {
    schemaVersion: 14,
    title: "Authored deck 原文",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    blocks: [first, second],
    sections: [],
  };
  const hooks: Hooks = { cursor: 0, nullCursor: 0, slots: [], draft: initial };
  fixture.hooks = { ...hooks, slots: [] };
  const wrapper = PresentationBuilder({ presentationId: "presentation" });
  const Editor = wrapper.type as (props: { presentationId: string }) => ReactNode;
  const render = () => {
    hooks.cursor = 0;
    fixture.hooks = hooks;
    return Editor({ presentationId: "presentation" });
  };
  return {
    initial,
    sections: () =>
      elements(render()).find((node) => node.type === PresentationSections)!
        .props as unknown as ReactModule.ComponentProps<typeof PresentationSections>,
    headers: () =>
      elements(render())
        .filter((node) => node.type === PresentationSectionHeader)
        .map(
          (node) =>
            node.props as unknown as ReactModule.ComponentProps<typeof PresentationSectionHeader>,
        ),
    lists: () => elements(render()).filter((node) => node.type === "ol"),
    nativeCanEdit: () =>
      elements(render()).find((node) => node.type === NativeSceneEditor)!.props.canEdit,
    historyDisabled: (action: "undo" | "redo") =>
      elements(render()).find((node) => node.props["aria-label"] === `delivery.builder.${action}`)!
        .props.disabled,
    captureHistory(action: "undo" | "redo") {
      const button = elements(render()).find(
        (node) => node.props["aria-label"] === `delivery.builder.${action}`,
      )!;
      return button.props.onClick as () => void;
    },
    history(action: "undo" | "redo") {
      const button = elements(render()).find(
        (node) => node.props["aria-label"] === `delivery.builder.${action}`,
      )!;
      expect(button.props.disabled).toBe(false);
      (button.props.onClick as () => void)();
    },
    saved: () => fixture.save.mock.lastCall![2] as PresentationDraft,
  };
}
beforeEach(() => {
  fixture.locale = "en-CA";
  fixture.canEdit = true;
  fixture.deferDraft = false;
  fixture.pendingDrafts = [];
  fixture.save.mockReset().mockResolvedValue(undefined);
});

describe("Sections builder integration and exact history", () => {
  it("keeps slides reachable when removing the last section merges a collapsed unsectioned run", () => {
    const view = editor();
    view.sections().onAdd();
    const sectionId = view.saved().sections![0]!.id;
    view.sections().onAssign(view.initial.blocks[0]!.id, null);
    const unsectioned = view.headers().find((header) => !header.section)!;
    unsectioned.onToggle();
    expect(view.headers().find((header) => !header.section)!.collapsed).toBe(true);
    view.sections().onDelete(sectionId);
    expect(view.headers()).toHaveLength(0);
    expect(view.lists()).toHaveLength(1);
    expect(view.lists()[0]!.props.hidden).toBe(false);
    expect(view.saved().blocks).toEqual(view.initial.blocks);
  });
  it.each([true, false])("projects canEdit=%s to the native scene boundary", (canEdit) => {
    fixture.canEdit = canEdit;
    const view = editor();
    expect(view.nativeCanEdit()).toBe(canEdit);
  });
  it("creates a localized default once, preserves authored edits and exact undo/redo checkpoints", () => {
    fixture.locale = "ko-KR";
    const view = editor();
    const original = structuredClone(view.initial);
    view.sections().onAdd();
    const created = structuredClone(view.saved());
    expect(created.sections![0]!.title).toBe("새 섹션");
    const sectionId = created.sections![0]!.id;
    const saves = fixture.save.mock.calls.length;
    fixture.locale = "fr-FR";
    expect(view.sections().sections).toEqual(created.sections);
    expect(fixture.save).toHaveBeenCalledTimes(saves);
    view.sections().onRename(sectionId, "Authored group 原文");
    const renamed = structuredClone(view.saved());
    expect(renamed.sections![0]!.blockIds).toEqual(original.blocks.map((block) => block.id));
    view.sections().onAssign(original.blocks[0]!.id, null);
    const assigned = structuredClone(view.saved());
    expect(assigned.sections![0]).toEqual({
      id: sectionId,
      title: "Authored group 原文",
      blockIds: [original.blocks[1]!.id],
    });
    expect(assigned.blocks).toEqual(original.blocks);
    expect(assigned.schemaVersion).toBe(original.schemaVersion);
    const initialBaseRevision = fixture.save.mock.calls[0]![1];
    expect(fixture.save.mock.calls.every(([, revision]) => revision === initialBaseRevision)).toBe(
      true,
    );
    view.history("undo");
    expect(view.saved()).toEqual(renamed);
    view.history("redo");
    expect(view.saved()).toEqual(assigned);
    view.sections().onDelete(sectionId);
    expect(view.saved().sections).toEqual([]);
    expect(view.saved().blocks).toEqual(original.blocks);
    view.history("undo");
    expect(view.saved()).toEqual(assigned);
    expect(view.initial).toEqual(original);
  });
  it("projects read-only permission to Sections and blocks its parent mutation callbacks", () => {
    fixture.canEdit = false;
    const view = editor();
    const sections = view.sections();
    expect(sections.disabled).toBe(true);
    sections.onEnable();
    sections.onAdd();
    sections.onRename("section", "changed");
    sections.onDelete("section");
    sections.onAssign(view.initial.blocks[0]!.id, "section");
    expect(fixture.save).not.toHaveBeenCalled();
    expect(view.sections().sections).toEqual([]);
  });
  it("blocks captured commit and history handlers after an owner loses edit permission", () => {
    const view = editor();
    view.sections().onAdd();
    const capturedSections = view.sections();
    const undo = view.captureHistory("undo");
    view.history("undo");
    const redo = view.captureHistory("redo");
    const before = structuredClone(view.saved());
    const saves = fixture.save.mock.calls.length;
    fixture.canEdit = false;
    view.sections();
    expect(view.historyDisabled("undo")).toBe(true);
    expect(view.historyDisabled("redo")).toBe(true);
    capturedSections.onAdd();
    capturedSections.onRename(capturedSections.sections[0]!.id, "Forbidden edit");
    undo();
    redo();
    expect(fixture.save).toHaveBeenCalledTimes(saves);
    expect(view.saved()).toEqual(before);
    expect(view.sections().sections).toEqual(before.sections);
  });
  it("rechecks permission inside a deferred draft updater before history and recovery writes", () => {
    const view = editor();
    const before = structuredClone(view.initial);
    fixture.deferDraft = true;
    view.sections().onAdd();
    expect(fixture.pendingDrafts).toHaveLength(1);
    expect(fixture.save).not.toHaveBeenCalled();
    fixture.canEdit = false;
    view.sections();
    fixture.pendingDrafts.splice(0).forEach((apply) => apply());
    expect(view.sections().sections).toEqual(before.sections);
    expect(fixture.save).not.toHaveBeenCalled();
    fixture.canEdit = true;
    // A rejected updater must not leave an undo checkpoint behind.
    const undo = view.captureHistory("undo");
    undo();
    expect(fixture.save).not.toHaveBeenCalled();
    expect(view.initial).toEqual(before);
  });
});
