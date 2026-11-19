import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { surveyAggregate, validateSurveyResponses } from "../src/surveys";
import { surveyAggregateLegacyFixture } from "./support/survey-aggregate-legacy-fixture";

// Captured from unchanged aggregate-v2 on main ce79b19, before the isolated C1 projection.
// V1–3 publication layout and aggregate versions are different compatibility axes.
const goldens = [
  [1, "collecting", "ac295d1430d02a2970a331ab8d488e20f6b83b3d5a84c52677d80866f2bf6691"],
  [1, "small", "f926fab5952b7a7c5a631aaf33ef699bc2c932f74cc3c6c1e460f2a8f91eef7a"],
  [1, "closed", "08ef9f8e6412d9fd177fc564db1ee3f6be1032ee89c554c007e8988e39a59690"],
  [2, "collecting", "03eca7ad5be8fc009b48723326ba8847773466c8862a46921b71feedd61ca205"],
  [2, "small", "4bc115bda0dffc135cc4338b22bd776b4a3277c2fa42962c1a727fd90646a46f"],
  [2, "closed", "d3b77cf98111a9627229f7adab272ec04cee0d6c7013dd41392ba1550b633faf"],
  [3, "collecting", "03eca7ad5be8fc009b48723326ba8847773466c8862a46921b71feedd61ca205"],
  [3, "small", "4bc115bda0dffc135cc4338b22bd776b4a3277c2fa42962c1a727fd90646a46f"],
  [3, "closed", "d3b77cf98111a9627229f7adab272ec04cee0d6c7013dd41392ba1550b633faf"],
] as const;

describe("Survey aggregate-v2 historical compatibility", () => {
  it.each(goldens)(
    "keeps content v%s %s aggregate bytes unchanged",
    (version, scenario, expected) => {
      const { content, responses } = surveyAggregateLegacyFixture(version);
      responses.forEach((response) =>
        expect(validateSurveyResponses(content, response, true)).toEqual([]),
      );
      const value = surveyAggregate(
        content,
        scenario === "small" ? responses.slice(0, 4) : responses,
        scenario !== "collecting",
      );
      expect(createHash("sha256").update(JSON.stringify(value)).digest("hex")).toBe(expected);
    },
  );

  it("preserves legacy optional-item suppression, small buckets, and respondent-based multi-selection", () => {
    for (const version of [1, 2, 3] as const) {
      const { content, responses } = surveyAggregateLegacyFixture(version);
      const value = surveyAggregate(content, responses, true);
      expect(value).toMatchObject({ schemaVersion: 2, submittedCount: 6, suppressed: false });
      expect(value.questions[0]).toMatchObject({
        answeredCount: 6,
        distribution: [
          { label: "Direction 1", count: 5 },
          { label: "Direction 2", count: 1 },
        ],
      });
      expect(value.questions[1]).toMatchObject({
        answeredCount: null,
        suppressed: true,
        distribution: [],
      });
      expect(value.questions[2]).toMatchObject({
        answeredCount: 5,
        percentBasis: "respondents",
        maxSelections: version === 1 ? 1 : 2,
      });
      expect(value.questions[2]!.distribution.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(
        version === 1 ? 5 : 10,
      );
    }
  });
});
