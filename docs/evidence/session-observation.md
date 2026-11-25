# Beta session observation record

Do not record participant names, answers, join codes, host tokens, source material, or raw session
state. Use aggregate counts, pseudonymous partner/observation IDs, and redacted request, trace, or
evidence references only. Keep the partner identity, consent record, and unredacted research notes
in the approved private research system.

- Observation ID:
- Date/time (UTC):
- Partner ID and acquisition segment (higher education/workplace):
- Stable pseudonymous facilitator ID:
- Partner session ordinal and previous observation reference:
- Stable partner workflow ID and definition version:
- Artifact type (Round/Presentation):
- Trust mode (Learning/Verified):
- Build commit and image digest:
- Facilitator device/network:
- Participant device/network mix:
- Planned/peak participant count:
- Observer and independent reviewer:

## Delivery outcome

- Join attempts/successes:
- Completion result:
- Reconnect attempts/recoveries:
- Accepted answers and report answer count:
- Report reconciliation result:
- p95/p99 answer acknowledgement:
- Participant question receipt p95/timeout rate:
- Support contact required:
- Incident or issue URLs:

## Recovery-loop evidence

Count facilitator checkpoints, not individual participant answers. A checkpoint is eligible only
when the initial diagnostic produced actionable confusion and a linked, meaningfully different
recheck was available. Count it as evidence-complete only when the diagnostic response was
acknowledged, an intervention was delivered, the linked recheck was opened and answered, and the
ready report reconciled both response sets. The observer must review recheck validity; aggregate
telemetry alone cannot establish it.

- Diagnostic checkpoints observed:
- Eligible recovery checkpoints:
- Evidence-complete recovery checkpoints:
- Incomplete checkpoint reasons:
- Recheck equivalence/validity review:
- Reconciled report evidence URL/checksum:

## R2-00 workflow task records

Freeze the task population, eligibility, assistance, exclusion rules, and intended outcome in the
private protocol before observation. Complete the three task records below for the considered
[R2 candidates](../competitor-backlog-2026-10-27.md), and link each ticket's
[interview evaluation](design-partner-interview.md#r2-00-ticket-evaluation). Keep raw observations,
customer content, participant answers, and identities in the approved private research system.
Use only aggregate counts, stable pseudonymous partner/workflow references, and redacted evidence
handles here.

Keep unassisted completion, assisted completion, failure, exclusion, and pending outcomes distinct.
Retain every started attempt and its reviewed disposition, including failures and excluded records;
report the started and eligible denominators with any task result. These task counts do not add to
interview, real-session, participant-response, or recovery-checkpoint gate counts. A practice attempt
or summary download does not become an observed live session or an evidence-complete recovery
checkpoint. Apply the existing campaign counting rules and P0 usability thresholds separately;
these records introduce no new threshold or aggregate-schema field.

### First-use explanation → intervention → different linked recheck

- Candidate R2 ticket IDs, parent ideas, and interview evaluation references:
- Stable pseudonymous partner/facilitator/workflow references and workflow definition version:
- Frozen task/protocol reference and represented build:
- Started attempts and eligible attempts (denominators):
- Unassisted completions, assisted completions, failures, and pending eligible attempts (counts):
- Excluded attempts (count), predeclared reasons, and review references:
- Explanation comprehension, intervention delivery, and meaningfully different linked-recheck
  validity/completion findings with supporting and contrary evidence references:
- Assistance/workarounds and observed time or user consequence:
- Device/network and assistive-technology observations, accommodations, and finding references:
- Observer review reference and task disposition (accepted/rejected/excluded/pending): Pending
- Independent-review reference and decision (accepted/rejected/pending): Pending

### Standalone practice for a multi-site training task

- Candidate R2 ticket IDs, parent ideas, and interview evaluation references:
- Stable pseudonymous partner/facilitator/workflow references and workflow definition version:
- Frozen task/protocol reference, multi-site context, and represented build:
- Started attempts and eligible attempts (denominators):
- Unassisted completions, assisted completions, failures, and pending eligible attempts (counts):
- Excluded attempts (count), predeclared reasons, and review references:
- Assignment/distribution and participant completion findings with supporting and contrary
  evidence references:
- Assistance/workarounds and observed time or user consequence:
- Device/network and assistive-technology observations, accommodations, and finding references:
- Observer review reference and task disposition (accepted/rejected/excluded/pending): Pending
- Independent-review reference and decision (accepted/rejected/pending): Pending

### Accessible summary download

- Candidate R2 ticket IDs, parent ideas, and interview evaluation references:
- Stable pseudonymous partner/facilitator/workflow references and workflow definition version:
- Frozen task/protocol reference, summary format, and represented build:
- Started attempts and eligible attempts (denominators):
- Unassisted completions, assisted completions, failures, and pending eligible attempts (counts):
- Excluded attempts (count), predeclared reasons, and review references:
- Summary discovery, download, and accessible reading/comprehension findings with supporting and
  contrary evidence references:
- Assistance/workarounds and observed time or user consequence:
- Device/network and assistive-technology observations, accommodations, and finding references:
- Observer review reference and task disposition (accepted/rejected/excluded/pending): Pending
- Independent-review reference and decision (accepted/rejected/pending): Pending

Record each ticket's proposed select/revise/retain/reject/pending disposition in its interview
evaluation, distinguishing missing capability from implemented capability that was undiscovered or
unusable. A task result or proposed ticket disposition does not approve feature implementation,
override the ordered Phase 0/Phase 1 decisions, or close a release gate. Unresolved records remain
pending.

### Wooclap Recovery Loop comparison

Use a private copy of this scorecard with the
[head-to-head protocol](../runbooks/phase0-evidence-campaign.md#wooclap-head-to-head-recovery-loop-test).
Fill one scorecard per arm attempt. Record matched different-question trials and the optional
same-item revote and AI trials under their respective tracks. Keep separate started and eligible
denominators per arm and track, outside the Phase 0 gate counts.

| Run details                                                                                               | Private record |
| --------------------------------------------------------------------------------------------------------- | -------------- |
| Protocol version, track, matched pair and arm IDs, fixture, run order and stable pseudonymous references  |                |
| Tool, build/version (or observed date), plan and enabled settings                                         |                |
| Prior exposure to each tool, first-use estimate eligibility, and prep and join effort                     |                |
| Preflight evidence for fixture settings, expected host and report outputs, and plan or access limitations |                |
| UTC start and end, phase timings, and final disposition (unassisted, assisted, failed, excluded, pending) | Pending        |
| Assistance, workarounds, manual handoffs, deviations and exclusion reason                                 |                |
| Observer and independent reviewer decisions and evidence handles                                          | Pending        |

| Stage                   | Record the observed outcome and evidence                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ask and diagnose        | Closed diagnostic distribution visible time, diagnosis time and current-arm evidence cited, and any product guidance or early reveal                        |
| Intervene               | Study script release time, intervention start and finish, and the action or artifact recorded                                                               |
| Recheck                 | Open and observed close times, submission timing and receipts, timer outcome or observer stop, timing deviations, and prompt or link validity               |
| Reconcile and interpret | Explanation time, expected and reported correct/total for each item, current-arm evidence cited, paired coverage and its denominator, and source of pairing |

For each question record the numbers eligible, submitted, evaluated, and correct. Mark unavailable
counts or pairing as **unavailable** and reserve zero for a measured zero. Limit interpretation to
the immediate response evidence. Publish only reviewed redacted counts and `ref:` or `sha256:`
handles from the approved private evidence index.

## Phase 1 gate signals

- Partner workflow excluded a participant because of timing/connectivity (yes/no/excluded), reason,
  and evidence reference:
- Timing/connectivity-affected attempts (numerator/denominator and percentage):
- Serious accessibility finding ID, severity, review status, and relationship to timing/connectivity:
- Repeat facilitator (yes/no/excluded) and prior accepted observation reference:
- Facilitator used an external deck (yes/no):
- Material context-switch interruption count and evidence IDs:
- Companion or access workaround used:

## Decision

- Facilitator feedback:
- Follow-up session committed/completed:
- Evidence deviations or exclusions:
- Final in-scope disposition (accepted/rejected/excluded/pending), reason, and reviewer:
- Observer decision: Pending
- Independent reviewer decision: Pending
