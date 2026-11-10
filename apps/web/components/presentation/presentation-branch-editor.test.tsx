import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  InteractiveQuestionBlockDraft,
  PresentationBranch,
  SupportedLocale,
} from "@openround/contracts";
import { createQuestionBlock } from "../../lib/presentation-builder";
import { branchNavigationCopy } from "./branch-navigation-copy";
import { PresentationBranchEditor } from "./presentation-branch-editor";

const branchId = "ABCDEFAB-1234-4123-8123-ABCDEFABCDEF";
const firstChoiceId = "ABCDEFAB-2222-4222-8222-ABCDEFABCDEF";
const nextChoiceId = "ABCDEFAB-3333-4333-8333-ABCDEFABCDEF";
const firstTargetId = "ABCDEFAB-4444-4444-8444-ABCDEFABCDEF";
const nextTargetId = "ABCDEFAB-5555-4555-8555-ABCDEFABCDEF";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function fixture(type: "single_select" | "poll" | "rating" | "ranking" = "single_select") {
  const block = createQuestionBlock(type);
  if ("choices" in block.question)
    block.question.choices = [
      { id: firstChoiceId, label: "Correct responses", isCorrect: true },
      { id: nextChoiceId, label: "Réponse originale <script>", isCorrect: false },
    ];
  block.branches = [
    {
      id: branchId,
      label: "Branch label <script>",
      targetBlockId: firstTargetId.toLowerCase(),
      condition: {
        kind: "choice_share",
        choiceId: firstChoiceId.toLowerCase(),
        minPercent: 47.5,
        minResponses: 9,
      },
    },
  ];
  return block;
}
function harness(initial = fixture(), initialDisabled = false) {
  let block: InteractiveQuestionBlockDraft = initial;
  let locale: SupportedLocale | undefined;
  let disabled = initialDisabled;
  let tree: ReactNode;
  const targets = [
    { id: firstTargetId, title: "Unavailable target" },
    { id: nextTargetId, title: "Slide 2 <script>" },
  ];
  const onChange = vi.fn((branches: PresentationBranch[], _historyField?: string) => {
    block = { ...block, branches };
  });
  function render() {
    tree = PresentationBranchEditor({ block, targets, onChange, locale, disabled });
  }
  function named(name: string) {
    const control = elements(tree).find((element) => element.props["aria-label"] === name);
    if (!control) throw new Error(`Missing control ${name}`);
    return control;
  }
  render();
  return {
    onChange,
    get block() {
      return block;
    },
    get tree() {
      return tree;
    },
    get markup() {
      return renderToStaticMarkup(tree);
    },
    locale(next: SupportedLocale) {
      locale = next;
      render();
    },
    disabled(next: boolean) {
      disabled = next;
      render();
    },
    named,
    change(name: string, value: string | number) {
      (named(name).props.onChange as (event: unknown) => void)({
        target: { value: String(value), valueAsNumber: Number(value) },
      });
      render();
    },
    click(label: string) {
      const button = elements(tree).find(
        (element) => element.type === "button" && element.props.children === label,
      );
      if (!button) throw new Error(`Missing button ${label}`);
      (button.props.onClick as () => void)();
      render();
    },
  };
}

describe("answer branch authoring localization", () => {
  it("updates UI language without writing authored content or case-sensitive identities", () => {
    const view = harness();
    const before = structuredClone(view.block);
    expect(view.markup).toContain('lang="en-CA"');
    view.locale("ko-KR");
    const copy = branchNavigationCopy("ko-KR");
    expect(view.markup).toContain(copy("Answer branches"));
    expect(view.named(copy("Branch {number} label", { number: 1 })).props).toMatchObject({
      value: "Branch label <script>",
      lang: "",
    });
    expect(view.named(copy("Branch {number} answer choice", { number: 1 })).props.value).toBe(
      firstChoiceId,
    );
    expect(view.named(copy("Branch {number} target", { number: 1 })).props.value).toBe(
      firstTargetId,
    );
    const authored = elements(view.tree).filter(
      (element) =>
        element.type === "option" &&
        [firstChoiceId, nextChoiceId, firstTargetId, nextTargetId].includes(
          element.props.value as string,
        ),
    );
    expect(authored.map((option) => option.props.lang)).toEqual(["", "", "", ""]);
    expect(view.markup).toContain("Correct responses</option>");
    expect(view.markup).toContain("Unavailable target</option>");
    expect(view.markup).toContain("Slide 2 &lt;script&gt;</option>");
    expect(view.markup).not.toContain("<script>");
    expect(view.block).toEqual(before);
    expect(view.onChange).not.toHaveBeenCalled();
    view.locale("fr-FR");
    expect(
      view.named(branchNavigationCopy("fr-FR")("Branch {number} minimum percent", { number: 1 }))
        .props.value,
    ).toBe(47.5);
    expect(view.block).toEqual(before);
    expect(view.onChange).not.toHaveBeenCalled();
  });

  it("keeps exact label and threshold history keys while retaining fractional percent and response bounds", () => {
    const view = harness();
    view.locale("ko-KR");
    const copy = branchNavigationCopy("ko-KR");
    view.change(copy("Branch {number} label", { number: 1 }), "Libellé original");
    expect(view.onChange).toHaveBeenLastCalledWith(view.block.branches, `branch:${branchId}:label`);
    view.change(copy("Branch {number} minimum percent", { number: 1 }), 72.25);
    expect(view.block.branches![0]!.condition.minPercent).toBe(72.25);
    expect(view.onChange).toHaveBeenLastCalledWith(
      view.block.branches,
      `branch:${branchId}:minPercent`,
    );
    view.change(copy("Branch {number} minimum percent", { number: 1 }), 200);
    expect(view.block.branches![0]!.condition.minPercent).toBe(100);
    view.change(copy("Branch {number} minimum percent", { number: 1 }), -1);
    expect(view.block.branches![0]!.condition.minPercent).toBe(0);
    view.change(copy("Branch {number} minimum responses", { number: 1 }), 23.9);
    expect(view.block.branches![0]!.condition.minResponses).toBe(23);
    expect(view.onChange).toHaveBeenLastCalledWith(
      view.block.branches,
      `branch:${branchId}:minResponses`,
    );
    view.change(copy("Branch {number} minimum responses", { number: 1 }), 0);
    expect(view.block.branches![0]!.condition.minResponses).toBe(1);
    view.change(copy("Branch {number} minimum responses", { number: 1 }), 10001);
    expect(view.block.branches![0]!.condition.minResponses).toBe(10000);
    const calls = view.onChange.mock.calls.length;
    view.change(copy("Branch {number} minimum responses", { number: 1 }), Number.NaN);
    expect(view.onChange).toHaveBeenCalledTimes(calls);
    expect(view.block.branches![0]).toMatchObject({
      id: branchId,
      label: "Libellé original",
      targetBlockId: firstTargetId.toLowerCase(),
      condition: { choiceId: firstChoiceId.toLowerCase() },
    });
  });

  it("keeps canonical condition values and raw selected choice/target IDs without new history grouping", () => {
    const view = harness();
    view.locale("ko-KR");
    const copy = branchNavigationCopy("ko-KR");
    view.change(copy("Branch {number} answer choice", { number: 1 }), nextChoiceId);
    expect(view.block.branches![0]!.condition).toMatchObject({
      kind: "choice_share",
      choiceId: nextChoiceId,
    });
    expect(view.onChange.mock.lastCall![1]).toBeUndefined();
    view.change(copy("Branch {number} target", { number: 1 }), nextTargetId);
    expect(view.block.branches![0]!.targetBlockId).toBe(nextTargetId);
    expect(view.onChange.mock.lastCall![1]).toBeUndefined();
    view.change(copy("Branch {number} condition", { number: 1 }), "correct_share");
    expect(view.block.branches![0]!.condition).toEqual({
      kind: "correct_share",
      minPercent: 47.5,
      minResponses: 9,
    });
    view.change(copy("Branch {number} condition", { number: 1 }), "choice_share");
    expect(view.block.branches![0]!.condition).toEqual({
      kind: "choice_share",
      choiceId: firstChoiceId,
      minPercent: 47.5,
      minResponses: 9,
    });
    view.change(copy("Branch {number} target", { number: 1 }), "");
    expect(view.block.branches![0]!.targetBlockId).toBeNull();
  });

  it("localizes missing choices/targets and generated choices while retaining unavailable IDs", () => {
    const block = fixture();
    if (!("choices" in block.question)) throw new Error("Choice fixture required");
    block.question.choices[1]!.label = "";
    block.branches![0]!.condition = {
      kind: "choice_share",
      choiceId: branchId,
      minPercent: 50,
      minResponses: 1,
    };
    block.branches![0]!.targetBlockId = branchId;
    const view = harness(block);
    view.locale("ko-KR");
    const copy = branchNavigationCopy("ko-KR");
    expect(view.markup).toContain(copy("Unavailable choice — select another"));
    expect(view.markup).toContain(copy("Unavailable target — select another"));
    expect(view.markup).toContain(copy("Choice {number}", { number: 2 }));
    const generated = elements(view.tree).find(
      (element) => element.type === "option" && element.props.value === nextChoiceId,
    )!;
    expect(generated.props.lang).toBe("ko-KR");
    expect(view.block.branches![0]!.targetBlockId).toBe(branchId);
    expect(view.onChange).not.toHaveBeenCalled();
  });

  it("retains add/remove defaults and original supported activity boundaries", () => {
    const scored = harness({ ...fixture(), branches: [] });
    scored.click("Add answer branch");
    expect(scored.block.branches![0]).toMatchObject({
      label: "",
      targetBlockId: null,
      condition: { kind: "correct_share", minPercent: 50, minResponses: 1 },
    });
    scored.click("Remove branch 1");
    expect(scored.block.branches).toEqual([]);
    const poll = harness({ ...fixture("poll"), branches: [] });
    poll.click("Add answer branch");
    expect(poll.block.branches![0]!.condition).toEqual({
      kind: "choice_share",
      choiceId: firstChoiceId,
      minPercent: 50,
      minResponses: 1,
    });
    for (const block of [
      { ...fixture(), question: { ...fixture().question, delivery: "recheck" as const } },
      { ...fixture(), question: { ...fixture().question, linkedRecheckQuestionId: branchId } },
      fixture("rating"),
      fixture("ranking"),
      { ...fixture(), branches: Array.from({ length: 10 }, () => fixture().branches![0]!) },
    ]) {
      const view = harness(block);
      view.click("Add answer branch");
      expect(view.onChange).not.toHaveBeenCalled();
    }
  });

  it("blocks every edit callback for viewers even if a disabled control handler is invoked", () => {
    const view = harness(fixture(), true);
    view.locale("ko-KR");
    const before = structuredClone(view.block);
    expect(elements(view.tree)[0]!.props.disabled).toBe(true);
    for (const element of elements(view.tree)) {
      if (element.props.onChange)
        (element.props.onChange as (event: unknown) => void)({
          target: { value: "correct_share", valueAsNumber: 99 },
        });
      if (element.props.onClick) (element.props.onClick as () => void)();
    }
    expect(view.block).toEqual(before);
    expect(view.onChange).not.toHaveBeenCalled();
    view.disabled(false);
    view.change(
      branchNavigationCopy("ko-KR")("Branch {number} minimum percent", { number: 1 }),
      75,
    );
    expect(view.block.branches![0]!.condition.minPercent).toBe(75);
    expect(view.onChange).toHaveBeenCalledOnce();
  });
});
