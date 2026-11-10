# Presentation interaction map and creator cues

Source: `codex/presentation-interaction-map`, from `348ebc5` (merged PR #221).

## Creator experience

Native content slides with actions offer a collapsed Interaction map beside the ordinary canvas controls.
Opening it lists actions in reading order, with type, label and a distinct ordinal for duplicate
labels. Selecting an action changes only the editor selection. A compact connection card explains
its trigger, outcome and local/live audience meaning; Edit interaction opens its existing Content
tools. Ordinary slides do not gain extra interaction chrome.

On the wide authored plane, passive outlines identify actions and the current action. A selected
valid hotspot also outlines its associated image and draws their connection. Outlines follow local
move/resize previews, disappear on cancellation and use the same authored frames and rotations as
the objects. The connection begins at the action's boundary to clear its label. Cues contain no
controls, badges or labels over the slide and cannot intercept input.
Phones retain the equivalent semantic map; coordinate annotations are hidden in reading flow.

Reveals own their audience content inside their existing panel; they do not target another object.
Slide links show the available destination's actual title, respecting the existing hidden/self/
recheck rules and case-insensitive block IDs. Missing, rotated or out-of-bounds hotspot associations
produce guidance instead of a fabricated image connection. Group selection keeps the explicitly
requested action last, preserving the existing group editing behavior.

The map never runs an authored action, follows a URL, moves the draft to another slide or starts a
preview. Testing stays in the existing contextual preview, including its unsaved-URL and pending-edit
guards. No Ready claim is inferred from saved data while unsaved entries may remain elsewhere.
The action list and outcome card have bounded scrolling, keyboard access and visible focus.
Buttons take their accessible names directly from their visible ordinal, type and label. The
expanded map stacks when its available width narrows, including under page zoom. The new workflow
also repairs contextual preview navigation: focus moves to the surviving slide region before a
link's old slide unmounts. Shared custom-dialog focus handling explicitly steps through visible,
enabled controls and reading regions, retaining Tab, Shift+Tab, Escape and invoker restoration even
when a browser's native Tab policy skips buttons. Nested dialogs keep their own keyboard handling.

## Architecture and boundaries

The read-only shared interaction model reuses the existing overview descriptions. The map and
SVG annotations are separate editor components. Visibility and selection stay local; map actions
do not enter history/autosave or alter frames, IDs, scene versions, publication hashes or source
records. The renderer accepts annotations only while actually editing, excluding inert thumbnail,
ordinary preview and live/export callers. No database, API, protocol, service, asset, dependency,
model call or paid allowance is added.

## Qualification

`VITEST_MAX_WORKERS=1 pnpm check` passes: **7,112 tests**, **513 standard opt-in skips**,
formatting, lint, types, all four builds and compiled-server startup/configuration smoke. The
focused editor/model suites pass 181 cases overlapping that total. The new browser spec separately
passes strict TypeScript checking with an ES2022 target.

All **34 selected production-browser workflows pass** on the frozen dedicated beta artifact, with
a fresh API per profile and zero retries:

| Profile          | Passed |
| ---------------- | -----: |
| Chromium desktop |      9 |
| Chromium phone   |      8 |
| WebKit phone     |      8 |
| Firefox desktop  |      9 |

The workflows include the new map, existing interaction authoring, grouped composition/pointer
gestures, native editing/history/publication, local and broadcast interactions, and live navigation
recovery. Repeated smokes and exploratory failures are excluded from this unique total.
The synthetic PNG goes through the ordinary
upload ticket, signed PUT and clean-completion flow of the opt-in loopback storage/scanner fixture;
presentation records and editor writes are not mocked. Monitoring begins after fixture setup.

The workflow verifies semantic action order, duplicate labels, target titles, local/live meanings,
valid/invalid hotspot associations, passive geometry/hit testing, contextual preview isolation,
keyboard focus and reverse Tab after navigation, 320px layout, 200% zoom and automated Axe. It
compares the complete saved API record and watches for media/draft, session, publish, response and
external requests. Exploratory failures are excluded from final passing counts. They exposed and
fixed preview focus after navigation and accessible-name mismatches; fixture setup was corrected
to create an owned image instead of referencing an unregistered asset.
Firefox's final rerun waits for the wide responsive panels before closing them and applying zoom;
this prevents a transient Hide inspector locator from disappearing between its visibility check
and click. The application artifact remains unchanged for that test-only sequencing correction.

One earlier repository attempt timed out in an unchanged operations-support test while build/browser
work overlapped. The final isolated repository run passes with ordinary limits; no timeout,
allowance or safety check was relaxed. An independent read-only review found no remaining confirmed
implementation issue. Its reverse-Tab and radio-group observations informed the final dialog focus
helper; named groups retain one checked or first eligible stop and arrow keys keep native behavior.

The actual focus helper additionally passes **44 separate browser checks**: 11 each in Chromium,
Firefox, WebKit desktop and WebKit's iPhone 15 profile. The temporary harness imports the actual
helper and checks reading-region navigation, radio Tab/Arrow behavior, wrapping, modifiers,
default-prevented ownership, nested native dialogs, Escape and opener restoration. These checks
are separate from the product workflow counts and do not qualify physical iPhones.

Frozen application source SHA-256:
`b6139627f29379b2b0ef7b9092d3cd6dfe8fd8b20cc9dfc72724d2b8dd175709`.
Artifact SHA-256:
`1046771bfb37d348c3aa9610bbdc82e5564e5e84a9cb5fbd4ff43a314829f5c3`.

These local fixture checks do not establish hosted storage/scan, physical-device, managed-browser,
manual assistive-technology or capacity qualification.
Screenshots and compact, sanitized receipts are retained locally under the ignored
`artifacts/presentation-interaction-map/` directory.

## Remaining work

This closes the selected editor trigger/target discoverability slice. Presenting/sharing mode and
version clarity, interaction-card fit refinements, broader visual-stage portability and observed
creator tasks remain in the gap map.
General scripting, variables, games and competitor parity remain separate scope. Source changes
are not deployed to the running Docker application.
