# Presentation E04 second family: moderated text

Implementation is complete on `codex/presentation-e04-moderated-text`, based on
`de42ce24d7bd047929720fd1b79bb148a982685f` (merged [PR #195](https://github.com/riojung/pollingpops/pull/195)).
Repository, restricted PostgreSQL and the selected browser coverage passed. This second-family
source increment is prepared for pull-request review and has not been deployed.

The second E04 family delivers moderated open text and word clouds across authoring, published
Round copying, live insertion/delivery, private host moderation, approved public results and
report/CSV evidence. Document v10, response storage v3, Report V5 and migration 092 express new
meanings without rewriting old documents, reports, hashes or response intents.

Text is unscored and confidence-free. Accepted bodies remain private and pending until the host
approves them. Removal erases the body and is terminal. Public results need actual reveal and
five approved respondents; participant, stage and Companion credentials never authorize private
moderation. Ordinary snapshots, acknowledgements and raw account exports exclude bodies.
Moderation increments sequence without changing host revision or the response deadline, so a
participant's in-flight response keeps its original revision and idempotency key.

## Verification

- Focused CSV tests passed (4), including V5 approved text/cloud alongside opinion evidence,
  rectangular CSV shape, multiline/quoted/formula-like values and unchanged V4 columns.
- Realtime controller tests passed (38), including exact text intent replay after reconnect and
  a newer event sequence.
- `pnpm check` passed: formatting, Docker workspace-dependency checks, all package lint/types,
  tests, production builds and the admin CLI build. Principal passing totals were contracts
  **641**, database **514**, server **1,097** and web **2,390**. The ordinary DB run reported 351
  skips and server 15 skips; selected real PostgreSQL paths were checked separately below.
  Protected local log: `/tmp/pollingpops-e04-text-check.log`.
- Disposable PostgreSQL 17 run **`c2030e7dd0` passed all 16 selected cases**; 117 other cases were
  filtered out. All **92 migrations and checksum-ledger checks passed twice**. The restricted
  runtime had no superuser, RLS bypass, owner membership or role/database creation. Forced RLS
  includes moderation receipts. The run retained v9 artifact/history/hash behavior and passed
  **65 existing raw SQL guards**, plus the new text guard and concurrency cases.
- New PostgreSQL cases cover NFC/UTF-16/control bounds, account-export privacy, clearing the
  private body column, actor cleanup, cross-kind command IDs and competing-version moderation
  races, submission with the unchanged launch revision, reveal/finish after moderation,
  ordinary concurrent response writes, first-text promotion racing two raw joins at 250, and
  credential/session expiry across a held parent lock. Both formats recovered receipts after
  removal/finish and cascaded private state on deletion.
- The owned tmpfs PG container and SSH forward were removed; all fourteen pre-existing
  containers retained their state, with no OOM. Total fixture time was **16.55 seconds**.
  Local results: `/tmp/pollingpops-e04-text-pg/result-c2030e7dd0.json` and
  `migration-result-c2030e7dd0.json`. Permanent cases live in `packages/db/test/postgres.test.ts`
  and `packages/db/test/support/presentation-text-conformance.ts`. Tmpfs does not measure
  CI/production fsync latency.
- **48 unique production browser cases passed across documented slices**, twelve per desktop
  Chromium/Firefox and emulated mobile Chromium/WebKit profile. Coverage is 18 desktop legacy
  cases, 18 mobile legacy cases, four new authoring/copy cases and eight new live-text cases.
  This is combined coverage, not a single uninterrupted 48-case invocation. The aggregate
  `/tmp/pollingpops-e04-text-browser-coverage.json` records each passing title/profile and its log.
- The final live-text recheck passed **8/8** with no failures or skips in **214.33 seconds**,
  including exact moderation sequence/count assertions, lost acknowledgements, public threshold
  removal and late reads, credential isolation, explanation visibility and full stage
  header/first-row/QR intersection. The authoring/layout slice passed **8/8** in **158.17 seconds**;
  four of those are the distinct authoring cases. Mobile legacy passed **18/18** in **193.74 seconds**.
  Logs/results use `/tmp/pollingpops-e04-text-browser-{live-explanations-final,text-final-layout,mobile-legacy-final}.{log,json}`.
- Firefox used fresh task-owned application-data/temp directories. Each owned tree was removed
  and verified absent, including its generated macOS delete ACLs; personal `HOME` and browser
  profiles were unchanged. No actual local/hosted app flag was changed.

## Verification corrections

Read-only integration review caught UUID casing in moderation acknowledgements, post-lock
expiry classification, raw join/promotion fencing and JSON body smuggling through legacy rows.
Tests cover these cases. Actual SQL execution found a PL/pgSQL `CASE` delimiter in the capacity
guard; it now uses a branch-assigned limit. PostgreSQL reveal/finish tests also found the old
timeline fence missing the moderation counter. Migration 092 replaces that function with the
same expiry/import/offset behavior plus the new counter; older migration bytes are unchanged.

The initial browser fixture expected `200` for an existing `202 Accepted` duplicate response;
its status assertion was corrected while retaining receipt checks. Production preview testing
then exposed a missing text locale domain and low label contrast. Scoped route/style fixes and
preview tests using production-loaded messages cover both. The authoring fixture also waits
for the native slide and theme to be durably saved before reload.

Firefox fixtures now use isolated profile-matched stage/Companion contexts with real scoped
passes, avoiding a popup-resize hang. Response markers are unique per workflow so legitimate
approved reports from earlier profiles cannot trip pending-body privacy assertions. The delayed
submission fixture holds every socket retry and REST fallback until release; a slower Firefox
retry had previously escaped the first-frame-only hold. Whole-account privacy, exact sequence,
response-count, threshold and role assertions were retained.

WebKit mobile found one pixel of cloud-row clipping. Compact-stage cloud padding/gaps were
reduced while preserving font sizes and other views; full row/header/QR assertions now pass.
The stage also retains the server-authorized explanation below text results/media, with explicit
hidden-before-reveal and visible-after-reveal checks in both formats on all four profiles.

The host queue now mounts only when full frozen content contains text questions. A host-only
optional capability preserves that availability after advance, refresh and live insertion;
ordinary rooms omit it and make no moderation queue reads. Tests cover the API scopes and the
legacy host's network behavior. Two existing five-second tests timed out in a parallel run,
then all 21 tests in those files passed with the same limits and one worker. The final
repository check uses the configured `VITEST_MAX_WORKERS=1` mode; no timeout or assertion changed.

## Requested review follow-up

The requested review found a malformed-response validation regression: a truthy primitive
reached an `in` check after failed parsing, producing a 500 and an error log containing the
submitted string. The route now narrows the value to a non-null object before that check,
throws the existing sanitized validation error for other malformed envelopes, and reuses the
successful parse result. Generic malformed envelopes retain 400; malformed text objects retain 422. No response, receipt or room state is created by either rejection.

Two new parameterized regressions reproduced the original 500, then passed after the fix.
They cover modern and legacy envelopes for both text formats, including primitive, falsy,
array, null and empty-object values; actual request error logging stays empty, sensitive text
is absent from replies, and a valid submission with the same key succeeds. Focused tests passed
**38/38**; the full server suite passed **1,099 tests** with 15 existing skips using
`VITEST_MAX_WORKERS=1`, plus server typecheck, production build, scoped lint and formatting.
Protected log: `/tmp/pollingpops-e04-review-response-validation.log`.

## Acceptance boundary

No new service or paid dependency is required. Fixed room/input/page/receipt bounds constrain
work, but no measured customer price, operational cost target, competitor parity or manual
device/accessibility acceptance is claimed. No running deployment or real app flag was changed.
The [coordinated rollout](../runbooks/upgrade.md#presentation-moderated-text-compatibility)
remains necessary before accepting v10 writes. Software verification does not close hosted
rollout, physical-device, manual screen-reader/zoom, target-capacity latency, cost or competitor
parity gates.
