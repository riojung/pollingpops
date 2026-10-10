# Phased delivery status

This repository implements the technical P0 baseline and the differentiated Recovery Loop through
the source-grounded authoring, self-paced follow-up, and institution-integration foundation. It
does not turn calendar, demand, legal, research, provider, certification, or production-observation
gates into software claims. `Polling Pops` is a working identity pending independent name and
trademark review.

## Staged implementation plan checkpoint

### Core parity M1 — Presentation Q&A interfaces, October 10, 2026

Implemented on `codex/core-parity-presentation-qna-ui` from merged PR #100 (`ad4214a`).
This completes the gated Q&A UI slice, not M1 or a public-production release.

- Host-only activation and Q&A settings/moderation, participant question submission/voting, and
  read-only Companion Q&A use native room passes; no credential URLs or creator-cookie elevation.
- Read-only availability discovery respects the independent scope flag/allowlist and preserves
  previously activated Q&A during a creation pause.
- Separate realtime audience subscriptions/cursors, current-state gap/reconnect recovery, fallback
  polling, stale-response fences, safe pagination, and exact-command retries after uncertain delivery.
- Alias-visibility disclosure, accessible collapsible panels, and closed-session read-only controls.
  Legacy Round routes/replies stay compatible; Presentation replies remain explicitly disabled.
- Quick-start, user-guide, Help, API, and architecture updates explain configuration and limitations.

Verification: `CI=true pnpm check` passes formatting, dependency-context checks, lint, strict types,
package/support tests and production builds. The audience API suite has 29 passing tests; seven
new client/subscription tests cover cookie omission, exact retries, schema rejection, duplicate/gap
notices, stale-connection acknowledgements, timeout fallback and revoked access. Seven production-build
Presentation/Companion browser journeys pass across desktop Chromium, mobile Chromium and mobile
WebKit, including Q&A privacy, retries, moderation, voting, refresh, closed-room controls, keyboard
activation, axe and viewport overflow checks. Three existing Chromium Round journeys also pass,
including legacy Q&A publication and facilitator replies. Firefox failed before executing its
journey: the local Playwright browser exits with `Could not find profile folder`; Firefox evidence
remains open. No migrations changed, and PostgreSQL integration, physical devices, independent
accessibility review, target-host mixed load or cross-process Redis disruption were not rerun.

Review fixes: audience read budgets now use separate room/credential-hash discovery/state buckets,
with both local and shared-cache enforcement. A real-route regression exercises thirty participants
and 360 reads behind a 300/minute production IP limit; another shares a read budget across two API
instances. Q&A/discovery refreshes serialize and coalesce trailing intents, retaining successful
slow responses. Temporary failures retry with capped exponential backoff; scoped read failures
hide stale content, and credential changes cancel timers/fence old work. The coalescer is shared
with existing Round interactions without changing their behavior. Browser regressions exercise
lost removal synchronization, automatic discovery retry and overlapping slow reads.
Six new refresh/retry unit tests cover slow-read progress, latest-intent coalescing, credential
isolation, retry classification, bounded backoff and timer cancellation; all 34 focused client,
subscription, refresh and existing AudiencePanel tests pass.

PR #101 follow-up retains an independent pre-authentication 10,000/minute IP ceiling across every
audience-read route. Local and shared-cache guards reject rotating tokens/scope IDs before
credential-bucket allocation or repository authentication, while the thirty-participant shared-IP
polling regression still passes. Both new security regressions failed before the fix and pass
afterward; all 29 audience API tests pass. No web code, migration or published capacity changed.
The full repository check and four production-build Q&A browser journeys pass after this fix;
Companion/legacy Round browser evidence above is from the preceding UI verification.

Next: scoped replies/chat/Pulse and shared moderation/lifecycle work, then dedicated feedback-room
anonymity/passcodes. New opinion formats, Surveys, advanced exports/sharing, cross-process mixed-load
evidence and all thirteen external release gates remain pending. No participant caps or GA claims change.

### Core parity M1 — scoped Presentation Q&A backend, October 10, 2026

Implemented on `codex/core-parity-scoped-qna` from merged PR #99 (`bfc92f0`). This is a
backend increment, not a new user-facing release or completion of M1.

- Shared Round/Presentation Q&A defaults, visibility, initial-status and alias policies; legacy
  Round tables/routes/replies remain compatible.
- Ordered migration 060: forced RLS, composite cascades, scoped questions/settings/votes/bans,
  retry receipts, durable per-actor/action limits and moderator audit.
- Sanitized list/command APIs, host revision fences, unique votes and author bans; Companion
  remains read-only. Presentation replies are explicitly disabled pending their next increment.
- Atomic state/receipt/sequence/outbox writes; accepted retries preserve the original receipt
  after finish/ban, not after credential expiry/revocation. Game sequences remain unchanged.
- Metadata-only Q&A notices and current role-filtered sync; terminal removal with blank bodies
  in ordinary views/account exports; parent retention and deletion cascades.

Next: reuse the Q&A panel on Presentation host/participant/Companion surfaces with scoped
transport, then scoped replies/chat/Pulse and feedback-room anonymity/passcodes. Surveys,
opinion formats, exports/sharing and external launch gates remain later milestones. No
participant-cap, billing, organizer-blind anonymity or GA availability claims change.

Verification: full `CI=true pnpm check` passed; all twenty-two audience-scope API/realtime tests
passed, including body-free notices for pending questions and read-only Companion sync. All
75 PostgreSQL integration tests passed on an isolated PostgreSQL 18.3 cluster, including fresh/
repeat migrations, memory/PostgreSQL Q&A conformance, forced RLS, receipt immutability, account
export and deletion. Malformed cursor IDs use shared UUID validation and return an actionable
`CONFLICT` before database casts. Timestamp bounds and explicit UTC query serialization keep
cursor dates within PostgreSQL's supported range, including boundary dates; regression checks
cover memory, PostgreSQL and HTTP. No
Presentation UI/browser journey, target-region mixed-load run, external
Redis/process-loss exercise or launch gate is claimed by this backend increment.

### Core parity M0/M1 — audience foundation, October 9, 2026

Implementation starts on `codex/core-parity-audience-foundation` from reviewed Companion baseline
`9d6d2d8` (including `90ada94` and its source/schema-fencing follow-up). This is the first
**partial M0/M1 increment**, not completion of the Core-Parity release or its external gates.

Implemented:

- Additive version-1 audience-scope contracts, identity disclosures, role permissions, and strict
  schema/page-size boundaries. Feedback-room identity policies are reserved but have no writer.
- One Round credential adapter now serves both Q&A and Pulse/chat. Existing tables, routes,
  identifiers, envelopes, game state, and presenter/cohost behavior remain intact. Presentation
  native credentials are adapted separately; Companion cannot gain moderation or hosting power.
- Ordered migration `059_audience_scope_foundation.sql` adds forced-RLS Presentation scope and
  outbox storage with composite workspace/source keys, immutable identity/retention, and cascades.
  Activation and the first sequenced event commit together. The game revision/sequence is unchanged.
- Host-only, allowlisted Presentation scope activation, authenticated scope reads and synchronization,
  separate websocket subscription/sync, distributed activation throttling, and a lease-fenced outbox
  relay using the existing Socket.IO adapter. Duplicate delivery keeps the same `eventId` and sequence.
  Existing activation, reads, and synchronization survive a creation-rollout pause.
- Memory/PostgreSQL conformance, direct RLS/source-isolation tests, credential revocation, retry,
  removed-scope cleanup, metadata privacy, and real websocket delivery tests.

Presentation scope activation is **infrastructure-only**: its response explicitly reports Q&A,
chat, and Pulse unavailable and no interaction-writing permissions. It does not expose an unfinished
workflow in the UI. Round scope sync delegates to the existing role-filtered Q&A/chat/Pulse services.
The local room-code registry is unchanged; there is no second joining directory.

`FEATURE_AUDIENCE_SCOPES`, `FEATURE_FEEDBACK_ROOMS`, `FEATURE_SURVEYS`, and
`FEATURE_FEEDBACK_EXPORTS` default off. New activation also requires
`CORE_PARITY_WORKSPACE_ALLOWLIST`. The last three flags reserve independent future writer gates;
turning them on does not create the still-unimplemented features. Apply migration 059 before
deploying these API/worker readers; keep compatible readers and migrations during feature rollback.

Next, in delivery order:

1. Finish M1: scoped Q&A/chat/Pulse repositories and shared moderation/lifecycle rules, Presentation
   interaction UI, anonymous feedback-room credential/privacy/passcode foundations, and scoped
   cross-process/Redis-disruption evidence.
2. M2: open text, word cloud, ranking, multiple-selection opinion polls, capability-registry updates,
   schema upgrades/negotiation, public-text moderation, and complete author/player/report journeys.
3. M3: immutable Surveys, revision-fenced builder, rooms and universal QR/code joining, draft/resume/
   atomic finalization, retention, and transactional shared Round/Survey publication quotas.
4. M4: spotlight/queue, privacy-safe feedback reports, private export jobs, aggregate-only sharing,
   load/security/accessibility/partner acceptance, and operating guides.

The thirteen external release gates remain open. No participant cap, pricing, anonymity claim,
report schema, or public-release status changes in this increment.

Verification: `CI=true pnpm check` passes formatting, dependency-context checks, lint, strict types,
package/support tests, and production builds. All 74 PostgreSQL integration tests pass separately
against a fresh disposable local PostgreSQL 18.3 cluster, including migration/repeat/checksum,
shared scope conformance, forced RLS, immutable retention/privacy, account export, and deletion.
Thirteen new server tests cover API roles/rollback, activation throttling, legacy sync projections,
kicked/expired access, real Socket.IO subscription, duplicate relay delivery, and revocation,
hash-only distributed socket metadata, and serialized remote-subscriber credential revalidation.
Review fixes also add memory race tests proving that concurrent finishing/deletion cannot recreate
an audience scope or outbox event. Both reported regressions failed before their fixes; all thirteen
audience server tests and three memory audience tests now pass, as does `CI=true pnpm check`.
The review-fix follow-up did not rerun PostgreSQL integration or real multi-process Redis tests;
the 74-test PostgreSQL result above is the earlier foundation verification.
The October 10 PR follow-up keeps closed, uninitialized Round scope GET/sync requests read-only
across all four roles, including Q&A settings, and derives active-room cursors from the initialized
settings record. First GET and sync responses agree with the bootstrap event and interaction cursor;
retries allocate no additional event. These behaviors have direct regression coverage.
No web source changed; this backend-only increment did not rerun Playwright or claim manual
accessibility/device, Redis multi-process, target-host capacity, legal, or partner acceptance.

### Presentation Companion standalone published questions — October 9, 2026

Companion can now insert one explicitly selected immutable question from a published Round at a
safe closed boundary, without requiring a Recovery Pack. The bounded workspace/pass-scoped
catalog supports literal title/prompt search and returns only IDs, published title/version/hash,
prompt, and type. It excludes media, Pack-derived questions, rechecks, and both sides of linked
recovery sequences. The accessible two-step source/question picker supports keyboard dismissal,
focus return, loading/error recovery, bounded search, and exact acknowledgement retry.

The server freezes the selected retained version, assigns destination IDs, and stores block and
session-only provenance atomically with content, timer, revision, sequence, event, and receipt.
New publication never substitutes another version. Accepted copies/retries survive source deletion
and feature rollback; new insertion revalidates the present non-archived source inside the state/
receipt transaction and holds the PostgreSQL source lock until commit. Memory/PostgreSQL
reads and snapshot restore retain the markers and reject unsupported stored source schemas.
Catalog reads validate all eligible current schemas before JSON interpretation, filtering, or
pagination; PostgreSQL uses one read-only repeatable snapshot for validation and metadata.
Sources/drafts remain unchanged. Supported question types retain existing timed/flex, scoring,
confidence, and report behavior, with no invented paired-recovery evidence or new report schema.

New creation uses current professional Presentation, Companion/realtime, and workspace gates,
independently of Pack flags/latches. The optional capability is independently opt-in via
`includePublishedQuestions=true`, preserving default and Quick-Check-only strict REST readers.
Upgrade compatible API/report-worker readers before enabling insertion and retain them during
feature rollback. No new tables, migrations, dependencies, CI jobs, or participant-cap changes.

Verification: local `CI=true pnpm check` passes formatting, Docker dependency-context checks,
lint, type checks, package/support tests, and production builds, including 312 contract, 615 web,
131 memory/database, 498 server, and 206 support tests. All 72 PostgreSQL integration tests pass
against a fresh disposable PostgreSQL 17 database; the test container was removed afterward
without changing existing services or data volumes. Nine selected production-browser checks pass
across desktop Chromium, Android Chromium, and mobile WebKit: three new published-question journeys
and six Quick Check/Pack regressions. They cover explicit-version freezing after republish, source
deletion, lost acknowledgement/exact retry, timed/flex grading, unchanged source drafts, report
reconciliation, cookie omission, keyboard/focus, axe, and mobile overflow. Independent read-only
review found no remaining actionable issues after fixing unsupported-schema catalog parity and
the browser assertions for report readiness and timed scoring. Review follow-up tests prove
archive/delete lock races reject without partial writes, exact accepted receipts survive concurrent
source deletion and repository restart, and search/eligibility/limit cannot hide future schemas.
The nine browser checks were not rerun for this backend-only review follow-up. Firefox retains the documented
local launch limitation and its existing CI project; manual/external acceptance remains separate.

Next: session-owned media retention for media-backed Companion insertion, then Recovery Trail
and Concept Health. Partner-evidence decisions, manual assistive-technology/device reviews, and
staging/production exercises remain deferred, not passed. Published Presentation source selection
is outside this Round-source increment; no mutable authoring surface or full deck editor is added.

### Presentation Companion session-only Quick Checks — October 8, 2026

The next provisional Companion increment adds one immutable unscored opinion poll per live
session, with a 1–500-character prompt and 2–6 distinct 1–180-character choices. It reuses the
existing scoped Companion pass, authoritative live engine, atomic content/timer/revision/event/
receipt transition, and exact acknowledgement recovery. The closed-boundary fence never splits
an open question, intervention, or pending linked recheck, including practice-purpose sources
and intervening blocks. Timed rooms use a 10–300-second deadline; flex rooms have no deadline or
countdown and the facilitator closes responses.

The accessible form supports bounded add/remove, duplicate-choice validation, keyboard dismissal,
focus return, and draft preservation across closing/errors. Accepted-state broadcasts cannot
close the form before acknowledgement, and ambiguous retries freeze the original prompt, ordered
choices, timing, revision, and command ID. PostgreSQL reads and snapshot restoration retain the
session-only marker; legacy snapshot upcasters remain compatible. Published content and drafts
are not edited. Reports identify the poll as **Session-only Quick Check · unscored**, with null
correctness/accuracy and zero score, never as learning or recovery evidence.
The new evidence uses Presentation Report V3, leaving strict V1/V2 unchanged. Companion/report
REST metadata is opt-in via `includeQuickChecks=true`; default responses preserve legacy strict
readers without rewriting ready reports. Roll out compatible API/report-worker readers before
enabling new use; after V3 is written, retain compatible readers during feature rollback rather
than deploying a V1/V2-only binary. See [API compatibility and upgrade order](api.md#presentation-companion-foundation).

New creation uses current professional Presentation, Companion/realtime, and workspace gates,
independently of Pack/live-card flags and the Pack session-creation latch. Rollback blocks new
creation while preserving existing polls, response submissions, reads, and accepted retries.
No new tables, migrations, dependencies, CI jobs, or public participant-cap changes are introduced.

Verification: local `CI=true pnpm check` passes formatting, lint, type checks, package/support
tests, and production builds, including 308 contract, 583 web, 126 memory/database, 484 server,
and 206 support tests. All 66 PostgreSQL integration tests pass against an isolated disposable
PostgreSQL 17 database, removed afterward without changing existing services or data volumes.
Nine selected production-browser checks pass across desktop Chromium, Android Chromium, and
mobile WebKit: three new Quick Check journeys and six Companion/Pack regressions. They cover
timed/flex behavior, lost acknowledgement/exact retry, preserved drafts, unchanged published
sources, unscored report reconciliation, cookie omission, keyboard/focus, axe, and mobile overflow.
Independent focused review verified the strict legacy REST/report compatibility fixes and
session-marker persistence; no actionable issues remain in that recheck. Firefox retains the
foundation checkpoint's local launch limitation and its existing CI project.

At this checkpoint standalone published-question insertion was next; the subsequent Round-source
increment is recorded above. Media-backed Companion insertion and the staged Recovery Trail
and Concept Health increments remain separate. This completes the session-only Quick Check slice, not all original
Companion scope; partner-evidence decisions, manual assistive-technology/device reviews, and staging/production
exercises remain explicitly deferred, not passed.

### Presentation Companion Recovery Packs — October 8, 2026

The next provisional Companion slice adds a bounded, bearer-scoped published Pack catalog and
live insertion of an explicitly selected immutable text-only version. One revision-fenced command
inserts the frozen diagnostic/recheck pair and immediately opens the diagnostic. Session content,
question timing, revision, event sequence, timeline, and command receipt commit atomically in
memory and PostgreSQL. Published Presentation/Pack versions and drafts remain unchanged. Every
copy keeps its complete original Pack baseline and provenance; it survives source deletion.

Insertion is limited to safe closed boundaries. Any earlier/current source question with a linked
recheck still ahead blocks insertion, including practice-purpose sources and intervening content
or standalone questions. Post-reveal card choices expose titles/references only. An explicit
explanation/worked-example action plays only the selected frozen card, then opens its linked
recheck. The picker and card controls share exact-command acknowledgement recovery with advance;
ambiguous insertion retries retain their original intent. Accepted retries and frozen playback
remain available after source deletion or flag/allowlist rollback.

New insertion requires the existing Companion/realtime, professional Presentation, Pack/live-card,
workspace allowlist, and session-creation gates. This slice supports text-only Packs: media on a
diagnostic, recheck, or optional delayed probe is rejected until session-owned media retention is
implemented. The delayed probe is retained but not played live. Existing credential/session tables,
forced RLS, retention, export/delete, and audit boundaries are reused; there are no new migrations,
dependencies, CI jobs, participant-cap changes, or production-acceptance claims.

Verification: all 303 contract tests, 532 web tests, 126 memory/database tests, and 66 PostgreSQL
integration tests pass. The PostgreSQL suite ran against an isolated disposable PostgreSQL 17
database, which was removed afterward without changing existing services or data volumes. All 65
focused server tests, server type checks/lint, and the diff check pass. Twelve selected browser
checks pass across desktop Chromium, Android Chromium, and mobile WebKit with a production Next
build: the three new Pack workflows plus nine existing Companion/host regressions. They cover
immutable source-version selection, source deletion, lost acknowledgement/exact retry, selected-only
card playback, recheck/report reconciliation, cookie omission, keyboard/focus, axe, and mobile
overflow. Independent focused review verified the diagnostic/practice pending-recheck fixes and
corrected disabled-button assertions. Firefox retains the foundation checkpoint's local launch
limitation and its existing CI project; manual assistive-technology/device, partner, and external
security/release evidence remain separate gates. Local `CI=true pnpm check` also passes formatting,
Docker dependency-context checks, lint, type checks, all package/support tests, and production builds.

At this checkpoint, session-only unscored Quick Checks were next; the subsequent increment is
recorded above. Media-backed Companion insertion requires its own retention increment;
Recovery Trails and Concept Health remain later capabilities. Partner-evidence
decisions and staging/production exercises remain explicitly deferred, not passed.

### Presentation Companion foundation — October 8, 2026

The first provisional Companion slice adds a compact live Presentation sidecar, owner/editor
launch and revocation, dedicated hashed one-hour passes, aggregate joined/connected/disconnected/
answered counts, and one phase-aware advance action. It reuses the authoritative Presentation
engine, durable receipts, Socket.IO sequence/revision fences, lost-acknowledgement recovery,
and temporary REST polling; no parallel runner or host pass is shared. Pass capture removes the
launch fragment before requests, uses tab-scoped storage, and clears the popup's inherited host
storage. Companion API requests omit creator cookies.

Join QR/code and post-reveal aggregate-result overlays support keyboard dismissal and focus
return. Results omit learner identities, correctness/keys, explanations, citations, notes,
and raw numeric/rating responses. “Return to deck” returns to the sidecar only. The dedicated
`FEATURE_PRESENTATION_COMPANION` flag defaults off; new passes also require realtime and
professional Presentation eligibility plus the evidence workspace allowlist. Flag rollback
preserves existing valid passes, reads, commands, and revocation. Existing credential tables,
forced RLS, export/delete, and retention cascades are reused; no new migration is required.

This is incremental source implementation, not an accepted partner-value or production gate.
Verification: local `CI=true pnpm check` passes formatting, Docker dependency-context checks,
lint, type checks, package/support tests, and production builds. Nine selected production-browser
checks pass on desktop Chromium, Android Chromium, and mobile WebKit: Companion pass-only launch,
fragment cleanup/reload, lost acknowledgement retry, pre-reveal result fencing, QR/keyboard/focus,
axe/mobile overflow, revocation, and existing host lost-acknowledgement/rotated-pass recovery.
Firefox remains unverified locally because its browser process cannot find its temporary profile;
the existing Firefox CI project is retained. Default local PostgreSQL integration tests remain
skipped; no new tables or migrations were introduced. Independent read-only code review found
no remaining actionable issues after repairing popup storage inheritance and cookie omission.
New Companion labels use explicit English fallbacks until reviewed translations are available;
manual assistive-technology/device and external security/rollout evidence remain separate gates.

At this foundation checkpoint, immutable prepared Pack insertion/playback was next; the subsequent
text-only Pack and session-only Quick Check increments are recorded above.
Recovery Trails and Concept Health remain later increments; learner formats and institutional
integrations keep their existing scope and privacy constraints.

### Polling Pops identity — October 7, 2026

The public UI, translated catalogs, sign-in/invitation email copy, documentation, metadata,
and downloadable filenames use Polling Pops. Original lollipop SVG/PNG assets, browser and
home-screen icons, and a social card are bundled. The shared light/dark tokens and live
Presentation surfaces use the new berry, cream, mint, yellow, and plum identity. Candy Pop
is available in every edition and is selected for new blank Rounds and Presentations.
Existing presets, frozen themes, authentication/resume keys, native formats, migrations,
API paths, and operator configuration remain compatible. Existing help recordings are
clearly labeled as recordings from before the rebrand. See [Brand and interface](brand.md).

Verification: formatting, lint, strict type checks, all package unit tests, 179 operations/support
tests, and the production Next.js build passed. Thirteen workspace/Recovery Loop browser checks
passed on desktop/mobile Chromium. The new identity, public light/dark surfaces, and Candy Pop
host/guest accessibility checks passed on desktop Chromium, mobile Chromium, and mobile WebKit
(12 checks). Local Firefox could not launch its temporary profile, so Firefox remains unverified.
The final local Compose web refresh is blocked by Docker storage exhaustion; the existing
running services and data volumes were preserved. Refreshing the earlier help recordings is
also deferred; their original captions and transcripts remain audio-matched.

At the 2026-09-25 transition checkpoint, Phase 0 repository implementation was merged through
`3aee4d9`. CI, Security, and Production-path smoke pass on `main` after
[PR #40](https://github.com/riojung/pollingpops/pull/40) repaired the MinIO image path, upgrade and
rollback ownership, and browser media smoke. [PR #42](https://github.com/riojung/pollingpops/pull/42)
completed Presentation rolling-upgrade sequence compatibility, and
[PR #43](https://github.com/riojung/pollingpops/pull/43) added the research Prototype Lab and the next
behavior-preserving Presentation refactor slice. The release ledger therefore records the source-CI
and local-production-smoke gates complete.
The Phase 0 exit remains open with thirteen gates pending. Most require external or human evidence.

The completion-hardening slice now also closes the last repository-side target-load setup gap. A
staging-only, non-HTTP one-shot command can provision one reviewed synthetic Free workspace for the
250-participant matrix while proving the connected PostgreSQL principal is the restricted runtime
role; the plan change and audit marker commit atomically, and unrelated paid or Team workspaces fail
closed. Every external GitHub Action reference is pinned to an immutable commit, with a regression
test that also requires digest-pinned container actions. Five redaction-safe records now cover the
staging deployment, privacy/legal decision, live billing rehearsal, protected-branch canary, and
signed release. These controls make the remaining exercises executable and reviewable; they do not
claim that a staging host, independent review, user study, or signed release exists.

The follow-on evidence-closure hardening keeps those gates pending while tightening how they can be
run and accepted. Staging readiness is now API-triggered through a default-branch-only repository
dispatch with a strictly validated bounded payload, and executes protected and self-hosted jobs
only after an unprotected job proves the checkout is the current `main` tip. Backup/restore verification
discovers and fingerprints every durable public table instead of a fixed historical subset. The
production deployer accepts the signed-release ledger only as a reviewed `origin/main`
evidence-only descendant of the exact tagged build, bound to the annotated tag object, manifest
hash, image digests, GitHub's valid signature result for that exact tag object, and exact
release-workflow certificate identity. HIGH/CRITICAL image scans no
longer omit findings merely because no upstream fix exists. None of these controls substitutes for
running and independently reviewing the corresponding external exercises.

The beta-preflight monitoring gate also explicitly includes support readiness. Automated alert
routing cannot complete it without an active named support rota, incident and escalation ownership,
public status, security, privacy, and support contacts, and an end-to-end support incident drill for
the same exact build candidate accepted by the operations owner and an independent reviewer. The
gate remains pending until that external rehearsal occurs.

The Phase 0 closure tooling now makes the remaining evidence handoffs more deterministic without
turning them into repository-complete gates. A confirmation-gated synthetic alert rehearsal injects
and resolves build-bound `page`, `warning`, and `ticket` alerts and writes a redaction-safe request
receipt; receiver observation and the support incident exercise still require human evidence. The
target-region tool hashes and binds the exact four-profile matrix, soak, runner provenance,
saturation reference, and durable archive. Separate validators recompute the off-host
backup/restore bindings and the reviewed research aggregate. Finally, the readiness checker rejects
duplicate or unstable evidence references and, when a human-assurance gate is eventually marked
complete, requires build-bound owner and independent-reviewer acceptance. All thirteen externally
dependent gates remain pending.

The runner-compatibility hardening slice makes the staging preflights select Node 22 explicitly,
requires a reviewed Node 24-compatible Actions Runner attestation before the target-region load job
can select a self-hosted runner, and records that minimum and label in its provenance. A separate
Ubuntu 26 canary retains the production Compose path and image tooling ahead of GitHub's
hosted-runner migration. Primary Ubuntu 26 CI covers native builds, service containers, and all
supported browser engines without running a duplicate canary suite. Canary latency
is not target-region capacity evidence, and these controls do not complete a pending readiness gate.

The final technical closure pass adds the hosted single-VM observability overlay, authenticated
private metrics collection, build-bound alert rehearsal, strict target-load and replacement-host
restore evidence validators, and an immutable signed-release acceptance/deployment lifecycle. It
also fences Round and Presentation creation and live mutations during account deletion, and makes
media finalization durable with token-scoped claims, winner tagging before database acknowledgement,
deletion tombstones, repeated cleanup, and bucket lifecycle expiry for interrupted uploads or
finalizers. The accepted release remains a draft through its first verified deployment. It can be
redeployed unchanged after publication, including onto a clean replacement host, only with an
independently reviewed, digest-pinned receipt from that exact successful pre-publication production
deployment. Release-tag creation authority and no-bypass tag immutability are separate rulesets so
the release actor cannot rewrite or delete an existing tag. These controls close repository
implementation gaps; they do not convert any unperformed external drill, independent review,
provider check, device run, or participant study into completed evidence.

Staging preflight now also rejects reserved, example, placeholder, loopback, or unspecified public
and SSH targets, and requires a valid non-revoked SSH key pin for the exact configured host and
port before a protected workflow requests approval. Readiness, target-region load, and Stripe
rehearsal jobs receive their public origins from that reviewed configuration instead of independent
environment variables. Hosted tracing no longer falls back to a container-local collector: enabled
deployments require an explicit non-loopback HTTP(S) endpoint, and spans carry the reviewed
deployment environment and immutable build ID. The checked-in staging target and key pin remain
placeholders, and no collector backend, retention, residency, or alert owner has been selected, so
these controls intentionally do not mark the external staging or monitoring gates complete.

Live mutation orchestration and deterministic response policy now sit behind the existing service
façade, while memory and PostgreSQL session repositories are separated behind the unchanged
repository factory. Public `/v1` and Socket.IO contracts, error identities, transaction boundaries,
and lifecycle-extension behavior remain unchanged. Characterization tests cover durable receipt
recovery, response-fence stability, and shared memory/PostgreSQL conformance.

Phase 1 is not selected because the required design-partner observations have not been collected.
Phase 2 and the post-24-week capabilities are being implemented provisionally, without recording
any partner-evidence gate as passed. This is an evidence boundary, not permission to substitute
local automation for facilitator research, independent review, or production-environment drills.

At the product owner's direction, the partner-evidence branch/bet decision is deferred for later
revisit; feature implementation may proceed provisionally without recording any evidence gate as
passed. PR #61 merged the first Question Health MVP: a shared deterministic `@openround/insights`
evaluator, versioned advisory contract, authenticated draft-only API, and read-only Round Builder
panel behind `FEATURE_QUESTION_HEALTH` plus the evidence workspace allowlist. The evaluator is capped
at 1,000 findings and marks truncated output. The flag remains off by default.

PR #62 merged persistent, content-addressed facilitator dismissals with
three bounded reasons and a reopen action. Dismissals are scoped to the workspace/Round, fenced by
the current draft revision, hidden when the matching finding's rule version or content hash changes,
included in account export and source-deletion cleanup, and logged using the
`question_health.dismissal.create` / `question_health.dismissal.delete` audit vocabulary without
storing question text in audit metadata. Turning off the rollout blocks new dismissals while keeping
currently matching saved decisions readable and reopenable. This remains advisory: no draft is
rewritten or published automatically.

PR #63 merged a facilitator-approved draft revision flow for supported findings:
strict rule/field-specific edits, a server-validated before/after preview, one idempotent saved
revision, and undo while that revision is still current. Published versions are not changed. The
builder preserves unsaved local work during conflicts, and application provenance is scoped to the
source Round and included in account export and deletion. Unsupported findings remain advisory.
Published-content analysis now evaluates an exact immutable Round version through a separate
creator-authenticated, allowlisted, read-only API and builder panel. It includes stored version
provenance, does not inherit draft dismissals or mutation controls, and stays pinned when the draft
changes or a newer version is published. PR #64 merged a read-only aggregate endpoint and builder view for retained reports of that
exact published version, bounded to the 250 most recent retained reports with an explicit omitted-history
indicator. It separates Learning/Verified, timed/flex, and accuracy/speed-scoring cohorts, suppresses question
observations until a session has at least 20 responses, and flags an unused distractor or large
accuracy range only under the versioned rules and sample gates. It adds no learner-level persistence,
exposes only aggregate projections, calls no AI provider, and does not edit/publish content. This is an
implementation slice, not the 20-question/70%-usefulness study or a production rollout; partner
usefulness/retained-revision thresholds remain unmeasured, and local tests do not close Phase 1/2
or release-readiness gates.

As of the merged `main` snapshot through PR #69 on 2026-10-04, all repository-side functionality
committed for Phase 0 is implemented. The open Phase 0 items are evidence and release-readiness gates, not an
unfinished feature backlog. PR #64 merged exact-version aggregate Question Health post-use
observations; its partner usefulness and retained-revision thresholds remain unmeasured. PR #65
merged Session Decision Replay: a strict aggregate-only event journal, Report V4 with V1–V3 read
compatibility, and a read-only decision timeline for new eligible Round sessions. Capture is frozen
at creation behind `FEATURE_DECISION_REPLAY` and the evidence workspace allowlist. Existing reports
are not backfilled or reconstructed. Delayed Recovery Trail and Concept Health remain future
capabilities; the Recovery Pack foundation below is the next incremental implementation.
Partner-evidence decisions remain explicitly deferred; these
merged features do not close external research or release gates.

## Recovery Pack foundation — 2026-10-05

This incremental slice adds first-class Pack drafts, revision-fenced/idempotent saves, bounded
history and restore, immutable hash-deduplicated publication, workspace isolation, native JSON
import/export, account export/delete, and media-reference lifecycle handling. It is provisional
feature development, not a passed demand, quality, accessibility, or release gate.

The creator Library links to `/recovery-packs`. Authors start with an existing published Round's
diagnostic/linked-recheck pair, review its prompts and concepts, and add 1–5 facilitator intervention
cards. Publication checks question correctness, topology, concepts, IDs, and distinct normalized
prompts. The distinct-prompt check is not a semantic guarantee: authors must still review whether
the recheck tests transfer and whether the citations support the content.

An immutable version can be inserted into a Round draft as a fresh, linked question pair. Every
copy has Pack/version/item/role/hash provenance; the destination also retains the complete original
Pack snapshot, including cards, citations, and any delayed probe. The Round builder shows the cards
as facilitator references. Copies survive Pack deletion and never update automatically. Insertion
uses the existing Round mutation receipts and revision fence, so a retry does not add a second pair.
Insertion also enforces a 3.5 MB serialized draft ceiling, leaving headroom within the 4 MB editor
request limit. Pack authoring/import accepts up to 1 MB, including multi-byte text and citations.

Enable authoring, publishing, imports, and insertion only with `FEATURE_RECOVERY_PACKS=true` and
the workspace in `EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST`. Existing Packs, history, exports, and
inserted copies remain readable after disabling the feature. Owners/editors may remove a Pack even
when disabled. Migration `049_recovery_packs.sql` supplies forced RLS, immutable versions, scoped
foreign keys, and media-reference triggers. History retains at most 20 revisions and 30 days;
mutation receipts retain their original result for 30 days.

Native Pack JSON round-trips the content, but does not embed media bytes. Media IDs remain private
to their workspace; importing a Pack with inaccessible media fails rather than transferring access.
Imports create drafts and require human review/publication.
Pack-backed Round JSON declares format version 3, retains the immutable source baseline, and remaps
only destination IDs on import. Older importers can reject the version rather than silently dropping
Pack references. Cross-workspace imports with private baseline media return an explicit validation
failure instead of altering the baseline under an unchanged hash.

Still pending after the foundation slice: live intervention-card playback (implemented in the
increment below); insertion into
Presentation, practice, and Companion; source-authoring proposals and content-hash-bound citation
approval; QTI/CSV Pack exports with loss reports; and real preparation-time/quality validation.
The Round update and live-card workflows are described in the next checkpoints.

Verification includes memory/PostgreSQL conformance, tenant isolation, media and account-deletion
races, receipt recovery, native roundtrips, type/lint checks, and production builds. Browser workflows
pass desktop Chromium, Android Chrome, and iPhone WebKit with automated accessibility checks,
lost-save-acknowledgement retry, and feature-disabled reads/export/delete. Local Firefox could not
launch because its temporary profile folder was unavailable; its workflow remains unverified here.

## Recovery Pack Round update review — 2026-10-05

The next incremental slice adds authenticated three-way review between the accepted source
baseline, local diagnostic/recheck copies, and the latest immutable published Pack. The initial
insertion metadata and `originalContent` remain unchanged; an optional hash-validated
`updateBaseline` records the accepted source version for the next comparison. Cards, citations,
concept metadata, and the delayed probe are reviewed alongside checkpoint changes.

Unchanged local copies default to accepting changed source questions. Local-only changes default
to keeping the local copy; conflicts and deleted copies require explicit keep/replace choices.
Deletion is never silently undone. Replacements keep destination question IDs, rebuild the linked
pair's source relationships, and record the selected source provenance. Kept copies retain their
actual earlier provenance. This is whole-checkpoint review, not automatic field-level merging.
Restoring a deleted recheck cannot silently change an unlinked diagnostic marked keep-local:
the review requires an explicit linked diagnostic replacement before enabling that restoration.
The server independently rejects incomplete, misordered, or shared restored pairs without saving
a revision; context-only acceptance still preserves deliberately unfinished local drafts.

`POST /v1/recovery-packs/update-review` reads an authoritative saved Round revision;
`POST /v1/recovery-packs/update` accepts the reviewed version, expected revision, mutation ID, and
bounded role choices. Applying creates one idempotent draft revision and never edits a published
Round or Pack. The browser drains pending autosaves, fences review/application adoption, and
retains mutation IDs for lost-acknowledgement retries. A concurrently published Pack version is
not silently substituted for the reviewed one. Source identity uses immutable version IDs rather
than increasing version numbers: restoring and republishing existing Pack content can legitimately
make an earlier version current again, which the review displays explicitly.

Undo uses the existing Round history restore with the applied revision as its expected revision,
so later edits cannot be overwritten. Migration `051_recovery_pack_update_undo.sql` protects the
pre-update source snapshot while its application is current, including a previously inactive
Round whose snapshot is older than 30 days. This is not permanent application history: replay and
older restores remain subject to the existing bounded Round history/receipt retention.

Migration `050_recovery_pack_update_media.sql` retains media from both original and accepted
baselines across draft, history, and published snapshots, including probe-only media. Native Round
JSON uses version 4 after an update baseline exists; imports still accept versions 1–3, preserve
both snapshots, and remap only destination IDs. Inaccessible baseline media fails import instead
of changing evidence under an unchanged hash. No new learner data or live-path behavior is added.

Apply stays behind `FEATURE_RECOVERY_PACKS` and the workspace allowlist. Existing reference reads,
comparisons, exports, and revision-fenced undo remain available after disable. These source-level
checks do not close partner-evidence, independent accessibility/privacy/security, or release gates.

Verification passed the bounded-worker package suite (including 215 contract, 334 server, 87 memory
database, and 361 web tests), 44 isolated PostgreSQL tests, support checks, lint, typecheck, formatting,
and production builds. The environment-gated server multi-writer test remains skipped in that
package run. Eight new update-review browser scenarios passed across desktop Chromium, Android
Chromium, and iPhone WebKit, with zero automated accessibility findings in the core journey; existing
Question Health and Pack foundation browser regressions also passed. Manual assistive-technology
and independent review evidence remain separate requirements.
The session-ordering unit tests disable only background process-metric collectors, whose sampling
intervals otherwise survive fake-clock transitions and block subsequent retries while catching up;
service-metric assertions and production collectors are unchanged.

## Recovery Pack live Round cards — 2026-10-05

This increment makes the frozen intervention cards usable in live Rounds. After revealing a
Pack-backed main diagnostic, the host explicitly previews one card and starts an explanation or
worked-example intervention through the existing version-fenced, idempotent host command path.
Generic interventions, finish, and linked-recheck controls remain available. Participants and
presenters receive only the selected active card's plain text and citations, not the other cards,
future questions, delayed probe, or full Pack snapshot. Pre-reveal Pack playback is intentionally
unsupported because authored card text can disclose the answer.

Playback uses the exact insertion's accepted update baseline, or its original immutable snapshot
when no update has been accepted. It never fetches the latest source Pack, and source deletion does
not change an existing room. New sessions freeze eligibility from both `FEATURE_RECOVERY_PACKS`
and the separate default-off `FEATURE_RECOVERY_PACK_LIVE_CARDS`, plus the evidence workspace
allowlist. Ordinary rooms and v1–v5 legacy rooms stay v5-readable through commands and restart;
only new eligible live-card rooms write v6. Disabling either flag prevents eligibility in new
rooms while active enabled rooms remain usable. Keep the live-card switch off during the canary
and drain every old v5 server/worker before enabling it. Once enabled rooms or reference-bearing
decision evidence exist, rollback requires a v6-capable, live-card-aware server/worker; flag disable
alone cannot make an older binary compatible.

Migration `052_recovery_pack_live_cards.sql` persists aggregate insertion/Pack/version/hash/card
references on the existing forced-RLS intervention table. Reports and CSV retain this attribution
even without Decision Replay; captured start/finish timeline events include the same reference
when replay is enabled. No card body, raw learner response, or new learner identity is added to
decision evidence. Session retention, deletion, and account export cover the copied references.

The existing browser sign-in fixtures now wait for hydration, confirmed consent, and the completed
dashboard redirect before navigating to the next workflow. This addresses the WebKit navigation
race seen in CI without loosening feature assertions or raising timeouts.

Verification passes 219 contract, 30 engine, 340 server, 87 memory database, and 364 web tests,
167 support checks, and 45 isolated PostgreSQL tests. Compatibility regressions cover authoring-only
v5 creation, commands, cached reads, cold restart, legacy upcasts, actual snapshot versions, separate
flag/allowlist requirements, enabled v6 persistence after flag disable, and older deployment receipts.
The PostgreSQL path includes durable card
and decision-event references, source deletion, cold repository restart, tenant denial, account
export, and retention cascade. The browser journey passes desktop Chromium, Android Chromium,
and iPhone WebKit, including mobile participant contexts, host-only previews, socket-frame leakage
checks, escaped card content, citations, participant/presenter reconnect, linked recovery evidence,
and zero automated accessibility findings across all three live roles. The previously failing
WebKit foundation sign-in workflow passes three consecutive repeats. Firefox remains unverified
locally because its profile cannot launch; the environment-gated server multi-writer test remains
skipped in the standard package run. Automated scans do not replace manual assistive-technology
or independent review evidence. Lint, typecheck, formatting, Docker-context checks, and production
builds also pass.

Next Pack slices remain Presentation live cards, practice/Companion insertion, source-authoring proposals with
content-hash-bound citation approval, and QTI/CSV Pack portability with explicit loss reports.
Delayed Recovery Trail and Concept Health remain later incremental capabilities. Partner-evidence
and staging decisions remain deferred; this implementation does not mark their gates as passed.

## Recovery Pack Presentation draft insertion — 2026-10-06

The next incremental implementation inserts an immutable published Pack's diagnostic and linked
recheck into a Presentation draft, with fresh block/question/choice IDs and a complete frozen
Pack/version baseline. The baseline retains cards, citations, concepts, and the optional delayed
probe; the builder displays cards and citations as read-only facilitator references, not live
card playback. Local edits and deletion do not rewrite the
source or baseline; source deletion and feature disable do not hide existing references.

`POST /v1/presentations/:id/recovery-packs/insert` requires editor/owner access, both feature gates
and workspace allowlists, an expected revision, and a stable mutation ID. The builder drains
autosaves before insertion, prevents concurrent local edits during the operation, and retains the
exact request for lost-acknowledgement retry. Server receipts resolve retries before rollout,
stale-state, and source checks, including after a flag/allowlist pause; new insertions remain blocked.
Retries never duplicate the pair or overwrite later edits. A serialized UTF-8 bound leaves room
for subsequent saves.

Presentation documents containing complete Pack baselines declare schema v3; ordinary and legacy
documents, including existing question-level Pack provenance, remain v2. The draft request envelope
remains v2. Explicit readers preserve provenance across draft,
history, publish, browser recovery, and Round-question imports. Migration 053 retains baseline-only
media across draft/history/published snapshots, including after copied questions change or are
deleted. Existing RLS, account export/deletion, and retention mechanisms cover these snapshots.
Live projections continue to omit frozen references, cards, future probes, and pre-reveal answers.

Verification passed 243 contract, 102 memory/database, 351 server, 372 web, and 178 support tests,
plus all 49 isolated PostgreSQL tests. The new Presentation insertion journey passed desktop
Chromium, Android Chromium, and iPhone WebKit without retries, including acknowledgement loss,
autosave/publish, source deletion, disabled-feature references, automated accessibility, and live
privacy checks. All seven browser scenarios, including existing Round Pack journeys and the
workspace-retry/import-dialog race regression, passed in one combined production run without
retries. `pnpm check` passed formatting, Docker-context checks, lint, typecheck, package/support tests,
and production builds. Firefox remains unverified locally, and the environment-gated server multi-writer test
remains skipped in the standard package run. Manual assistive-technology and independent reviews
remain separate requirements.

Remaining Pack work: Presentation live cards, practice and Companion
insertion, source-authoring/citation approval, and QTI/CSV loss reports. Partner-evidence and staging
remain deferred; this source implementation makes no launch, capacity, or evidence-gate claim.

## Recovery Pack Presentation update review and undo — 2026-10-06

Presentation drafts now reuse the Round three-way Pack comparison: the frozen original or last
accepted baseline, the exact reviewed immutable Pack version, and local diagnostic/recheck copies.
Unchanged copies can take source changes; conflicting edits and deleted copies require explicit
choices. Existing question/block IDs, unrelated slides, block metadata, and kept local edits remain
intact. Restored checkpoints are placed next to their sibling, or appended as a pair when both are
missing. Accepting context advances a separate frozen baseline without changing original evidence,
published Presentation versions, or active sessions.

`POST /v1/presentations/:id/recovery-packs/update-review` returns an authoritative saved-draft
comparison. `POST /v1/presentations/:id/recovery-packs/update` requires editor/owner access, both
rollout gates/allowlists, the exact reviewed version ID, expected revision, mutation ID, and role
choices. A stale request resolves an existing receipt before checking source availability or paused
flags; it cannot overwrite subsequent edits. New applies are blocked when disabled. The builder
drains autosaves, fences local edits and stale callbacks, and retains the exact request after
acknowledgement loss. Frozen references display the accepted version's cards/citations.

Undo uses existing revision-fenced history restore and is offered only while the accepted update
remains the unchanged current draft. Migration 054 adds nullable undo-source metadata to existing
Presentation mutation receipts. Memory and PostgreSQL retain that source snapshot even when it
exceeds normal age/count limits, then release the exception after another meaningful edit. Existing
tenant RLS, media references, export/deletion, and parent cascades remain in force. Comparisons,
receipt recovery, and fenced history restore remain available after either rollout is paused.

Verification: `pnpm check` passed formatting, Docker-context checks, lint, typecheck, all 1,361
package/support tests, and production builds. All 51 isolated PostgreSQL tests passed. The combined
production Pack browser suite passed 10/10 scenarios without retries across desktop Chromium,
Android Chromium, and iPhone WebKit, including all prior journeys plus dirty-save fencing,
deleted-copy conflicts, a pinned reviewed version, lost apply/undo acknowledgements, immutable
published-version identity, accepted references, later-edit undo invalidation, and disabled-feature
reads. Automated accessibility scans found no violations in the tested update journeys. An initial
browser-only assertion was corrected to match the documented Presentation read response; the
server test independently verifies that the frozen published content is unchanged.

Firefox remains unverified locally, and the environment-gated multi-writer test remains skipped in
the standard package run. Manual assistive-technology and independent reviews remain separate.
Live Presentation card playback is not part of this slice. No new CI jobs, participant caps, release
promises, or partner-evidence claims are introduced.

## Recovery Pack live Presentation cards — 2026-10-06

New eligible Presentation sessions freeze card playback from `FEATURE_RECOVERY_PACKS`,
`FEATURE_RECOVERY_PACK_LIVE_CARDS`, and the evidence workspace allowlist. Existing rooms default to
ineligible. After revealing a uniquely Pack-backed main diagnostic, the host previews the frozen
original or accepted baseline and explicitly starts an explanation or worked example. No current
source Pack is fetched. Participants and companion projections receive only the selected active
card's plain text and citations; future cards, probes, notes, and hidden diagnostics remain private.
Generic intervention/advance controls remain available, and advancing clears the active card.
A deliberately unlinked diagnostic can still use a card and then continue or finish normally.

Socket commands and the new scoped-host `POST /v1/presentation-sessions/:id/command` fallback share
the same revision fence and durable intent fingerprint. Exact acknowledgement-loss retries resolve
before phase/card validation, including after a later advance or finish; reuse for a different
card, intervention type, action, or revision conflicts. Host previews are not participant broadcasts,
and a failed acknowledgement remains explicitly retryable rather than being reported as saved.
Accepted host mutations notify connected roles even when submitted through REST. Temporary retry
admission denials preserve the original unresolved intent. If acquiring a control pass fails, legacy
creator-authenticated advance remains available without unsafe automatic retries; card actions stay
disabled until the host restores the pass. Scoped sync/command rejection clears only that rejected
stored pass and exposes explicit reacquisition, without automatically rotating other hosts' passes.
An unresolved command survives controller replacement and pass reacquisition with only its credential
rebound; its ID, revision, action, and card selection remain fixed. Shared startup acquisition also
survives development-mode effect restarts without duplicate pass creation or stale-result overwrites.

Migration `055_recovery_pack_presentation_live_cards.sql` expands the existing forced-RLS session,
timeline, and command-receipt tables. Eligibility is immutable; selected aggregate references and
receipts follow existing account export/deletion, session deletion, and retention cascades. New
card-bearing evidence writes Presentation Report V2 with the exact Pack/version/hash/card reference
and explanation/example type, not card bodies or learner answers in timeline metadata. Legacy and
generic-only reports remain V1, and both versions are readable without rebuilding old evidence.
The audit action is `presentation.session.recovery_pack_card.start` with aggregate attribution only.

Disabling either Pack flag blocks eligibility in new rooms but does not interrupt enabled rooms or
hide retained reports. Keep the live-card flag off while older Presentation servers/readers/workers
can receive traffic; once eligible rooms or V2 reports exist, use a live-card/V2-capable rollback
target. See the [upgrade runbook](runbooks/upgrade.md). No rollout, capacity, partner-evidence,
independent-review, or production-readiness gate is marked complete by this source increment.

Authoring references, the insertion picker, update review, and the Pack library now describe live
playback as conditional on workspace enablement and eligible new sessions, rather than unavailable.
Practice and Companion insertion remain pending.

Verification: `pnpm check` passes (format, Docker-context coverage, lint, typecheck, 1,425 unit/support
tests, and every package build). All 54 PostgreSQL 17 integration tests pass separately against an
isolated disposable database. The combined production-browser Pack suite passes 31 scenarios on
desktop Chromium, mobile Chromium, and mobile WebKit, including ten new Presentation card runs
with selected-only frames, reconnect, lost acknowledgements, REST broadcasts, recheck/finish,
report attribution, revoked-pass recovery, and automated accessibility checks. All ten Presentation
scenarios also pass in development mode; join setup waits for client preflight before entering an
alias to avoid a pre-hydration fill race. Regression coverage also reproduces and
fixes the mixed-writer legacy-receipt race and rejects UUID references that the shared contract
cannot read. The consent-helper check now discovers all browser specs without a fixed suite-size
cap. The multibyte draft-limit regression seeds a near-limit frozen snapshot once, then verifies the
last accepted and first rejected insertions through the API, unchanged state after rejection, and a
subsequent normal save; it retains the default test timeout and explicitly distinguishes UTF-8 bytes
from character counts. The environment-gated multi-writer test and local Firefox/manual assistive-device checks were
not run in this increment; these results do not replace external rollout or independent reviews.

Remaining Pack priorities are practice and Companion insertion, source-authoring proposals with
content-hash-bound citation approval, and QTI/CSV exports with explicit loss reports. Delayed
Recovery Trail and Concept Health remain subsequent incremental capabilities.

## Recovery Pack delayed-probe practice — 2026-10-07

An owner/editor can now assign the current published Pack's optional delayed probe as standalone
accountless practice. The Pack library links to an exact published-version assignment form, with
whole-assignment flex/timed mode, bounded opening/closing times, and optional labelled personal
links. A missing delayed probe is explicitly unavailable; the diagnostic and immediate recheck are
never substituted. This increment does not yet run the full diagnostic/card/recheck Pack sequence
in practice or implement a multi-stage Recovery Trail.

The existing practice runner handles start, private answer acknowledgement, reveal, resume,
completion, aggregate progress, closure, revocation, and accommodations. Copies receive independent
question/choice IDs and immutable Pack/version/content-hash/source-item attribution. Creator
management and history resolve frozen Pack context rather than requiring a surviving Pack or a
dummy Round. Participants receive only the authorized question and phase data, not source metadata,
cards, hidden keys, or unrevealed explanations. Generic attempts remain unpaired; labelled personal
links are accountless one-attempt passes, not persistent learner identities or paired source evidence.

`POST /v1/recovery-packs/:id/practice-assignments` requires both Pack and practice creation gates,
their workspace eligibility, editor/owner role, and the follow-ups entitlement. Personal passes use
`maxPracticePersonalLinks`, including the existing Round assignment flow. The browser holds a
256-bit access seed and exact pending request only in memory. An acknowledgement-loss retry uses
the same mutation/version/settings/seed, recovering the same assignment and original unrevoked
links before flag, source, or plan drift checks. Different intent under the same mutation conflicts;
concurrent identical requests produce one assignment and one creation audit/event. Rejected invalid
settings release the pending request for explicit correction. No link is displayed before server
acknowledgement, and leaving the creation page loses the private seed. Raw credentials are not
persisted or logged; management responses remain hash-only. Later-created or revoked personal passes
are never reconstructed by the original receipt.

Receipt recovery also covers a request whose initial lookup misses while an identical request
commits and the source is then republished or deleted. Creation failures recheck the actor/intent-bound
receipt before rejecting source or schedule drift. The assignment, access passes, media references,
creation audit, and bounded product event commit atomically; failure to store either evidence record
rolls back creation so an exact retry can safely try again. Replays never duplicate durable evidence,
and best-effort metrics observe only actual insertion without another persistence write.

Migration `056_recovery_pack_practice.sql` extends existing forced-RLS follow-up storage with
immutable source/receipt metadata and a nullable Round version only for Pack assignments. Source
publication and workspace-deletion fences apply transactionally at creation. Assignment-owned media
references survive Pack deletion and release with assignment deletion/retention. Frozen content,
source context, passes, and attempts follow existing tenant, account export/delete, and expiry
boundaries. Pausing either gate blocks new assignments/passes without hiding retained assignments
or interrupting participant completion. Older binaries do not understand Pack-only assignments;
see the [upgrade runbook](runbooks/upgrade.md#recovery-pack-practice-compatibility).

Verification: `pnpm check` passes formatting, Docker-context coverage, lint, typecheck, all 1,465
unit/support tests, and every package build. All 60 PostgreSQL 17 integration tests pass separately
in isolated disposable databases, including migration reruns, runtime-role tenant denial, concurrent
receipts, workspace-deletion ordering, export/purge, and media retention. Regression tests reproduce
commit/publication and commit/deletion races, inject both evidence-write failures, verify full
rollback (including media references), and cover restart replay plus unrelated concurrent evidence.
The combined production-browser Pack suite passes all 37 scenarios on desktop Chromium, mobile
Chromium, and mobile WebKit, including six new lost-creation-acknowledgement, exact-retry, personal-link/CSV,
source-deletion, answer/reload/resume, missing-probe, and automated accessibility scenarios.
Four existing Round-practice and assignment/management accessibility regressions also pass across
those profiles. Local Firefox cannot launch its temporary profile in this environment; manual
assistive-device and external rollout/readiness gates are not claimed complete.

Remaining Pack work includes full-sequence practice, Companion insertion, source-authoring proposals
with exact-content citation approval, and explicit QTI/CSV loss reports. Delayed Recovery Trail and
Concept Health remain later increments; partner-evidence decisions stay deferred and public
participant caps are unchanged.

## Recovery Pack full-sequence practice — 2026-10-07

This increment adds an explicit `full_sequence` assignment mode alongside the existing
`delayed_probe` default. Authors review and assign one immutable published diagnostic, 1–5 ordered
intervention cards, and its linked recheck through the existing accountless practice surface. A
Pack without an optional probe can still supply this sequence; no delayed probe is silently
substituted or appended. Creation keeps the existing Pack/practice flags, workspace eligibility,
roles, entitlement, schedule, private links, and atomic evidence/receipt semantics.

The assignment freezes independently copied checkpoint/choice IDs, question provenance, Pack
version/content hash, and card/citation context. Source publication/deletion cannot alter delivered
practice. The existing runner now moves from diagnostic reveal through each card to the recheck,
then completion. Participant projections contain only the current question or card; card stages
have no deadline, hidden answer data, future cards, or source metadata. A timed recheck starts its
clock only when opened. Reload/resume returns the durable current stage instead of starting over.

Full-sequence responses require checkpoint identity and expected attempt version. Continue uses a
stable UUID and expected version; accepted command receipts commit with the transition. Exact
retries return the current authoritative snapshot without another answer or advance, even after
later progression. Changed intent conflicts. New browser clients use these fences for every
practice mode and retain an unresolved request in memory until acknowledgement or explicit
reconciliation. Legacy unfenced clients remain supported for older assignment modes, and the
original delayed-probe creation hash remains compatible with already accepted private receipts.

Migration `057_recovery_pack_sequence_practice.sql` expands existing forced-RLS follow-up storage
with frozen sequence context, card index/stage, bounded advance receipts, and submitted-answer
versions. Source guards validate the published version, copied question semantics, and frozen
cards; immutable content, assignment media, export/delete, and parent retention remain in force.
Pausing creation leaves existing participant completion and management available. Once sequences
exist, older readers are not a safe rollback target; see the
[upgrade runbook](runbooks/upgrade.md#full-sequence-recovery-pack-practice-compatibility).

Verification passes the complete `CI=true pnpm check` pipeline, including 290 contracts, 122
DB-local, 396 server, 438 web, and 178 smoke-support tests plus the shared engine packages.
A fresh PostgreSQL 17 database passes all 62 isolation/migration tests, including replay-safe
migration bootstrap, exact source/hash guards, concurrent receipts, restart, and retention.
The production-browser Pack/practice suite passes all 44 scenarios without automatic retries on
desktop Chromium, mobile Chromium, and mobile WebKit. Coverage includes legacy Round/probe
practice, lost answer/card acknowledgements, stale rejection followed by failed sync and explicit
recovery, frozen source deletion, current-card privacy, recheck timer opening, card reload/resume,
keyboard activation/focus, plaintext content, mobile overflow, and automated accessibility.
Independent read-only code review found no remaining actionable issues. Local Firefox and manual
assistive-device, independent specialist, and external rollout/readiness gates are not claimed.

This is immediate, accountless practice, not a multi-stage Recovery Trail or paired evidence from a
previous live session. Management retains aggregate checkpoint/attempt counts without a causal or
durable-learning claim. Companion insertion, source-authoring with exact-content citation approval,
and explicit QTI/CSV loss reports remain the next Pack items. Partner-evidence, manual independent
reviews, staging, and production-readiness decisions remain deferred; participant caps are unchanged.

## Recovery Pack QTI/CSV portability — 2026-10-07

Published Pack exports now offer a strict, deterministic preview/report and CSV or QTI checkpoint
downloads alongside the unchanged native JSON content path. The projection contains the original
frozen diagnostic, linked recheck, and optional delayed probe, never an unsaved draft or a latest-
version substitution. The source title, Pack/version identifiers, version number, and canonical
content hash bind each report to its immutable content. QTI archives embed that exact report as
`openround-export-report.json`; either format also has a separately downloadable report.

The loss report distinguishes omitted Pack identity/roles/container context, intervention cards,
citations and private media; Polling Pops-specific QTI extension metadata; and format transformations.
It does not incorrectly label linked-recheck relationships or authored numeric tolerance as absent:
CSV retains links, QTI preserves links in its extension, and QTI encodes tolerance bounds and unit
text. External QTI engines may ignore extensions or round float grading values. Formula-like CSV
cells are protected, while authored leading-apostrophe ambiguity is explicitly reported. Converted
files are checkpoint interchange, not a complete Recovery Pack learning sequence. Native JSON
remains the complete content format, with media references rather than embedded image bytes.
Shared import compatibility also restores CSV formula protection for whitespace/tab prefixes and
QTI predefined/numeric XML text entities without enabling arbitrary entity expansion. Exported
numeric prompts no longer absorb the unit paragraph when reimported; authored choice whitespace and
CR/CRLF text are preserved. Ordered text extraction keeps interleaved CDATA, ordinary text, and
inline markup in document order without decoding CDATA or trimming individual segment boundaries.
Existing XML/archive security limits remain in force.

Export/report endpoints use the existing workspace-authorized creator read boundary, including
viewers and Community deployments. They remain readable after authoring flags/allowlists are
disabled; they do not reuse a Pro CSV-report entitlement. Private/no-store responses and bounded
static findings avoid participant data, media identifiers/URLs, and validation payload leakage.
Unsupported content blocks the whole download with a report rather than silently exporting a
partial file. The browser validates format and all known frozen-source metadata before download,
fences stale previews, preserves explicit retry, and never saves an error response as an artifact.
This increment adds no database migration, new retention clock, learner data, or public access route.

Verification: `CI=true pnpm check` passes formatting, lint, type checks, local tests, smoke support,
and production builds. The local suites include 295 contract, 425 server, 454 web, and 122 database
tests; 62 PostgreSQL tests remain skipped in this run. Production-browser coverage passes across
desktop Chromium, Android Chromium, and mobile WebKit: 44 existing Pack/practice/accessibility
scenarios and, after repairing the new test fixtures, three new portability scenarios in separate
focused runs. The new scenarios cover frozen-source preview/download matching, actual CSV/QTI/JSON
downloads, failure/retry, stale-preview fencing, read-only access, keyboard/focus behavior, axe, and
mobile overflow. Registered-media omission and privacy are covered by server tests. An independent
read-only code review found no remaining actionable issues. These checks do not substitute for
manual assistive-technology review or external-LMS interoperability validation.

Companion insertion and source-authoring with exact-content citation approval remain the next Pack
items. Recovery Trail and Concept Health remain later increments. Partner-evidence decisions,
staging, independent manual reviews, and production/readiness gates remain deferred; public caps
are unchanged.

## Recovery Pack source-assisted authoring — 2026-10-07

The next increment adds source-assisted Pack authoring to the creator library. It reuses the
existing text/PDF/DOCX/PPTX authoring pipeline and a validated ready job, converts one diagnostic /
meaningfully different linked recheck plus a cited source-derived intervention, and creates an
editable unpublished Pack. Conversion makes no additional AI/provider call. Legacy ready outputs
without slide proposals use their cited explanation; longer source slides disclose the Pack card's
2,000-character conversion limit. The source and complete proposal hashes are canonical across
browser, server, and PostgreSQL JSONB. Ordinary Round/Presentation source workflows remain intact.

Source-derived Packs require separate explicit review of saved content and every citation before
publication. Approval binds the complete content hash, saved revision, source digest, and full
source-output hash. Draft edits/restore invalidate it; publication verifies it inside the Pack lock
before immutable-version deduplication. Creator UI shows the full diagnostic, keys, rationales,
cards, recheck, optional probe, and per-item/global citations; no checkbox starts selected. Unsaved
changes disable approval/publication. Human approval is not automated verification of source truth
or pedagogical quality. Manual/legacy Packs retain their existing publication behavior.

Migration 058 stores creator-only source provenance, a bounded original citation catalog, and
idempotent approval receipts under forced workspace RLS and tenant-aware cascades. The original
catalog, not client-supplied excerpts, validates each checkpoint/card citation. Source-job expiry
does not erase retained Pack review evidence; raw source text/file bytes are not copied again.
Account export/delete and Pack retention/cascades include the new records. Review metadata never
enters published content, participant projections, or portable JSON; an import carries content,
not source approval. Existing Pack schemas, public participant caps, and Learning mode are unchanged.
Approval retry receipts are bounded by the existing 30-day mutation-receipt retention; the current
approval binding and original citation catalog remain until the parent Pack is deleted/purged.

Creation and approval use single-flight, stable mutation intents. Exact accepted creation retries
resolve before source expiry/rollout checks, recover the same Pack, and reject same-key changed
intent. Approval retries cannot reapprove a later edit. Saved draft adoption, source selection,
role change, reload, and workspace navigation clear obsolete review actions. Existing drafts,
versions, and review remain readable when creation is paused or the member is a viewer. New writes
stay behind the existing Pack flag and evidence allowlist; newly queued sources still use normal
provider configuration, upload scanning, and quotas. Source-review-aware publishers are required
for rollback once these Packs exist; see the [upgrade runbook](runbooks/upgrade.md).

Verification: the full local `CI=true pnpm check` passes formatting, lint, strict type checks,
unit/support suites, and production builds. Package suites include 297 contract, 445 server,
491 web, and 124 database tests. The default local run skips 64 PostgreSQL tests; a separate fresh,
isolated-schema run passed source conformance, forced-RLS/job-purge/export/delete, and manual Pack
conformance (three tests), then removed only that fixture schema. Twenty source API tests and
30 focused web tests cover validation and retry boundaries. Independent read-only review found
and verified repair of an uncited Add card path, with no remaining actionable issue.

The source workflow passes production-browser checks on desktop Chromium, Android Chromium,
and mobile WebKit (three scenarios) with the actual API/worker and a test-owned loopback provider.
It covers source submission, deterministic conversion, explicit save/review/approval, separate
publish, lost creation/approval acknowledgements, dirty invalidation, added cards, viewer/paused
reads, keyboard/focus, automated axe checks, and mobile overflow. That pass exposed and repaired
missing route-local translation loading and duplicate inner landmarks. The existing CI beta job
opts into this fixture; no new job or duplicate suite was added. To run it locally:

```bash
BETA_E2E_AUTHORING=true PLAYWRIGHT_PRODUCTION=true pnpm test:e2e:beta \
  tests/beta-e2e/recovery-pack-source-authoring.spec.ts
```

All 43 existing Pack browser scenarios also pass across those three projects, covering authoring,
Round/Presentation insertion/update/undo, live cards and control recovery, accountless practice,
and portability. The legacy source/import-to-Round review journey also passes on desktop Chromium
(47 browser scenarios in total across the focused runs). The full repository check was rerun after
the translation/accessibility fixes and passes. Local automation does not substitute for independent manual assistive-technology
or physical-device review. Firefox was not rerun locally; the existing CI browser project includes
it, but this checkpoint does not claim local Firefox verification.

Companion Pack insertion remains the next Pack workflow increment. Recovery Trail and Concept
Health remain later capabilities. Partner-evidence decisions, staging, independent manual reviews,
and production/readiness gates remain deferred.

Follow-up review hardening — 2026-10-08: a temporary Pack Save/Reload busy state no longer discards
an already accepted source-job response. It still blocks new submissions, but in-flight responses
are fenced by current edit permission, source generation, and component lifetime instead. Accepted
jobs remain visible and resume polling without another quota-consuming submission.
The full repository check and five production-browser source scenarios pass, including real
Save/Reload races that prove one accepted job/provider call/quota increment and continued polling.

## Access/resilience provisional slice

An Access/resilience implementation slice is complete in the repository provisionally, without
claiming that Phase 1's branch-selection gate passed. Gated whole-room flex mode is available for
new Rounds and Presentations in allowlisted workspaces when `FEATURE_LIVE_FLEX_MODE` is enabled. It has no
response countdown or deadline, lets the facilitator close questions, and gives no speed bonus.
The time mode is frozen at creation and disabling the gate preserves existing rooms. The
design-partner timing/connectivity and accessibility evidence required to select and roll out this
branch remains pending; private 1.5×/2× passes remain deferred.

## Recent merged feature checkpoint — 2026-10-04

| Change                                 | Implemented on `main`                                                                                                                                                                                     | Compatibility and remaining boundary                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Presentation text contract (PR #66–67) | One title plus up to seven text boxes, stable element IDs, nine snap regions, ordering, inspector and keyboard editing, shared editor/preview/facilitator/participant rendering                           | Content v2 is used for new drafts and mutations. Deterministic read upcasting preserves v1 title/body, media, notes, citations, and layout style across drafts, history, published versions, and browser recovery; no database migration is needed for the content upcast.                                                        |
| Bounded slide geometry (PR #68)        | Drag movement, corner resizing, fractional percentage inspector controls, grid/safe-margin/alignment guides, six starter arrangements, and image-space reservation                                        | Optional v2 frames stay inside a 16:9 canvas. Narrow screens use reading order. Images remain preset-managed; rotation, shapes, detailed font styling, and a full freeform design canvas remain deferred. The existing Presentation beta gate is unchanged.                                                                       |
| Permanent deletion (PR #69)            | Owner-only per-item/bulk deletion for archived Rounds and Presentations, confirmation, cleanup of authoring/history/metadata references, and owner session-history deletion for finished or expired rooms | Retained sessions and practice/follow-up dependencies block source deletion. Presentation deletion disconnects room clients and fences background report writes. Migration 048 preserves assignment dependencies and cleans polymorphic Library links; media objects follow orphan retention rather than immediate blob deletion. |

PR #69's eight CI checks passed on `0eb4e7d6174457d42c7394de32ea07a30ed4e81f`, including
PostgreSQL migration/deletion coverage and browser smoke. The slide acceptance suite covers saving,
publishing, preview, and live delivery. These source checks establish repository behavior; they do
not establish a deployed migration, manual assistive-technology acceptance, target-host capacity,
or independent security/privacy review. See the [upgrade runbook](runbooks/upgrade.md) before rollout.

## Phase 0 research Prototype Lab

The repository now includes an allowlisted, browser-memory-only research lab for the three Phase 0
concept tests: Companion, deterministic Question Health, and a delayed concept-matched probe. It
reuses the existing Recovery Rehearsal deployment flag plus workspace allowlist, is unavailable for
archived Rounds, reads an authenticated draft or immutable published snapshot, and performs no
prototype mutation or persistence request.

The Companion model constructs a participant-safe projection from an explicit field list and keeps
its join/result overlays synthetic. Question Health produces versioned advisory findings with
content-sensitive stable IDs and independently records usefulness and intended outcome. The
delayed-probe screen requires a meaningfully different prompt plus an overlapping normalized
concept key, while still requiring independent human equivalence review. Its download reconstructs
a versioned aggregate-only record containing bounded enums, counts, rule/version identifiers, and
duration buckets; it excludes source content, identifiers, aliases, URLs, credentials, and free
text. A dedicated evaluation template defines the corresponding consent, coding, review, and
redaction protocol.

Automated projection, determinism, invalidation, concept-separator, partial-denominator,
redaction, route-access, keyboard, participation, and responsive-build checks verify the software
boundary. These checks do not make a real question flag useful, demonstrate a context-switch
problem, validate a delayed probe, select a roadmap branch, or close any release-readiness gate.

## Professional workspace and interactive Presentation beta

The professional workspace is implemented as an additive, selected-workspace beta. Five independent
workspace ceilings—`FEATURE_WORKSPACE_SHELL`, `FEATURE_BUILDER_V2`, `FEATURE_PRESENTATIONS`,
`FEATURE_GROUPS`, and `FEATURE_DISCOVER`—default off and additionally require the existing
workspace allowlist. New live Presentation creation also requires `FEATURE_PRESENTATION_REALTIME`
and `EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST`. Direct authenticated APIs fail closed outside the
allowlists; disabling creation preserves access to existing sessions and reports.

| Area                      | Repository status                                                                                                                                                                                                                                                                                                                                                                | Deferred or still requiring external evidence                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace                 | Responsive Home, unified Library, Sessions, Assignments, Results, Discover, Groups, Workspace settings, universal search, activity inbox, and an anchored Round/Presentation Create menu                                                                                                                                                                                         | Observed workplace and higher-education navigation studies and production search-index evidence                                                                                         |
| Round Builder v2          | Shared command-bar/map/canvas/inspector/readiness composition, direct structured editing, Recovery pair visualization, bounded Undo/Redo with coalesced typing, revision-fenced autosave, IndexedDB recovery, conflict choices, and aggregate publish blockers                                                                                                                   | Manual assistive-technology and physical tablet/phone verification before default-on                                                                                                    |
| Presentations             | Structured content and interactive blocks, bounded text positioning and resizing, layout guides, nine-region shortcuts, text-box editing, six starter layouts, source/slide proposals, independent Round-question copies with remapped IDs, immutable versions, live delivery, reconnect, scoring, Recovery phases, timeline, reports, and content-only “not assessed” treatment | Self-paced Presentation assignment, full freeform design canvas, rotation, shapes, detailed font styling, PPTX export, and synchronized source questions remain explicitly out of scope |
| Collaboration and catalog | Facilitator Groups support membership, artifact curation, discussion, scheduling, and Round assignment; Discover is first-party/workspace-approved only                                                                                                                                                                                                                          | Public creator marketplace, commerce, learner social profiles, and real-time coauthoring remain deferred                                                                                |
| Safety and operations     | Draft/content schema upcasters, strict publish validation, exact idempotency replay, media references and seven-day orphan cleanup, RLS/export/deletion/retention coverage, participant-safe projections, atomic Presentation joins/responses/transitions, and independent rollback flags                                                                                        | Single-VM rollback and clean replacement-host restore rehearsal, independent privacy/security/accessibility review, and target-host capacity evidence                                   |

The implementation preserves `/v1/quizzes`, accountless learners, existing live Round sessions,
assignments, and immutable Round versions. Legacy Round mutation routes now require a revision
fence instead of accepting silent last-write-wins content replacement.

## 2026 P0 UX beta implementation

The current branch contains the gated creator workspace, authoring, setup, live host, participant,
report, history, Recovery Rehearsal, and standalone practice-assignment experience plus its
additive contracts and storage. All three beta flags default off; repository presence is not a
launch claim. The global `FEATURE_UX_BETA` ceiling and explicit `UX_BETA_WORKSPACE_ALLOWLIST`
membership resolve per workspace; an empty allowlist fails closed. Session snapshots carry that
result to unauthenticated participant surfaces. Recovery Rehearsal and standalone assignment
creation additionally have independent `FEATURE_RECOVERY_REHEARSAL` and
`FEATURE_PRACTICE_ASSIGNMENTS` kill switches.

| Area                    | Repository status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Still required before beta exit                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Workspace and creation  | Creator-only Rounds, Sessions, Results, Templates, and Workspace destinations preserve `/dashboard`; `/create` supports starter, source, import, and blank starts; six immutable first-party starters instantiate ordinary drafts with fresh Round/question/choice IDs and valid linked rechecks; the gallery keeps all starters available while placing current-segment and all-segment recommendations first, separates load/action errors, and offers an accessible load retry                                                                                                                                                                                                 | Timed unassisted creation trials, starter-content review, and source/import journey evidence                          |
| Authoring and setup     | Stable-ID editor navigation, response-type insertion, progressive diagnostic disclosures, paired rechecks, participant preview, serialized autosave/publish fencing, one-step structural undo, and entitlement-capped Recovery, Friendly competition, and Open discussion recipes are implemented; the gated owner/editor question picker searches private workspace Rounds and appends fresh-ID independent copies, including valid linked rechecks with remapped links, as one undoable structural change                                                                                                                                                                       | Facilitator usability observation, representative source-corpus review, and browser/device accessibility verification |
| Live facilitation       | A transport-neutral command controller and shared phase model gate legal actions across live Socket.IO and in-memory rehearsal adapters; the center stage, evidence-explaining Recovery Compass, phase-aware command bar, room-readiness strip, and separate Participants/Pulse/Q&A/Chat drawer share the resulting view; command acknowledgement timeouts reconcile against authoritative state before retry                                                                                                                                                                                                                                                                     | Observed facilitator action-finding trials, single-VM reconnect/restart evidence, and manual assistive-tech review    |
| Participant response    | All six response types use explicit Submit, required confidence receives focus, authoritative acknowledgement/snapshot state restores a durable receipt, and answering remains independent from the closed interaction tray; join preflight suppresses unnecessary nickname entry without mutating the room; a keyboard-accessible fixed avatar picker persists through reconnect, while omitted legacy/API values receive a deterministic allowlisted fallback                                                                                                                                                                                                                   | First-response usability trials, physical-device/network coverage, and target-VM acknowledgement-latency evidence     |
| History and library     | Tenant-scoped cursor pages for Sessions, Results, and Practice Follow-ups support status/Round/date filters and summary-only DTOs; Round cards expose tenant-scoped last-hosted dates plus an accessible persisted list/grid preference                                                                                                                                                                                                                                                                                                                                                                                                                                           | Production-copy index/latency evidence, responsive/accessibility verification, and result-discovery trials            |
| Standalone practice     | An owner/editor can assign the immutable current published Round version, with conditional rechecks excluded; the reveal-once generic link creates unpaired anonymous attempts, while reveal-once labelled accountless links are one-attempt, hash-only, individually revocable, and entitlement-capped; aggregate progress, timing accommodations, direct expiry purge, purpose-aware participant copy, and desktop/mobile browser coverage are implemented, and disabling creation preserves existing management and completion                                                                                                                                                 | Representative facilitator/learner usability evidence and single-VM expiry/revocation monitoring                      |
| Recovery Story          | The report first viewport explains recovered and unresolved evidence, intervention history, confidence contradictions, sample strength, and next action; accessible text-backed distributions are persisted only at the five-response staff threshold, while exports, retention, and deletion stay in Manage data                                                                                                                                                                                                                                                                                                                                                                 | Observed report-comprehension trials, independent privacy/accessibility review, and report-latency evidence           |
| Recovery Rehearsal      | The read-only in-memory route shares the transport-neutral host command controller, phase model, and components and deterministically supports low participation, split room, and confident misconception scenarios, authored recheck/revote recovery, synthetic labelling, and bounded start/completion telemetry without creating durable session/report/participant/follow-up records                                                                                                                                                                                                                                                                                          | Pilot completion/comprehension evidence and independent verification of the no-persistence boundary                   |
| Secure recovery         | Four-hour-or-session-expiry creator control passes; one active pass per creator/session; atomic replacement, audit, revocation, rate limit, tenant/session scope, and no-store response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Multi-browser/browser-close rehearsal, penetration review, and production revocation monitoring                       |
| Entitlements            | `cohosting` is false on Hosted Free and true on Pro, Team, and Community; only shareable cohost creation is gated, while presenter and creator-resume credentials remain core                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Billing-plan acceptance tests against production configuration and packaging validation                               |
| Evidence privacy        | Additive post-lock staff distributions have a five-response minimum; participant payloads suppress them; multi-select percentages use respondents and numeric distributions contain correct/incorrect totals only; staff/presenter/report participant detail can carry the fixed session avatar, while private-result participant snapshots suppress other participants' avatars                                                                                                                                                                                                                                                                                                  | Independent privacy/accessibility review and observed small-sample comprehension                                      |
| Telemetry               | Bounded creation→publish→room→join→answer/save→lock/insight→intervention/recheck→report/share and rehearsal events; no actor/object/content fields; fail-closed beta ingestion; 30-day raw retention with observable purge counts; bounded Prometheus labels and Grafana funnel panels                                                                                                                                                                                                                                                                                                                                                                                            | Approved notice/legal basis, hosted metrics retention configuration, and allowlisted pilot monitoring                 |
| Compatibility and build | Migrations 014–017 are additive; persisted `quiz`/checkpoint contracts, routes, storage keys, authentication, realtime event names, and versioned records remain compatible; optional `JoinRequest.avatarId`, purpose-aware practice/report DTOs, and participant avatar fields preserve older consumers, while existing state v4 snapshots are deterministically upcast to v5 with missing trust mode defaulted to `learning`; ready Report V2, V3, and V4 can create recovery follow-ups; a CI/local Docker-context guard checks that image builds include every transitive workspace manifest and source tree before install/build, and the corrected web image builds locally | Green clean-host PR/main CI plus production backup/migration/forward-repair rehearsal                                 |

Within the older P0 UX beta slice summarized in this section, no planned repository capability
remains unimplemented. The staged Phase 0 exit is still open: the remaining beta-exit cells above
require observed usability, manual assistive-technology, independent review, hosted performance,
or operational evidence; passing local automation does not close them.

The existing cross-Round question-reuse beta slice is deliberately bounded. Question reuse copies the
selected draft content at that moment; it does not create a synchronized or separately maintained
question bank, and it never mutates the source Round. The copied questions, choices, citations,
media references, and valid linked recheck relationship are then editable independently in the
destination.
The library and detail reads that supply private draft content now return `Cache-Control: private,
no-store` plus legacy `Pragma: no-cache`. The workspace loading indicator is static when the device
requests reduced motion. These changes do not close the beta-exit evidence or release gates above.

The beta Playwright configuration schedules non-mobile scenarios in desktop Chromium and Firefox,
and `@mobile` scenarios at 390×844 in mobile Chromium and WebKit. Axe automation scans the
authenticated dashboard, Home, Library, Sessions, Assignments, Results, Discover, Groups, Activity,
Workspace settings, Create, Templates, Presentation Builder dialogs, Assign Practice, one-time
receipt, and Practice management surfaces on desktop. The mobile matrix additionally scans Assign
Practice, receipt, management, and the accountless participant question state; it checks horizontal
overflow and 44-pixel create, response, and submit targets. This automated coverage is not manual
VoiceOver/NVDA evidence, and clean-host CI remains authoritative for Firefox.

The capacity and production-smoke workflows now run evidence collection and artifact upload on
both successful and failed jobs, retaining available load JSON, server metrics, and applicable
Playwright/test results for 30 days. Failure logs remain failure-only. This makes successful-run
evidence retrievable but does not itself satisfy the hosted capacity or production-readiness
gates.

The release ledger records source CI and local production-path smoke complete from CI, Security,
dependency review, and Production-path smoke evidence incorporated by main commit `7532397`.
Single-VM staging, privacy/legal approval, design-partner observation, manual VoiceOver/NVDA and
physical-device coverage, target-host load/soak, encrypted off-host backup and clean replacement-VM
restore, real-provider source-corpus evaluation, and provider-originated Stripe rehearsal remain
pending. Local automation does not satisfy those thirteen gates.

## Themed Experiences and Audience Interaction

The repository contains the complete single-process product slice and durable schema for Round
Experiences, Audience Pulse, room chat, interaction reporting, privacy lifecycle, and moderation.
Repository presence is not evidence that partner, mixed-load, process-loss, accessibility, or
production-promotion gates have passed.

| Phase                           | Repository status                                                                                                                                                                                                                                                                                                                 | Still required for exit                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 0 — validate interaction design | Six presets, role previews, Pulse controls, dashboard, chat, and moderation workflow are available for testing                                                                                                                                                                                                                    | Three higher-education and three workplace facilitator sessions; five-of-six uncoached success evidence  |
| 1 — safe contracts/storage      | Category/preset contracts, JSON v2/v1 compatibility, game state v4/v3 upgrader, report v3 backward rendering, migrations 011–013 with forced RLS and an atomic finish cutoff, monotonic audience sequence, distributed limits, transactional outbox, and audited rollout switches are implemented                                 | Production-copy migration/rollback rehearsal                                                             |
| 2 — Round Experiences           | Focus, Campus, Studio, Blueprint, Signal, and Spark registry; author/setup previews; frozen session tokens; workspace-brand layering; role surfaces; local contrast/motion/mute; opt-in original Web Audio cues                                                                                                                   | Manual VoiceOver/NVDA, projector/phone, 200% zoom, and visual-regression evidence for every preset       |
| 3 — Audience Pulse              | Four contextual signals, host-only participant projection, five-person public threshold, rolling activity, participant filters, independent audience sync, and at-most-4-Hz public summary notifications                                                                                                                          | Target-VM 250-participant mixed load, Valkey disruption, server restart, and answer-latency evidence     |
| 4 — Live Conversation           | Disabled-by-default chat, plain text, one-level replies, reactions, immutable private aliases, slow/hard limits, presenter feed, pin/remove/report, 5/15/60-minute mute, ban, Q&A integration, sequenced Q&A compatibility events, durable at-least-once fan-out, and passing two-process committed-message/process-loss coverage | Observed moderation rehearsal and hosted mixed-load evidence                                             |
| 5 — Evidence/hardening          | Aggregate report v3, authorized transcript/CSV, formula escaping, account export, session/account cascading deletion, bounded metrics, privacy/data-map updates, and moderation/incident runbooks                                                                                                                                 | Full mixed-load, security, accessibility, retention, backup/restore, and report-under-60-second evidence |
| 6 — partner beta                | Workspace roles, scoped staff credentials, and a validated workspace-UUID rollout allowlist support selected partners                                                                                                                                                                                                             | Six live partners, repeat-use evidence, support observation, and no severe incident                      |
| 7 — production promotion        | Presets, Pulse, and chat have independent startup ceilings and audited runtime kill switches                                                                                                                                                                                                                                      | Controlled production promotion and 30 uninterrupted stable days                                         |

## Differentiated product roadmap

No version tag in this table should be inferred merely from code presence. A phase is releasable
only after its stated product, operational, accessibility, privacy, security, demand, and legal
gates pass.

| Phase                     | Repository status                                                                                                                                                                                                                                                                                                                                                                                                                     | Still required for the phase exit                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — demand validation     | Interview/evidence templates and measurable demand gates are documented                                                                                                                                                                                                                                                                                                                                                               | Six higher-education and six L&D interviews, six accepted pilots, observed prototype completion, and willingness-to-pay evidence                                                                                                        |
| 1 — safe evolution        | Ordered transactional migration ledger, advisory lock, checksums, P0 bootstrap/upgrade, repeated-run/failure tests, state/report schema versions, compact live history, and report-job skeleton                                                                                                                                                                                                                                       | Clean-host CI and production backup/forward-repair rehearsal                                                                                                                                                                            |
| 2 — Signal (`v0.10`)      | Six checkpoint types, canonical versioned responses, legacy `choiceId`, confidence, purposes, concepts, exact-set multi-select, decimal numeric scoring, and editor/player/report compatibility                                                                                                                                                                                                                                       | Design-partner usability and real-device accessibility evidence                                                                                                                                                                         |
| 3 — Recover (`v0.11`)     | Main/linked-recheck/revote rounds, intervention transitions, deterministic explained insight cards, misconception signals, reconnect, process restoration, and private payload projections                                                                                                                                                                                                                                            | Observed facilitator use and target-VM restart/reconnect evidence                                                                                                                                                                       |
| 4 — Evidence (`v0.12`)    | Database-backed report worker, reports V1–V4, confidence matrix, misconceptions, intervention timeline, linked recovery, separate revote evidence, unresolved concepts, JSON/CSV, Q&A summary, private feedback, and gated aggregate Session Decision Replay                                                                                                                                                                          | Six-partner paid beta, report-under-60-second production evidence, and reconciliation monitoring                                                                                                                                        |
| 5 — Collaborate (`v0.13`) | Owner/editor/viewer roles, invitations, workspace switching, revocable cohost/presenter credentials, audited actors, persistent moderated Q&A, replies, votes, realtime updates, limits, and retention                                                                                                                                                                                                                                | Moderation rehearsal, abuse testing, and multi-facilitator partner evidence                                                                                                                                                             |
| 6 — Portable (`v0.14`)    | Folders/tags, bulk/CSV/native JSON/QTI import/export with validation, formula escaping, archive/XML hardening, presenter popout, QR assets, deep links, and allowlisted secure embed                                                                                                                                                                                                                                                  | External QTI corpus interoperability and paying-partner companion-mode validation                                                                                                                                                       |
| 7 — Single-VM GA (`v1.0`) | Product code, remote single-VM Compose profile, and operations runbooks exist; no deployed environment is claimed                                                                                                                                                                                                                                                                                                                     | Successful paid beta plus uninterrupted 30-day reliability, target-host capacity, clean replacement-VM restore, support, accessibility, privacy, billing, legal, and demand gates                                                       |
| 8 — Create (`v1.1`)       | Provider-neutral async assistant, disabled-by-default/BYO configuration, isolated bounded PDF/DOCX/PPTX extraction, grounded citations, rationales/misconceptions, retries, monthly limits, draft-only review, source cleanup, and idempotent apply                                                                                                                                                                                   | Approved hosted provider/model, privacy/DPA/residency review, real corpus quality/cost evaluation, and human-review usability evidence                                                                                                  |
| 9 — Follow Up (`v1.2`)    | Immutable unresolved-concept follow-ups, generic/personal hashed links, one-attempt semantics, resume, timed/flex modes, revocation/close, 1.5×/2× passes, private feedback, and cascading retention/deletion                                                                                                                                                                                                                         | Browser/accessibility matrix, partner use, and production expiry/revocation monitoring                                                                                                                                                  |
| 10 — Institution (`v2.0`) | Operator-only contract/capability policy, permanent workspace-region visibility, generic creator OIDC with explicit issuer/subject linking, LTI 1.3 instructor launch and Deep Linking with one-time state/nonce and public JWKS, LMS registration controls, external-identity retention/deletion, versioned owner audit export, and configurable scheduled audit retention are implemented; K–12 and learner launches remain blocked | Managed hosted SAML/SCIM broker, identified learner model, NRPS/AGS and idempotent grade delivery, real LMS interoperability/certification, institutional pilots, vendor selection, contracts, and independent identity/security review |
| 11 — expansion hardening  | Existing P0 security, accessibility, observability, load, restore, deployment, and runbook foundations apply                                                                                                                                                                                                                                                                                                                          | Independent reviews, institutional pilots, multi-host failover design, regional posture, counsel, and final operator evidence                                                                                                           |

## Original P0 delivery record

| Phase                               | Delivered in this repository                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Remaining implementation or evidence before the exit gate can be claimed                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — risk and definition             | Clean-room rules, original product system, protocol invariants, deterministic scoring tests, and a configurable Socket.IO load harness                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Eight interviews, six recruited design partners, and documented findings                                                                                                                                                    |
| 1 — foundation                      | TypeScript workspace, Compose, CI, magic-link authentication, PostgreSQL migrations plus a one-shot owner-only image command, forced RLS, non-owner runtime role, structured logs, dependency-aware liveness/readiness, a non-secret deployment configuration preflight, fail-fast production transport/email/metrics safeguards, Prometheus metrics including browser event-receipt latency/timeouts, optional OTLP tracing, request correlation, audited database-backed runtime kill switches bounded by startup ceilings, and a provisioned local Prometheus/Grafana profile with 14 versioned, semantically tested alert rules | Production identity/provider configuration, deployed staging, production collectors, alert ownership, paging, and rehearsal evidence                                                                                        |
| 2 — authoring                       | Searchable library, create/edit/rename, autosave, validation, reorder, duplicate, archive/restore, immutable versions, two question types, participant-style whole-quiz preview, and media thumbnail preview; signed quarantine uploads, required alt text, size and magic-byte checks, ClamAV scanning, clean promotion, private delivery, cleanup, and authoring UI                                                                                                                                                                                                                                                               | Timed new-user usability observation and production object-store/scanner monitoring evidence                                                                                                                                |
| 3 — lobby                           | Explicit per-session setup for audience, scoring, result visibility, late joining, and nickname policy; owner-fenced Redis code reservation with a PostgreSQL active-code backstop, copyable prefilled direct links, host/presenter QR, LAN/public join-address selection, same-origin multi-device routing, guest credentials, friendly aliases, capacity, roster, lock/unlock, kick, presenter view, and segment defaults                                                                                                                                                                                                         | Thirty-device physical QR/LAN and hosted-domain test and moderated design-partner observation                                                                                                                               |
| 4 — engine                          | Pure guarded transitions, server receipt time, atomic join/answer micro-batches, durability and idempotency, scoring, reveal, standings, optimized role filtering, snapshots, reconnect, batched bounded Redis sequence replay, the Socket.IO Redis Streams adapter, owner-fenced distributed mutation leases, PostgreSQL compare-and-swap fencing, and passing two-writer tests                                                                                                                                                                                                                                                    | Target-VM 250-client restart/process-loss evidence; multi-host routing and failover remain future gates                                                                                                                     |
| 5 — reports and commercial controls | Summary/question/participant reports, plan-stamped 30/365-day retention, independently expiring live access, Pro-gated UTF-8 CSV, centralized participant/published-quiz/theme entitlements surfaced in the UI, one contrast-validated workspace brand theme copied immutably into new sessions, Stripe Checkout/portal/signature verification, atomic idempotent and order-safe webhook reconciliation, full account export, blob/cache/account/session deletion, support lookup, consent records, and audited actions                                                                                                             | Live Stripe replay, approved policies, and support rehearsal                                                                                                                                                                |
| 6 — hardening and community release | Apache-2.0 distribution, generated notices, SBOM/signing/container-scan workflows, CodeQL and pull-request dependency review, non-root images, enforced nonce-based script CSP and HSTS, core/ClamAV/two-writer Compose profiles, unit/property/API/PostgreSQL/browser/Compose-browser automation, expanded axe coverage for authenticated and live states, two-container process-loss and OTLP smokes, dependency audit, isolated local database/object restore, local 250-player restart and 1,000-player aggregate gates, and operations runbooks                                                                                | Independent security/accessibility review, clean replacement-VM restore, soak, target-host capacity evidence, and signed `v0.9.0` release                                                                                   |
| 7 — Single-VM beta                  | Remote single-VM Compose profile, SSH deployment controls, SLO/RPO/RTO checklist, incident, backup, upgrade, support, observability, staging-readiness, governance, and production-readiness runbooks; tested Alertmanager route and collector templates; a manual remote probe/load/Stripe-replay workflow; a machine-validated release ledger; and redaction-safe evidence templates                                                                                                                                                                                                                                              | Provisioned TLS staging, strict host-key evidence, off-host restore drill, legal approval, six partner onboardings, payment, support rota, owned paging, alert rehearsal, physical-device checks, and ten observed sessions |
| 8 — Single-VM GA                    | Release/rollback automation, operational metric instrumentation, and Free/Pro product surfaces                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Stable 30-day beta measurements without an HA/SLA claim, support and reliability targets, pricing validation, and signed `v1.0.0` release                                                                                   |
| 9 — Regional expansion              | Regional-isolation design remains documented as a future boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Separate multi-host regional stack, code directory, notices/contracts, counsel approval, residency tests, failover evidence, and named pilots                                                                               |

## Historical verified baseline — 2026-09-19

On 2026-09-19, the merged P0 beta baseline passed the clean-host CI, PostgreSQL/multi-writer,
Security, CodeQL, SBOM, feature-off browser, UX-beta Chromium/Firefox/WebKit, and production-path
smoke workflows recorded by the then-current release ledger. The first merged-head browser attempt encountered
an intermittent Next development-output 404; the complete rerun passed, and the follow-up isolates
each sequential Playwright suite’s Next output directory to remove that shared-cache failure mode.
Repository and local-network correctness are not substitutes for the external phase evidence above.

The corresponding package baseline passed 21 contract tests, 18 game-engine tests, 11 Recovery
Rehearsal tests, 128 web tests, 131 server tests, 14 database memory/migration tests, four insight
tests, three experience tests, and three smoke-support tests. The environment-gated multi-writer and
PostgreSQL suites passed independently in clean-host CI through migrations 014–016, including
forced RLS, tenant isolation, exact keyset cursors, last-hosted aggregation, durable history counts,
and session-scoped credential revocation. Local macOS Firefox remains unable to start because its
installed Playwright profile is invalid; the passing Linux clean-host Firefox job is authoritative.

On 2026-09-19, the standalone-practice slice passed the complete `pnpm check` gate: formatting,
Docker workspace-context verification, lint, strict type checks, 349 package tests, three smoke
support tests, and all eight production builds. The default run intentionally skipped the one
multi-writer server test and seven PostgreSQL tests. The full database package separately passed
all 22 tests against a fresh PostgreSQL 17 database through migration 017, including the new
purpose/source constraints, tenant isolation, atomic personal-link cap, progress aggregate, and
standalone retention cascade. A guarded in-memory test seed now provisions only the deterministic
beta workspace as Pro, is rejected outside test mode or with `DATABASE_URL`, and leaves later
workspaces Free. The resulting twelve-test desktop Chromium beta suite passed the immutable-source
assignment, generic and labelled receipt, sharing telemetry, participant completion, aggregate
progress, revocation, closure, and existing recovery journeys. Focused practice accessibility
checks also passed at 390×844 in Chromium and WebKit, including the participant question state.
That journey exposed and led to correction of a React Strict Mode duplicate-start race; a pending
access-scoped attempt token now makes replayed starts converge on one durable attempt.

- `pnpm check`: formatting, a transitive workspace-dependency Docker-context guard, lint, strict
  type checks, package tests, and production builds for all eight workspace packages. The current
  package run has 349 passing tests; seven PostgreSQL tests and one multi-writer test are
  intentionally environment-gated in the default command.
- PostgreSQL integration: one production-like test covering forced RLS, unscoped and
  cross-workspace denial, media isolation/deletion, enriched account export, atomic billing event
  ordering, consent, immutable versions, audited operational-feature persistence, PostgreSQL
  session-version fencing with transactional rollback, and migrations.
- The release server image's owner-only `node dist/migrate.js` command completed against the local
  PostgreSQL profile independently of the long-lived non-owner application process.
- Shared-store multi-writer integration: two independent repositories, caches, and session
  services enforced shared code reservation and completed concurrent joins and answers with exact
  scores; owner-fenced lease expiry, duplicate host/answer retries, a stale command race,
  first-writer shutdown, contiguous replay, and report reconciliation all passed against
  PostgreSQL and Valkey.
- Two-container Compose smoke: twelve clients split across independent API/realtime processes,
  received and acknowledged cross-process events with Prometheus receipt samples, preserved
  idempotency, produced one applied and one fenced stale command, then completed and reconciled the
  game through the secondary after the primary stopped.
- Playwright covers feature-off and allowlisted beta journeys in desktop Chromium and Firefox plus
  mobile Chromium and WebKit. The merged clean-host matrix passed; manual assistive-technology and
  physical-device coverage remain separate release gates.
- `pnpm smoke:compose`: authentication and consent through account deletion across Caddy,
  PostgreSQL, Valkey, MinIO, Mailpit, ClamAV, server, and web. The run verifies audited runtime
  pause/resume, upload CORS, quarantine, clean scanning and promotion, invalid-signature rejection,
  session-scoped media, durable answer idempotency, report reconciliation, complete export, blob
  deletion, and cache invalidation.
- Compose Chromium: one real-browser LAN journey through workspace theming, direct upload, scan,
  preview/publish, session setup, QR/direct-link verification, guest join, private image delivery,
  durable answer/reveal, browser receipt acknowledgements, and object deletion.
- The remote-readiness probe passed against the local production Compose route, validating active
  PostgreSQL and Valkey readiness, expected public feature flags, disabled public metrics, and the
  nonce-based browser security policy. This validates the probe, not a remote single-VM deployment.
- Compose 100-client scripted restart game: 100 accepted durable answers, zero duplicate score
  effects, no open-question answer-key leak, complete reconnect replay, idempotent host/answer
  retries after API/realtime restart, and exact report reconciliation. The latest local run measured
  join p95 79 ms, answer acknowledgement p95/p99 26/26 ms, question broadcast p95 18 ms, service
  restart recovery 887 ms, reconnect snapshot 8 ms, and report availability 15 ms. These figures
  pass the configured P0 thresholds on this machine only; they are not a hosted-environment SLO
  claim.
- Compose 250-client scripted restart game: all 250 answers were durable and reconciled after
  restart, with complete replay and no duplicate score or answer-key leak. The passing local run
  measured join p95 155 ms, answer acknowledgement p95/p99 61/61 ms, question broadcast p95
  64 ms, restart recovery 835 ms, reconnect 16 ms, and report availability 20 ms.
- Compose Presentation profiles: the final local 50-client run reconciled 100/100 answers with
  acknowledgement p95/p99 107/107 ms and client-receipt p95 33 ms. The 250-client run cleared and
  restarted Valkey, restarted the server, recovered all 250 participants, reconciled 500/500
  answers with no duplicate score effect or pre-reveal correctness/standing leak, and measured join
  p95 156 ms, acknowledgement p95/p99 243/250 ms, client-receipt p95 66 ms, restart recovery
  1.04 s, coordination recovery 1.12 s, and report availability 642 ms. These are disposable local
  correctness/performance checks, not target-region capacity evidence.
- Compose 1,000-client aggregate game: ten 100-client lobbies were admitted with a 750 ms
  inter-session stagger, all sockets waited at one start barrier, and all ten games then ran
  concurrently. All 1,000 answers and ten reports reconciled with complete replay and no duplicate
  effect or answer-key leak. Worst-session measurements were join p95 72 ms, answer p95/p99
  236/240 ms, broadcast p95 219 ms, reconnect 127 ms, and report availability 255 ms. The generator
  ran inside the Compose network to exclude the host VM's port forwarding from server measurements.
- `pnpm smoke:tracing`: the production server build exported OTLP protobuf to a temporary
  collector and shut down cleanly.
- `pnpm smoke:observability`: Prometheus scraped the private server endpoint, loaded all 14 alert
  rules, and successfully parsed every query from the provisioned Polling Pops Operations dashboard;
  Grafana provisioned its read-only datasource and dashboard without manual setup.
- `promtool test rules`: synthetic failure series caused every alert to fire with its intended
  severity, summary, runbook annotation, and hold period.
- `pnpm smoke:restore`: a nonempty logical backup restored into an isolated PostgreSQL database
  with matching full-row fingerprints across all 19 durable tables; a synthetic private-storage
  object also survived delete/restore with an exact byte match. This is a local mechanics check,
  not an encrypted off-host backup or clean replacement-VM disaster-recovery exercise.
- `pnpm audit --audit-level low`: no known vulnerabilities in the current lockfile.
- Fresh production images: healthy as non-root users; `/metrics` is available inside the server
  container but not through the public Caddy route. Apache-2.0 and generated third-party notices
  are included in each image.

## Known technical differences and incomplete items

- Creator authentication is a local, hashed-token magic-link implementation with PostgreSQL
  persistence, not the Auth.js adapter named in the initial plan. ADR 001 accepts the current
  behavior for P0 and defines federated identity, account linking, institutional SSO, or a separate
  identity service as migration triggers; a library-only rewrite is not an open P0 gate.
- The editor now saves and opens a participant-style whole-quiz preview before publication.
  Hosting opens an explicit setup form seeded from the creator segment; the facilitator can change
  audience, scoring, result visibility, late-join, and nickname policy before any room code exists.
- Hosted Free/Pro participant, publishing, CSV, retention, and brand-theme rules now come from one
  server policy and are reflected by the dashboard, editor, report, and account UI. Pro and
  community workspaces can save one name/two-colour theme; both colours require 4.5:1 white-text
  contrast, and each new session freezes the then-active theme. Stored report deadlines
  intentionally do not shrink after a later plan downgrade.
- Reconnect synchronization returns a role-filtered authoritative snapshot and a bounded,
  contiguous Redis sequence journal. Journal entries currently carry event identity/version data;
  clients use the snapshot as the state recovery mechanism rather than rebuilding historical UI
  state event by event.
- Session mutation queues and hot metadata remain process-local, while every mutation refreshes
  shared state under an owner-fenced Redis lease and every durable write uses PostgreSQL
  compare-and-swap. Two direct-WebSocket writers and process loss now pass locally. The active
  single-VM profile deliberately runs one server container; multi-writer promotion is a future
  multi-host change requiring real load-balancer, shared-service, rolling-kill, and failover evidence.
- Prometheus metrics, browser event-receipt round-trip/timeout telemetry, OTLP export, persisted
  runtime kill switches, correlation headers, a local provisioned dashboard, 14 versioned alert
  rules, severity-route tests, and a validated collector template are wired. Production
  metrics/log/trace backends, secret receiver configuration, a named paging rota, and human alert
  rehearsals are not included as deployment evidence.
- The single-VM files are deployment profiles and runbooks, not proof of a live staging or
  production VM. Fly files are legacy/reference only. The Stripe path likewise requires a
  provider-originated test-mode exercise.
- No local run establishes target-host soak, clean replacement-VM disaster recovery, or
  real-network latency gates. The supplied local capacity and restore results are instrumentation
  evidence, not public-production evidence.
- QR and direct-link joining now support a configured public URL or a facilitator-selected LAN
  origin, and all participant devices may share one room code while receiving independent resume
  credentials. Browser-generated question, command, and answer identifiers use a LAN-HTTP-safe Web
  Crypto path rather than secure-context-only APIs. Physical phone/tablet coverage across
  representative Wi-Fi, managed networks, firewalls, camera scanners, and the final public HTTPS
  domain remains a Phase 3 evidence gate.

## Remaining implementation sequence

1. Complete beta usability and demand evidence: 12 interviews, three higher-education plus three
   workplace partners, at least ten observed sessions, the defined unassisted task-time targets,
   repeat-use measurement, and willingness-to-pay evidence. Then select Access if timing or
   connectivity excludes participants in at least three partner workflows, affects at least 10% of
   observed attempts, or produces a serious accessibility finding. Otherwise select Companion if
   at least four repeat facilitators use an external deck and at least two observed sessions suffer
   a material context-switch interruption. If neither gate passes, use Phase 1 for the largest
   measured activation or correctness failure. Revise the ICP or packaging if the broader gates fail.
2. Add a second human reviewer, activate the prepared `main` ruleset, and pass a normal reviewed
   canary PR without using the pull-request-only break-glass bypass.
3. Provision single-VM staging with pinned SSH host keys and public TLS; configure private
   telemetry/paging and encrypted off-host database/object backups; complete a clean replacement-VM
   restore, target-host soak/capacity, physical-device QR, Stripe, independent
   security/accessibility, privacy, and legal reviews.
4. Evaluate source-grounded authoring against an approved real provider and representative private
   corpus. Record citation accuracy, answer quality, human correction rate, latency, cost, data
   handling, and failure behavior before enabling it in hosted production.
5. Complete the remaining contract-gated institution work. The repository now includes generic
   creator OIDC, instructor LTI launch/Deep Linking, operator policy/registration controls,
   region visibility, and audit export. Still required are managed hosted SAML/SCIM, an approved
   identified-learner model, NRPS/AGS with idempotent grade delivery, LMS certification/interop,
   and institutional pilot verification. K–12 remains disabled pending implementation and counsel.
6. Revisit multi-host regional expansion and any code-to-region directory only after the
   single-VM launch, residency, capacity, reliability, contract, and counsel gates pass.

## Release boundary

Community/self-hosted operation has no application license fee and no billing gate. Infrastructure,
email, domain, monitoring, backup, and support costs remain with the operator. The active hosted
profile is one remote VM and therefore has no high availability or SLA. Public production is not
ready merely because the containers run: TLS, strict SSH host-key pinning, encrypted off-host
backups, a clean replacement-VM restore drill, target-host capacity, and every unchecked human,
legal, security, accessibility, and operational gate above must be evidenced first.
