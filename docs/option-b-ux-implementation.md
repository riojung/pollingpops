# Option B customer workflow refinement

Decision: implement the November 9, 2026 UI/UX audit's Option B. English remains the
default and existing locale choices remain available. The product owner deferred final
launch-facing pricing, availability, legal, contact and public status content until
official release preparation; it is tracked below and in the release ledger.

## Scope and implementation

| Concern                         | Source implementation                                                                                                                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home hierarchy and onboarding   | Compact returning Home, active rooms before work, compact recent-work rows, positive-evidence milestones retained after a draft, viewer/workspace-scoped dismissal. Round rooms retain secure resume through Sessions, labelled Open Sessions. |
| Library recognition and density | First-visible-slide artwork in the authorized list projection, lazy thumbnails/scoped media, question excerpts, wrapping titles, advanced filters with removable applied filters, keyboard-operable tabs. No per-item draft fetches.           |
| Round editor focus              | Compact References, advisory question review and image disclosures; prompt and answers retain the main editing area. Existing work/retry controls remain mounted.                                                                              |
| Creation                        | Quick poll creates one private draft on explicit click and opens its first unscored question. Numbered alternatives are removed; duplicate presentation starts are consolidated. Existing deep links remain available.                         |
| Publication clarity             | Unpublished changes require choosing latest publication or existing publication. Failed/pending save or publication does not navigate. Editor return paths use Library where available.                                                        |
| Participation                   | Optional avatar choices, associated errors, activity-aware entry labels, one current progress state, adjacent submission guidance and unscored completion. Existing receipt/retry meanings are retained.                                       |
| Hosting                         | Compact setup, persistent creation action, primary live command before the stage, secondary controls under More, reduced duplicate status.                                                                                                     |
| Reports/results                 | Missing evidence differs from measured zero; initial small samples are identified; aggregate labels describe actual evidence; retry retains filters/safe rows; context changes fence late responses.                                           |
| Readability/accessibility       | Wrapping titles, nonwrapping percentages, readable metric labels, corrected evidence-note contrast, keyboard tabs and mobile More navigation.                                                                                                  |
| Acquisition                     | Signed-out creation enters signup with its creation destination; signup progress and optional preferences clarify the existing verification then PIN flow.                                                                                     |

Preview metadata follows existing creator/workspace list authorization and excludes
speaker notes and content-slide citations/provenance. Hidden slides are skipped. Missing
previews retain a title fallback. Publication, delivery, deletion and privacy boundaries
remain authoritative.

Home milestones use positive evidence in the bounded summary; they do not claim all-time
history. Dismissal is local convenience, not server completion data. Participant preflight
retains the existing room type/code projection; private room titles are not exposed.

## Release readiness checklist

Local source/browser verification does not complete these checks.

- [ ] Replace development Terms with approved customer terms and confirm signup consent.
- [ ] Publish approved Privacy content and monitored privacy/security/support contacts.
- [ ] Publish accurate hosted pricing or explicit beta availability, limits and matching actions.
- [ ] Connect the customer Status destination to operational service information.
- [ ] Freeze launch languages and review full critical journeys, errors and dates in each.
- [ ] Observe first-time creators completing create, preview, publish, invite and results
      without coaching; record completion, time, errors, help requests and confidence.
- [ ] Observe participant join, submit, reconnect and completion on representative phones.
- [ ] Complete manual keyboard, VoiceOver/NVDA, zoom, reduced-motion, contrast and device
      checks, including sticky-action focus visibility and expanded tools.
- [ ] Complete the exact candidate's existing hosted, privacy/security, capacity,
      operations and release-governance gates in `release-readiness.json`.

## Verification record

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
