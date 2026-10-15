import { AggregateSessionSummarySchema, type SessionSummaryPreview } from "@openround/contracts";

export const summarySource = { kind: "round" as const, id: "00000000-0000-4000-8000-000000000001" };
export const summaryFixture = AggregateSessionSummarySchema.parse({
  schemaVersion: 1,
  kind: "round",
  title: "Synthetic session summary",
  finishedAt: "2026-10-14T12:00:00.000Z",
  minimumRespondents: 5,
  participantCount: 8,
  responseCount: 13,
  questionCount: 2,
  initialAccuracy: { correct: 3, responses: 8, percent: 37.5 },
  recovery: [
    { kind: "linked", label: "Synthetic recheck", eligible: 5, recovered: 3, percent: 60 },
  ],
  questions: [
    {
      index: 0,
      prompt: "Synthetic priorities",
      type: "poll",
      purpose: "opinion",
      respondents: 8,
      accuracy: null,
      suppression: "none",
      measure: "respondents",
      maxSelections: 2,
      results: [
        { label: "Practice", value: 8 },
        { label: "Examples", value: 5 },
      ],
    },
    {
      index: 1,
      prompt: "Synthetic text question",
      type: "open_text",
      purpose: "opinion",
      respondents: null,
      accuracy: null,
      suppression: "participant_text",
      measure: "respondents",
      maxSelections: null,
      results: [],
    },
  ],
  noteCodes: ["aggregate_only", "participant_text_excluded", "paired_evidence"],
  nextSteps: "Review the aggregate evidence.",
});
export const summaryPreviewFixture: SessionSummaryPreview = {
  source: summarySource,
  summary: summaryFixture,
  sourceExpiresAt: "2026-10-18T12:00:00.000Z",
  capabilities: {
    canCreateShare: true,
    canRevokeShare: true,
    downloadFormats: ["pdf", "png", "xlsx"],
    reasonCodes: [],
  },
};
