# Presentation E02 native design foundation

Date: November 4, 2026. Base: `d202314` after PR 186. Branch:
`codex/presentation-design-foundation`.

This is the first E02 increment: color/font/spacing tokens, reusable slide layouts, image fit and
focal points, alignment/distribution and independent layer controls. It adds no editor SDK,
hosted renderer, downloaded font, model call, SQL migration or subscription entitlement.
E02 remains in progress: snap guides, persistent grouping, rotation, editable tables/charts,
10–15 full scenario templates and the remaining media scope are subsequent work.

## Behavior and compatibility

- Four fixed palettes (`paper`, `midnight`, `ocean`, `sunset`), three system font stacks and
  relaxed/compact spacing live in optional scene design tokens. Explicit design/image-fit
  actions promote scene v3 and document v7. No defaults alter old scenes on read.
- Apply design to all native slides changes existing native slides, including hidden ones, as
  one Undo/Redo operation. Ordinary slides and activities remain unchanged. The operation
  validates the whole-document budget before applying and preserves text, formatting, images,
  notes, citations, IDs, order and frozen baselines.
- Five layout presets operate only on compatible existing object combinations. They reposition
  frames without discarding content or changing semantic order. Unsupported presets are disabled
  with their requirements. Selected framed objects can align; at least three can distribute with
  nonnegative gaps and fixed outer anchors. Layer controls change visual stacking independently
  of reading order. Connectors continue to follow their endpoints.
- Images use existing private references. Contain shows the complete source; cover crops within
  the frame using a finite 0–100 focal position. Narrow reading columns show complete images.
  The same renderer supplies editor, preview and host/participant/Companion delivery. Text fit
  feedback preserves full content rather than truncating it.
- Old scene v1/v2 and document v1–v6 representations, default document v2, envelope v2 and hashes
  remain supported. v7 session admission is strict. Migration 089 already discovers scene image
  references; no collector or SQL changes are needed. See the
  [compatible-reader rollout](../runbooks/upgrade.md#native-presentation-design-compatibility).

## Verification

- Contracts: 50 files / 589 tests passed; typecheck, lint and formatting passed. Coverage includes
  closed token/fit schemas, finite focal bounds, incompatible old versions, and independent
  pre-change document v2–v6 hash goldens generated against the base implementation.
- Database: 92 focused artifact/session/media cases passed, with typecheck and lint. Strict v7
  session admission and v8 rejection preserve older admission behavior.
- API: 42 native publication/delivery and Pack cases passed, with server typecheck. They preserve
  design/crop tokens through host/participant/Companion and live Pack insertion; hidden pending
  media remains private and does not block visible publication.
- Three real PostgreSQL cases passed: v7 design/crop/hidden lifecycle, v6 visibility lifecycle,
  and shared Presentation conformance. Real ordered migrations and a restricted runtime role
  checked accepted retry/conflict, media ownership, hidden/visible retention, immutable versions,
  Pack baselines, restore, export, cleanup and agreement between SQL/JS media collectors. The
  task-owned PostgreSQL 17 container used temporary storage; it and its loopback forward were removed.
- Fifty deck-design/builder helper cases and 55 focused design/editor/renderer/fit cases passed.
  All-slide design rejects a document-budget overflow without partially changing the source.
  Measured fit feedback covers scroll overflow, resize updates, unavailable measurements and
  observer cleanup. Integration QA checked 10,000 deterministic fractional alignment/distribution
  scenes against the contract and found no additional actionable defects.

`pnpm check` passed formatting, Docker-context validation, lint, type checks, unit/support tests
and production builds. Totals include 589 contracts, 2,092 web, 1,044 server, 493 database and 354
support tests. Default service-dependent skips were 342 database, 15 server and one support case;
the three selected real PostgreSQL cases above ran separately.

The browser journeys cover theme/font/spacing in the shared renderer, all-native design Undo/Redo,
hidden/ordinary preservation, reload, preview, immutable publication/live delivery, arrangement,
dark media and CSS zoom at 200%. A separate explicitly synthetic-media case exercises actual
AuthenticatedMedia rendering and image controls/CSS through cover/focal changes, image layouts,
Undo/Redo, contain, reload and preview. Only that case's exact draft/media requests are fixtures;
it does not establish storage/scanner operation or media ownership. Those boundaries are covered
by the real API and PostgreSQL cases above.

Initial development runs corrected an exact-label query that included select options; the test
now targets each named combobox. They also exposed fixed-width command-bar overflow at CSS zoom
200% and a collapsed inspector border extending the page. Controls now wrap, and closed sidebars
are removed from layout/focus. The overflow assertion and its tolerance remain unchanged, with
added diagnostic measurements. The palette's heading inheritance was made explicit so app-level
heading styles cannot override a slide's contrast colors. Those overrides are scoped to themed
slides; the browser journeys compare legacy heading color, font and width with the existing app
styles before opting in.

The first combined production run passed 47 cases and found a WebKit mobile zoom issue: the app's
320px root minimum became 640px at CSS zoom 200%. A builder-scoped root selector removes that
minimum while the editor is open, leaving other routes unchanged. The affected WebKit journey
then passed with the same overflow assertion. These checks use CSS zoom and viewport emulation,
not a manual native-browser zoom or physical-phone acceptance exercise.

Before the review/visibility follow-up below, the combined production-browser invocation passed all 48 cases with zero retries in 4.9
minutes: 16 each on desktop Chromium/Firefox and eight each on narrow Chromium/WebKit. Ten cases
cover the new foundation/image-fit journeys and 38 retain native/direct/rich-text/E01 recovery
coverage. The full repository check above also passed on that source. Desktop
and narrow screenshot inspection confirmed readable themed headings, paragraphs, lists and links;
zoom screenshots confirm wrapped authoring controls. All task-owned test servers and temporary
Firefox directories were released after execution.

Reproduce the combined browser run with:

```sh
PLAYWRIGHT_PRODUCTION=true pnpm exec playwright test --config=playwright.beta.config.ts \
  tests/beta-e2e/presentation-design-foundation.spec.ts \
  tests/beta-e2e/presentation-design-image-fit.spec.ts \
  tests/beta-e2e/presentation-native-scenes.spec.ts \
  tests/beta-e2e/presentation-direct-editing.spec.ts \
  tests/beta-e2e/presentation-rich-text.spec.ts \
  tests/beta-e2e/presentation-e01-completion.spec.ts \
  tests/beta-e2e/presentation-e01-recovery.spec.ts
```

On this macOS host, Firefox additionally used existing task-owned temporary directories for
`MOZ_APP_DATA` and `MOZ_LOCAL_APP_DATA`. Keep the configured loopback web/API ports free before
starting the harness. The synthetic image journey uses an original bundled brand PNG and adds
no downloaded or third-party image asset.

## Review and visibility follow-up

The delegated review found a valid scene near 128 KiB could exceed its limit when design or image
options added bytes, throwing without user feedback. Both handlers now validate the proposed scene
before calling `onChange`, show an actionable local alert on failure and retain content/history.
Successful corrections clear the error; programming errors from callbacks are not swallowed.
Regression fixtures cover exact 131,071-byte scenes, font growth at 131,072 bytes, equal-size spacing
changes and image-fit/focal growth, including actual browser handlers and retries after reducing text.

The blank web launcher explicitly requests a styled native title/body starter using the optional
`initialSlide: "native"` creation field. The API atomically stores document v7/scene v3 with the
correct artifact version. Omitted or `classic` retains the original v2 API behavior. Existing decks
are not automatically converted. **New slide**, conversion and selected slide actions appear above
the canvas; the Design panel also precedes it. Real-service discovery journeys check creation,
conversion, visibility, metadata/ID retention and slide actions on desktop and narrow screens.

After these fixes, `pnpm check` passed, including 590 contracts, 2,101 web, 1,045 server, 493
database and 354 support tests, type/lint/format checks and production builds. The unchanged
source-extraction test first timed out under the full workload; its two cases passed in isolation,
and the subsequent full check passed with no code, assertion or timeout change to that test.

All 58 distinct production-browser cases passed across the combined run and focused rerun. The
combined invocation passed 56; the two dense mobile-overlay fixtures needed the high-layer node
scrolled into view after the new controls moved it down. Both then passed on Chromium/WebKit
with the original overlap and pointer-access assertions unchanged. No production source changed
between those runs. The six validation and four discovery cases cover the new failure/retry and
visibility fixes. Focused read-only review confirmed the reported issue is resolved.

The actual local Docker application was then rebuilt and updated at `http://localhost:8080`.
Web, API and jobs report build
`d2023145ceecb42ffafd0c213f730c9b0d03f80f-dirty-e32a49b38f85`; the suffix truthfully identifies
the uncommitted application-source fingerprint. The served sign-in response exposes the same
build header, API live/readiness checks pass, and the served bundles contain design, New slide,
conversion and validation-recovery controls.

The update reused the existing `openround` project and its exact Compose files/environment.
Images were built while the old app ran, then only web/API/jobs were stopped and recreated for
the coordinated reader update. All nine other running containers retained their IDs, including
the database, storage, proxy and operator console. No volumes, runtime settings or operator
credentials were reset. Migration 089 was already applied with the matching checksum. This was
a local development update, not a hosted deployment or merge; retain v7-compatible readers and
writers when rebuilding after local v7 data is created.

## Remaining evidence

Automated narrow browsers are emulation, not physical-device or manual assistive-technology
qualification. Human creator task observations, representative font/device fit, deployed
scanner/storage checks, sustained capacity, production rollout and operating-cost measurements
remain open. Fixed font stacks use available system fonts; this does not establish pixel-identical
rendering across operating systems. No broad competitor-parity or new public-capacity claim follows
from this increment. The remaining E02 work above remains explicitly unimplemented.
