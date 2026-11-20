# Conditional Survey results: C1 counting and withheld contract

Baseline: `main` at `ce79b19`, after public product discovery merged in PR #288.
**WX-06C1** merged through [PR #289](https://github.com/riojung/pollingpops/pull/289) at `01df23d`.
It is the first bounded results/privacy increment after B2 readers.
This prepares reporting for the owner's earlier single-choice page-visibility decision.
It does not enable conditional Survey authoring, collection, results, summaries or exports.

## What C1 implements

The separate `@openround/contracts/survey-branching-results` module adds two pure operations:

- `analyzeSurveyBranchingFinalizedResponses(content, submissions)` returns **internal aggregate
  qualification evidence**. It is not a report, endpoint DTO, log record or account export.
- `surveyBranchingSuppressedResults(content, submissions, closed=false)` returns a strict,
  proposed aggregate-v3 object for source content v4. It always withholds all numeric evidence
  and distributions. Closure changes its status from `collecting` to `privacy_review_required`;
  it never changes suppression into permission to release results.

Both require a valid published v4 document and an array of strict
`{ finalized: true, responses: ... }` wrappers. This explicit shape rejects pending rows and
extra identity/timestamp metadata. It is not proof of server-side finalization: a future repository
adapter must select authoritative finalized rows exactly once. Identical answer maps can belong
to distinct submissions and must not be deduplicated by their answer values.

Every response map is normalized once, then validated against that same frozen content and its
own final responses. Unknown questions, hidden answers, invalid values, missing eligible required
answers and malformed maps reject the entire input. C1 never reconciles, prunes or partially counts
an invalid finalized row. Failures use fixed typed error codes without response values, per-row
positions, validation dumps or original exception causes.

No existing Survey schema, request hash, publication, mutation maximum or aggregate-v2 function
is changed. The module is a separate package subpath and build entry, not a root/runtime import.
No database migration, UI, feature grant, service, provider or dependency is introduced.

## Counting meanings

Let **N** be the number of valid finalized submissions supplied for this one frozen Survey.
For each question, eligibility comes only from the final response map and the published page
conditions; it does not record or infer whether the participant visited a page.

| Internal measure        | Meaning                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `eligibleCount` (E)     | Finalized submissions for which the question is eligible                       |
| `answeredCount` (A)     | Eligible submissions containing a valid answer to the question                 |
| `unansweredCount` (U)   | Eligible submissions without an answer, including an omitted optional item     |
| `skippedLogicCount` (S) | Submissions for which the question is ineligible under the final branch choice |

The partitions are **E = A + U** and **N = E + S**. A skipped question is not an unanswered item
or an answer with value zero. A zero-sized eligible cohort is a measured internal zero, not
missing input; the proposed public DTO still represents its evidence as withheld `null`.

Response coverage has the basis `eligible_submissions` (**A / E**). Answer-distribution percentages
have the different basis `answered_respondents` (**bucket count / A**). Neither denominator should
be substituted with N. Multi-selection poll buckets count each selecting submission once per
choice and can sum to more than A; their percentages can consequently total more than 100%.
Reading, correctness, recovery, mastery and causal improvement are not Survey measures.

## Withheld output and reconstruction risks

The proposed transport schema permits only `suppressed: true`, `submittedCount: null`, four null
question counts and empty distributions. Question order and authored metadata remain available.
It cannot encode respondent IDs, credentials, timestamps, submitted answer maps or branch traces.
Strict objects reject additional evidence fields and arbitrary approval overrides. It also rejects
duplicate question IDs. The fixed minimum of five records the existing baseline; reaching five
does **not** qualify conditional evidence for release.

| Qualification scenario     | Why a local threshold is insufficient                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Small direct branch        | A child denominator can reveal membership of fewer than five submissions                                                                      |
| Small complement           | A displayed total minus a larger branch can reveal a small remainder                                                                          |
| Nested 15 / 10 / 9 cohorts | Both child counts and their whole-run complements meet five, but the ancestor-child difference is one                                         |
| Independent controllers    | Intersections and differences between otherwise large overlapping groups can be small                                                         |
| Cross-question evidence    | Controller distributions, child denominators, optional unanswered totals and skipped totals can expose the same suppressed remainder together |
| Multiple snapshots         | A newly finalized/deleted submission or changed suppression state can reveal information by differencing releases                             |

C1 tests include these counterexamples and show that different valid cohorts yield identical
withheld public JSON for the same content and closure state. The tests demonstrate conservative
withholding, not proof that a later partially released report is safe. Neither this module nor
the historical five-answer rule establishes differential privacy or protection against arbitrary
external knowledge about respondents.

## Compatibility and retained runtime boundaries

Historical v1–3 Surveys still use aggregate-v2. Existing behavior remains explicit:

- `submittedCount` remains exact even during collection and below five.
- Collection suppresses all question evidence; a closed run needs at least five finalized
  submissions and each question needs at least five answers for its distribution.
- Legacy per-question suppression does not suppress every small option bucket. A released
  distribution can contain a count of one; C1 does not rewrite that historical policy.
- Optional-item suppression, multi-selection respondent denominators and serialized property
  order remain byte-identical. Nine SHA-256 goldens were captured from unchanged `ce79b19`
  behavior across v1/v2/v3, collecting, small-sample and closed runs.

Repository v4 results still return `SURVEY_BRANCHING_RESULTS_NOT_AVAILABLE` before closure capture
or aggregation. Summary preview/share and derived PDF/PNG/XLSX paths remain unavailable, and
account exports continue excluding guest responses and receipts. Existing reader/writer boundary
and accepted-request-hash tests remain part of verification. There is no live C1 endpoint to test
or new browser interface to claim complete.

## Next reviewable increments

| Checkpoint                             | Completion target                                                                                                                                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1 — merged in PR #289**             | Correct internal finalized-response counting, strict withheld-only proposal, adversarial qualification fixtures and legacy byte compatibility                                                                                           |
| **C2 — candidate implemented locally** | Additive aggregate-v4 joint-contribution policy and automated qualification fixtures; [bounded guarantees, utility costs and lifecycle requirements](survey-branching-disclosure-policy.md). Human privacy acceptance remains open.     |
| **C3 — runtime results/readers**       | Apply the qualified policy under current workspace/RLS/frozen-version authority; negotiate the new aggregate version, fence publication of one final result, update retained result readers and explanatory UI without enabling writers |
| **C4 — summaries/exports/lifecycle**   | Use the same qualified result snapshot and suppression in every shared/downloaded format; test revocation, expiry, erasure, reconstruction across releases and historical aggregate-v2 compatibility                                    |
| **B3 — authoring and writer grant**    | After B2 and all C prerequisites qualify, add condition editing, safe move/delete/copy with ID remapping, preview and an explicit effective writer grant                                                                                |

On November 19, 2026, the owner selected **withhold the whole report until it passes privacy
checks** for C2. C1 already withholds all evidence; the decision does not itself qualify a
future release algorithm or grant privacy acceptance to C2. The separate C2 aggregate-v4
candidate does not relax C1's immutable suppressed-only aggregate-v3 schema. Human privacy review, editorial/native-language
acceptance and hosted release evidence remain separate from automated code checks.

## Local verification, November 19, 2026

- `VITEST_MAX_WORKERS=1 pnpm check` passed all stages: formatting, Docker build-context checks,
  lint, types, package/support tests, four application build tasks and compiled-server startup.
  Counts include 1,109 contract tests, 6,406 web tests, 1,672 server tests and 529 support tests.
  Existing environment-dependent integration skips remain; no new deployed-service or live-database
  qualification is claimed by this pure-contract change.
- The 56 added contract tests cover finalized validation/counting, withheld-schema enforcement,
  adversarial privacy fixtures and historical aggregate byte compatibility. Fourteen existing
  API boundary/summary projection tests also passed in a separate focused run.
- `pnpm --filter @openround/contracts build` separately passed and emitted the new JavaScript
  entry and TypeScript declarations. The default application check does not build every standalone
  contracts entry, so this explicitly verifies the added package subpath.
- Independent read-only implementation review found no actionable correctness, privacy or
  compatibility issue. `git diff --check` passed. There is no new runtime or browser UI in C1.
