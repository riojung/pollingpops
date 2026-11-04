# Native Presentation E01 verification

Date: November 3, 2026

Base: `e4b08e0`, after the content-only slice merged in PR 182. Working branch:
`codex/presentation-native-scenes`.

This is the first native scene authoring/persistence/delivery increment. It adds plain text,
multiple private images, labeled shapes and connectors using the existing Presentation artifact
and document recovery pipeline. It does not complete all E01 editor or release acceptance criteria.

## Implemented boundaries

- Native content opts into Presentation version 4. Its public scene is independently versioned at
  1; v1/v2/v3 documents retain their existing defaults, upcasters, hashes and visual representation.
  The draft mutation envelope remains version 2. The E00 experimental artifact is separate.
- A scene is the authoritative native visual content. Legacy text/image slots are empty/null;
  notes, citations and source disclosures remain on the private block. Explicit conversion retains
  that metadata and rejects incompatible legacy data without silently sanitizing or truncating it.
- Scenes have at most 50 nodes and 128 KiB of UTF-8 JSON. Version-4 documents have a 3 MiB bound,
  including frozen original/update baselines. Geometry is finite and contained; node IDs and exact
  reading order are validated; connectors reference distinct existing non-connector nodes.
- Creation, text/node edits, numeric/keyboard geometry, reading-order changes, conversion and
  duplication use existing autosave, undo/redo, retry, local recovery and conflict handling.
  Duplication remaps node/edge references together; deletion removes attached edges.
- Publication freezes native content and validates every image's description, ownership, scan
  state and availability. Shared JS/SQL collectors retain scene media together with existing
  block/question media and frozen Pack original/update baselines. Migration 089 backfills edges
  without editing immutable document JSON.
- Current-slide session media access retains credential, tenant, lifecycle and scan checks.
  Host/participant/Companion projections explicitly carry public scene data, excluding notes and
  source metadata. Reports derive titles from the frozen scene. Content-only standings remain absent.
- Native-only image UUID normalization and SQL collection agree for canonical UUIDs, including
  modern and nil UUIDs; legacy parsing/hashes remain unchanged. Pack insertion preserves version 4.

## Local verification

Before the review follow-ups below, `pnpm check` passed formatting, Docker-context validation, lint, type checks, tests,
support tests and production builds. It includes 514 contract, 1,968 web, 1,034 server and 459
database tests. Its default environment skipped 339 database, 15 server and one support case;
the two focused real-PostgreSQL cases below executed separately against the isolated cluster.

The first full attempt hit the existing five-second limits in source-extraction and Round summary
export tests during concurrent package execution. Both suites then passed all 21 tests at their
unchanged limits, and the unchanged full `pnpm check` command passed on rerun. No limits, test
assertions or product behavior were relaxed. Inspection found no native-scene execution on those
two failing paths; cold module/font/worker contention is the likely explanation, not a proven one.

| Check                                                                 | Result                                 |
| --------------------------------------------------------------------- | -------------------------------------- |
| Scene/prototype/Pack contract regression suites                       | 71 focused tests passed                |
| Native and legacy artifact readers                                    | 28 focused tests passed                |
| Native/legacy builder models and rendering                            | 66 focused web tests passed            |
| Native API and authoring/live Pack insertion                          | 32 server tests passed                 |
| Native media and artifact-reader regressions                          | 27 database tests passed               |
| Real PostgreSQL native media lifecycle and shared session conformance | Two selected cases passed              |
| Native editor to completed report across four browser projects        | Four journeys passed with zero retries |
| Contracts/database/server/web type checks and changed-file lint       | Passed                                 |

The PostgreSQL run used a task-owned disposable PostgreSQL 17.11 container with tmpfs storage,
real ordered migrations and the existing restricted runtime-role bootstrap. The native case
compares JS/SQL asset IDs, exercises foreign/deleting media rejection, revision retries, history,
immutable publication, frozen sessions, account export and final reference cleanup. It verifies
that removing an image from the current draft leaves history/version protection intact. This is
isolated local database evidence, not a production migration rehearsal or capacity result.
The task-owned container and loopback SSH forward were removed after verification.

The original authoring/delivery browser journeys use real editor/API/autosave/publication/session calls without response
stubs. It creates text, a labeled shape and a connector, changes geometry by number and keyboard,
changes reading order, reloads, duplicates with remapped IDs, uses undo/redo, publishes, joins a
guest, reloads both live surfaces, advances/finishes, and checks report titles and private-note
exclusion. It explicitly checks matching left text alignment in the editor and participant view.

Screenshot review found inherited centered text on the audience surface; the native stage now
owns its text alignment instead of inheriting the surrounding live layout. Compact Undo/Redo
buttons keep the existing history actions available on narrow screens. The mobile journey uses
the existing map/inspector overlays one at a time. Initial harness runs were interrupted by live
source reloads and corrected selector assumptions; they are not counted as successful verification.
The final desktop Chromium/Firefox and mobile Chromium/WebKit invocations together passed all
four journeys with zero retries. An initial read-only review of the tracked/untracked code and
tests found no actionable correctness, security or data-loss issues. The subsequent review's
mobile-stacking finding and its fix are recorded below.

Media API tests use repository assets in explicit scan states and a stubbed download URL signer;
they do not upload image bytes through S3 or invoke a scanner. The browser journey uses text and
shapes because the beta harness has no private storage/scanner configuration. Existing image
upload infrastructure is reused, but actual byte/scanner qualification remains separate evidence.

Reproduce the relevant checks with isolated configured services:

```sh
pnpm --filter @openround/contracts exec vitest run test/presentation-scene.test.ts test/presentation-scene-prototype.test.ts test/recovery-pack-presentations.test.ts
pnpm --filter @openround/db exec vitest run test/presentation-scene-artifact-schemas.test.ts test/media-references.test.ts
pnpm --filter @openround/server exec vitest run test/presentation-native-scene-api.test.ts test/presentation-companion-recovery-packs.test.ts test/recovery-pack-presentation.test.ts
pnpm --filter @openround/db exec vitest run test/postgres.test.ts -t 'retains native scene media across Pack baselines|shared Presentation repository conformance contract' --hookTimeout=60000
pnpm exec playwright test --config=playwright.beta.config.ts tests/beta-e2e/presentation-native-scenes.spec.ts
pnpm check
```

PostgreSQL requires `TEST_DATABASE_ADMIN_URL` and `TEST_DATABASE_URL` pointing at an isolated cluster;
without them, service-dependent cases skip. macOS Firefox uses task-owned `MOZ_APP_DATA` and
`MOZ_LOCAL_APP_DATA` directories, as in the [E00 verification](presentation-scene-prototype.md).

## Review follow-up: mobile scene stacking

At narrow widths, the scene switches from a size container to a reading column. Its node z-indices
could then escape the stage and rise above the builder's map and inspector overlays. The stage now
uses `isolation: isolate` at every width, preserving internal visual order while containing it
below surrounding controls.

A real API-seeded 31-node deck reproduces the failure by putting node 31 first in reading order
with enough text to span the overlay controls. The regression checks that each control's center
overlaps that node's bounds, that `elementFromPoint` reaches the control, and that real unforced
clicks work. It also focuses the notes textarea, types a note and verifies autosave. Before the
fix, mobile Chromium failed the map pointer-target assertion. The test does not require buttons
to acquire focus on pointer activation; textarea focus and actual editing remain required.

After the fix, all four existing native authoring/delivery journeys passed. The final focused
stacking run passed both mobile Chromium and mobile WebKit cases with zero retries. Twelve native
model/renderer unit tests, targeted ESLint, formatting and diff checks passed. A read-only follow-up
confirmed the stacking fix and overlapping-geometry regression. The broader `pnpm check` result
above predates this CSS-only production correction; it was not rerun for this follow-up.

## PR 183 follow-up: retained image attachments

Native additions now pause during image upload/scanning and while a completed image waits to be
attached. Ordinary text/geometry editing, selection and history remain available. A completed
scan keeps its original block ID, one stable node ID, media ID and description in a pending
attachment until the rendered draft confirms the node exists. A pure, idempotent helper applies
it through the existing commit/autosave/recovery flow.

If history fills the original slide or removes its scene, a persistent status explains what is
waiting. Freeing space or restoring the target retries attachment without another ticket, upload
or scan. An explicit **Discard uploaded image** action releases the pending result. The builder
warns before exit/reload while an upload or attachment is pending; the unattached result is local
to the open editor and is not a new persisted artifact. Legacy/question upload controls also stay
blocked until the pending result is attached or discarded.

The client race regression holds both upload and scan completion, starts at 49 nodes, verifies
addition controls are disabled, uses Undo to restore 50 nodes, switches to another slide, then
finishes scanning. It checks the waiting state, frees space through history and verifies exactly
one image attaches to the original slide with one ticket/upload/scan. This focused test stubs
storage/scanner and draft-persistence responses to control the race; it does not claim real image
byte or scanner qualification. The separate authoring/delivery journeys retain real service calls.

Validation for this follow-up: web type checking, changed-file ESLint and 26 targeted unit tests
passed. All six existing native browser cases passed; the deferred-upload race passed in desktop
Chromium and Firefox with zero retries in the final focused run. The fixture uses Redo to replay
the removal that frees space; an initial extra Undo still pointed at a full history entry and
was corrected without changing product behavior. Independent read-only review found no further
issues. The full repository check above predates this follow-up.

## Compatibility and remaining work

Follow the [native-scene upgrade boundary](../runbooks/upgrade.md#native-presentation-scene-compatibility):
apply migration 089, deploy compatible readers/media cleanup workers before reopening native
writers, and retain a compatible rollback image after version-4 data exists. Older processes
cannot read or safely clean up native node assets. No new paid dependency, AI call or paywall is added.

Pointer editing and temporary multiselection are covered by the subsequent
[direct-editing record](presentation-direct-editing.md). Rich text, persistent grouping, slide
hiding, advanced themes and charts remain later work. Creator timings, assistive-technology acceptance, physical-device behavior,
real image-byte/scanner qualification and deployed capacity remain unmeasured here. This record
does not close release-ledger gates or establish parity with Genially or Prezi.
