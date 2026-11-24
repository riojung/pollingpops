# WX-13 ordered learning sequences: identity and privacy

November 24, 2026. Design proposal for product, learning-delivery, and privacy review.

## First use case

A facilitator shares a short reading followed by a practice check. The learner needs to know
what to do next and where to pick up after an interruption. Compare an ordered checklist with
the same two links shared independently. Use synthetic content and two existing, same-workspace
assignments: a published Presentation reading assignment and untimed Presentation choice
practice. Each assignment pins its own exact publication. This checkpoint defines the evaluation.
Product selection, partner observation, and implementation remain open.

The current [reading assignment](evidence/presentation-e08-reading-assignments.md) and
[choice practice](evidence/presentation-self-paced-practice.md) both distinguish a shared entry
link from a private attempt. Opening a shared link previews the activity. Starting and using a
saved personal resume link each require an explicit action. The assignment runner owns the
attempt, accepted progress, answers, and feedback.

## Learner identity options

| Model                                     | What it supports                                       | Privacy and interpretation                                                                                                                   | Decision                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Account-free browser checklist            | Order, self-marked progress, and same-browser return   | Someone with access to the same browser profile may see the checklist. A fresh browser starts with a blank checklist.                        | First prototype candidate                                                                                     |
| Sequence-specific server resume pass      | Resume the same checklist on another device            | The server would link stages through the pass. Possession of a forwardable pass establishes access to saved state.                           | Reconsider if cross-device resume is a demonstrated need. Review collection, retention, and disclosure first. |
| Labelled per-recipient invitation         | A facilitator can distribute a separate invitation     | The label records the intended recipient. A forwarded link can be used by someone else.                                                      | Defer. Existing labelled links do not establish who completed an activity.                                    |
| Signed-in or institution-verified learner | Identified progress and possible roster-based delivery | Requires role and tenant binding, a learner data lifecycle, and a separate reporting decision. Current LTI supports instructor Deep Linking. | Separate Verified-mode design, outside this checkpoint.                                                       |

The browser checklist can test the navigation and interruption problem without a server-side
learner record. This follows the [W3C data minimization principle](https://www.w3.org/TR/privacy-principles/#data-minimization)
and the product's [trust mode boundaries](market-research-and-development-plan-2026-09.md#epic-f--two-trust-modes).
Current learner launch restrictions are documented in the
[institution integration guide](institution-integrations.md).

## Learner experience and data boundary

- List the steps in order, show the next suggested step, and let learners reopen either
  available activity. Opening, previewing, skipping, or retrying a checklist step creates no
  child attempt. Use the existing activity's explicit Start or Resume action.
- Use **Mark done**, **Skip optional step**, and **Open again**. Keep a skipped step visible.
  A required step that the learner cannot open prevents an all-required-steps-done message.
  Label all checklist progress as self-marked. An activity's own saved reading or practice
  status remains in its runner, and the facilitator receives no checklist status.
- Keep the checklist in the tab by default. Offer explicit **Remember on this browser**
  with clear shared-device copy and **Clear this checklist**. Durable state contains the
  sequence revision, step IDs, self-marked flags, and expiry, scoped to the exact workspace and
  sequence. Restoring it requires successful current availability checks. Cap storage by a
  short pilot window agreed before testing and by the sequence's access deadline. Discard
  stale or invalid entries. If browser storage fails, use tab-only state and explain what a
  reload will reset.
- **Clear this checklist** resets the current tab and deletes remembered flags for this
  revision from the browser profile. Serialize clear and save across tabs so a stale write
  cannot restore cleared flags. A save must match the current browser-local save generation.
  Clearing invalidates that generation, which is never reused. A fresh save requires a new
  opt-in. Notify open tabs and revalidate when a suspended tab becomes visible or is restored,
  before displaying or saving remembered progress. A missing or unreadable generation
  invalidates an older copy. Keep this coordination state within the same storage scope and
  retention cap as the checklist.
  If durable deletion fails, clear the current view and tell the learner that saved progress
  could still be present. Existing assignment attempts follow their own rules. A facilitator
  cannot remotely clear offline browsers.
- Keep names, learner identifiers, activity attempt IDs, credentials, responses, scores, and
  per-step event history out of sequence storage. Exclude checklist data and joinable
  cross-stage identifiers from sequence requests, URLs, referrers, telemetry, and exports.
  Preserve the child runner's existing private resume flow. A saved reading resume link
  restores that reading attempt only.

## Version, access, and withdrawal

For a runtime candidate, bind each published sequence revision to its publisher in the workspace.
Require current authority to publish the sequence and to share every attached assignment in that
workspace. Pin the sequence revision, ordered step references, exact assignments, and their
published versions. Use only the assignments' shared entry. Exclude personal passes,
including [report-origin recovery links](../apps/server/src/followup-service.ts#L242-L251) that can reference a prior live
participant. A new publication never changes a pin. Republishing a sequence creates a new
checklist revision.

Use original facilitator-held links in the synthetic comparison. Existing assignment listings
return metadata, while guest handoff requires the shared bearer and the service retains
only its hash. An assignment ID cannot recover the link. Before selecting runtime, qualify
an authorized handoff that supplies only the intended shared entry and keeps capabilities
out of checklist storage and logs. [Reading assignment access](../apps/server/src/presentation-assignment-service.ts#L92-L122)

Recheck the sequence publisher's authority and step availability on entry, return, and handoff.
If the publisher loses workspace access or authority to publish or share an attached assignment,
make the sequence unavailable and stop releasing its links. Another authorized editor can publish
a new revision after revalidating the assignments. The direct assignment links still follow their
own publishers and access rules. Order handoff authorization with permission changes so a handoff
authorized after revocation commits fails.

Use the child's authority for forms, media, and accepted writes. Expired, revoked, deleted,
policy-blocked, or out-of-scope steps fail closed, with a neutral unavailable state and no
protected content. Retained direct access to archived sources follows each assignment's existing
policy. Ignore late responses after loss of access or a checklist reset. Apply the Presentation
rules to this candidate. Round and Recovery Pack practice have separate lifecycle and reporting
rules and need their own qualification before inclusion.

Closing a sequence stops discovery and handoff through it. Previously shared direct assignment
links remain subject to their own expiry, revocation, and access rules. Explain this when the
facilitator shares or closes the sequence. To withdraw direct guest access, revoke those
assignments separately and verify their guest links. Authorized assignment reports can remain
available during the existing seven-day period after expiry. If facilitators require a single
withdrawal action, evaluate sequence-owned grants as a separate access-control design before
implementation.

## Reporting and research

The proposed sequence has no organizer progress view, cross-stage analytics, or export.
Authorized assignment reports remain independent. Their counts describe attempts. A shared
link can be forwarded and one person can start multiple attempts. Counts from two assignments
cannot establish who completed both, who dropped out, or what was retained. Existing
[reading insights](evidence/presentation-reading-insights.md) apply suppression within a
snapshot. A later sequence report needs an explicit disclosure decision covering small and
complementary counts, known and overlapping groups, repeated releases, and direct child reports
and exports.

Under the existing [R2-00 research gate](competitor-backlog-2026-10-27.md#r2-00-establish-demand-and-select-the-next-increment),
preregister the comparison and use approved evidence handling. Observe whether facilitators
can set up, explain, and withdraw access, and whether learners can find the next step, return
after an interruption, and explain what their checklist says. Record workarounds and whether the
job recurs. Use aggregate findings and restricted evidence references. Treat the synthetic
rehearsal as a test of tasks and copy. Customer observations and product acceptance remain open.

[R2-04 Recovery Trail](competitor-backlog-2026-10-27.md#r2-04-bounded-multi-stage-recovery-trail)
remains a separate test of a later, different probe. Keep each stage's attempt denominator
separate, disclose unknown invitation coverage, and use unpaired aggregates. Any within-Trail
pairing needs separate review. A same-occasion WX-13 checklist cannot establish retention or
qualify the existing Trail selection and exit criteria.

## Qualification before a runtime decision

| Scenario                                                                                    | Expected result                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Forwarded shared link, two clean browsers, personal or wrong-step resume link               | Independent checklist and attempts. A saved resume link operates only in its matching assignment.                                                                  |
| Shared browser, opt-in, reload, expiry, blocked storage, and revision change                | Explain visibility on the same profile. Resume only current local checklist state. Unavailable storage still leaves a usable checklist.                            |
| Clear in one tab with another open or suspended. Reopen, opt in again, and try a stale save | The other tab discards cleared flags before showing or saving them. Reopening starts blank. The stale save cannot overwrite the newly remembered copy.             |
| Clear fails to delete saved flags                                                           | Reset the current tab and disclose that the remembered copy may remain.                                                                                            |
| Sequence publisher loses permission while another editor's assignment stays available       | Entry, return, and handoff stop for that sequence. A handoff awaiting authorization fails after revocation. The independently valid direct link still works.       |
| New publication, scope or authority change, expiry, revoke, stale tab, or in-flight request | Preserve the exact pin. Recheck access and discard stale UI responses. Confirm sequence closure and child revocation separately, including direct links and media. |
| Keyboard, screen reader, and phone navigation                                               | Reach the next step and access Resume, Skip, and Retry. Preserve meaningful focus and announce unavailable or skipped steps.                                       |
| Preview, back, skip, failed acknowledgement, and exact retry                                | Checklist actions create no activity records. Only accepted activity actions count, once. A required unavailable step stays incomplete.                            |
| Network, browser storage, facilitator views, and export audit                               | No checklist status or shared learner key reaches the server. Existing assignment reports retain their current scoped behavior.                                    |

Product and learning-delivery review the workflow and language. Privacy and security review
the browser, disclosure, and access boundaries. Accessibility checks and approved partner
observation qualify the candidate before selecting runtime work. Verified completion,
certificates, automated enrollment, gradebook delivery, and persistent learner identity stay
outside the candidate.
