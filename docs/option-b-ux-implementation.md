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

## Native audience and navigation follow-up — November 10, 2026

The `codex/option-b-audience-navigation` slice extends selected-language controls to the
shared native audience renderer, branch authoring and live host/Companion navigation.
English remains the default. Two typed catalogs cover 96 UI keys across all ten configured
locales: 77 new translation rows and nineteen reused translations. Canonical navigation
policy feedback also reuses the existing Sections/spatial adapter, and the host reuses
Companion navigation/acknowledgement wording.

The shared `ContentSlideView` boundary resolves the application language unless a caller
explicitly supplies one. Native audience controls therefore follow the selected language
in editor preview, shared review, follow-up content, live delivery and Companion without
rewriting slide data. The low-level renderer remains compatible with callers that omit
locale. The legacy renderer and the still-pending layout-assistance area retain their
existing explicit language boundaries.

Accessible outline controls, reveal/action notices, detail dialog controls, image feedback
and chart legends/data guidance distinguish system copy from authored text. Stored text
language is retained; unknown authored labels, titles, bodies, cells and URLs retain
explicit unknown-language boundaries. Authored strings that happen to equal an English
UI key are never translated by lookup. Locale does not enter the native interaction state
identity, so mounted local disclosures and dialogs retain their state.

Branch labels, choice/target IDs including their original case, percentage/response limits
and exact history fields keep their existing meanings. Read-only/mutation-busy branches
are disabled and guarded, while live navigation and branches continue to obey canonical
server eligibility. Known policy reasons translate only at display time; unknown service
diagnostics stay verbatim with their original English attribution. Server snapshot title
fallbacks have no provenance distinct from authored titles, so these titles stay unchanged.
Navigation dialogs retain keyboard containment, close focus and return focus; retries keep
the original command and acknowledgement identity. Navigation titles and statuses occupy
separate rows, and return controls wrap naturally within the available width, keeping long
authored titles readable on 320px phones.

The host and Companion explicitly focus their navigation launchers before opening a dialog,
so Safari can return focus to the actual trigger. Passive editor interaction artwork reuses
the existing conditional overflow observer and focus ring: it gains a keyboard stop only
when its content needs scrolling. Scroll keys retain native scrolling and cannot trigger
presentation shortcuts. Live audience controls and inert thumbnails keep their existing
behavior.

The inherited hotspot issue was observed in the
[merged specialist-editor Chromium job](https://github.com/riojung/pollingpops/actions/runs/42913212189/job/130168913765):
Axe reported a scrolling passive preview without keyboard access. The regression fixture
now forces overflow in the desktop editor and checks the visible phone canvas using its
actual responsive geometry. It retains the Axe, one-pixel overflow, authored-content,
permission and no-save assertions; it does not require a hidden phone canvas to scroll.

Native templates and generated table/chart examples are persisted draft content rather
than renderer labels. Creation-locale template/default content remains a separate pending
phase, alongside assistance review/recovery and Pack library/editor tools. Native-language
review, observed customer usability, manual accessibility/device acceptance, hosted
qualification and deferred public launch content remain release work.

### Audience and navigation verification

- The repository gate passes **7,621 tests** with 513 standard opt-in skips, formatting,
  lint, type checks, Docker-context validation, all four production builds and compiled
  server startup. After final integration and accessibility corrections, all **378 web suites /
  3,800 tests** pass, giving **7,683 passing tests** across the validated repository suites.
  Final web type checking, integration lint and fresh normal/beta production builds pass.
- Catalog coverage checks all 960 key/locale entries, English defaults, placeholders and
  shared wording. Real-render/state tests cover authored collisions/language, active local
  disclosure/dialog state across mounted locale changes, branch IDs/threshold/history,
  viewer callback guards, canonical live policies, focus stability and exact retry objects.
- **58 distinct selected production-browser cases pass**: 20 desktop Chromium, eighteen
  phone Chromium and twenty phone WebKit. Nine new Korean cases cover audience controls,
  branch editing and host/Companion navigation. Existing native/template/data, interaction,
  spatial, translation and linked-recovery journeys also pass. Each profile/phase uses a
  fresh API; authoring and visual import use the existing owned loopback fixtures.
- After the keyboard/layout corrections, 34 affected cases pass, including the complete
  eighteen-case phone WebKit selection and advanced image/map journeys on desktop and
  phone WebKit. Six further navigation cases requalify final focus-ring spacing across all
  three profiles. Reruns remain included once in the 58 distinct cases. Screenshot review
  covers localized controls, authored collisions, 320px chart/branch/navigation layouts,
  visible focus and readable title/status rows.
- The new live fixture's accepted-response expectation is corrected to the actual HTTP 202
  contract. Its successful reruns preserve response acceptance, exact retry identity and
  score assertions. The passive-preview test measures the visible responsive phone canvas;
  it requires a keyboard stop only for actual overflow and forces the desktop overflow
  reproduction. Axe and all existing privacy/history/permission assertions remain in place.
- One visual-import attempt spans a local runtime interruption: upload/completion/image
  reads succeed, while autosave and screencast activity pause for about ten minutes. Both
  advanced image/map profiles pass with a temporary keep-awake process, without upload or
  timeout changes. This local observation does not qualify the hosted matrix. Native-language,
  manual accessibility/device and customer acceptance remain open; the release ledger stays
  valid with **0 complete / 15 pending** gates.

## Assistance review and recovery follow-up — November 10, 2026

The `codex/option-b-assistance-recovery` slice extends selected-language guidance to outline
proposals, text rewrite/shorten/translation proposals and recovery, and local layout
comparison. English remains the default. Three typed catalogs expose 218 keys across all
ten configured locales, with 196 new translation rows and 22 references to shared wording.

Proposal creation, allowance/availability, mandatory review confirmations, source/target
language controls, invalid recovery guidance and exact retry actions translate at display
time. Canonical language codes and the saved target language remain distinct from the UI
locale. Original/proposed text, excerpts, source names, provider/model values, object IDs
and stored metadata are never translated by equality; known text language stays attached
and unknown authored language remains explicit. Known policy warnings and diagnostics use
an allowlist; unknown English service feedback retains its original-language attribution.

Changing a mounted locale retains staged outline fields, selected slides, reviewed state,
pending/error feedback and recovery. Locale does not enter controller effects, actor or
storage keys, request intent, revision/source identity or receipt bytes. Permissions,
authentication invalidation, explicit review, reload-before-clear and exact retry guards
remain intact. The underlying clients, recovery formats, providers, services and contracts
are unchanged.

The builder passes its locale to the modal components, translates resume guidance and
renders the latest text-edit attribution in that language, retaining raw provenance and
the canonical generated timestamp. Ready proposal/attribution notices use the existing
source surface. Assistance dialogs use shared overlay, border, shadow and focus tokens,
with wrapping headings/actions for long labels.

Local layout comparison translates controls, known generated alternative descriptors,
availability and recovery guidance, alongside the complete accessible reading copy. Its
decorative fixed-plane previews remain inert, and stored text/language, rich links, data,
reading order, source snapshots and selected alternatives retain their meanings. Layout
generation, IDs/frames, fingerprints, size limits, apply guards and history are unchanged.
Fit-feedback language can be supplied without changing measurement dependencies.

Creation-locale template/default content, discussion/source-import assistance and Pack
library/editor tools remain outside this bounded slice. Public launch content stays
deferred. Native-language review, customer observation, manual accessibility/device
acceptance and exact-head hosted qualification remain release work.

### Assistance verification

- `VITEST_MAX_WORKERS=1 pnpm check` passes **7,790 tests** with 513 standard opt-in skips,
  formatting, lint, types, Docker-context checks, all four production builds and compiled
  server startup. The web portion passes **381 suites / 3,907 tests**. The fresh beta
  production build and focused builder integration checks also pass.
- The catalogs cover all 2,180 exposed key/locale entries, English defaults and placeholders.
  Focused checks cover authored collisions and language boundaries, mounted review/recovery
  retention, exact callback/request identity, permission/authentication fences and layout
  currentness. Fixtures use the existing owned loopback provider.
- **51 distinct selected production-browser cases pass**: seventeen each on desktop
  Chromium, phone Chromium and phone WebKit. Nine new cases cover Korean outline/text
  review, German receipt recovery with unchanged request identity, and local layout review.
  Existing outline-first creation, uncertain creation/insertion/application, safe Undo,
  stale-source rejection, conclusive refusals, invalid recovery, explicit translation intent,
  grouped editor controls, rich text and readable table/layout comparison also pass.
- Each browser/profile phase uses a fresh API; text receipt recovery and the remaining text
  journeys retain their existing isolated admission budgets. Generation uses the owned
  loopback provider, with source/other-object/citation privacy checks. No provider, timeout,
  controller or API changes were required for qualification.
- Layout checks preserve complete draft equality apart from the chosen preview frames,
  with canonical empty sections seeded before baseline tracking, and verify normal
  Undo/Redo. Native dialog checks reject background focus, exercise Escape and keyboard
  Close with return focus, and respect browser chrome and
  [WebKit keyboard navigation preferences](https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac).
  These automated checks do not replace physical-device or assistive-technology acceptance.
- New cases retain Axe, one-pixel phone-overflow, mandatory review, read-only and no-save
  before apply assertions. Local layout review also verifies no AI requests or quota use.
  Screenshot review covers the 320px controls, wrapping
  actions, raw Spanish/French wording, citations and the complete layout reading copy.
  Corrected fixture reruns are counted once in the 51 distinct cases. Native-language,
  observed customer, manual accessibility/device and exact-head hosted acceptance remain
  open; the release ledger stays valid with **0 complete / 15 pending** gates.
- The preceding [PR #230 CI run](https://github.com/riojung/pollingpops/actions/runs/42925072587)
  passed all four core browsers and three beta browsers; Firefox beta was cancelled and the
  aggregate browser gate therefore failed. Its
  [dependency audit](https://github.com/riojung/pollingpops/actions/runs/42925073190/job/130209383109)
  also reported a low-severity `fast-xml-parser` advisory. These are observed baseline checks
  for `58eade92a4f170fc71413f270ad5cc7cbc95c9c9`, not qualification of this new source.
  No hosted retry, dependency change or release-gate completion is claimed by this UI slice.

## Source workflow follow-up — November 10, 2026

The `codex/option-b-source-workflows` slice extends all ten configured UI locales to local
question starters, AI discussion suggestions, visual import review/recovery and the
trusted-source dialog guidance. English remains the default. Source and proposal review,
mandatory confirmations, retained-request actions, editor launch/resume controls and
known diagnostics use 276 typed, display-only catalog keys and existing shared wording.

The local starter templates and generated discussion wording remain English under their
existing contracts. Source text, filenames, page titles/descriptions, accessible reading
text, citations and provider/model values remain verbatim, with stored language retained
and unknown authored language explicitly marked. Changing the interface language does not
regenerate content or enter source fingerprints, controller effects, actor/storage identity,
request bodies, insertion receipts, selected page order or ordinary Undo/Redo history.
Known system warnings use explicit allowlists; unknown English diagnostics remain English.

The trusted-source dialog now passes actual editor permission to its existing assistant,
checks current permission before opening and again after the prerequisite save, and keeps
its existing insertion target and opener restoration. If a permission change removes a
focused form control, focus returns inside the dialog so keyboard commands remain available.
Original input, proposal wording, source names and citation fields
in the shared assistant carry explicit unknown-language annotations. Review surfaces use
semantic focus/border/surface tokens and wrapping headings, actions and long source values.

Creation-locale template/default content and Pack library/editor tools remain follow-ups.
Customer observation, native-language review, manual accessibility/physical-device checks,
exact-candidate hosted qualification and the deferred launch-facing pages remain release
work. The release ledger is unchanged.

### Source workflow verification

- `VITEST_MAX_WORKERS=1 pnpm check` passes **7,947 tests** with 513 standard opt-in skips,
  formatting, lint, types, Docker-context checks, all four production builds and compiled
  server startup. Web validation passes **386 suites / 4,064 tests**. The fresh beta
  production build and the four new browser specs’ TypeScript/discovery checks pass.
- Catalog checks cover all 2,760 exposed key/locale entries, placeholders, shared wording
  and canonical English defaults. Mounted cases preserve source/proposal values, selection,
  pending receipts, exact request identity, permission/authentication fences and authorized
  media-preview retries. Trusted-source integration covers live permission changes before
  opening, during prerequisite saving and while reviewing an open proposal.
- The first browser phase exposed focus falling outside the trusted-source dialog when a
  permission change removes its focused form. A separate current-permission focus guard
  retains the original opener and restores an internal keyboard stop. After that fix,
  43 focused builder/modal tests pass. The visual-import title now reuses the command catalog
  so launcher and dialog terminology agree; 44 visual-import/catalog tests cover the final
  wording, English fallback and existing review/retry behavior. Scoped lint, web types and
  fresh normal/beta web builds qualify these small follow-ups.
- Keyboard-close coverage found a second focus gap when resuming discussion review removes
  its opener. Document body/root sentinels now fall back to the visible Resume control;
  70 discussion component/catalog tests pass, including both sentinel regressions. Native
  dialog checks allow browser-chrome sentinels while rejecting background controls and
  require inside-dialog progress, Escape and keyboard Close with return focus. The final
  full web suite and production builds requalify these UI follow-ups.
- Final integrated web validation passes **386 suites / 4,066 tests**; combined with the
  unchanged package checks, validated repository coverage is **7,949 passing tests**.
  Final web types, scoped lint, formatting and fresh normal/beta web builds pass.
- **44 distinct selected production-browser cases pass**: sixteen on desktop Chromium
  and fourteen each on phone Chromium and phone WebKit. Twelve new cases cover Korean
  question-starter/source review, trusted-source input/permission transitions, discussion
  review and German receipt recovery, and PDF page review with exact insertion recovery.
  Existing starter delivery/history, grouped editor controls, discussion review/stale-source/
  lost-reply/privacy and visual conversion/delivery cases pass, along with the shared
  source-authoring regression cases. Corrected reruns count once.
- AI fixtures use the existing owned loopback provider; PDF conversion uses the existing
  synthetic scanner/storage fixture. Each browser/profile phase has a fresh API. Request
  bytes, private-source projection, page order/descriptions, mandatory review, fidelity,
  source/currentness and normal Undo/Redo assertions remain in place. No client/controller,
  contract, API or timeout changes were required.
- New cases retain Axe, one-pixel document/dialog overflow, original-language boundaries
  and no-insertion-before-review checks. Screenshot review covers 320px Korean/German
  controls, long wrapping actions, French/English source and proposal wording, clear focus
  and import review fields. Automated checks do not complete native-language/customer,
  manual accessibility/physical-device or hosted acceptance. The release ledger remains
  valid at **0 complete / 15 pending** gates; deferred public launch content stays open.

## Pack tools follow-up — November 11, 2026

The `codex/option-b-pack-tools` slice extends the ten configured UI locales to the Pack
library and editor, private source review/approval, checkpoint export review, Round and
Presentation insertion/update tools, frozen facilitator references and practice entry points.
English remains the default. Six typed catalogs contain 355 UI entries alongside 24
canonical export-finding reason translations. Existing generated/default content remains
unchanged; creation-language templates and sample/default content remain a separate follow-up.

UI language stays outside source approval, frozen content hashes, published version identity,
request/recovery bytes, update choices, mutation IDs, revision fences and ordinary history.
Known system labels and diagnostics translate at display time. Authored/source wording,
concept and misconception keys, answer data, citations, technical paths and exported JSON
retain their stored values and language boundaries. Roles, publication approval and retained
receipt retry semantics keep their existing meanings.

### Pack tools verification

- `VITEST_MAX_WORKERS=1 pnpm check` passes **8,066 tests** with 513 standard opt-in skips,
  formatting, lint, types, Docker-context checks, all four production builds and compiled
  server startup. Web validation passes **392 suites / 4,183 tests**. Browser-spec types and
  discovery pass; the fresh beta production build also passes.
- Catalog checks cover all 355 listed UI entries across ten locales and the 24 exact
  canonical export-finding reasons. Unknown control-label diagnostics and additional
  provider detail remain untranslated English; finding reasons require both the canonical
  code and exact message. Raw authored fields, snapshots, request bytes, review choices,
  source approval, role/feature fences and export data are exercised in mounted regressions.
- Root integration and practice-entry checks preserve exact Pack comparison signatures,
  frozen references, published-version links and read-only gating across UI locale changes.
- Screenshot review found a clipped final letter in the German published-Round placeholder.
  The shorter published-Round wording fits the native select. After this small UI refinement,
  25 focused library/catalog tests, web types, scoped lint and fresh normal/beta builds pass.
- **50 distinct selected production-browser cases pass**: twenty desktop Chromium and
  fifteen each on phone Chromium and phone WebKit. Fifteen new cases cover library editing,
  frozen practice links, source approval, export losses and artifacts, explicit Round update
  choices, Presentation picker/references and exact apply/undo receipt recovery. Existing
  source-authoring, insertion, deleted-checkpoint/link repair, stale-review, history, portability
  and practice regressions pass. Corrected fixture reruns count once.
- Each browser/profile phase has a fresh API. Source generation uses the existing owned
  loopback provider. New cases retain mandatory review, frozen-source/hash/version identity,
  zero generation/approval on locale changes, private metadata boundaries, read-only and
  disabled-feature behavior, exact request bodies, source/history integrity and exact
  CSV/QTI/report artifact bytes. The initial oversized citation fixture was shortened within
  its existing server limit while retaining a long unbroken overflow probe. Navigator, native
  select, stable review-locator and locale-refresh fixtures were corrected without weakening
  application assertions or changing service/controller/API behavior.
- Axe and one-pixel overflow checks pass on the selected 320px flows. Screenshot review
  confirms readable Korean/German review/export/picker controls, visible focus and preserved
  raw source text, IDs, hashes and technical paths. Some full-page captures at a scrolled
  position include sticky header/skip-link overlays; clean viewer/picker captures and actual
  viewport/overflow checks distinguish those capture artifacts from content clipping. Native-
  language/customer, manual accessibility/physical-device and exact-candidate hosted
  acceptance remain pending. The release ledger remains valid at **0 complete / 15 pending**.

The linked Pack practice setup, preview, private-link receipt and attribution surfaces remain
a separate follow-up; this slice localizes their library entry points. Creation-locale
templates/default content, exact-candidate hosted qualification, native-language/customer
review, manual accessibility/physical-device checks and deferred public launch pages remain
release work. The release ledger remains unchanged.

## Round live workspace refinement — November 11, 2026

The `codex/round-live-workspace` slice responds to live Round screenshot feedback about
prototype-like hierarchy, overlapping tools, oversized standings and disconnected themes.
It builds on the merged Pack tools source without changing the remaining Option B work.

- The enhanced host summary shows code, question progress, joined and answered counts.
  Connection status stays in the header; question timing stays beside the active question.
  Primary, Audience and More controls occupy one desktop header row in both disclosure states.
  More is a localized, accessible button with a controlled, retained panel below that row;
  Enter/Space toggle it and Escape closes it with focus restoration. Confidence, teaching
  actions and End use auto-sized controls in normal flow. Expanded tools remain static at
  every width; opening from a scrolled position brings the toolbar onscreen only if needed.
  Redundant phase context is hidden on small phones while the task label and screen-reader
  phase remain. Compact icon controls preserve complete action labels
  and avoid an unnecessary extra row; longer locale groups wrap between controls.
- Host question and standings are separate aligned cards. A bounded guidance column sits
  alongside at 1024px and above, then stacks below the main column. The operational canvas
  suppresses the decorative pattern and uses restrained shadows and consistent card edges.
  The existing legacy command path and feature gates remain available.
- Participant state, task, results and optional tools occupy one continuous 840px column.
  Question/review/completion headings and padding are restrained. Compact live standings
  show personal rank/score, last released gain and the saved/correct receipt; a short table
  includes top entrants and the participant's own row, with full standings/policy disclosed.
  Single-person finals keep the useful result without a podium, race or celebration.
  Multi-person finals retain smaller celebrations and standings with effects disclosed.
- Host/participant UI shares a modern live skin: crisp sans-serif typography, slate surfaces,
  an ink header, restrained violet accents, consistent card edges and centered 44px action
  controls. Light/dark palettes cover question, results, guidance, settings and timing; both
  app and system high-contrast choices retain readable controls. The Display & sound trigger
  uses a centered icon/label and a bounded themed popover. Phone headers use accessible
  icon controls with the full localized names available to assistive technology. Nested
  Audience drawer tabs, chat/reply/reaction surfaces, Q&A questions/replies, staff/participant
  rows and Pulse cards use matching live foreground/background tokens in light, dark and
  high contrast.
- Stored experience themes, presenter appearance and standalone standings retain their
  existing roles. Authored prompts, choices, aliases, saved-answer truth, released scores,
  recheck suppression, ties, motion preferences and all request/controller/protocol identities
  retain their meanings.

Validation:

- All **392 web suites / 4,192 tests** pass. Web lint/types, scoped browser-spec types/lint,
  changed-file formatting and diff whitespace pass. Fresh normal, beta and core production
  web builds pass; final builds include the shared modern skin, centered controls and compact
  phone padding. After the last toolbar scroll refinement, 30 focused host tests also pass.
- **15 distinct selected production-browser cases pass**: six core Chromium competition
  cases, plus nine beta cases across desktop Chromium and phone Chromium/WebKit. They cover
  score privacy before reveal, private/unscored/early-end results, linked/revote recovery,
  real answer save/reload/receipt/final scoring, one-tap failure/retry, closed/open control
  geometry, actual rendered-text centering, shared action baselines, disclosure keyboard and
  focus restoration, German controls at 320px, light/dark/high-contrast palettes, open/revealed/
  final Axe checks, long question/name wrapping and the 1024px sidebar crossover.
- The initial phone layout check caught a 170px closed command bar. Removing its redundant
  narrow-screen context makes the existing 150px limit pass on both phone engines. Core
  fixtures were updated to assert actual compact standings and single-person results while
  retaining released-score, rank and recheck assertions. Corrected reruns count once.
- Follow-up alignment checks measure actual rendered text/icon centers and shared action
  baselines. They caught inherited phone padding, two legacy dark-mode text colors and the
  OS high-contrast selector priority; fixes retain all original geometry/Axe assertions.
  Five unaffected browser cases plus the selectively rerun affected desktop case count as
  six cases. The docked submit bar and Recovery Pack card also use matching modern tokens.
- Review follow-up fixes the nested-surface contrast regression in the Audience drawer,
  chat/reply/reaction cards, Q&A replies, staff and responsive participant rows, and Pulse
  controls. Three additional populated-surface production-browser cases pass on desktop
  Chromium and 320px phone Chromium/WebKit. They verify real messages, published replies,
  active/revoked staff credentials, selected tabs, reply controls, matching computed palettes,
  scoped Axe and overflow. Desktop also covers app/system high contrast; fresh normal/beta
  builds and browser-spec types/lint pass. An independent focused check passes 4.5:1 for all
  19 sampled text/surface combinations across all four appearance modes. Corrected fixture
  normalization and responsive-row reruns count once.
- Desktop/phone screenshot review confirms inline tools push content down, the primary and
  Audience actions stay distinct, and completion retains the score and own response receipt.
  On phones the guidance follows compact standings; native-language/customer observation,
  manual accessibility/physical-device checks and hosted qualification remain release work.
  The release ledger remains valid and unchanged at **0 complete / 15 pending**.

## Pack practice follow-up — November 11, 2026

The `codex/option-b-pack-practice` slice extends the ten configured UI locales to Pack
practice setup, frozen content previews, private-link receipts and Pack source attribution
in Assignments and Results. English remains the default. Its 85 display-copy entries cover
setup and its known diagnostics, mode explanations, previews, receipt guidance and actions,
and source attribution. Unknown diagnostics retain their exact English content rather than
matching a translated substring or an unrelated UI key.

- Switching language preserves entered titles, personal labels, pacing and schedule values,
  selected mode, source/version identity, pending state and exact retry bytes. The existing
  English default assignment titles remain unchanged. Dates and counters use the selected
  locale; schedule guidance identifies device time and retention limits.
- Delayed-probe and full-sequence previews preserve frozen authored text, choices, cards and
  their order. Permission, feature, plan, missing-content, conflict and loading states retain
  their existing controllers and explicit actions. Scoped spacing, wrapping and focus styles
  support long values and translated controls.
- Private-link receipts retain exact URLs, CSV bytes and filenames. Canonical copy/download
  feedback is rendered in the current locale; changing locale does not copy, download, move
  focus or record a share event. Authored labels remain separate from translated templates,
  including labels that happen to match UI keys. The receipt still focuses its heading once.
- Attribution uses the current workspace locale while preserving the frozen source title,
  published version and role in both collections. It does not fetch the live Pack, disclose
  source bodies/answers or expose private links. Existing search, layout and pagination state
  survive language changes.

Validation:

- `VITEST_MAX_WORKERS=1 pnpm check` passes **8,160 tests**, with 513 standard opt-in
  integration skips. Formatting, Docker-context checks, lint, type checks, all four production
  build tasks and compiled-server startup pass. All **394 web suites / 4,277 tests** pass,
  including setup/catalog, receipt/preview/attribution and Results integration cases. A fresh
  beta production web build also passes.
- The first repository-gate attempt exposed the pre-existing beta-sign-in fixture convention
  failure in two Round browser helpers. Naming their local page parameter `page` satisfies
  the existing contract without changing authentication, routes or storage behavior. The
  unchanged contract test and the final complete repository gate pass after this correction.
- The initial browser run caught German collection controls whose short visible labels did
  not match their accessible names. Results, Sessions, Library and the shared Round view
  switcher now display their existing full accessible labels. All ten locales retain matching
  text/names and both pressed states. The affected page/switcher tests pass **98 cases**;
  fixture selectors use the intentional full visible label. Final web types, scoped lint and
  fresh normal/beta production web builds pass after this correction. The final complete web
  suite passes **394 suites / 4,287 tests**.
- **12 distinct selected production-browser cases pass** on the final bundle: three new
  localized cases and nine unchanged Pack practice cases across desktop Chromium and 320px
  phone Chromium/WebKit. The localized phase and each legacy profile use a fresh API fixture.
  Checks retain both assignment modes, English title defaults, populated form/schedule values, exact mutation
  identity and serialized retry bytes after a lost acknowledgement, a single created
  assignment, clipboard/CSV bytes and filenames, one-time focus, canonical status feedback,
  and nine explicit share events per localized case with no language-change events. Original
  Pack deletion, collection attribution, participant privacy, card replay, accountless recovery and scoped
  Axe/overflow assertions pass. Corrected fixture reruns count once; the stale-source alert
  assertion is scoped to the actual main region rather than Next's empty route announcer.
- Desktop and 320px screenshot review covers populated Korean setup and Korean/German/English
  receipts. Controls align, long original content wraps, raw labels remain unchanged and
  translated actions remain legible. Captures reset scroll so sticky chrome does not obscure
  page content. Changed-file formatting/diff checks pass; the release ledger remains valid
  and unchanged at **0 complete / 15 pending** gates.

Shared `/practice/[id]` management and creation-locale templates/default content remain
implementation follow-ups. Native-language review, customer observation, manual
accessibility/physical-device checks, exact-candidate hosted qualification and deferred
public launch content remain release work. This slice does not complete release readiness.

## Local acceptance preparation — November 11, 2026

The `codex/option-b-acceptance` follow-up adds repeatable local qualification and
native-language review preparation after the named software follow-ups were completed.
The product owner has no staging environment selected; hosted qualification stays pending.

The shared browser-test runner now supplies invocation-owned Firefox application-data
paths on macOS while preserving existing overrides, the stock browser and its sandbox.
It forwards cancellation to its owned process group and removes temporary data after
child shutdown. Core/beta commands and the existing Presentation-scene entry point use
this helper. This resolves the local pre-page Firefox profile failure recorded in the
historical checkpoints below; selected Firefox application journeys can now run.

New production-browser coverage walks sequential keyboard order through template
selection/preview, private speaker notes, Undo/Redo, audience-preview privacy, inspector
close/return and Create menus. It checks visible focus, dialog containment/return,
reduced-motion preference, light/dark/forced-colors modes, Axe and narrow-screen reflow.
The 640px/320px viewports model space available at 200%/400% zoom; these are not manual
browser-zoom, screen-reader or physical-device results. Mobile WebKit uses its native
macOS Option-Tab convention for all-controls keyboard navigation.

That work corrects two existing UI defects: Create-menu entries could be clipped at
640px, and Escape did not close the menu and return focus to its summary. Template
preview now shares the existing modal keyboard handler for contained Tab traversal.
Results card headers now wrap at every viewport: German status badges previously escaped
narrow three-column cards in Firefox even when the full viewport was desktop-sized.

`pnpm localization:review` exports source-bound bilingual review packets and checks
separately recorded decisions. Each of the ten locales has 374 entries covering the
21 Presentation templates and generated drafts, 36 Round starters, 17 Survey projections,
creation/practice copy and action-created examples. The inert HTML is searchable,
escaped and readable at desktop/320px widths; an actual hash/grid overflow discovered
in Firefox and Chromium was corrected. Source and content hashes reject stale records,
and exports preserve existing decisions. Every generated decision starts pending.
See the [human review workflow](evidence/native-language-review.md).

Validation on the final software source: `VITEST_MAX_WORKERS=1 pnpm check` passes
**8,377 tests** with 513 standard opt-in skips, formatting, workspace/build lint, types,
all four production builds and compiled-server startup. This includes 401 web suites /
4,440 tests, 149 server suites / 1,488 tests and 45 support suites / 461 passing tests.
Separate strict TypeScript checks cover the review CLI and new browser fixtures.
The fresh beta production artifact passes all **28 distinct selected application-browser
cases**: eight each on desktop Chromium/Firefox and six each on phone Chromium/WebKit.
All eight standalone review-HTML cases pass separately. Final artifact/source/environment
provenance validates. The [local qualification record](evidence/option-b-local-qualification.md)
records commands, corrected reruns and limits; this is not the entire hosted matrix.

These are supporting engineering checks. The 15 release gates remain pending, including
native-language review, observed customer tasks, manual accessibility/assistive technology,
physical devices, hosted performance and the deferred public launch content. Existing
human evidence forms remain unfilled. Automated record validation cannot establish
native quality or reviewer identity and does not remove language Preview labels.

## Remaining software follow-ups — November 11, 2026

The `codex/option-b-remaining` source preserves the Pack practice work above and closes
its two named implementation follow-ups: shared `/practice/[id]` management and
creation-locale templates/default content. English remains the default and all ten
configured locale choices are retained.

- **Shared practice management:** grouped source/schedule, progress, private-access,
  timing-accommodation and close sections use scoped responsive theme styles. Known
  diagnostics, confirmations, counts and dates follow the UI locale; unknown diagnostics
  remain verbatim English. Actor/route changes isolate private receipts and pending work;
  role/feature/entitlement changes invalidate stale mutation, clipboard and focus callbacks.
  Existing access remains manageable under the existing server-authoritative permissions.
- **Presentation creation:** all 21 templates (12 native scenarios and nine facilitated
  sequences) have localized titles, descriptions, slide copy, speaker notes, columns,
  tables/charts and audience-question content. The nine translated catalogs contain 864
  native slides and 3,114 data/column strings. Only the requested creation-language catalog
  loads; English does not download translated catalogs. Explicit load failure/retry never
  advertises English fallback as localized content. Gallery metadata, thumbnails and new
  drafts agree; an open preview retains its reviewed content and language.
- **Round and Survey creation:** all 36 Round starters, including 17 Survey-compatible
  starters, have localized metadata, prompts, choices, explanations and scale labels.
  Optional validated locale inputs default to English. Localized catalog provenance is
  additive; existing artifact/schema versions, correct answers and recheck relationships
  remain intact. Explicit Survey retries retain the original request language and bytes.
- **Small authored defaults:** newly inserted true/false and rating questions, Survey
  options, native tables/charts and added data rows/columns use their action language.
  Blank Round titles, generated Pack-card headings and Pack practice title prefixes follow
  creation language. Existing titles and edited defaults are preserved when UI language
  changes. Local discussion/clarity/priority starters capture the review-opening language,
  quote exact original source text, and retain reviewed wording until insertion or dismissal.
- **Content boundaries:** no locale change rewrites a saved draft, published snapshot,
  source excerpt, numeric answer, scoring rule, citation, private URL or existing retry
  envelope. Imported/source-authored content retains its original language and provenance.
  These deterministic catalogs make no model requests and consume no AI allowance.

Validation:

- `VITEST_MAX_WORKERS=1 pnpm check` passes **8,339 tests**, with 513 standard opt-in
  skips, all four production build tasks and compiled-server startup/configuration smoke.
  The final web suite contains **401 suites / 4,440 tests**; the server suite contains
  **149 passing suites / 1,488 passing tests**, plus its standard opt-in skips.
- Pure content checks validate all **210 Presentation / locale combinations**, **360 Round
  combinations** and **170 Survey combinations**. Numbers, answer keys, recheck identities,
  schema versions, clone independence, English compatibility and immutable source records
  are checked. Selected-template derivation avoids rebuilding unrelated decks for thumbnails.
- A fresh beta production artifact on loopback ports 3294/4294 passes **12 distinct selected
  browser cases**: Pack practice setup/receipt recovery, shared practice private-access
  management, Presentation creation/recovery, and Round/Survey creation/recovery, each on
  desktop Chromium and 320px Chromium/WebKit phone viewports. Corrected fixture path/selector
  reruns count once. Axe and document-overflow assertions pass for these cases.
- Browser checks exercise a deliberately unavailable template catalog followed by explicit
  retry, accepted writes with lost responses, byte-identical creation retries after a UI
  language change, private link copy/revoke/close, unchanged saved content/revisions, and
  retained labels/accommodation settings. Mobile access cells use a bounded scroll region
  instead of squeezing translated actions into individual characters.
- Desktop/phone captures were reviewed with private URLs masked and scroll reset so sticky
  chrome does not obscure the content. The two selected browser specs pass a separate strict
  TypeScript check. See local captures under `artifacts/option-b-remaining/`.

Native-language editorial review, customer observation, manual assistive-technology and
physical-device checks, exact-candidate hosted qualification and the user-deferred public
launch content remain release work. The release ledger stays at **0 complete / 15 pending**;
software completion does not satisfy release acceptance.

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

These counts describe the original Option B completion gate. Later follow-up validation
is recorded in the dated sections above.

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
- At this historical checkpoint, Firefox was unqualified locally because its runtime exited before opening a page
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
- At this historical checkpoint, Firefox qualification remained open: the installed and a fresh official Playwright
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
