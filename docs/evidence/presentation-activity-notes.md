# Presentation activity appearance and speaker notes

Source: `codex/presentation-activity-notes-polish`, from `0dbbdd0` (merged PR #220).
Scope follows the four creator screenshots supplied on November 9, 2026.

## Slide creation and delivery

A shared activity slide replaces the editor's dark question form and the preview's incorrectly
constrained answer spans. Only the letter badge has a fixed width; complete answer labels wrap
in the remaining space. Prompt and answer editing select the actual slide text. Response settings
and answer branches sit in a separate editor section below the artwork. Ordinary wide slides use
16:9 geometry, phones use reading flow, and dense or zoomed content offers an explicit Reading
view instead of silently truncating text or shrinking it below the font floor.

New slide, Blank slide and Content slide use native scenes and copy the surrounding visible
scene's theme, font and spacing into the newly created block. Successful creation closes its
picker after that block appears in the draft. Existing blocks, duplicate appearance, imported
artwork/frames, source citations and recovery baselines are retained. Activities and legacy text
slides borrow nearby visible design tokens for rendering without rewriting their source records.
Filmstrip artwork uses the same activity renderer and retains scoped media authorization.

Public live content and question blocks accept an **optional** `design` object containing only
closed `theme`, `font` and `spacing` tokens. Projections derive fresh token copies from the
session's frozen published content, with no draft fetch or storage mutation. Explicit native
scene design takes precedence; older projections may omit the context. Host, stage, participant
content and companion content use the delivered context. Correct-answer highlighting requires
explicit revealed-answer IDs; the artwork does not read authored correctness, explanations or
source citations. Existing submit, moderation, timing and navigation paths retain their authority.

No authoring-document migration, extra service, dependency, model call or font download is added.

## Private notes

Notes have a 320px minimum, resizable writing field, a visible 2,000-character limit and an
expanded native writing dialog. Both fields edit the same controlled draft through the existing
save/history path. The expanded field receives focus after the dialog opens; dialog dimensions
use the real visual viewport and zoom scale. Short zoomed windows can scroll internally to reach
Done. Closing, changing slides or losing editing permission does not commit a detached copy.

Preview presenter view opens the current visible slide with private notes. Audience view is the
default and does not mount notes inside its preview. The private mode explicitly distinguishes
current-draft rehearsal from a live session's frozen published version. Actual host notes retain
whitespace and scrolling with a larger 18px font and minimum reading area. Notes remain absent
from stage, participant and companion projections, including after later draft edits/publication.

## Qualification

`VITEST_MAX_WORKERS=1 pnpm check` passes: 7,062 tests, 513 existing opt-in skips, formatting,
lint, types, all four builds and compiled server startup/configuration smoke. The final preview
keyboard-scroll follow-up also passes its 17 builder tests, web lint/types and strict beta-spec
typing. Those focused counts overlap the repository total.

Production-browser qualification uses a dedicated beta artifact, ports 14970/15970, a fresh API
per browser profile and zero retries. It covers activity appearance/editing/history/insertion,
private notes/rehearsal, real guest responses and frozen publication context, thumbnails/media,
opinion formats, delivery, native scenes, interaction authoring, editor controls, question starters
and reviewed PDF imports. All 76 unique cases pass:

| Production profile | Unique cases passed |
| ------------------ | ------------------: |
| Chromium desktop   |                  19 |
| Chromium phone     |                  19 |
| WebKit phone       |                  19 |
| Firefox desktop    |                  19 |

The final four activity/notes/thumbnail cases also pass in each profile with the corrected
geometry assertions. Those 16 repeated cases overlap this total. Thumbnail geometry waits for
its lazily mounted canonical 960×540 plane before measuring scaled coordinates; all checks use
the ordinary bounded assertion timeout.

The actual notes component separately passes 12 viewport/zoom cases in Chromium, WebKit and
Firefox, including keyboard focus, controlled typing, Done and focus return. At phone width and
200% CSS zoom, the native dialog remains within the viewport and its internal scroll reaches Done.
These cases are not added to the production-browser total.

Exploratory failures exposed and fixed an insertion menu that stayed open, expanded-field focus,
zoomed native-dialog placement and keyboard access to the scrolling preview. Firefox additionally
exposed an invalid test measurement: an inline answer span has a zero client box but nonzero
scroll dimensions, unlike Chromium. Actual text Range rectangles fit within the labels and cards.
Read-only assertions now check every rendered line inside its answer card and clear of its badge;
textarea overflow, surface containment and pairwise overlap checks remain. A width sweep also
verified that Chromium can hang preserved line-ending spaces into card padding while every visible
glyph fits its label. No application change or font shrinking was needed
for that assertion fix. An independent read-only review found no remaining actionable issues.

Frozen application source SHA-256:
`97357848f0e5e8eb59a591aa68c3e99df6649c9637f284b47e27dd1de5205e93`.
Validated artifact SHA-256:
`7e4b3af29a3a1d71ce9511357de5765574b635420503ed239eef473024d8b04f`.
Local screenshots and compact receipts are retained under the ignored
`artifacts/presentation-activity-notes/` directory. Exploratory failures and repeated focused
checks are excluded from final unique passing counts.

## Boundaries

This closes the reported activity-rendering and notes-discoverability gaps, not all E00–E14 or
competitor parity. Manual assistive-technology, physical-device/screen-sharing and hosted capacity
qualification remain separate. Imported bitmap pixels retain their original appearance. Source
changes have not been deployed to the running Docker application.
