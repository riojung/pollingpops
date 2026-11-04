# Presentation E04 first family: opinion polls and rankings

Date: November 4, 2026. Branch: `codex/presentation-e04-opinion-formats`.
Base: `7ca31e1`, following merged E03/PR 194.

The first-family software scope implements multiple-selection opinion polls and full/top-N
rankings in Presentations. Automated verification passed as recorded below. Verification used
the local working tree, not a hosted deployment.
This record does not mark the full E04 epic complete. Moderated open text and word clouds remain
the next family, and no physical-device, observed screen-sharing, managed-browser, sustained-load,
cost or competitive-parity result is claimed.

## Implemented scope

- The Presentation builder enables poll **Maximum selections** and ranking **Choices to rank**,
  bounds them to available choices and clamps limits when a choice is removed. Compatible type
  changes preserve choice IDs/labels and clear incompatible correctness/recovery settings.
  Opinion controls remain unscored, confidence-free and unlinked from recovery questions.
- Independent copies from retained published Round versions support these two formats with fresh
  destination IDs and frozen limits. Eligible standalone published-question live insertion uses
  the existing source, phase, revision and receipt fences. Text opinions remain rejected.
- Actual new-format writes opt into embedded Presentation v9. Later editing/design/history/copy
  paths retain v9; API v2, native blank v7/scene3, template v8/scene4 and mutation-envelope v2
  defaults are unchanged. Previously valid content, immutable hashes and legacy response intents
  are preserved rather than silently reinterpreted.
- Multiple-selection polls submit unordered `choiceIds`; rankings submit `orderedChoiceIds` in
  priority order. Ranking order participates in idempotency identity. Accepted new-format rows
  use response storage v2, null correctness and zero participant score. A changed order under an
  accepted key conflicts without changing the original receipt.
- Current-block anonymous `opinionSummary` appears only after close/reveal on host, participant,
  stage and Companion views. Poll percentages use accepted respondents. Ranking first-place
  weight is the total choice count, decreasing by position; unranked choices contribute zero.
  These weights are not participant scores, accuracy or recovery evidence.
- Presentation Report V4 retains anonymous choice evidence and requires the explicit
  `includeOpinionResults=true` read option. The web report downloads quoted, formula-safe CSV
  evidence. V1–V3 behavior remains available for reports without new-format evidence.
- Migration `091_presentation_opinion_formats.sql` checks new document/response writes against
  frozen v9 content and introduces the response storage version. It does not rewrite historical
  content, JSON hashes or media references. See the [coordinated rollout/rollback boundary](../runbooks/upgrade.md#presentation-opinion-formats-compatibility).

## Verification

| Check                                                     | Status | Executed evidence                                                                                      |
| --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| Full repository check and production builds               | PASS   | Final `pnpm check`, including all builds and admin help                                                |
| Contracts and memory/DB conformance                       | PASS   | 634 contract tests; shared opinion and legacy persistence checks                                       |
| Restricted PostgreSQL 17 and migration 091                | PASS   | 91 migrations/checksums twice; 65 rejected invalid writes; ten selected PG tests                       |
| Backend response, projection, report and copy regressions | PASS   | 70 final focused tests; four authoring API tests                                                       |
| Production opinion-format workflows                       | PASS   | Final eight cases across all four profiles, no failures/skips                                          |
| Layout, keyboard, CSV and automated accessibility         | PASS   | Stage intersection/QR checks, mobile table scrolling, light/dark participant Axe and real CSV download |
| Independent source review and fixture cleanup             | PASS   | Findings resolved; owned PG and browser resources removed                                              |

The new browser specification is
`tests/beta-e2e/presentation-opinion-formats.spec.ts`: two desktop/mobile workflows, eight selected
cases across Chromium/Firefox desktop and Chromium/WebKit phone emulation. Its Round-copy source
fixture uses `BETA_E2E_ROUND_PROTOCOL=true` only for the isolated beta API. This does not change
the local application's Live Round writer setting. The eight-case run exercised the production
web build at the browser milestone. Later SQL and response-validation corrections were verified
separately as noted below; static compilation is separate from the browser pass.

### Repository checks and test boundaries

The final `pnpm check` passed after the last SQL correction: formatting, Docker-context dependency
checks, lint, type checking, unit/integration suites, production builds and the administrator
build/help command. Local log: `/tmp/pollingpops-e04-final-check.log`. Principal suite totals:

| Suite     | Passed | Default-run skips |
| --------- | -----: | ----------------: |
| Contracts |    634 |                 0 |
| Web       |  2,326 |                 0 |
| Server    |  1,078 |                15 |
| DB        |    511 |               346 |
| Support   |    354 |                 1 |

Other workspace suites passed too. Default DB skips are separate from the ten real PostgreSQL
cases below; this record does not claim that every skipped DB case was executed. Package tests
were first run with `pnpm exec turbo run test --concurrency=1` to avoid cross-package CPU
contention, with original assertions and deadlines. The final full check reused valid Turbo
results. Serial-suite log: `/tmp/pollingpops-e04-final-tests.log`.

Early checks found stale expectations for future document v9, newly supported poll/ranking
catalog entries and the report's explicit opinion-results query flag. Tests now use future v10,
retain document-v2–v8/text rejection, assert safe new-format metadata/insertion, and preserve old
report rendering/Quick Check attribution. An unchanged aggregate Round export/revocation case
crossed its five-second deadline during a parallel run; it passed unchanged in isolation and in
the serialized suite. No threshold was increased for it.

One support fixture intentionally creates a mode-0755 directory. An initial logging wrapper's
process umask changed that to 0700, causing the fixture's expected rejection to fail. The wrapper
was corrected to create only its log with mode 0600 while retaining the normal process umask.
The fixture and application permission checks were unchanged; all 354 support tests then passed.

### Executed PostgreSQL checks

An owned PostgreSQL 17 tmpfs fixture applied all 91 migrations twice and compared both checksum
ledgers exactly. Its runtime role was `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEROLE`, `NOCREATEDB`,
without owner or unexpected role membership; Presentation tables retained forced RLS. The
verifier exercised v9 draft/publication/retry/history/restore, immutable hashes, legacy response
codecs and v2–v8 scored questions whose purpose metadata says opinion.

Sixty-five direct-write probes rejected invalid document versions, mismatched versions, response
shapes, mismatched question IDs, duplicate choices, scoring and confidence. Poll, full ranking and top-N ranking persisted
and recovered correctly, including uppercase authored poll/ranking UUIDs against canonical
PostgreSQL identifiers. The selected PostgreSQL suite passed **10 tests**, with **118 filtered
skips**, including the original baseline upgrade fixture, shared Presentation conformance,
published-question catalog guards, Q&A/stage isolation, and v7/v8 history/media behavior.

Local evidence: `/tmp/pollingpops-e04-pg/result-8c9453ce1e.json` and
`/tmp/pollingpops-e04-pg/migration-result-8c9453ce1e.json`. The run took 17.34 seconds; the test
portion took 8.23 seconds. Its owned container and SSH forward were removed and verified absent,
with no OOM and all fourteen preexisting container identities/states unchanged. This tmpfs run
checks the baseline fixture's assertions and cleanup but does not reproduce CI fsync latency.

### Browser checks and corrections

The initial Chromium smoke passed the complete authoring/reveal/report flow and found an actual
server import guard still rejecting supported Round copies. The route now uses the explicit
Presentation allowlist, retains deterministic copy/receipt/source fences and promotes new formats
to v9. Four authoring API tests verified the correction. Visual review also found compressed
ranking columns; bounded horizontal tables now retain readable headers and choice labels.

A seven-file production matrix selected **50 cases**, finishing **45 passed and five failed**
in 8.4 minutes. All 42 existing Presentation regression cases passed. Four new copy/retry cases
reached result reveal and failed a positional test expectation: ranking results intentionally sort
by weight. The corrected assertion checks exact weights and labels by copied choice ID and checks
descending result order separately. The fifth failure exposed mobile WebKit document overflow;
explicit shrinkable canvas grid tracks contain the wide table without clipping the document.

Visual inspection then found repeated choices pushing stage results below the visible canvas.
The revealed opinion stage now shows the prompt and compact results first, with authorized media
and authored explanation afterward. A subsequent **16-case run passed eleven and failed five**
in 3.9 minutes. All eight delivery/privacy/fallback cases passed after this layout change. Its
four remaining copy/retry failures exposed a legacy zero-point result object at finish; both full
and targeted E04 participant projections now keep `responseResult:null` through reveal,
intervention and finish, retaining receipts and summaries. Legacy single polls, ratings and
purpose-tagged diagnostic questions retain their prior behavior. The last failure showed WebKit
could not horizontally scroll the focused table with native arrow keys; the table now explicitly
handles unmodified Left/Right Arrow on the scroll group itself.

After those corrections, the final production run passed **8/8**, with no failures or skips in
2.8 minutes: both new-format workflows on desktop Chromium/Firefox and emulated mobile
Chromium/WebKit. It verifies authoring and document promotion, immutable source/session copies,
full/top-N keyboard rankings, poll bounds, delayed/lost acknowledgements, exact receipts and order
conflicts, reveal privacy, frozen limits, all four role projections, V4 opt-in, and real CSV output.
Stage assertions require a fully visible ranking header and first choice without prior vertical
scroll, plus a fully visible join panel/QR. Wide tables retain readable columns and keyboard
horizontal scrolling. Participant Axe runs cover dark poll results and light ranking results;
these are automated checks, not manual assistive-technology qualification.

Local logs: `/tmp/pollingpops-e04-browser-smoke.log`,
`/tmp/pollingpops-e04-browser-matrix.log`, `/tmp/pollingpops-e04-browser-final.log`, and
`/tmp/pollingpops-e04-browser-opinion-final.log`. The final artifacts under `test-results-beta/`
contain host/stage/participant ranking captures and V4 report captures. The earlier broad matrix
was not repeated wholesale after the focused corrections; this record preserves the actual
invocations and source boundaries rather than claiming a single 50/50 run.

Each cross-browser run used fresh task-owned Firefox application-data/temp directories. Cleanup
verified their removal after checking ownership and excluding symlinks; recursive ACL removal
was limited to those owned directories. Actual `HOME` and personal browser profiles were unchanged.
The successful final result is `/tmp/pollingpops-e04-browser-opinion-final-result.json`.

### Compatibility review

Independent read-only review found and verified fixes for legacy opinion-purpose scoring and
confidence, UUID case comparisons in SQL and public projections, exact E04 document version
checks, logical UUID uniqueness in new-format contracts, and retained revealed explanations.
Final focused review cleared the E04 result guards, keyboard scrolling and canvas constraints.
Sampled desktop host/stage and mobile participant/stage/report captures were reviewed for readable
labels, visible data and contained scrolling; this is visual inspection of browser emulation.
Final SQL review also closed a direct-write bypass: the trigger now identifies the frozen block
before validating its question ID, so a mismatched ID cannot bypass new opinion checks. Raw PG
regressions cover both current-block and fallback lookups for polls and rankings. The PostgreSQL
fixture above was rerun after that correction, and focused review cleared the change.

Legacy v1–v8 meaning, old request hashes and V1–V3 reports are preserved; new UUID comparisons
project authored IDs without rewriting frozen JSON or stored hashes.

## Scoped existing CI fixture correction

The E03 PostgreSQL CI job's unrelated original-baseline upgrade fixture completed its functional
assertions in about 2.296 seconds, then crossed its five-second test deadline during cleanup. The
database log showed a forced checkpoint lasting 4.340 seconds, including 4.049 seconds of fsync.
The existing migration/privilege assertions and runtime settings remain unchanged; that single
fixture now has a bounded 15-second budget for database creation, upgrade and cleanup. This is
not a global timeout increase or evidence of a migration assertion regression. Final re-execution
results are recorded in the PostgreSQL verification row above.

## Remaining boundary

Moderated open text and word clouds, their moderation/private-projection/report requirements and
per-format end-to-end acceptance remain later E04 work. This increment does not change E03's
outstanding manual/device qualifications or establish broader presentation, import/export or
pricing parity. Preserve normal feature/workspace policy and require compatible readers and
writers before enabling the new stored meanings.

## Requested review follow-up

The requested review identified a P2 error-path issue: a multiple-selection poll with valid
`choiceIds` plus `numericValue` or `ratingValue` reached repository validation and returned an
internal error. The response policy now rejects those incompatible fields before persistence,
returning HTTP 422 or realtime `VALIDATION_ERROR`. Legacy single-choice poll behavior and request
hashes remain unchanged.

A real REST/socket regression sends numeric, rating and combined extras, verifies that acceptance,
responses, event sequence, revision, timeline and receipts remain unchanged, then saves valid
choices with the same key. The related opinion, policy, validation and realtime suites passed
**47/47** tests across four files. Server typecheck, scoped ESLint and Prettier passed; the original
reviewer confirmed the finding resolved. Local test log:
`/tmp/pollingpops-e04-review-fix-tests.log`.

The full-repository, PostgreSQL and production-browser results above precede this validator-only
follow-up; those broader checks were not repeated for it. Persistence and browser code are
unchanged by this follow-up.

## PR 195 review follow-up

The in-memory repository now derives E04 response map keys from the frozen block identity for
acceptance, compatibility saves and reads. Alternate UUID casing with a fresh key cannot create
a second response; canonical storage IDs preserve the original response payload and request hash.
Shared poll/ranking conformance checks cover alternate-case retries, one-answer enforcement,
compatibility saves, both lookup spellings and reconnect receipt recovery. The 26 focused DB
tests, DB typecheck, scoped lint and formatting passed.

V4 report reads now honor the Quick Check opt-in independently of opinion-results opt-in. Without
`includeQuickChecks=true`, the compatibility projection strips `sessionOnly` while retaining V4
and its opinion evidence. Missing opinion opt-in still returns 422. The REST matrix covers pending
and ready reports under all eight opinion/Quick Check/session-context flag combinations and
verifies unchanged stored/canonical payloads and hashes. All 28 focused server tests, server
typecheck, scoped lint and formatting passed. Independent review cleared both fixes.

The original PR's cancelled Chromium mobile job exhausted its 25-minute budget downloading
Playwright OS dependencies; no browser tests ran in that job. Its aggregate gate failed because
core was cancelled. No product or test threshold change was made for that infrastructure failure.

## Deployment boundary

This record covers local implementation and validation. No hosted or local Docker application was redeployed, and
no application feature flags, customer entitlements or plan prices were changed. Existing live
creation policies remain in force. Deploy migration 091 and matching API/job/web readers and
writers together before accepting document-v9 opinion writes. No paid service or new dependency
was added for this increment.
