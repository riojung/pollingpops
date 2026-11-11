import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PresentationCommand,
  PresentationControlCommand,
  PresentationHostSnapshot,
  PresentationNavigationSnapshot,
} from "@openround/contracts";
import { createPresentationCommandRecovery } from "../../lib/presentation-command-recovery";
import {
  branchNavigationCopy,
  branchNavigationRetryLabel,
  localizeBranchNavigationFeedback,
} from "../presentation/branch-navigation-copy";
import { PresentationBranches } from "./presentation-branches";
import { PresentationNavigationDialog } from "./presentation-navigation";

type EffectSlot = { dependencies: readonly unknown[] | undefined; cleanup?: () => void };
type Hooks = { cursor: number; slots: unknown[]; pendingEffects: (() => void)[] };
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useRef: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useLayoutEffect: (effect: () => void | (() => void), dependencies?: readonly unknown[]) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useLayoutEffect(effect, dependencies);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as EffectSlot | undefined;
      const changed =
        !previous ||
        !dependencies ||
        dependencies.some((value, i) => value !== previous.dependencies?.[i]);
      if (changed)
        hooks.pendingEffects.push(() => {
          previous?.cleanup?.();
          hooks.slots[index] = { dependencies, cleanup: effect() };
        });
    },
  };
});

const blockId = "ABCDEFAB-1111-4111-8111-ABCDEFABCDEF";
const nextBlockId = "ABCDEFAB-2222-4222-8222-ABCDEFABCDEF";
const branchId = "ABCDEFAB-3333-4333-8333-ABCDEFABCDEF";
const commandId = "ABCDEFAB-4444-4444-8444-ABCDEFABCDEF";
const branches: NonNullable<PresentationHostSnapshot["branches"]> = [
  {
    id: branchId,
    label: "Answer branches <script> {count}",
    targetBlockId: nextBlockId,
    targetTitle: "Unavailable target",
    available: true,
    blockedReason: null,
  },
];
function navigationFixture(): PresentationNavigationSnapshot {
  return {
    entries: [
      {
        blockId,
        title: "Slide 1 <script>",
        kind: "question",
        sectionId: branchId,
        sectionTitle: "Presentation navigation <script>",
        status: "current",
        phase: "question_reveal",
        canJump: false,
        blockedReason: "You are on this block.",
      },
      {
        blockId: nextBlockId,
        title: "Activity 2",
        kind: "content",
        sectionId: branchId,
        sectionTitle: "Presentation navigation <script>",
        status: "visited",
        phase: "content",
        canJump: true,
        blockedReason: null,
      },
    ],
    returnTarget: { blockId, title: "Original path <script> {number}" },
    canReturn: true,
    blockedReason: null,
  };
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function click(element: ReactElement<Record<string, unknown>>) {
  (element.props.onClick as () => void)();
}

function dialogHarness(
  overrides: Partial<Parameters<typeof PresentationNavigationDialog>[0]> = {},
) {
  let props: Parameters<typeof PresentationNavigationDialog>[0] = {
    navigation: navigationFixture(),
    disabled: false,
    onJump: vi.fn(),
    onReturn: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const hooks: Hooks = { cursor: 0, slots: [], pendingEffects: [] };
  let tree: ReactNode;
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      tree = PresentationNavigationDialog(props);
    } finally {
      mocked.hooks = null;
    }
  }
  render();
  return {
    get tree() {
      return tree;
    },
    get props() {
      return props;
    },
    get markup() {
      return renderToStaticMarkup(tree);
    },
    update(next: Partial<typeof props>) {
      props = { ...props, ...next };
      render();
    },
    byText(text: string) {
      const element = elements(tree).find(
        (element) => element.type === "button" && element.props.children === text,
      );
      if (!element) throw new Error(`Missing button ${text}`);
      return element;
    },
    entry(id: string) {
      const element = elements(tree).find((element) => element.type === "li" && element.key === id);
      if (!element) throw new Error(`Missing entry ${id}`);
      return elements(element).find((element) => element.type === "button")!;
    },
    returnButton() {
      return elements(tree).find(
        (element) => element.type === "button" && element.props.className === "button",
      )!;
    },
    flushEffects() {
      for (const effect of hooks.pendingEffects.splice(0)) effect();
    },
    cleanup() {
      for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("live branch presentation", () => {
  it("switches UI copy while preserving authored English lookalikes and escaping markup", () => {
    const onFollow = vi.fn();
    const before = structuredClone(branches);
    for (const locale of [undefined, "ko-KR", "fr-FR"] as const) {
      const tree = PresentationBranches({ branches, locale, disabled: false, onFollow });
      const markup = renderToStaticMarkup(tree);
      expect(markup).toContain(branchNavigationCopy(locale)("Answer branches"));
      expect(markup).toContain('<span lang="">Answer branches &lt;script&gt; {count}</span>');
      expect(markup).toContain('<span lang="">Unavailable target</span>');
      expect(markup).not.toContain("<script>");
      click(elements(tree).find((element) => element.type === "button")!);
    }
    expect(onFollow.mock.calls).toEqual([[branchId], [branchId], [branchId]]);
    expect(branches).toEqual(before);
  });

  it("renders canonical eligibility feedback and unknown diagnostics without enabling an unavailable branch", () => {
    const onFollow = vi.fn();
    for (const reason of [
      "Close and reveal this activity before following an answer branch.",
      "This branch needs at least 2 accepted responses.",
      "The accepted responses do not meet this branch condition.",
      "Unknown diagnostic 74 <script>",
    ]) {
      const tree = PresentationBranches({
        branches: [{ ...branches[0]!, available: false, blockedReason: reason }],
        locale: "ko-KR",
        disabled: false,
        onFollow,
      });
      const reasonElement = elements(tree).find(
        (element) => element.props.id === `branch-reason-${branchId}`,
      )!;
      expect(reasonElement.props).toMatchObject({
        children: localizeBranchNavigationFeedback("ko-KR", reason).text,
        lang: localizeBranchNavigationFeedback("ko-KR", reason).lang,
      });
      const button = elements(tree).find((element) => element.type === "button")!;
      expect(button.props).toMatchObject({
        disabled: true,
        "aria-describedby": `branch-reason-${branchId}`,
      });
      click(button);
    }
    const disabled = PresentationBranches({ branches, disabled: true, locale: "ko-KR", onFollow });
    click(elements(disabled).find((element) => element.type === "button")!);
    expect(onFollow).not.toHaveBeenCalled();
    expect(PresentationBranches({ branches: [], disabled: false, onFollow })).toBeNull();
  });
});

describe("localized staff navigation behavior", () => {
  it("updates an open dialog without changing authored titles, snapshot identities or action callbacks", () => {
    const view = dialogHarness();
    const before = structuredClone(view.props.navigation);
    view.update({ locale: "ko-KR" });
    const copy = branchNavigationCopy("ko-KR");
    expect(view.markup).toContain(`aria-label="${copy("Presentation navigation")}"`);
    expect(view.markup).toContain(`${copy("Activity")} · ${copy("Current")} · ${copy("Review")}`);
    expect(view.markup).toContain(`${copy("Slide")} · ${copy("Visited")}`);
    expect(view.markup).toContain('<span lang="">Activity 2</span>');
    expect(view.markup).toContain('lang="">Presentation navigation &lt;script&gt;</p>');
    expect(view.markup).toContain('<span lang="">Original path &lt;script&gt; {number}</span>');
    expect(view.props.navigation).toEqual(before);
    expect(view.props.onJump).not.toHaveBeenCalled();
    click(view.entry(nextBlockId));
    expect(view.props.onJump).toHaveBeenCalledExactlyOnceWith(nextBlockId);
    click(view.returnButton());
    expect(view.props.onReturn).toHaveBeenCalledOnce();
    view.update({ locale: "fr-FR" });
    expect(view.props.navigation).toEqual(before);
    click(view.byText(branchNavigationCopy("fr-FR")("Close navigation")));
    expect(view.props.onClose).toHaveBeenCalledOnce();
  });

  it("keeps authoritative guards inert after locale changes and supports Escape dismissal", () => {
    const navigation = navigationFixture();
    navigation.entries[1] = {
      ...navigation.entries[1]!,
      canJump: false,
      blockedReason: "Complete the linked recheck before navigating.",
    };
    navigation.canReturn = false;
    navigation.blockedReason = "Unknown policy diagnostic <script>";
    const view = dialogHarness({ navigation, locale: "ko-KR" });
    click(view.entry(blockId));
    click(view.entry(nextBlockId));
    click(view.returnButton());
    expect(view.props.onJump).not.toHaveBeenCalled();
    expect(view.props.onReturn).not.toHaveBeenCalled();
    expect(view.markup).toContain('lang="en-CA">Unknown policy diagnostic &lt;script&gt;</p>');
    expect(view.markup).toContain(
      localizeBranchNavigationFeedback("ko-KR", navigation.entries[1]!.blockedReason!).text,
    );
    view.update({ navigation: navigationFixture(), disabled: true, locale: "fr-FR" });
    click(view.entry(nextBlockId));
    click(view.returnButton());
    expect(view.props.onJump).not.toHaveBeenCalled();
    expect(view.props.onReturn).not.toHaveBeenCalled();
    const cancel = { preventDefault: vi.fn() };
    (elements(view.tree)[0]!.props.onCancel as (event: unknown) => void)(cancel);
    expect(cancel.preventDefault).toHaveBeenCalledOnce();
    expect(view.props.onClose).toHaveBeenCalledOnce();
  });

  it.each(["host", "companion"] as const)(
    "retries the exact %s pending command after a language change and lost acknowledgement",
    async (role) => {
      const original: PresentationControlCommand = {
        sessionId: blockId,
        commandId,
        expectedRevision: 7,
        ...(role === "host"
          ? { controlToken: "host-control-pass".repeat(4) }
          : { companionToken: "companion-control-pass".repeat(4) }),
        action: "follow_branch",
        blockId,
        branchId,
      };
      const execute = vi
        .fn()
        .mockRejectedValueOnce(new Error("Lost acknowledgement"))
        .mockResolvedValueOnce({ revision: 8 });
      const recovery = createPresentationCommandRecovery<unknown, PresentationControlCommand>({
        execute,
        onState: () => undefined,
      });
      await expect(recovery.run(original)).rejects.toThrow("Lost acknowledgement");
      const pendingCommand = recovery.state().pendingCommand!;
      let retry: Promise<unknown> | undefined;
      const view = dialogHarness({
        pendingCommand,
        onRetry: () => {
          retry = recovery.retry();
        },
      });
      view.update({ locale: "ko-KR" });
      expect(view.props.pendingCommand).toBe(pendingCommand);
      expect(view.props.pendingCommand).toEqual(original);
      click(view.byText(branchNavigationRetryLabel("ko-KR", pendingCommand)));
      await retry;
      expect(execute.mock.calls).toEqual([[pendingCommand], [pendingCommand]]);
      expect(execute.mock.calls[1]![0]).toBe(execute.mock.calls[0]![0]);
      expect(recovery.state().pendingCommand).toBeNull();
      expect(pendingCommand.commandId).toBe(commandId);
      expect(pendingCommand.expectedRevision).toBe(7);
      expect(Object.isFrozen(pendingCommand)).toBe(true);
    },
  );

  it("localizes busy/retry states and keeps retry availability guarded", () => {
    const pendingCommand: PresentationCommand = {
      sessionId: blockId,
      controlToken: "control-pass".repeat(4),
      commandId,
      expectedRevision: 7,
      action: "jump_to_block",
      targetBlockId: nextBlockId,
    };
    const onRetry = vi.fn();
    const view = dialogHarness({ pendingCommand, locale: "ko-KR", busy: true, onRetry });
    const copy = branchNavigationCopy("ko-KR");
    expect(view.markup).toContain(copy("Waiting for server confirmation…"));
    expect(view.markup).not.toContain(copy("Retry jump acknowledgement"));
    view.update({ busy: false, retryDisabled: true });
    expect(view.markup).toContain(
      copy("Action not yet confirmed. Retry to confirm the original action."),
    );
    const retry = view.byText(copy("Retry jump acknowledgement"));
    expect(retry.props.disabled).toBe(true);
    click(retry);
    expect(onRetry).not.toHaveBeenCalled();
    view.update({ retryDisabled: false });
    click(view.byText(copy("Retry jump acknowledgement")));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(view.props.pendingCommand).toBe(pendingCommand);
  });

  it("retains dialog focus across language changes and restores focus only on close", () => {
    class Element {
      isConnected = true;
      focus = vi.fn();
    }
    class Button extends Element {
      disabled = false;
    }
    const previousFocus = new Button();
    vi.stubGlobal("HTMLElement", Element);
    vi.stubGlobal("HTMLButtonElement", Button);
    vi.stubGlobal("document", { activeElement: previousFocus });
    const view = dialogHarness();
    const dialog = { showModal: vi.fn(), close: vi.fn() };
    const closeButton = new Button();
    const attachRefs = () => {
      (elements(view.tree)[0]!.props.ref as { current: unknown }).current = dialog;
      (
        view.byText(branchNavigationCopy(view.props.locale)("Close navigation")).props.ref as {
          current: unknown;
        }
      ).current = closeButton;
    };
    attachRefs();
    view.flushEffects();
    expect(dialog.showModal).toHaveBeenCalledOnce();
    expect(closeButton.focus).toHaveBeenCalledOnce();
    view.update({ locale: "ko-KR" });
    attachRefs();
    view.flushEffects();
    expect(dialog.showModal).toHaveBeenCalledOnce();
    expect(dialog.close).not.toHaveBeenCalled();
    expect(previousFocus.focus).not.toHaveBeenCalled();
    view.cleanup();
    expect(dialog.close).toHaveBeenCalledOnce();
    expect(previousFocus.focus).toHaveBeenCalledOnce();
  });
});
