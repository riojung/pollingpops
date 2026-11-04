# Presentation E01 acceptance record

Date: November 4, 2026. Base: `dee8dce` after PR 185. Branch:
`codex/presentation-e01-completion`.

This increment completes the E01 implementation: visual slide hiding, linked-question filmstrip
safeguards and durable ordinary-save recovery. It adds no SDK, model call, hosted service, SQL
migration or subscription entitlement. E02 design quality and reusable information components
remain separate work.

## Behavior and compatibility

- **Hide slide** adds only `hidden: true` to content slides and promotes the document to v6.
  **Show slide** removes the flag without downgrading the document. Activities reject hiding.
  Draft validation still validates hidden content; Undo/Redo, duplication and history retain it.
- `preparePresentationPublication` removes hidden content before preview, validation and media
  admission. All-hidden drafts are editable but cannot publish. Visible IDs/order remain intact;
  published content rejects hidden flags. Existing immutable sessions/reports never change when
  a draft slide is shown again. Hidden draft/history images remain retained and private.
- Document v6 accepts scene v1/v2 without changing either format. Legacy JSON/hashes, the default
  document v2 and mutation envelope v2 remain intact. v6 sessions use strict content admission.
  Readers must precede writers; see the [upgrade boundary](../runbooks/upgrade.md#presentation-slide-visibility-and-save-recovery-compatibility).
- Moves cannot place a linked recheck before its source. Deleting its source makes an orphan
  standalone; copying a recheck creates an independent standalone activity. Original IDs and
  frozen Pack baselines remain unchanged.
- The ordinary-save coordinator persists an immutable envelope before transmission. Bounded
  transport retries, manual Retry and refresh replay the same body, key and original revision.
  An accepted receipt settles before a newer draft is sent. Definitive rejection allows a
  corrected request; unknown outcomes remain pending. Historical receipts cannot overwrite a
  newer server draft. Divergent local recovery offers preview, download and duplication rather
  than an implicit overwrite.

## E01 acceptance coverage

| Requirement                                                               | Verification surfaces                                                                                                             |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Versioned scene, stable IDs, bounded geometry/payloads, legacy adaptation | Contract scene/adapter/rich-text/hidden-slide suites; artifact-schema readers; earlier native acceptance                          |
| Rich text, bullets, links and sanitized paste                             | Rich-text unit/renderer suites and four-browser authoring/delivery journey; unsupported clipboard regression                      |
| Multiple images, shapes and connectors                                    | Native editor/API suites; memory/PostgreSQL scene media lifecycle; existing native browser journeys                               |
| Selection, multiselection, move/resize, numeric and keyboard editing      | Direct-editing unit and browser journeys, canceled gestures and Undo/Redo; semantic mobile column                                 |
| New, duplicate, reorder, hide/show and remove                             | Existing native journeys plus E01 completion journey; independent IDs, hidden retention, all-hidden readiness, immutable delivery |
| Valid question/recheck topology                                           | Builder unit cases, desktop filmstrip journey, Pack API/conformance cases                                                         |
| Autosave, Undo/Redo, uncertain retry and refresh                          | Retained-save coordinator tests; browser acknowledgement-loss and persisted-receipt journeys                                      |
| Conflict review preserves unsaved work                                    | Browser divergent-recovery preview/download/duplicate, historical-receipt/newer-remote and two-tab revision conflict journeys     |
| Memory/PostgreSQL agreement and private media retention                   | Shared repository conformance; real restricted-role v6 media lifecycle, retry, restore, export and cleanup                        |
| Immutable publication and old sessions                                    | Publication/API/DB regressions, visible-index error mapping, strict v6 reader, old fixture/hash checks                            |

Earlier evidence: [content-only](presentation-content-only.md), [native scenes](presentation-native-scenes.md),
[direct editing](presentation-direct-editing.md) and [rich text](presentation-rich-text.md).
Those records preserve their original execution counts; the completion checks below use the
current combined implementation.

## Executed verification

- Contracts: 562 tests passed, including 19 visibility cases and unchanged legacy/hash fixtures.
- Web: 261 files / 2,048 tests passed; typecheck and lint passed.
- Server: 39 focused native/Pack tests passed; typecheck and changed-file lint passed.
- Database: 46 focused artifact/media tests passed; typecheck and lint passed.
- Three real PostgreSQL cases passed: v6 hidden/visible media lifecycle, v5 rich-text lifecycle and
  shared Presentation repository conformance. The run used PostgreSQL 17 with real ordered
  migrations, a restricted runtime role and disposable storage. Hidden draft/history media,
  visible published media, exact retries, restore, export and cleanup were checked. The task-owned
  container and loopback forwarding were removed after execution.

Before the receipt-cleanup review follow-up below, `pnpm check` passed formatting, Docker-context
validation, lint, type checks, unit/support tests
and production builds. The combined package totals include 562 contracts, 2,048 web, 1,041 server,
480 database and 354 support tests. Default service-dependent skips were 341 database, 15 server
and one support case; the three selected PostgreSQL cases above ran separately. The first full
run timed out in an unchanged source-extraction test. Its two cases passed immediately in
isolation, and the subsequent full check passed without code, assertion or timeout changes.

The pre-review combined production-browser run passed all 36 cases in one invocation with zero
retries: 12 each on
desktop Chromium/Firefox and six each on narrow Chromium/WebKit. Eighteen cases cover the new
completion/recovery flows; eighteen retain native, direct-editing and rich-text regression coverage.
The new cases check hidden-slide history/duplication/reorder, visible-only preview/publication/live
delivery/reporting, immutable delivery after a draft unhide, question topology, exact lost-ack
replay, pending receipt refresh, divergent recovery and two-tab conflicts. Narrow cases also
exercise the now-visible Preview and save-status controls. Screenshot inspection confirmed
readable audience headings and bullets on desktop and narrow screens.

Initial development checks exposed that the old narrow command bar hid Preview without a
replacement; the canvas now supplies Preview at that breakpoint and a compact save status.
The first historical-receipt test also matched Next's route announcer along with the application
alert; its locator now waits for the specific conflict message. The final combined run used
unchanged assertions and timeouts after those fixes.

The browser recovery fixture uses real saves and receipts: it either lets the API commit a PUT
and discards its response, or aborts before delivery. Assertions compare the exact serialized
envelope and check remote revisions/content, then recover through the actual editor. Divergent
copies are previewed, downloaded and duplicated; two editor tabs exercise a real 409. These are
controlled transport simulations, not a deployed multi-process network-failure exercise.

Reproduce the combined browser checks with:

```sh
PLAYWRIGHT_PRODUCTION=true pnpm exec playwright test --config=playwright.beta.config.ts \
  tests/beta-e2e/presentation-native-scenes.spec.ts \
  tests/beta-e2e/presentation-direct-editing.spec.ts \
  tests/beta-e2e/presentation-rich-text.spec.ts \
  tests/beta-e2e/presentation-e01-completion.spec.ts \
  tests/beta-e2e/presentation-e01-recovery.spec.ts
```

The configured projects cover desktop Chromium/Firefox and narrow Chromium/WebKit. On this macOS
host, Firefox also needs existing temporary directories for `MOZ_APP_DATA` and `MOZ_LOCAL_APP_DATA`.
The harness owns its loopback API/web ports and must run without another server on those ports.

## Review follow-up: Undo during receipt cleanup

The delegated review found that the coordinator exposed an idle save while awaiting IndexedDB
receipt deletion, before applying the accepted revision and saved JSON. Undo to the previous
saved snapshot during that interval could skip autosave indefinitely. The pending attempt now
remains visible throughout cleanup, then clears immediately before synchronous receipt application.
Known receipt handling, exact replay and revision fences remain unchanged, including when receipt
application rejects a divergent server revision.

The delayed-cleanup regression checks that Undo remains eligible for autosave and saves at the
advanced revision. All 47 focused coordinator/builder tests passed, along with web typecheck,
changed-file lint and formatting. A browser regression delays the exact pending-receipt deletion
callback, clicks the real Undo control, then verifies a second real PUT restores the entire original
rich draft, hidden content and IDs without another edit or manual save. Focused read-only review
confirmed the finding is resolved.

All 14 production recovery-browser cases passed with zero retries: six each on desktop
Chromium/Firefox and one each on narrow Chromium/WebKit. The new delayed-cleanup Undo case passed
on both desktop browsers; existing exact-replay, refresh and divergent-recovery cases passed too.
These are the final checks after the review fix; the full-repository and 36-case combined results
above predate this follow-up.

## Remaining release evidence

Software acceptance is distinct from release qualification. Automated mobile browser emulation
does not establish physical-device behavior or manual assistive-technology usability. Creator
task timings, human observations, deployed scanner/storage operation, representative capacity,
production rollout and cost measurements remain unmeasured here. No new public capacity or broad
competitor-parity claim follows from these checks. Site-data clearing can remove local recovery;
it is not a server backup. Persistent grouping, themes, charts, advanced layouts and reusable
components remain E02 work.
