# Sessions workspace recovery and action hierarchy

Selected checkpoint: **WX-11A**, November 19, 2026.
Baseline: merged Survey C2, [PR #290](https://github.com/riojung/pollingpops/pull/290), `d6f3fd3`.
Branch: `codex/sessions-workspace-polish`.
Merged through [PR #291](https://github.com/riojung/pollingpops/pull/291) at `26f7a8c`.
Owner: frontend and accessibility.

Survey C3/C4 reporting and B3 authoring still depend on the recorded privacy acceptance.
This independent ready workspace checkpoint improves the existing Sessions surface while
those decisions remain open. It does not enable conditional Survey reporting or change a grant.

## Selected behavior

- A failed initial history read has a **Try again** action. It repeats the selected format's
  GET workflow with the current search, status, source, dates and saved layout. It does not
  repeat a Resume or Delete mutation. Aborted or obsolete requests cannot replace another
  workspace or format's history.
- A failed Round pagination request retains loaded rows and the existing **Load more sessions**
  action retries its cursor. History retry is separate from mutation errors; existing action
  controls and deletion confirmation retain their meaning.
- A filtered empty result offers **Clear filters**, retaining the selected format and saved
  layout and returning focus to its search field. Genuine empty history keeps its typed Library
  destination. Missing/error evidence is not presented as zero history.
- Busy panels expose their state and static placeholders instead of suggesting that no sessions
  exist. Count badges retain their existing authoritative/loading/unavailable behavior.
- Each card has one dominant permitted action. Resume leads active Rounds and Presentations;
  reports remain available as secondary actions. Reports lead retained history and active viewer
  cards where already available. Open editable Surveys lead with Manage sharing; existing results
  lead otherwise. No new result availability, credential or permission is introduced.

The change is local to Sessions. Shared action styles, server filtering/pagination, counts,
session ordering, destinations, credential recovery and deletion authority remain unchanged.
Rows are not reordered into an invented workspace-wide active-first list from a partial page.
Existing localized Retry/Clear filters strings are reused; there is no new editorial copy.

## Experience acceptance

Keep the existing compact grid/list layout, wrapping titles and metadata, and coarse-pointer
targets. Loading and recovery panels use interface tokens without repeated blur or motion.
Retry and Clear filters must be keyboard reachable with visible focus. Verify long and unbroken
titles, 320px reflow, light/dark appearance and forced colors. Automated accessibility checks
support, but do not replace, human assistive-technology and device acceptance.

The focused recovery spec supplies synthetic history through GET responses only. Session actions
still target their existing paths; tests must not accidentally send Resume/Delete mutations for
fixture records. The existing integration journey uses its separate in-memory session fixtures.

## Local verification, November 19, 2026

`VITEST_MAX_WORKERS=1 pnpm check` passed formatting, Docker workspace dependency checks,
repository lint/type checks, all active tests, four application build tasks and compiled-server
startup. This includes 6,423 web, 1,140 contract, 1,672 server, 666 default database and 529 support
tests. Configured optional integration skips remain. The focused Sessions/control suites passed
all 85 cases, including stale retry results, exact pagination retry, mutation separation, filter
recovery, focus and role/lifecycle action emphasis.

Six production-browser cases passed across desktop Chromium, 320px mobile Chromium and mobile
WebKit. They cover the new history Retry, loading and no-match panels; exact retry query, saved
layout and search focus; existing format/search/history/deletion workflows; light/dark/forced
colors; wrapping long titles; document reflow and scoped axe checks. Error/loading/empty and
grid/list screenshots were inspected. The existing journey now waits for each canonical Round
filter URL before continuing, and retains its unexpected-browser-error assertion.

The focused recovery cases also passed in the development runtime. The broader development
WebKit journey exposed navigation/startup cancellation diagnostics; the production journey
passed with the browser-error assertion enabled. These checks do not establish a general fix
for development-runtime cancellation behavior.

Independent read-only implementation review found no actionable issue. No migration, dependency,
contract, server, payment or permission change was introduced. Human assistive-technology,
native-language and physical-device acceptance remain separate.

## Remaining work

WX-11B's [Results recovery increment](results-workspace-polish.md) merged through PR #292.
WX-11C Workspace initialization/recovery is local. Library, independent settings-section recovery
and the capability/plan explanation audit remain pending.
Other delivery priorities and Survey gates are tracked in the
[overall backlog](workspace-experience-backlog-2026-11.md).
