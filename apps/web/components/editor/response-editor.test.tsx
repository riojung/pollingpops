import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { supportedLocales, type QuestionDraft } from "@openround/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate, type MessageKey } from "../../lib/i18n/catalog";
import {
  deliveryAuthoringEnglishMessages,
  loadDeliveryAuthoringMessages,
} from "../../lib/i18n/domains/delivery-authoring";
import { ResponseEditor } from "./response-editor";
import type { ChoiceQuestionDraft, ChoiceQuestionUpdater } from "./types";

const fixtures = vi.hoisted(() => ({
  locale: "en-CA",
  messages: {} as Record<string, string>,
}));

vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    locale: fixtures.locale,
    t: (key: MessageKey, values?: Record<string, string | number>) =>
      translate({ ...deliveryAuthoringEnglishMessages, ...fixtures.messages }, key, values),
  }),
}));

beforeEach(() => {
  fixtures.locale = "en-CA";
  fixtures.messages = {};
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

function question(type: ChoiceQuestionDraft["type"], count = type === "true_false" ? 2 : 3) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    type,
    prompt: "Which answer?",
    timeLimitSeconds: 30,
    basePoints: 0,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
    choices: Array.from({ length: count }, (_, index) => ({
      id: `answer-${index + 1}`,
      label: type === "true_false" ? ["True", "False"][index]! : `Option ${index + 1}`,
      isCorrect: type !== "poll" && type !== "ranking" && index === 0,
    })),
  } as ChoiceQuestionDraft;
}

function editorHarness(initial: ChoiceQuestionDraft) {
  let draft = initial;
  const onStructuralChange = vi.fn((next: QuestionDraft) => {
    if (!("choices" in next)) throw new Error("Expected a choice question");
    draft = next;
  });
  const onUpdateChoiceQuestion: ChoiceQuestionUpdater = (update) => {
    draft = update(draft);
  };
  const render = () => {
    const editor = ResponseEditor({
      question: draft,
      uxBeta: true,
      multiSelectPollsEnabled: true,
      rankingPollsEnabled: true,
      onStructuralChange,
      onUpdateChoiceQuestion,
      onUpdateQuestion: vi.fn(),
    }) as ReactElement<Record<string, unknown>>;
    return (editor.type as (props: Record<string, unknown>) => ReactNode)(editor.props);
  };
  const find = (predicate: (element: ReactElement<Record<string, unknown>>) => boolean) => {
    const element = elements(render()).find(predicate);
    if (!element) throw new Error("Expected answer editor control");
    return element;
  };
  return {
    render,
    draft: () => draft,
    onStructuralChange,
    changeAnswer(index: number, value: string) {
      const field = find(
        (element) =>
          element.type === "textarea" &&
          element.props["aria-labelledby"] === `answer-label-answer-${index}`,
      );
      (field.props.onChange as (event: { target: { value: string } }) => void)({
        target: { value },
      });
    },
    removeAnswer(index: number) {
      const button = find(
        (element) =>
          element.type === "button" &&
          element.props["aria-labelledby"] ===
            `delete-label-answer-${index} answer-label-answer-${index}`,
      );
      (button.props.onClick as () => void)();
    },
    markCorrect(index: number) {
      const control = find(
        (element) => element.props["aria-label"] === `Mark choice ${index} correct`,
      );
      (control.props.onChange as () => void)();
    },
  };
}

describe("Round choice response editor", () => {
  it.each(["poll", "ranking", "single_select", "multi_select", "true_false"] as const)(
    "keeps %s answer fields separate from optional correctness and removal controls",
    (type) => {
      const tree = editorHarness(question(type)).render();
      const all = elements(tree);
      const answers = all.filter((element) => element.type === "textarea");
      const removals = all.filter((element) => element.props.title);
      const correctness = all.filter((element) => element.props.className === "choice-correct");

      expect(answers).toHaveLength(type === "true_false" ? 2 : 3);
      expect(removals).toHaveLength(type === "true_false" ? 0 : 3);
      expect(correctness).toHaveLength(type === "poll" || type === "ranking" ? 0 : answers.length);
      for (const [index, answer] of answers.entries()) {
        expect(answer.props).toMatchObject({
          "aria-labelledby": `answer-label-answer-${index + 1}`,
          "aria-invalid": false,
          disabled: type === "true_false",
          maxLength: 180,
          rows: 2,
          lang: "",
        });
        const row = all.find((element) => element.key === `answer-${index + 1}`)!;
        expect(row.type).toBe("div");
        expect(row.props.role).toBe("group");
        expect(row.props["aria-labelledby"]).toBe(answer.props["aria-labelledby"]);
        expect(row.props.onClick).toBeUndefined();
        expect(row.props.className).not.toBe("choice-row");
      }
      for (const [index, removal] of removals.entries()) {
        expect(removal.type).toBe("button");
        expect(removal.props.type).toBe("button");
        expect(removal.props["aria-labelledby"]).toBe(
          `delete-label-answer-${index + 1} answer-label-answer-${index + 1}`,
        );
        expect(removal.props.title).toBe(`Delete: Answer ${index + 1}`);
      }
      for (const control of correctness) {
        expect(control.props.type).toBe(type === "multi_select" ? "checkbox" : "radio");
      }
    },
  );

  it("edits long multiline labels without removing an answer or changing its identity", () => {
    const initial = question("poll");
    const harness = editorHarness(initial);
    const label = "A longer answer that can wrap across the available editing width.\nSecond line.";
    harness.changeAnswer(2, label);
    expect(harness.draft().choices).toEqual([
      initial.choices[0],
      { ...initial.choices[1], label },
      initial.choices[2],
    ]);
    expect(harness.onStructuralChange).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(harness.render())).toContain(label);
    harness.changeAnswer(2, "  ");
    const answer = elements(harness.render()).find(
      (element) =>
        element.type === "textarea" && element.props["aria-labelledby"] === "answer-label-answer-2",
    );
    expect(answer?.props["aria-invalid"]).toBe(true);
  });

  it.each(["poll", "ranking", "single_select", "multi_select"] as const)(
    "removes only the requested %s answer and stops offering removal at two choices",
    (type) => {
      const initial = question(type);
      const harness = editorHarness(initial);
      harness.removeAnswer(2);
      expect(harness.draft().choices).toEqual([initial.choices[0], initial.choices[2]]);
      expect(harness.onStructuralChange).toHaveBeenCalledWith(harness.draft(), "Choice removed.");
      expect(elements(harness.render()).filter((element) => element.props.title)).toHaveLength(0);
    },
  );

  it("preserves poll selection and ranking limits when an answer is removed", () => {
    const poll = editorHarness({ ...question("poll"), type: "poll", maxSelections: 3 });
    poll.removeAnswer(1);
    expect(poll.draft().maxSelections).toBe(2);
    const ranking = editorHarness({
      ...question("ranking"),
      type: "ranking",
      rankCount: 3,
      maxSelections: undefined,
    });
    ranking.removeAnswer(3);
    expect(ranking.draft().rankCount).toBe(2);
  });

  it("retains exclusive correct answers for single-select and independent multi-select toggles", () => {
    const single = editorHarness(question("single_select"));
    single.markCorrect(2);
    expect(single.draft().choices.map((choice) => choice.isCorrect)).toEqual([false, true, false]);
    const multi = editorHarness(question("multi_select"));
    multi.markCorrect(2);
    expect(multi.draft().choices.map((choice) => choice.isCorrect)).toEqual([true, true, false]);
    multi.markCorrect(1);
    expect(multi.draft().choices.map((choice) => choice.isCorrect)).toEqual([false, true, false]);
    expect(single.onStructuralChange).not.toHaveBeenCalled();
    expect(multi.onStructuralChange).not.toHaveBeenCalled();
  });

  it.each(supportedLocales)("names each delete control with its answer in %s", async (locale) => {
    const messages = await loadDeliveryAuthoringMessages(locale);
    fixtures.locale = locale;
    fixtures.messages = messages;
    const all = elements(editorHarness(question("poll")).render());
    const removals = all.filter((element) => element.props.title);
    for (const [index, button] of removals.entries()) {
      const name = (button.props["aria-labelledby"] as string)
        .split(" ")
        .map((id) =>
          text(all.find((element) => element.props.id === id)?.props.children as ReactNode),
        )
        .join(" ");
      expect(name).toBe(
        `${messages["delivery.common.delete"]} ${translate(messages, "delivery.builder.answer", { number: index + 1 })}`,
      );
      expect(button.props.lang).toBe(locale);
    }
  });
});
