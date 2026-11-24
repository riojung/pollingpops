# WX-08 fixed-budget allocation discovery

Discovery checkpoint on `7153684`, the baseline from [PR #317](https://github.com/riojung/pollingpops/pull/317).
The candidate lets each workshop participant divide a budget of 100 planning points among
priorities. The product decision is whether those tradeoffs materially change a recurring
workshop decision. The tracked repository has market examples and synthetic starters. A qualifying
partner observation is still pending. [Workspace benchmark](workspace-experience-benchmark-2026-11.md) · [R2-03 selection criteria](competitor-backlog-2026-10-27.md#r2-03-response-formats-on-the-next-needed-surface)

## Establish the existing workflow

Ask a facilitator to reconstruct a recent workshop using a redacted prompt, the actual decision
they needed to make, and the artifact that recorded it. Start with the method they already use.
Observe the existing Polling Pops comparator on that task and record the consequence of stopping
there. Then evaluate whether assigning amounts solves the specific gap. Record where the prompt
needs to run. A need inside a Board or Presentation is separate evidence from a Live Round need.

| Existing approach                                       | What the facilitator can decide from it                                                                                                            | Question to observe                                                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Round or Presentation ranking                           | Order priorities using a full or partial ordering. Aggregate weights come from the ranks.                                                          | Once the order is known, does the group still need to agree how much capacity to commit to each item?                                      |
| Round multiple-selection poll or Guided Workshop ballot | Identify which items received support. A participant selects distinct options up to the limit. A Board ballot gives at most one vote to each idea. | Can the group choose the next action from this list, or must a separate tally capture the split in intensity?                              |
| Ratings or a manual worksheet                           | Rate one item independently, or assign a fixed total using the group's existing worksheet.                                                         | Did the workaround complete the job? Count any reconcile step, switch away from the live workflow, or delay in reaching a usable decision. |

Use the actual presentation or workshop only in the approved private study environment. Record
relative evidence and task outcomes using pseudonymous workflow IDs and redacted references.
[Round response formats](idea-004-response-formats-plan.md) · [Presentation ranking](evidence/presentation-e04-opinion-formats.md) · [Guided Workshop voting](idea-006-brainstorming-boards-plan.md)

## Synthetic walkthrough

Use the fictional Aster planning priorities from the existing quarterly strategy starter. Ask
each person to direct 100 planning points across buying journey, post-purchase support, and routine
operation. Ask the facilitator to record a split for the next review. Use **50 / 30 / 20** and
**70 / 20 / 10** as two responses with the same ordering. Ask what work would change if the second
split replaced the first. Use the same written decision when trying each existing method and the
allocation worksheet. Alternate the order of the methods when repeating the synthetic task so
practice is less likely to favor one method.

The individual-response table below is synthetic and supports manual result checking. A facilitator
can read the prompt aloud, let a participant enter three labelled values on paper or in a
keyboard-accessible worksheet, and reveal the aggregate at the end.

| Synthetic response                     | Buying journey | Post-purchase support | Routine operation | Allocated |
| -------------------------------------- | -------------: | --------------------: | ----------------: | --------: |
| A                                      |             50 |                    30 |                20 |       100 |
| B                                      |             70 |                    20 |                10 |       100 |
| C                                      |             35 |                    34 |                31 |       100 |
| D                                      |             60 |                    30 |                10 |       100 |
| E                                      |             40 |                    40 |                20 |       100 |
| Total                                  |            255 |                   154 |                91 |       500 |
| Mean points per responding participant |           51.0 |                  30.8 |              18.2 |     100.0 |

Option totals add the points for that option. The mean divides each total by the **five accepted
responses**, including a response that assigned zero to an option. Show the respondent count and
how much of the available budget was used. Points here express stated priorities. They do not
measure correctness, learning gain, or an approved spending commitment.

Test two authored policies separately. Keep 100 as the fixed maximum for both. Use integer
inputs between 0 and 100 for each option and show points entered and remaining in text. All-zero
input has a separate **Skip** action in this candidate. It does not count as a submitted response.
Announce invalid input and remaining points without requiring a slider, drag, or color to
understand the state.

| Input                                                               | Require all 100 points              | Allow unused points       |
| ------------------------------------------------------------------- | ----------------------------------- | ------------------------- |
| 50 / 30 / 20                                                        | Accept                              | Accept                    |
| 70 / 20 / 0                                                         | Ask for 10 more points              | Accept. Record 10 unused. |
| 60 / 40 / 0                                                         | Accept, including the explicit zero | Accept                    |
| 0 / 0 / 0                                                           | Offer Skip                          | Offer Skip                |
| Fraction, negative, missing value, unknown option, or sum above 100 | Ask for a correction                | Ask for a correction      |

With partial allocations, include unused capacity separately as `100 × respondents − total points`.
For example, replace E with **80 / 0 / 10**. The option totals are **295 / 114 / 81**, with
490 allocated, 10 unused, and five respondents. Post-purchase support averages 22.8 points
across all five responses, including E's zero.
Keep zero allocations distinguishable from missing input, a skipped checkpoint, and an empty or
withheld result. Describe the denominator before asking the facilitator to interpret the result.
[Fictional Aster starter](../apps/web/lib/presentation-native-template-content.json)

## Observation and selection

Before recruiting, have the research owner record the sample, measurement thresholds, and
review plan. For each recruited facilitator, record the actual decision, comparator, and expected
output before trying either method. Use the existing private partner observation process and
include successful workarounds as well as failures.

**Evidence required for selection.** Before showing the synthetic exercise, use a redacted
record or direct observation of the existing workflow to establish that each participant must
divide their own fixed budget across competing priorities. More points for one option consume
budget that could go to another. Record the original constraint and the concrete decision that
the facilitator had to delay, change, or leave unresolved when the existing method could not
capture those participant tradeoffs. Independent intensity ratings and a budget split decided
only by the facilitator leave this criterion open. Use the synthetic exercise to evaluate input
and result interpretation separately from demand.

- **Completion.** The facilitator produces the predeclared output and states the next action
  without observer correction. Require amounts in the real task only when the original decision
  requires them. In the synthetic exercise, check that the facilitator records the three amounts
  and explains the sum and respondent count. Record baseline and candidate completion separately,
  time to a usable result, and interpretation errors such as reading rank as points or treating
  unused points as missing answers.
- **Switching friction.** Give each method equivalent starting materials and count setup,
  interruptions, manual re-entry, and reconciliation through the decision. The proposed pilot target
  is that the candidate completes the weighted task and removes at least one required switch or
  manual reconciliation step in an observed workflow that the existing Round or Board method
  blocks. Count the worksheet's own switches and tally steps. Treat a step expected to disappear
  in a future in-app implementation as a hypothesis until the trial shows it can be removed.
- **Recurrence and selection.** Ask the research owner to agree a pilot sample and recurrence
  threshold before observation. A proposed starting point is two independently reviewed repeat
  facilitator workflows that each meet the participant-budget evidence requirement. Keep
  observations of repeated workshops as evidence of recurrence and count each stable partner
  workflow once toward the threshold. Select the Live Round slice only if the evidence supports
  that surface and the predeclared completion and switching criteria. Keep the item pending if
  order or support is enough, an existing worksheet fits without material cost, or the evidence
  is mixed.

Record workflow ID, date, relevant surface, baseline method, a redacted reference for the
participant-level budget constraint, the decision consequence, time and interruptions for
each method, outcome, accessibility findings, and reviewer disposition. Keep identifying data,
actual budgets, and unredacted recordings in the approved private research system.
[Session observation record](evidence/session-observation.md) · [Evidence handling](evidence/README.md)

## Implementation sequence if selected

1. Qualify additive versioned Round contracts, stored readers, and disabled rendering. Freeze
   option identities, budget, and the full/partial rule with publication. Define authoritative
   integer and sum validation, server receipt idempotency and reconnect behavior. A saved response
   is bound to authored IDs and retry identity. Preserve existing artifact and report readers.
2. Qualify the complete Live Round authoring, rehearsal, publish, host, participant, reveal,
   retained-report and export paths before enabling new writers. Deploy compatible server readers
   before advertising a new client capability. Check older clients in new rooms and updated
   clients against older servers, and show a clear update action where support is missing.
   Test mixed formats and decide revote behavior explicitly. Display aggregate option totals,
   respondent count, and unused points where the authored policy permits them. Keep opinion
   results unscored and outside accuracy and recovery measures. Apply the approved aggregate
   and reveal rules to all readers, including summaries and exports. Check that the disclosure
   floor cannot be bypassed by moving between readers. Other surfaces need their own qualification.

## Local verification

On `7153684`, 21 existing game-engine, server, and web tests passed for the ranking, Board ballot
controls, and summary baselines. These verify the comparators where covered. The repository's
empty Phase 0 example validates as pending with `pnpm research:check`. Partner observation and
the WX-08 selection decision remain pending.
