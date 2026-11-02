# Manual accessibility review record

- Date/time (UTC):
- Protocol/version and frozen scope:
- Build commit and image digest:
- Environment:
- Reviewer, qualification, and independence from implementation:
- Browser/assistive-technology versions:
- Supported viewport, input, and locale matrix:
- Automated axe workflow URL (supporting evidence only):

## Conformance target and decision rule

The target is WCAG 2.2 AA for every in-scope critical journey. Classify findings as **blocker**
(the journey cannot be completed or creates an immediate safety/privacy risk), **major** (an AA
failure or a journey requiring unavailable assistance), or **minor** (a non-blocking usability
issue). The gate passes only when every required row below has a recorded result, every critical
role can complete its journey, no blocker or major finding remains open, and the independent
reviewer records `Accepted`. Automated axe results, emulation, or a partial browser pass do not
replace the manual assistive-technology review.

Record a WCAG success-criterion reference for every blocker or major finding. A risk acceptance
cannot convert a known WCAG 2.2 AA failure on a critical journey into a pass.

## Required scenarios

| Scenario                                                            | Role/surface                         | Required coverage                                                                                     | Result  | Evidence, WCAG criteria, or issue |
| ------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------- | --------------------------------- |
| Keyboard-only sign-in, authoring, publishing, hosting, and report   | Creator/host desktop                 | Chrome and Firefox or Edge                                                                            | Pending |                                   |
| Keyboard-only join, answer, reconnect, result, and exit             | Participant desktop/mobile           | Timed and flex-compatible live paths                                                                  | Pending |                                   |
| VoiceOver join, answer, reconnect, result, and status messages      | Participant macOS and iOS            | Safari; authoritative save announcements                                                              | Pending |                                   |
| VoiceOver authoring, hosting, and report comprehension              | Creator/host macOS                   | Safari                                                                                                | Pending |                                   |
| NVDA sign-in, authoring, hosting, and report                        | Creator/host Windows                 | Current supported Chrome or Edge                                                                      | Pending |                                   |
| 200% and 400% zoom/reflow without two-dimensional scrolling         | All critical desktop surfaces        | 320 CSS-pixel equivalent where applicable                                                             | Pending |                                   |
| Touch targets, orientation, and mobile overflow                     | Participant and creator mobile       | Portrait and landscape                                                                                | Pending |                                   |
| Text/control contrast and visible focus                             | All critical surfaces                | Every supported theme/preset                                                                          | Pending |                                   |
| Reduced motion and no motion-only meaning                           | Host, participant, and reports       | OS preference enabled                                                                                 | Pending |                                   |
| Presenter sound has an equivalent visual state                      | Host and projected participant       | Muted default and every sound cue                                                                     | Pending |                                   |
| Projector legibility and non-color-only results                     | Host/projected results               | Representative room/display                                                                           | Pending |                                   |
| Extended-time/deadline behavior and announcements                   | Participant                          | Timer, close, reconnect, late state                                                                   | Pending |                                   |
| Error identification, recovery, and validation                      | Creator, host, and participant       | Network, stale state, invalid input                                                                   | Pending |                                   |
| Focus and status recovery after reconnect/navigation                | Host and participant                 | Socket reconnect and REST fallback                                                                    | Pending |                                   |
| Presentation text selection, add/remove, move/resize, and Undo/Redo | Creator desktop/tablet               | Keyboard handles, inspector percentage/region controls, guides, focus recovery, overflow warning      | Pending |                                   |
| Customized slide delivery and narrow reading order                  | Creator, facilitator, participant    | Preview/live parity, image clearance, projector, phone reflow                                         | Pending |                                   |
| Question Health advice and approved draft changes                   | Creator, when enabled                | Finding explanation, dismissal/reopen, preview/apply/undo, revision conflict, sample limits           | Pending |                                   |
| Decision timeline availability and incomplete capture               | Authorized report user, when enabled | Logical reading order, legacy unavailable state, truncation explanation, no color-only meaning        | Pending |                                   |
| Permanent deletion confirmation and partial failure                 | Workspace owner                      | Archived per-item/bulk delete, finished/expired session delete, cancel/focus/status, dependency error | Pending |                                   |

## Canvas coverage when enabled

Freeze the applicable supported device, browser, input, assistive-technology and locale matrix
before execution. Test both the team canvas and guided guest view on the exact deployed candidate.
Role restrictions are expected behavior: a viewer remains read-only and a guest never receives
team editing, comments or history. These rows supplement the critical-journey matrix above;
automated axe and touch emulation cannot replace their manual or physical-device results.

| Scenario                                                      | Role/surface                               | Required coverage                                                                                                                                             | Result  | Evidence, WCAG criteria, or issue |
| ------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------- |
| Discover, select, create and connect objects without dragging | Eligible team editor                       | Keyboard-only toolbar, Object outline, connector source/destination ports and numeric geometry; clear names, focus and selection announcements                | Pending |                                   |
| Group/frame, rotated move/resize, arrange, lock and undo/redo | Eligible team editor                       | Keyboard/numeric alternatives, protected-object restrictions, understandable disabled actions and recoverable conflicts                                       | Pending |                                   |
| Canvas reading, text editing and image alternatives           | Team editor/viewer with VoiceOver and NVDA | Supported Safari and Chrome/Edge combinations; useful object names/alt text, text/composition input, logical outline and non-color-only geometry              | Pending |                                   |
| Physical touch and narrow/reflow alternatives                 | Supported mobile author and guest          | Actual touch targets, pan/pinch/drawing, portrait/landscape, inspector/dialog fit, zoom and usable non-drag controls                                          | Pending |                                   |
| Unsaved proposal recovery and deleted target                  | Team editor                                | Announced stale/save/retry state, retained copyable proposal, explicit discard, navigation confirmation, focus recovery; no automatic overwrite or recreation | Pending |                                   |
| Anchored comments and server-clock timer                      | Team roles and guided guest                | Thread/reply reading order, edit/resolve status, read-only role boundaries, timer state without excessive announcements or automatic phase change             | Pending |                                   |
| Optional presenter follow and exit                            | Team viewer/editor and guided guest        | Explicit opt-in, discoverable exit, keyboard pan/zoom and Escape exit, reduced motion; no trapped input or private frame disclosure                           | Pending |                                   |
| Scanned images, saved versions, linked previews and exports   | Authorized creator/viewer                  | Alternative text, history/preview dialog focus, permission loss and unavailable media status, understandable SVG/PNG and region controls                      | Pending |                                   |
| Guided submission, moderation, publication and voting         | Accountless guest and facilitator          | Own pending content, review/vote limits, explicit publication/removal, protected approved cards; no team comments/history/identities in the guest outline     | Pending |                                   |
| Board sharing, revocation and permanent deletion              | Permitted team roles                       | Clear board role and origin-workspace distinction, confirmation/cancel/focus/status, stale-page clearing and safe return navigation                           | Pending |                                   |

Record exact hardware/network rows in the [physical-device record](device-matrix.md), including the
timing method and its limitations. A geometric canvas may require two-dimensional navigation, but
that does not waive reflow or keyboard access for its surrounding controls and object alternatives.
Apply the same blocker/major decision rule and independent acceptance to all in-scope Canvas rows.
All Canvas manual and physical-device acceptance remains pending until that evidence exists.

## Experience-preset coverage

Verify Focus, Campus, Studio, Blueprint, Signal, and Spark on authoring preview, participant
response, reveal/results, and projected host results. Record contrast, focus visibility, reduced
motion, and audio-equivalence results for each preset; a shared implementation may reference one
finding only when the reviewer verifies that the affected tokens and behavior are identical.

| Preset    | Authoring preview | Participant response | Reveal/projector | Reduced motion/audio equivalence | Result  | Evidence or issue |
| --------- | ----------------- | -------------------- | ---------------- | -------------------------------- | ------- | ----------------- |
| Focus     |                   |                      |                  |                                  | Pending |                   |
| Campus    |                   |                      |                  |                                  | Pending |                   |
| Studio    |                   |                      |                  |                                  | Pending |                   |
| Blueprint |                   |                      |                  |                                  | Pending |                   |
| Signal    |                   |                      |                  |                                  | Pending |                   |
| Spark     |                   |                      |                  |                                  | Pending |                   |

## Findings and decision

- Findings by blocker/major/minor and WCAG success criterion:
- Open blocker/major findings (must be zero for acceptance):
- Minor limitations, owner, and due date:
- Critical journeys completed/required:
- Reviewer decision (accepted/rejected/pending): Pending
- Follow-up issue URLs:
