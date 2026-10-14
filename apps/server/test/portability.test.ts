import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  recoveryPackContentHash,
  RecoveryPackContentSchema,
  QuestionDraftSchema,
  type QuizDraft,
} from "@openround/contracts";
import { checkpointSetCsv, importCheckpointSet, openRoundJson } from "../src/portability.js";
import { exportQtiPackage } from "../src/qti.js";

function linkedDraft(): QuizDraft {
  const mainId = randomUUID();
  const recheckId = randomUUID();
  return {
    title: "Safe handling",
    description: "Diagnose, intervene, and recheck.",
    questions: [
      {
        id: mainId,
        type: "single_select",
        prompt: "=Which procedure is safe?",
        purpose: "diagnostic",
        confidence: "required",
        delivery: "main",
        conceptKeys: ["safe-work"],
        linkedRecheckQuestionId: recheckId,
        choices: [
          { id: randomUUID(), label: "Complete procedure", isCorrect: true },
          {
            id: randomUUID(),
            label: "Shortcut",
            isCorrect: false,
            misconceptionKey: "shortcut-is-safe",
          },
        ],
        timeLimitSeconds: 20,
        basePoints: 1_000,
        explanation: "Use the complete procedure.",
        mediaId: randomUUID(),
        mediaAlt: "A worker using protective equipment",
      },
      {
        id: recheckId,
        type: "numeric",
        prompt: "How many checks are required?",
        purpose: "practice",
        confidence: "optional",
        delivery: "recheck",
        conceptKeys: ["safe-work"],
        linkedRecheckQuestionId: null,
        correctValue: "3",
        tolerance: "0",
        unit: "checks",
        timeLimitSeconds: 30,
        basePoints: 1_000,
        explanation: "All three checks are required.",
        mediaId: null,
        mediaAlt: null,
      },
      {
        id: randomUUID(),
        type: "rating",
        prompt: "How useful was the example?",
        purpose: "opinion",
        confidence: "off",
        delivery: "main",
        conceptKeys: [],
        linkedRecheckQuestionId: null,
        min: 1,
        max: 5,
        minLabel: "Not useful",
        maxLabel: "Very useful",
        timeLimitSeconds: 20,
        basePoints: 0,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
}

describe("checkpoint-set portability", () => {
  function multipleSelectionPoll(): QuizDraft {
    const question = linkedDraft().questions[0]!;
    if (question.type !== "single_select") throw new Error("Expected single-choice fixture");
    return {
      title: "Meeting priorities",
      description: "",
      questions: [
        {
          ...question,
          type: "poll",
          purpose: "opinion",
          confidence: "off",
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          basePoints: 0,
          mediaId: null,
          mediaAlt: null,
          maxSelections: 2,
          choices: question.choices.map(({ id, label }) => ({ id, label, isCorrect: false })),
        },
      ],
    };
  }

  function rankingDraft(): QuizDraft {
    const source = multipleSelectionPoll();
    const question = source.questions[0]!;
    if (question.type !== "poll") throw new Error("Expected poll fixture");
    return {
      ...source,
      questions: [
        QuestionDraftSchema.parse({
          ...question,
          type: "ranking",
          maxSelections: undefined,
          rankCount: 2,
        }),
      ],
    };
  }

  function textOpinionDraft(type: "open_text" | "word_cloud"): QuizDraft {
    return {
      title: "Meeting feedback",
      description: "",
      questions: [
        {
          id: randomUUID(),
          type,
          prompt: "What should we improve?",
          purpose: "opinion",
          confidence: "off",
          delivery: "main",
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 30,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    };
  }

  it.each(["open_text", "word_cloud"] as const)(
    "preserves %s in native version 7 and CSV",
    (type) => {
      const source = textOpinionDraft(type);
      const json = openRoundJson(source);
      expect(JSON.parse(json)).toMatchObject({ version: 7 });
      for (const [format, data] of [
        ["openround_json", json],
        ["csv", checkpointSetCsv(source)],
      ] as const) {
        const result = importCheckpointSet(format, data);
        expect(result.validation.errors).toEqual([]);
        expect(result.draft!.questions[0]).toMatchObject({
          type,
          purpose: "opinion",
          confidence: "off",
          basePoints: 0,
        });
        expect(result.draft!.questions[0]!.id).not.toBe(source.questions[0]!.id);
      }
    },
  );

  it.each(["open_text", "word_cloud"] as const)(
    "rejects %s in legacy versions and QTI without partial conversion",
    async (type) => {
      const source = textOpinionDraft(type);
      const file = JSON.parse(openRoundJson(source));
      for (const version of [1, 2, 3, 4, 5, 6, 8]) {
        expect(
          importCheckpointSet("openround_json", JSON.stringify({ ...file, version })).draft,
        ).toBeNull();
      }
      const qti = await exportQtiPackage(source);
      expect(qti.archive).toBeNull();
      expect(qti.validation.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "UNSUPPORTED_QTI_CHECKPOINT" })]),
      );
    },
  );

  it("round-trips ranking bounds in version 6 JSON and CSV without losing options", () => {
    const source = rankingDraft();
    const original = source.questions[0]!;
    if (!("choices" in original)) throw new Error("Expected ranking choices");
    const json = openRoundJson(source);
    expect(JSON.parse(json)).toMatchObject({ version: 6 });
    for (const [format, data] of [
      ["openround_json", json],
      ["csv", checkpointSetCsv(source)],
    ] as const) {
      const result = importCheckpointSet(format, data);
      expect(result.validation.errors).toEqual([]);
      expect(result.draft!.questions[0]).toMatchObject({ type: "ranking", rankCount: 2 });
      const copied = result.draft!.questions[0]!;
      expect("choices" in copied && copied.choices.map((choice) => choice.label)).toEqual(
        original.choices.map((choice) => choice.label),
      );
    }
  });

  it("rejects ranking in old native versions and the learning-only QTI profile", async () => {
    const source = rankingDraft();
    const file = JSON.parse(openRoundJson(source));
    for (const version of [1, 2, 3, 4, 5, 8]) {
      const result = importCheckpointSet("openround_json", JSON.stringify({ ...file, version }));
      expect(result.draft).toBeNull();
    }
    const qti = await exportQtiPackage(source);
    expect(qti.archive).toBeNull();
    expect(qti.validation.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "UNSUPPORTED_QTI_CHECKPOINT" })]),
    );
  });

  it("rejects CSV ranking counts that exceed the available options", () => {
    const source = rankingDraft();
    if (source.questions[0]!.type !== "ranking") throw new Error("Expected ranking fixture");
    const csv = checkpointSetCsv(source).replace(/,,2\r\n$/, ",,3\r\n");
    const result = importCheckpointSet("csv", csv);
    expect(result.draft).toBeNull();
    expect(result.validation.errors.length).toBeGreaterThan(0);
  });

  it("round-trips multiple-selection opinion limits in version 5 JSON and fresh-ID CSV", () => {
    const source = multipleSelectionPoll();
    const json = openRoundJson(source);
    expect(JSON.parse(json)).toMatchObject({ version: 5 });
    for (const [format, data] of [
      ["openround_json", json],
      ["csv", checkpointSetCsv(source)],
    ] as const) {
      const imported = importCheckpointSet(format, data);
      expect(imported.validation.errors).toEqual([]);
      const question = imported.draft!.questions[0]!;
      expect(question).toMatchObject({ type: "poll", maxSelections: 2, basePoints: 0 });
      expect(question.id).not.toBe(source.questions[0]!.id);
      expect("choices" in question && question.choices[0]!.id).not.toBe(
        "choices" in source.questions[0]! && source.questions[0].choices[0]!.id,
      );
    }
  });

  it("reads older CSV without a selection-limit column as a single-selection poll", () => {
    const source = multipleSelectionPoll();
    const sourceQuestion = source.questions[0]!;
    if (sourceQuestion.type !== "poll") throw new Error("Expected poll");
    sourceQuestion.maxSelections = 1;
    const oldCsv = checkpointSetCsv(source)
      .split("\r\n")
      .map((row) => row.replace(/,[^,]*,[^,]*$/, ""))
      .join("\r\n");
    const imported = importCheckpointSet("csv", oldCsv);
    expect(imported.validation.errors).toEqual([]);
    const question = imported.draft!.questions[0]!;
    expect(question.type === "poll" && (question.maxSelections ?? 1)).toBe(1);
  });

  it.each(["0", "7", "2.5", "2junk"])(
    "rejects malformed CSV opinion selection limit %s",
    (limit) => {
      const csv = checkpointSetCsv(multipleSelectionPoll()).replace(/,2,\r\n$/, `,${limit},\r\n`);
      const imported = importCheckpointSet("csv", csv);
      expect(imported.draft).toBeNull();
      expect(imported.validation.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining("max_selections") }),
        ]),
      );
    },
  );

  it("rejects relabelling an extended poll export as an older interchange version", () => {
    const file = JSON.parse(openRoundJson(multipleSelectionPoll()));
    for (const version of [1, 2, 3, 4, 8]) {
      const result = importCheckpointSet("openround_json", JSON.stringify({ ...file, version }));
      expect(result.draft).toBeNull();
      expect(result.validation.errors.length).toBeGreaterThan(0);
    }
  });

  it("removes precisely the exporter protection for whitespace-prefixed spreadsheet cells", () => {
    const source = linkedDraft();
    source.questions[0]!.prompt = " \t=Whitespace-prefixed expression";
    source.questions[1]!.explanation = "\n+Line-prefixed expression";
    const exported = checkpointSetCsv(source);
    expect(exported).toContain("' \t=Whitespace-prefixed expression");
    const imported = importCheckpointSet("csv", exported);
    expect(imported.validation.errors).toEqual([]);
    expect(imported.draft!.questions[0]!.prompt).toBe("=Whitespace-prefixed expression");
    expect(imported.draft!.questions[1]!.explanation).toBe("+Line-prefixed expression");
  });
  it("round-trips Pack-backed v3 JSON with fresh destination IDs and an unchanged source baseline", () => {
    const source = linkedDraft();
    source.questions[0]!.mediaId = null;
    source.questions[0]!.mediaAlt = null;
    const content = RecoveryPackContentSchema.parse({
      schemaVersion: 1,
      title: "Safe handling Pack",
      description: "",
      diagnostic: source.questions[0],
      recheck: source.questions[1],
      delayedProbe: null,
      interventions: [
        {
          id: randomUUID(),
          title: "Explain safe handling",
          body: "Use the complete procedure.",
          citations: [],
        },
      ],
      conceptKeys: ["safe-work"],
      misconceptionKeys: [],
      citations: [],
    });
    source.recoveryPackInsertions = [
      {
        id: randomUUID(),
        packId: randomUUID(),
        packVersionId: randomUUID(),
        packVersion: 1,
        contentHash: recoveryPackContentHash(content),
        diagnosticQuestionId: source.questions[0]!.id,
        recheckQuestionId: source.questions[1]!.id,
        originalContent: content,
      },
    ];
    const exported = openRoundJson(source);
    expect(JSON.parse(exported)).toMatchObject({ version: 3 });
    const imported = importCheckpointSet("openround_json", exported);
    expect(imported.validation.errors).toEqual([]);
    const insertion = imported.draft!.recoveryPackInsertions![0]!;
    expect(insertion.id).not.toBe(source.recoveryPackInsertions[0]!.id);
    expect(insertion.diagnosticQuestionId).toBe(imported.draft!.questions[0]!.id);
    expect(insertion.recheckQuestionId).toBe(imported.draft!.questions[1]!.id);
    expect(insertion.originalContent).toEqual(content);
    expect(insertion.contentHash).toBe(source.recoveryPackInsertions[0]!.contentHash);

    const accepted = structuredClone(content);
    accepted.interventions[0]!.body = "Use this revised facilitator guidance.";
    source.recoveryPackInsertions[0]!.updateBaseline = {
      packVersionId: randomUUID(),
      packVersion: 2,
      contentHash: recoveryPackContentHash(accepted),
      content: accepted,
    };
    const updatedExport = openRoundJson(source);
    expect(JSON.parse(updatedExport)).toMatchObject({ version: 4 });
    const updatedImport = importCheckpointSet("openround_json", updatedExport);
    expect(updatedImport.validation.errors).toEqual([]);
    const updatedInsertion = updatedImport.draft!.recoveryPackInsertions![0]!;
    expect(updatedInsertion.originalContent).toEqual(content);
    expect(updatedInsertion.updateBaseline).toEqual(
      source.recoveryPackInsertions[0]!.updateBaseline,
    );
    expect(updatedInsertion.diagnosticQuestionId).toBe(updatedImport.draft!.questions[0]!.id);
    expect(updatedInsertion.id).not.toBe(source.recoveryPackInsertions[0]!.id);
  });
  it("round-trips Polling Pops JSON with fresh IDs and an explicit media warning", () => {
    const source = linkedDraft();
    const imported = importCheckpointSet("openround_json", openRoundJson(source));

    expect(imported.validation.errors).toEqual([]);
    expect(imported.validation).toMatchObject({
      format: "openround_json",
      importedCheckpoints: 3,
      warnings: [{ code: "MEDIA_REFERENCE_REMOVED", row: 1, field: "mediaId" }],
    });
    expect(imported.draft).not.toBeNull();
    expect(imported.draft!.questions[0]!.id).not.toBe(source.questions[0]!.id);
    expect(imported.draft!.questions[0]!.linkedRecheckQuestionId).toBe(
      imported.draft!.questions[1]!.id,
    );
    expect(imported.draft!.questions[0]!.mediaId).toBeNull();
    expect(imported.draft!.questions[0]!.mediaAlt).toBeNull();
  });

  it("round-trips CSV checkpoint types, relationships, and spreadsheet-like text safely", () => {
    const source = linkedDraft();
    source.questions[0]!.mediaId = null;
    source.questions[0]!.mediaAlt = null;
    const csv = checkpointSetCsv(source);

    expect(csv).toContain("'=Which procedure is safe?");
    const imported = importCheckpointSet("csv", csv, "Imported safety set");

    expect(imported.validation.errors).toEqual([]);
    expect(imported.validation.warnings).toContainEqual(
      expect.objectContaining({ code: "PRESENTATION_DEFAULTED" }),
    );
    expect(imported.draft).toMatchObject({ title: "Imported safety set" });
    expect(imported.draft!.questions.map((question) => question.type)).toEqual([
      "single_select",
      "numeric",
      "rating",
    ]);
    expect(imported.draft!.questions[0]!.prompt).toBe("=Which procedure is safe?");
    expect(imported.draft!.questions[0]!.linkedRecheckQuestionId).toBe(
      imported.draft!.questions[1]!.id,
    );
  });

  it("returns validation errors instead of partially importing malformed CSV", () => {
    const missingHeaders = importCheckpointSet("csv", "type,prompt\nsingle_select,Question");
    expect(missingHeaders.draft).toBeNull();
    expect(missingHeaders.validation.errors[0]?.code).toBe("MISSING_HEADERS");

    const source = linkedDraft();
    const csv = checkpointSetCsv(source).replace(
      `${source.questions[0]!.id},${source.questions[1]!.id},`,
      `${source.questions[0]!.id},missing-checkpoint,`,
    );
    const brokenLink = importCheckpointSet("csv", csv);
    expect(brokenLink.draft).toBeNull();
    expect(brokenLink.validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_CHECKPOINT",
          message: expect.stringContaining("does not exist"),
        }),
      ]),
    );
  });

  it("imports documented bulk-paste blocks and explains invalid blocks", () => {
    const imported = importCheckpointSet(
      "bulk",
      "Which option is safe?\n* Complete procedure\n- Shortcut\n\nPPE is optional.\n- True\n* False",
      "Bulk safety set",
    );
    expect(imported.validation.errors).toEqual([]);
    expect(imported.draft).toMatchObject({
      title: "Bulk safety set",
      questions: [{ type: "single_select" }, { type: "single_select" }],
    });

    const invalid = importCheckpointSet("bulk", "Question\n* First\n* Second");
    expect(invalid.draft).toBeNull();
    expect(invalid.validation.errors[0]).toMatchObject({
      code: "INVALID_BULK_BLOCK",
      row: 1,
    });
  });
});
