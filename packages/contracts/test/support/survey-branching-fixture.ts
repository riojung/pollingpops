import { SurveyBranchingContentSchema } from "../../src/survey-branching";

export const branchingId = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

/** Synthetic proposed v4 document only; never seed it into a production repository. */
export function surveyBranchingFixture() {
  const common = {
    purpose: "opinion",
    confidence: "off",
    delivery: "main",
    timeLimitSeconds: 30,
    basePoints: 0,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
  return SurveyBranchingContentSchema.parse({
    schemaVersion: 4,
    title: "Proposed conditional feedback",
    items: [
      ...[1, 2].map((value) => ({
        required: true,
        question: {
          ...common,
          id: branchingId(value),
          type: "poll",
          prompt: value === 1 ? "Show follow-up?" : "Show detailed feedback?",
          choices: [1, 2].map((choice) => ({
            id: branchingId(value * 100 + choice),
            label: choice === 1 ? "Yes" : "No",
            isCorrect: false,
          })),
        },
      })),
      ...[3, 4].map((value) => ({
        required: value === 3,
        question: {
          ...common,
          id: branchingId(value),
          type: "rating",
          prompt: `Feedback ${value}`,
          min: 1,
          max: 5,
          minLabel: "Low",
          maxLabel: "High",
        },
      })),
    ],
    pages: [1, 2, 3, 4].map((value) => ({
      id: branchingId(value + 10),
      title: `Page ${value}`,
      description: `Instructions ${value}`,
      questionIds: [branchingId(value)],
      ...(value === 2 || value === 3
        ? {
            visibleWhen: {
              kind: "choice_equals",
              questionId: branchingId(value - 1),
              choiceId: branchingId((value - 1) * 100 + 1),
            },
          }
        : {}),
    })),
  });
}
