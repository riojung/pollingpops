# Native Presentation rich-text verification

Date: November 3, 2026. Base: `8877bb9` after PR 184. Working branch:
`codex/presentation-rich-text`.

This E01 increment adds optional structured paragraphs, bold/italic ranges, bullet and numbered
lists, and explicit safe links to native text. No editor SDK, hosted service, AI call or paid
dependency is introduced.

## Compatibility and editing boundaries

- **Format text** explicitly opts a text object into structured content and its slide into scene
  v2. The containing document becomes v5 in the same edit. Existing native creation and conversion
  still produce scene v1; adding them to a v5 document never downgrades that document.
- Required plain text exactly matches structured paragraph/run content. Parsing adds no defaults
  or formatting to legacy nodes. Existing document v2 defaults, v4 native documents, Pack schemas,
  frozen baselines, immutable hashes and mutation-envelope v2 remain separate.
- The structure is closed and flat: at most 100 paragraphs, 100 runs per paragraph and 500 runs
  total, within 160 title/4,000 body characters and existing 128 KiB scene/3 MiB native-deck bounds.
  Titles permit paragraphs only. No HTML, arbitrary CSS, executable actions or recursive markup.
- Link schemes are HTTP(S), with no credentials, literal whitespace/control characters or
  backslashes. Links use escaped React elements, new tabs, `noopener noreferrer` and no referrer.
  Editor clicks retain authoring context. Audience links remain explicit navigation actions.
- Controlled text fields remember selection across toolbar focus. Ordinary edits preserve
  unchanged runs and paragraph kinds; clipboard HTML is ignored in favor of plain text.
  Object/scene validation failures retain the prior content and show an error. Document-size save
  failures use the existing save-error/recovery path. Remove formatting is
  explicit and reversible. Existing geometry, IDs, media, reading order and selection remain intact.

## Verification

| Check                                                                           | Result             |
| ------------------------------------------------------------------------------- | ------------------ |
| Full contracts package                                                          | 543 tests passed   |
| Focused artifact readers and media references                                   | 35 tests passed    |
| Native authoring/live API and Pack insertion                                    | 35 tests passed    |
| Isolated PostgreSQL native v4/v5 media lifecycle and shared session conformance | Three cases passed |

Before the clipboard review follow-up below, `pnpm check` passed formatting, Docker-context validation, lint, type checks, tests,
support tests and production builds. Package totals include 543 contracts, 2,033 web, 1,037 server
and 469 database tests; support checks passed 354 tests. Default service-dependent skips were
340 database, 15 server and one support case. The three selected PostgreSQL cases above ran
separately. The final rerun reused unchanged Turbo results and reran the changed web suite after
the final interaction fixes; no timeout or assertion was relaxed.

Eighteen unique development browser cases passed across runs: the 14 existing native/direct-editing
regressions, followed by all four new rich-text journeys after the history fixes and fixture
corrections. The final new-journey invocation passed desktop Chromium/Firefox and mobile
Chromium/WebKit with zero retries. Screenshot inspection confirmed readable semantic paragraphs,
emphasis, lists and links in desktop and narrow audience views.

All four rich-text journeys also passed against the final production build with zero retries.
They assert the restored DOM selection and enabled toolbar after Undo/Redo without another
selection event. Mobile Chromium exposed an older queued toolbar callback restoring the previous
paragraph range; pending callbacks now yield to newer selection/focus/input and cannot steal focus
from the link field. Unit regressions forcibly execute canceled callbacks and verify the newer
range wins, including after blur and unmount. Read-only review found no remaining confirmed issue
in these fixes.

The PostgreSQL run used a task-owned PostgreSQL 17.11 container with temporary storage, real
ordered migrations and a restricted runtime login. Both native document versions exercised media
ownership/deletion fences, accepted retries, immutable publication/history, frozen Pack baselines,
account export and cleanup; JS and SQL collectors agreed. The dedicated v5 case preserved formatted
text and plain fallback alongside those asset references. Two older cases ran alongside it, with
119 unrelated cases filtered out. The container and its task-owned SSH forward were removed.

The new browser journey uses real draft, publication and live-session APIs without response stubs.
It opts into formatting, styles character ranges and a bullet paragraph, rejects an unsafe link,
adds a safe link, reloads, pastes a fixture containing plain text and HTML, uses history, and checks
semantic audience rendering and private-note exclusion. It also checks that adding/converting
scene-v1 slides retains document v5, then advances all slides and finishes. Clipboard delivery is
synthetic; this is not an operating-system clipboard or physical-device acceptance claim.

Independent review found repeated-character edit ambiguity and native textarea history losing
formatting. Edits now carry their actual replacement range; keyboard and native context-menu
history route through the existing document snapshots. A browser regression deletes the first of
two identical characters with different marks, moves the caret, then uses Undo/Redo and verifies
the surviving character's formatting. Initial opt-in Undo/Redo also checks focus across the rich
and plain editor boundary.

Initial browser runs corrected test-fixture assumptions: React selection is driven with real
keyboard events; Firefox drops constructor-supplied clipboard data on synthetic events, so the
fixture attaches it explicitly; phone map/inspector overlays are opened separately; finish follows
the last slide. A production fixture initially expected a nonempty restored range without first
selecting one; it now sets and asserts that range explicitly. No assertion or timeout was relaxed
to pass these cases.

## Review follow-up: unsupported clipboard formats

The delegated review found that an image, file, HTML-only or empty clipboard payload could delete
selected text: absent `text/plain` data was interpreted as an empty replacement. The paste handler
now prevents the default action and ignores payloads without that explicit format before changing
text, formatting, selection or history. Supported plain-text paste retains its existing behavior,
including an explicitly empty plain-text replacement.

Four component regressions check unsupported formats over a selected bold range, verifying no
data extraction or change callback and unchanged text, marks, selection and toolbar state. Existing
paste tests explicitly declare their plain-text format. All 39 focused editor/helper/renderer
tests, web type checking and changed-file lint passed. The production browser journey now also
checks HTML-only, image-file, text-file and empty payloads over selected bold text, then confirms
the saved draft and supported plain-text paste behavior. All four production journeys passed with
zero retries in desktop Chromium/Firefox and mobile Chromium/WebKit, including the new cases.

The full repository check above predates this narrowly scoped follow-up; no backend, artifact
schema, persistence or media lifecycle behavior changed.

Reproduce from the repository root:

```sh
pnpm --filter @openround/contracts test
pnpm --filter @openround/db exec vitest run test/presentation-scene-artifact-schemas.test.ts test/artifact-schemas.test.ts test/media-references.test.ts
pnpm --filter @openround/server exec vitest run test/presentation-native-scene-api.test.ts test/presentation-companion-recovery-packs.test.ts test/recovery-pack-presentation.test.ts
pnpm --filter @openround/db exec vitest run test/postgres.test.ts -t 'retains native scene media across Pack baselines|retains v5 rich-text scene and Pack media|shared Presentation repository conformance contract' --hookTimeout=60000
pnpm exec playwright test --config=playwright.beta.config.ts tests/beta-e2e/presentation-rich-text.spec.ts tests/beta-e2e/presentation-direct-editing.spec.ts tests/beta-e2e/presentation-native-scenes.spec.ts
PLAYWRIGHT_PRODUCTION=true pnpm exec playwright test --config=playwright.beta.config.ts tests/beta-e2e/presentation-rich-text.spec.ts
pnpm check
```

PostgreSQL requires `TEST_DATABASE_ADMIN_URL` and `TEST_DATABASE_URL` for an isolated disposable
cluster, as in the existing database tests. The browser harness uses in-memory service state;
Firefox may require isolated `MOZ_APP_DATA`/`MOZ_LOCAL_APP_DATA` directories on macOS. The existing
upload-race case controls storage/scanner timing with response stubs; actual image-byte/scanner
qualification remains separate from rich-text checks.

## Rollout and remaining work

Follow the [compatible-reader rollout](../runbooks/upgrade.md#native-presentation-rich-text-compatibility)
before accepting v5 writers. A plain fallback does not make old strict live parsers compatible.
No new SQL migration is needed; existing scene-image paths and migration 089 remain authoritative.

This does not add arbitrary fonts/colors, nested lists, tables/charts, collaboration, persistent
grouping or filmstrip hiding. Physical-device, human task-time, assistive-technology and deployed
capacity qualification remain separate. E01 and the broad creator release are still in progress.
