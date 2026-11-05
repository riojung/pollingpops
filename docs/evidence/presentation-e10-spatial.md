# Presentation E10 bounded spatial story map

Implementation branch: `codex/presentation-e10-spatial`, from merged E09 baseline
`45d6118d09646978b507be583194b13d04297bc8` (PR #201). This is the first bounded story-map slice
of E10. Review and deployment remain pending.

## Scope

**Arrange space** explicitly enables a spatial layout for an existing deck. Authors move numbered
slide/activity frames, edit coordinates and size, use keyboard controls, fit/zoom the authoring
view and preview the visible publication. Frame movement does not reorder content: the existing
filmstrip sequence defines the path and continues to enforce valid linked diagnostic/recheck
ordering. Existing section membership supplies group outlines without a second hierarchy.

The editor retains ordinary slide selection, current content preview, whole-draft history,
revision-fenced autosave, recovery and accepted mutation receipts. A pointer move commits once on
release and Escape cancels it. Numeric/list controls provide a useful phone and keyboard path.
Deleting/duplicating/inserting blocks maintains frame references while ordinary text edits do
not write missing defaults into sparse metadata. Enabling the feature is explicit; disabling it
keeps the new document reader floor.

Numeric fields preserve intermediate text while typing, then normalize and apply once on blur or
Enter. Escape cancels a field edit; empty/invalid values revert without a save, and selection or
external draft changes discard stale text. Each completed edit gets its own undo checkpoint.
Visual import transfers a replaced empty starter's authored frame to the first imported visual
slide. New pages keep deterministic sparse fallbacks, and imports into nonempty decks preserve
existing authored geometry. Section replacement, revision fences and exact retry receipts remain
intact.

The live host, audience stage, participant and Companion gain **Presentation spatial path**.
The confirmed current block drives camera fitting on a lightweight numbered diagram. Lobby and
finish use the overview. **Show overview**, **Focus current page** and **Use linear view** are
viewer-local controls. Staff navigation delegates exact block IDs to the existing server-provided
jump permissions and reason text. The audience map provides orientation, without navigation
authority or other blocks' content. Current slide content, forms, results, recovery and media
remain mounted separately and readable while the map changes.

This slice adds spatial arrangement and a live path diagram. Content-plane camera rendering,
nested frames and a durable facilitator-broadcast overview command remain later E10 work.
Private ReviewV1 and static exports retain their linear allowlists. This is not unrestricted
Prezi parity, an infinite canvas or a Canvas board follow lease.

## Contracts, privacy and bounds

Document14 optionally carries `spatial: { schemaVersion: 1, frames }`. Each frame references an
existing block UUID, preserving authored spelling while enforcing logical uniqueness. There are
at most 200 frames in a 20,000-unit square. Coordinates and dimensions are integers, frames have
a 16:9 aspect ratio, width is 320–3200 and height 180–1800, and the right/bottom edges stay inside
the world. Existing whole-document byte limits still apply. Scene6, default document2, blank
native document7 and mutation envelope v2 retain their meanings.

Sparse entries resolve deterministically from the canonical block index: 1280×720 frames on a
12-column grid with 1600/960-unit spacing. Reads never persist fallback frames. Authored spatial
JSON stays frozen during authorized live insertions; new blocks use the same fallback rule.
Publication prunes hidden planning frames and empty sections before computing visible bounds.

Every role's optional spatial snapshot contains only consecutive block ordinals and bounded
geometry. It contains no block IDs, titles, kinds, section names, prompts, scenes, media, notes,
keys, response data, branches or private progress. Existing safe current-block projections remain
the content authority. Camera controls do not issue commands, open/reveal a question, restart
its window, create another attempt, change a score or alter coverage.

The diagram has at most 200 geometry nodes and an ordinal path. Fitting adapts existing Canvas
math without changing Canvas zoom defaults; large worlds can fit below the editor's zoom floor.
Transforms take 300 ms and reduced motion disables transitions. The graphic is outside
the reading order; native controls and readable current content remain available. No image or
future content is fetched for an overview, and no per-camera event/job is added.

Migration098 extends the existing document/content/response/interaction guards and adds bounded
spatial checks plus live-layout immutability. Migrations001–097 and historical JSON/hashes are
preserved. Document14 sessions keep ReportV7 and the E09 reader enforces that binding; ReportV1–V7,
accepted response meanings and AggregateSummaryV1 are unchanged. No dependency, paid SDK,
service, provider, model call or entitlement is added.

## Verification

- **116 focused contract checks and 22 database unit/conformance checks pass**, including
  historical wire/hash fixtures, future-version rejection, geometry bounds, publication pruning,
  deterministic fallback, document14 interaction compatibility and frozen live layout.
- **24 server checks pass** across the new role-projection/runtime cases and E09 insights. HTTP,
  realtime batch sync and targeted response acknowledgements expose only ordered geometry;
  original attempts/windows, recovery pairs and ReportV7 binding remain intact. Current server
  typecheck and scoped lint pass.
- Review regressions pass **23 focused editor/Builder checks and 36 server checks**. Numeric
  fields support clear/replace text, one blur/Enter commit, final clamping, invalid-value/Escape
  cancellation, stale-edit invalidation and separate undo steps. Import cases cover authored
  and sparse starter replacement, nonempty-deck insertion, sections, publication, case-insensitive
  frame references and exact retry receipts. The authored starter case reproduced its original
  HTTP400 before the service fix.
- PR review adds **31 focused database reader/live-insertion checks**. Initial document14
  sessions use the published-content parser, rejecting hidden blocks, empty decks and blank
  titles before in-memory storage or partial writes. Valid spatial content and Quick Check/
  published-question metadata remain intact; invalid live markers reject and the legacy5
  partial-snapshot path retains its original meaning. The regression reproduced hidden content
  being stored before the dispatch fix. No contract, migration or SQL guard changes are needed.
- **Eight selected real PostgreSQL cases pass:** three E10 cases, four existing E09 cases and
  the shared Presentation repository conformance baseline. They cover scene6 broadcast/branch
  behavior, original windows/revisits/receipts, raw spatial/reference/version guards, frozen
  draft/history/publication/session layout and authorized live-addition fallback. The E09 cases
  preserve legacy missing-version histograms, bigint reveal selectors, roster privacy and Q&A.
  Run `2459c90eb5` applied all 98 migrations twice, verified their ledger/checksums, confirmed
  migrations001–097 against baseline bytes and retained all 65 legacy raw-mutation rejection
  probes. Runtime access used a restricted non-owner role with forced RLS. All owned container,
  SSH-forward and lock resources were removed, OOM was false and all 14 original containers
  remained unchanged. There were 194 unselected integration skips; this is a targeted run.
  Private result: `/tmp/pollingpops-e10-spatial-pg/result-2459c90eb5.json`.

- **Four production-browser workflows pass:** Chromium and Firefox desktop, Chromium mobile
  and WebKit mobile. They exercise creation, explicit enablement, numeric/keyboard movement,
  undo/redo, reload, publication preview and hidden-frame pruning. A later publication cannot
  change an existing live session's geometry. All four delivery surfaces, real HTTP/guest Socket
  privacy, guarded navigation, linked recovery, unchanged windows/receipts/scores and preservation
  of the same unsent response controls pass. Camera transitions measure 300 ms normally and zero
  under reduced motion; the current frame remains visible above overlapping frames. Axe, native
  keyboard scrolling, dialog/footer geometry and strict 320px overflow checks pass. Desktop and
  mobile captures were visually inspected. The review-fix run also verifies real select-all and
  Backspace, character-by-character `640` entry, unchanged saved geometry before blur, persistence
  after blur and undo/redo between separately completed numeric edits. The final run completed
  with four passes in 2.6 minutes. Private log:
  `/tmp/pollingpops-e10-spatial-browser/review-fixes-browser.log`; captures:
  `/tmp/pollingpops-e10-spatial-browser/review-fixes-results/`.
- Browser qualification found and fixed compact-header access to **Arrange space**, accessible
  frame names, keyboard access to overflowing native text, reduced-motion specificity and dialog
  controls overlapping the footer. Both the real-browser checks and focused component/hook
  regressions cover the resulting behavior. Test-owned API/web listeners and Firefox directories
  were removed; ports14540/15540 are free and the real home directory was unchanged.

- **The full `VITEST_MAX_WORKERS=1 pnpm check` passes:** formatting, Docker workspace context,
  lint/typecheck (17 tasks each), all package tests, smoke-support tests, production builds
  (10 tasks) and admin CLI build. Principal totals are 910 contracts, 549 database, 1270 server,
  2639 web and 354 smoke-support tests passed. Normal opt-in integration skips remain; the eight
  real PostgreSQL cases above were qualified separately. Reader tests explicitly accept matching
  document14 and reject mismatched embedded/stored versions and unsupported document15.
  Private log: `/tmp/pollingpops-e10-pr202-reader-check.log`.
- The final source scope contains 54 files, with no package manifest or lockfile changes and
  exactly one new migration, `098_presentation_spatial.sql`. All 97 historical migrations match
  the merged E09 baseline byte for byte. No generated browser/PG artifacts are stored in the repo.

## Rollout and remaining qualification

Use the coordinated reader-first [upgrade procedure](../runbooks/upgrade.md#presentation-spatial-layout-compatibility).
Apply migration098 and deploy all compatible database/contracts/API/job/web readers before
admitting document14 writes. Disabling layout does not downgrade a document; retain a
document14-capable rollback image or use forward repair. Never rewrite frozen publication bytes,
accepted intents, live windows or historical reports to fit an older reader.

Hosted rollout, physical devices, manual assistive technology, observed creator task completion,
production capacity and operating-cost qualification remain separate evidence gates. Local
synthetic tests cannot establish those results. Deployment remains a separate step.
