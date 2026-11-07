# Reviewed AI discussion suggestions

Branch: `codex/presentation-question-suggestions`, from merged Question starters baseline
`d5eb0c8` (PR #209). This bounded E12 increment remains undeployed and independent of the
layout alternatives in PR #207.

## Creator workflow and cost

On an eligible visible native slide, choose **Suggest discussion questions**. The editor saves
the exact selected source before opening review. Creators see the complete source and current
shared AI allowance before choosing **Generate discussion suggestions**. Opening the panel or
reviewing a result never starts a generation. One generation uses one existing authoring job;
review and insertion use no further allowance.

The provider proposes exactly two distinct English questions: one discussion and one reflection.
Creators review both complete prompts, settings and exact source excerpts, select one and
explicitly confirm review before **Insert reviewed question**. The resulting independent
open-text question is an opinion with confidence off, zero points, no correct answer and no
linked recheck. Generation alone leaves the deck unchanged. Normal editing remains available
after insertion; publication is always separate.

The source is the exact visible title and one to eight body text objects, with at most 4,000
total body characters. Rich-text wording, list structure, node identities, languages and reading
order are bound to its digest. Images, charts/tables, closed interaction details, notes and
earlier import/AI metadata are excluded. The provider receives only the title, ordered body
locator/text pairs and requested English output; no participant/session data or private source
identities enter its prompt. Each suggestion must cite at least one exact body excerpt. Citations
prove copying from authored wording; they do not verify that wording or the generated framing.

Free local **Question starters** and manual question creation remain available. This increment
does not generate scored assessments, correct answers, factual explanations, rechecks, other
question formats, media or whole-deck conversational changes.

## Persistence and recovery

Migration104 adds a private bounded question-suggestion queue. It shares the existing monthly
authoring admission ledger and combined two-active-job limit with outline and selected-text
assistance. Memory and PostgreSQL admission, including raw SQL guards, must agree. The queue
uses the approved `AUTHORING_AI_*` endpoint/configuration, 2,048 output tokens, 64KiB response
bytes, a 45-second provider deadline, three claims and 24-hour private review retention. No new
provider, service, dependency, entitlement, document/scene version or commercial allowance is
introduced. Migrations001–103 and legacy canonical request/proposal bytes remain unchanged.

Admission captures the authoritative saved source under the draft transaction. Exact retries
recover the same job before checking a later source. Insertion first recovers an accepted
mutation receipt; a fresh insertion checks the exact proposal, source, current authority and
revision again under lock. Deterministic IDs, fixed immediate-after-source placement, section
inheritance and spatial reconciliation preserve unrelated blocks and source metadata. One fresh
acknowledgement creates one ordinary Undo step. Historical acknowledgement recovery does not
fabricate history across later work.

Account/deck-bound browser recovery stores only identities, digests and exact mutation requests,
not source text or prompts. A lost creation acknowledgement recovers by the original job ID;
an uncertain insertion retries the same bytes. Pending receipts fence competing edits. A
source-preserving explicit reload may advance the revision; wording, language, list or order
changes require a new review. Resuming a closed proposal drains intervening manual saves first;
a pending insertion instead recovers its exact receipt before any ordinary save. Malformed recovery can be cleared only after checking the current
saved deck while preserving other pending receipts and local recovery. Immediate authentication
changes fence late responses before the parent adopts a draft.

Ready suggestions retain private full source and generated wording for review until expiry or
source/actor erasure. Inserted questions use existing private block citations and truthful AI
provider/model disclosure. Participant, private-review and PDF/PNG/HTML export projections omit
this context. Existing published versions and running sessions retain their frozen content.

## Verification

Focused qualification passes: 38 contracts tests across the new source/proposal/block boundaries
and legacy digest contracts, 26 local-starter/source-byte checks, 52 controller/modal tests,
68 parent/editor integration tests, 27 API/provider/runtime cases and four projection privacy
cases. These groups include existing regressions and overlap the final repository totals.
Checks cover canonical Unicode/control-character boundaries, exact source wording/language/
list/order, expired receipt recovery, malformed/coexisting browser records, current authority,
closed-modal pending reads, pre-adoption identity/draft/revision/receipt validation, fresh-only Undo
and private recipient/export projections. Malformed provider UTF-16 is rejected without changing
valid Unicode source fingerprints or proposal hashes.

**56 selected real PostgreSQL cases pass** across eight suites on owned isolated PG17. All 104
migrations apply twice; checksums for migrations001–103 match baseline `d5eb0c8`. The restricted
runtime principal has no superuser, RLS bypass, database creation, role creation or owner-role
membership. Forced RLS includes all three assistance queues. Shared monthly/active admission,
canonical JSONB proposals, raw source/request/proposal spoofing, future-dated raw admission,
role loss, expiry, erasure and exact accepted receipts are exercised alongside the earlier
artifact/live/report/review/spatial contracts. All 65 legacy raw SQL rejection probes pass.
Run `65383adaaf` removed its owned container, forward and lock without OOM and left all fourteen
original container states unchanged. Private result:
`/tmp/pollingpops-question-suggestions-pg/result-65383adaaf.json`.

**66 production-browser workflows pass** on the final production build across Chromium/Firefox
desktop and Chromium/WebKit mobile: 16 new suggestion workflows, 24 existing outline/text
workflows, eight translation workflows and 18 local-starter/design/spatial workflows. Fresh
memory APIs keep each batch's unchanged authoring rate budget independent. New cases cover
explicit allowance/source review, exact provider boundaries, both full prompts, one selected
unscored insertion, Undo/Redo/reload, frozen publication, live open-text response, exact lost
creation/insertion replies, invalid output with free manual/local authoring, and manual edits
saved before resuming a stale proposal. Axe and strict horizontal overflow checks pass at 320px;
review captures were visually checked. Browser strict types, scoped lint/format and CI wiring
checks pass. The new CI batch runs after earlier failures without changing the job's failure
status. Private matrix: `/tmp/pollingpops-question-suggestions-browser/final-matrix-result.json`.

**`VITEST_MAX_WORKERS=1 pnpm check` passes** in 293.3 seconds, including formatting,
Docker workspace checks, lint, strict types, package/support tests, production builds and the
admin CLI build. Passing totals include **958 contracts, 584 database, 1,419 server, 2,946 web
and 354 repository-support tests**. Normal opt-in PostgreSQL/Redis skips remain; the separate
real PostgreSQL qualification is recorded above. Private mode600 log:
`/tmp/pollingpops-question-suggestions/full-check.log`.

The first full attempt hit the existing five-second PNG/JPEG/WebP normalization test timeout.
That converter suite then passed all 51 cases in isolation, and the unchanged full check
passed on rerun. No test or runtime limit was raised. The first log is retained privately as
`/tmp/pollingpops-question-suggestions/full-check-first.log`. Owned browser/API/provider
listeners and Firefox fixture directories are cleaned up.

Local provider fixtures establish protocol behavior; they do not measure real-provider
question quality or independent creator task acceptance.

See the [upgrade instructions](../runbooks/upgrade.md#reviewed-ai-discussion-suggestions).
Hosted rollout, physical-device/manual accessibility, real-provider quality, usability and
operating-cost qualification remain separate from local software checks.
