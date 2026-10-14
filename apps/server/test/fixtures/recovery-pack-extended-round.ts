import { randomUUID } from "node:crypto";
import { QuestionDraftSchema } from "@openround/contracts";

export const extendedPackDestinationFormats = [
  ["poll", 2],
  ["ranking", 3],
  ["open_text", 4],
  ["word_cloud", 4],
] as const;

export type ExtendedPackDestinationFormat = (typeof extendedPackDestinationFormats)[number][0];

export function extendedPackDestinationQuestion(type: ExtendedPackDestinationFormat) {
  const common = {
    id: randomUUID(),
    type,
    prompt: "Share your priorities",
    purpose: "opinion",
    confidence: "off",
    delivery: "main",
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 30,
    basePoints: 0,
    explanation: "Responses are opinions.",
    mediaId: null,
    mediaAlt: null,
  };
  return QuestionDraftSchema.parse(
    type === "poll" || type === "ranking"
      ? {
          ...common,
          choices: ["Priority A", "Priority B", "Priority C"].map((label) => ({
            id: randomUUID(),
            label,
            isCorrect: false,
          })),
          ...(type === "poll" ? { maxSelections: 2 } : { rankCount: 2 }),
        }
      : common,
  );
}
