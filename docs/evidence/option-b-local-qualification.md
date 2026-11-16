# Option B local qualification — November 11, 2026

This record describes supporting local engineering checks for `codex/option-b-acceptance`,
based on merged candidate HEAD `2a4f797e3601f1fffd9449e65839ab54a78b5424` plus the
working changes. It does not record customer observation, native-language acceptance,
manual assistive-technology/browser-zoom results, physical devices or hosted qualification.
No staging environment is selected. All 15 release gates remain pending.

## Reproduce the selected browser scope

```sh
node scripts/build/browser.mjs build beta 3296 4296
PLAYWRIGHT_PRODUCTION=true PLAYWRIGHT_REUSE_BUILD=true BETA_E2E_WEB_PORT=3296 BETA_E2E_API_PORT=4296 pnpm test:e2e:beta tests/beta-e2e/option-b-accessibility-acceptance.spec.ts tests/beta-e2e/option-b-remaining.spec.ts tests/beta-e2e/option-b-localized-pack-practice.spec.ts tests/beta-e2e/option-b-live.spec.ts --project=chromium-beta --project=firefox-beta --project=chromium-beta-mobile --project=webkit-beta-mobile
```

Final result: **28/28 pass** against a fresh beta production build; final source,
environment and artifact provenance validates. Playwright 1.64.1 pins Chromium
156.0.8078.4 (revision 1248), Firefox 157.0 (1555) and WebKit 27.2 (2370). The clean rerun
rechecks all four profiles after correcting the Firefox fixture and Results layout.

The browser build helper checks actual source/environment/artifact digests before reuse.
The selected scope contains 28 distinct cases across four profiles: eight each on desktop
Chromium and Firefox, six each on phone Chromium and WebKit. It covers:

- Sequential keyboard template discovery/preview, modal containment and return, private
  notes/history, audience-preview privacy and inspector close/return.
- Light/dark/forced-colors and reduced-motion preferences, measured focus outlines,
  Axe checks and 640px/320px reflow. These viewport equivalents do not perform real browser
  zoom; phone profiles are emulated browsers, not physical hardware.
- Shared practice management; localized Presentation/Round/Survey creation; pending,
  lost-acknowledgement and exact-request recovery; immutable authored/source/private-link
  boundaries; populated Pack setup and receipt management in English, German and Korean.
- Default participant entry and unscored opinion completion.

Firefox on this macOS host previously failed before opening a page. The shared runner
isolates missing Firefox application-data paths per invocation, preserves supplied
paths and existing profiles, forwards cancellation and cleans only its owned temporary
directory after child shutdown. Firefox sequential navigation does not wrap at the last
document control here, so the keyboard fixture uses reverse traversal to earlier header
controls. No higher traversal bound or direct focus/click substitutes for keyboard reach.

Initial expanded testing found a real 7px Results overflow caused by German status
badges escaping narrow desktop cards. Header wrapping now applies at all viewport sizes.
A standalone Firefox reproduction using actual repository CSS matched the original
7px document overflow and verified zero overflow/escaped badges for grid/list at
1366/1024/640/320px. The existing populated application journey checks document reflow.

## Repository verification

`VITEST_MAX_WORKERS=1 pnpm check` passes **8,377 tests**, with 513 standard opt-in skips,
formatting, Docker-context checks, workspace/build lint, type checks, all four production
builds and the compiled-server startup/configuration smoke. Web has 401 passing suites /
4,440 tests; server has 149 passing suites / 1,488 tests; supporting tools have 45 passing
suites / 461 passing tests. The runner/config/review focused subset passes 44 tests.
Separate strict TypeScript checks pass for the review CLI/config and new browser fixtures.
A focused independent read-only audit found no actionable record-consistency or privacy
issues in the review workflow. These totals include the focused tests; they are not added
again as distinct coverage.

## Language-review preparation

The [native-language workflow](native-language-review.md) generates 374 entries in each
of ten locales, with 21 Presentation templates, 36 Round starters and 17 Survey projections.
The current packets have **3,740 pending decisions**, including English reference entries.
Each checker exits `2` for pending records; previous source-bound packets are preserved and
rejected as stale after the renderer correction. No human decisions were fabricated.

Eight standalone HTML cases pass: Chromium/Firefox × German/Korean × 1366px/320px.
Every case has 374 visible/searchable articles, correct English/target `lang` boundaries,
zero active content, zero HTTP requests and zero page errors. Narrow document width is
320px; previously unbroken hashes caused 575px width. Captured packets are byte-identical
to the ten-locale review destination for both tested languages. This checks rendering and
record consistency, not the accuracy or naturalness of translations.

Ignored local artifacts are stored under `artifacts/option-b-acceptance/` and
`artifacts/localization-review/option-b-acceptance-2a4f797-v2/`. Regenerate packets in a
fresh directory after candidate HEAD or any bound source changes. Keep human review
records outside automated formatting and preserve previous decisions.
