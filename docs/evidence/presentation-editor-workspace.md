# Presentation editor workspace refinement

Source: `codex/presentation-editor-workspace`, from `dfff57b` (merged PR #219).
Scope follows the six creator screenshots supplied on November 9, 2026.

## Creator experience

Insertion tools use dedicated original line icons, aligned labels and grouped popups. The slide
navigator separates creating slides from bringing content in. The selected-slide bar separates
ordering from visibility, duplication and deletion; compact screens retain named icon buttons.
Native object tools distinguish text, shapes, connectors, interactions and tables/charts.

Menus keep ordinary button/Tab semantics. They escape clipped scrolling panels using native
manual popovers without changing their DOM ancestry, choose space above or below their opener,
and stay inside the viewport, including CSS zoom at 200%. Drawer widths use measured layout
pixels so WebKit container-unit behavior cannot clip the left tabs; very narrow inspectors
scroll as a complete panel to keep fields reachable. Escape returns to the opener; outside
interaction and Tab departure dismiss the popup. Native and custom modal dialogs retain their
opener, cover the menu and restore focus. Authorization changes always close disclosures.

Slide tools use icon tabs and a stable object context card. Content editing precedes optional
writing assistance; destructive actions sit in a separate footer. Media and accessibility tools
have distinct sections. The Layout tab offers visual theme palettes, paired typography/spacing
fields, schematic layout cards with eligibility reasons, and compact arrangement/layer groups.
Image cropping fields use the same property grouping. Sections stay mounted, preserving object
selection and partially entered media/interaction fields across tabs. Below-canvas audience
ideas separate local starters from optional AI discussion suggestions in compact cards.

All icons and layout previews are original in-code SVG drawings. No dependency, service, model
call, media asset or customer subscription cost is added. Existing scene/document formats,
publication snapshots, permissions, saves/recovery, validation, interaction semantics and server
routes retain their contracts. Palette and layout actions use the existing validated scene/history
paths; rejected changes retain content and expose existing recovery guidance.

## Verification

- Final `VITEST_MAX_WORKERS=1 pnpm check`: **7,004 passed**, **513 standard opt-in skips**
  (497 database, 15 server, one support); formatting, lint, typing, Docker-context check,
  all four builds and compiled-server startup/configuration smoke pass.
- **58 production-browser cases pass** on the final frozen artifact: Chromium desktop **24**,
  Chromium phone **17**, and WebKit phone **17**, with a fresh API fixture per profile.
  Firefox qualification remains incomplete: an earlier attempt stalled at sign-in before the
  editor loaded; the final rerun was interrupted without an observed completion result.
- New cases check icon/action alignment, real schematic bounds, Content editing/autosave and
  keyboard Undo/Redo, design/layout preservation of IDs/text/reading order/notes/citations,
  mounted selection across tabs, keyboard insertion, upward navigator placement, native/custom
  modal layering/focus restoration, 320px overflow, CSS zoom at 200%, and automated Axe.
- Existing editing, composition, native media/history, publication/live interactions, design
  limits, image fit, layout review, filmstrip topology and template-rendering cases run alongside
  the new journeys. The browser fixture uses synthetic/local media and disabled AI; the outline
  dialog test explicitly checks unavailable generation rather than simulating a paid provider.
- Independent read-only review found no remaining actionable issue after fixing schematic SVG
  sizing and migrating the affected navigator labels. The new schematic bounds and modal
  hit-testing assertions cover those integration risks in actual browsers.

Source digest: `df7710b911c21cd59f300d0d562fb5adf761c13204c9c10c9cab74f56e12788e`.
Artifact digest: `66ad856de63c06c1aea4d922b97c3b841afcf41a822348d2f4cbff37eb80fab9`.
Runs wrote local logs/results under `/tmp/pew/`, but that temporary directory was unavailable
following interruption. Counts above reflect observed completed command results, not an archived
four-profile qualification. The browser build manifest retains the source/artifact digests above.
Exploratory failures are excluded from passing counts.

## Remaining qualification and scope

This refines the selected editor surfaces; it does not establish competitor parity or complete
E00–E14. Visual trigger/target connections, presenter/sharing mode clarity, broader layout
assistance and remaining localization stay in the implementation gap map. Manual assistive
technology, physical devices, managed browsers, observed creator tasks and hosted cost/capacity
qualification remain open. New source is local and has not been deployed to the running Docker
application.

## Compact tools and text editing follow-up

Source: `codex/presentation-editor-text-tools`.

Slide tools now use a single 48px icon row for both native content and activities. Localized
tooltips, a visible current-section label, readiness counts, and the existing roving tab
keyboard navigation keep each section identifiable. The heading no longer repeats an eyebrow.

Selected text uses a compact formatting row above the writing surface, with selection-aware
bold/italic and paragraph controls, clear formatting, grouped link tools, and localized
character counts. Body fields have a 300px minimum height; title fields have a 180px minimum.
Both plain and formatted text can resize vertically and scroll internally. Text limits,
authored language, plain-text paste, document history, permissions, and publication contracts
retain their existing behavior.

Verification for this follow-up: **4,927 web tests passed**; web and browser-fixture type
checks, scoped lint/formatting, and the production web build passed. **20 distinct production
browser cases** were verified across Chromium desktop, Firefox desktop, Chromium phone, and
WebKit phone, including 320px geometry and automated Axe checks. The final matrix passed 19
cases; the remaining Firefox long-text case passed separately after correcting a test assertion
to exclude visible bottom padding from its scroll calculation. No application source changed
between those final browser runs. Desktop and 320px screenshots were visually inspected.
