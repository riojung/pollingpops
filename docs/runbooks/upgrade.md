# Upgrade and rollback runbook

1. Read release notes and verify the image digest, signature, SBOM, and vulnerability report.
2. Back up PostgreSQL and confirm a recent restore exercise.
3. Apply expand-only schema changes with the owner-only `DATABASE_MIGRATION_URL`. Keep the
   application `DATABASE_URL` on a non-owner role granted `openround_runtime`, and verify forced
   row-level security with the production-like integration test. New code must tolerate both old
   and new columns during the deployment window. The published server image exposes the one-shot
   `node dist/migrate.js` command; run it from a restricted maintenance job and never place
   `DATABASE_MIGRATION_URL` in the long-lived server environment. For a pre-PIN upgrade, first
   fence old email-authentication handlers as described in the
   [migration 075 checklist](#verified-email-and-sign-in-pin-compatibility).
4. Deploy to staging and run the synthetic creator, host, three-player, reconnect, finish, report, and deletion flow.
5. Promote one canary, check error rate, event-loop lag, acknowledgement latency, reconnects, database pool, Redis latency, and reconciliation.
   Keep `FEATURE_RECOVERY_PACK_LIVE_CARDS=false` while any v5 server or worker can receive traffic;
   authoring-only and ordinary rooms remain v5-readable during this mixed-version window.
6. Promote production only when thresholds remain normal.
7. Roll back only to an approved immutable image compatible with the stored data and authentication behavior described below. Keep applied migrations; use a reviewed forward repair.
8. Contract or remove old schema only in a later release after every running version has stopped using it.

## Live response format compatibility

Migration 067 keeps extended opinion-poll artifacts and responses outside legacy version meanings.
Deploy compatible server, worker, and web readers before enabling `FEATURE_ROUND_CLIENT_PROTOCOL`
for an allowlisted workspace. New extended Round content uses artifact schema 2, multiple-selection
poll answers use response schema 3, and their reports use Report V5. Native JSON export uses
interchange version 5. Existing artifact/answer/report versions remain readable.

Disabling the writer flag prevents new extended drafts, publications, imports, duplicates,
restorations, and rooms. Existing rooms, accepted answers, reports, and retries retain their frozen
requirements and remain usable by compatible clients. A rollback target must keep these readers
and migration 067 once extended content has been accepted; do not rewrite immutable published data.

Migration 068 extends ranking artifacts to version 3 and response payloads to version 4. Ranking
rooms use state 8, native JSON 6, and Report V6. Migration 069 (`069_text_opinion_moderation.sql`) extends artifacts to
version 4 and text responses to version 5; text rooms use state 9, native JSON 7, and Report V7.
Apply the ordered migrations and deploy matching readers in every server/worker/web binary before
enabling writers. A rollback must retain readers for the richest data already accepted.

Text approval metadata and revision-fenced moderator receipts are retained in state 9 across
round advancement; accepted bodies remain immutable answer records. Missing approval metadata
fails closed. Public snapshots/events contain no text bodies, and pending/removed text is excluded
from normal reports and account exports. Hosts/cohosts use the dedicated paginated queue. New
moderation is read-only after finish; accepted command retries remain usable when flags are off.
Text rooms are capped at ten text checkpoints, 250 participants and 250 accepted responses per round.

## Recent content, report, and deletion upgrades

The current feature code includes migrations through
`078_customer_account_user_licenses.sql`. Apply the complete ordered migration set with the restricted
one-shot migration job before starting the new server; do not grant the runtime role ownership or
direct mutation privileges on published Presentation versions.

### Personal and organization account compatibility

Migration 078 adds explicit personal/organization account types and workspace/user license units.
It classifies the same-ID personal billing boundaries created by migration 065 as personal,
independently of their Free/Pro/Team entitlement level. Existing subscriptions, purchased offer
snapshots, workspace licenses, content and accepted room coverage keep their original terms.
New personal workspaces remain personal; organization setup creates a named account using user
licenses and a separate organization-owned workspace for each licensed creator.

Deploy matching web, server and jobs readers before accepting user-license organizations or
publishing catalog entries with `licenseUnit: "user"`. Existing offers without that field retain
workspace units. A published offer's licensed unit requires a new version and provider price;
do not reinterpret an existing subscription or change the account's fixed unit in place.

Once user-license accounts, assignments or invitations exist, retain a user-license-aware rollback
target. An older binary does not enforce seat reservations, dedicated workspaces or the user-seat
invitation boundary; its old catalog parser also rejects the new explicit unit. Pausing signups
alone does not fence existing organization administrators or billing workers. Fence account
administration and billing writers during a mixed-version cutover, or replace the single-VM
application and workers together, then verify the exact serving versions before reopening setup.

Exercise creator invitation reservation, verified acceptance, member role restrictions, billing-only
access, unavailable-license rejection, and license/member release on staging. Active organization
Round/Presentation controls must finish or expire before release. Revoked selected workspace
contexts must fail authorization until the user explicitly chooses an accessible workspace;
they must not silently redirect stale writes into a personal workspace. Finish with a personal
Free/Pro and legacy workspace-license regression journey.

Verify that republishing an offer ID with a new version, price or license unit does not change
the captured terms of an existing subscription renewing its original provider price. Subscription
records may carry an additive `offerSnapshot`; use matching billing/domain readers when reconciling
these records. Also exercise personal payment recovery after grace expires and refusal of account
deletion until provider cancellation or pending checkout reconciliation completes. A transferred
legacy workspace owner without organization membership must still be able to rename the workspace.

### Verified-email and sign-in PIN compatibility

Migration 075 adds `users.email_verified_at` and the system-only, forced-RLS
`auth_email_pin_challenges` table. It marks existing active identities verified because the prior
flow already proved mailbox ownership, and leaves existing creator sessions valid until their
normal expiry or revocation. Apply it through the owner-only maintenance job before deploying the
matching web, server and jobs images; keep the runtime role non-owner.

The new authentication boundary requires verification links to establish mailbox ownership only.
Verification redirects to sign-in without creating a session or sending a PIN automatically.
Only a separate, single-use six-digit PIN for a verified active identity creates an email-authenticated
session. Previously issued unused magic links and the legacy `POST /v1/auth/magic-link` alias now
perform verification only. They must never regain session-issuing behavior.

Verified identities cannot restart account creation through another signup request: the request
keeps its generic accepted response but sends no fresh verification email or PIN. Consuming a
different, still-unused verification link is idempotent for an already verified identity and
does not repeat welcome onboarding or consent recording. Reused or expired credentials remain
invalid, and sign-in still requires an independently requested PIN. Exercise verified and PIN
screens after refresh, including cooldown/interrupted-delivery recovery, and verify that signup
controls remain hidden until the user explicitly chooses another email.

Before applying migration 075 to a pre-PIN deployment, fence public email-authentication traffic
at ingress with a reviewed maintenance rule, or take every pre-PIN API instance out of service.
Include `/v1/auth/magic-link` and `/v1/auth/verify`; verify that neither can reach an old handler.
Let already admitted pre-PIN authentication requests finish, and confirm those writers have
drained before starting the migration.
The old verification callback ignores `FEATURE_SIGNUPS=false`, so that flag alone cannot fence
completion. Keep the fence through migration and the web/API cutover so no old handler can create
an identity after the verification backfill or issue a session from a verification link. Replace
the images, verify the serving image set, then remove the fence and restore the reviewed settings.
Existing sessions retain their normal expiry; an authentication-route fence does not revoke them.
On the new release, `FEATURE_SIGNUPS=false` pauses email requests and completion. Keep
`AUTH_DEBUG_MAGIC_LINKS=false` in hosted deployments and verify real SMTP delivery for both
verification and PIN emails.

A rollback target must preserve verified-email/PIN authentication and verification-only legacy
callbacks. A pre-PIN image is not a compatible rollback even though migration 075 is additive:
its old callback could issue a session from a verification credential. Pause new authentication
and use a reviewed forward fix or another compatible image if needed. Keep migration 075 and its
verification/challenge records; do not undo the verification backfill or discard durable challenge
state to make an older binary serve traffic.

Before promotion, rehearse a new account, an existing verified account, an unused pre-upgrade
verification link, and an existing session. Check verification without a session, separate PIN
sign-in, ten-minute expiry, five wrong attempts, resend replacement after 60 seconds, one-time and
concurrent consumption, SMTP failure recovery, and safe return/invitation workspace preservation.
Verify that unknown/unverified accounts receive the generic accepted response, account deletion
and expiry purge remove challenges, and customer authentication cannot grant operator access.
Retain the serving image set, migration result and compatible rollback target with the release
evidence. See [ADR 001](../decisions/001-creator-authentication.md).

| Change                                 | Data and compatibility behavior                                                                                                                                                                                                                                                                                    | Rollout/rollback requirement                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Question Health                        | Migration 045 stores content-addressed dismissals; 046 stores bounded approved field diffs and apply/undo provenance. Read-only post-use analysis derives from retained exact-version reports.                                                                                                                     | Leave `FEATURE_QUESTION_HEALTH` off outside the evidence allowlist. Rehearse stale revision, apply/undo, export, and source-deletion cleanup. Published content must remain unchanged.                                                                                                                                                                                                                  |
| Session Decision Replay                | Migration 047 adds the immutable creation-time `decision_replay_enabled` setting, defaulting existing sessions to false. Eligible new Round sessions capture bounded aggregate events in the existing journal and produce Report V4; V1–V3 remain readable.                                                        | Deploy replay-capable server, worker, and web images before enabling `FEATURE_DECISION_REPLAY`. Disabling the flag prevents new capture-enabled rooms but preserves capture in existing rooms. Choose a replay/Report V4-capable rollback target once such rooms/reports exist; older writers cannot preserve complete capture and older readers may reject V4. Never backfill a timeline from answers. |
| Presentation content v2                | Drafts, history, published content, and browser recovery are upcast on read from v1 title/body into stable text elements, preserving media, notes, citations, and style. Optional percentage frames extend v2. No database rewrite is required for this content change.                                            | Deploy the matching web/server pair within the existing Presentation beta gate. After v2 or custom-frame writes, use a v2/geometry-capable rollback target: an older editor can reject v2 or discard custom geometry on save. Do not rewrite immutable published versions as a rollback.                                                                                                                |
| Archived artifact and session deletion | Migration 048 protects retained practice with `ON DELETE NO ACTION` and adds parent-scoped locking/cleanup for favorites and Group links. Owner artifact deletion requires archived status and no retained session/assignment dependencies. Presentation session deletion requires finished status or live expiry. | Verify runtime-role behavior, restore/dependent-write races, all-user favorite cleanup, and terminal-session/report-worker/socket cleanup on a production-like copy. Keep the stronger foreign key and cleanup triggers during a code rollback. Deletion is not reversible by deploying an older image.                                                                                                 |

### Recovery Pack update compatibility

Migration 049 adds the gated Pack foundation. Migration 050 expands Round media-reference
discovery to both the original insertion and accepted update baseline; migration 051 adds nullable
Pack-update undo-source metadata to existing Round mutation receipts. Apply these forward-only
migrations before enabling Pack updates. Existing forced RLS, immutable versions, tenant checks,
and retention/export/delete behavior remain in force; no new public capacity promise is made.

Before enabling `FEATURE_RECOVERY_PACKS` for a workspace, rehearse an unchanged-copy update, a
local/source conflict, a deleted copy, apply/undo, acknowledgement loss, concurrent draft edits,
and media present only in an updated delayed probe. Confirm that published Rounds and the original
insertion remain unchanged, source Pack deletion leaves copies readable, and a disabled flag
blocks new applies without blocking reads or fenced undo.

Updated Round exports declare native JSON version 4; this server still accepts versions 1–3.
After `updateBaseline` writes, choose an update-aware web/server rollback target. An older editor
can discard the accepted baseline when it saves, and an older media extractor may omit probe-only
assets. Disabling the flag does not make such an older image a safe writer. Keep both expanded
migrations during rollback and never rewrite published snapshots to downgrade their format.

### Recovery Pack Presentation insertion and update compatibility

Apply migration `053_recovery_pack_presentation_media.sql` before enabling Presentation Pack
insertion. It expands the existing media extractor and backfills draft, history, and published
references for both original and accepted baselines, including probe-only assets; it adds no table
or learner data. Keep the migration during a code rollback.

Apply `054_recovery_pack_presentation_undo.sql` before deploying Presentation Pack updates. It adds
nullable source-revision metadata and an index/check constraint to existing mutation receipts.
The current accepted update protects its preceding snapshot from normal history pruning; a later
meaningful draft edit releases this exception. Existing forced RLS, export/delete coverage, and
parent cascades still apply. No new content schema version is introduced by updates.

Ordinary and legacy Presentation documents remain schema v2, including existing question-level
Pack provenance copied from Rounds. Complete frozen Pack baselines explicitly write schema v3,
while the draft mutation request envelope remains v2. Deploy v3-aware web, server,
and worker readers before enabling insertion through both `FEATURE_PRESENTATIONS` and
`FEATURE_RECOVERY_PACKS` and their respective workspace allowlists. After any v3 writes, use only a
v3-aware rollback target: disabling a flag blocks new insertion but cannot make a v2-only reader or
editor safe. Never rewrite immutable published versions to downgrade them.

Rehearse dirty-draft insertion, lost acknowledgement and exact-mutation retry, concurrent draft
edits, deletion of local copies, source Pack deletion, disabled-feature reference reads, and media
held only by a frozen delayed probe. Verify normal autosave, history, publication, account export,
deletion, and pre-reveal role/media projections. This increment copies only the diagnostic/recheck
as live blocks; frozen intervention cards and the optional delayed probe remain authoring references.
Pause each flag/allowlist after an accepted insertion loses its acknowledgement: its exact mutation
must still replay without a new revision, while a fresh insertion remains blocked.
Also rehearse three-way update choices, context-only acceptance, deleted-checkpoint restoration,
an exact reviewed version after another Pack publish, revision-fenced undo, an aged undo source,
and media held only by an accepted delayed probe. Confirm unchanged block IDs/metadata and slide
order, immutable published versions, and private live projections. Pausing either flag blocks new
updates but preserves comparisons, already accepted receipt recovery, and fenced history restore.
Live Presentation card playback is described separately below.

### Live Recovery Pack card compatibility

Migration 052 adds nullable aggregate Pack/card attribution to existing session interventions;
the session's forced workspace RLS and retention/deletion cascade still apply. Apply it before
starting the new server. It does not link evidence to a mutable source Pack or add learner identity.

Ordinary rooms and all v1–v5 legacy rooms retain game state v5 with live playback disabled through
commands, caching, and restart. Only new live-card-eligible rooms write v6. Eligibility requires
both `FEATURE_RECOVERY_PACKS=true` and the separate default-off
`FEATURE_RECOVERY_PACK_LIVE_CARDS=true`, plus the evidence workspace allowlist. Authoring alone
does not activate v6 writers. Snapshots report the room's actual schema version.

Keep the live-card switch off throughout the canary. Drain and replace every v5 server and worker,
then verify the serving image set before enabling it. Once enabled rooms or their reference-bearing
decision evidence exist, use only a v6-capable, live-card-aware server/worker rollback target: old
writers cannot preserve card projections and attribution. Disabling either flag prevents eligibility
in new rooms without interrupting enabled active rooms or hiding copied content/reports; it does
not downgrade existing v6 state. Cards resolve only from the room's immutable published Round
snapshot (accepted update baseline when present), never from a latest source lookup. Text/citation
cards are post-reveal only in this slice.

Keep migration 052 during rollback. Rehearse authoring-only v5 creation, commands, and cold restart
before enablement, then duplicate/stale commands,
participant/presenter projection safety, empty-cache restart during a selected card, finish and
linked recheck, source Pack deletion, and both Report V3/V4 attribution with CSV export.

### Live Presentation Recovery Pack cards

Apply migration 055 before deploying the Presentation playback server. It expands existing
session/timeline/receipt tables with immutable default-false eligibility, nullable aggregate card
attribution, and nullable intent hashes for legacy receipts. Existing forced workspace RLS,
retention, account export/deletion, and parent cascades still apply. The phase-exit trigger clears
active playback even if an overlapping legacy advance omits the new column; this is a defensive
compatibility measure, not permission to enable playback with old readers still serving.

Leave `FEATURE_RECOVERY_PACK_LIVE_CARDS=false` through the mixed-version canary (including when
that switch was previously used for Rounds). Drain old Presentation web/server/worker readers,
verify the serving image set, then enable both Pack flags only for the evidence workspace allowlist.
Existing Presentation rooms remain ineligible; enabled rooms retain playback when a flag is paused.
The host receives card previews only after reveal, and participants/companions receive only the
selected active text/citation card. Source publication or deletion cannot alter a running snapshot.

The scoped-host REST command fallback and Socket.IO use the same durable command ID, revision,
and intent hash and notify connected roles after acceptance. Without a control pass, the creator's
legacy REST advance remains available but cannot safely retry a lost acknowledgement; card controls
remain disabled until a scoped pass is restored. Revoked/stale stored passes are cleared on scoped
credential rejection; reacquisition is explicit to prevent competing host rotation loops. It preserves
the identity of an unresolved command while replacing only its credential, and never replays that
intent through receipt-less legacy advance. Rehearse acknowledgement loss followed by reconnect, another host's advance,
finish, and exact retry; a changed card/type/action/revision under the same command ID must fail.
Check revoked/expired/participant/companion credentials, noncurrent insertion/card selectors,
pre-reveal frames, selected-only projections, generic advancement, and clearing before recheck.

Card-bearing reports write Presentation Report V2 with reference-only timeline attribution;
ordinary/legacy reports remain V1. Before promotion, finish/reconcile/restart an enabled room,
read both versions, export the owner account, verify tenant denial, and purge/delete the source
session. Keep migration 055 during rollback. Once enabled rooms or V2 reports exist, roll back only
to a Presentation live-card/V2-capable web/server/worker set: flag disable does not remove durable
references or downgrade reports. Never reconstruct old attribution or rewrite ready report JSON.

Before promotion, use synthetic records to verify legacy draft/history/published reads; move and
resize slide text, save, undo/redo, publish, and compare preview with both live roles; verify narrow
reading order and image reservation. For a capture-enabled Round, finish/reconcile a Report V4 and
confirm explicit incomplete capture at the bound without identity leakage. Delete finished/expired
sessions, then archive and delete unreferenced content; confirm active/restored source and retained
assignment guards, inaccessible reports/credentials, and released room codes. Retain the serving
image set, flags, migration result, compatible rollback target, and human acceptance with the release
evidence. See [deletion and restored data](backup-restore.md#deletion-and-restored-data) before using
a pre-deletion backup.

Whole-room flex still needs a flex-capable rollback target after creation is enabled; follow the
[deployment rollback policy](deployment.md#failure-and-rollback-policy). These compatibility checks
do not replace the external security, accessibility, capacity, or restore gates.

### Recovery Pack practice compatibility

Apply migration 056 before deploying Pack-practice writers. It expands existing forced-RLS
follow-up tables with immutable Pack source and creation-receipt metadata. Legacy Round/recovery
rows remain readable and writable with their existing source version; only new Pack assignments
may omit a Round version. Published-version/workspace-deletion fences, scoped mutation uniqueness,
and assignment-owned media references are enforced in the database. Keep the migration during
rollback; never fabricate a Round or drop frozen source data to make old readers accept these rows.

Do not enable new Pack practice until every serving web/server/worker reader understands Pack
source context and nullable Round references. Keep at least one creation gate off
(`FEATURE_RECOVERY_PACKS` or `FEATURE_PRACTICE_ASSIGNMENTS`) throughout a mixed-version deployment;
after draining older readers, enable both only for eligible workspaces. Once Pack assignments exist,
use a Pack-practice-capable rollback target. Disabling a flag stops new creation/passes but does not
make old binaries compatible or hide retained assignment management and participant completion.

Rehearse current published-version fencing, no-probe rejection, concurrent/exact lost-acknowledgement
retries, changed intent rejection, role/tenant denial, and close/retention bounds. Include an initial
receipt miss followed by an overlapping commit and source publication/deletion; the original receipt
must still recover. Inject failure into either creation evidence write and verify the assignment,
passes, media references, audit, and event all roll back before an exact retry succeeds. Verify only
one creation audit/event and no stored/logged access seed or raw links. After creation, publish/delete
the Pack, pause gates, and downgrade the plan: exact receipt recovery and existing start/answer/
resume/manage flows must still work. A revoked original pass must not reappear, and later-created
passes must not be included in the original private receipt. Check frozen history/context, media
access after source deletion, account export/delete, assignment expiry, and reference cleanup.
Generic and personal practice evidence must not be presented as paired source recovery. These checks
do not replace external rollout, accessibility, or security review.

### Full-sequence Recovery Pack practice compatibility

Apply migration 057 before starting sequence-capable writers. It expands the existing forced-RLS
follow-up tables with nullable immutable card/citation context, an intervention stage/index,
bounded Continue receipts, and optional submitted-answer version fences. Existing assignments
keep their content and delayed-probe behavior; omitted creation mode still means `delayed_probe`.
The new `full_sequence` mode copies only the diagnostic and linked recheck, with fresh checkpoint
and choice IDs, plus frozen intervention cards. It does not append the optional delayed probe.

Keep at least one Pack/practice creation gate off while any older web/server/worker reader can
receive traffic. Deploy the complete sequence-aware image set before creating full-sequence
assignments in allowlisted workspaces. Once such assignments exist, use only a sequence-capable
rollback target; disabling a gate preserves existing delivery and cannot make an older reader
understand the new stage. Keep migration 057 and never rewrite frozen content to downgrade it.

Full-sequence answers require the current question ID and expected attempt version; Continue
requires the expected version and a stable UUID command key. Exact accepted retries resolve before
stale-state/phase rejection and return the current authoritative snapshot without another transition.
Changed intent conflicts. Legacy clients may still omit these fences for older assignment modes;
new clients send them for all modes. Delayed-probe creation receipts continue to use the original
mode-free intent hash, so deployment does not invalidate a previously accepted private link receipt.
A stale-state denial triggers an authoritative snapshot refresh. If refresh fails, participant
controls stay disabled with an explicit **Retry practice sync** action; retrying sync sends no new
answer or Continue command. An ambiguous transport failure instead retries the exact original intent.

Rehearse reload/restart during diagnostic, reveal, every card, recheck, and completion; lost answer
and Continue acknowledgements; duplicate/concurrent commands; same-key changed intent; and stale
question/version submission. Confirm that a participant receives only the active card and its
citations, without a countdown, other cards, recheck keys, or source metadata. The timed recheck's
deadline starts when it opens, not while cards are being read. Check current-question-only media,
Pack publication/deletion, flag pauses, personal-pass revocation, account export/delete, assignment
purge, and copied-media retention. Also run a legacy assignment with more than sixteen checkpoints
to verify bounded receipts do not truncate ordinary practice. These checks make no paired-source,
causal-learning, demand, or production-readiness claim.

### Recovery Pack CSV/QTI export compatibility

Pack portability adds read-only published-version export/report routes and UI; it needs no new
migration, table, entitlement, or rollout flag. Deploy the matching server/web pair so previews and
downloads share the strict report contract. Existing native JSON export/import remains unchanged.
Disabling Pack authoring must leave retained versions and exports readable by authorized workspace
members, including viewers; cross-workspace and unauthenticated reads remain denied.

Rehearse immutable version/hash binding after a draft edit or later publication, all two or three
checkpoints, optional-data loss findings, source deletion, feature-disabled reads, and failed/stale
downloads. A blocked format returns validation failure with the report, never a partial attachment.
CSV downloads expose a separate report route; QTI archives also embed `openround-export-report.json`.
Keep the report with the artifact when assessing interoperability. Pack cards, container topology,
citations, and private media are not exported in these converted files. Polling Pops-specific QTI
metadata is not guaranteed to survive another LMS, and numeric grading depends on that LMS's float
handling. Native JSON is the complete content path but contains media references, not image bytes.
Conversion warnings are not evidence of external LMS interoperability or release readiness.

### Recovery Pack source-review compatibility

Apply migration `058_recovery_pack_source_authoring.sql` before deploying source-assisted Pack
creation. It adds forced-workspace-RLS source provenance/citation catalogs and approval receipts
with tenant-aware parent cascades. The runtime role may update only approval columns in the
provenance table; do not broaden its privileges. Source job IDs are logical references without a
foreign key: temporary job purge must not erase retained Pack content or approval evidence.

Deploy the matching web/server pair behind `FEATURE_RECOVERY_PACKS` and the evidence workspace
allowlist. Existing ready authoring jobs can propose an editable diagnostic/card/recheck without
another provider call; normal provider configuration, source-upload scanning, quotas, and job
retention continue to apply when creating a new authoring job. Explicit saved-content and citation
approval is required before publishing a source-derived Pack. Manual/legacy Packs need no new
approval, and published content/native JSON formats are unchanged. Approval never edits or
retroactively endorses immutable versions.

Once source-derived Packs exist, use a source-review-aware rollback target. Older publishers do
not enforce this approval boundary; disabling the feature does not make those older writers safe.
Keep migration 058 during rollback. A pause blocks new creation/approval/publication while retained
drafts, versions, and source review remain readable. An accepted creation retry resolves its durable
receipt before source expiry or feature checks and returns the existing Pack, not a duplicate.

Rehearse stale output/content hashes, fabricated or removed per-item citations, explicit consent,
edit/restore invalidation, approval acknowledgement loss, publish races, and reused mutation keys
with changed intent. Verify approval and publication remain separate; old versions are unchanged;
source-job purge preserves review/receipt recovery; tenant/viewer denial, account export/delete,
Pack deletion, and media retention still pass. Importing native content must not import an approval.
These checks do not establish source truth, customer demand, or production release readiness.

## Presentation concurrent-response rollout

`PRESENTATION_CONCURRENT_RESPONSE_WRITES` defaults to `false`. Leave it off while a prior server
image can still receive traffic: the compatibility trigger then advances the stored session fence
that image reads. After the expand release is the only serving version, verify reconnect and report
reconciliation, then enable the switch to use the commit-visible per-session aggregate fence and
remove response-row contention.

Migration 040 stops rather than creating a second sequence domain when an unexpired legacy session
has an imported timeline sequence above its aggregate fence. Finished sessions remain reconnectable
until live expiry, so they are included in the guard. If it fires, leave the old image serving,
expire the identified sessions through the normal lifecycle, and rerun the migration. Do not bypass
the guard or enable concurrent response writes to force rollout.

Before starting a prior-image rollback, disable the switch on every current instance and wait for
them to restart. Then, from the owner-only migration connection, reconcile the stored compatibility
counter while briefly fencing joins and responses:

```sql
BEGIN;
LOCK TABLE presentation_live_sessions IN EXCLUSIVE MODE;
SELECT set_config('app.system_access', 'on', true);
UPDATE presentation_live_sessions AS session
SET event_seq = GREATEST(
  session.event_seq,
  session.event_seq_offset
    + session.revision
    + (SELECT count(*) FROM presentation_live_participants AS participant
       WHERE participant.session_id = session.id)
    + (SELECT count(*) FROM presentation_live_responses AS response
       WHERE response.session_id = session.id)
);
COMMIT;
```

Only after that transaction succeeds may the prior image start serving. The trigger remains
installed, so its subsequent writes continue advancing the stored fence.

Do not enable the switch merely because the migration completed. Record the serving image set,
configuration change, rollback rehearsal, and 50/250-client results as one release evidence set.

## Standalone brainstorming boards

Migration 074 adds the independent version 1 board aggregate, workspace isolation, immutable
identity/deadlines/limits and retention index. Apply it with migration credentials before starting
the matching server and jobs images. Deploy the matching web and admin console before assigning
**Brainstorming boards** to plans. The inherited `FEATURE_IDEA_BOARDS` default is false and also
requires the core-parity workspace allowlist; an explicit admin feature rule overrides both.

Pausing new board creation in the current release preserves admitted guest reads, exact accepted
retries, closure and deletion. Board grouping and moderation stop at voting, ballots are final,
and closed totals remain readable only within their frozen retention window.

Before rolling back to an image without boards, return **Brainstorming boards** to **Inherit
deployment** and leave `FEATURE_IDEA_BOARDS=false`. This removes its explicit policy entry; older
admin builds cannot manage the new key. Keep migration 074 and board data in place rather than
editing an applied migration or dropping the table. Older releases have no board routes: existing
links need the matching board readers restored to become available again. Rollback therefore
differs from a writer pause; verify this boundary before enabling customer boards.

### Rich idea attachments and sketches

Migration 076 adds private board-upload provenance, quotas and media-reference lifecycle guards.
Apply it with migration credentials before starting the matching server and jobs images. Deploy
matching web readers and writers with the server: version 1 board payloads now support optional
`attachments`, `links` and `sketch` fields, and older strict readers reject rich ideas. Existing
plain-text rows and their retry hashes remain unchanged; no bulk content rewrite is required.

Images require effective **Media uploads**, configured object storage, and a working scanner.
The guest response reports `imageUploadsAvailable`; absence of the pipeline disables the image
control while preserving text, drawing and link submission. Do not enable uploads by bypassing
scanning. Historical images remain readable when new uploads are paused, subject to the board's
current authorization, removal and expiry rules. Board images use an authenticated binary route
and are excluded from generic creator download, completion and content-reference APIs.

Exercise a scanned upload, pending-author/moderator access, unauthorized-guest denial, approval,
removal, expiry and account deletion in a disposable environment before customer enablement.
Check the same image cannot be attached to another board or ordinary authored content. Keep the
existing orphan cleanup and media deletion jobs running. Preserve migration 076 and private
provenance on rollback; restoring readers that predate these protections is not a safe media
rollback. Pause collection and restore the matching image set if a rich-board rollout fails.

### Shared Idea Board canvases

Apply additive migration `079_canvas_boards.sql` with migration credentials before deploying
the matching server and web images. It adds versioned canvas metadata, typed objects, board
grants and invitations, operation receipts and a metadata outbox with tenant and workshop
lifecycle guards. Legacy Idea Board aggregates and links remain valid. Creating a workshop
canvas is an explicit facilitator action; voting and closed workshops cannot be upgraded into
an editable scene. Keep migration 079 during rollback.

The independent **Canvas boards**, **Canvas board sharing** and **Canvas board live updates**
policies are opt-in. Their inherited deployment flags are `FEATURE_CANVAS_BOARDS`,
`FEATURE_CANVAS_BOARD_SHARING` and `FEATURE_CANVAS_BOARD_REALTIME`, all defaulting to false.
They follow the existing core-parity workspace allowlist and feature-policy precedence.
Canvas boards depends on Brainstorming boards; sharing and live updates depend on Canvas
boards. Deploy the matching admin console so operators can manage all three keys. Enabling
creation does not automatically enable sharing or live updates.

Pausing creation or sharing preserves authorized existing reads, revocation and deletion.
With live updates paused, clients fall back to authorized polling. For an incident, pause new
creation/sharing and retain matching readers for existing board links. Before rolling back to
an older image, remove explicit canvas policy entries by returning all three to **Inherit
deployment**, and leave their environment flags false. Older images have no canvas routes;
restore compatible readers to make existing links available again. Do not drop canvas data or
downgrade frozen workshop content to simulate a writer pause.

Use the existing authenticated HTTP/CORS proxy path for bounded fetch streams. Proxy buffering
must be disabled for `/v1/canvas-boards/*/events` and workshop guest event streams. Each API node
reads its own outbox cursor; Redis holds short-lived opt-in team presence. Rehearse access/seat
revocation across two nodes, guest cookie omission, pending-content privacy, media removal,
voting freeze and expiry before enabling a pilot.

Admission caps are 100 retained canvases per workspace, 500 objects and 2 MiB per document.
Workshop canvases reserve 200 object slots for source ideas. Each document also has a lifetime
pilot limit of 5,000 accepted mutation receipts, with a separate 4 MiB inverse-history budget;
owner deletion remains available at the limit. These caps do not establish a
production editor-count or latency guarantee. Run `pnpm test:e2e:canvas` for browser acceptance
and `pnpm exec tsx tests/load/canvas-load.mts` for the opt-in correctness/capacity smoke; its
header documents the restricted PostgreSQL setup. The smoke measures durable acknowledgements
and snapshot reads, not browser delivery or render frame rate. See the
[canvas architecture decision](../decisions/002-idea-board-canvas.md) and
[implementation plan](../idea-board-canvas-implementation-plan.md) for scope and evidence limits.
