# Option B customer workflow refinement

Decision: implement the November 9, 2026 UI/UX audit's Option B. English remains the
default and existing locale choices remain available. The product owner deferred final
launch-facing pricing, availability, legal, contact and public status content until
official release preparation; it is tracked below and in the release ledger.

## Scope and implementation

| Concern                         | Source implementation                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home hierarchy and onboarding   | Compact returning Home, active rooms before work, compact recent-work rows, positive-evidence milestones retained after a draft, viewer/workspace-scoped dismissal. Round rooms retain secure resume through Sessions, labelled Open Sessions.                                                                                                                 |
| Library recognition and density | First-visible-slide artwork in the authorized list projection, lazy thumbnails/scoped media, question excerpts, wrapping titles, advanced filters with removable applied filters, keyboard-operable tabs. No per-item draft fetches.                                                                                                                           |
| Round editor focus              | Compact References, advisory question review and image disclosures; prompt and answers retain the main editing area. Existing work/retry controls remain mounted.                                                                                                                                                                                              |
| Creation                        | First-session Home and Create lead with quick polling, checking understanding and building a presentation. More formats retains Custom Rounds, Surveys and boards. Blank, Templates, Source assistance and Import share one Round creation surface, with keyboard tabs and compatible deep links. Quick poll creates one private draft only on explicit click. |
| Publication clarity             | Unpublished changes require choosing latest publication or existing publication. The choice shows the exact immutable published version and localized publication date, with loading/unavailable/retry states. Failed/pending save or publication does not navigate. Editor return paths use Library where available.                                          |
| Participation                   | Optional avatar choices, associated errors, activity-aware entry labels, one current progress state, adjacent submission guidance and unscored completion. Existing receipt/retry meanings are retained.                                                                                                                                                       |
| Hosting                         | Compact setup, persistent creation action, primary live command before the stage, secondary controls under More, reduced duplicate status.                                                                                                                                                                                                                     |
| Reports/results                 | Missing evidence differs from measured zero; initial small samples are identified; aggregate labels describe actual evidence; retry retains filters/safe rows; context changes fence late responses.                                                                                                                                                           |
| Readability/accessibility       | Wrapping titles, nonwrapping percentages, readable metric labels, corrected evidence-note contrast, keyboard tabs and mobile More navigation.                                                                                                                                                                                                                  |
| Acquisition                     | Signed-out creation enters signup with its creation destination; signup progress and optional preferences clarify the existing verification then PIN flow.                                                                                                                                                                                                     |
| Critical-flow localization      | Goal/method controls, presentation starting points and core editor commands, response editing, activity-slide guidance, public stage/join states, participant receipts and primary report controls use the existing locale selection. Authored content and unknown server error details retain their original language.                                        |

Preview metadata follows existing creator/workspace list authorization and excludes
speaker notes and content-slide citations/provenance. Hidden slides are skipped. Missing
previews retain a title fallback. Publication, delivery, deletion and privacy boundaries
remain authoritative.

Home milestones use positive evidence in the bounded summary; they do not claim all-time
history. Dismissal is local convenience, not server completion data. Participant preflight
retains the existing room type/code projection; private room titles are not exposed.

Publication metadata is a creator-authenticated, workspace-scoped, non-cacheable projection
of only the current immutable version ID, number and publication timestamp. It returns no
slide content or notes. The dialog accepts metadata only for the version it is offering;
an actor, deck or version change fences delayed reads. A draft edit timestamp is never
used as a publication date.

## Completion follow-up — November 10, 2026

The `codex/option-b-completion` follow-up closes the previously partial creation launcher,
publication summary and primary-flow translation work. Home goal shortcuts follow resolved
workspace grants and editing permissions; feature-off accounts retain the legacy Round
entry. Opening a goal or switching a starting method does not create content. Poll creation
keeps unscored responses and hides unsupported source/import methods.

The follow-up also corrects the mobile More label on routes that do not load the Library
translation domain and the PIN card's intrinsic input width. Existing browser journeys now
open the native More formats, Filters and optional signup-preferences disclosures before
using their controls. Score-privacy and strict phone-overflow assertions remain in place.
First-run viewers retain the quick-start guide without creation actions. Classic participant
screens retain Checkpoint wording, and retention copy distinguishes recorded expiry from
the current plan default. The avatar disclosure uses semantic colors in both appearances.
Closing outline assistance returns focus to the Insert & import summary and closes its
restored popover so it cannot cover the filmstrip.

New reports select nullable opinion correctness from the session's frozen question purpose,
including default single-choice polls that use the legacy live protocol. Opinion correctness
and accuracy remain absent in the UI and CSV; assessed responses with a real zero remain
zero. Unanswered assessed-question rows show Not measured and do not recommend review.
The classic summary also excludes unanswered questions from review counts and does not
assign accuracy to an empty assessment. Stored historical reports without question-purpose
metadata remain unchanged; their meaning is not inferred from zero values.

This is a bounded translation pass over the primary customer journey. Optional staff/embed
credential tools, specialist follow-up management, advanced slide-design/spatial navigation,
Q&A, AI and Pack tools still contain English and require separate language review. Raw
service diagnostics retain their original language. Existing language choices are preserved;
launch-language acceptance remains a release gate.

## Release readiness checklist

Local source/browser verification does not complete these checks.

- [ ] Replace development Terms with approved customer terms and confirm signup consent.
- [ ] Publish approved Privacy content and monitored privacy/security/support contacts.
- [ ] Publish accurate hosted pricing or explicit beta availability, limits and matching actions.
- [ ] Connect the customer Status destination to operational service information.
- [ ] Confirm English as the default and review full critical journeys, errors, dates and
      numbers in the existing supported languages with native-language reviewers.
- [ ] Observe first-time creators completing create, preview, publish, invite and results
      without coaching; record completion, time, errors, help requests and confidence.
- [ ] Observe participant join, submit, reconnect and completion on representative phones.
- [ ] Complete manual keyboard, VoiceOver/NVDA, zoom, reduced-motion, contrast and device
      checks, including sticky-action focus visibility and expanded tools.
- [ ] Complete the exact candidate's existing hosted, privacy/security, capacity,
      operations and release-governance gates in `release-readiness.json`.

## Completion verification

- `VITEST_MAX_WORKERS=1 pnpm check` passes: **7,217 tests pass**, with 513 standard
  opt-in integration skips. Formatting, lint, type checks, Docker-context checks, all
  four production builds and compiled-server startup/configuration smoke pass.
- **86 distinct selected browser cases are verified**: 27 core cases and 59 production
  beta cases across desktop Chromium, phone Chromium and phone WebKit. Corrected reruns
  retain the geometry, score-privacy, overflow, keyboard/focus and Axe assertions.
  Each production profile used a fresh API fixture. Outline generation used the owned
  loopback provider; disabled-AI menus and opt-in text responses used their intended
  configurations. This is not a rerun of the entire hosted browser matrix.
- The final two-line accessible-name correction removes shortened ARIA overrides from
  Blank slide and Content slide. After that change, 92 focused editor/outline/chrome
  tests, scoped lint, web type checking, a fresh production build, and the dialog/menu
  browser journeys pass. Native accessible names include all visible button text.
- Reporting regressions exercise default legacy-protocol polls, pending and ready
  reports, replay metadata, CSV blanks, mixed opinion/assessment results and real
  assessed zero. UI regressions cover empty assessment metrics and question rows in
  both report layouts and English/Korean.
- Existing locale choices remain available. Translation key/placeholder checks cover
  all ten configured locales; actual-render regressions include Korean and French.
- The release-readiness ledger remains at 15 pending gates. Local checks do not
  establish customer satisfaction, manual accessibility or hosted release acceptance.
- Firefox remains unqualified locally because its runtime exits before opening a page
  with `Could not find profile folder`; no Firefox result is inferred from other engines.

## Initial merged verification

- `VITEST_MAX_WORKERS=1 pnpm check` passes on the final source: **7,159 tests pass**,
  with 513 standard opt-in integration skips. Formatting, workspace/build lint, type
  checks, Docker-context checks, all four production builds and the compiled-server
  startup/configuration smoke pass.
- **12 distinct selected browser cases pass** across desktop Chromium, phone Chromium
  and phone WebKit: Home hierarchy/dismissal/navigation, Library previews and private
  Quick poll creation, default participant entry/opinion completion/sticky host action,
  and publication-version choice with keyboard focus, failure recovery and pending state.
- The three Library cases were requalified after screenshot review corrected card-body
  sizing and separated selection controls from authored slide artwork. Grid and list
  geometry are checked in the final cases.
- The WebKit publication case exposed touch activation not restoring focus to Present;
  the application now explicitly retains that opener and the final case passes.
- Firefox qualification remains open: the installed and a fresh official Playwright
  Firefox runtime both exit before opening a page with `Could not find profile folder`.
  Alternate temporary-directory paths did not resolve that local execution problem.
- The release-readiness ledger validates and retains all 15 pending gates. Final public
  launch content remains deferred as requested.

The new cases are `tests/beta-e2e/option-b-workspace.spec.ts`,
`option-b-live.spec.ts` and `option-b-presentation-version.spec.ts`. Adapted existing
browser suites are not a claim that the entire hosted browser matrix was rerun.

Browser screenshots use isolated local fixtures and illustrative content. These checks
do not establish customer satisfaction, hosted performance, manual assistive-technology
acceptance or physical-device qualification.
