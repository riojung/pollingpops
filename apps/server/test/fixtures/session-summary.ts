import type { AggregateSessionSummary } from "@openround/contracts";

export function summaryFixture(): AggregateSessionSummary {
  return {
    schemaVersion: 1,
    kind: "round",
    title: "Français Português 日本語 한국어 简体中文 繁體中文 🧠",
    finishedAt: "2026-10-14T12:34:00.000Z",
    minimumRespondents: 5,
    participantCount: 12,
    responseCount: 20,
    questionCount: 2,
    initialAccuracy: { correct: 8, responses: 10, percent: 80 },
    questions: [
      {
        index: 0,
        prompt: "What should we revisit? 日本語 한국어 简体中文 繁體中文 👩‍💻",
        type: "poll",
        purpose: "opinion",
        respondents: 10,
        accuracy: null,
        suppression: "none",
        measure: "respondents",
        maxSelections: 2,
        results: [
          { label: "Examples & practice", value: 8 },
          { label: "Review <together>", value: 7 },
        ],
      },
      {
        index: 1,
        prompt: "Private written reflections",
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
    recovery: [{ kind: "linked", label: "Paired recheck", eligible: 5, recovered: 4, percent: 80 }],
    noteCodes: ["aggregate_only", "participant_text_excluded", "paired_evidence"],
    nextSteps: 'Practise again next week. =HYPERLINK("https://invalid.example") <script> & _x0041_',
  };
}
