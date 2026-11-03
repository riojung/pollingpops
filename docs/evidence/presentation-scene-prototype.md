# Presentation scene E00 prototype record

Date: November 3, 2026

Scope: the isolated development lab selected in
[ADR 003](../decisions/003-presentation-scene.md). This record does not accept a production rollout
or change Presentation publication, billing, live-session capacity or existing evidence gates.

## Reproducible task material

Open `/dev/presentation-scene` on the local Next development server. The route is unavailable
outside `NODE_ENV=development`. It does not require production data or an API service.

| Fixture           | Slides | Creator task                                                                 |
| ----------------- | -----: | ---------------------------------------------------------------------------- |
| Business pitch    |     10 | Adapt a fictional proposal into a coherent ordinary deck without assessments |
| Product demo      |      5 | Explain a fictional workflow and prepare for audience questions              |
| Training/workshop |      5 | Explain a handoff process and prepare discussion                             |

Task instructions and an observation checklist are bundled with each fixture. On its first slide,
edit the title/body, move the image and shape, check connector endpoints, revise notes and reading
order, save locally, then reload and compare. Check a later slide in the narrow-screen reading view.
The task material is original and deterministic; no external/customer deck or private asset is used.

The fixed fixture library and 1 MiB local workspace are deliberate experiment limits. This is not
a complete deck builder, import path, publishing workflow or production autosave/recovery service.

## Local automated verification

The checks below describe the coverage exercised locally on November 3. They do not establish
deployed capacity, creator usefulness or independent accessibility acceptance.

| Surface                  | Evidence needed                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prototype contract       | Strict versions/fields; finite bounded geometry; node/UTF-8 limits; complete reading order; valid connector targets; explicit image-reference kinds                            |
| One-way adapter          | Deterministic current-slide conversion; exact source IDs/text/notes; no source mutation; existing six-layout geometry; image-ID collisions; explicit legacy-v1 upcast boundary |
| Fixture library          | Exactly 10/5/5 valid scenes; stable unique fixture/node IDs; four node types on the first slide                                                                                |
| Local workspace          | Separate key/version; size/identity validation; private-media rejection; invalid/blocked/full storage handling; explicit save/reload                                           |
| Renderer/browser         | Editing and semantic order; keyboard movement; connector following; narrow-screen legibility; save/reload; no production API mutation/private media fetch                      |
| Route                    | Development rendering allowed; test/production denied by the server page                                                                                                       |
| Production compatibility | Existing content-slide rendering, v1/v2/v3 artifact/Pack checks and media retention remain valid                                                                               |

Primary source files:

- [Contract and adapter](../../packages/contracts/src/presentation-scene-prototype.ts) and
  [contract tests](../../packages/contracts/test/presentation-scene-prototype.test.ts).
- [Fixture library](../../apps/web/lib/presentation-scene-fixtures.ts) and
  [fixture tests](../../apps/web/lib/presentation-scene-fixtures.test.ts).
- [Workspace storage](../../apps/web/lib/presentation-scene-storage.ts),
  [lab](../../apps/web/components/presentation-prototype/scene-prototype.tsx),
  [renderer](../../apps/web/components/presentation-prototype/scene-view.tsx) and
  [server page](../../apps/web/app/dev/presentation-scene/page.tsx).
- [Existing Pack compatibility tests](../../packages/db/test/presentation-pack-artifact-schemas.test.ts)
  and [existing content renderer tests](../../apps/web/components/presentation/content-slide-view.test.tsx).

Executed on macOS 27.0.1 with Node 26.10.0 and the repository's pinned dependencies:

- `pnpm check` passed formatting, Docker-context validation, lint, type checking, workspace tests,
  smoke-support tests and production builds. The contract suite passed 485 tests; the web suite
  passed 1,949. Database tests included 337 skips and server tests 15 skips under the unconfigured
  external-service test environment; this does not establish live PostgreSQL/Redis conformance.
- Focused prototype/current Presentation/realtime contracts passed 57 tests. Focused lab storage,
  fixture, renderer, route and existing content-renderer checks passed 37 tests.
- The dedicated browser harness passed **20 cases** across desktop Chromium, Firefox, mobile
  Chromium and mobile WebKit with zero retries. It checked cross-fixture editing/save/reload,
  image description and geometry, keyboard movement, semantic order, an axe scan, phone flow,
  invalid/blocked storage, edge-positioned drag controls and independent visual stacking.
- An actual standalone production build returned **HTTP 404** for `/dev/presentation-scene` and
  did not expose the lab controls. The server-page unit tests separately rejected production/test.
- Browser checks observed no Presentation API mutations; renderer/storage tests reject private
  asset persistence and show no private media URL. Desktop/mobile screenshots were visually
  inspected for the synthetic fixture; actual screen-reader and physical-touch tasks remain open.

Run the harness with `pnpm test:e2e:presentation-scene`; it starts only a loopback development web
server, uses a separate Next output directory and requires no API, account or production data.
The runner forwards normal Playwright arguments, such as `--project=scene-firefox`.

The initial Firefox run failed before page creation because of the host's
[macOS shared app-data lookup issue](https://github.com/microsoft/playwright/issues/42768).
The successful rerun isolated `MOZ_APP_DATA` and `MOZ_LOCAL_APP_DATA` in task-owned temporary
directories. The runner applies that isolation on macOS when those variables are unset, closes
browser processes and removes its folders afterward. It keeps the stock browser and sandbox,
does not modify the installed browser/cache, and does not change HOME or OS permissions.

Known prototype limits: fixed fixture filmstrip, existing-node editing, no undo/redo, no
multi-tab merge, and no text-overflow warning. The visual stage can overflow a text frame if an
author adds too much text; the reading view remains available. These need deliberate E01/editor
work and must not be presented as a completed broad creator release.

## Review followup for overlapping move controls

The selected Move handle now stacks above other handles. A coordinate-drag regression first
reproduced the original failure, where the selected image stayed unchanged because an overlapping
shape received the pointer. It now verifies both selected elements and reversed semantic order,
with the unselected element's geometry preserved.

The first full followup run also exposed a smooth-scroll race in the existing edge-control test:
the page moved between measuring the handle and pressing the pointer. That test now waits for a
stable hover target before measuring and uses a retrying assertion for the resulting update.

Validation after both fixes: `pnpm test:e2e:presentation-scene` passed all **24 cases** across the
four browser profiles with zero retries. The two drag cases also passed five consecutive Chromium
repetitions each, for ten targeted checks. Targeted ESLint, formatting and `git diff --check` passed.

## Human observation remains unmeasured

No creator completion times, success rates, facilitator-rescue counts, willingness-to-pay results
or assistive-technology results have been collected for these fixtures. During an observed task,
record participant segment, prior tool, browser/device, task start/end, completion, assistance,
repair work and specific failures. A successful local save is not proof of task success.

Do not compare invented timings with Genially/Prezi. The
[benchmark protocol](../presentation-benchmark-2026-11.md#empirical-benchmark-before-implementation-commitments)
requires equivalent observed tasks and recorded product plans/generations. E00 supplies material
for that work; it does not replace it.
