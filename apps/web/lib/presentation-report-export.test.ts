import { describe, expect, it } from "vitest";
import {
  PresentationReportSchema,
  type PresentationOpinionResultSummary,
} from "@openround/contracts";
import { presentationReportCsv } from "./presentation-report-export";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const summary: PresentationOpinionResultSummary = {
  kind: "ranking",
  blockId: id(1),
  responseCount: 2,
  rankCount: 2,
  totalRankings: 4,
  choices: [
    {
      choiceId: id(3),
      label: 'Plan, "A"\nNext',
      weightedScore: 3,
      rankedRespondents: 1,
      averageRank: 1,
      rankCounts: [1, 0],
    },
    {
      choiceId: id(4),
      label: '=HYPERLINK("bad")',
      weightedScore: 5,
      rankedRespondents: 2,
      averageRank: 1.5,
      rankCounts: [1, 1],
    },
    {
      choiceId: id(5),
      label: "C",
      weightedScore: 2,
      rankedRespondents: 1,
      averageRank: 2,
      rankCounts: [0, 1],
    },
  ],
};
function report() {
  return PresentationReportSchema.parse({
    schemaVersion: 4,
    sessionId: id(10),
    artifactType: "presentation",
    presentationId: id(11),
    presentationVersionId: id(12),
    title: "Priorities",
    status: "finished",
    trustMode: "learning",
    participantCount: 2,
    responseCount: 2,
    leaderboard: [],
    recovery: [],
    timeline: [],
    evidenceNote: "Opinions are unscored.",
    createdAt: "2026-11-04T00:00:00.000Z",
    finishedAt: "2026-11-04T00:01:00.000Z",
    evidence: [
      {
        blockId: id(1),
        blockIndex: 0,
        kind: "question",
        questionId: id(2),
        prompt: " \t@SUM(1)",
        questionType: "ranking",
        questionTypeLabel: "Ranking",
        delivery: "main",
        respondents: 2,
        correct: null,
        accuracyPercent: null,
        totalScore: 0,
        averageResponseMs: 1000,
        opinionSummary: summary,
      },
    ],
  });
}
// Independent reader: handles quoted separators, doubled quotes and multiline fields.
function records(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && char === "\r" && csv[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += char;
  }
  return rows;
}
describe("Presentation report evidence CSV", () => {
  it("exports all rank evidence with a stable rectangular shape and distinct result weights", () => {
    const value = report();
    const before = JSON.stringify(value);
    const rows = records(presentationReportCsv(value));
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.length === 26)).toBe(true);
    const at = (column: string) => rows[0]!.indexOf(column);
    expect(rows[2]![at("weighted_rank_points")]).toBe("5");
    expect(rows[2]![at("rank_1_count")]).toBe("1");
    expect(rows[2]![at("rank_2_count")]).toBe("1");
    expect(rows[2]![at("average_rank")]).toBe("1.5");
    expect(rows[2]![at("accuracy_percent")]).toBe("");
    expect(rows[2]![at("participant_score_total")]).toBe("0");
    expect(rows[1]![at("choice_label")]).toBe('Plan, "A"\nNext');
    expect(JSON.stringify(value)).toBe(before);
  });
  it("keeps formula-like authored text literal while retaining the original report", () => {
    const value = report();
    const rows = records(presentationReportCsv(value));
    expect(rows[1]![3]).toBe("' \t@SUM(1)");
    expect(rows[2]![10]).toBe('\'=HYPERLINK("bad")');
    expect(summary.choices[1]!.label.startsWith("=")).toBe(true);
  });
  it("preserves legacy evidence and rejects future reports rather than exporting partial data", () => {
    const current = report();
    const { opinionSummary: removedSummary, ...evidence } = current.evidence[0]! as Extract<
      (typeof current.evidence)[number],
      { kind: "question" }
    > & { opinionSummary?: unknown };
    expect(removedSummary).toEqual(summary);
    const legacy = PresentationReportSchema.parse({
      ...current,
      schemaVersion: 1,
      evidence: [{ ...evidence, questionType: "poll" }],
    });
    expect(records(presentationReportCsv(legacy))).toHaveLength(2);
    expect(() => presentationReportCsv({ ...current, schemaVersion: 99 } as never)).toThrow();
  });
});
