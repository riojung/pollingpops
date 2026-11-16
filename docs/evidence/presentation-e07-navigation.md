# Presentation E07 sections and navigation

Implementation branch: `codex/presentation-e07-navigation`, based on merged E06
`0ba6175bd8c00ae78e23ed4ec0257376cf71cfba`
([PR #198](https://github.com/riojung/pollingpops/pull/198)). Source implementation and local
verification are complete. The increment is included in `codex/presentation-interactions-sharing`
and remains undeployed.

## Behavior and compatibility

The Builder adds named sections and a section selector for the selected block. Numbered block
order remains the ordinary path. Sections allow draft names/empty groups for editing; publication
requires complete names, removes hidden members and drops empty groups. Duplicate/remove,
history, design, Undo/Redo and pending-save recovery preserve valid memberships and the version
floor. Visual imports replacing a sectioned empty starter transfer its membership to the inserted
visual/reading slides. Existing exact pending mutation envelopes are never rewritten.

Opt-in Presentation document12 accepts the existing scene versions and response formats. Ordinary
creation defaults, prior document JSON, immutable hashes and legacy receipt fingerprints remain
unchanged. Migration095 admits the new version, adds durable optional navigation state/timeline
metadata and protects raw writes. It rejects ambiguous case-folded UUIDs, dangling/duplicate
memberships, lost or regressed progress, altered saved windows/cards and invalid navigation
receipts. Live insertion can add blocks while preserving prior block JSON/order and sections.
Old session navigation state stays SQL NULL. V12 response matching treats UUID spelling
semantically and projects authored IDs without rewriting frozen content.

The host and Companion expose an accessible private map, public block titles, section labels,
current/visited/not-visited states and server-derived target availability. Jumps reference a
stable frozen block UUID. The first detour anchors the current block, or the first block from
the lobby; further jumps retain that original anchor. Return restores the saved phase or starts
an unvisited anchor normally. Revisited activities remain closed with the same response window,
roster, score and intervention. Next follows numbered order and restores visited phases.

Open activities require explicit close/reveal first. Started diagnostic/recheck pairs must finish
before leaving. Direct recheck jumps and entering an unstarted pair's middle are denied; return
to a saved closed recheck is allowed. Skipping never creates responses, points or completion.
Host/Companion commands share durable receipts, revision fencing and reconnect state. A pending
navigation command is retained per role/session in sessionStorage without credentials; retry uses
its original ID/revision/action/target and the current credential. A late receipt cannot overwrite
a newer cohost cursor.

Participant/stage projections contain no navigation map, section membership or saved progress.
Private notes, hidden slides and unrevealed answer material retain their existing protection.
Local reveal panels remain screen-local and independent of shared navigation.

Finished document12 sessions produce ReportV6 with an explicit `includeNavigation=true` opt-in.
Text, opinion and Quick Check opt-ins remain independent. The report and CSV distinguish presented
and skipped blocks, with jump/return counts and jump/return/revisit timeline events. Skipped
questions have no assessment accuracy/correctness, response, score or result summary. ReportV1–V5
and their timeline enums remain unchanged.

The implementation reuses the existing editor, renderer, command transport, transaction lock and
report worker. It adds no paid API, AI call, per-view job, new service or commercial entitlement.
Low customer pricing remains a product constraint; operating-cost measurements are still needed.

## Executed verification

- Focused server checks passed **56 tests** across navigation, visual import, response validation,
  opinion formats and moderated text. Navigation includes real scored responses, exact retries,
  hidden/private-field exclusion, sectioned imports, return anchors and closed rechecks. The later
  standalone navigation suite passed **5 tests**, including a content-only detour with skipped
  slides and no standings. Competition/projection regressions passed **21 tests** and keep closed
  scores visible across backward navigation while excluding skipped activities from completion.
- Focused authoring checks passed **118 tests** across Builder/state/design files. Live UI/report/
  transport checks passed **124 tests**, including exact retry after a newer cohost snapshot.
  These suites overlap with later full checks; counts must not be summed as distinct coverage.
- Focused contracts/database suites and package typechecks passed. The compatibility sweep found
  and corrected a document12 import adapter omission and positional competition assumptions.
- Restricted PostgreSQL 17 run **`c6244ff1c6` passed all 64 selected cases**: four new E07 cases plus
  sixty E06/legacy URL, response/concurrency and repository checks. All **95 migrations and exact
  checksum-ledger checks passed twice**, using a restricted non-superuser/NOBYPASSRLS runtime with
  forced RLS. Tests cover section publication/history, immutable hashes, actual responses/scores,
  CAS races, exact receipts, reconnect, saved windows/cards, rechecks and additive insertion.
  The baseline verifier preserved an immutable v9 hash and rejected 65 raw legacy mutations.
  Owned container/SSH forward/lock cleanup passed, all fourteen original containers retained their
  state and no OOM occurred. Tmpfs checks correctness rather than production fsync latency.
  Private evidence: `/tmp/pollingpops-e07-pg/result-c6244ff1c6.json` and its corresponding migration
  and verification files. An earlier run exposed two test-fixture mistakes, corrected before the
  passing run.
- **Four production browser cases passed**, with no failure or skip, across desktop Chromium and
  Firefox plus mobile Chromium and WebKit (**77.01 seconds** including build/fixture/cleanup).
  The production Next app and real local in-memory API exercised section authoring/publication,
  host/Companion navigation, lost accepted acknowledgements, reconnect/reload, a newer cohost
  cursor, exact retry, return, linked rechecks, actual participant responses and retained scores.
  Audience HTTP/socket privacy, keyboard, focus, reduced motion, Axe, overflow and report/CSV
  download checks passed. Unit tests separately validate V6 CSV contents and formula escaping.
  All six captures were inspected: two host maps, two reports and two narrow Companion dialogs.
  Visual QA led to a scoped report-card typography correction before the passing final run.
  Earlier runs corrected two ambiguous test selectors; no server defect was exposed.
  Owned Firefox/temp data was removed, task ports 13407/14407 were free and actual `HOME` unchanged.
  Private evidence: `/tmp/pollingpops-e07-navigation-browser-visual-final-eeadead49591/result.json`
  and `test-results/`. These are emulated browser profiles, not physical phones; the scoped
  accepted-ACK loss/connection-close simulation is not a WAN or soak test. PostgreSQL durability
  is covered separately above.
- **`VITEST_MAX_WORKERS=1 pnpm check` passed**, covering formatting, Docker-context checks, lint,
  all package typechecks/tests, smoke-support tests, production builds and the admin CLI. Principal
  totals: contracts **892**, database **524**, server **1,169**, web **2,480** and smoke-support
  **354** passed. Opt-in integration tests remain skipped in the default task; the selected
  PostgreSQL checks above ran separately. Initial full runs caught a new regression test's closure
  narrowing error and five old assertions treating v12 as future/unsupported. The narrowing was
  fixed; compatibility tests now explicitly accept v12 while rejecting v13. All **53 focused
  compatibility tests** and the final full pipeline pass. Private full log:
  `/tmp/pollingpops-e07-check-verified.log`.

## Rollout and acceptance boundary

Apply migration095 and deploy compatible document12/report6 readers, writers and web assets before
accepting new sections/navigation. See the [rollout and rollback instructions](../runbooks/upgrade.md#presentation-sections-and-navigation-compatibility).
This work changes no running feature policy and performs no deployment.

E07 implements live section navigation. Image hotspots, scene-internal target actions,
answer-based branches and broadcast reveals remain later E06 increments. Private sharing and
self-paced attempts remain E08. Automated browser and PostgreSQL checks do not establish physical
device, manual screen-reader/zoom, hosted capacity, pricing or competitor-parity acceptance.
