import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { QuizContentSchema, supportedLocales, type QuizDraft } from "@openround/contracts";
import { SurveyContentSchema } from "@openround/contracts/surveys";
import {
  instantiateStarter,
  starterSummaries,
  starterSummariesForLocale,
} from "../src/starters.js";
import { surveyCreationCopy } from "../src/starter-localization.js";
import { StarterLocaleRequestSchema } from "../src/starter-locale-request.js";

function structure(draft: QuizDraft) {
  return {
    ...draft,
    title: "",
    description: "",
    questions: draft.questions.map((question) => ({
      ...question,
      id: "question",
      prompt: "",
      explanation: "",
      linkedRecheckQuestionId: question.linkedRecheckQuestionId ? "linked" : null,
      ...("choices" in question
        ? {
            choices: question.choices.map((choice) => ({
              ...choice,
              id: "choice",
              label: "",
              ...(choice.feedback ? { feedback: "" } : {}),
            })),
          }
        : {}),
      ...(question.type === "rating" ? { minLabel: "", maxLabel: "" } : {}),
      ...(question.type === "numeric" ? { unit: "" } : {}),
    })),
  };
}

describe("creation-only original starter catalogs", () => {
  it("pins the canonical English content so changes require review of positional translations", () => {
    const original = JSON.stringify(
      starterSummaries.map((summary) => ({ summary, draft: instantiateStarter(summary.id) })),
    ).replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/giu, "<id>");
    expect(createHash("sha256").update(original).digest("hex")).toBe(
      "b55f6c1322b9b9cb69c32512e2a3fe48791060416165afe226351f34569a85d8",
    );
  });
  it.each(supportedLocales)(
    "provides all 36 complete original templates in %s without changing semantics",
    (locale) => {
      const summaries = starterSummariesForLocale(locale);
      expect(summaries).toHaveLength(36);
      for (const summary of summaries) {
        const english = instantiateStarter(summary.id);
        const draft = instantiateStarter(summary.id, locale);
        expect(QuizContentSchema.safeParse(draft).success, `${locale}/${summary.id}`).toBe(true);
        expect(structure(draft)).toEqual(structure(english));
        expect(summary.title).toBe(draft.title);
        expect(summary.previewPrompt).toBe(draft.questions[0]!.prompt);
        expect(summary.version).toBe(1);
        if (locale !== "en-CA") {
          expect(draft.description).not.toBe(english.description);
          expect(draft.questions.map((question) => question.prompt)).not.toEqual(
            english.questions.map((question) => question.prompt),
          );
        }
        const copy = instantiateStarter(summary.id, locale);
        expect(copy.questions[0]!.id).not.toBe(draft.questions[0]!.id);
        for (const question of draft.questions)
          if (question.linkedRecheckQuestionId) {
            expect(
              draft.questions.some(
                (candidate) =>
                  candidate.id === question.linkedRecheckQuestionId &&
                  candidate.delivery === "recheck",
              ),
            ).toBe(true);
          }
        draft.title = "Author's own title";
        draft.questions[0]!.prompt = "Author's own question";
        expect(instantiateStarter(summary.id, locale).title).toBe(summary.title);
        expect(starterSummaries.find((entry) => entry.id === summary.id)!.title).toBe(
          english.title,
        );
      }
      const surveys = summaries.filter((entry) =>
        entry.responseTypes.every((type) => type === "poll" || type === "rating"),
      );
      expect(surveys).toHaveLength(17);
      for (const summary of surveys) {
        const draft = instantiateStarter(summary.id, locale);
        expect(
          SurveyContentSchema.safeParse({
            schemaVersion: 2,
            title: draft.title,
            description: surveyCreationCopy(locale).description,
            category: draft.category,
            experiencePreset: draft.experiencePreset,
            items: draft.questions.map((question) => ({ required: true, question })),
          }).success,
        ).toBe(true);
      }
    },
  );

  it("retains canonical English defaults and literal numeric answers", () => {
    expect(starterSummariesForLocale()).toEqual(starterSummaries);
    expect(structure(instantiateStarter("exit-ticket"))).toEqual(
      structure(instantiateStarter("exit-ticket", "en-CA")),
    );
    expect(instantiateStarter("exit-ticket").title).toBe("Exit ticket");
    expect(instantiateStarter("percentage-check", "ko-KR").questions[0]).toMatchObject({
      choices: [
        { label: "$55", isCorrect: false },
        { label: "$60", isCorrect: true },
        { label: "$75", isCorrect: false },
      ],
    });
    expect(instantiateStarter("technical-concept-check", "fr-FR").questions[1]).toMatchObject({
      correctValue: "4",
      tolerance: "0",
      unit: "tâches par seconde",
    });
    expect(surveyCreationCopy()).toEqual({
      title: "Untitled survey",
      description: "Answer independently at your own pace. This Survey is unscored.",
      copy: "(copy)",
    });
  });

  it("validates only explicit supported locale requests and defaults old requests to English", () => {
    expect(StarterLocaleRequestSchema.parse({})).toEqual({ locale: "en-CA" });
    for (const input of [
      { locale: "fr-CA" },
      { locale: "../../ko-KR" },
      { locale: ["ko-KR", "fr-FR"] },
      { locale: null },
      { locale: "ko-KR", extra: true },
    ]) {
      expect(StarterLocaleRequestSchema.safeParse(input).success).toBe(false);
    }
  });
});
