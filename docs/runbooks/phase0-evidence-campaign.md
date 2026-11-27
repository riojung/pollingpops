# Phase 0 evidence campaign

Use this runbook to collect the reviewed evidence required to select Polling Pops’ primary
acquisition segment and exactly one Phase 1 branch. Product telemetry can corroborate a session,
but it cannot replace consented observation, recheck-validity review, or independent coding.

Do not commit identities, contact details, consent records, participant answers, customer content,
room codes, credentials, private provider URLs, or raw session state. Store them in the approved
private research system. Repository records contain only reviewed aggregates, pseudonymous
references, stable evidence URLs or checksums, and decisions.

## Roles and preconditions

Before recruitment begins:

1. Name the research owner and an independent reviewer who did not facilitate the observed session.
2. Freeze the protocol version, consent language, represented Git commit, and image digests.
3. Select the private research system and verify its access and retention controls.
4. Copy the interview, session-observation, and usability templates into that system. Copy the
   [research prototype evaluation](../evidence/research-prototype-evaluation.md) only when an
   optional Prototype Lab study is part of the protocol.
5. Define facilitator eligibility, exclusion, assistance, failed-instrumentation, and serious
   accessibility-finding rules before viewing outcomes.
6. Assign stable pseudonymous partner, facilitator, and workflow IDs and freeze the in-scope cohort
   and observation cutoff before aggregation begins.

The build may remain allowlisted and feature-flagged. Repository presence or local automation does
not make a pilot eligible.

## R2-00 execution checklist

Use this checklist for [R2-00](../competitor-backlog-2026-10-27.md#r2-00-establish-demand-and-select-the-next-increment).
Complete a private copy using the existing interview, observation, usability, and decision records;
this is not another intake form. The blank checklist records preparation work, not study results or
release approval. Keep names, recruitment details, schedules, and private workspace addresses out
of Git.

| Preparation                                                          | Responsible role                        | Required private record or reviewed reference                                                                                          | Status  |
| -------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Assign the research owner and a reviewer independent of facilitation | Product research                        | Owner/reviewer assignments and independence confirmation                                                                               | Pending |
| Approve the private evidence workspace                               | Research owner                          | Access, consent, retention, and deletion arrangements                                                                                  | Pending |
| Establish an eligible pilot build                                    | Engineering and gate owners             | Represented commit/image digests, enabled features, and applicable release evidence                                                    | Pending |
| Freeze the protocol before observing outcomes                        | Research owner and independent reviewer | Eligibility, assistance/exclusion rules, task populations, timing method, success thresholds, cohort/cutoff, and primary/reserve order | Pending |
| Prepare ticket-linked evidence capture                               | Research owner                          | Existing interview and observation records with R2 ticket and stable partner/workflow references                                       | Pending |
| Arrange the three R2-00 workflow tasks                               | Research owner                          | Recovery-loop, multi-site standalone-practice, and accessible-summary tasks with predeclared eligible populations                      | Pending |
| Plan repeat pilots and independent review                            | Research owner and independent reviewer | Private recruitment/session schedule and review capacity against the existing campaign minimums                                        | Pending |

Record each considered candidate in the interview's
[R2-00 ticket evaluation](../evidence/design-partner-interview.md#r2-00-ticket-evaluation).
Collect supporting **and contrary** observations, the current workaround, frequency/consequence,
and the eligible denominator. Distinguish a missing capability from an existing capability that
participants could not discover or use. A public feature request or synthetic browser result is
not a Polling Pops customer observation.

Use the observation's
[R2-00 workflow task records](../evidence/session-observation.md#r2-00-workflow-task-records)
to test all three backlog workflows. Freeze which users and opportunities are eligible for each
task before observing outcomes; retain assistance, failures, exclusions, and tasks not run.
Task completion and download success alone do not establish recheck validity, accessibility, or
learning effectiveness. Keep these task populations separate from the existing campaign and
usability denominators; do not add them to the aggregate JSON as new fields or count them twice.

After independent review, index each considered ticket in the existing
[R2-00 candidate disposition record](../evidence/phase0-stage-decision.md#r2-00-candidate-dispositions).
A proposed select/revise/retain/reject disposition does not approve implementation or replace the
ordered segment and Phase 1 decision. Unresolved evidence stays pending, and all current candidates
remain Deferred until a separate product-owner selection meets the existing gates.

## Wooclap head-to-head Recovery Loop test

Compare whether a facilitator can diagnose a misconception, deliver a relevant intervention,
open a different question on the same concept, and explain the session evidence. Record
completion, elapsed time, and any help or manual steps. Use the
[comparison record](../evidence/session-observation.md#wooclap-recovery-loop-comparison)
alongside the existing R2-00 first-use task record.

### Prepare the two arms

1. Freeze the Polling Pops commit, build, feature settings, and Wooclap plan, settings, and
   observed UI date or version. Use comparable supported browsers, devices, networks, host
   permissions, and no-account participant entry. Record the facilitator's prior use of
   both products before assigning an order.
2. Prepare an answer-keyed diagnostic and alternate for each kit. In Polling Pops, make two
   independent copies of the Misconception check Recovery starter. Keep Kit A as authored.
   For Kit B, replace the prompts and choices in place and adapt the authored explanations.
   Keep choice 1 correct in both items, keep the diagnostic misconception tag on choice 2,
   and preserve the shared concept key, diagnostic and practice purposes, question confidence,
   and link to the alternate. Publish each Round. In each new room, enable **Ask for confidence
   (optional)** and use timed responses with the same accuracy and visibility settings. In
   Wooclap, place each kit's two MCQs in its own live event, set the matching answer keys, and
   enable Certainty Check where the frozen setup supports it. Turn off **Display answers
   automatically** in each test event so the host can show the distribution after closure.
   Set a 30-second deadline on both questions in each tool.
   [Wooclap live question setup](https://docs.wooclap.com/en/articles/3190733-how-to-create-multiple-questions-quickly-and-easily)
3. Ask an independent reviewer to check that both kits assess the same objective, use
   unambiguous scoring, and make the alternate a different application of the concept.
   Freeze the questions, settings, task script, target comparison sample by segment, participant
   eligibility, time caps and exclusion rules before recording outcomes. If a required capability
   is unavailable on the tested account, retain the attempt and record it with the plan and reason.
4. Counterbalance product order and fixture assignment within each segment. Rotate the
   predeclared schedules of Polling Pops A then Wooclap B, Wooclap A then Polling Pops B,
   Polling Pops B then Wooclap A, and Wooclap B then Polling Pops A. Give facilitators the same
   neutral task brief and ordinary tools in each arm. Keep the answer key, scripted totals and
   alternate content out of that brief. Use a fresh room and separate notes for each arm, and
   retain incomplete pairs.
5. Have staff rehearse each kit in both tools before facilitator sessions. Verify guest entry,
   response receipt, the closed diagnostic distribution before revealing the answer, and timed
   closure for the alternate. In both Polling Pops kits, confirm the confident-misconception
   recommendation after reveal, the **Open linked recheck** action after intervention, and the
   linked recheck and concept evidence in the report. In Wooclap, confirm the vote distribution,
   available certainty evidence, and results for both MCQs. Record the observed settings, outputs,
   and any plan or access limitation in the private preflight record.

### Check the Wooclap plan before running five guests

Sign in to the approved host workspace and inspect its actual plan and remaining allowance before
launching either event. Wooclap documents a Starter allowance of five active questions in a
30-day period. Three unique responses can activate a question, so the two kits can use four slots
in a fresh Starter period. Recheck the allowance before the optional revote and AI runs. If the
account cannot run a kit with all five scripted guests, record the plan limitation and leave that
kit pending. Use the on-screen reports for the primary task and record export separately.
[Wooclap Starter limits](https://docs.wooclap.com/en/articles/14402104-what-is-wooclap-s-pricing)
· [Wooclap live reports](https://docs.wooclap.com/en/articles/674961-how-to-download-or-export-event-results)

### Use the same synthetic response pattern

Both fixtures address whether a past, unrecoverable cost should decide what to do next.

**Kit A.** Use the exact [Misconception check starter](../../apps/server/src/starters.ts#L138-L183)
in both products. It begins with a project that is unlikely to meet its goal and rechecks the
concept with a prepaid course that no longer fits the learner's goals.

**Kit B diagnostic.** “A team paid a nonrefundable deposit for an in-person workshop. Most
attendees now need to join remotely. What should guide the team's decision about using the venue?”

1. Compare the remaining costs and benefits of using the venue with the remote alternatives. (Correct)
2. Use the venue because the team already paid the deposit. (Scripted misconception)
3. Keep the original plan regardless of the new information.

**Kit B recheck.** “A team prepaid for a reporting tool. Its reports are now produced
automatically elsewhere. What should guide the decision about doing the extra work to keep
using the prepaid tool?”

1. Compare the future value of both approaches and the effort each one takes. (Correct)
2. Keep using the prepaid tool so the original payment is worthwhile. (Scripted misconception)

Omit the answer annotations in both products. Privately brief the five scripted guests. All five
select the past-cost misconception on the diagnostic. On the recheck, four select the correct
answer and one selects the past-cost answer. Use the highest confidence choice where available and
record differences in scale or visibility separately. When Wooclap Certainty Check is on,
scripted guests select the answer, press **Submit**, and select **Very confident** before pressing
**Confirm my certainty**. Use the confirmation as the submission time and verify the saved response.
Staff use **0 of 5** diagnostic and **4 of 5** recheck answers correct as reconciliation targets.
[Wooclap MCQ and Certainty Check](https://docs.wooclap.com/en/articles/8513348-mcq)

### Run and score the task

Start the clock when the facilitator can see the response distribution for the closed diagnostic.
Ask what pattern the responses show, what evidence in this arm supports it, and what they would
do next. Record their diagnosis before using the tool's answer reveal or handing them the study
explanation. When that diagnosis is recorded, give each facilitator the same explanation to
deliver. “Time or money already spent cannot be recovered. Compare the future costs, benefits,
and alternatives of each option.” Ask them to perform the intervention, open the different
recheck, then explain the evidence using the tool's normal controls and any predeclared manual
notes from the current arm. Record any product-provided guidance the facilitator used.

Use one observer clock throughout. Record preparation and joining separately from these phases.

1. Allow **five minutes** from diagnostic distribution visibility to recheck opening. Open the
   alternate after the intervention. At the facilitator's request, the observer may repeat a
   task prompt once verbatim. Additional content or navigation cues count as assistance.
2. Cue the scripted guests privately when the alternate starts accepting answers. Each guest
   submits once between **5 and 15 seconds** after opening. The product's timer closes responses
   at **30 seconds**. The facilitator leaves the timer running and keeps the vote closed after
   the deadline. Record opening and observed closure separately. If the tool still shows voting
   open after **35 seconds**, the observer stops the vote with the host controls and records a
   missed closure deadline. End the attempt if voting cannot be stopped. The five seconds allow
   for the closed state to appear. Keep the response deadline at 30 seconds. Record a pause,
   early closure, or reopen as a departure from the common window.
   [Wooclap question timer](https://docs.wooclap.com/en/articles/674942-can-i-set-a-timer)
3. Allow **three minutes** from observed closure for the facilitator to explain the report. Have
   them point to the diagnostic and recheck results from the current arm and identify where each
   count came from. The observer keeps the expected counts private.

| Stage                 | Record                                                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diagnose              | Time, the stated diagnosis, current-arm response evidence, and any product cues or early reveal.                                                                                                                                  |
| Intervene             | Study script release, intervention start and finish, action, and whether the product or facilitator notes record it.                                                                                                              |
| Recheck               | Open and close timestamps, scripted submission timing, receipt, timer outcome or observer stop, and whether the prepared question assesses the same concept with a keyed answer.                                                  |
| Reconcile and explain | Time, current-arm evidence the facilitator identifies for response and correct counts, and how they connect the two checkpoints to the intervention. Record pairing coverage where available, manual joins, and context switches. |

An unassisted completion requires identification of the misconception, delivery of the
intervention, the common recheck window, and a correct report explanation within the frozen
caps. The diagnosis and report explanation must cite evidence from the current arm. Count an
eligible arm as a failure if it misses a cap or departs from the common recheck window. Apply
exclusions only under the frozen criteria. Preserve assisted completions, failures, exclusions,
and pending records with their observed times. Record who provided help, what they supplied,
and when. Report started and eligible denominators for both arms and count the attempts that
missed each stage.

Record eligible, submitted, evaluated, and correct counts for each question. Use the private scripted
reference to check displayed evidence. Report any missing or withheld counts as unavailable.
When the product cannot establish matched responders, accept a correct aggregate explanation
and record the pairing limit. The synthetic change in correct answers checks report
reconciliation. The comparison measures facilitator workflow and in-session interpretation.

Have the independent reviewer reconcile each arm's disposition against the scorecard. Review
completion, report interpretation, elapsed time, assistance, and manual work together. For the
primary first-use estimate, use only the first arm of facilitators new to both tools. Keep
first-arm failures and exclusions in that view, even if the second arm succeeds. Report by
assigned product, kit, and segment. For the separate paired analysis, show the number of
completed and incomplete pairs, paired timing differences, and the effect of kit, arm order,
and prior exposure. Record supporting and contrary observations in the existing ticket evaluation.
Treat small or conflicting samples as unresolved when deciding which workflow to improve.

### Keep optional paths and campaign results separate

- **Same-item revote.** In a fresh optional run, give Wooclap credit for duplicating the MCQ
  after peer discussion and showing its before-and-after results. Record discovery, speed,
  and interpretation separately from the different-question task.
  [Live duplication](https://docs.wooclap.com/en/articles/3557734-how-to-duplicate-a-question-in-real-time)
  · [Comparison mode](https://docs.wooclap.com/en/articles/1268260-what-is-the-comparison-mode)
- **AI-generated alternate.** If the frozen Wooclap account has Learning Consolidator access,
  rehearse it using synthetic content in a separate run. Record whether the facilitator can
  inspect and approve the generated question before showing it. Review concept fit, reasoning
  difference, answer cues and scoring. Preserve unfit suggestions in the private record.
  [Learning Consolidator](https://docs.wooclap.com/en/articles/14019335-learning-consolidator)
- **Report access.** Use comparable live report access for the primary task. If export is
  tested, record format, plan and what fields the export contains as a separate result.
  [Wooclap report access and export](https://docs.wooclap.com/en/articles/674961-how-to-download-or-export-event-results)

Keep filled records and provider evidence in the approved private research system. Use reviewed
aggregate counts and redacted evidence handles in Git. Run the Recovery Loop browser fixture
against the production beta build to check both Polling Pops kits.

```sh
node scripts/build/browser.mjs build beta
PLAYWRIGHT_PRODUCTION=true PLAYWRIGHT_REUSE_BUILD=true pnpm test:e2e:beta \
  tests/beta-e2e/ux-beta.spec.ts \
  --project=chromium-beta --grep 'creator and participants complete a beta Recovery loop through report'
```

Each kit uses a fresh Round and five independent synthetic guests. The cases check saved response
receipts, the unrevealed diagnostic distribution, and the linked recheck after the intervention.
The cases verify that the server sets the deadline to 30 seconds after the recorded opening, locks
at or after that deadline, and shows the lock to the host within 35 seconds of opening. The recheck
receipts must appear within 5–15 seconds of the recorded opening. The host and report checks
reconcile 0/5 correct diagnostic responses, 4/5 correct recheck responses, and one unresolved
response for the concept. The timing attachments record the server's opening-to-lock elapsed
time, the host's command-to-observation and lock-to-observation times, and the elapsed times from
opening to the guest receipt observations.

Use these results for technical calibration of the Polling Pops arm. Record the head-to-head
facilitator task in the private comparison record and use the existing campaign workflow for
observed sessions, usability results, and gate decisions.

## Technical checks for the other R2-00 workflows

Reuse the production beta build above to check the existing standalone practice and Session
Summary flows.

```sh
PLAYWRIGHT_PRODUCTION=true PLAYWRIGHT_REUSE_BUILD=true pnpm test:e2e:beta \
  tests/beta-e2e/ux-beta.spec.ts \
  --project=chromium-beta --grep 'creator assigns immutable practice and manages accountless progress'
BETA_E2E_SESSION_SUMMARIES=true PLAYWRIGHT_PRODUCTION=true PLAYWRIGHT_REUSE_BUILD=true \
  pnpm test:e2e:beta \
  tests/beta-e2e/session-summaries.spec.ts --project=chromium-beta \
  --grep 'session summaries publish real Round, Presentation and closed Survey evidence'
```

The practice case checks an assignment pinned to published content, accountless learner access,
and facilitator progress. The Session Summary case checks publishing and downloading summaries
and revoking their links. Record the multi-site handoff and assistive-technology observations in
the private workflow task records.

## Counting rules

- An in-scope record is every interview, observation, or usability task started for the frozen
  cohort before the cutoff, regardless of its eventual eligibility. Apply the predeclared rules to
  give every in-scope record an independently reviewed final disposition of accepted, rejected, or
  excluded with a reason before a gate or branch decision. Use only the predeclared aggregate reason
  codes: `eligibility-failure`, `withdrawal`, `unusable-protocol-record`,
  `failed-instrumentation`, or `protocol-exclusion`. Any pending record keeps the dependent
  aggregate and decision pending; it is not valid input to a closure aggregate.
- Preserve every independently reviewed usability attempt, including rejected and excluded
  attempts. Number attempts separately within each segment using contiguous `attemptOrder` values;
  attempt 1 uses `supersedesStudyId: null`, and every later attempt names the immediately preceding
  study. A final aggregate has exactly one eligible `accepted` decision record per segment, and it
  must be the last attempt in that segment's chain. Earlier rejected/excluded attempts remain in the
  aggregate with null metrics and their predeclared reason instead of being overwritten.
- Before recurring-problem outcomes are coded, freeze a primary evaluation cohort containing the
  first six independently confirmed eligible facilitator IDs by enrollment order in each segment.
  Freeze a same-segment reserve order at the same time. Substitute only for a predeclared
  withdrawal, eligibility failure, or unusable protocol record, always taking the next reserve and
  recording the reason. Never substitute because a facilitator does not demonstrate the problem;
  an unresolved primary record keeps the gate pending.
- A partner workflow is one recurring real facilitation process identified by a stable pseudonymous
  partner/workflow ID and definition version. Repeated sessions of the same workflow count once.
  Assign a new workflow ID only for a material change to the audience, delivery tools, or sequence
  that the independent reviewer accepts; a new session alone never creates another workflow.
- For this campaign, an observed attempt is one eligible participant's opportunity to submit one
  response to an observed live diagnostic or linked recheck. Count each participant/checkpoint
  opportunity once regardless of retries or reconnects. Exclude content-only blocks, staff
  previews, and records excluded by the predeclared protocol; do not combine joins or unrelated
  interaction types into the response-attempt rate.
- Compute the Access affected-attempt rate from accepted eligible session records plus any final,
  independently reviewed record with a timing/connectivity exclusion and a positive eligible-attempt
  denominator. Keep such attempts in both the numerator and denominator even when that exclusion
  makes the enclosing session rejected, excluded, or ineligible; otherwise the failure mechanism
  selects itself out of the rate. Other rejected or excluded records remain outside this population.
- An attempt is timing/connectivity-affected only when the participant cannot receive or submit the
  checkpoint and obtain authoritative acknowledgement before the applicable host close/deadline,
  or can complete it only through an observer-documented timing/connectivity workaround. A wrong
  answer, voluntary nonresponse, or content misunderstanding is not affected.
- A workflow has a timing/connectivity exclusion when at least one participant cannot complete a
  required workflow step, or can participate only through an ad hoc workaround, for a reviewed
  timing/connectivity reason. Count each stable workflow ID at most once.

## Minimum evidence set

The Phase 0 research gate cannot pass until the reviewed evidence includes all of the following:

- at least six eligible higher-education and six eligible workplace facilitators;
- at least eight of the frozen primary twelve demonstrating the recurring post-result “what next?”
  problem;
- at least three partners per segment completing two pilots;
- at least ten observed real sessions;
- at least 50% of eligible recovery checkpoints completing an acknowledged diagnostic, recorded
  intervention, valid linked recheck, and reconciled report; and
- one final eligible accepted P0 beta usability decision record per segment, with any earlier
  rejected/excluded attempts retained in its ordered supersession chain.

Each segment usability result must represent at least six eligible first-time facilitators and at
least twenty eligible participants. Freeze these hard floors in the protocol before recruitment;
larger predeclared samples are allowed, but the floors cannot be relaxed after outcomes are viewed.

Recruit above the minimums so exclusions or failed instrumentation do not pressure reviewers to
relax eligibility rules.

## Interview and observation workflow

For each facilitator interview:

1. Record consent and identity only in the private system.
2. Complete a private copy of the
   [design-partner interview record](../evidence/design-partner-interview.md).
3. Have the independent reviewer code eligibility, recurring-problem evidence, segment, and
   repeat-pilot status. An interview does not count until that review is accepted.

For each real session:

1. Complete a private copy of the
   [session-observation record](../evidence/session-observation.md).
2. Reconcile accepted answers with the ready report and review whether every claimed linked
   recheck is meaningfully different.
3. Record eligible and evidence-complete checkpoint denominators.
4. Record timing/connectivity exclusions, serious accessibility findings, external-deck use, and
   material context-switch interruptions using evidence references rather than raw content.
5. Record repeat-facilitator status and the previous accepted observation reference.
6. Obtain an independent accepted, rejected, excluded, or pending disposition. Preserve every
   recorded denominator and exclusion reason; a pending observation cannot support a gate result,
   and any aggregate that depends on it remains pending.

Run the moderated usability protocol with the
[P0 beta usability record](../evidence/beta-usability.md). Preserve segment-level results; an
overall result cannot conceal a failed segment.

Companion, Question Health, and delayed-probe Prototype Lab tasks are optional research inputs, not
Phase 0 closure prerequisites. When the frozen protocol includes one, use a private copy of the
[research prototype evaluation record](../evidence/research-prototype-evaluation.md). Treat the
lab's redacted export as corroborating instrumentation only. Independently review the paired real
workflow, every in-scope finding disposition, and delayed-probe validity before including any
aggregate in a roadmap decision. Prototype activity never substitutes for a real observed session,
an evidence-complete recovery checkpoint, or an independently reviewed gate result.

## Machine-readable aggregate

After every in-scope record has a final independent disposition, copy the deliberately empty
[aggregate example](../evidence/phase0-research-aggregate.example.json) to the approved private
working location and populate it against the
[aggregate schema](../evidence/phase0-research-aggregate.schema.json). Do not commit the populated
file. Use only stable pseudonymous IDs and `sha256:` checksums or opaque `ref:` handles that resolve
through the approved private evidence index. The validator rejects unknown/raw fields, pending
records, missing reviewed reason codes, duplicate record IDs, unstable workflow bindings, bad
denominators, broken usability supersession chains, multiple accepted usability decision records,
undersized usability samples, a cherry-picked primary cohort, and decisions that disagree with the
inputs.

Run:

```sh
pnpm research:check -- path/to/redacted-aggregate.json
```

The evaluator independently recomputes the six eligible facilitators per segment, the first six
eligible primary facilitators per segment and eight-of-twelve recurring-problem threshold, three
repeat partners per segment, ten real sessions, the evidence-complete checkpoint ratio, and
one final eligible accepted usability decision record with at least six eligible first-time
facilitators and twenty eligible participants in each segment. Rejected/excluded attempts remain
preserved but never replace or contribute metrics to that final decision record. The initial primary
cohort must be the first six eligible-at-freeze
facilitators per segment. Any final-cohort change must name the removed ID, the next same-segment
reserve ID, an allowed reason, its sequence, evidence, and an accepted independent review; the
validator replays the chain instead of inferring a substitution. A repeat partner has at least two
accepted eligible session IDs. A repeat external-deck facilitator has at least two accepted eligible
sessions and an accepted session with external-deck use. These definitions prevent a repeated
record or one-off prototype task from satisfying a field gate.

For acquisition selection, one segment must be no worse on repeat partners and evidence-complete
checkpoints and better on at least one. Conflicting leaders remain pending. If both leading measures
tie, the evaluator compares median unassisted activation, then the yes/known
willingness-to-pay rate; missing or still-tied reviewed evidence remains pending. For the final
fallback, it selects only a unique accepted activation/correctness failure with the greatest
affected/eligible rate. A top-rate tie remains pending rather than inventing another score.

The command's success means the redacted aggregate is internally consistent. It does not establish
that evidence is authentic, reviewers are independent, or a gate is accepted; preserve its output
and input checksum in the decision record for human review. Phase 0 computes accepted only when all
thresholds pass and both the explicit research-owner and independent-reviewer aggregate decisions
are accepted.

## Aggregate and decide

After review, validate the machine-readable aggregate and populate only its redaction-safe totals,
checksum/reference, and evaluator result in the
[Phase 0 decision record](../evidence/phase0-stage-decision.md):

1. Confirm the cohort and cutoff are frozen and every in-scope record has a final disposition.
2. Accept or reject the Phase 0 research gate against every minimum above.
3. If accepted, choose the acquisition segment with more repeat pilots and evidence-complete
   recovery loops; break a tie using faster activation, then willingness to pay.
4. Evaluate Access first. It passes when timing/connectivity excludes participants in at least
   three partner workflows, affects at least 10% of observed attempts, or produces a serious
   accessibility finding.
5. Evaluate Companion only after Access explicitly fails. It passes when at least four repeat
   facilitators use an external deck and at least two observed sessions contain a material
   context-switch interruption.
6. Consider the largest measured activation or correctness failure only after both prior gates
   explicitly fail. Compare reviewed candidates with explicit eligible denominators.
7. Keep the branch pending if any prerequisite decision or independent review is pending.

Failed gates cancel or reframe the candidate capability; they do not merely delay it.

## Close the campaign

1. Record the frozen cohort/cutoff and the accepted, rejected, or excluded disposition of every
   in-scope record; unresolved or pending records keep the campaign open.
2. Add stable redacted evidence URLs or checksums to the aggregate decision record.
3. Obtain research-owner and independent-reviewer decisions.
4. Update the `design-partners` and `beta-usability` entries in
   `docs/release-readiness.json` only when their criteria are fully accepted.
5. Run `pnpm research:check -- path/to/redacted-aggregate.json`, `pnpm readiness:check`, and
   `pnpm test:smoke-support`.
6. Submit the decision and ledger change through normal review before enabling Phase 1 creation in
   any workspace.
