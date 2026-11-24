# Round report comparison disclosure design

WX-10 advances [IDEA-015 and R2-10](competitor-backlog-2026-10-27.md#r2-10-comparable-cohort-evidence)
from the baseline merged in [PR #315](https://github.com/riojung/pollingpops/pull/315) at
`3f573ce`. The candidate lets repeat facilitators find a checkpoint worth reviewing before
the next delivery. Product, learning-evidence, and human privacy acceptance are pending.
Use synthetic data for design evaluation until real-data disclosure is approved.

## First comparison

From a retained Round report in Results, an authorized workspace owner or editor selects one
other finished delivery of that exact published Round. Show the publication version, the two
session dates, and the same authored checkpoint in both columns. Let the facilitator switch
between supported checkpoints in published order. A checkpoint's result uses the same fixed
population every time it appears.

Start with initial accuracy for main assessed single-select and true/false checkpoints. Show
each session's recorded question collection window, response-count band, and accuracy band when
both sides qualify. Explain that the groups are **unpaired**, people may have attended both
sessions, and the figures describe the recorded answers in each delivery. The facilitator can
choose a question or explanation to review. Differences in who answered or how long they had
remain relevant when interpreting the figures.

This narrower milestone needs explicit product approval. The full WX-10/R2-10 checkpoint
still needs an eligible audience count from a qualified question-level roster, intervention
availability, and linked recheck availability. Those remain tracked in the
[workspace backlog](workspace-experience-backlog-2026-11.md#wx-10-report-comparison).

## Source and measurement eligibility

1. Resolve both distinct Round session IDs and their reports on the server in the same current
   workspace. Require current owner/editor membership, access to both sources, a finished session
   and a ready report. The session, report, and source publication must still be retained and
   available under workspace and source policy. Exclude previews, practice, Surveys, Presentations,
   and live or pending evidence. Viewer, public summary, guest, and staff bearers do not grant
   comparison access. Participant result visibility governs participant views and is distinct
   from organizer report access. The comparison also needs an explicit disclosure decision for
   each supported source policy.
2. Match the immutable source `quizId` and `quizVersionId` and the authored question ID. Verify
   frozen purpose, question format and main delivery, plus effective session trust, timing, and
   scoring modes. Compare the original main attempt only. Prompts, positions, concept labels,
   apparent content equality and a later publication of the same draft cannot resolve a mismatch.
   Accept legacy fields only when the retained source and its storage rules prove their meaning.
3. Require one identifiable, completed main attempt with trustworthy counts bound to its
   accepting periods. Use durable, server-owned timing evidence for each period's opening (initial
   open or resume), effective deadline for timed mode, and any pause, lock, or finish that ends
   acceptance. Persist the periods at the same authority boundary as the question state and
   accepted answers. End each period at the earlier of the applicable deadline and the committed
   transition that stops acceptance, preserving the engine's deadline and transition ordering
   for boundary-time answers. A resume starts a new period. Show the first opening and final
   cutoff, and distinguish pauses from time available to answer.

   The [retained round state](../packages/game-engine/src/index.ts) records opening, deadline,
   and lock but can omit the pause that stopped collection before lock. A later lock timestamp
   alone cannot establish the final cutoff, and the last answer time cannot prove when acceptance
   ended. Require the complete accepting periods or equivalent authoritative evidence that proves
   when answers could be accepted, including a proven uninterrupted window where applicable.
   Withhold the entire comparison for that checkpoint if timing is incomplete, including for
   legacy rows or an early finish with an unknown cutoff.

4. Let **R** be accepted, scored initial responses from retained, non-kicked session participants,
   at most one response per participant for that checkpoint. Let **C** be the correct subset.
   Initial accuracy is C / R. Require integer, consistent counts with 0 ≤ C ≤ R and verified
   provenance for both inputs. A missing attempt, an empty response set and a measured zero have
   different meanings. A measured zero remains subject to disclosure checks. **Eligible audience
   size** would require a trustworthy question-level roster of who could answer. The first view
   labels eligible audience size unavailable and shows the qualified response-count band as
   the basis for accuracy. Joined players and total session answers cannot serve as that roster.

[Question Health](api.md#question-health-apis) already groups scorable main question evidence by
exact publication, trust, timing, and scoring modes. Its 20-response floor screens descriptive
advisories, and its observation response pools eligible sessions. Reuse its source and metric
compatibility rules where proven. Comparison needs a separate, bounded per-session reader.
Current [Round reporting](../apps/server/src/reporting.ts) builds question counts from retained
main answers and does not establish the collection window or eligible roster in the report
payload. Qualify the stored window and answer binding in both PostgreSQL and memory.
The [single-source summary reader](../apps/server/src/session-summary-routes.ts) already checks
finish, readiness, and session/report retention. Apply both-source authorization and a separate
projection to the comparison.

## Candidate disclosure rule

Evaluate an approved, fixed per-session result for the same question on both sides. For design
evaluation, require at least **20** responses and at least **5** correct and **5** incorrect
responses in **each** session. The second check covers the complements. An all-correct result
or a one-response minority remains withheld even if many answered. These are proposed floors
for a human-reviewed policy. They do not establish anonymity or show that different people
took part in the two sessions.

For a qualified pair, display fixed response-count bands of ten (20–29, 30–39, and so on) and
fixed ten-percentage-point accuracy bands. The lower endpoint is included and the upper is
excluded, with 100% included in the last band. Classify using the unrounded ratio before display
formatting. For example, 14 of 24 maps to **20–29 responses; 50% to under 60% correct**;
21 of 31 maps to **30–39 responses; 60% to under 70% correct**. Only the bands reach the client.

If either population cannot be compared or disclosed, use one evidence-unavailable state for the
whole selected question. Suppress both cells, counts, rates, interval values, and data-dependent
explanations. A known version or settings mismatch can be explained using already-authorized
source metadata. Return generic unavailability for missing, expired, or unauthorized sources
without revealing the other source's existence or fields. Apply the same projection to every
response and accessibility label. Use unavailable text for unavailable evidence and a stable
layout for both columns.

Each source contributes only its fixed whole-session checkpoint evidence. Exclude custom dates,
participant filters, exact counts, raw responses, typed text, identities, cross-session matching,
pooled totals and deltas. The first comparison is private and temporary. Public links, shared
summaries, downloads, and saved comparisons are later disclosure work.

**Withholding scope.** The proposed floors minimize disclosure in the comparison view. The
[existing creator report](../apps/server/src/routes.ts) returns exact per-question response and
correct counts to authorized readers. [Question Health](../apps/server/src/question-health-post-use.ts)
can return exact totals for a qualifying single-session cohort, using its own eligibility rules.
A withheld comparison cell therefore does not imply that those counts are hidden on other surfaces.
Before enabling real-data comparisons, privacy acceptance must consider what the same reader can
combine across the comparison, individual reports, Question Health, summaries, exports, and
earlier releases. Record whether comparison-only minimization is acceptable. If acceptance
requires cross-surface withholding, qualify a policy that covers those paths and keep real-data
comparisons unavailable until it is enforced. The broader WX-10 acceptance criterion for
private and low-sample evidence remains open until that decision is satisfied.

**Known limits to qualify.** A ready or unavailable state leaks that the pair cleared a check.
Comparing several pairs can add information even with stable bands. For example, if a reader
knows that a later session repeated the same 24 answers with one extra response, the 60% band
boundary can distinguish an extra correct response from an extra incorrect one: 14/24 is below
60%, 15/25 is 60%, and 14/25 is below 60%. All of those samples meet the candidate floors.
Evaluate common group overlap, outside knowledge, earlier outputs, and what a facilitator can
infer across the existing report surfaces. Keep real-data comparison withheld if these risks
cannot be accepted under the agreed deployment conditions. Do not add participant tracking to
infer overlap.

## Access, withdrawal, and later recovery evidence

- Recheck authorization, both source identities, current policy, and retention on every
  comparison read. Resolve the pair under a coherent read. Make a final authority and source
  check before sending the body. Discard both results if either source has changed or become
  unavailable. Return private, no-store data. Keep the result in view memory only and clear it
  on expiry, workspace or account change, or terminal denial. Discard late results after
  changing the selected pair or losing access. Revocation controls subsequent access, so the
  disclosure assessment also accounts for results already seen.
- Freeze one disclosure outcome per workspace, session, publication, and checkpoint once
  qualified evidence has finalized, including a withheld outcome. The current report has an
  ID, status, and generation time. The comparison needs its own durable evidence version and
  withdrawal marker. Record the approved policy version with the outcome and keep the same
  release identity across policy versions and pairings. Deletion,
  erasure, or replacement that invalidates the bound evidence retires that source from every
  pair, including when a new ready report exists before the next read. Preserve the withdrawal
  marker for the applicable retention window without copying learner rows or extending source
  retention. A later saved comparison should store source references only and recheck both sides.
- Treat recovery as a separate metric in a later approved checkpoint. Its within-session
  denominator is initially incorrect participants with both the initial and recheck answer, and
  its numerator is those correct on the recheck. Verify the actual delivered source and linked
  recheck IDs against the published link and keep revotes separate. Authored recheck availability
  differs from delivered rechecks and recorded interventions. Missing or unmatched rechecks and
  attrition must be visible under an approved disclosure rule. Across sessions, even these
  within-session pairs remain unpaired group evidence. Do not infer an intervention effect from a
  difference. [Round recovery computation](../apps/server/src/reporting.ts)

## Synthetic acceptance cases

| Case                                                                                                 | Expected result                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same publication, checkpoint, and modes, with 14/24 and 21/31 correct                                | Show two qualified bands and collection windows with the unpaired explanation. Swapping the pair preserves each session's result.                                                                                                                                       |
| Similar prompts, reused IDs across versions, different modes, unknown legacy mode, or a copied Round | No numeric comparison. Only authorized, non-sensitive incompatibility metadata is available.                                                                                                                                                                            |
| Pause at 10 seconds, then lock at 20 seconds                                                         | The recorded pause ends acceptance at 10 seconds. Withhold if the reader has only the lock and prior deadline and cannot establish the pause.                                                                                                                           |
| Open at 0 with a 30-second deadline, pause at 10, resume at 25, then lock at 35                      | The resumed deadline is 45 seconds. The accepting periods end at the pause and the lock, with a gap from 10 to 25 seconds. Without durable evidence of both periods, withhold.                                                                                          |
| Uninterrupted timed deadline at 30 seconds, then lock at 45 seconds                                  | A proven uninterrupted period ends at the deadline. Apply existing answer acceptance rules to the deadline itself.                                                                                                                                                      |
| Unopened checkpoint, early end without a recorded cutoff, or legacy date fallback                    | Withhold both columns when the accepting periods are unavailable. Keep missing evidence distinct from measured zero.                                                                                                                                                    |
| Nineteen responses, or 20 responses with 0, 4, 5, 15, 16, or 20 correct                              | Only 5 and 15 correct at 20 responses pass the proposed floors. If either side fails, withhold both sides' evidence and use the same unavailable state.                                                                                                                 |
| Repeated queries, several overlapping delivery pairs, and a known answer at the 60% boundary         | Stable bands and frozen populations across queries. Review the inference example and availability leakage alongside single-session reports, Question Health, and exports before any real release.                                                                       |
| Comparison withheld while an authorized creator report or Question Health exposes exact counts       | Verify what the reader can combine across sources. If acceptance requires protection on those other surfaces, keep real-data comparison unavailable until the combined policy is enforced.                                                                              |
| Audit and access                                                                                     | Compare with an unauthorized or cross-workspace ID, a duplicate ID, a missing source, a downgraded role, or a bearer. Confirm picker, API, UI, telemetry, and shared/exported data never expose ineligible comparison evidence.                                         |
| Deletion, expiry, erasure, or report regeneration during read                                        | Qualify races against the final check before sending the body. If source A is withdrawn, all pairs using A become unavailable, including after regeneration or a policy update. Late client responses cannot restore withdrawn views.                                   |
| Repeat facilitator evaluation                                                                        | Use synthetic scenarios to check whether facilitators can select a checkpoint to revise, explain the denominator and unavailable evidence, and avoid causal or individual claims. Record effort and interpretation mistakes alongside the current spreadsheet workflow. |

Select one implementation checkpoint after acceptance, starting with the bounded source reader
and a strict, withheld-first projection. Extend to a private Results view only after the source
and disclosure cases qualify.

## Baseline verification

On `3f573ce`, 61 existing server tests passed across Question Health observations, published
analysis, Round report generation and jobs, and summary projection, API, and export. Six
in-memory report history and summary storage tests also passed. These suites exercise the
current source and report boundaries. The synthetic comparison matrix is for future qualification.
