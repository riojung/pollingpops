import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionDraft } from "@openround/contracts";
import { createPresentationQuestion } from "../../lib/presentation-builder";
import {
  PresentationActivitySlide,
  type PresentationActivityQuestion,
  type PresentationActivitySlideProps,
} from "./presentation-activity-slide";

const mocked = vi.hoisted(() => ({
  reading: false,
  overflow: false,
  setReading: vi.fn(),
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useState: () => [mocked.reading, mocked.setReading],
}));
vi.mock("./use-native-text-overflow", () => ({
  useNativeTextOverflow: () => ({ tabIndex: mocked.overflow ? 0 : undefined }),
}));

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  if (typeof node.type === "function" && node.type.name === "EditableText")
    return elements((node.type as (props: Record<string, unknown>) => ReactNode)(node.props));
  return [node, ...elements(node.props.children as ReactNode)];
}

function question(type: QuestionDraft["type"]): QuestionDraft {
  const value = createPresentationQuestion(type);
  return {
    ...value,
    prompt: "What should the group consider next?",
    explanation: "PRIVATE explanation should never appear",
    basePoints: 9876,
    ...(value.type === "numeric" ? { correctValue: "93871", tolerance: "93721", unit: "km" } : {}),
    ...("choices" in value
      ? {
          choices: value.choices.map((choice, index) => ({
            ...choice,
            label: `Choice ${index + 1}`,
          })),
        }
      : {}),
  } as QuestionDraft;
}

function markup(props: PresentationActivitySlideProps) {
  return renderToStaticMarkup(<PresentationActivitySlide {...props} />);
}

beforeEach(() => {
  mocked.reading = false;
  mocked.overflow = false;
  mocked.setReading.mockReset();
});

describe("Presentation activity slide", () => {
  it.each([
    ["single_select", "Choose one answer"],
    ["true_false", "Choose one answer"],
    ["multi_select", "Choose all answers that apply"],
    ["poll", "Choose one answer"],
    ["numeric", "Participants enter a number (km)"],
    ["rating", "Rating scale from 2 to 7"],
    ["ranking", "Put the choices in your preferred order"],
    ["open_text", "Share your response on your device"],
    ["word_cloud", "Share a word or short phrase on your device"],
  ] as const)("renders a minimal public %s projection without authoring fields", (type, hint) => {
    const choiceType = ["single_select", "true_false", "multi_select", "poll", "ranking"].includes(
      type,
    );
    const value: PresentationActivityQuestion = {
      type,
      prompt: "A public audience prompt",
      timeLimitSeconds: 30,
      choices: choiceType
        ? [
            { id: "a", label: "First public answer" },
            { id: "b", label: "Second public answer" },
          ]
        : [],
      ...(type === "numeric" ? { unit: "km" } : {}),
      ...(type === "rating"
        ? { rating: { min: 2, max: 7, minLabel: "Less", maxLabel: "More" } }
        : {}),
    };
    const result = markup({ question: value });
    expect(result).toContain("A public audience prompt");
    expect(result).toContain(hint);
    expect(result).toContain("30 seconds");
    expect(result).not.toContain("undefined");
    expect(result).not.toContain("NaN");
    expect(result.includes('aria-label="Answer choices"')).toBe(choiceType);
    if (choiceType) {
      expect(result).toContain("First public answer");
      expect(result).toContain("Second public answer");
    }
    if (type === "rating") {
      expect(result).toContain("Less");
      expect(result).toContain("More");
    }
  });

  it("prefers canonical public rating data over optional legacy aliases", () => {
    const result = markup({
      question: {
        type: "rating",
        prompt: "Rate the activity",
        timeLimitSeconds: 20,
        choices: [],
        rating: { min: 2, max: 7, minLabel: "Canonical low", maxLabel: "Canonical high" },
        min: 1,
        max: 5,
        minLabel: "Legacy low",
        maxLabel: "Legacy high",
      },
    });
    expect(result).toContain("Rating scale from 2 to 7");
    expect(result).toContain("Canonical low");
    expect(result).not.toContain("Legacy");
  });

  it("reveals only explicit public answer IDs and never reads draft correctness or private fields", () => {
    const value = question("single_select");
    if (!("choices" in value)) throw new Error("Expected choices");
    const privateRead = () => {
      throw new Error("The artwork must not read private answer data");
    };
    for (const choice of value.choices)
      Object.defineProperty(choice, "isCorrect", { enumerable: true, get: privateRead });
    for (const field of ["basePoints", "explanation", "sourceCitations"])
      Object.defineProperty(value, field, { enumerable: true, get: privateRead });
    expect(markup({ question: value })).not.toContain("Correct answer");
    const result = elements(
      PresentationActivitySlide({
        question: value,
        revealedChoiceIds: [value.choices[1]!.id, "unknown-answer"],
      }),
    );
    const revealed = result.filter((node) => node.props["data-revealed-correct"] === "true");
    expect(revealed).toHaveLength(1);
    expect(revealed[0]!.key).toBe(value.choices[1]!.id);
    const html = markup({ question: value, revealedChoiceIds: [value.choices[1]!.id] });
    expect(html.match(/Correct answer/g)).toHaveLength(1);
    expect(html).toContain('data-revealed-correct="true"');
    expect(
      markup({ question: value, editable: true, revealedChoiceIds: [value.choices[1]!.id] }),
    ).not.toContain("Correct answer");
    expect(
      markup({ question: value, staticThumbnail: true, revealedChoiceIds: [value.choices[1]!.id] }),
    ).not.toContain("Correct answer");
  });

  it("keeps a single thumbnail media-state attribute on the slide plane", () => {
    const empty = markup({ question: question("poll"), staticThumbnail: true });
    expect(empty).toContain('data-has-media="false"');
    expect(empty.match(/data-has-media=/g)).toHaveLength(1);
    const media = markup({
      question: question("poll"),
      staticThumbnail: true,
      media: <span>Media artwork</span>,
    });
    expect(media).toContain('data-has-media="true"');
    expect(media.match(/data-has-media=/g)).toHaveLength(1);
    expect(media).toContain('inert=""');
    expect(media).toContain('aria-hidden="true"');
  });

  it.each([
    ["single_select", "Multiple choice", "Choose one answer"],
    ["true_false", "True or false", "Choose one answer"],
    ["multi_select", "Multiple answers", "Choose all answers that apply"],
    ["poll", "Poll", "Choose one answer"],
    ["numeric", "Number response", "Participants enter a number (km)"],
    ["rating", "Rating", "Rating scale from 1 to 5"],
    ["ranking", "Ranking", "Put the choices in your preferred order"],
    ["open_text", "Open response", "Share your response on your device"],
    ["word_cloud", "Word cloud", "Share a word or short phrase on your device"],
  ] as const)(
    "represents %s without correctness, score or private author fields",
    (type, title, hint) => {
      const result = markup({ question: question(type) });
      expect(result).toContain(`Audience activity · ${title}`);
      expect(result).toContain(hint);
      expect(result).toContain("20 seconds");
      expect(result).not.toContain("PRIVATE");
      expect(result).not.toContain("9876");
      expect(result).not.toContain("93871");
      expect(result).not.toContain("93721");
      expect(result).not.toContain("isCorrect");
      expect(result).not.toContain("Submit");
      expect(result).not.toContain('type="radio"');
      expect(result).not.toContain('type="checkbox"');
    },
  );

  it("uses existing native theme, font and spacing tokens and keeps long labels complete", () => {
    const value = question("single_select");
    if (!("choices" in value)) throw new Error("Expected choices");
    value.prompt = "A prompt that asks the group to think about the available evidence. "
      .repeat(3)
      .slice(0, 140);
    value.choices = value.choices.map((choice, index) => ({
      ...choice,
      label:
        `${index + 1}: ${"A complete answer with enough detail to explain the reasoning and consequences. ".repeat(3)}`.slice(
          0,
          180,
        ),
    }));
    const result = markup({
      question: value,
      design: { theme: "sunset", font: "serif", spacing: "compact" },
    });
    expect(result).toContain('data-activity-theme="sunset"');
    expect(result).toContain('data-activity-font="serif"');
    expect(result).toContain('data-activity-spacing="compact"');
    expect(result).toContain("#fff0e5");
    expect(result).toContain("Georgia");
    expect(result).toContain(value.prompt);
    for (const choice of value.choices) expect(result).toContain(choice.label);
    expect(result.match(/role="listitem"/g)).toHaveLength(4);
    expect(result).not.toContain("<button");
  });

  it("keeps preview choices presentational even when edit callbacks are supplied", () => {
    const onPromptChange = vi.fn(),
      onChoiceChange = vi.fn(),
      onSelectChoice = vi.fn();
    const result = markup({
      question: question("poll"),
      onPromptChange,
      onChoiceChange,
      onSelectChoice,
    });
    expect(result).not.toContain("<textarea");
    expect(result).not.toContain("<button");
    expect(result).not.toContain("data-selected");
    expect(onPromptChange).not.toHaveBeenCalled();
    expect(onChoiceChange).not.toHaveBeenCalled();
    expect(onSelectChoice).not.toHaveBeenCalled();
  });

  it("edits only the named prompt or answer through the supplied history callbacks", () => {
    const value = question("single_select");
    if (!("choices" in value)) throw new Error("Expected choices");
    const baseline = structuredClone(value);
    const onPromptChange = vi.fn(),
      onChoiceChange = vi.fn(),
      onSelectChoice = vi.fn();
    const all = elements(
      PresentationActivitySlide({
        question: value,
        editable: true,
        onPromptChange,
        onChoiceChange,
        onSelectChoice,
        selectedChoiceId: value.choices[1]!.id,
      }),
    );
    const prompt = all.find((node) => node.props["aria-label"] === "Question prompt")!;
    const answer = all.find((node) => node.props["aria-label"] === "Slide answer B")!;
    expect(prompt.type).toBe("textarea");
    expect(answer.type).toBe("textarea");
    const text = "A complete revised answer.\nSecond line stays intact.";
    (prompt.props.onChange as (event: unknown) => void)({ target: { value: "Revised prompt" } });
    (answer.props.onFocus as () => void)();
    (answer.props.onChange as (event: unknown) => void)({ target: { value: text } });
    expect(onPromptChange).toHaveBeenCalledExactlyOnceWith("Revised prompt");
    expect(onChoiceChange).toHaveBeenCalledExactlyOnceWith(value.choices[1]!.id, text);
    expect(onSelectChoice).toHaveBeenCalledExactlyOnceWith(value.choices[1]!.id);
    expect(all.filter((node) => node.props["data-selected"] === "true")).toHaveLength(1);
    expect(value).toEqual(baseline);
  });

  it("retains true/false labels as read-only while allowing prompt editing", () => {
    const result = markup({
      question: question("true_false"),
      editable: true,
      onPromptChange: vi.fn(),
      onChoiceChange: vi.fn(),
    });
    expect(result).toContain('aria-label="Question prompt"');
    expect(result).not.toContain('aria-label="Slide answer');
    expect(result.match(/<textarea/g)).toHaveLength(1);
  });

  it("shows selection and ranking instructions from public limits", () => {
    const poll = { ...question("poll"), type: "poll" as const, maxSelections: 3 };
    expect(markup({ question: poll as QuestionDraft })).toContain("Choose up to 3 answers");
    const ranking = { ...question("ranking"), type: "ranking" as const, rankCount: 2 };
    expect(markup({ question: ranking as QuestionDraft })).toContain("Rank your top 2 choices");
  });

  it.each(["open_text", "word_cloud"] as const)(
    "retains disabled %s response control compatibility",
    (type) => {
      const result = markup({ question: question(type) });
      expect(result).toContain(type === "open_text" ? "<textarea" : "<input");
      expect(result).toContain('disabled=""');
      expect(result).toContain("-privacy");
      expect(result).toContain("-limit");
    },
  );

  it("offers a reversible reading view for extreme content and measured overflow", () => {
    const value = { ...question("poll"), prompt: "Long prompt. ".repeat(35) };
    let result = elements(PresentationActivitySlide({ question: value }));
    const button = result.find((node) => node.type === "button")!;
    expect(button.props.children).toBe("Reading view");
    (button.props.onClick as () => void)();
    const update = mocked.setReading.mock.calls[0]![0] as (value: boolean) => boolean;
    expect(update(false)).toBe(true);
    mocked.reading = true;
    result = elements(PresentationActivitySlide({ question: question("numeric") }));
    expect(
      result.find((node) => node.props["data-activity-reading-view"] === "true"),
    ).toBeDefined();
    expect(result.find((node) => node.type === "button")?.props.children).toBe("Slide view");
    mocked.reading = false;
    mocked.overflow = true;
    expect(markup({ question: question("numeric") })).toContain("Reading view");
  });

  it("renders inert thumbnail artwork without editing or response controls", () => {
    const result = markup({
      question: question("open_text"),
      staticThumbnail: true,
      editable: true,
      onPromptChange: vi.fn(),
    });
    expect(result).toContain('data-static-thumbnail="true"');
    expect(result).toContain('aria-hidden="true"');
    expect(result).toContain('inert=""');
    expect(result).toContain("A written response");
    expect(result).not.toContain("<button");
    expect(result).not.toContain("<textarea");
  });
});
