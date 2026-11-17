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
import type { ChoiceQuestionDraft, ChoiceQuestionUpdater, QuestionUpdater } from "./types";
import { roundToolsCopy } from "../../lib/i18n/round-tools-copy";

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

  it("preserves disabled poll and ranking features without silently changing their saved limits", () => {
    for (const initial of [
      { ...question("poll"), type: "poll", maxSelections: 3 },
      { ...question("ranking"), type: "ranking", rankCount: 2, maxSelections: undefined },
    ] as const) {
      const update = vi.fn();
      const wrapper = ResponseEditor({
        question: initial,
        uxBeta: true,
        multiSelectPollsEnabled: false,
        rankingPollsEnabled: false,
        onStructuralChange: vi.fn(),
        onUpdateChoiceQuestion: update,
        onUpdateQuestion: vi.fn(),
      }) as ReactElement<Record<string, unknown>>;
      const tree = (wrapper.type as (props: Record<string, unknown>) => ReactNode)(wrapper.props);
      const limit = elements(tree).find((element) => element.type === "select")!;
      expect(limit.props.disabled).toBe(true);
      expect(limit.props.value).toBe(initial.type === "poll" ? 3 : 2);
      (limit.props.onChange as (event: { target: { value: string } }) => void)({
        target: { value: "1" },
      });
      expect(update).not.toHaveBeenCalled();
    }
  });

  it("provides visible correctness labels and keeps opinion answers free of correctness controls", () => {
    const scored = renderToStaticMarkup(editorHarness(question("single_select")).render());
    expect(scored).toContain("Correct answer");
    expect(scored).toContain("Mark correct");
    expect(scored).toContain("Choose one correct answer.");
    const poll = renderToStaticMarkup(editorHarness(question("poll")).render());
    expect(poll).toContain("Collect opinions. There is no correct answer.");
    expect(poll).not.toContain("Mark correct");
    const ranking = renderToStaticMarkup(editorHarness(question("ranking")).render());
    expect(ranking).toContain("The order here does not define a correct answer.");
  });
});

function generalHarness(initial: QuestionDraft, uxBeta = true) {
  let draft = initial;
  const onUpdateQuestion: QuestionUpdater = (update) => {
    draft = update(draft);
  };
  const render = () =>
    ResponseEditor({
      question: draft,
      uxBeta,
      onStructuralChange: vi.fn(),
      onUpdateChoiceQuestion: vi.fn(),
      onUpdateQuestion,
    });
  return {
    draft: () => draft,
    render,
    change(index: number, value: string) {
      const field = elements(render()).filter(
        (element) => element.type === "input" || element.type === "select",
      )[index]!;
      (field.props.onChange as (event: { target: { value: string } }) => void)({
        target: { value },
      });
    },
  };
}

const numeric: QuestionDraft = {
  id: "numeric-question",
  prompt: "Estimate the area",
  type: "numeric",
  timeLimitSeconds: 30,
  basePoints: 1000,
  explanation: "Area is measured in square units.",
  mediaId: null,
  mediaAlt: null,
  correctValue: "4",
  tolerance: "0",
  unit: "m²",
};

describe("Round number, rating, and text response editors", () => {
  it("keeps decimal editing lossless and exposes invalid values without coercing them", () => {
    const harness = generalHarness(numeric);
    harness.change(0, "-0.0000000000000000004");
    harness.change(1, "-0.2");
    harness.change(2, "");
    expect(harness.draft()).toMatchObject({
      id: numeric.id,
      correctValue: "-0.0000000000000000004",
      tolerance: "-0.2",
      unit: null,
    });
    const fields = elements(harness.render()).filter((element) => element.type === "input");
    expect(fields[0]!.props["aria-invalid"]).toBe(false);
    expect(fields[1]!.props["aria-invalid"]).toBe(true);
    harness.change(0, "-");
    expect(
      elements(harness.render()).find((element) => element.type === "input")!.props["aria-invalid"],
    ).toBe(true);
    expect(harness.draft()).toMatchObject({ correctValue: "-" });
  });

  it("supports the full rating range and retains a valid pair of endpoints as either limit changes", () => {
    const harness = generalHarness({
      id: "rating-question",
      type: "rating",
      prompt: "How clear is this concept?",
      timeLimitSeconds: 30,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
      min: 1,
      max: 5,
      minLabel: "Unclear",
      maxLabel: "Very clear",
    });
    const selectors = elements(harness.render()).filter((element) => element.type === "select");
    expect(
      elements(selectors[0])
        .filter((element) => element.type === "option")
        .map((element) => element.props.value),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(
      elements(selectors[1])
        .filter((element) => element.type === "option")
        .map((element) => element.props.value),
    ).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    harness.change(0, "9");
    expect(harness.draft()).toMatchObject({ min: 9, max: 10 });
    harness.change(1, "2");
    expect(harness.draft()).toMatchObject({ min: 1, max: 2 });
    harness.change(2, "New low label");
    harness.change(3, "New high label");
    expect(harness.draft()).toMatchObject({
      minLabel: "New low label",
      maxLabel: "New high label",
    });
    const markup = renderToStaticMarkup(harness.render());
    expect(markup).toContain('aria-label="Scale preview"');
    expect(markup).toContain("New low label");
    expect(markup).not.toContain("choice-correct");
  });

  it.each(supportedLocales)(
    "gives accurate moderated open-text and word-cloud limits in %s",
    async (locale) => {
      fixtures.locale = locale;
      fixtures.messages = await loadDeliveryAuthoringMessages(locale);
      const copy = roundToolsCopy(locale);
      for (const [type, limit] of [
        ["open_text", 1000],
        ["word_cloud", 80],
      ] as const) {
        const harness = generalHarness({
          id: `text-${type}`,
          type,
          prompt: "Share one idea",
          timeLimitSeconds: 30,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        });
        const markup = renderToStaticMarkup(harness.render());
        expect(markup).toContain(
          copy("Up to {limit} characters per response", {
            limit: new Intl.NumberFormat(locale).format(limit),
          }),
        );
        expect(markup).toContain(
          copy("Responses need moderator approval before appearing to the audience."),
        );
        expect(markup).not.toMatch(/<(input|textarea|select)\b/);
        expect(harness.draft().id).toBe(`text-${type}`);
      }
    },
  );

  it("keeps the legacy text guidance available when the workspace beta is disabled", () => {
    const markup = renderToStaticMarkup(
      generalHarness(
        {
          id: "legacy-open-text",
          type: "open_text",
          prompt: "Share one idea",
          timeLimitSeconds: 30,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
        false,
      ).render(),
    );
    expect(markup).toContain("1000");
    expect(markup).not.toContain("Participant response");
  });
});
