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
  it("preserves V6 navigation fields and exports V7 broadcast/branch counts without assessment claims", () => {
    const previous = report();
    const contentId = id(22);
    const sourceId = previous.evidence[0]!.blockId;
    const value = PresentationReportSchema.parse({
      ...previous,
      schemaVersion: 7,
      evidence: [
        ...previous.evidence,
        {
          blockId: contentId,
          blockIndex: 1,
          kind: "content",
          title: "Branch target",
          assessmentStatus: "not_assessed",
        },
      ],
      navigation: {
        jumpCount: 0,
        returnCount: 0,
        blocks: [
          {
            blockId: sourceId,
            sectionId: null,
            sectionTitle: null,
            status: "presented",
            phase: "question_reveal",
          },
          {
            blockId: contentId,
            sectionId: null,
            sectionTitle: null,
            status: "presented",
            phase: "content",
          },
        ],
      },
      interactionSummary: { revealChangeCount: 1, branchCount: 1 },
      timeline: [
        {
          sequence: 1,
          type: "navigation.branched",
          blockIndex: 1,
          blockId: contentId,
          occurredAt: "2026-11-04T00:00:30.000Z",
          navigation: {
            fromBlockId: sourceId,
            toBlockId: contentId,
            returnBlockId: sourceId,
            restored: false,
          },
          branch: {
            branchId: id(23),
            sourceBlockId: sourceId,
            targetBlockId: contentId,
            denominator: 2,
            matchedResponses: 1,
          },
        },
        {
          sequence: 2,
          type: "scene.reveal_changed",
          blockIndex: 1,
          blockId: contentId,
          occurredAt: "2026-11-04T00:00:31.000Z",
          interaction: { blockId: contentId, nodeId: "broadcast", revealed: true },
        },
      ],
    });
    const rows = records(presentationReportCsv(value));
    const at = (column: string) => rows[0]!.indexOf(column);
    expect(rows.every((row) => row.length === 39)).toBe(true);
    expect(rows[1]![at("presentation_status")]).toBe("presented");
    expect(rows[1]![at("broadcast_reveal_change_count")]).toBe("1");
    expect(rows[1]![at("answer_branch_count")]).toBe("1");
    expect(rows.at(-1)![at("participant_score_total")]).toBe("");
  });
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

  it("exports approved V5 text and cloud evidence alongside opinions without changing legacy columns", () => {
    const previous = report();
    const base = previous.evidence[0]!;
    if (base.kind !== "question") throw new Error("Question fixture required");
    const { opinionSummary: removed, ...question } = base as typeof base & {
      opinionSummary?: unknown;
    };
    expect(removed).toEqual(summary);
    const approved = ["=SUM(1)", 'Plan, "A"\nNext', "Practice", "Feedback", "Review"];
    const value = PresentationReportSchema.parse({
      ...previous,
      schemaVersion: 5,
      participantCount: 5,
      responseCount: 12,
      timeline: [20, 21].map((number, index) => ({
        sequence: index + 1,
        type: "question.revealed",
        blockIndex: index + 1,
        blockId: id(number),
        occurredAt: "2026-11-04T00:00:30.000Z",
      })),
      evidence: [
        base,
        {
          ...question,
          blockId: id(20),
          blockIndex: 1,
          questionType: "open_text",
          questionTypeLabel: "Open text",
          respondents: 5,
          textResults: {
            kind: "open_text",
            respondents: 5,
            entries: approved.map((value) => ({ value })),
          },
        },
        {
          ...question,
          blockId: id(21),
          blockIndex: 2,
          questionType: "word_cloud",
          questionTypeLabel: "Word cloud",
          respondents: 5,
          textResults: {
            kind: "word_cloud",
            respondents: 5,
            buckets: [
              { value: "café", label: "Café", count: 3, percent: 60 },
              { value: "practice", label: "Practice", count: 2, percent: 40 },
            ],
          },
        },
        {
          blockId: id(22),
          blockIndex: 3,
          kind: "content",
          title: "Wrap-up",
          assessmentStatus: "not_assessed",
        },
      ],
    });
    const before = JSON.stringify(value);
    const rows = records(presentationReportCsv(value));
    const legacyRows = records(presentationReportCsv(previous));
    expect(rows.every((row) => row.length === 31)).toBe(true);
    expect(rows.slice(0, 4).map((row) => row.slice(0, 26))).toEqual(legacyRows);
    const at = (column: string) => rows[0]!.indexOf(column);
    expect(rows[4]![at("approved_text")]).toBe("'=SUM(1)");
    expect(rows[5]![at("approved_text")]).toBe('Plan, "A"\nNext');
    expect(rows[9]![at("word_or_phrase")]).toBe("Café");
    expect(rows[9]![at("term_count")]).toBe("3");
    expect(rows[9]![at("approved_respondents")]).toBe("5");
    expect(rows[9]![at("percent_of_approved_respondents")]).toBe("60");
    expect(rows.at(-1)!.slice(26)).toEqual(Array(5).fill(""));
    expect(JSON.stringify(value)).toBe(before);
  });

  it("exports V6 section and presentation history without treating a skipped activity as a zero-score answer", () => {
    const previous = report();
    const original = previous.evidence[0]!;
    if (original.kind !== "question") throw new Error("Question fixture required");
    const { opinionSummary: _removed, ...question } = original as typeof original & {
      opinionSummary?: unknown;
    };
    expect(_removed).toEqual(summary);
    const skipped = {
      ...question,
      blockId: id(22),
      blockIndex: 1,
      prompt: "Never asked",
      respondents: 0,
    };
    const value = PresentationReportSchema.parse({
      ...previous,
      schemaVersion: 6,
      evidence: [original, skipped],
      navigation: {
        jumpCount: 2,
        returnCount: 1,
        blocks: [
          {
            blockId: original.blockId,
            sectionId: id(30),
            sectionTitle: "=SUM(1)",
            status: "presented",
            phase: "question_reveal",
          },
          {
            blockId: skipped.blockId,
            sectionId: null,
            sectionTitle: null,
            status: "skipped",
            phase: null,
          },
        ],
      },
    });
    const rows = records(presentationReportCsv(value));
    const at = (column: string) => rows[0]!.indexOf(column);
    expect(rows.every((row) => row.length === 37)).toBe(true);
    expect(rows[1]![at("presentation_status")]).toBe("presented");
    expect(rows[1]![at("section_title")]).toBe("'=SUM(1)");
    expect(rows[1]![at("navigation_jump_count")]).toBe("2");
    const skippedRow = rows.at(-1)!;
    expect(skippedRow[at("presentation_status")]).toBe("skipped");
    expect(skippedRow[at("respondents")]).toBe("");
    expect(skippedRow[at("participant_score_total")]).toBe("");
    expect(skippedRow[at("saved_phase")]).toBe("");
  });
});
