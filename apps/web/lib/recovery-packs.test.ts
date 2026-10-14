import { describe, expect, it } from "vitest";
import {
  QuizContentSchema,
  RecoveryPackContentSchema,
  RecoveryPackDraftSchema,
  type QuestionDraft,
} from "@openround/contracts";
import {
  conceptKeysFromText,
  recoveryPackDraftFromPair,
  recoveryPackPairs,
  recoveryPackRoundHref,
  recoveryPackTargetId,
} from "./recovery-packs";

const main: QuestionDraft = {
  id: "10000000-0000-4000-8000-000000000001",
  type: "numeric",
  prompt: "First situation",
  purpose: "practice",
  delivery: "main",
  conceptKeys: ["fractions"],
  linkedRecheckQuestionId: "10000000-0000-4000-8000-000000000002",
  timeLimitSeconds: 30,
  basePoints: 100,
  explanation: "Use a ratio.",
  mediaId: null,
  mediaAlt: null,
  correctValue: "2",
  tolerance: "0",
  unit: null,
};
const recheck: QuestionDraft = {
  ...main,
  id: main.linkedRecheckQuestionId!,
  delivery: "recheck",
  prompt: "Transfer situation",
  linkedRecheckQuestionId: null,
};

describe("Recovery Pack authoring", () => {
  it("allows only UUID destination IDs and constructs a bounded local navigation path", () => {
    expect(recoveryPackTargetId(main.id)).toBe(main.id);
    expect(recoveryPackRoundHref(main.id)).toBe(`/quiz/${main.id}`);
    for (const value of [
      "",
      "../admin",
      "javascript:alert(1)",
      "<img src=x onerror=alert(1)>",
      `${main.id}?redirect=//example.com`,
      `${main.id}/preview`,
    ]) {
      expect(recoveryPackTargetId(value)).toBe("");
      expect(recoveryPackRoundHref(value)).toBeNull();
    }
  });
  it("selects only unambiguous scored main/recheck pairs", () => {
    expect(recoveryPackPairs([main, recheck])).toEqual([{ diagnostic: main, recheck }]);
    expect(recoveryPackPairs([main])).toEqual([]);
    expect(recoveryPackPairs([main, recheck, { ...recheck }])).toEqual([]);
    expect(recoveryPackPairs([{ ...main, delivery: "recheck" }, recheck])).toEqual([]);
  });

  it("does not turn an opinion ranking into a learning Recovery Pack", () => {
    const ranking: QuestionDraft = {
      id: main.id,
      prompt: "Choose your priorities",
      timeLimitSeconds: 30,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
      delivery: "main",
      linkedRecheckQuestionId: null,
      type: "ranking",
      purpose: "opinion",
      confidence: "off",
      basePoints: 0,
      choices: [
        { id: "10000000-0000-4000-8000-000000000011", label: "First priority", isCorrect: false },
        { id: "10000000-0000-4000-8000-000000000012", label: "Second priority", isCorrect: false },
      ],
    };
    expect(recoveryPackPairs([ranking, recheck])).toEqual([]);
    expect(() =>
      recoveryPackDraftFromPair(
        "Recovery",
        ranking,
        recheck,
        "10000000-0000-4000-8000-000000000003",
      ),
    ).toThrow("Only learning checkpoints");
  });

  it("copies the pair without changing the published source", () => {
    const draft = recoveryPackDraftFromPair(
      "Recovery",
      main,
      recheck,
      "10000000-0000-4000-8000-000000000003",
    );
    expect(draft.diagnostic.purpose).toBe("diagnostic");
    expect(main.purpose).toBe("practice");
    draft.diagnostic.conceptKeys!.push("other");
    expect(main.conceptKeys).toEqual(["fractions"]);
    expect(draft.diagnostic.linkedRecheckQuestionId).toBe(draft.recheck.id);
  });

  it.each([
    {
      name: "13 concepts with a shared concept last",
      diagnosticKeys: [...Array.from({ length: 6 }, (_, index) => `diagnostic-${index}`), "shared"],
      recheckKeys: [...Array.from({ length: 6 }, (_, index) => `recheck-${index}`), "shared"],
      shared: "shared",
    },
    {
      name: "maximum source lists with a shared concept last",
      diagnosticKeys: [
        ...Array.from({ length: 11 }, (_, index) => `diagnostic-${index}`),
        "shared",
      ],
      recheckKeys: [...Array.from({ length: 11 }, (_, index) => `recheck-${index}`), "shared"],
      shared: "shared",
    },
    {
      name: "maximum disjoint source lists",
      diagnosticKeys: Array.from({ length: 12 }, (_, index) => `diagnostic-${index}`),
      recheckKeys: Array.from({ length: 12 }, (_, index) => `recheck-${index}`),
      shared: null,
    },
  ])(
    "creates a valid bounded Pack from $name without losing source concepts",
    ({ diagnosticKeys, recheckKeys, shared }) => {
      const source = QuizContentSchema.parse({
        title: "Published source",
        questions: [
          { ...main, conceptKeys: diagnosticKeys },
          { ...recheck, conceptKeys: recheckKeys },
        ],
      });
      const pair = recoveryPackPairs(source.questions)[0]!;
      const before = structuredClone(source);
      const makeDraft = () =>
        recoveryPackDraftFromPair(
          "Recovery",
          pair.diagnostic,
          pair.recheck,
          "10000000-0000-4000-8000-000000000003",
        );
      const draft = makeDraft();
      expect(RecoveryPackDraftSchema.safeParse(draft).success).toBe(true);
      expect(RecoveryPackContentSchema.safeParse(draft).success).toBe(true);
      expect(draft.conceptKeys).toHaveLength(12);
      expect(new Set(draft.conceptKeys).size).toBe(12);
      expect(draft.diagnostic.conceptKeys).toEqual(diagnosticKeys);
      expect(draft.recheck.conceptKeys).toEqual(recheckKeys);
      if (shared) expect(draft.conceptKeys[0]).toBe(shared);
      expect(diagnosticKeys.some((key) => draft.conceptKeys.includes(key))).toBe(true);
      expect(recheckKeys.some((key) => draft.conceptKeys.includes(key))).toBe(true);
      expect(
        draft.conceptKeys.every((key) => [...diagnosticKeys, ...recheckKeys].includes(key)),
      ).toBe(true);
      expect(makeDraft()).toEqual(draft);
      expect(source).toEqual(before);
    },
  );

  it("preserves the full ordered concept union when it fits", () => {
    const draft = recoveryPackDraftFromPair(
      "Recovery",
      { ...main, conceptKeys: ["fractions", "ratios", "fractions"] },
      { ...recheck, conceptKeys: ["ratios", "percentages"] },
      "10000000-0000-4000-8000-000000000003",
    );
    expect(draft.conceptKeys).toEqual(["fractions", "ratios", "percentages"]);
  });

  it("deduplicates bounded metadata input without inventing concept keys", () => {
    expect(conceptKeysFromText(" rates, rates, fractions , ")).toEqual(["rates", "fractions"]);
    expect(conceptKeysFromText(" , ")).toEqual([]);
  });
});
