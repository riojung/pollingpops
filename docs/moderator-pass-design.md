# Q&A moderator pass design

WX-09 permission and audit candidate based on `00119a7` after
[PR #314](https://github.com/riojung/pollingpops/pull/314). Product, security, and privacy
acceptance is pending before implementation. The proposed 60-minute limit, bearer handoff,
highlight behavior, and audit retention are part of that decision.

## First delivery

During a Live Presentation with Q&A enabled, a facilitator can delegate the incoming question
queue while continuing to present. Start with one active pass per room. The moderator works in
a dedicated queue with three controls: **Approve**, **Highlight** or **Clear highlight**, and
**Mark answered**. The host can still moderate and can clear the highlight from host Q&A.

Presentation already commits Q&A mutations, receipts, audit, and audience updates together
using an audience revision separate from presentation controls. Start with that boundary.
Round needs its own adapter because its Q&A shares staff authorization with chat and Pulse.
Persistent Q&A before or after an event stays with IDEA-014 / R2-09. See
[current Presentation Q&A contracts](api.md#presentation-qa-commands-gated-preview).

## Authority and question actions

| Actor                                                            | Access in the first delivery                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed-in workspace owner or editor authorized for the live room | With current host control, can issue or replace a moderator pass. Can read non-secret pass status and revoke by exact pass ID even if Q&A or issuance is paused. Existing host-control recovery applies when host control is lost. |
| Current moderator pass holder                                    | Can read the assigned room's actionable Q&A queue and perform the commands below while the pass and room are active.                                                                                                               |
| Existing host, participant, Stage, or Companion credential       | Keeps its existing capabilities. The moderator endpoints require their own credential, and a moderator pass grants no access on any of these other surfaces.                                                                       |

The moderator queue exposes question ID, plain-text body, status, current highlight, a cursor,
the current audience revision, and the effective pass expiry. It includes pending and published
questions. Omit author and participant identifiers, aliases, replies, labels, votes, and removed,
dismissed, or answered question bodies. Question text can identify its author, and the existing
host view can still show aliases. The invite copy discloses what the holder can see and that
anyone with the link can use it until revoked or expired.

| Command         | Allowed transition                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Approve         | Move the target from pending to published.                                                                                    |
| Highlight       | Set the room's single Q&A highlight to a currently published question. Replacing a highlight leaves both questions published. |
| Clear highlight | Clear only if the named question is still the highlighted item.                                                               |
| Mark answered   | Move the target from published to answered. Clear the highlight if it points to that question.                                |

Store highlight independently of status. Render a badge alongside the question in Q&A without
reordering the list or affecting slides. Clear it when the question leaves the published state
or when Q&A is disabled or the room ends. Revoking a pass preserves moderation that already
committed. The active host can clear the highlight independently. Commands use strict fields
for the action, target, audience revision, and idempotency key. Arbitrary statuses, labels,
replies, removals, author bans, Q&A settings, and presentation control are outside this role.

## Pass lifecycle and delivery

1. Show the permission summary, expiry, and current pass status in host Q&A before issue or
   replace. Confirm replacement against the active pass shown and include its ID in the request.
   Under the same lock that commits issuance or replacement, recheck host control and verify the
   confirmed ID still matches the active pass, or that no active pass exists for new issuance.
   On mismatch, return a conflict without changing any pass. Refresh and require fresh confirmation
   before replacing the current pass. Issue a random bearer, store only its hash, and bind it to
   the workspace, Presentation room, moderator purpose, and current host-control credential.
   Expiry is the earliest of 60 minutes, host-control expiry, live-room expiry, and audience-scope
   expiry. Reconnect never extends it.
2. Display the invitation once. Carry the bearer in a link fragment and strip it locally
   before app requests. Use dedicated tab-scoped storage for reload and send it only as
   a bearer to the moderator API, with creator cookies omitted. Require no-store responses
   and exclude this route and its payloads from tracking. If the issuance response is lost,
   show non-secret status on refresh. An explicit replacement delivers a new secret and
   invalidates the old one. An issuance retry cannot create or reveal a second pass.
3. Use REST polling and refresh on reconnect. Check current use policy, workspace, room, Q&A,
   expiry, and both the moderator pass and its bound host-control credential before returning a
   page or mutation receipt. An issuance-only pause blocks new passes and replacements while
   existing eligible passes continue until invalidated or expired. Revocation remains available.
   Clear the displayed queue and tab credential at the
   known deadline or on terminal denial. On network loss, hide the queue and suspend actions
   until access is verified again. Ignore delayed responses from an earlier credential or
   access check after suspension or invalidation. The moderator pass does not join live sockets.
   Participant and host Q&A updates use the existing metadata-only notices.
4. Serialize moderation with moderator-pass revocation and replacement, rotation or explicit
   revocation of the bound host-control credential, and Q&A or room closure. Check authoritative
   time and state after acquiring the coordinating locks. A stale revision requires a refresh
   before trying a revised command. A matching retry with current authority returns a body-free
   receipt without repeating the action. Revoking the bound host-control credential using the
   [existing control-pass endpoint](api.md#live-session-staff-presenter-and-embed-apis)
   invalidates the moderator pass even when no new host credential is issued. Host-control
   rotation, moderator-pass revocation,
   finish, disabling Q&A, workspace closure, a policy that disables use, expiry, and loss of the
   issuer's workspace owner/editor grant for the room also invalidate the pass. Record these
   authority changes so restoring the grant or re-enabling Q&A cannot revive the old pass.

## Audit and qualification

Commit grant, replacement, explicit revocation, and accepted moderation with their audit entries.
Record the issuer or revoker's creator ID, the pass ID for holder actions, room and action,
question ID and before/after state where applicable, timestamp, and server request correlation ID.
Audit early invalidation with the lifecycle change that caused it. Include effective expiry in
the issuance audit so reviewers can determine expiry without waiting for a worker or a separate
event. Audit attributes holder actions to a grant. An exact retry adds no second audit entry.
Account and operational audit projections
require explicit qualification. Keep bearers, hashes, question text, and author identity out
of audit, request logs, metrics, and events. Preserve safe revoked-pass metadata through the
approved room retention period so revocation retains audit attribution. Room or workspace
deletion removes the pass and scoped audit through the applicable retention policy. See the
[privacy data map](privacy-data-map.md).

| Qualification                       | Expected behavior                                                                                                                                                                                                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authority and scope                 | A moderator pass works only on the assigned Presentation's moderation routes. Check another room in the same workspace, another workspace, Round, creator APIs, and scope/socket subscriptions. Check participant, Stage, Companion, and creator-cookie-only requests against the moderator routes.                         |
| Queue and disclosure                | Participant and Companion Q&A show the highlight only on public questions. Keep the participant's existing own-question status and omit other authors' pending text. Moderator pagination and refetch exclude ineligible rows and private fields. Highlight never changes slides, votes, or ordering.                       |
| State transitions and concurrency   | Approve, highlight, clear, and mark answered obey the transition rules. Commands with extra fields, invalid targets, or stale revisions leave state and audit unchanged. Host changes and exact retries cannot overwrite newer decisions or create duplicate audit.                                                         |
| Concurrent replacement and issuance | Two host tabs display pass A. One replaces it with B. The other tab's confirmation for A conflicts and leaves B active, with no successful replacement audit. Two tabs issuing from empty status cannot silently replace the first pass.                                                                                    |
| Standalone host-control revocation  | Revoke the bound host-control credential without rotating it. Subsequent moderator queue reads, commands, and exact retries fail. A racing command either commits with its audit before revocation or fails without a mutation or successful moderation audit.                                                              |
| Lifecycle and recovery              | Test revoke or takeover racing a command, expiry while waiting for a lock, lost issue response, and stale revocation after replacement. Cover the issuance pause and prove restoring a grant or reopening Q&A cannot revive access. After finish, deny moderator retries and preserve the host's existing receipt recovery. |
| Browser and retention               | Inspect network, browser history, events, logs, and export projections for secret leakage. Confirm delayed responses cannot restore the queue after expiry, denial, or reconnect. Check deletion, keyboard and mobile queue, focus after changes, and accessible expiry and reconnect feedback.                             |

**Baseline verified on `00119a7`.** All 72 tests passed across the existing
[audience-scope API](../apps/server/test/audience-scope-api.test.ts),
[Companion API](../apps/server/test/presentation-companion-api.test.ts),
[Presentation credential realtime](../apps/server/test/presentation-session-service-realtime.test.ts),
and in-memory [audience-scope](../packages/db/test/audience-scopes.test.ts) and
[scoped Q&A](../packages/db/test/scoped-qna.test.ts) suites. These exercise role isolation,
revocation, expiry, removed-body suppression, and Q&A revision and receipt behavior. The matrix
above is for a future moderator-specific implementation.
