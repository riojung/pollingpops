# Bounded Presentation scene architecture

Date: November 3, 2026

Status: selected in E00; the first production native-scene E01 slice is implemented locally.
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
public scene. [The production contract](../../packages/contracts/src/presentation-scene.ts)
contains only `schemaVersion: 1`, a fixed 16:9 aspect ratio, bounded nodes and an explicit reading
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

This increment does not complete E01. Rich text, pointer dragging, multiselection, grouping,
advanced themes and creator/device/accessibility acceptance remain open. The
[native verification record](../evidence/presentation-native-scenes.md) separates executed local
checks from those outstanding observations.

## Verification and open evidence

The [prototype evidence record](../evidence/presentation-scene-prototype.md) identifies the fixtures,
test surfaces and observations still required. Source inspection supports this architecture
decision; it does not establish creator usability, real-device accessibility, export fidelity,
runtime performance or operating cost. Those results must be recorded after execution.
