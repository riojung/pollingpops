# Presentation editing controls and interaction clarity

Source: `codex/presentation-interaction-polish`, from `3adc205` (merged PR #218).
This closes the next selected creator-UX gaps without extending the interaction protocol.

## Creator experience

The native editor moves geometry controls out of authored content into a normal-flow selected
object toolbar. The Canvas object selector follows reading order; Move/Resize apply to the
current selection, with group resizing through the existing geometry path. Wide slides retain
pointer previews, snapping, cancellation and one commit on release. Arrow keys and Shift steps
remain available; phones keep readable content and scrolling. Connections retain their inspector
editing path. Selection outlines remain on the slide, while geometry buttons do not cover text,
images or edge/rotated frames. Standalone renderer callers retain their existing fallback.

The toolbar exposes an Interactions picker separately from tables/charts. Successful insertion
selects the action, opens its Content tools and closes the picker; rejected insertion preserves
the current content and picker. Its overview explains the action's trigger, result and audience,
and gives concrete guidance for missing labels, detail content, image association or destinations.
Hotspot guidance checks image rotation and containment; slide links use the existing available
target list, including linked-question boundaries.

Preview this slide opens the current visible slide after hidden-slide filtering. It reuses the
existing review renderer: reveals run locally, details open on this screen and slide links move
through the preview. A broadcast reveal does not issue a live command from this preview. Ordinary
header/path/recovery previews retain their first-slide entry. Local or rejected URL entries block
the contextual preview even after selecting another action, until the entry is corrected or
invalidated by a recovered/undone destination. Unsafe values never enter history or autosave.

Context preview explicitly records its invoking button for Safari focus return. Drawer behavior
respects an open preview, including a desktop-to-phone breakpoint change; resizing does not focus
the panel behind it. Escape closes nested details before the preview and returns to visible tools.

## Boundaries

Document/scene formats, geometry helpers, immutable publication, role authority and server command
paths retain their meanings. No session, publication or response is created by preview. No new
service, dependency, media storage object, model call or AI credits are required. Private media
continues through existing creator authorization. These are editor workflow refinements rather
than new scripting, variables, games, host-broadcast or offline interaction capabilities.

## Verification

- Final `VITEST_MAX_WORKERS=1 pnpm check` passes: **6,986 tests**, formatting, lint, typing,
  Docker-context validation, all four builds and compiled-server startup/configuration smoke.
  **513 standard opt-in skips** remain (497 database, 15 server, one support).
- **138 focused unit cases** pass across the editor, interaction overview/entries, builder and
  geometry suites. This overlaps the full repository count. Coverage includes accepted/rejected
  insertion, frame/group keyboard/pointer behavior, URL-entry retention and selected-action
  readiness; it does not replace real-browser focus checks.
- **40 production-browser cases pass** across Chromium/Firefox desktop and Chromium/WebKit phone
  profiles (11/11/9/9), using one frozen production artifact and a fresh API fixture per profile.
  Existing native editing, composition, upload/history recovery, template fit, live interaction,
  publication and audience-authority assertions remain intact alongside the new workflows.
- The new cases check control/frame nonintersection at edges and rotations, group resizing,
  keyboard-only native selection and geometry, no-op boundaries, pointer preview/cancellation,
  one release commit, Undo/Redo, readable phone content and CSS zoom at 200%. Context preview is
  tested after hidden-slide filtering, with uppercase navigation IDs, local/broadcast reveals,
  details, safe links, retained invalid URL entries, insertion/readiness guidance, 320px overflow,
  automated Axe and focus after nested Escape and a breakpoint change. Preview phases retain the
  complete API record/revision and create no session, publish, response or external-site request.
- The Escape regression specifically checks Next's document-level React/native event ordering:
  a handled preview Escape must not also close the invoking inspector. The drawer respects
  `defaultPrevented` as well as mounted modal markers. Native keyboard selection uses reading-order
  typeahead and retains the real keyboard movement/resize assertions.
- Desktop clear-content, 200%-zoom and phone editing captures, plus 320px interaction preview,
  were inspected. Browser fixtures use synthetic/local media and do not qualify hosted storage,
  scanning, capacity or cost. Manual assistive-technology, physical-device and observed creator
  tasks remain open. Independent read-only review found no remaining actionable application issue
  after the resize-focus fix; the browser run additionally verified the handled-Escape fix.

Source digest: `00eab92dd5f1d9e05fc1b45b67a81704914d7b5d880329925c4bb884746c04ab`.
Artifact digest: `62eac1ea32e6deb762a0816c9368fab52bdd8aed7cdd6a3ca944b1bbf9e508fc`.
Local qualification records are `/tmp/pip/full-check.log`, `/tmp/pip/browser-results.json` and the
four profile logs/result directories under `/tmp/pip/`. Earlier failed exploratory runs are not
included in the final passing counts above.

## Next gaps

Visual trigger/target connections, further small-screen toolbar-density refinements, broader
mixed-object design assistance, presenter/rehearsal and
sharing/version-mode clarity remain design work. The larger E00–E14 gap map remains authoritative;
this slice does not establish competitor parity or satisfy hosted/cost/release evidence gates.
