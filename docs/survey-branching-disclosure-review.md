# WX-06 conditional Survey disclosure review

November 24, 2026. Baseline `0b21465` after PR #320. Human privacy and product decisions pending.

The owner selected whole-report withholding for conditional Surveys. C2 implements a
[candidate projector](survey-branching-disclosure-policy.md) that requires at least five
finalized submissions in every observed full response pattern. This review prepares the
decision on that implementation before [C3 results/readers](survey-branching-results.md).

## Utility under the candidate policy

Replay the existing synthetic Survey with two nested Yes/No steps, a five-point rating on
the deepest page, and an optional five-point rating shown to everyone. The first three rows
use the same lean set of paths with different answer variation. The last two fix both the
total and the set of observed patterns. Counts in the fixture columns are test inputs. A
withheld public result includes no total.

| Synthetic case                                                                   | Full response patterns | Input submissions | Projected result | Released total |
| -------------------------------------------------------------------------------- | ---------------------: | ----------------: | ---------------- | -------------: |
| One response pattern on each of three paths, five per pattern                    |                      3 |                15 | Available        |             15 |
| All nested rating values, optional rating unanswered, five per pattern           |                      7 |                35 | Available        |             35 |
| All six optional states on those same paths and nested ratings, four per pattern |                     42 |               168 | Withheld         |           None |
| The same 42 patterns, five per pattern                                           |                     42 |               210 | Available        |            210 |
| The same 42 patterns and total, with one group of one and one group of nine      |                     42 |               210 | Withheld         |           None |

In this fixture the optional rating multiplies the full-pattern count by six. With all 42
patterns present, 210 submissions is a lower bound. Their distribution still determines
whether the report can release. A researcher should check whether a fully withheld result
leaves the facilitator with a workable decision using only other authorized evidence.
These constructed populations measure projector behavior. Expected report availability in
actual use remains unmeasured.

### Reproduce from the repository root

```sh
node --import tsx --input-type=module <<'JS'
import assert from "node:assert/strict";
import { surveyBranchingDisclosureResults } from "./packages/contracts/src/survey-branching-results.ts";
import {
  branchingId as id,
  surveyBranchingFixture,
} from "./packages/contracts/test/support/survey-branching-fixture.ts";

const content = surveyBranchingFixture();
const poll = (choice) => ({ kind: "poll", choiceIds: [id(choice)] });
const rating = (value) => ({ kind: "rating", value });
const noFollowUp = { [id(1)]: poll(102) };
const firstFollowUp = { [id(1)]: poll(101), [id(2)]: poll(202) };
const deepFollowUps = [1, 2, 3, 4, 5].map((value) => ({
  [id(1)]: poll(101),
  [id(2)]: poll(201),
  [id(3)]: rating(value),
}));
const lean = [noFollowUp, firstFollowUp, deepFollowUps[2]];
const withoutOptional = [noFollowUp, firstFollowUp, ...deepFollowUps];
const allPatterns = withoutOptional.flatMap((responses) => [
  responses,
  ...[1, 2, 3, 4, 5].map((value) => ({ ...responses, [id(4)]: rating(value) })),
]);
const unevenFrequency = (index) => {
  if (index === 0) return 1;
  if (index === 1) return 9;
  return 5;
};
const cases = [
  ["Three paths", lean, () => 5, "available", 15],
  ["Nested rating varies", withoutOptional, () => 5, "available", 35],
  ["Optional states vary, four per group", allPatterns, () => 4, "privacy_withheld", null],
  ["Optional states vary, five per group", allPatterns, () => 5, "available", 210],
  ["Same total, rare group", allPatterns, unevenFrequency, "privacy_withheld", null],
];
for (const [scenario, patterns, frequency, expectedStatus, expectedTotal] of cases) {
  const submissions = patterns.flatMap((responses, index) =>
    Array.from({ length: frequency(index) }, () => ({
      finalized: true,
      responses: structuredClone(responses),
    })),
  );
  const result = surveyBranchingDisclosureResults(content, submissions, true);
  assert.equal(result.resultsStatus, expectedStatus, scenario);
  assert.equal(result.submittedCount, expectedTotal, scenario);
  if (expectedTotal === null) {
    for (const question of result.questions) {
      for (const key of ["eligibleCount", "answeredCount", "unansweredCount", "skippedLogicCount"]) {
        assert.equal(question[key], null, scenario);
      }
      assert.deepEqual(question.distribution, [], scenario);
    }
  }
  console.log(
    scenario,
    patterns.length,
    submissions.length,
    result.resultsStatus,
    result.submittedCount,
  );
}
JS
```

## Decisions before C3

1. **Privacy reviewer:** document a deployment threat model for the intended guest collection
   flow and report audience. The policy counts finalized submissions. Assess whether one person
   can contribute more than once through separate guest credentials, which controls apply, and
   what risk remains. Review known membership and homogeneous answers, what the release
   decision conveys, and whether readers can compare related runs or obtain overlapping
   evidence from existing report, account, or export paths. Record the risks accepted and
   any restrictions on audience or reuse. [C2 policy limits](survey-branching-disclosure-policy.md#what-the-check-establishesand-its-limits)
2. **Product owner:** review the withholding and denominator meanings and whether withholding
   leaves the selected facilitator workflow viable. If evidence is insufficient, keep the
   current runtime gate and identify the workflow observation needed. A threshold change or
   partial disclosure requires a revised policy review.
3. **Runtime qualification after acceptance:** bind finalization to one closed run and exact
   publication with one immutable outcome, including withholding. Verify closing races, exact
   retry, tenant and reader version fences, and read/withdrawal behavior. C4 must apply the
   same snapshot and withdrawal rule to shares and exports before conditional authoring is
   enabled. Use the [C2 publication protocol](survey-branching-disclosure-policy.md#required-c3c4-publication-protocol).

Record the reviewed revision and policy ID, collection setup, permitted audiences and surfaces,
threat model, evidence references, and open risks. C3 can start only after the product owner and
privacy reviewer both accept that same recorded scope. A missing decision, differing scopes,
or a revise or defer decision from either reviewer keeps C3 blocked. Record what evidence or
policy change is needed to resolve the decision. Keep private responses, identities, and
detailed review records in the approved evidence store.

## Verification boundary

The synthetic replay evaluates the pure projector. The
[API boundary tests](../apps/server/test/survey-branching-boundary.test.ts) exercise trusted
in-memory v4 fixtures with existing creator permissions. They confirm that fresh results,
summary previews, share creation, and PDF, full and selected-question PNG, and XLSX
downloads fail closed. No production authoring or collection path creates the fixture.

Carry these cases into C3/C4 qualification:

- **Retained snapshots and shares.** The current summary preview can return a stored snapshot
  before loading the current source. Exercise existing-snapshot paths with mismatched or
  withdrawn sources and a retained share. Verify the pinned run, publication, policy and
  outcome for private and public reads and each download. Fresh-request denial alone does not
  qualify existing snapshots. [Summary routes](../apps/server/src/session-summary-routes.ts)
- **Withheld counts and selected questions.** The legacy summary contract requires numeric
  totals, and the export request supports a selected-question PNG. The conditional paths
  need their own compatible projection. Preserve withheld totals as absent and decline
  selected-question views. [Summary contract](../packages/contracts/src/session-summaries.ts)

Human review and the C3/C4 lifecycle cases remain pending.

Local verification passed all five synthetic replay cases, 77 focused C1/C2 contract tests,
and 48 server tests covering the v4 boundary and existing summary API, projection, and exports.
