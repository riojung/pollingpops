# Bounded Presentation scene architecture

Date: November 3, 2026

Status: selected in E00; E01 is implemented locally. Release qualification remains open.
Deployment and broader editor qualification remain separate work.

## Decision

Use a separately versioned, bounded Presentation scene for native slide content. Reuse pure Canvas
palette/shape schemas and shape geometry, plus existing slide geometry, while keeping Presentation
publication, media, navigation, assessment and reporting rules authoritative. Do not embed the
Canvas editor or adopt a Canvas board as a published slide.

E00 implements an independent `presentation_scene_prototype` artifact at version 1. It does not
add a production Presentation block type, widen a production mutation, allocate the next production
schema version, or migrate stored content. The ordinary Presentation v2 and Recovery Pack v3
contracts remain distinct from this experimental version number.

This follows the broad creator workflow and cost constraint in the
[implementation plan](../presentation-implementation-plan-2026-11.md). It is an architecture
experiment, not a claim of Genially/Prezi parity or a completed native presentation editor.

## Why this boundary

| Alternative                                          | Benefit                                                               | Decision                                                                                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Extend only the current region-based content slide   | Small initial change; existing publication and rendering              | Retain as a compatible source format, but it cannot by itself represent the planned multiple images, shapes, connectors and independent reading order              |
| Embed `CanvasEditor` or publish a board snapshot     | Existing selection, geometry and collaboration UI                     | Reject for E00: board/workshop access, moderation, source references, leases and retention differ from frozen Presentation content and durable session progression |
| Presentation-owned scene with pure shared primitives | A bounded slide model and renderer can grow with the creator workflow | Select; production integration must deliberately preserve existing publication and session guarantees                                                              |

The [Canvas decision](002-idea-board-canvas.md) remains authoritative for boards. Current Canvas
references in an authoring artifact are private authoring aids; this decision does not grant
Presentation viewers access to those boards or publish their guest content. Source moderation or
deletion cannot be bypassed by copying an old board layout.

The prototype adds no editor SDK, hosted collaboration service or model call. Its renderer owns
the small interaction surface being evaluated. More advanced editing must earn its implementation
and operating cost through creator tasks.

## Implemented E00 contract and renderer

[The prototype contract](../../packages/contracts/src/presentation-scene-prototype.ts) supports
plain title/body text, an image reference, a palette-colored shape and a connector between two
different non-connector nodes. Frames use finite percentages inside a fixed 16:9 stage. IDs are
stable; duplicate IDs, dangling endpoints, self-connections and unknown fields are rejected.
An explicit reading order lists every node exactly once, independently of its position.

Hard bounds are 50 nodes and 128 KiB of serialized UTF-8 JSON per scene. Text, identifiers, notes
and connector labels have additional field limits. These are admission bounds for a prototype,
not measured rendering or customer capacity.

The [scene view](../../apps/web/components/presentation-prototype/scene-view.tsx) uses DOM text and
closed SVG geometry. It reuses `CanvasColorSchema`, `CanvasShapeVariantSchema`,
`canvasShapeVariantPath`, `canvasDiagramShapePath` and their existing palette constants. It does
not accept SVG markup, HTML, executable actions or arbitrary asset URLs. Connector geometry follows
its target frames. The lab exposes selection, pointer/keyboard movement, a numeric frame inspector,
text/notes/image-description editing, shape/color controls and reading-order controls.

The same lab renderer supplies the visual stage and semantic reading view. Narrow screens use a
readable flow rather than shrinking the whole slide to tiny text. These mechanisms require browser
and assistive-technology verification; their existence is not a conformance claim.

The lab edits existing fixture nodes and navigates a fixed filmstrip. It does not yet provide
node/slide creation or deletion, rich text, grouping, undo/redo, themes, charts, live presenting,
production publishing or export.

## Fixture-only route and local persistence

The Server Component at `/dev/presentation-scene` calls `notFound()` unless
`NODE_ENV === "development"`, before rendering the separate client lab. It has no production
workspace entry point. A production build must keep the route unavailable; a client-side hidden
button would not provide this boundary.

The [fixture library](../../apps/web/lib/presentation-scene-fixtures.ts) contains original,
deterministic task material: a ten-slide business pitch, a five-slide product demo and a five-slide
training/workshop deck. These twenty slides are examples for observation, not customer evidence.
Their first slides exercise all four node types. No task timings or human success rates have been
measured by writing these fixtures.

[Local storage](../../apps/web/lib/presentation-scene-storage.ts) uses the separate key
`pollingpops:scene-lab:workspace:v1` and an independently versioned lab workspace with a 1 MiB UTF-8
JSON bound. Restore validates the exact bundled fixture/deck identities, slide identities/counts,
scene contracts and selected slide. Only the bundled image kind may be saved in this workspace.
The lab loads on mount and provides explicit **Save locally** and **Reload saved** actions. Storage
errors preserve the working copy or stored value rather than silently claiming a save succeeded.

The prototype does not write production Builder recovery, call Presentation mutation APIs or fetch
private image bytes. Local browser storage is not a durable, authenticated, concurrent or
cross-device document service. Two tabs can overwrite the same local copy; clearing browser storage
removes it. Only original fixture material belongs in this experiment.

## Legacy compatibility boundary

`adaptContentSlideToScenePrototype` is a deterministic, one-way adapter for an already current
`ContentSlideDraft`. It validates that source shape, retains text IDs/strings and speaker notes,
resolves current layout/explicit frames through `resolveContentSlideFrames`, and matches the
existing renderer's region/order/ID reading order. It does not mutate the source.

The prototype uses stricter control-character validation than legacy text/IDs. Such a source may
be schema-valid for the old renderer yet fail this bounded preview adapter; rejection leaves it
unchanged. The adapter never sanitizes or truncates historical content to force conversion.

If a source slide references an image, the adapter retains the private media ID as
`legacy_private_media` and derives a noncolliding image-node ID. The lab view shows a placeholder
for that kind and never treats possession of an ID as permission to read bytes. Drafts may retain
incomplete image descriptions; publish-ready accessibility validation is a separate responsibility.

This adapter is not a full-deck migration. It does not carry slide citations/source disclosures,
deck metadata, Recovery Pack baselines or questions into a native scene, and it cannot be used as a
round-trip writer. The source document remains authoritative. Older v1 title/body documents first use the
existing production upcaster; the prototype does not invent a second legacy interpretation.

Production [artifact readers](../../packages/db/src/artifact-schemas.ts) continue to support legacy
v1, ordinary v2 and Pack-bearing v3. Frozen Pack originals/update baselines, question provenance,
session-only insertion metadata, stored content hashes and accepted mutation fingerprints must
survive unchanged. Existing Pack schema and media tests remain required evidence; adapting one
content slide does not validate those other surfaces.

## Production integration is a coordinated E01 change

Two integration boundaries prevent turning the prototype on merely by adding its renderer:

1. **Content-only publication requires a compatible lifecycle and readers.** The E00 baseline
   required an interactive/main question. The first E01 slice now supports question-free decks
   using existing slides, with verified terminal navigation, durable reports and neutral
   completion/projection behavior. Keep that lifecycle support and its reader floor when adding
   native scenes; a permissive renderer alone is insufficient.
2. **Node assets are absent from production retention visitors.** The publish route validates
   current block/question media and frozen Pack baselines. JS `presentationMediaIds` and SQL
   `openround_presentation_media_ids` retain the same families across drafts, immutable versions
   and history. New scene image references require matching publish validation, authorization,
   retention/export and cleanup changes before any production writer accepts them.

The subsequent E01 content-only slice resolves the first policy/lifecycle constraint using existing
content slides. It preserves the scene integration boundary: production still does not accept the
experimental scene artifact. The [upgrade runbook](../runbooks/upgrade.md#content-only-presentation-compatibility)
defines the new reader floor and writer cutover; old readers cannot consume the newly allowed decks.

Do not rewrite applied migrations or immutable published rows. Select the next production schema
version after auditing all draft, content, live-session, report and Recovery Pack readers/writers.
An old process that drops newly introduced references is not a safe writer or cleanup rollback.
Define deployment/rollback requirements with the migration rather than relying on the lab version.

### First E01 vertical slice

Proposed scope: create/edit/save/reload/publish/present a bounded native text, image and basic-shape
slide in an ordinary deck, without requiring an assessment. Keep existing question blocks and
recovery flows interoperable. E01 may be split into coherent PRs, but its slice is complete only
when its persistence, publication and delivery guarantees work together.

Candidate module boundaries, to confirm before implementation:

- `packages/contracts/src/presentation-scene.ts`: production node/document schema, bounds and
  deterministic adapters; production version selected explicitly rather than copied from the lab.
- `apps/web/components/presentation/scene-view.tsx` and bounded editor components: shared authorized
  renderer and editing controls, with semantic order and a readable narrow-screen alternative.
- Existing Presentation builder/helpers and `packages/db/src/presentations.ts`: stable IDs,
  revision conflicts, local recovery, history, immutable publication and exact retry behavior.
- A shared scene-media visitor, publish validation and a new SQL migration: retain every authorized
  node asset across draft/version/history, with scan, workspace and lifecycle checks.
- Existing session rules/projections/reporting: content-only progression/finish and useful empty-
  assessment outcomes, without exposing notes, keys or moderator information.

Acceptance for the slice:

- A creator completes the whole workflow with a content-only deck and with a mixed deck; content
  navigation reaches a defined end, while existing main/recheck semantics and scores still work.
- Save/reload and conflict/retry recovery preserve unsaved text, IDs, geometry, semantic order and
  private assets. Memory/PostgreSQL implementations agree. An accepted retry remains the same request.
- v1/v2/v3 fixtures still read/render; Pack baselines, source metadata and immutable hashes are
  retained. The prototype artifact remains rejected by production mutations.
- Images require correct workspace ownership, clean scans and suitable accessibility metadata.
  Draft/version/history references protect retained bytes; removal/expiry/deletion and failed writes
  leave no unauthorized read or leaked orphan. JS and SQL collectors agree.
- Host, audience and future share/export projections are deliberately distinct. Notes, answer keys,
  private metadata and unrestricted asset URLs never enter a recipient projection.
- Keyboard editing, focus, semantic reading order and narrow-screen rendering are verified on
  representative tasks. Relevant compatibility, repository and browser tests pass before rollout.

## First production native-scene increment

The first E01 native increment uses embedded Presentation version 4 and a separately versioned
public scene. At that increment, [the production contract](../../packages/contracts/src/presentation-scene.ts)
used `schemaVersion: 1`, a fixed 16:9 aspect ratio, bounded nodes and an explicit reading
order. It is separate from the experimental artifact. Plain text, private image references,
palette-colored labeled shapes and connectors are supported. Notes, citations, source disclosures,
question answers and arbitrary URLs/markup are absent from the scene.

A native slide remains a `kind: content` block. Its scene is authoritative; legacy `textElements`
is empty and `mediaId`/`mediaAlt` are null. Structured slides keep their existing representation and
renderer. Version-2/3 documents cannot contain scenes. Existing v1/v2/v3 upcasters, default version
2, parsed JSON ordering and immutable hashes remain intact; no stored content is rewritten.
Pack insertion preserves version 4 rather than downgrading a native deck to version 3.

There are at most 50 nodes and 128 KiB of UTF-8 JSON per scene, and 3 MiB per version-4 draft/content
document including frozen baselines. IDs are unique and stable; reading order lists every node
once. Connectors reference distinct existing non-connector nodes. Exactly one title node remains
available while drafting. Publication requires meaningful slide content, descriptions for every
image and labels for shapes. These are admission limits, not measured customer capacity.

The [production adapter](../../packages/contracts/src/presentation-scene-adapter.ts) explicitly
converts a current structured slide. It retains block identity, notes, citations and source
metadata, moves text/media into scene nodes, and clears the legacy visual slots. It preserves
reading order and resolved geometry, and rejects an incompatible source without sanitizing or
truncating it. Conversion is an authoring operation covered by the existing undo/recovery flow;
historical drafts and immutable versions are not automatically converted.

The builder adds native slide creation, plain text, multiple scanned images, labeled shapes,
connectors, selection, numeric geometry, keyboard movement/resizing and reading-order controls.
Duplication remaps nodes, edges and reading order together; node deletion cascades to its edges.
All document changes use existing revision-fenced autosave, undo/redo, retry, recovery and conflict
review. The shared native renderer serves editor, preview and live views, while the caller supplies
an authorized image renderer. Narrow screens use semantic reading order in a readable column.

Media visitors now cover scene image nodes alongside existing block/question media and frozen
Pack baselines. Migration 089 updates the SQL visitor and backfills draft/version/history edges;
publish validation and current-slide session access enforce workspace, scan and lifecycle rules.
Audience projections explicitly include public scene data and omit private block metadata.
Reports derive native titles from the frozen scene. See the
[upgrade requirements](../runbooks/upgrade.md#native-presentation-scene-compatibility) before enabling
version-4 writers or selecting a rollback image.

This first increment did not complete E01. Later increments below cover pointer editing,
multiselection and rich text; the E02 sections add design and composition. Creator, device and
assistive-technology acceptance remain separate qualifications. The
[native verification record](../evidence/presentation-native-scenes.md) separates executed local
checks from those outstanding observations.

## Structured text increment

Explicit formatting opts a text object into closed paragraph/run content, promotes its scene to
version 2 and its document to version 5 in the same authoring mutation. Plain `text` remains a
required exact fallback for existing title, label and reporting paths. Legacy scene-v1 documents
are parsed and rendered without added fields or automatic conversion. Scene v1 is also valid in
v5 documents so adding ordinary native slides never downgrades formatted decks.

Runs support bold, italic and absolute safe HTTP(S) links; body paragraphs support flat bullet and
numbered lists. Renderers use escaped semantic React elements, never persisted HTML or arbitrary
styles. Links explicitly open new tabs without opener/referrer access and remain inactive in the
editor. Ordinary edits and plain-text paste preserve unchanged spans; invalid or over-budget edits
retain the previous content. Paragraph/run/character bounds sit within existing scene and native
document byte limits. Persistent selection, nested markup and paid editor dependencies are absent.

Pack insertion, persisted readers and session projections retain v5 and unchanged frozen baselines.
Media paths and migration 089 remain unchanged. Old strict clients cannot read scene v2 merely
because a text fallback exists; the
[reader rollout](../runbooks/upgrade.md#native-presentation-rich-text-compatibility) is coordinated.
The [rich-text verification record](../evidence/presentation-rich-text.md) records the executed
checks and remaining qualifications.

## Visibility and durable-save completion

Presentation document v6 adds an optional `hidden: true` only to visual content slides. It does not
change scene v1/v2, default document v2, mutation envelope v2 or stored legacy JSON/hashes. Hidden
slides remain fully validated and retained in drafts/history/export. Activities reject the flag.

`preparePresentationPublication` removes hidden blocks before preview, publish validation and
media admission. Published content rejects hidden flags and empty results. Immutable versions and
live/report traversal therefore contain only visible blocks, with their original IDs and order.
Hidden draft/history assets remain retained; a pending hidden asset cannot block visible publication.
The v6 session reader is strict rather than using the legacy partial-draft fallback.

Ordinary saves persist an immutable mutation envelope before sending it. Unknown outcomes retain
that envelope across bounded transport retries, manual Retry and browser refresh. Accepted receipts
settle before newer writes; historical receipts never grant permission to rebase divergent local
work silently. Local recovery with a different base offers preview, download or duplication.
Definitive request rejection releases the pending attempt so a corrected draft can be submitted.

Filmstrip movement preserves source-before-recheck topology. Removing a diagnostic normalizes its
orphan recheck; copying a recheck creates a standalone activity. Existing IDs and Pack baselines
remain intact. See the [E01 acceptance record](../evidence/presentation-e01-completion.md) and
[compatible-reader rollout](../runbooks/upgrade.md#presentation-slide-visibility-and-save-recovery-compatibility).

## E02 native design foundation

Explicit design/image actions opt into scene v3/document v7; geometry-only arrangement remains
compatible with the existing scene version. Optional `design` contains closed theme/font/spacing
tokens without parser defaults. Images may specify contain/cover and a bounded focal point; they
retain the same private media ID. Old documents reject new fields rather than silently stripping
them, and old JSON/hash fixtures remain unchanged.

The shared native renderer resolves fixed colors and local system fonts. Design controls, preview
and delivery use that renderer; semantic narrow layouts retain reading order and complete images.
Layout presets require compatible object combinations and change only frames. Alignment and
distribution preserve bounds; visual layer changes reorder nodes independently of reading order.
Applying a design across existing native slides is one history operation and validates the entire
document budget before changing the draft. It preserves content, IDs, hidden state, private metadata
and frozen baselines, without converting ordinary slides or changing activities.

There is no new media visitor path, migration, SDK, font service or paid entitlement. The
[v7 rollout](../runbooks/upgrade.md#native-presentation-design-compatibility) coordinates readers and
writers. The [verification record](../evidence/presentation-design-foundation.md) covers this first
E02 increment. The following composition increment extends the format and authoring surfaces.

## E02 composition, inline data and scenario decks

Optional flat groups, bounded rotation and editable table/chart nodes opt into **scene v4 and
Presentation document v8**. Older scene/document JSON and hashes remain unchanged, and parsers do
not add group or rotation defaults. Default API creation remains document v2; the explicit blank
web starter remains document v7/scene v3 until a new feature is applied. The mutation envelope is
still v2. New native scenario factories explicitly produce v8/scene4; the nine existing facilitated
templates remain v2.

Groups reference existing framed-node IDs, are disjoint and do not nest or contain connectors.
Selection, movement, proportional resizing, alignment and layers respect group membership while
preserving reading order. Rotation uses physical 16:9 coordinates; both raw frames and rotated
painted bounds must remain inside the slide. Connectors follow transformed endpoints. The shared
narrow reading view retains semantic order and renders readable, unrotated content. Local
six-screen-pixel movement snapping supplies temporary guides; Alt bypasses snapping and Escape
cancels the gesture. Guide state and tolerance are not persisted.

Tables contain a caption, up to six headings and 20 rectangular rows of literal text. Charts
contain a title, authored summary, up to 20 categories and four finite numeric series; pie charts
use one nonnegative series with a positive total. The existing scene/document budgets still apply.
CSV/TSV paste and cell edits are staged locally. **Preview pasted data** changes the staging grid;
**Apply table changes**/**Apply chart changes** validates and creates one discrete history edit;
**Discard staged changes** restores current object data. Invalid input leaves the authored object
unchanged and retains the staged correction. Charts render deterministic local SVG with the full
data table and summary; no charting service, formula engine or live spreadsheet sync is introduced.

The catalogue adds 12 original, eight-slide ordinary scenarios: startup pitch, client proposal,
project update, quarterly strategy, portfolio case study, event talk, product demo, customer
onboarding, practical workshop, lesson/explainer, research findings and business decision brief.
All work without required activities and identify their sample stories/data as illustrative.
Speaker notes retain adaptation guidance and the full explanatory copy behind short data/column
leads. Factories create independent IDs and no private media references or external assets.
The combined catalogue contains 21 templates. Shared-renderer thumbnails and a navigable
read-only preview mount only the active preview slide; creation separately stages the exact draft
and retains its revision/mutation identity for an uncertain-save retry.

Video scope is an explicit external HTTPS link plus a required captions/transcript fallback,
encoded through existing rich text. No provider iframe, SDK, metadata request, remote thumbnail,
availability probe or uploaded-video transcoding is introduced. Links open only after an audience
click, with opener/referrer protection. The existing CSP remains unchanged; an embedded player
would require its own policy and acceptance decision.

No additional SQL migration or media-reference visitor path is required. Migration 089 remains
authoritative for scene images. Deploy matching v8 readers, clients and workers before admitting
v8 writers; once v8 data exists, rollback requires a v8-compatible image or forward repair. See the
[composition reader rollout](../runbooks/upgrade.md#native-presentation-composition-compatibility).
Feature/workspace policies, entitlements and authoring roles are unchanged. This implementation
does not establish deployment qualification, human usability, assistive-technology or
physical-device acceptance, native-browser zoom behavior, capacity or operating cost.

## Verification and open evidence

The [prototype evidence record](../evidence/presentation-scene-prototype.md) identifies the fixtures,
test surfaces and observations still required. Source inspection supports this architecture
decision; it does not establish creator usability, real-device accessibility, export fidelity,
runtime performance or operating cost. Those results must be recorded after execution.
