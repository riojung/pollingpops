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

## Presentation stage credential compatibility

Apply `090_presentation_stage_credentials.sql` before enabling the E03 delivery server/web
build. It adds the distinct `stage` role to the existing credential check without changing
host/Companion credentials, published JSON, immutable hashes, response fingerprints or command
receipts. It introduces no entitlement, service or additional feature flag. Stage issuance uses
the existing Presentation realtime room grant; issued passes remain readable through a rollout
rollback until their own one-hour/session-capped expiry, explicit revocation or session deletion.

Before the first stage pass is minted, fence stage-pass issuance at ingress and deploy matching
server, jobs and web readers to every process. Verify the entire serving pool has the explicit
host/Companion role filters in audience-scope and Q&A authorization, then reopen stage issuance.
Migration 090 alone does not make a mixed pool safe: old audience code accepts every credential
role and must never receive a newly created stage bearer. Use a coordinated rollout rather than
relying on the existing realtime flag, because accepted room grants can survive flag changes.

Host snapshots now carry private `presenter` notes
and next-block previews from the live session's frozen published content. Keep these fields out
of shared displays. The clean stage uses its own bearer-only REST snapshot/media endpoints;
stage passes cannot authenticate host, participant, Companion, audience-scope or Q&A APIs.
Stage media is limited to the current frozen block; signed-in creator preview media additionally
permits the next block. A stage pass grants no creator authority. An independently signed-in
owner/editor retains their cookie-based creator authority.

Stage-pass rotation revokes only the previous stage pass. Host control-pass creation continues
to rotate host credentials and invalidate the previous controller; it does not rotate stage or
Companion credentials. Finished rooms reject new stage passes, while an existing valid pass may
display the finished state until expiry. Revoke stage access before stopping the display when
needed. Stage refresh retains only its tab-scoped bearer; expired/revoked access must fail closed.

Keep migration 090 during rollback. Old audience/Q&A code that treats every credential role as
host/Companion is unsafe after a stage pass exists. Fence stage issuance/reads and revoke active
stage credentials before any rollback to such a binary, or retain the E03 role filters in every
serving process. Never relabel a stage credential as Companion or host to force compatibility.
Actual screen sharing, physical-device/clicker and managed-browser popup behavior still require
manual qualification; software tests do not establish those results.

## Presentation opinion formats compatibility

The first E04 family adds **Presentation document v9**, explicit ordered ranking responses and
**Presentation Report V4** for multiple-selection opinion polls and rankings. Apply
`091_presentation_opinion_formats.sql` after migrations 089–090 using the restricted migration
job before enabling these writes. It adds `response_schema_version` (legacy default 1, new-format
responses 2), new-write document checks and frozen-question response validation. The document
checks are `NOT VALID` to avoid scanning or rewriting historical snapshots; new writes still
must pass. UUID comparisons account for case without changing stored immutable JSON or hashes.
Keep RLS, tenant ownership, session/receipt locks and media retention controls in place.

Use a coordinated cutover:

1. Fence Presentation draft mutations, publication, history restore, session creation and new
   published-question/Companion insertion at ingress. Drain accepted operations while preserving
   their original envelopes and idempotency identities. Account for any already running rooms;
   they continue to require compatible response and report readers/writers.
2. Apply the complete migration sequence through 091. Deploy matching v9/response-v2/report-V4
   API, job/report-worker, artifact/history/account-export, retention and web readers/writers to
   every serving process. A compatible web editor alone does not make an older worker or API
   safe. Refresh open browsers before they submit these formats.
3. Verify the reader floor and rehearse author/save/publish, independent Round copy, session
   freeze, participant response acknowledgement/reconnect, current-block reveal, stage/Companion
   privacy and explicit V4 report retrieval/CSV. Include restricted PostgreSQL writes and exact
   receipt replay. Record executed results in the [first-family evidence record](../evidence/presentation-e04-opinion-formats.md).
4. Reopen new writes only after those checks pass. Existing Presentation feature/room policy
   still governs eligibility. This is separate from Live Round protocol rollout; enabling a
   Round writer is neither required for reading an existing Presentation nor a substitute for
   the Presentation reader floor. A new published Round source may require its own authoring gate.

Only a ranking or poll with `maxSelections > 1` opts a document into v9. Keep the existing API
v2 starter, native blank v7/scene3, scenario-template v8/scene4, and mutation-envelope v2 defaults.
Do not eagerly promote old content or change v1–v8 JSON, published hashes, frozen baselines or
accepted response/command fingerprints. Later edits, history operations and copies retain an
existing v9 floor. New opinion responses have no correctness, confidence or participant score;
this does not redefine legacy assessment or opinion-purpose behavior.

V4 reports require `includeOpinionResults=true`; older report requests receive a validation
error rather than a lossy legacy projection. Existing V1–V3 report contracts, including the V3
Quick Check compatibility projection, remain supported for reports without the new evidence.
Pausing new authoring or a feature flag does not remove v9 drafts/history/publications, live
response-v2 rows or V4 reports. After these exist, rollback requires a compatible full
reader/writer set or a reviewed forward repair. Keep migration 091 and its constraints/column;
never strip opinion results, sort ranking order, rewrite immutable content/hashes, or regenerate
retry envelopes to fit an older binary. Do not send existing E04 rooms to a legacy response writer.

Moderated open text and word clouds use the separate boundary below; migration 091 alone
does not enable them in Presentation authoring, insertion, responses or reports.

## Presentation moderated text compatibility

The second E04 family adds **Presentation document v10**, **response storage v3** and
**Presentation Report V5**. Apply `092_presentation_text_opinions.sql` after the complete earlier
sequence. Coordinate API, job/report worker, artifact/history/account-export, retention and web
readers/writers before reopening text authoring or live insertion. Existing v1–v9 content, old
hashes and default creation versions stay unchanged. Any existing v10 document keeps its floor
through edits, copies and history; disabling new writes does not make it safe for older readers.

The migration adds private text bodies, moderation metadata, a session moderation sequence and
forced-RLS moderation receipts. Raw response records retain `{}` rather than a body; generic
account exports strip the private field. Removed bodies are erased and cannot be restored by an
old approval retry. Ordinary and moderation command identifiers share a session namespace.
Host-only moderation changes event sequence, per-response version and receipt atomically, while
preserving host revision and the response window. Finishing closes new moderation.

Before accepting writes, rehearse author/save/publish, Round copying and live insertion, six
independent participants, saved-status reload, a lost response acknowledgement, a lost moderation
acknowledgement, exact retries, wrong-role/cross-session credentials, reveal and minimum-five
approval suppression, removal/erasure, stage/Companion and stale result reads. Verify the 250
participant cap, 10 text blocks, 2,500 entries and 5,000 moderation receipts under session locks.
Run restricted PostgreSQL conformance and direct SQL guards, then verify deletion/retention.
Record actual runs in the [moderated-text evidence record](../evidence/presentation-e04-moderated-text.md).

Report V5 requires `includeTextResults=true`; mixed opinion summaries additionally require
`includeOpinionResults=true`. Quick Check attribution remains an independent opt-in. Only actual
revealed blocks with five approved respondents carry anonymous text evidence. Raw pending and
removed bodies never enter reports or CSV. Aggregate summaries suppress participant text.

After accepting these meanings, rollback requires a compatible full reader/writer set or a
reviewed forward repair. Keep migration 092 and its private-column/receipt/erasure constraints.
Do not downgrade stored reports, rewrite immutable content or regenerate accepted retry intents
for an older binary. This source change does not change deployed flags or upgrade a running app.

## Presentation visual import compatibility

E05 adds `093_presentation_visual_imports.sql`, a private workspace/presentation-scoped conversion
queue, usage limits and temporary media-reference ownership. Apply the complete migration
sequence before deploying API/jobs/retention readers. Existing native slide fields express the
visual and reviewed reading pair, so no new Presentation document version or default is required.
The existing draft mutation receipt is reused, with a ready-job fence that serializes insertion
against cancellation and expiry. Retain the new table/readers for pending receipts and cleanup;
do not roll back by deleting referenced media or rewriting published content.

The server runtime image uses Node 26 for the converter's `--permission` network denial. Node
runtimes without network permission support fail closed for visual import; the rest of the app's
engine range is unchanged. Keep malware scanning, object storage, media uploads and the authoring
job/retention schedules operational. Both in-process and dedicated jobs run visual conversion
without an AI assistant or AI credit reservation. Existing media-upload operational controls stop
new conversion work while allowing authorized reads/cancellation and exact creation receipts.
Visual conversion has its own scheduled slot, sharing the existing authoring pause control,
so queued AI proposals do not block PDF/image conversion.

The converter is a separate child with network, child process, worker and filesystem-write
permissions denied, evaluation disabled, a 192 MiB V8 heap and a monitored 384 MiB RSS limit.
Native canvas remains trusted code: Node permissions and RSS sampling are not an OS/native-code
sandbox or a hard RSS cap. Deploy the worker in a container with an operator-set memory limit;
reserve headroom for the parent, bounded IPC/input/output buffers and native allocations. The
current container policy remains the hard process-family memory boundary.

Budgets include 40 pages, 1,600-pixel longest edge, two million output pixels per page, sixty
million per job and forty MiB encoded output. Standalone images are checked before decoding
(sixteen million source pixels/16,000-pixel edge). PDF stream preflight conservatively rejects
oversized embedded images and unsupported filter chains; single Flate expansion is capped at
16 MiB and aggregate expansion at 64 MiB. Canvas allocations are bounded separately. Each child
has a 45-second timeout and the conversion loop has a 120-second budget; claimed jobs have a
ten-minute lease and at most three processing attempts. Some otherwise readable PDFs will need a
simpler/fresh export. These limits do not promise pixel-identical rendering or preservation of
fonts, interactive objects, animation or media.

Original source files are not exported or retained as a permanent asset. They are cleared on
success/terminal failure/cancellation; pending sources and previews expire after 24 hours and the
retention sweep removes expired jobs/references. All generated page assets are registered before
object writes and pass through existing quarantine/scan/promotion. Released assets keep normal
deletion/retention handling, including history/publication protection and tombstones. Exercise
lost acknowledgements, expired/reclaimed leases, cancel/insert races, partial storage failures,
tenant/role isolation, account/presentation deletion and retained-publication media before rollout.

## Content-only Presentation compatibility

Content-only publication expands validation for existing Presentation content versions 2 and 3;
the JSON representation, immutable version hashes for already-valid content, and database schema
are unchanged. Older application readers require a question and reject newly published content-only
versions and their live-session snapshots. This is a reader compatibility boundary even though it
requires no SQL migration or new content-version number.

Before accepting content-only publications, fence Presentation publication and session creation
at ingress, drain accepted writes, and deploy compatible server, jobs and web images together.
Verify the serving image set before reopening those writes. Existing Presentation, realtime and
workspace rollout policies still apply; verify effective Admin Features policy rather than assuming
an environment flag overrides an explicit policy. This increment introduces no additional paywall.

After a content-only version or session exists, retain content-only-capable readers and report
workers on rollback. Disabling new creation does not make older readers compatible with retained
history. Keep existing immutable publications and accepted command fingerprints; use a compatible
rollback image or forward repair rather than rewriting stored data to insert artificial questions.

Verify a content-only and a mixed deck through save, publication, hosting, reconnect, finish and
report reconciliation. Content-only reports retain participation and slide timeline evidence;
their empty leaderboard and null participant standings are deliberate. Legacy REST host/list roster
aliases remain intact for strict clients and represent the participant roster rather than assessed
results. Existing question/recheck timing and scoring must still pass their regression checks.

## Native Presentation scene compatibility

Native slides opt into embedded Presentation draft/content version 4. Their public visual scene
has its own version 1; this is distinct from the draft mutation envelope's version 2, Recovery Pack
versions and report versions. Legacy Presentation v1/v2/v3 readers and stored content remain
supported without rewriting immutable versions, accepted mutation hashes or Pack baselines.

Apply migration `089_presentation_native_scene_media.sql` with the restricted migration job before
accepting native scene writes. It adds scene images to the existing draft/version/history media
collector and backfills reference edges without editing document JSON. Keep the existing locking,
forced tenant isolation and deletion rules. Old cleanup processes do not understand scene images.

Fence Presentation draft mutations, publication and session creation at ingress and drain accepted
writes while deploying compatible server, jobs and web images. Reopen writers only after all
readers, media validators and cleanup processes support version 4. Existing feature/workspace
policies and media scanning requirements still apply. This change introduces no paid dependency
or new commercial entitlement.

After version-4 drafts, history, publications or sessions exist, keep migration 089 and compatible
readers/cleanup workers on rollback. Disabling new native-slide creation does not make retained
native content safe for an old process. Use a compatible image or forward repair; do not downgrade
documents or discard node assets to fit a legacy reader.

Verify a native content-only deck and a mixed native/question deck through save/retry, reload,
publication, scoped image access, reconnect, finish and report reconciliation. Check scene images
against draft, history and immutable-version retention; compare JS and SQL collectors. Confirm
that notes/source metadata stay outside audience projections and that live Quick Checks do not
create rankings for an otherwise content-only deck.

## Native Presentation rich-text compatibility

Formatted native text opts into embedded Presentation draft/content version 5 and scene version 2.
Existing plain native slides remain document v4/scene v1 until an author chooses **Format text**.
Document v5 may contain both scene versions. The draft mutation envelope stays version 2; Pack
and report schemas are independent. Required plain text matches the structured paragraphs exactly,
supporting existing labels and reports without rewriting legacy JSON or accepted hashes.

Deploy compatible server, jobs, web and artifact readers before reopening formatted-text writers.
Fence draft mutations, publication and session creation at ingress and drain accepted operations
during the reader transition. Existing clients with literal scene-v1 validators cannot consume
scene-v2 projections merely because a plain-text fallback exists. Reload active creator/presenter
clients onto compatible assets before starting formatted sessions. This change does not add a
client capability negotiation protocol.

No new migration is required. Migration 089's collector already traverses image nodes independently
of scene version; formatted text introduces no new media-reference path. Retain that migration,
existing tenant/scan/lifecycle checks and v5-capable cleanup/artifact readers. Once v5 drafts,
history or publications exist, rollback requires a compatible image. Disabling the formatting
button does not make stored v5 content readable by older processes; do not downgrade stored
documents or strip their formatting to fit an old reader.

Verify formatting and plain-text edits, safe links, paste, Undo/Redo, reload, publication and
participant/host/Companion projections. Check that adding/converting a plain native slide and
inserting a Pack during authoring or live delivery retain document v5 and frozen baselines.
Native image authorization, immutable versions and notes/source privacy must remain unchanged.

## Presentation slide visibility and save recovery compatibility

Hiding a visual slide opts its draft into Presentation document v6; scene v1/v2 and mutation
envelope v2 are unchanged. Older documents reject the visibility flag and keep their original
representations and hashes. Activities cannot be hidden. Showing every slide again retains v6.

Deploy v6-compatible server, jobs, artifact readers and web clients before accepting these writes.
Fence draft mutations, publication and session creation at ingress and drain accepted operations
during the coordinated transition. Reload creator/presenter clients onto compatible assets.
Keep the existing feature/workspace policies. There is no additional visibility admission flag.

Draft/history/export retain hidden slides and their asset references. Preview and publication
compile them out before readiness and media checks; published content contains visible blocks
only, with original IDs/order, and rejects hidden flags or an empty result. Session readers parse
v6 strictly; legacy partial-draft admission is retained only for older document versions. Check
that hidden unscanned assets do not block visible publication or become audience-readable.

No additional SQL migration is required. Keep migration 089 and v6-capable cleanup/readers; its
existing collector retains hidden draft/history images independently of document version.
Once v6 drafts, history, versions or sessions exist, rollback requires compatible images or a
forward repair. Disabling the Hide button cannot make an old reader/writer safe. Do not rewrite
immutable versions, Pack baselines, mutation fingerprints or hidden draft data to downgrade them.

The web client persists the original ordinary-save envelope in browser recovery before sending.
Unknown outcomes replay that exact envelope on Retry or refresh before newer writes. Explicit
rejection permits correction; revision conflicts preserve local work and stop writes. Historical
accepted receipts cannot rebase divergent work onto a later revision. Browser recovery is local
to the origin/profile and is removed by site-data clearing; it is not a server backup.

Rehearse hide/show with Undo/Redo, all-hidden publication refusal, immutable sessions after
showing a draft slide, hidden-only media retention, linked-question moves/delete/copy, lost save
acknowledgements, pending receipt reload, newer remote edits and local preview/download/duplicate.
The [E01 acceptance record](../evidence/presentation-e01-completion.md) records local verification;
it does not replace staging, scanner/storage, physical-device or manual-accessibility qualification.

## Native Presentation design compatibility

Design tokens and image fit/focal points opt a native scene into version 3 and its Presentation
document into version 7. Themes, fonts and spacing use closed tokens; no HTML, arbitrary CSS,
font download or remote asset URL is admitted. Existing scene v1/v2 and document v1–v6 JSON,
default document v2, accepted mutation-envelope v2 and frozen Pack baselines remain unchanged.
Geometry-only layout, alignment, distribution and layer edits do not require promotion.

Fence draft mutations, publication and session creation at ingress, drain accepted writes and
deploy matching v7-capable server, jobs, artifact readers and web clients before reopening writers.
Reload active clients onto compatible assets; old strict scene readers cannot consume scene v3.
Existing feature/workspace and private-image scanning/lifecycle policies remain authoritative.

No additional SQL migration is required. Image references remain scene image nodes; migration 089
already retains them independently of scene version, including hidden draft/history assets. Keep
that migration. Once v7 data exists, rollback requires v7-compatible readers and writers or a
forward repair. Disabling the new controls cannot make an old binary safe. Never rewrite stored
versions, baseline hashes or retry identities to downgrade them.

Verify scene3/doc7 save/retry/reload, all-slide design Undo/Redo, hidden slides, ordinary slides,
layout/reading-order independence, image ownership/crop, immutable publication, host/participant/
Companion and live Pack insertion. v7 session reads use strict publication validation. Check
text-fit feedback and complete images in the narrow reading column. See the
[verification record](../evidence/presentation-design-foundation.md) for executed checks and
remaining manual/device/production qualification. This slice adds no commercial entitlement.

## Presentation basic interactions compatibility

Local reveal panels and safe external links opt into **Presentation document v11 and scene v5**.
Apply `094_presentation_basic_interactions.sql` before enabling these writes, and deploy matching
API, jobs, artifact/history/session readers and web/live clients. Refresh existing browser assets
before reopening authoring, publication, history restore and session creation. An older strict
reader cannot safely discard the new nodes. Existing mutation envelopes, defaults, stored JSON
and immutable hashes remain unchanged.

Migration 094 admits the new document version alongside existing opinion/text formats and adds
raw interaction validation for drafts, history, publications and session content. Response storage
versions, moderation, scoring and host commands retain their existing meanings. Keep the existing
native-media migration and collectors: new controls contain text and external links, not media IDs.
The serving image set still requires E05's Node 26 runtime where visual import is enabled.

No new flag, AI provider, model call, service or subscription entitlement is introduced. A reveal
is public audience text with state held on one screen; it is neither a host-broadcast command nor
an assessment answer. Collapsing the UI does not make delivered text confidential. Continue using
private speaker notes and the normal activity answer-reveal policy for their respective purposes.

Verify save/retry/reload/history/duplicate/reorder and design changes with scene5 mixed with
earlier scenes and all supported activity types. Check unsafe URLs and unknown actions fail,
incomplete labels/body/URL block publication, and hidden/private fields stay absent from audience
projections. Test keyboard/touch controls, readable outline, focus visibility, reduced motion and
independent stage/participant/Companion reveals without shared revisions or response mutations.

Once v11 data exists, rollback requires compatible readers/writers or a forward repair. Retain
migration 094 and its checksum; never strip actions, downgrade documents, rewrite immutable hashes
or change accepted mutation receipts to make an old binary read the new format. Hotspots, dialogs,
internal navigation and answer-based branches require the advanced interaction upgrade below.

## Presentation sections and navigation compatibility

Sections and live navigation opt into **Presentation document v12**; scene versions stay at v1–v5
and ordinary creation defaults remain unchanged. Apply `095_presentation_navigation.sql` before
accepting v12 drafts, publication or session creation. Deploy matching contracts, API/jobs,
artifact/history/session/report readers and web host/Companion assets together. Refresh old browser
assets before reopening authoring and restore operations. Do not rewrite retained JSON or hashes.

Migration095 adds optional durable navigation state and timeline metadata, plus strict document,
state, transition and receipt guards. Old sessions retain SQL NULL navigation state. New sessions
track actually visited stable block IDs, saved phases, original question windows and frozen Pack
interventions. Live insertion may add blocks while preserving existing block JSON/order and
section membership. Receipt fingerprints include the canonical UUID target; accepted command and
response receipts remain recoverable after the cursor advances. Existing response storage versions
and legacy receipt fingerprints retain their meanings.

The private host/Companion map supplies server-authorized targets. The first detour stores its
current block as the return anchor, or the first published block when leaving the lobby; further
jumps retain that anchor. Returning restores its saved phase, and an unvisited anchor opens
normally. Open activities must close/reveal first. Pending diagnostic/recheck pairs prohibit
navigation, direct recheck jumps and entry into an unstarted pair's middle. Returning to a saved,
closed recheck is safe. Ordinary Next follows numbered order and restores closed activities
without new windows, roster freezes, responses or points. Audience projections contain no map,
section membership or progress state.

Finished v12 sessions produce **ReportV6**, requiring `includeNavigation=true`. Existing text,
opinion and Quick Check opt-ins still control their own report fields. New reports identify each
block as presented/skipped and retain jump/return/revisit events. A skipped question has no
responses or assessment result. Old ReportV1–V5 event enums are unchanged.

Verify editor Undo/Redo, pending-save recovery, duplication/removal, hidden section pruning,
publication/history, host/Companion reconnect and exact uncertain-command retry. Check concurrent
cohost commands, closed-window/score preservation, intervention/recheck guards, audience privacy
and skipped report/CSV semantics. See the [E07 evidence record](../evidence/presentation-e07-navigation.md).

Once v12 data exists, retain migration095 and compatible readers/writers or use a forward repair.
Never strip sections/progress, downgrade frozen content, change hashes or discard receipts to make
an older binary accept it. No flag, paid service, model call or entitlement is added by this change.

## Presentation advanced interactions and private sharing compatibility

Deploy **document13/scene6/report7** readers and migration096 before enabling advanced interaction
writes. Migration095/E07 remains a prerequisite and must retain its checksum. Migrations096 and097
are additive source increments; do not edit or remove earlier migrations. Ordinary document
creation defaults and old frozen hashes/receipts remain unchanged.

Migration096 extends raw document gates to 13, validates hotspot/image and slide/branch targets,
and adds separate nullable `interaction_state` plus typed timeline metadata. Old session state
stays unchanged. Broadcast state and accepted branch aggregates commit atomically under the room
lock with the command receipt, revision and timeline. Shared reveal commands are absolute; new-ID
no-ops are rejected, while accepted exact retries recover their existing receipt. Navigation,
deadlines, attempts, reveals and points preserve their established monotonic rules.

Audience serializers must redact closed broadcast bodies and internal target graphs before JSON,
not merely hide markup. Private staff projections retain authored controls and eligibility; only
host/Companion credentials can change shared state. ReportV7 additionally requires
`includeInteractions=true`, alongside existing navigation/result opt-ins. Keep strict old report
readers rather than forwarding new events as ReportV6.

Migration097 adds hash-only, version-bound private review capabilities with forced RLS, immutable
intent metadata, tenant/version/actor foreign keys and controlled retention. Deploy its repository,
account/source lifecycle hooks, routes and recipient web page together. The token travels through
a scrubbed URL fragment and Bearer headers. Creation must retain its original token, request ID,
version and absolute expiry before sending; never mint a new secret/expiry for a retry.

Recipient pages use an explicit safe projection. Recheck current access/authority/feature policy
before page transitions and media reads; recheck after bounded storage reads before sending bytes.
Use the private media proxy rather than revocation-insensitive signed URLs. Preserve four-server/
two-client image admission and 10 MiB bounds. Expired metadata is retained for seven days, then the
existing system-access lifecycle transaction purges it. Export metadata without credential hashes.

Verify save/recovery/Undo, image-anchor transformations, copying, target deletion/hiding, old
scenes/activities, private body withholding across HTTP/socket/ACK paths, exact uncertain-command
recovery, cohost takeover, closed-question branches, media role isolation and ReportV7/CSV. For
sharing, verify lost-create ACK/reload, exact immutable version pinning, anonymous cookie-free
reads, revocation on open-page navigation, expiry/authority/feature changes, media allowlists and
deletion/account cleanup. See the [E06](../evidence/presentation-e06-completion.md) and
[E08](../evidence/presentation-e08-private-sharing.md) evidence records.

Rollback after these formats exist requires compatible readers/writers or a forward repair.
Do not strip nodes, branch rules, state, capability records or receipts to fit an older binary.
This change adds no commercial entitlement, required AI provider or new hosted service. Private
review does not provide self-paced attempts.

## Native Presentation composition compatibility

Composition introduces **Presentation draft/content v8 and scene v4** for optional flat groups,
rotation and table/chart nodes. Scene-v4 fields are rejected by older document contracts rather
than stripped. Document v8 accepts older scene versions, and retained document v1–v7 JSON,
canonical hashes, retry identities and frozen Pack baselines remain unchanged. Draft mutation
envelopes stay v2. API creation without `initialSlide`, or with `classic`, still starts at v2;
the blank web launcher's `initialSlide: "native"` still starts at document7/scene3. New native
scenario templates explicitly create document8/scene4, and composition actions promote only the
edited content when required. There is no automatic rewrite of existing decks.

Before accepting any v8 writes:

1. Fence Presentation creation/mutation, publication, history restore and session creation at
   ingress; drain accepted operations and preserve pending receipt identities.
2. Deploy matching **v8-capable server, jobs, artifact/history/export readers, web clients and
   live host/participant/Companion projections**. Report/retention/cleanup paths must also read
   the new scenes. Reload active browser assets before reopening writers; a text fallback does
   not make a strict older scene reader compatible.
3. Verify the complete serving/worker image set and effective workspace feature policy. Keep the
   existing private-image scan, ownership, tenant and lifecycle rules. No additional flag,
   subscription entitlement or service is introduced by composition.
4. Reopen writers only after the reader floor is satisfied and the release-specific acceptance
   checks below have been recorded.

No new SQL migration is required. Keep `089_presentation_native_scene_media.sql` and its existing
checksum: image references remain image nodes at the same field paths. Group IDs, rotation,
inline data and rich-text external links introduce no private-media collector path. Table/chart
limits remain within the existing 50-node, 128 KiB scene and 3 MiB native-document budgets.

Once v8 drafts, history, publications or sessions exist, rollback requires **v8-compatible readers
and writers or a forward repair**. Turning off controls or removing templates cannot make an old
binary safe. Never strip new nodes/groups/rotation, rewrite immutable JSON or hashes, replace
frozen baselines, or regenerate accepted retry envelopes to force a downgrade. Retain compatible
media/cleanup workers and applied migrations throughout rollback.

Verify save/retry/conflict/reload/history/export/cleanup with groups, physical-16:9 rotation,
raw/painted bounds and mixed legacy scenes. Exercise whole-group movement, proportional resize,
alignment/layers, snap bypass/cancel, reading-order preservation and duplicate-ID remapping.
Check staged CSV/TSV preview, Apply/Discard, one-step Undo/Redo, table/series bounds, malformed
input and complete visible data alternatives. Verify immutable content and private-field exclusion
through host/participant/Companion and live Pack insertion. V8 sessions use strict publication
validation rather than the old partial-draft read path.

Exercise all 12 native scenario factories, the nine retained v2 templates, read-only shared
preview and template creation/retry with literal envelope2. External video remains a user-followed
HTTPS link with a captions/transcript fallback; preserve `frame-src 'none'` and `media-src 'self'`
and verify that preview performs no provider request. Record executed outcomes separately from
human assistive-technology, physical-device, native-browser zoom, capacity/cost and hosted
deployment qualifications; this runbook does not mark those qualifications passed.

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
`090_presentation_stage_credentials.sql`. Apply the complete ordered migration set with the restricted
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

### Canvas productivity and private team images

Apply `080_canvas_productivity.sql` using the migration connection before deploying the matching
server, web and jobs images. Canvas V2 adds geometric groups and native image objects. New
readers deterministically upcast retained V1 scenes and undo snapshots; V1 creation/mutation
inputs retain their original canonical retry fingerprints. Existing workshops keep their own
V1 state machine and bearer contract. Deploy the matching V2 readers and writers together and
refresh open canvas clients before resuming normal editing traffic. There is no separate Order 5
feature switch; the existing canvas creation, sharing and live-update policies remain independent.
Keep migrations 079 and 080 and do not downgrade V2 scenes or return to older writers after V2
data has been admitted.

Frames use independent world-coordinate children. Group and frame changes remain atomic and
bounded to 50 affected objects, including implicit connector and parent cleanup. Related-object
versions fence those implicit changes. Locks apply through parent frames; an unlock-only change
must succeed before editing locked content. Publishing a frame never publishes its children.
Independently published children may be flattened from a private parent in the guest projection.

Image uploads require the existing `FEATURE_MEDIA_UPLOADS`, configured private storage, a working
scanner and the operational media-upload control. Canvas authorization determines the owning
workspace for reservation, completion and byte delivery, including collaborators whose active
workspace differs. New provenance and media-reference guards exclude these images from generic
creator downloads and other activity content. Guest bytes require the source-workshop bearer
with cookie omission, a currently published image object, current admission and retained access.
Scanning and storage reads recheck access before acknowledgement or delivery.

Each board is limited to 100 lifetime image reservations and 200 MiB reserved, with the existing
10 MiB per-file limit. Unattached reservations become eligible for cleanup after 15 minutes;
current objects and retained inverse history keep their images referenced. History pruning, board/source deletion,
expiry and account/workspace cleanup release or tombstone the associated media through the
existing cleanup pipeline. Keep that pipeline running when new uploads are paused.

The seven original starters contain authored scaffolding only. Guided creation preserves separate
source/canvas retry keys in bounded tab storage, verifies expected user/workspace at both HTTP
creation boundaries, and resumes only the unfinished step. Successful product logout clears this
setup namespace even when administrator-session revocation reports a warning. Choosing to keep
the source without its canvas leaves the created workshop intact. Starter content is English;
picker controls cover all ten locales. No guest responses or media are generated by a starter.

Run the targeted contract, memory/restricted-PostgreSQL, HTTP and browser suites alongside
`pnpm check` before rollout. The canvas browser fixture substitutes in-memory object storage and
scanning; verify the deployed private-storage/scanner pipeline separately. Physical touch hardware,
production load and post-commit peer/render performance have not been measured for Order 5.
Earlier pilot repository acknowledgement timings do not accept those gates. Orders 6 and 7 are
described below; higher limits remain gated.

### Canvas facilitation, exports and saved versions

Use a coordinated maintenance cutover for additive `081_canvas_facilitation.sql`. There is no
independent checkpoint-admission switch, and pausing the Canvas boards creation policy does not
stop existing 080 scene writes or cleanup jobs. Drain and stop **all old API writer processes and
cleanup jobs**, apply migration 081 with migration credentials, then deploy and restart only the
matching facilitation-aware **server and jobs** images and web image. Reopen traffic and admit
checkpoints only after verifying that every writer and cleanup process uses that image set.

The migration adds board-scoped comment threads/messages, timers and manual saved versions with forced
RLS, board/source/author lifecycle cleanup and retained-version media references. Facilitation
uses an independent schema-version-1 command protocol and operation receipts; frozen Canvas V1
and V2 input shapes and accepted retry hashes are unchanged. This is not a scene-format downgrade
or a replacement for migration 080.

Once saved versions are admitted, **do not roll back to an 080-era server or jobs writer**, even
while migration 081 remains installed. An older writer rebuilds media references without
checkpoint-only images and can release bytes still needed by a saved version. The migration
alone cannot make that writer safe. Keep migrations 079–081 and use an 081-aware image set or a
reviewed forward repair. Do not run an old writer beside checkpoint-aware processes after the
maintenance cutover; retaining 081 or pausing new board creation does not make that writer safe.

The existing **Canvas boards** policy gates the new facilitation, history and export endpoints.
Presenter reads and writes require **Canvas board live updates**. No new public capacity is
enabled: the 500-object, 20-editor pilot and workshop allowance of 300 ordinary objects remain
unchanged. Existing canvas and legacy workshop reads retain their established policies; do not
assume that a paused Canvas boards policy leaves the new history or timer endpoints available.

Rehearse these boundaries before promotion:

- Team comments are plain text and anchored to current objects. Viewers cannot comment; editors
  edit/delete their own messages, while owners/facilitators resolve and moderate. Guest facilitation endpoints
  expose the timer only, with no comment threads or version history. Conflicts retain local text
  without automatically replacing the concurrency fence. Bounds remain 100 threads, 20 messages
  per thread, 500 messages and 512 KiB retained discussion data per board.
- Timers use server time with a 5-second to 2-hour countdown, revision-fenced start/pause/resume/reset
  and no automatic workshop phase changes. Verify pause, expiry and reconnect without relying on
  the browser's wall clock.
- Presenter state is a 15-second transient lease in Memory/Redis, with atomic compare-and-set
  fencing for starts, heartbeats and stops. Multi-node deployments require the shared Redis cache.
  Following is opt-in and ends on pan, zoom, Escape, revocation or lease expiry. Team viewers may
  receive a viewport; guests receive only an explicitly published frame reference, without team
  coordinates or presenter identity. Exercise concurrent starts and a stale old-session write.
- Exports render only a fresh authorized projection to a closed SVG document; PNG conversion
  happens locally from that validated SVG. Whole/current/selected-frame-area choices contain no
  remote URLs, executable markup, credentials, pending ideas or system identity metadata. The
  limits are 25 image placements, 10 MiB per image, 20 MiB per export, 15-second server-render and
  local PNG-conversion budgets, and at most 4,096 pixels on either output side. Recheck access after storage waits, and exercise
  removal/revocation while bytes are loading.
- Saved versions are manual: at most ten checkpoints, 2 MiB per scene and 4 MiB in aggregate.
  Current authorization and guest moderation govern previews and historical-image reads; removed
  guest bodies are not frozen in checkpoints. Verify media retained only by a checkpoint remains
  readable, then becomes cleanup-eligible after the last reference is released. **Restore layout**
  updates only existing objects against their current versions, within 50 affected objects and
  current locks/protected-card/group/frame rules. It must never recreate deleted objects or
  restore old text, media identity or visibility.

Contract, restricted-PostgreSQL, HTTP, export, frontend and real-Valkey checks have passed
locally, along with the full repository check and all 17 configured canvas browser cases. Three
follow-up export/mobile checks also verify the corrected Download touch target. See the
[Order 6 status](../implementation-status.md#canvas-facilitation-order-6-october-30-2026).
No deployed production media, physical-device, load, peer-latency or rendering-performance result
is established by these checks. Order 7 and all AI functionality remain outside this increment.

### Canvas diagrams and private activity references

Use coordinated maintenance: drain/stop API writers and cleanup jobs, apply
`082_canvas_diagrams.sql` and `083_canvas_artifact_links.sql` after 079–081, and deploy matching
V3-capable server/jobs/web images before reopening traffic. Preserve the migration 081 checkpoint
media requirement above. There is no independent diagram/reference admission switch; the existing
Canvas boards policy gates these endpoints. Keep all migrations 079–083 during rollback. Once V3
scenes or references exist, use a compatible image set or forward repair; do not rewrite scenes,
retry fingerprints or saved versions to fit an older binary.

Canvas scene V3 adds diagram nodes/styles and an eighth original starter. Frozen strict V1/V2
creation/mutation inputs retain their original canonical hashes. New readers upcast old scenes and
undo entries. Saved-version views independently advance to V2, accepting old V1 views through an
upcaster; facilitation commands stay V1. Refresh open clients before editing V3 scenes. Resumed
starter requests retain their original schema version and operation identity.

Migration 083 adds reference/receipt tables with forced RLS and lifecycle cascades. Rehearse same-
workspace source-owner/target-editor creation, target/source read intersection, unrelated known-ID
denials, archived-target creation denial, exact retry, deletion retry and cross-target ID collisions.
Metadata, preview and target-proxied native/approved-guest images must not disclose revoked,
expired or removed content, including delayed storage and COMMIT-response boundaries. Preview
reprojects the saved scene with removed guest content omitted; no-longer-authorized media is denied.
Source/version/target deletion removes links; creator deletion clears attribution without deleting
organization-owned scenes. Verify a target reader receives no newly granted source access and a
participant/published/duplicate payload contains no reference metadata or image credentials.

Each target allows 20 references and 2,000 lifetime operation receipts with reserved deletion
headroom. No scenes or image bytes are copied into activity content. Browser invalidation uses
source watches plus target polling/TTL; stale previews and private blob URLs must be cleared on
loss of access. Exercise Round and Presentation authoring at desktop and narrow mobile widths,
light/dark themes, keyboard controls and accessibility checks.

Run `pnpm check`, the restricted-PostgreSQL link/core suites and `pnpm test:e2e:canvas`. Capacity
verification is separate: use the repository and production-browser harnesses described in
[capacity evidence](../canvas-capacity-evidence.md). The 500-object/2 MiB bound and workshop reserve
remain unchanged. Twenty editors is an evidence workload target, not a hard admission cap or
production guarantee. Do not raise limits until the applicable target-host, media, physical-device,
latency and sustained-load gates pass.
