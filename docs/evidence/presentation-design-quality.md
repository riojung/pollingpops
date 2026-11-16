# Presentation design-quality gap closure

Source: `codex/presentation-design-quality`, from merged UX foundation `59ba78e` (PR #217).
This is a selected phase-2 creator improvement, not a complete E00–E14 or competitor-parity claim.

## Creator workflow

Wide native text, spacing and data now scale with the slide rather than independently of its
authored frames. Opening the editor rails should not introduce overflow that disappears in a
larger preview. At the canonical 1280×720 plane, existing text sizes and spacing are retained;
ordinary phone delivery still shows complete content in a readable semantic column. Authored
overflow remains scrollable and reported; no wording is truncated or automatically rewritten.
Fit feedback waits for slide fonts and does not claim wide-frame fit from the phone reader.

The Layout inspector integrates the earlier PR #207 proposal: compare up to three deterministic
alternatives for one title/body with an optional table, read the complete content and apply one
reviewed frame edit. Cancel/Escape leaves the draft untouched. Apply uses normal validation,
autosave and one Undo step. Text, rich formatting, links, language, table values, reading order,
provenance and publication remain intact. Groups, rotation and other mixed compositions retain
manual tools. Resize keeps an open review and its invoking inspector visible.

Visible filmstrip rows now display private images with the normal crop and focal-point renderer.
Image readers use the existing creator media authorization endpoint and scoped in-memory URL
state. Offscreen rows and closed panels release readers; missing, unauthorized and failed images
show placeholders. These are original image assets, not generated lower-byte thumbnails. No
image URL is written into the slide, browser storage or a public delivery surface.

## Architecture and cost boundary

- Stored scene/document formats and immutable published content are unchanged. Wide rendering
  uses proportional type/spacing; its appearance at other canvas sizes intentionally improves.
- The shared web renderer supplies editor, review, filmstrip and normal browser delivery.
  Server static export retains its existing canonical canvas renderer and device/font limits.
- Layout generation is local and bounded. Ordinary editing and these alternatives require no
  model, credits, paid canvas SDK, new service, dependency or database migration.
- Filmstrip authorization is coalesced for mounted readers within an actor/workspace/deck/media
  scope. It does not replace the selected canvas's existing media reader or produce smaller
  storage objects. Hosted image bandwidth and generated small-thumbnail economics remain to be
  measured; no new customer price or capacity result is claimed.

The thumbnail queue permits three concurrent metadata authorizations. Mounted readers reauthorize
before the existing five-minute storage URL lifetime (normally after four minutes, sooner when
the returned signature expires earlier). There is no persistent cache or interval after the last
reader leaves. Authentication/workspace changes invalidate current readers and fence late
responses; a new mount requires fresh server authorization, including for the same account.
Text/frame edits keep existing thumbnail readers mounted. Signed-image loading failures and
authorization failures stay placeholders until a fresh mount.

## Verification

- Final `VITEST_MAX_WORKERS=1 pnpm check` passes: **6,964 tests**, formatting, lint, typing,
  Docker-context validation, all four builds and the compiled-server startup/configuration smoke.
  The **513 standard opt-in skips** remain explicit (497 database, 15 server, one support).
- **34 distinct selected production-browser cases are verified** across desktop Chromium/Firefox
  and phone Chromium/WebKit (9/9/8/8). The final-source combined run passed 33 cases; the remaining
  Chromium-phone export hit the normal per-account throttle after sharing one fixture across
  profiles. It passed separately with a fresh API fixture and the same production artifact.
  Limits, timeouts, assertions and production code were not changed to bypass the throttle.
- Browser coverage includes actual broad/constrained text/data overflow, original template
  title/table/chart content, deliberate overflow and keyboard scrolling, readable phone content,
  crop/focal fidelity, visible-only media authorization, cancellation, late-result fencing,
  same-account reauthorization, unchanged-image reader retention, layout Cancel/focus/resize,
  Undo/Redo/reload, metadata/publication preservation, rich text and actual PDF/PNG/HTML/offline
  downloads. Layout review also checks 320px overflow and automated Axe results.
- Thumbnail browser responses use synthetic private assets to isolate rendering and reader
  lifetime. Existing server ownership/scanner tests remain the authority; this is not hosted
  storage/scanner qualification. Browser specs pass strict TypeScript, lint and formatting.
- Desktop constrained/broad, 320px layout-review and phone reading captures were visually
  inspected. This is automated/local screenshot evidence, not physical-device, manual
  assistive-technology or observed creator-task qualification. Independent read-only review found
  no remaining actionable issue in the changed source.

The initial design-quality browser qualification uses source digest
`a0ec91a2f3e761bdd76d3e81357efbca39a03dcf53c893d48a5d4daf49eca186` and artifact digest
`9f6dbb6c750a664f5571f09c2334d5a6bfad551199b85e9a7db27c59cedcfa48`.
Local records are `/tmp/pdq/full-check.log`, `/tmp/pdq/browser.log` and
`/tmp/pdq/export-isolated.log`; captures/downloads are in the matching result directories.
Earlier PR #207 verification is historical and does not independently qualify this integrated
editor source.

## Review follow-up: activity image overlap

The activity thumbnail image now occupies a normal-flow, two-column header beside its prompt.
Answer and response rows span the full width below that header. Explicit choice line height and
slightly tighter media-card padding retain all four rows when the first label wraps. Image-free
cards keep their existing arrangement; loading or unavailable images keep the same header space.

Eight production-browser cases pass across the four profiles: the existing image-reader journey
and a new activity-layout journey per profile. Each new case checks short/two-line prompts with
ready, absent and unavailable images, a wrapping first answer, all four rows inside the 960×540
plane and actual image/answer nonintersection. Private image policy, inert previews and no-referrer
behavior remain covered. Desktop ready/unavailable captures were also visually inspected.
The 20 focused thumbnail/chrome unit tests, browser-spec strict typing and lint pass.
The final `VITEST_MAX_WORKERS=1 pnpm check` also passes: 6,964 tests, all four builds and the
compiled-server startup/configuration smoke, with the same 513 standard opt-in skips.

The follow-up artifact uses source digest
`c2eef07ee18399c6d0808b534bbf9f9cee6bdacd675185e946af043a5ab55577` and artifact digest
`5cf3502b10704d7e272bcef7c05d3a3e56e9d866b900ba5706198093db64e5d7`.
Local records are in `/tmp/pdq-review-fix/`. The original review finding is resolved; no schema,
API, media authorization or publication behavior changes.

## Remaining gaps

Full mixed-object/image/chart layout alternatives, whole-deck design, automatic content repair,
generated small raster thumbnails, physical-device/manual assistive-technology qualification and
observed pitch/proposal/demo creator tasks remain open. Visual inspection also retains an editor
polish item: move/resize handles at frame edges can cover nearby object text in a constrained
canvas. Refine their placement and interaction discoverability in the next design slice.
The following UX phase covers rehearsal,
presenter/share-mode discoverability and recipient/version clarity. Deeper E08–E14 candidates
remain independently scoped in the implementation plan.
