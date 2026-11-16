# Home workspace overview

The November 12, 2026 `codex/home-insights-workspace` implementation makes Home a compact
workspace dashboard while preserving the existing authorized summary and destinations.

## Summary and insights

| Widget              | Meaning                                                                                                                                    | Destination        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Accessible work     | Existing accessible artifact total, including returned format scope; no ownership claim.                                                   | Library and Boards |
| Active sessions     | Existing combined summary tally. At the server's Round query cap or above, display a conservative `+` lower bound.                         | Sessions           |
| Assignment progress | Completed attempts divided by attempts across the returned recent assignment sample. No attempts shows a dash; measured zero remains `0%`. | Assignments        |
| Reports ready       | Ready reports out of the returned recent result sample. Pending and failed reports do not count as ready.                                  | Results            |

The source is one existing `/v1/home/summary` read. No item-level requests, authoring
writes, new server contracts, personal-owner inference, unique-participant calculation,
aggregate accuracy or fabricated trend data are added. A localized snapshot date/time
makes the age of the evidence visible; existing scope fencing, no-store reads and retry
behavior remain authoritative. Skeletons do not render invented zero values on load/error.

Next up chooses at most three canonical actions: active session, an open assignment
closing within 48 hours of the summary timestamp, editable draft, then latest ready
report. Closing checks use the snapshot time rather than an ambient browser clock.
An active tally without an active sampled room links to Sessions. Viewers receive that
safe list destination and no new draft/host action. Per-board editing permissions remain
necessary for draft suggestions. No eligible suggestion means “No suggested next steps,”
not a completion claim. Author-created titles retain their original language.

## Layout and accessibility

Recent work remains the six most recently updated accessible items across supported
formats. Rows show a dedicated format icon, complete wrapping title, status, item count
when known, update time when known, and a canonical action. Unknown board object counts
stay absent. A semantic list names the recent scope. Boards and Surveys remain separately
discoverable when they fall outside those six items.

The old 215px minimum card height is removed. Desktop rows place the format, work details
and action in aligned columns; phones stack the action beneath the title. Widget grids
adapt to two columns on smaller screens. Phone widgets omit decorative icon rows and
Home omits its duplicate Create button; the global Create menu stays available. The
compact header is opt-in, preserving the existing header layout on other pages.

The existing semantic palette supplies light/dark colors. System ButtonText/ButtonFace
colors keep both Create controls readable in forced-colors mode. Keyboard focus is
visible across widget links. Native progress has an accessible name and visible numeric
context. All new copy is typed across ten locales with literal-safe placeholder
interpolation. Existing language Preview status and human acceptance gates stay unchanged.

## Verification scope

Focused tests cover sampled evidence versus totals, missing versus zero, canonical
priority, caller/per-board permissions, immutable sorting, snapshot-based closing checks,
all-locale placeholder parity and literal interpolation. Existing Home scope/retry and
first-session regressions remain in place. Production browser cases use synthetic data
and exercise geometry, keyboard focus, localized long labels, themes, Axe, loading,
failed fetch/retry and empty evidence. The browser suite also verifies content remains
read-only and does not add item-level detail reads.

WebKit can update the root theme attribute before descendants resolve their new colors.
The fixture waits for both visible and offscreen computed text palettes before the full
Axe scan; it does not weaken contrast assertions or substitute a fixed delay. Screenshots
and geometry receipts use isolated synthetic fixtures under `artifacts/home-insights/`.
Browser emulation is supporting engineering evidence, not manual assistive-technology,
physical-device, native-language or customer acceptance.

Final repository verification: `VITEST_MAX_WORKERS=1 pnpm check` passes
**8,403 tests** with 513 standard opt-in skips, including **403 web suites / 4,466 tests**.
Formatting, workspace/build lint, type checks, all four production build tasks and
compiled-server startup/configuration smoke pass. The 87 focused Home/model/copy/Shell
tests, strict browser-fixture types and dedicated beta production build also pass.
All **12 distinct
selected production-browser cases** pass across desktop Chromium/Firefox and phone
Chromium/WebKit. Cases cover English, German and Korean, long titles, keyboard order and
focus, light/dark/forced-color preferences, Axe, overflow, loading/retry and empty state;
existing live-session priority and dismissible guidance are rechecked.

In the representative six-item synthetic fixture at 1440px, desktop rows measure
**64–77px**, compared with the removed **215px minimum**. At 320px they measure
**117–169px** with wrapping content and actions. The four-widget phone grid occupies
about 322px after the explicit work destinations were added. These are fixture geometry measurements, not fixed limits for all authored
content or manual zoom/device evidence. Desktop and phone screenshots were visually
reviewed after the clean rerun. A focused independent data/permissions audit led to
neutral empty-suggestion wording and explicit recent-result scope; the final copy
preserves those boundaries.

## Review follow-up: work destinations

The aggregate Accessible work value is a non-link summary with separate Library and
Boards navigation. Library covers Rounds, Presentations and Surveys; Boards covers
canvases and idea boards. A board-only workspace can therefore follow its counted work
to Boards. The links remain keyboard accessible, with 44px labelled icon targets on
phones and localized text on larger screens. No anchors are nested.

Board navigation is available when either board feature is enabled, the total or recent
sample contains boards, or the optional board total is absent. A known zero total with
both creation flags off and no board sample omits that destination. Viewers retain
read-only board navigation, including shared boards; missing totals are not treated as
zero and are not subtracted to fabricate a Library count. Regression cases cover
board-only viewers, mixed work, legacy missing totals, known-zero disabled workspaces
and rollout-enabled empty workspaces. The original reviewer confirms the reported
navigation issue is resolved.

The review fix passes all **87 focused Home/model/copy/Shell tests**, web and strict
browser-fixture types, scoped lint, and all **12 selected production-browser cases**.
Board-only browser cases follow View Boards through to the Boards directory, while mixed
work cases traverse both destination links by keyboard. English, German and Korean,
light/dark/forced-color preferences and 320px layouts remain in the rerun. Normal and
beta production builds pass on the corrected source. The full repository gate above rechecks the corrected source before PR publication.
