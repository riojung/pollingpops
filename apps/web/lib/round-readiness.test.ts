import { describe, expect, it } from "vitest";
import type { QuizDraft } from "@openround/contracts";
import { roundReadinessIssues } from "./round-readiness";

describe("round readiness", () => {
  it("enforces the bounded text checkpoint count with a useful split-round explanation", () => {
    const questions: QuizDraft["questions"] = Array.from({ length: 11 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      type: index % 2 ? "word_cloud" : "open_text",
      prompt: "Share an idea",
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      basePoints: 0,
      timeLimitSeconds: 60,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    }));
    expect(
      roundReadinessIssues(
        { title: "Text discussion", description: "", questions: questions.slice(0, 10) },
        true,
      ),
    ).toEqual([]);
    expect(
      roundReadinessIssues({ title: "Text discussion", description: "", questions }, true),
    ).toContainEqual(
      expect.objectContaining({
        id: "text-question-limit",
        resolution: expect.stringContaining("Split additional questions into another Round"),
      }),
    );
  });
  it("returns an aggregate issue map keyed to the affected questions", () => {
    const draft: QuizDraft = {
      title: "",
      description: "",
      questions: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          type: "single_select",
          prompt: "",
          purpose: "diagnostic",
          confidence: "off",
          delivery: "main",
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
          choices: [
            { id: "00000000-0000-4000-8000-000000000011", label: "", isCorrect: true },
            { id: "00000000-0000-4000-8000-000000000012", label: "", isCorrect: false },
          ],
        },
      ],
    };

    const issues = roundReadinessIssues(draft, true);
    expect(issues.map((issue) => issue.id)).toEqual([
      "round-title",
      "question-00000000-0000-4000-8000-000000000001",
    ]);
    expect(issues[1]?.resolution).toContain("fill answer choices 1 and 2");
    expect(issues[1]?.questionIndex).toBe(0);
  });

  it("returns no issues for a complete poll", () => {
    const draft: QuizDraft = {
      title: "Lunch pulse",
      description: "",
      questions: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          type: "poll",
          prompt: "Where should we eat?",
          purpose: "opinion",
          confidence: "off",
          delivery: "main",
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 20,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
          choices: [
            {
              id: "00000000-0000-4000-8000-000000000021",
              label: "Cafe",
              isCorrect: false,
            },
            {
              id: "00000000-0000-4000-8000-000000000022",
              label: "Park",
              isCorrect: false,
            },
          ],
        },
      ],
    };

    expect(roundReadinessIssues(draft, true)).toEqual([]);
  });
});
