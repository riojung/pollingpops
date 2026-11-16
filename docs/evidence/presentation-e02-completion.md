# Presentation E02 implementation and verification

Date: November 4, 2026. Base: `d019d8c68e11122443301f38c8dcd4d8dc4d7534`, the merged
[design-foundation PR](https://github.com/riojung/pollingpops/pull/187).
Branch: `codex/presentation-e02-completion`.

This increment implements E02's remaining software scope after the
[design foundation](presentation-design-foundation.md). Final repository verification passed;
production-browser evidence combines the ninety-case matrix and a focused rerun after fixes.
The local application has been refreshed and verified. Executed checks and qualifications are
distinguished below. It adds no paid SDK, hosted rendering/model service, font download, SQL
migration or commercial entitlement.

## Implemented scope

| Requirement         | Behavior and implementation boundary                                                                                                                                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snap guides         | Pointer movement snaps within six screen pixels to slide/object edges or centers. Guides are local, disappear on release/cancel and never enter saved JSON. Alt bypasses snapping. Keyboard/numeric movement remains explicit.                                                                                                           |
| Persistent grouping | Flat, disjoint slide-local groups reference existing framed objects. Selecting one member selects its group. Movement, proportional resizing, alignment/distribution and layers preserve internal geometry. Merge/ungroup, duplication and protected-title deletion retain valid references. Reading order remains independent.          |
| Bounded rotation    | Angles are finite and bounded to ±180°. Selection rotation, resize anchors, painted bounds and connectors use physical 16:9 coordinates. Both raw frames and rotated paint stay within the scene contract. Narrow semantic delivery renders complete unrotated content and connector descriptions.                                       |
| Editable tables     | Up to six columns and twenty data rows, bounded literal cells, caption and column headers. Staged grid/CSV/TSV editing supports Preview, Apply and Discard; invalid data preserves the staged copy.                                                                                                                                      |
| Editable charts     | Local deterministic SVG bar, line and pie charts from at most twenty categories/four finite numeric series. Pie charts require one nonnegative series with a positive total. Authored title/summary and complete visible data tables convey meaning independently of color. No formulas, external data synchronization or chart service. |
| Template library    | Twelve original eight-slide native decks, shared-renderer thumbnails and a navigable full-deck preview. Nine existing facilitated v2 templates are retained, for twenty-one gallery entries. Template saves keep the exact v2 mutation envelope across uncertain acknowledgements.                                                       |
| Video scope         | Explicit external HTTPS video and captions/transcript links with a visible destination/fallback. Existing safe rich text opens them only after user activation; no provider scripts, thumbnails, iframes or uploaded-video transcoding. Remote availability is not inferred.                                                             |
| Content and fit     | A sixth title/data layout complements the original five layouts. Text/data fit feedback measures actual overflow. New information controls appear above the canvas. Failed scene/document budget checks preserve content, history and staged input.                                                                                      |

Each explicit data Apply creates its own Undo step; it is not coalesced as continuous typing.
Callback programming failures propagate rather than being reported as ordinary input errors.
The complete Presentation budget is checked before native edits enter history/autosave, while
staged table/chart/video inputs survive a rejected write and can be corrected and retried.

## Compatibility and authority

- Scene v4 and Presentation document v8 are explicit opt-ins for groups, rotation and data nodes.
  Parsing older scenes installs no defaults and does not rewrite immutable content or retry hashes.
- Existing v1–v7 documents/hashes remain compatible. Classic API creation still defaults to v2;
  the explicit blank-native launcher still creates v7. Existing rich-text video links do not
  require composition fields. The ordinary mutation envelope remains v2.
- Theme changes, rich-text formatting, hidden-slide edits, ordinary slides, Pack insertion/update
  and copying retain the highest required document/scene version. They do not downcast v8 content.
- Tables/charts are inline text/numbers; groups retain flat nodes. Images remain authorized private
  references. Existing migration 089/media visitors continue to collect actual image nodes without
  treating textual data as authority. No new SQL migration is required.
- Published versions preserve authorized presenter notes; audience/participant projections omit
  notes, citations and hidden planning slides. Public rendering never acquires author credentials.
- Deploy matching readers and writers before v8 writes. Once v8 data exists, rollback must retain
  v8-compatible readers and migration 089, or use forward repair. See the
  [upgrade instructions](../runbooks/upgrade.md#native-presentation-composition-compatibility).

## Original scenarios and assets

The new catalogue contains startup pitch, client proposal, project update, quarterly strategy,
portfolio case study, event talk, product demo, customer onboarding, practical workshop,
lesson/explainer, research findings and business decision brief. Each has eight substantive slides,
adaptation notes and a coherent opening/example/conclusion. No audience activity is required.

The original source contains ninety-six slides, nineteen column layouts, nineteen tables and eight
charts. Fictional examples and illustrative values are identified as such; they are not customer,
research or operating-cost evidence. Copies receive independent block/node/group/connector IDs.
No workspace media IDs, competitor assets, logos, downloaded fonts or third-party media are bundled.
Provenance and distribution terms are in the [asset register](../asset-register.md).

## Verification

Full `pnpm check` passed again after the gallery CSS correction. It includes repository formatting, Docker
build-context dependency validation, lint, type checking, unit/integration tests, production builds
and the admin build/help check. Final local log: `/tmp/pollingpops-e02-completion-final-check.log`.
The primary affected suites reported:

| Suite     | Passed | Default-run skips |
| --------- | -----: | ----------------: |
| Contracts |    614 |                 0 |
| Web       |  2,240 |                 0 |
| Server    |  1,049 |                15 |
| DB        |    506 |               343 |
| Support   |    354 |                 1 |

The default DB skips do not stand in for a live PostgreSQL run; the separately executed conformance
case below records that boundary. Other repository suites also ran as part of `pnpm check`.

Focused checks, which overlap the repository totals, include:

- Contract validation covers group/reference/angle/data bounds, draft versus publication rules,
  explicit version gates, byte limits and independent legacy document/hash goldens through v7.
- DB/server checks cover v8 immutable publication and live projections, exact retry, draft history,
  restore/export, hidden content, media ownership and author/live Recovery Pack preservation.
- Twenty-six composition tests include one hundred deterministic fractional/rotated edit
  sequences against the real schema. They exposed and guard shared-translation group drift and
  rounding just outside the rotated epsilon boundary; fixes retain the contract's existing limit.
- Thirty-eight data tests cover bounded quoted CSV/TSV, malformed/numeric inputs, staged recovery,
  source/history changes, complete data rendering, zero/negative/single/full-turn charts and palette
  contrast. Additional explicit Apply, callback-rejection and editor-semantic tests are retained.
- Twenty-two video/composition-control tests cover safe links/fallbacks, byte budgets, retained
  inputs and callback failures, grouping, offstage-rotation refusal/recovery and resize controls.
- Thirty-one template/gallery tests cover readiness, independent copies, retained v2 templates,
  full previews, envelope v2 and exact retry without creating a second shell.
- Eighty-five integration tests cover the legacy/editor/renderer/gesture/composition/document
  helpers, including no mutation/history on rejected input and successful correction.
- Real PostgreSQL 17 conformance passed for v8 composition and the v7 compatibility floor:
  **2 passed, 123 filtered skips** in one invocation. The existing fixture created a restricted
  `NOSUPERUSER`/`NOBYPASSRLS` runtime and applied/verified all eighty-nine migrations twice. Its
  temporary database lived in a uniquely owned container's tmpfs; the owned container and SSH
  forward were removed and verified absent. Existing application services/data were untouched.

Targeted totals overlap and are not additive. Independent review found a pie rendering defect:
highly unequal positive values could round a nearly complete slice's start/end to the same point.
Each slice now uses two arcs; a genuine sole positive value remains a circle. Regression cases
retain the complete original values and verify finite, nonempty geometry. Independent review
follow-ups cleared the pie correction, pointer fixture and gallery CSS correction.

### Production-browser coverage and iterations

The ninety-case production-browser matrix completed with **87 passed and 3 failed in 8.6 minutes**
across desktop Chromium/Firefox and emulated mobile Chromium/WebKit. The failures were a Firefox
pointer-coordinate assertion and midnight thumbnail contrast in both mobile template-library cases.
Local log: `/tmp/pollingpops-e02-completion-browser-verified.log`.

After the narrow fixes below, a focused production-browser run passed **10 of 10 cases in
1.7 minutes**: four template-library cases with light/dark Axe checks, four complete twelve-deck
native preview cases covering all ninety-six slides, and two desktop pointer cases. This reran all
three failures and the affected gallery/preview scope. Local log:
`/tmp/pollingpops-e02-completion-browser-final-focused.log`.

Combined evidence provides passing observations for all ninety distinct cases across these
invocations. It is not a clean ninety-case result from one invocation; the full matrix was not
repeated after the CSS and pointer-fixture corrections. Earlier runs and the matrix exposed the
following issues and corrections:

- An excess-property error in a new renderer test fixture blocked the initial production-browser
  startup. The fixture was corrected without changing runtime behavior or relaxing type checks.
- A real multiline table-cell editing defect used a single-line input, which removed line breaks.
  Textareas preserve the authored multiline value. A chart's scrollable data also lacked keyboard
  focus; named, focusable data surfaces now retain native scrolling and isolate scrolling keys
  from preview navigation. The Axe assertion remains unchanged.
- Initial native chart geometry clipped the plot before the complete data table. New chart
  templates now give the chart its own larger frame, retain the complete body/notes in presenter
  notes and use an actual-width layout that places plot and table side by side when space permits.
  Browser coverage checks the complete initial SVG bounds and focused End/Home scrolling without
  changing slides; it does not promise that every twenty-row table fits without scrolling.
- Test fixtures assumed a white background instead of the selected paper theme, tried to delete
  an active session and mistook Next's empty route-announcer alert for a failed template save.
  They now assert the selected theme, finish the real session before deletion and wait for the
  real accepted PUT's discarded acknowledgement plus a nonempty gallery error. Exact retry-body,
  mutation-envelope, one-shell and history assertions remain intact.
- An earlier matrix was interrupted after bundled Firefox failed to launch against the macOS
  application-data/profile boundary. The rerun uses task-owned `CFFIXED_USER_HOME` and `TMPDIR`
  directories, consistent with the [reported Playwright issue](https://github.com/microsoft/playwright/issues/42768).
  Those browser-data directories were removed and verified absent. macOS deny-delete ACLs were
  cleared only inside the guarded, exact task-owned substitute-home directory before removal.
  The actual `HOME`, personal profiles and permissions on personal directories were unchanged.
- The Firefox pointer assertion exposed integer screen-pixel rounding just beyond a fixed
  percentage tolerance. The fixture now checks at most one actual screen pixel with an explicitly
  unsnapped movement; both desktop pointer cases passed in the focused rerun. Production snapping
  behavior and its six-pixel threshold were unchanged.
- Native midnight paragraphs in gallery thumbnails inherited the surrounding card's muted text
  rule, producing insufficient contrast in light mode on both emulated mobile browsers. Narrowing
  `.starterCard p` to `.starterCard > p` limits that rule to card descriptions and preserves native
  slide foreground, line spacing and margins. The content, theme tokens and Axe checks were not
  changed. All four library and four native-preview cases passed after this correction.

The earlier failed or interrupted iterations are not counted as successful final runs.

### Local application refresh

The local Docker application at [localhost:8080](http://localhost:8080) was rebuilt from this
working tree and refreshed successfully. The matching web, API and jobs build identifier is
`d019d8c68e11122443301f38c8dcd4d8dc4d7534-dirty-b246bb2aa174`; the suffix fingerprints the actual
uncommitted application sources rather than claiming a new commit.

Only those three services were recreated after both images built. Their environment settings were
compared with the running configuration without exposing values; the existing data and settings
were retained. All nine other container IDs remained unchanged. The control service does not read
Presentation JSON and was left running. No migration, volume removal or feature-flag change was
required.

All three services are healthy. API liveness/readiness and the web sign-in returned HTTP 200;
the API build and web build header match. The deployed web chunks contain grouping, table/chart
editing, explicit video links and full template-preview controls. To try the new catalogue, open
[Templates](http://localhost:8080/templates) and select **Presentations**.

Local log: `/tmp/pollingpops-e02-completion-local-update.log`. This is a local application update;
no hosted deployment is claimed.

## Qualification boundary

Software checks do not establish measured customer task success, professional design quality for
every real dataset, manual assistive-technology acceptance, physical phone/tablet behavior, native
browser zoom, provider video/caption availability, hosted storage/scanner/rollout behavior,
production capacity or a measured subscription floor. Those observations remain open.
Device emulation and CSS zoom, when executed, are explicitly recorded as emulation.

Later E03 delivery polish, E05 portability, E06/E07 reveal/navigation, E08 sharing and E14 media
production remain separate packages. This record makes no hosted-deployment or competitor-parity
claim and does not advance the repository's human/operational release gates.
