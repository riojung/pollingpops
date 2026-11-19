import { SurveyContentSchema, type SurveyResponses } from "../../src/surveys";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

/** Original synthetic fixture for aggregate-v2 byte compatibility, captured at ce79b19. */
export function surveyAggregateLegacyFixture(version: 1 | 2 | 3) {
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
  const content = SurveyContentSchema.parse({
    schemaVersion: version,
    title: "Legacy aggregate compatibility",
    items: [
      {
        required: true,
        question: {
          ...common,
          id: id(1),
          type: "poll",
          prompt: "Choose a direction",
          choices: [1, 2].map((value) => ({
            id: id(100 + value),
            label: `Direction ${value}`,
            isCorrect: false,
          })),
        },
      },
      {
        required: false,
        question: {
          ...common,
          id: id(2),
          type: "rating",
          prompt: "Optional rating",
          min: 1,
          max: 5,
          minLabel: "Low",
          maxLabel: "High",
        },
      },
      {
        required: false,
        question: {
          ...common,
          id: id(3),
          type: "poll",
          prompt: "Optional priorities",
          maxSelections: version === 1 ? 1 : 2,
          choices: [1, 2].map((value) => ({
            id: id(200 + value),
            label: `Priority ${value}`,
            isCorrect: false,
          })),
        },
      },
    ],
    ...(version === 3
      ? {
          pages: [1, 2, 3].map((value) => ({
            id: id(10 + value),
            title: `Section ${value}`,
            description: "",
            questionIds: [id(value)],
          })),
        }
      : {}),
  });
  const responses: SurveyResponses[] = Array.from({ length: 6 }, (_, index) => ({
    [id(1)]: { kind: "poll", choiceIds: [id(index === 5 ? 102 : 101)] },
    ...(index === 0 ? { [id(2)]: { kind: "rating", value: 4 } } : {}),
    ...(index < 5
      ? { [id(3)]: { kind: "poll", choiceIds: version === 1 ? [id(201)] : [id(201), id(202)] } }
      : {}),
  }));
  return { content, responses };
}
