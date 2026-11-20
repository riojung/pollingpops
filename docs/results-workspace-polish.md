# Results workspace recovery and keyboard continuity

Selected checkpoint: **WX-11B**, November 19, 2026.
Baseline: merged Sessions WX-11A, [PR #291](https://github.com/riojung/pollingpops/pull/291), `26f7a8c`.
Branch: `codex/results-workspace-polish`.
Merged through [PR #292](https://github.com/riojung/pollingpops/pull/292) at `6e85bcf`.
Owner: frontend and accessibility.

This checkpoint improves the existing Results overview's Rounds, Practice, Presentations and
Surveys views. Survey C3/C4 reporting and B3 authoring remain dependent on the recorded privacy
acceptance. No conditional Survey grant, report schema or disclosure rule changes here.

## Selected behavior

- A failed first history read does not imply zero results. Suppress the numeric count while the
  error explains unavailable evidence. Successful empty history still shows a genuine zero;
  previously loaded rows, loaded-count summaries and More available qualifiers keep their meaning.
- Filtered empty states use the existing no-match heading and foreground **Clear filters**.
  Genuine empty states retain their original creation, Library or Survey-run destination.
- Both the toolbar and empty-state reset clear the current view's filters and return keyboard
  focus to the persistent typed search input. The selected view and saved layout remain intact.
- **Try again** transfers focus to the stable named result panel before the error control
  disappears. The panel exposes initial and pagination busy states. Loading placeholders are
  static, hidden from assistive technology, and use the saved grid/list layout when no trusted
  rows are available.
- Recovery repeats the existing GET operation. Round/Practice pagination retries retain loaded
  rows and the failed cursor; obsolete or aborted reads cannot replace another view/workspace's
  evidence. No failed mutation is replayed by a history retry.
- Native date inputs stay within their own filter fields at 320px. Direct field bounds supplement
  document-width checks, which can miss a mobile layout viewport expanding to fit intrinsic inputs.

Card density, report actions, original Pack attribution, source/filter/query semantics, evidence
denominators, version/source bindings and retained Survey-run selection remain unchanged.
The overview summarizes loaded evidence rather than inventing workspace totals. Missing evidence
remains distinct from zero, and pagination qualifiers remain lower-bound statements.

The change is local to the overview route and its styles. Shared shell access states, report
destinations, per-report privacy/suppression, summaries, exports, permissions and billing do not
change. Current conditional Survey result restrictions remain in place.

## Experience acceptance

Reuse existing localized copy and interface tokens. Preserve compact grid/list density, wrapping
titles and metadata, coarse-pointer targets and visible keyboard focus. Verify 320px reflow,
light/dark/forced colors and scoped axe checks. Automated checks support, but do not replace,
human assistive-technology, native-language and physical-device acceptance.

Focused browser fixtures provide synthetic history through GET responses only; opening a report
or sending a mutation is not part of that fixture. The existing Results journey remains a
regression anchor for pagination, search, layout and evidence destinations.

## Local verification, November 19, 2026

`VITEST_MAX_WORKERS=1 pnpm check` passed formatting, Docker workspace dependency checks,
repository lint/type checks, all active tests, four application build tasks and compiled-server
startup. This includes 6,437 web, 1,140 contract, 1,672 server, 666 default database and 529 support
tests. Configured optional integration skips remain. All 63 focused Results tests passed, including
50 route cases covering unknown versus trusted zero, retained pagination counts and cursor retry,
obsolete requests, capability behavior, all four views' retry/busy states and reset callbacks.

Six production-browser cases passed across desktop Chromium, 320px mobile Chromium and mobile
WebKit. The new journey checks all four views' first-error and no-match recovery, held GET retry,
stable panel/search focus, saved layout and exact query preservation. The existing journey retains
its pagination, evidence-calculation, source/report-link, filter and layout assertions; its Clear
filters locator now names the toolbar region separately from the new empty-state control.

Scoped axe, long-title wrapping, grid/list and light/dark/forced-color checks passed. Screenshots
were inspected. Direct bounds checks reproduced native date fields extending 17px beyond their
labels; the local sizing rule then passed a fresh production build and all six cases, including
field bounds. The new recovery fixtures sent no report/practice/session mutations.

Independent read-only review and a follow-up review of the final sizing/test changes found no
actionable issue. No migration, dependency, server, contract or permission change was introduced.
Automated checks do not replace the human acceptance described above.

## Remaining work

The selected Sessions and Results increments are merged. WX-11C's
[Workspace initialization/recovery](workspace-settings-recovery.md) merged in PR #293.
[Library recovery](library-recovery-focus.md) merged in PR #294. Independent settings-section
recovery and authoritative capability explanations remain pending. Other priorities and
Survey gates are recorded in the [overall backlog](workspace-experience-backlog-2026-11.md).
