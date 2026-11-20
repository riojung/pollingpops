# Library recovery and keyboard continuity

Selected checkpoint: **WX-11D**, November 20, 2026.
Baseline: merged Workspace settings WX-11C, [PR #293](https://github.com/riojung/pollingpops/pull/293), `223095c`.
Branch: `codex/library-recovery-focus`.
Owner: frontend and accessibility.

## Selected behavior

All content discovery retains a named results region and a pagination footer below its list.
Initial-read failure stays distinct from a failed next page. A page failure keeps trusted rows,
exact server totals and the current cursor, with Retry beside the pagination position.

- Initial Retry focuses the results region before repeating the first GET.
- Load more and failed-page Retry focus the footer before the current-cursor GET. The footer
  remains mounted while pending, on failure and after the final page, with a visible loaded count.
  The top summary keeps its exact result total separate from the number of loaded rows.
- Completion never reclaims focus. It keeps the footer in view with instant, nearest scrolling
  only while that footer still owns focus under the initiating authority/query. Moving to search
  or a filter during a pending read retains the user's focus and avoids completion scrolling.
  Stale action callbacks remain fenced by the active
  authority/query key and valid pager phase/cursor.
- Toolbar and no-match Clear filters focus the existing search field and center it with instant
  scrolling before updating the URL, keeping the handoff clear of the sticky header.
  They retain the current scope and sort and the existing reset to All content. Genuine empty
  collections retain their own explanation; no-match results offer a direct reset action.

The existing pager owns cancellation, deduplication and access revalidation. Actor, workspace,
role, grant, scope and query changes still clear stale content. Shared publication permissions,
pinned versions, review actions, canonical content links and typed management workflows remain.
Folder management stays in the typed views. No API, contract, database, grant or publication change
is introduced by this surface increment.

## Experience acceptance

Reuse existing localized labels and interface tokens. Keep recovery understandable in all four
discovery scopes without adding guessed plan or administrator-policy explanations. Check keyboard
focus during held requests, final-page completion, initial recovery, filter reset, stale completion
and deliberate focus movement. Verify direct control bounds, 320px reflow, light/dark/forced colors
and scoped axe, alongside the existing real-API mixed-kind and shared-permission browser journey.

Automated checks do not constitute human assistive-technology, native-language, physical-device
or public-release acceptance.

## Local verification — November 20, 2026

- `VITEST_MAX_WORKERS=1 pnpm check` passed formatting, Docker dependency checks, lint, type checks,
  all repository test suites, four application builds and compiled server startup. The suites include
  6,491 web, 1,140 contracts, 1,672 server, 666 default-database and 529 support tests. Existing optional
  integration skips remain.
- The focused component, pager and typed Library-route regression passed 88 tests across three
  suites, along with scoped ESLint/Prettier and nonemitting web type checks.
- Six production browser cases passed across desktop Chromium, 320px mobile Chromium and mobile
  WebKit. They exercise held/failed/current-cursor reads, retained mixed-kind rows and exact totals,
  visible keyboard focus during retry and final completion, both reset controls, initial recovery,
  deliberate focus movement and query changes during a held request. Scoped axe/reflow checks and
  light/dark/Chromium forced-color checks passed; screenshots were inspected.
- The existing mixed-kind/shared-discovery browser regression passed six cases across desktop
  Chromium, mobile Chromium and mobile WebKit. Real API checks retain beyond-page search,
  favorite and typed-view navigation, pinned publication/source restrictions, review progress and
  revocation behavior. Organization and Shared with me resets also retain scope and search focus.
  Desktop/320px/390px appearance, direct select-control bounds, scoped axe and reflow checks passed;
  light/dark/forced-color screenshots were inspected.
- Independent read-only review found no production correctness, accessibility or permission defect.
  Its two browser-fixture findings were addressed: Retry targets the relocated pagination control,
  and the stale-request scenario awaits route handling and request termination before asserting
  current rows, counts and focus.

The first browser passes exposed two mobile visibility issues: appended rows pushed the active
footer below the viewport, and reset search focus could sit behind the sticky header. The final
implementation keeps an owned footer visible and centers search during explicit reset. All six
production cases passed after rebuilding with these fixes; no visibility assertion was removed.

## Remaining work

The selected Sessions, Results and Workspace initialization increments are merged in PRs #291–293.
WX-11D is local. Neutral unavailable copy is the next ready capability-explanation checkpoint;
precise plan/operator/rollout/provider reasons require a sanitized authoritative projection.
Independent settings-section recovery is also pending. These increments do not complete all of WX-11.

Survey C3/C4 runtime reports/exports and B3 authoring remain pending the recorded privacy acceptance.
Other feature and release gates are tracked in the [overall backlog](workspace-experience-backlog-2026-11.md).
