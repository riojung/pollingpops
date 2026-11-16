# Presentation E12 selected-text assistance

Implementation branch: `codex/presentation-e12-text-assistance`, from merged outline-first
creation baseline `5e0ed16c2aeb69e33d26c9313effe4ba7b6faceb` (PR #205). This slice adds reviewed
rewrite/shorten of one plain native text object. It remains undeployed.

## Creator workflow and content boundary

Select one plain native title/body object and choose **Rewrite text** or **Shorten text**. The
editor drains pending saves before opening the panel. Opening it checks availability but never
generates. The creator explicitly requests a proposal, compares complete original/proposed
wording and original citations, acknowledges unverified claims, then chooses **Apply reviewed
text**. A rewrite must change the wording; a shorten must contain fewer UTF-16 characters.
The title/body limits remain 160/4,000. Formatted rich text is excluded to preserve its structure.

Only the selected plain text, its role and the requested operation enter the approved provider.
Speaker notes, citation excerpts, other objects and live data are excluded. Original citations
and source disclosure remain intact and do not verify new wording. Document15 adds the latest
accepted AI text-edit metadata: exact source/output digests, node identity, role, operation,
provider/model, timestamp and warning. This is the latest edit rather than a complete audit or
a claim that later manual edits are verified. Prior drafts/history retain earlier records.
Participant, private-review and static-export projections omit this creator metadata.

Generation never mutates or publishes a deck. Fresh application changes only the exact saved
plain text object plus its latest-edit record. Other nodes, citations, notes, assets, navigation,
spatial layout and published versions retain their state. Scene6, draft mutation envelopes,
response/scoring contracts and Report V1–V7 retain their meanings.

## Persistence, privacy and cost

Migration102 adds private text-assistance jobs with forced RLS and locked admission/application
guards. Existing outline and text queues share a maximum of two active jobs per workspace and
the current monthly authoring ledger. Request identity cannot be reused across those queues.
Exact creation recovery precedes fresh source validation, so a lost acknowledgement can recover
its original job after later target changes. Fresh admission/application checks current creator
authority, source availability, exact node/role/text digest and saved revision. Arbitrary node IDs
retain case; UUID identities retain canonical matching. There is no fallback to another node.

An exact accepted application receipt recovers before later job expiry or source changes, while
new applications require a current ready proposal. Transactional draft fences prevent race-time
overwrites. The browser saves exact request/application identities before mutation, scoped to
the actor, workspace and deck; assistance recovery contains no original/proposed text. Unknown
outcomes remain recoverable. Reloading the exact target permits a new review only if its role
and original text remain unchanged. A fresh current-tab Apply supports safe Undo/Redo; historical
receipt recovery preserves later edits, and page reload resets normal local undo history.

The approved `AUTHORING_AI_*` configuration is reused. Bounds are 2,048 output tokens, 64KiB
response bytes, a 45-second provider deadline, three claims and 24-hour private review retention.
Raw pending input clears on completion; a ready private proposal retains original/proposed text
for comparison until expiry or source erasure. Current actor/source checks fence reads, worker
completion and Apply. Existing account export/erasure covers the new private jobs. Compact
admission receipts retain quota accounting without text. No paid provider, service, dependency
or commercial allowance is added. AI remains optional for ordinary editing and delivery.

## Verification

- Focused contracts, persistence, provider/API, privacy projections, editor/client and recovery
  checks, typing and lint pass. The explicit document15 projection regression omits latest-edit
  metadata, original citations and source disclosure from recipient/review/export content.
- All **43 selected real PostgreSQL cases pass**, including ten new text-assistance cases, nine
  outline, six creation, eight review, four insights, three spatial and three shared/legacy cases.
  Run `dd442e4a04` applies all 102 migrations twice, verifies checksum ledgers, restricted runtime
  access and all 65 legacy raw SQL rejection probes. Migrations001–101 retain their exact bytes.
  New coverage exercises cross-queue capacity/quota races, SQL shape/source guards, creator
  authority and erasure, exact recovery, claims/completion fencing, atomic application rollback
  and accepted receipt recovery after expiry/source changes. A mixed document15 publication
  includes scene6 composition/groups/connectors, local/broadcast reveals, internal navigation,
  sections/spatial layout, poll/ranking/open-text/word-cloud and scored single-select responses.
  Uppercase block/question/choice UUIDs retain acknowledgement and optimized snapshot responses;
  opinions retain zero/null scoring and scored responses retain correctness. This exposed and
  fixed a runtime response-matching version list. Private result:
  `/tmp/pollingpops-e12-text-pg/result-dd442e4a04.json`. The owned container, SSH forward and lock
  are removed, no OOM occurred and all fourteen existing containers retain their states. The
  new suite is included in the existing restricted PostgreSQL CI step.
- All **24 production-browser journeys pass across four profiles**: Chromium/Firefox desktop
  and Chromium/WebKit mobile. The existing outline review and outline-first creation journeys
  remain green. New journeys exercise exact lost-create/lost-Apply acknowledgement recovery
  across reloads, one admitted job per generation, byte-identical application retries, complete
  original/proposed/citation review, stale revision rebasing, rejection of changed exact text,
  current-tab Undo/Redo, preserved unrelated remote edits and unchanged publication. Provider
  assertions confirm 2,048 tokens and selected-text-only prompts; session recovery excludes
  original/proposed wording. Axe and strict 320px overflow checks pass. Each profile has a fresh
  non-watching in-memory API fixture with existing rate limits enabled; the same freshly built
  final production web bundle is reused. Representative desktop/mobile captures were inspected.
  Refusal coverage also proves ordinary manual editing, save, reload and Discard remain available
  after exhausted preflight or explicit admission429. Invalid-record coverage additionally checks
  safe saved-deck reloading, retained protection after a failed read and preservation of newer
  committed text. Private matrix:
  `/tmp/pollingpops-e12-text-browser/invalid-recovery-final-matrix-result.json`. Owned
  API/web/provider listeners are stopped and Firefox fixture directories are removed.
- The browser spec passes scoped strict TypeScript, ESLint and formatting. The initial full
  **`VITEST_MAX_WORKERS=1 pnpm check` passed** before the review correction below: formatting,
  Docker workspace context, lint and
  typecheck (17 tasks each), package tests, smoke support, production builds and admin CLI build.
  Passing totals include 925 contracts, 575 database, 1,381 server, 2,782 web and 354 smoke-support
  tests. Normal opt-in skips remain; real PostgreSQL qualification is separate above. Private
  full-check log: `/tmp/pollingpops-e12-text-check.log`. Source is ready for review and remains
  undeployed.

The real server-entrypoint journey exposed a missing in-process worker registration. The text
worker now runs in both supported jobs modes with the existing bounded interval and shared
authoring pause control. Recovery also exercises canonical UUID block matching while preserving
case-sensitive node identity; lowercase recovered block IDs must still find uppercase saved UUIDs.

## Review correction: rejected generation recovery

Fresh requests now persist their identity before preflight without claiming that a POST is
outstanding. Immediately before sending creation, they durably mark that uncertainty. A failed
fresh preflight or conclusive admission refusal clears the pending editor lock and permits
explicit Discard, including after reload. Known admission refusals include rate/quota rejection
and the explicit provider-disabled response; transport failures and ambiguous dependency errors
retain exact recovery.

A later refusal never clears an earlier unacknowledged POST. The original identity remains
recoverable even when a subsequent job read returns 404, capacity is unavailable or a retry gets
an HTTP 429 response. Uncertain Apply receipts retain their existing protection. The recovery
format and server, database, quota and publication behavior are unchanged.

All **28 focused controller/review tests** and the full **2,808-test web suite** pass, plus web
typecheck, scoped ESLint, strict browser-spec TypeScript and formatting. The fresh production web
build and all **24 browser journeys** above pass with the corrected controller. New browser
coverage checks both exhausted preflight and an admission response with HTTP 429, then closes
the modal, saves ordinary manual text, reloads and explicitly discards the refused request. Both
mobile engines exercise the normal drawer controls after the saved recovery UI loads. Private
web-suite log: `/tmp/pollingpops-pr206-invalid-final-web-tests.log`. Server, contracts and database
code were unchanged by these client corrections; the initial whole-repository and PostgreSQL evidence above
remains the baseline for those packages.

## GitHub review correction: invalid recovery records

An unreadable or stale saved text request now offers **Reload saved deck and clear invalid
recovery** after an explicit warning and acknowledgement that its edit may already have been
applied. The action performs an uncached, validated read of the current saved deck before
clearing only the affected actor/deck/tab storage key. Failed reads, storage failures and account
or permission changes keep the protection and permit retry. A valid request found during this
process is restored instead of removed.

The normal reset adopts the current saved draft and preserves local recovery copies. When other
valid receipts are pending, it preserves their working draft and exact operation identity while
recording the observed server revision as a save fence. Those recovery controls become reachable
after the invalid text record is cleared; an older save acknowledgement cannot authorize a stale
follow-up write. Visual-import modal resumption waits for current preparation barriers so its
recovery cannot trap focus ahead of invalid-text recovery.

All **68 focused recovery/editor tests**, all **2,808 web tests**, web typing and changed-file lint
pass. A fresh production build and all **24 browser journeys** pass across the four desktop/mobile
profiles above. The browser regression covers malformed and stale formats, a failed saved-deck
read, retention of a newer committed text edit, ordinary manual save after clearing, reload
without the invalid record and preservation of unrelated storage. Strict browser-spec typing,
ESLint, formatting and diff checks pass. Owned browser/API/provider listeners are stopped and
Firefox fixture directories are removed.
This correction changes no server, database, quota, document or scene contract.

## Rollout and remaining scope

Disable HTTP AI admission during a mixed-version upgrade, apply migration102 and deploy matching
HTTP, dedicated jobs, web, history/publication and live readers before re-enabling the provider.
Fence document15 writes until that reader floor is satisfied; disabled admission still permits
application of already-ready proposals. Reload active editor assets before reopening writers.
Document15-capable rollback binaries must retain the applied migration and metadata; do not
strip fields or rewrite immutable versions. See the
[upgrade runbook](../runbooks/upgrade.md#selected-text-assistance-and-document15).

Translation review, layout/question suggestions, rich-text rewriting, conversational editing
and generated media remain later E12 work. Self-paced attempts and richer portability remain
separately scoped. Hosted rollout, real-provider cost/quality, physical-device/manual
accessibility and measured creator acceptance remain separate from local software checks.
