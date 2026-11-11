import { supportedLocales, PresentationSceneDraftSchema } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { creationContent } from "./creation-content";
import { questionStarterContent } from "./question-starter-content";
import { createQuestionBlock, changePresentationQuestionType } from "../presentation-builder";
import { createNativeTableNode, createNativeChartNode } from "../presentation-native-data";
import { createNativeContentBlock } from "../presentation-native-scene";
import { newSurveyQuestion } from "../../components/survey-controls";

describe("explicit creation language", () => {
  it.each(supportedLocales)(
    "creates valid table/chart data and question defaults in %s",
    (locale) => {
      const copy = creationContent(locale);
      const table = createNativeTableNode(locale);
      const chart = createNativeChartNode("line", locale);
      const base = createNativeContentBlock().scene!;
      expect(
        PresentationSceneDraftSchema.safeParse({
          ...base,
          schemaVersion: 4,
          nodes: [...base.nodes, table, chart],
          readingOrder: [...base.readingOrder, table.id, chart.id],
        }).success,
      ).toBe(true);
      expect(table.rows.map((row) => row[1])).toEqual(["10", "20"]);
      expect(chart.series[0]!.values).toEqual([10, 20, 15]);
      expect(chart.chartType).toBe("line");
      expect(chart.summary).toContain("10");
      expect(chart.summary).toContain("20");
      expect(chart.summary).toContain("15");
      const question = createQuestionBlock("true_false", locale).question;
      if (question.type !== "true_false") throw new Error("Expected choices");
      expect(question.choices.map((choice) => choice.label)).toEqual([copy("true"), copy("false")]);
      expect(question.choices.map((choice) => choice.isCorrect)).toEqual([true, false]);
      expect(newSurveyQuestion("rating", locale)).toMatchObject({
        minLabel: copy("notAtAll"),
        maxLabel: copy("veryMuch"),
        basePoints: 0,
      });
      const survey = newSurveyQuestion("poll", locale);
      expect(survey.type === "poll" && survey.choices.map((choice) => choice.label)).toEqual([
        copy("option", 1),
        copy("option", 2),
      ]);
      if (locale !== "en-CA") {
        expect(table.caption).not.toBe(createNativeTableNode().caption);
        expect(chart.summary).not.toBe(createNativeChartNode().summary);
      }
    },
  );

  it("uses a new locale only for newly created fields and preserves previous authored content", () => {
    const block = createQuestionBlock("true_false", "fr-FR");
    const draft = {
      schemaVersion: 2 as const,
      title: "Original 제목",
      description: "",
      experiencePreset: { id: "focus" as const, version: 1 as const },
      blocks: [
        {
          ...block,
          question: {
            ...block.question,
            prompt: "Original question",
            explanation: "Authored explanation",
          },
        },
      ],
    };
    const before = structuredClone(draft);
    createNativeTableNode("ko-KR");
    createQuestionBlock("true_false", "ko-KR");
    expect(draft).toEqual(before);
    // Changing type is an explicit creation action; shared authored fields survive.
    const next = changePresentationQuestionType(draft, block.id, "rating", "ko-KR");
    expect(next.blocks[0]).toMatchObject({
      question: {
        id: block.question.id,
        prompt: "Original question",
        explanation: "Authored explanation",
        minLabel: "낮음",
        maxLabel: "높음",
      },
    });
    expect(draft).toEqual(before);
    expect(createNativeTableNode().caption).toBe("Illustrative sample table");
    expect(createQuestionBlock("true_false").question).toMatchObject({
      choices: [{ label: "True" }, { label: "False" }],
    });
  });

  it.each(supportedLocales)(
    "quotes arbitrary authored replacement tokens literally in %s",
    (locale) => {
      const title = "原文 $& $` $' {title}";
      const copy = questionStarterContent(locale, title);
      expect(copy.discussion.split(title)).toHaveLength(2);
      expect(copy.clarity.split(title)).toHaveLength(2);
      expect(copy.priority.split(title)).toHaveLength(2);
      expect(copy.minLabel).toBeTruthy();
      expect(copy.maxLabel).toBeTruthy();
    },
  );
});
