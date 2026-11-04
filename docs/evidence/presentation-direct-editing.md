# Native Presentation direct-editing verification

Date: November 3, 2026. Base: `13d58b1` after PR 183. Working branch:
`codex/presentation-direct-editing`.

This E01 increment adds desktop pointer movement and bottom-right resizing, temporary
multiselection and group movement/deletion to existing native slides. It introduces no dependency,
service, schema version, database migration or commercial entitlement.

## Boundaries

- Pointer moves preview locally. A release commits one scene through existing autosave and
  history; Escape, pointer cancellation or an invalidated gesture discards the preview.
- Selected framed nodes share one bounded translation, preserving their relative positions.
  Resizing applies to one object and preserves its top-left corner. Connectors follow endpoints.
- Selection never becomes document content. IDs, media references and semantic reading order
  stay unchanged during movement. Deletion removes dependent connectors and protects the title.
- Narrow screens retain semantic reading order, normal scrolling and keyboard/numeric controls.
  Pointer geometry is disabled in the reading column. No audience editing controls are introduced.

## Verification

The focused run passed 80 tests across seven suites: geometry and deletion (14), pointer lifecycle
(10), editor selection/upload guards (5), shared renderer (7), plus native draft/recovery and builder
regressions. Web type checking, changed-file ESLint, formatting and diff checks passed.

The development browser matrix passed all 14 cases with zero retries in desktop Chromium/Firefox
and mobile Chromium/WebKit. Six cases cover direct editing and selection. The eight existing native
cases cover publication/live delivery, dense mobile overlays and retained image uploads. The direct
editing cases use real draft APIs and persistence without response stubs. The pre-existing upload
race controls storage/scanner timing with response stubs as described in the
[native-scene record](presentation-native-scenes.md#pr-183-follow-up-retained-image-attachments).

Pointer assertions inspect the local preview before release and independently confirm that the
server draft has not changed. They then verify autosave, whole-gesture Undo/Redo, Escape and
pointer cancellation, group clamping at the slide edge, preserved IDs/endpoints/reading order and
reload. Selection tests exercise group keyboard movement and buttons, atomic deletion of nodes
and connectors, and Undo on all four browser projects. Unit cases additionally cover lost capture,
unmount, stale scenes before effects run, invalid geometry and narrow-screen touch scrolling.

The first browser run exposed duplicate history checkpoints when React replayed the existing
builder's draft updater. Appending the same snapshot is now idempotent. The consecutive Undo
regression failed before this guard and passed afterward; canceled previews add no history steps.
The initial Firefox pointer-cancel fixture also assumed Chromium's pointer ID; it now uses the
actual observed pointer ID. No assertion or timeout was relaxed. Independent read-only review
found no further actionable issue, including in the history guard.

The production Next.js build passed. The pointer journey then passed against that build in both
desktop Chromium and Firefox with zero retries. This final journey starts by dragging the object
body directly, then exercises resize/move handles, cancellation, grouped edge movement, consecutive
Undo and reload. Screenshot inspection confirmed selection outlines and move/resize controls in
the existing desktop builder layout.

Reproduce from the repository root:

```sh
pnpm --filter @openround/web exec vitest run lib/presentation-builder.test.ts lib/presentation-native-scene.test.ts lib/presentation-native-geometry.test.ts components/presentation/native-scene-canvas.test.tsx components/presentation/native-scene-editor.test.tsx components/presentation/native-scene-view.test.tsx components/presentation/presentation-builder.test.tsx
pnpm --filter @openround/web typecheck
pnpm exec playwright test --config=playwright.beta.config.ts tests/beta-e2e/presentation-direct-editing.spec.ts tests/beta-e2e/presentation-native-scenes.spec.ts
PLAYWRIGHT_PRODUCTION=true pnpm exec playwright test --config=playwright.beta.config.ts tests/beta-e2e/presentation-direct-editing.spec.ts --grep 'native pointer gestures'
```

The browser harness owns disposable in-memory API state and loopback web processes; Firefox may
require isolated `MOZ_APP_DATA` and `MOZ_LOCAL_APP_DATA` directories on macOS. Backend contracts,
SQL and media authorization are unchanged in this increment. The earlier full-repository and
PostgreSQL checks are historical evidence for the foundation, not new runs for this web change.

## Remaining work

Rich text, persistent grouping, marquee selection, multi-object scaling, slide hiding and advanced
design tools remain open. This is local implementation evidence, with no physical-device,
assistive-technology, human task-time, deployed-capacity or competitor-parity claim.
