# Reviewed native layout suggestions

Original proposal: `codex/presentation-layout-suggestions`, from selected-text assistance baseline
`48429d7d10294dc021fe52e9c3f6f38b18687ae1` (PR #206). The November 9
`codex/presentation-design-quality` source integrates it into the contextual Layout inspector;
see the [current design-quality record](presentation-design-quality.md) for qualification of
that integrated source. The proposal results below are historical, not new validation results.

## Creator workflow and cost

In the **Layout** inspector, choose **Suggest layouts** on a native slide with one title and one body, optionally with one
table. Select among up to three local alternatives, compare the current and selected placements,
inspect actual rendered-font fit feedback and read complete text/table content. **Apply reviewed
layout** makes one ordinary, independently undoable frame edit. **Cancel**, Escape and closing
the review leave the slide unchanged. Autosave, recovery, conflict review and publication keep
their existing controls.

The existing six manual presets mostly offer one eligible arrangement per supported object
combination. Nineteen bundled title/lead/table slides match none of those presets. This increment
adds useful alternatives for those slides and common title/body content. Local character and
line density guide ordering and geometry; they do not prove that content fits. No model,
provider call, AI job/allowance, service, dependency, entitlement, migration or persisted-content
version is introduced. Translation and model-generated design remain separate E12 scope.

## Preservation and preview boundary

The candidate engine accepts exactly two text objects (one title/body each), with an optional
table. It declines invalid scenes, groups, nonzero rotation, unsupported nodes/compositions and
alternatives exceeding existing scene limits. It returns at most three deterministic, distinct,
bounded, nonoverlapping candidates and omits current-geometry no-ops. Only frames change.
Rich text, links, IDs, reading order, table values, design and scene versions are preserved.
Normal deck application retains citations, source disclosure, latest AI text-edit metadata,
other blocks, document versions and published versions.

Review uses the shared renderer on separate fixed 1280×720 planes, scaled into the available
space. The render-only `fixedLayout` option suppresses phone scene/table reflow for these previews;
ordinary delivery retains its existing responsive reading view. Decorative planes are inert and
hidden from assistive technology, with a complete unscaled reading copy alongside them. Separate
fit-feedback roots inspect actual text/data overflow after fonts load and recheck font/resize
changes. Unmeasurable previews retain guidance; stacked phone reading views make no wide-fit
claim. Fit remains specific to the current preview/device fonts.

The native modal keeps focus within review and restores the trigger on close. Current scene,
block identity, permission and selected-candidate checks reject stale Apply events. Applying
passes through normal scene/deck validation once without a history coalescing key; a rejected
change keeps review open. Media work and other mutation barriers disable this action. There is
no independent recovery queue or second draft-writing path.

## Original proposal verification

- Candidate-engine and existing manual-design/template/deck-design suites: **103 tests pass**,
  including 16 new engine cases and all 19 bundled title/lead/table fixtures. Coverage includes
  source immutability, rich-text/link/data/style preservation, scene versions 1–6, document15
  provenance retention, frame bounds/nonoverlap, no-op filtering and near-128KiB refusal.
- Review/renderer/fit suites: **78 focused tests pass**. A final **49-test** subset also passes
  after modal style isolation; these are overlapping suites, not additional test totals.
- Editor and builder integration: **80 tests pass** across two suites, including normal
  validation, media/permission barriers and one independent history step. Web typing,
  browser-spec strict TypeScript and scoped ESLint pass.
- Production-browser qualification: **24 workflows pass** across Chromium and Firefox desktop,
  Chromium mobile and WebKit mobile (7/7/5/5), against a fresh production build and memory API
  with AI disabled. The four specifications cover reviewed layout application, existing design,
  composition and synthetic image framing. Assertions include Cancel/focus, one save revision,
  Undo/Redo/reload, exact frame-free content/metadata preservation, unchanged publication and AI
  allowance, zero authoring job calls, fixed 1280px preview planes at 320px, readable table content,
  zero Axe violations, no document overflow, inline radios and an unwrapped Close control.
  Ordinary phone tables and accessible-outline grid/padding/type styles also retain their existing
  behavior. Final Chromium desktop and 320px Chromium/WebKit captures were visually inspected
  after modal CSS isolation.
  Local results: `/tmp/pollingpops-layout-suggestions-browser/layout-final-ui-result.json`.
- Full repository qualification: **`VITEST_MAX_WORKERS=1 pnpm check` passes**, including formatting,
  Docker-context checks, lint, types, unit/smoke-support tests and all builds. Major suite totals:
  925 contracts, 575 database, 1,381 server, **2,843 web** and 354 smoke-support tests pass.
  PostgreSQL/Redis opt-in suites were not enabled for this frontend increment; their existing
  skips remain explicit. The check completed in 226.8 seconds with normal file-creation
  permissions and private logs at `/tmp/pollingpops-layout-check.log`.

## Remaining scope

These are bounded geometry alternatives for the supported text/table compositions. Group-aware
layout, images/charts/mixed diagrams, typography changes, whole-deck design generation and AI
layout proposals remain later work. Selected plain-text translation and question suggestions were
implemented in separate later increments; rich-text rewriting remains open. Hosted rollout, physical-device/manual accessibility and measured creator
task acceptance remain separate from local software verification.
