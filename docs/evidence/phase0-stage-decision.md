# Phase 0 segment and Phase 1 branch decision

This is a redaction-safe aggregate decision record. Keep facilitator identities, consent records,
raw notes, participant data, and customer content in the approved private research system. Link
only pseudonymous, reviewed evidence records here.

## Decision metadata

- Decision date/time (UTC):
- Research protocol/version:
- Build commits and image digests represented:
- Research owner:
- Independent reviewer:
- Redacted evidence index URL/checksum:
- Redacted machine-readable aggregate checksum or opaque `ref:` handle:
- `pnpm research:check` output checksum/reference:
- Frozen in-scope cohort/version and observation cutoff:
- In-scope records by final disposition (accepted/rejected/excluded/pending):
- Frozen initial primary facilitator cohort (first six eligible-at-freeze education/workplace IDs):
- Final primary facilitator cohort after reviewed substitutions:
- Same-segment reserve order and substitutions with predeclared reason codes and review references:
- Phase 0 research gate result (accepted/rejected/pending): Pending
- Phase 0 independent reviewer decision (accepted/rejected/pending): Pending

Do not select an acquisition segment or Phase 1 branch while the Phase 0 research gate or its
independent review is pending.

Every record inside the frozen cohort/cutoff must have a final accepted, rejected, or excluded
disposition under the predeclared rules. Any pending in-scope record keeps every dependent aggregate
and decision pending.

## Machine-readable recomputation

Populate a private copy of the deliberately empty
[Phase 0 research aggregate example](phase0-research-aggregate.example.json) under the
[aggregate schema](phase0-research-aggregate.schema.json), then run
`pnpm research:check -- path/to/redacted-aggregate.json`. Do not commit the populated aggregate.
Record its checksum or opaque `ref:` handle and the evaluator output reference above. The command
rejects pending records, raw/private fields, duplicate stable record IDs, invalid denominators,
missing independently reviewed reason codes, primary-cohort substitutions that do not take the next
eligible same-segment reserve, usability samples below the frozen floor, and declared decisions
that do not match the recomputed thresholds or branch order. It also recomputes all eight usability
journey thresholds from per-segment numerators, denominators, and complete timing samples rather
than trusting a declared accepted result.

The committed example is intentionally empty and pending. Validator success establishes only that
the redacted aggregate is internally consistent; it does not replace source evidence, independent
review, or either human decision recorded here. Optional Companion, Question Health, and
delayed-probe Prototype Lab tasks may inform reviewed records but are not required to close Phase 0
and cannot substitute for observed real sessions or accepted segment usability.

## Acquisition-segment evidence

| Measure                                     | Higher education | Workplace | Evidence references |
| ------------------------------------------- | ---------------- | --------- | ------------------- |
| Eligible facilitator interviews             |                  |           |                     |
| Recurring “what next?” problem demonstrated |                  |           |                     |
| Partners completing at least two pilots     |                  |           |                     |
| Observed real sessions                      |                  |           |                     |
| Evidence-complete recovery checkpoints      |                  |           |                     |
| Eligible recovery checkpoints               |                  |           |                     |
| Eligible first-time usability facilitators  |                  |           |                     |
| Eligible usability participants             |                  |           |                     |
| Median time to unassisted first activation  |                  |           |                     |
| Willingness-to-pay yes/known denominator    |                  |           |                     |

- Total recurring-problem demonstrations/eligible facilitators:
- Total observed real sessions:
- Total evidence-complete/eligible recovery checkpoints and percentage:
- Accepted P0 beta usability evidence reference:

The Phase 0 research gate may be accepted only when all of these reviewed thresholds pass: at
least six eligible higher-education and six eligible workplace facilitators are interviewed; at
least eight of the frozen primary twelve demonstrate the recurring post-result decision problem;
at least three
partners per segment run twice; at least ten real sessions are observed; at least 50% of eligible
recovery checkpoints are evidence-complete; and both P0 beta usability segment results are accepted
with at least six eligible first-time facilitators and twenty eligible participants per segment. A
pending or rejected aggregate decision keeps the gate pending or rejected. Phase 0 can be accepted
only when both the research-owner and independent-reviewer aggregate decisions are accepted.

Selection order: choose a segment only when it is no worse on repeat partners and evidence-complete
recovery checkpoints and better on at least one. If those two reviewed measures tie, prefer the
lower median activation time, then the higher willingness-to-pay yes/known rate. If leading
measures conflict, a tie remains after the ordered comparisons, or a needed denominator is missing,
leave the decision pending and collect more evidence rather than inventing a score.

- Selected primary acquisition segment (higher education/workplace/pending): Pending
- Selection rationale and evidence references:
- Independent reviewer decision (accepted/rejected/pending): Pending

## Phase 1 access signals

- Stable partner workflow IDs with a reviewed timing/connectivity exclusion:
- Partner workflows with timing/connectivity exclusion:
- Observed partner workflows (denominator):
- Timing/connectivity-affected attempts (numerator/denominator and percentage):
- Serious accessibility finding IDs and review status:
- Access gate result (pass/fail/pending): Pending

The Access gate passes if any one of these reviewed conditions is true: at least three partner
workflows exclude participants because of timing/connectivity; at least 10% of observed attempts are
affected; or a serious accessibility finding exists.

Use the campaign counting rules: repeat sessions of one stable partner/workflow ID count as one
workflow, and an observed attempt is one eligible participant/checkpoint response opportunity,
counted once regardless of retries or reconnects. Do not mix joins or unrelated interaction types
into the attempt denominator.

## Phase 1 companion signals

- Stable facilitator IDs for repeat external-deck use:
- Repeat facilitators using an external deck:
- Repeat facilitators reviewed (denominator):
- Observed sessions with a material context-switch interruption:
- Observed sessions reviewed (denominator):
- Companion gate result (pass/fail/pending): Pending

The Companion gate passes only when at least four repeat facilitators use an external deck and at
least two observed sessions suffer a material context-switch interruption.

For machine recomputation, a repeat external-deck facilitator has at least two distinct accepted
eligible sessions and external-deck use in at least one of them. A single prototype or duplicated
session record does not count.

## Ordered Phase 1 decision

Apply the rules without reordering them:

1. Select **Access and resilience** when the Access gate passes.
2. Evaluate **Companion mode** only after the Access gate explicitly fails, and select it only when
   the Companion gate passes.
3. Use Phase 1 for the largest measured activation or correctness failure only after both gates
   explicitly fail.
4. If either required gate result is pending, keep the selected branch pending.

If both gates explicitly fail, compare only independently reviewed activation or correctness
failures with a defined eligible population. Record exclusions and failed instrumentation; do not
rank raw event counts that lack a denominator or combine unlike populations into one rate.
Select the unique candidate with the greatest affected/eligible rate. If the greatest reviewed rate
is tied or no accepted candidate has a valid denominator, keep the branch pending.

| Candidate activation/correctness failure | Affected eligible attempts/workflows | Eligible denominator | Rate | Severity and user consequence | Evidence references | Independent reviewer result |
| ---------------------------------------- | ------------------------------------ | -------------------- | ---- | ----------------------------- | ------------------- | --------------------------- |
|                                          |                                      |                      |      |                               |                     | Pending                     |

- Largest measured activation/correctness failure and denominator:
- Selected Phase 1 branch (access/companion/measured failure/pending): Pending
- Decision rationale and evidence references:
- Research owner decision (accepted/rejected/pending): Pending
- Independent reviewer decision (accepted/rejected/pending): Pending

## R2-00 candidate dispositions

Use a private copy to index each ticket considered under
[R2-00](../competitor-backlog-2026-10-27.md#r2-00-establish-demand-and-select-the-next-increment).
Reference the existing interview's
[ticket evaluation](design-partner-interview.md#r2-00-ticket-evaluation) and observation's
[workflow task records](session-observation.md#r2-00-workflow-task-records); do not create a second
intake or copy raw notes here. Repository-safe references must be reviewed checksums or opaque
handles; keep customer identities, quotes, answers, and private workspace URLs outside Git.

For every candidate, retain supporting **and contrary** evidence, including accepted observations
that show the existing feature or workaround already solves the job. Record the eligible
population and numerator/denominator for each claimed rate, assistance and exclusions, observed
frequency and consequence, and the missing-versus-undiscovered capability finding. Reference the
current workaround/alternative, procurement constraint, and willingness-to-pilot/pay evidence
from the interview. Do not rank unlike populations or invent prevalence from public requests.

| R2 ticket and parent idea | Stable partner/workflow references | Supporting evidence references | Contrary evidence references | Affected/eligible and population definition | Current workaround and consequence | Missing capability / discoverability / unresolved | Proposed disposition | Independent review and rationale reference |
| ------------------------- | ---------------------------------- | ------------------------------ | ---------------------------- | ------------------------------------------- | ---------------------------------- | ------------------------------------------------- | -------------------- | ------------------------------------------ |
|                           |                                    |                                |                              |                                             |                                    | Unresolved                                        | Pending              | Pending                                    |

- All considered ticket references and final/pending review status:
- Three-workflow coverage and omitted/not-run task reasons:
- Supporting and contrary evidence reconciliation reference:
- Research owner recommendation: Pending
- Independent reviewer decision: Pending
- Product-owner implementation selection/reference: Pending

Proposed dispositions are select, revise, retain, or reject only after the required evidence is
reviewed; otherwise use pending. These recommendations do not select a segment, authorize a Phase 1
branch, or change a Deferred backlog status. Apply the ordered decision above, keep every dependent
decision pending while prerequisites are unresolved, and obtain a separate implementation
selection before funding a feature increment. This index does not add fields to or relax the
machine-readable aggregate schema or the release-readiness criteria.
