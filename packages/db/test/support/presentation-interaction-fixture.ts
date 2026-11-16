import { randomUUID } from "node:crypto";
import { PresentationDraftSchema } from "@openround/contracts";
import { presentationSceneBlock } from "./presentation-scene-conformance.js";

export function interactionDocument() {
  const base = {
    prompt: "Share",
    purpose: "opinion",
    confidence: "off",
    delivery: "main",
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 30,
    basePoints: 0,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
  const choices = () =>
    ["First", "Second", "Third"].map((label) => ({ id: randomUUID(), label, isCorrect: false }));
  return PresentationDraftSchema.parse({
    title: "Public interactions and existing activities",
    schemaVersion: 11,
    blocks: [
      presentationSceneBlock([], true, true, true, true),
      ...[
        { ...base, type: "poll", maxSelections: 2, choices: choices() },
        { ...base, type: "ranking", rankCount: 2, choices: choices() },
        { ...base, type: "open_text" },
        { ...base, type: "word_cloud" },
        {
          ...base,
          type: "single_select",
          basePoints: 1000,
          purpose: "diagnostic",
          choices: choices().map((choice, index) => ({ ...choice, isCorrect: index === 0 })),
        },
        { ...base, type: "rating", min: 1, max: 5, minLabel: "Low", maxLabel: "High" },
        {
          ...base,
          type: "numeric",
          purpose: "diagnostic",
          basePoints: 1000,
          correctValue: "4",
          tolerance: "0",
          unit: "",
        },
      ].map((question) => ({
        id: randomUUID(),
        kind: "question",
        question: { ...question, id: randomUUID() },
      })),
    ],
  });
}
