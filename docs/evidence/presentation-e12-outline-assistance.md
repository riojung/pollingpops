# Presentation E12 outline assistance

Implementation branch: `codex/presentation-e12-outline`, from merged E11 baseline
`778fad8331dc80d1e18426c36a4fa8b00563bb2c` (PR #203). This is the first bounded E12
software slice. Source is implemented and verified on this branch and remains undeployed.

## Selected workflow

An authorized owner/editor opens **Outline to slides** from the saved Presentation editor,
names an outline, supplies 50–12,000 characters and requests 3–8 text slides. The panel shows the
existing shared authoring allowance before submission. Generation produces a proposal; the
creator reviews each slide and its complete exact source excerpts, chooses slides and explicitly
confirms the review before insertion. Inserted slides use editable native title/body objects in
the existing deck. Publication remains an explicit author action.

Every proposal states that generated claims are unverified. The server checks that citation
locators and exact excerpts belong to the submitted outline; this does not establish that the
generated wording is factually supported. Only the explicit outline, source name and requested
count enter the provider request. Existing speaker notes, source evidence, participant responses,
session data and reports are excluded.

This slice covers outline proposals and insertion into an existing saved deck. Rewrite/shorten,
translation, suggested layouts, question suggestions, conversational editing, generated media
and creation of another deck directly from an apply request remain later E12 work.

## Cost, persistence and recovery

Migration100 adds separate Presentation assistance jobs and compact shared authoring admission
receipts. Legacy `AuthoringDraft` v1 output/hashes, source-job lists and worker claims retain their
contracts. The new and existing authoring paths share the current monthly allowance and workspace
admission lock. Job kinds have distinct receipt identities. Compact admission metadata survives
job/deck deletion and private-data expiry through the billing month, preventing retention cleanup
from resetting the allowance.

The operator-approved `AUTHORING_AI_*` endpoint/model is reused. Ordinary editing needs no
provider. A request is bounded to 12,000 outline characters, 4,096 output tokens, a 128KiB response,
a 45-second provider deadline, two active jobs per workspace and three claims per job. Current
owner/editor authority, workspace/source access, expiry, attempt and lease tokens fence work.
Ready or terminal jobs erase raw outlines; private proposals expire after 24 hours. Expiry and
account/source lifecycle handling erase retained source/proposal bodies. No new dependency,
service, commercial entitlement or Presentation document/scene version is introduced.

Stable request identity and a complete normalized intent hash deduplicate creation before
allowance checks. Changed input under the same identity conflicts. Selected insertion binds the
proposal hash, selected IDs, target, revision, anchor and review intent to an existing durable
Presentation mutation receipt. The source is checked inside the save transaction; accepted exact
retries recover before a later source-expiry check. A stale draft is preserved for explicit
reload/review. Reload returns its revision and surviving insertion anchor together from the
refreshed deck, including a null anchor for an empty deck. A remotely deleted selection cannot
leave the next insertion pointing to a removed slide. Generation failure never changes a deck.

The client retains actor/deck-bound request identities, selections, exact apply JSON and compact
hashes in per-tab recovery; it does not persist the pasted outline or generated slide copy.
Uncertain acknowledgements recover the original job/apply rather than minting another request.
Current permission/account changes fence late responses. The modal drains pending saves before
opening, blocks competing local mutations, and restores focus after closing.

## Verification

- **Focused checks pass:** 59 contract/legacy source-hash tests, 58 Memory/migration/legacy DB
  tests, 37 server/provider/worker-runtime/legacy authoring tests and 34 UI/controller/Builder
  tests. Package typing, focused lint and formatting pass. Contracts normalize new UUIDs without
  changing legacy hashes; API regressions cover case-equivalent requests, complete intent,
  current authority, unverified source evidence, malformed output, provider failure, stale
  revisions and exact insertion receipt recovery after later edits and erased proposals.
  Four Builder reload integration regressions cover retained/deleted anchors, empty refreshed
  decks and failed reads. Deleted-anchor and empty-deck cases reproduce the review finding
  before the fix and pass with the refreshed revision/anchor pair.
- **Twenty-five selected real PostgreSQL cases pass:** seven E12, eight E11, four E09, three
  E10, the shared Presentation repository conformance case and two legacy authoring claim/quota
  cases. Run `93862d6d32` applies all 100 migrations twice, verifies the checksum ledger and
  preserves migrations001–099 byte for byte. All 65 legacy raw SQL rejection probes pass.
  Runtime access is restricted, with forced RLS on both new tables. Identity checks temporarily
  scope access to explicitly named actors and restore it on success or SQL failure; the active-
  author integrity helper rejects other workspace scopes. Existing identity policies and immutable
  publication privileges remain intact. The owned container, SSH forward and lock are removed,
  OOM is false and all fourteen original containers retain their states. There were 192 unselected
  integration skips. Private result: `/tmp/pollingpops-e12-outline-pg/result-93862d6d32.json`.
- **Four production browser profiles pass:** Chromium/Firefox desktop and Chromium/WebKit mobile.
  They verify lost-create acknowledgement/reload without another job, reviewed subset selection,
  exact lost-insert acknowledgement recovery without duplicate slides, unchanged publication,
  private-note exclusion from prompts, bounded provider tokens, terminal invalid-evidence failure,
  stale-draft protection, successful insertion after exactly one saved-deck reload following
  remote anchor deletion, and normal native text editing/save/reload. Axe and strict 320px overflow
  checks pass; captures were inspected. Each profile uses a fresh API fixture so the existing
  endpoint job-rate limit remains active. Retries reuse the unchanged current production UI
  bundle with the final API source. Private matrix result:
  `/tmp/pollingpops-e12-outline-browser/anchor-fix-final-matrix-result.json`; per-profile logs and captures
  share that private directory.
- The browser spec passes scoped strict TypeScript and ESLint checks. Owned web/API/provider
  listeners are stopped, Firefox temporary directories are removed, and authentication caches
  are private and removed by existing teardown.
- **The full `VITEST_MAX_WORKERS=1 pnpm check` passes:** formatting, Docker workspace context,
  lint/typecheck (17 tasks each), package tests, smoke support, ten production build tasks and
  the admin CLI build. Principal passing totals are 917 contracts, 562 database, 1,333 server,
  2,704 web and 354 smoke-support tests. Normal opt-in database skips remain; the twenty-five
  real PostgreSQL cases above were qualified separately. Private log:
  `/tmp/pollingpops-e12-outline-anchor-fix-check.log`.
- The seven-case assistance PostgreSQL suite is included in the existing PostgreSQL CI job.
  Final source scope is 42 files, with no dependency, package manifest or lockfile change and
  only migration100 added. Historical migrations001–099 retain their exact bytes. Source
  is ready for review and remains undeployed.

## Rollout

For a mixed-version upgrade, set `AUTHORING_AI_MODE=disabled` across HTTP instances before
deploying the new admission readers/writers. Worker pause controls alone do not stop HTTP
admission. Apply migration100, upgrade HTTP and dedicated worker runtimes, then re-enable the
approved provider after every admission path counts the shared ledger. Retain migration100 and
compact receipts during rollback; pause new assistance work and legacy AI admission before using
older runtimes. Existing approved endpoint/model and data-policy controls continue to apply.
Model/provider identity must fit the existing provenance metadata limits.

Hosted rollout, real-provider cost/quality qualification, physical devices, manual assistive
technology and observed creator acceptance remain separate from local software verification.
