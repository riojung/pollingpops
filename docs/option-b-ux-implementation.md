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

This is a bounded translation pass over the primary customer journey. The specialist and
editor/Companion follow-ups below extend that coverage; remaining native audience/template copy, branching/navigation, assistance and Pack library
tools still require separate language review. Raw service
diagnostics retain their original language. Existing language choices are preserved;
launch-language acceptance remains a release gate.

## Specialist workflow follow-up — November 10, 2026

The `codex/option-b-secondary-flows` slice covers Round staff/cohost and presenter embed
controls, report follow-up/access-pass management, participant follow-up guidance and
Q&A/text moderation. System labels, action feedback and known recovery messages use all
ten configured locales. Dates and counts follow the selected locale; authored questions,
responses and credential labels retain their original text. Unknown service diagnostics
remain explicitly attributed to their original language. Native-language acceptance is
still pending.

Staff tools distinguish creation and revocation progress, prevent duplicate credential
writes, place errors beside their actions and keep a visible URL when clipboard access is
blocked. One-time-link guidance explains who can use a link and when to save it. Existing
credential roles, fragment transport, expiry, revocation and HTTPS origin restrictions
remain authoritative.

Follow-up management reads the canonical workspace role: owners and editors can manage
access, while viewers retain useful read-only metadata. Session deletion remains
owner-only. Role changes and late responses cannot re-enable a captured mutation handler.
Access lists have loading, retry, empty and expiry states; failed reads retain safe rows.
Private-link inputs have associated labels and blocked-copy feedback without replacing
the credential. Participant guidance, retry acknowledgements, completion and timer
announcements follow the selected locale while retaining the existing recovery identity.

Presentation Q&A explains facilitator visibility and read-only Companion access. Observer
reply controls are absent and their handlers reject writes. Success notices translate
when the locale changes. Moderation filter groups retain accessible names; private
pending questions and participant aliases keep their existing projection boundaries.
The synthesized participant self label follows the selected locale only when the
canonical projection identifies it as the current participant; authored names, including
literal “You” and staff aliases, remain unchanged. The dark participant header uses the
light brand treatment.

Integration review of the prior PR's completed beta run also found duplicate activity-slide
landmarks, inconsistent legacy slide appearance between preview and delivery, and an
import popover that could cover the next editor action. Activity previews now have
contextual accessible names. Legacy layouts keep their authored appearance unless an
explicit deck design applies, matching delivery. Closing published-Round import hands
focus back to its disclosure without reopening the menu. Browser fixtures now use the
current creation choices, report labels, list/grid geometry and authored-design schema;
assistance expectations follow the fixture's configured provider availability. Existing
accessibility, privacy, recovery and geometry assertions remain in place.

This slice does not complete advanced object inspectors, Sections/spatial navigation,
AI/Pack tools or all Companion chrome. Customer observation, manual accessibility,
physical-device checks and approved launch-facing content remain on the release checklist.

## Specialist verification

- `VITEST_MAX_WORKERS=1 pnpm check` passes with **7,331 tests**, 513 standard opt-in
  skips, formatting, lint, type checks, Docker-context checks, all four production builds
  and compiled-server startup/configuration smoke.
- The final direct-follow-up browser check exposed a missing route catalog: shared
  response controls could display internal keys and overflow at 320 pixels in WebKit.
  Follow-up routes now load their delivery catalog; practice management keeps its
  existing domains. Route-aware regressions cover all ten locales. After this correction,
  **all 361 web suites / 3,459 web tests pass**, as do web type checking, scoped lint,
  and fresh standard and browser production web builds. Unaffected package checks remain
  those of the full repository gate above.
- **55 distinct selected production-browser cases pass**: 21 desktop Chromium,
  17 phone Chromium and 17 phone WebKit. These include nine new Korean staff,
  follow-up and Q&A cases, plus affected editor, moderation, Recovery Pack, reporting
  and Survey journeys. Staff and follow-up controls retain strict 320-pixel overflow
  and Axe checks while one-time URLs are visible, after reload and after revoked access.
  Each profile/qualification phase used a fresh API fixture. Desktop menu/layout
  checks also pass with assistance both enabled and disabled.
- The final brand/self-label polish is requalified in the new Korean Q&A case and the
  existing private-projection/retry cases. Authored English questions and private aliases
  remain unchanged. Final follow-up reruns pass on all three profiles after the route
  correction; corrected reruns do not add to the distinct-case count.
- Zoom geometry checks now sample the toolbar, slide and authored frames atomically
  during responsive reflow, retaining the original one-pixel non-overlap relation.
  Screenshot review includes desktop and phone specialist surfaces. This does not
  replace manual accessibility, native-language or physical-device acceptance.
- The prior PR's [completed CI run](https://github.com/riojung/pollingpops/actions/runs/42774265223)
  passed the repository, migration and all four core browser jobs; its broader beta jobs
  failed or were cancelled. Their identified UI/fixture regressions are addressed and
  selectively requalified here. This is not a fresh full hosted matrix for this branch.
  The existing local Firefox runtime limitation remains open.
- The release ledger validates with **0 complete / 15 pending** gates. Public launch
  content remains deferred as requested.

## Editor and Companion follow-up — November 10, 2026

The `codex/option-b-editor-companion` slice extends the selected locale to native object
selection/movement/resizing, palette/font/spacing, alignment/layering, grouping/rotation,
image framing and fit feedback. Raw object text, labels and identifiers remain unchanged.
Geometry, enum values, document versions and undo history retain their existing meanings.
Authored object language annotations remain authoritative in control and fit labels.

Sections and spatial navigation now localize controls, counts, hidden-slide guidance,
frame editing and audience path descriptions. Section names remain published authored
content. A generated section name follows the locale only at an explicit Add action;
changing language never renames existing sections. Spatial positions remain an overview;
the numbered block order remains the playback authority. Audience projections retain
their geometry-only privacy boundary. Spatial dialog controls now share semantic surface,
text, border and accent tokens, with keyboard focus and disabled states; authored preview
content is excluded from those control styles.

Read-only creators retain navigation, inspection and preview. Sections disable mutation
controls, and the builder checks current editing permission before both scheduling and
applying a history update, including captured callbacks and undo/redo. Native object
mutation controls and gestures follow the same permission boundary without changing
owner editing or server authorization.

Companion shell, launch/revocation, connection/retry feedback and aggregate overlays use
the existing locale, including its Quick Check, published-question and Recovery Pack
pickers. Authored choices, questions, aliases and card content retain their language.
Known application feedback translates when the locale changes; unknown service diagnostics
retain explicit original-language attribution. Language changes preserve pending command
identities rather than recapturing the scoped pass or creating another action.
Screenshot review also identified a narrow-screen layout gap: Companion and its Q&A
panel now stack below 54rem rather than shrinking into two cramped columns. A production
browser geometry assertion checks readable card width and vertical panel order at
320px on phones and 420px in the desktop Companion window.

Integration qualification also follows up the previous hosted failures. The inert-background
browser check asserts disabled controls plus actual focus rejection, preserving its single-dialog
contract. Translation checks scope authored labels to their filmstrip button. Visual-import
accessibility waits for enabled opacity before running the unchanged Axe scan. Compact stage
word clouds use bounded decorative sizing so long terms leave room for the count table;
complete labels, counts, public projections and join controls remain intact.

This is another bounded implementation pass. Detailed native text/data/video/interaction
inspectors, authoring assistance and Pack library/editor tools remain outside this slice.
It does not complete customer observation, native-language review, manual accessibility,
physical-device qualification, the hosted matrix or the deferred public launch content.

### Editor/Companion verification

- The integrated repository gate passes **7,426 tests**, with 513 standard opt-in skips,
  formatting, lint, type checking, Docker context, four production builds and compiled-server
  startup. This precedes the final authored-language, stage-sizing and layout polish below.
- After the authored-language and compact stage-result follow-ups, all **366 web suites /
  3,547 tests** and web type checking pass. Scoped lint and formatting pass. The last
  Companion layout follow-up changes CSS only and is qualified through fresh production
  builds and browser geometry/accessibility checks.
- All ten configured locale catalogs and native-control render variants are covered by
  focused tests. Korean production journeys retain original authored content, stored enums,
  geometry/history, read-only inspection and privacy/command identity boundaries.

- **51 distinct selected production-browser cases pass**: 18 desktop Chromium, 16 phone
  Chromium and 17 phone WebKit, with fresh API fixtures per profile/phase. These cover the
  three new Korean journeys, existing native design/image/geometry/rich-text and spatial
  workflows, Companion core/auxiliary pickers, Q&A, both translation cases, compact stage
  word clouds, deferred import preparation and WebKit visual-PDF review/insertion.
- The final layout-only Companion change is followed by fresh normal and beta web builds
  and **12 production-browser passes**: nine Companion/Q&A cases across the three local
  profiles, desktop stage/deferred-import checks and WebKit visual import. These are included
  in the 51 distinct cases; reruns are not added to that count. The new Companion journey
  verifies stacked panel order and readable widths at 320px/420px as well as Axe, overflow,
  focus, scoped credentials, exact retry identity, aggregate privacy and revocation.
- Source formatting, scoped lint and diff checks pass. The release ledger remains valid
  with **0 complete / 15 pending** gates. The preceding PR #225 hosted failures motivated
  the local regressions above; they do not establish a passing hosted matrix for this branch.
  Local Firefox still cannot start its profile, and the current full hosted matrix, manual
  accessibility, physical-device/customer qualification and native-language review remain open.

## Native editor shell follow-up — November 10, 2026

The `codex/option-b-native-editor` slice extends selected-language copy to the native
editor's inspector heading/close action, selection summary/picker, insertion menus,
ordinary text/shape/connector fields,
position/size guidance, image-upload states and accessibility/reading-order controls.
The shell's writing-assistance entry points follow the locale; the separate assistance
review/recovery dialogs remain outside this slice. English remains the default and all
ten configured locales retain coverage.

Generated object labels use the existing locale-aware fallback; authored text, labels,
descriptions and their language annotations remain unchanged. Language names are display
labels for stored language codes. Changing the application locale never changes object
content, shape/color/anchor enums, geometry, order, document versions or history. Known
local feedback is stored as source keys and translated when displayed. Existing permission,
portal mounting, media scanning and explicit-insertion behavior remain authoritative.

Specialized rich-text/data/video/interaction internals and remaining canvas copy retain
explicit original-language boundaries inside the localized shell. Branching/shared
navigation, assistance review/recovery and Pack library/editor tools remain pending.
Native-language acceptance and customer/manual/device qualification remain release work.

Hosted investigation of [PR #226’s WebKit job](https://github.com/riojung/pollingpops/actions/runs/42869869061/job/130017928811)
found that phone WebKit reached case 125 of 132 and hit
its 30-minute job limit; no assertion failure was recorded before cancellation. Five
later fresh-API phases were skipped, and browser-smoke correctly rejected the cancelled
beta result. WebKit's beta job budget is now 45 minutes; all other projects retain 30.
Per-case/step limits, assertions, workers, retries, phases and smoke requirements remain
unchanged. This budget adjustment does not establish a passing hosted matrix for the new
source; that remains pending candidate-specific qualification. The merged baseline’s
[main run](https://github.com/riojung/pollingpops/actions/runs/42879549851) subsequently hit
the same 30-minute cap at case 131/132, again without a recorded assertion failure before
cancellation; its later phases were skipped. Both observed runs used the previous budget.

### Native editor verification

- Repository validation completes formatting, lint, type checking, Docker context checks,
  **7,452 passing tests** and 513 standard opt-in skips, all four production builds and
  compiled-server startup. The final complete smoke-support suite passes 423 tests after
  updating its existing budget policy guard; all package suites pass 7,029 tests, including
  **368 web suites / 3,569 tests**.
- All **161 typed native-editor UI keys** cover the ten configured locales, including 35
  reused shared translations. Coverage checks preserve placeholders and English defaults;
  real-render and behavior tests cover language changes with active feedback, authored
  language annotations, retained image-description input, editing/history identities,
  reading order and permission guards.
- The beta production web build passes. The workflow parses, and its policy test verifies
  each matrix project's actual budget while preserving isolation and coverage assertions.
  The new workflow/source still requires hosted qualification; local checks do not close
  release acceptance.

- **37 distinct selected production-browser cases pass**: 13 desktop Chromium, 12 phone
  Chromium and 12 phone WebKit. They cover the new Korean/German ordinary-editor journey,
  prior localized native controls, geometry, grouped inspectors and insertion menus,
  tables/charts, interaction preview, rich text, native publish/delivery, pending-image
  history, dense phone layouts, both translation journeys and reviewed text recovery.
  Each profile/phase uses a fresh API; authoring uses an owned loopback provider.
- The final three parent-inspector labels are followed by **155 focused web tests**,
  web type checking, scoped lint and fresh normal/beta production builds. Phone WebKit
  qualifies the complete selected set against that final build; the new native-editor
  journey is requalified on desktop and phone Chromium. Reruns are included in the 37
  distinct cases rather than added to that count. The ordinary-editor case checks
  320px phone overflow, Axe, raw authored text/language, enum/geometry/history semantics,
  explicit insert/undo, locale changes without draft writes and canonical viewer inspection.
- Screenshot review includes the localized inspector heading, ordinary Content/Access/Media
  controls, authored Spanish/English values and retained focus treatment. Specialist child
  editors remain explicitly English. Native-language review, manual accessibility and
  physical-device/customer acceptance remain open; the release ledger stays at 15 pending
  gates and public launch content remains deferred.

## Specialized native editor follow-up — November 10, 2026

The `codex/option-b-specialist-editors` slice extends selected-language controls and known
validation/recovery guidance to rich text, tables/charts, external video and interaction
authoring. English remains the default. Three typed catalogs cover 191 UI keys across all
ten locales, reusing eleven existing shared translations. The parent passes its current
locale through mounted editors and the interaction map; the audience renderer and shared
library descriptors retain their existing contracts.

Rich-text formatting, paragraph/link tools and feedback preserve selection, caret, exact
history fields, authored runs/text and language annotations. Video guidance localizes its
inputs and known errors while retaining raw titles, URLs, transcript destinations and the
existing explicitly added link content. It does not load provider scripts or iframes.

Data editors localize options, grid descriptions, cell names, paste/apply/discard controls
and known validation/status feedback. Changing the mounted locale preserves staged cells,
paste bytes, invalid values and feedback. Applying data, revision fences, numeric/byte
limits, raw authored captions/headers/series and enum values retain their existing meanings.
Generated default data values remain unchanged; the synthetic category heading is a
localized display label rather than a staged-data edit.

Interaction controls, overview and map distinguish authored labels, target titles and
URLs from system-generated descriptions. Known readiness issues localize; unknown feedback
retains explicit original-language attribution. Unsaved URL entries continue to block preview
across object changes. Read-only users retain valid local Preview and map selection while
mutation fields follow the existing canonical permission boundary. Opening previews or the
map never publishes, starts live delivery, submits answers or invokes external destinations.

Remaining native audience/template copy, branching/shared navigation, assistance
review/recovery and Pack library/editor tools remain outside this slice. Native-language
review, observed customer usability, manual accessibility/device acceptance and deferred
public launch content remain release work. This implementation does not complete release
acceptance or hosted qualification of the new source.

### Specialized editor verification

- `VITEST_MAX_WORKERS=1 pnpm check` passes **7,575 tests** with 513 standard opt-in skips,
  formatting, lint, type checks, Docker-context validation, all four production builds and
  compiled-server startup. The web portion passes **372 suites / 3,692 tests**.
- The three catalogs cover 191 typed keys across ten locales, including eleven reused
  translations. Focused tests cover known/unknown feedback, all locale columns and
  placeholders, active selection/staged entries across mounted locale changes, authored
  collisions, exact history fields, stale data/URL/image/target fences and read-only preview.
- The beta production web build passes. Local browser qualification uses fresh API fixtures
  per profile/phase; the automated checks do not establish native-language, manual
  accessibility, physical-device, customer or hosted acceptance of this new source.

- **46 distinct selected production-browser cases pass**: 16 desktop Chromium, 14 phone
  Chromium and 16 phone WebKit. These include six new Korean specialist/interaction cases,
  German data-editor inspection, prior localized native controls, rich text, tables/charts,
  grouped inspectors/insertion menus, native publish/delivery and upload/history recovery,
  basic/advanced interactions, image-backed map geometry and both translation journeys.
  The corrected interaction test checks effective inherited language rather than requiring
  a redundant leaf `lang` attribute; its successful rerun is counted once.
- New editor cases retain one-pixel phone-overflow and Axe checks with invalid data, staged
  drafts and viewer inspection. They assert exact raw text/language, enum/data/history
  values, no saves for rejected/staged/discarded input, no external requests from video/link
  setup, and local preview/map actions with no publication, session or response writes.
  Screenshot review includes desktop and 320px phone controls, map descriptions and raw
  authored values. These checks retain their local automated scope.
- The previous [PR #227 hosted CI run](https://github.com/riojung/pollingpops/actions/runs/42904644615)
  has now passed the repository check, migration, all four core and all four beta browser
  projects, including phone WebKit under its 45-minute budget, and browser-smoke. Security
  and production-smoke checks also passed for that baseline. This evidence is bound to
  `40057ec2de1bccf1b9f864f5fc65056c899f78bc`; it does not qualify these new uncommitted
  specialist-editor changes. Their hosted matrix and local Firefox qualification remain
  open. The release ledger remains valid with **0 complete / 15 pending** gates.

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
