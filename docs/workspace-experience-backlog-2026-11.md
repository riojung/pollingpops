# Polling Pops workspace experience delivery backlog

Requested: **2026-11-17**. Baseline: `origin/main` at `6fd5441`.
Research: [Wayground and Mentimeter benchmark](workspace-experience-benchmark-2026-11.md).

The product owner selected a simpler, more polished workspace and compatible feature expansion.
This plan breaks that request into reviewable increments. **WX-01 and WX-02 are the selected first
delivery**, implemented on `codex/workspace-experience-foundation`. Later items are scoped backlog,
not shipped features or a commitment to reproduce either competitor's product.

The first delivery changes discovery and reuse, using existing APIs and original Polling Pops
components. It does not introduce a second authoring engine, a pretend AI composer, competitor
assets, a new pricing model or new participant identity tracking. Existing roadmap/release evidence
remains separate from code completion. The benchmark records market capability, not new customer
interviews, willingness to pay or observed usability improvement.

## Delivery order

S/M/L describe relative implementation breadth, not dates or staffing estimates. A large item must
follow its smaller checkpoints below; do not combine every checkpoint into one pull request.
Each delivery needs an assigned owner, tests, documentation and an explicit disposition of its
remaining work. Candidate priorities indicate evaluation order, not a release promise.

| ID    | Priority | Size                               | Outcome                                                             | State / dependency                             | Responsible role                |
| ----- | -------- | ---------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------- |
| WX-01 | P1       | S                                  | Home foregrounds starting and continuing work                       | Implemented; local acceptance below            | Frontend + product design       |
| WX-02 | P1       | M                                  | Templates are directly reachable, previewable and usable in context | Implemented; local acceptance below            | Frontend + accessibility        |
| WX-03 | P1       | M                                  | One honest, searchable Library across content kinds                 | Ready for selection after WX-01/02             | Library API + frontend          |
| WX-04 | P1       | S per collection                   | Job-based, editorially reviewed starter collections                 | Ready; reuse existing catalog                  | Content design + localization   |
| WX-05 | P1       | S/M per method                     | One clear creation and source-intake journey                        | Ready; retain existing factories               | Authoring + frontend            |
| WX-06 | P2       | L, three checkpoints               | Survey pages and answer-based branching                             | Contract/design discovery first                | Surveys + contracts + reporting |
| WX-07 | P2       | L, three checkpoints               | Recurring, privacy-preserving team check-ins                        | Discovery; live Pulse is not recurrence        | Async delivery + privacy        |
| WX-08 | P2       | L, two checkpoints                 | A complete 100-point allocation interaction                         | Candidate under IDEA-004 / R2-03               | Contracts + live experience     |
| WX-09 | P2       | M                                  | A narrowly scoped moderator invitation                              | Permission design first                        | Realtime + security + frontend  |
| WX-10 | P2       | M                                  | Comparable session evidence without spreadsheets                    | Extend IDEA-015 / R2-10                        | Reporting + learning evidence   |
| WX-11 | P2       | S/M per surface                    | Consistent density, states and capability explanations              | Ready one surface at a time                    | Design system + frontend        |
| WX-12 | P3       | S discovery, then M/L per provider | Native slide/meeting and result-delivery integrations               | Reuse IDEA-002/005/007 and R2-11               | Integrations + security         |
| WX-13 | P3       | L                                  | Ordered follow-up learning sequences                                | Reuse IDEA-008 / R2-04; discovery              | Learning delivery + privacy     |
| WX-14 | P2       | M                                  | Organization-curated reusable template collections                  | Extend existing org sharing, not a marketplace | Library + organization access   |

## Selected first delivery

### WX-01 Home: start and resume work

**Problem:** overview metrics and secondary activity compete with the next useful action. Empty
workspaces show dashboard structure before a customer has anything to resume.

**Scope:** keep live sessions urgent, offer concise capability-aware creation and format-specific
template destinations, foreground existing work, and reduce the visual weight of overview widgets
and the first-session checklist. Preserve recent results and operational follow-up.

**Acceptance:**

- An active room remains above ordinary creation and recent work. Its existing canonical resume
  destination and confirmation behavior remain intact.
- Editors can reach enabled creation goals and Round, Presentation, Survey and Design templates.
  Viewers receive browse/library guidance rather than draft-creation controls. Disabled capabilities
  do not produce attractive links that fail only after clicking.
- Existing work is visibly labelled **Continue working**. Empty/viewer states remain truthful.
  The Home summary stays one bounded authorized projection; no per-card draft fetching is added.
- Missing evidence remains distinct from zero; counts, sample limitations and lower-bound labels
  survive the compact layout. Onboarding still uses positive evidence and its existing scoped
  dismissal, with checklist detail disclosed progressively.
- Actor/workspace/organization/role/feature changes fence stale results. Loading/error states do
  not expose the previous workspace. Ten locales and 320px layouts remain usable.

**Verification:** Home behavior and copy tests; desktop/mobile browser hierarchy, role/feature
states, light/dark/high-contrast checks and scoped accessibility checks. Observe first-use task
completion later; do not invent a conversion improvement from automated tests.

### WX-02 Templates: browse, preview and use

**Problem:** Templates is hidden behind Discover's separate feature grant; linked formats cannot
be opened reliably; a detailed preview can require returning to a card to create a copy.

**Scope:** a direct core Templates destination; URL-backed format tabs; contextual Library empty
state links; a summaries-and-preview Round/Survey browser; an in-preview independent-copy action.
Presentation templates and designs retain their existing specialized previews.

**Acceptance:**

- `/templates?type=rounds|presentations|surveys|designs` selects the requested section. Unknown
  values fall back to Rounds. Back/forward navigation and keyboard tabs follow the URL; the
  existing `#designs` link remains compatible. Unrelated query parameters survive tab changes.
- Templates remains reachable when Discover is disabled. The old Discover route keeps its
  existing policy; this change does not turn paused creation capabilities back on.
- Full Round/Survey browsing shows matching summaries and substantial selected content together.
  Mobile uses an appropriate single-column selection/preview flow. Search/filter, metadata,
  loading, errors and retry remain understandable. Compact callers keep their card/dialog workflow.
- Preview performs no write. **Use template** creates one independent editable draft only after
  an explicit eligible action. Source content and immutable publications are unchanged.
- Copying is guarded against duplicate submissions, stale role/feature/actor/workspace/locale
  contexts and late navigation. Retried idempotent operations preserve their original intent.
- Modal compatibility retains Escape, bounded focus and return to the invoking control. Read-only
  users can inspect eligible content but cannot copy. Ten locales, reduced motion and the mobile
  WebKit card-memory regression remain covered.

**Verification:** route/shell/empty-state tests, chooser scope/race tests, copy/source-immutability
browser checks and responsive screenshots. No new contracts, migrations, dependencies or vendor
accounts are required for the selected slice.

## Subsequent reviewable increments

### WX-03 Library: all content, useful sorting and complete search

**Existing:** type tabs, folders, filters, favorites, grid/list, archive/delete and organization/
recipient scopes already exist. Do not rebuild them as missing parity.

**First checkpoint:** add an **All content** list projection for authorized Rounds, Presentations
and Surveys, with stable recency/title sorting and content-kind/status facets. Keep boards separate
until their different action/retention model has an explicit decision.

**Acceptance:** server-side search and deterministic cursor ordering describe the full eligible
collection rather than only loaded pages; equal sort keys have a stable tie-breaker; query state
survives reload/back; unauthorized objects do not influence counts or facets. My workspace,
Organization library and Shared with me retain resource-specific actions and independent-copy
semantics. Empty/no-results/error/loading cases remain distinct. List rows use authorized metadata
and lazy artwork, not eager private drafts. Validate pagination, concurrent changes, revocation,
cross-tenant access and 320px keyboard use.

**Dependencies:** bounded indexed queries and an agreed cross-kind cursor contract. Keep schema
or index changes separate from the UI when needed. Owner: Library API + frontend.

### WX-04 Templates: curate by customer job

**Existing:** 36 Round starters, 21 Presentation templates and 17 Survey-compatible scenarios, with
ten creation languages. Editorial depth and native-language acceptance vary; this is not an empty
catalog or a public marketplace.

**Smallest delivery:** improve one original collection for team meetings, training, workshops or
event feedback. Start with four to six relevant existing starters rather than adding dozens of
thin examples. Add job metadata/shortcuts only where the existing catalog cannot express the job.

**Acceptance:** original prompts, realistic durations, audience guidance and actionable follow-up;
answer keys/explanations checked for scored work; no misleading correctness for opinions;
readable previews; exact counts; usable independent copies; source and license records for any new
assets. A named editorial/native-language review record distinguishes reviewed content from
available translations. No copied vendor templates, artificial popularity counts or outcome claims.

**Dependencies:** WX-02; use the existing content/localization review workflow. Public creator
publishing remains IDEA-003. Owner: content design + localization.

### WX-05 Creation: consolidate methods and source intake

**Existing:** goal-based creation, blank/template/source/import methods, reviewed source assistance
and Presentation visual imports. Discover, Create and catalog entry still overlap.

**Checkpoints:** first unify destinations and explain compatible existing methods; then polish one
import method's validation/preview. Do not combine a new document parser, AI provider and slide
add-in in one delivery.

**Acceptance:** choose a job/format once; preserve supported deep links and legacy fallback; identify
file types, limits and conversion losses before upload; preview parsed content before creating;
show row/page errors and retry without duplicate drafts. Provider-disabled AI is clearly unavailable
while ordinary creation remains usable. Consent, source provenance, scanned media, cost limits and
review-before-publication remain intact. No silent rewrite of existing drafts or published rooms.

**Dependencies:** current factories/import APIs; retire or redirect duplicate discovery routes only
after link/feature-policy migration is tested. Owner: authoring + frontend.

**Bounded reliability follow-up:** the existing Round starter-copy endpoint has no durable
idempotency intent. The new client blocks simultaneous submissions, but a lost successful response
can leave an already-created draft. Current error copy therefore asks users to check their Library
before retrying. Add a server-bound actor/workspace/source/language intent in a separate API/storage
increment; lost acknowledgements must return the original copy, and conflicting bodies, expiry,
deletion and cross-tenant reuse must be tested. Survey retry intents already retain their exact body.

### WX-06 Surveys: pages and conditional paths

**Gap:** a self-paced Survey is present; authored page groups and answer-based paths need their own
versioned behavior. This is not a reason to expose every Round response union in Surveys.

**Checkpoints:** (a) ordered pages with accessible back/next and required-field validation;
(b) bounded single-choice conditions that reveal questions/pages; (c) compatible result/export
projections and historical readers. Each checkpoint stays behind its own effective writer grant
until all affected readers work. Relates to the selected-surface discipline in IDEA-004 / R2-03.

**Acceptance:** cycles/invalid targets are rejected; changing a branch clears now-ineligible input;
hidden answers are neither submitted nor exposed in results; skipped-by-logic differs from
unanswered. Reconnect restores only authoritative eligible progress, with no duplicate completion.
Anonymous/account-free identity and aggregate thresholds remain explicit. Existing immutable
versions keep their historical route; authoring, participant delivery, reports, exports and deletion
receive upgrade/compatibility tests before enabling new writers.

**Dependencies:** product decision on allowed conditions plus contract/privacy design. Owner:
Surveys + contracts + reporting.

### WX-07 Recurring check-ins

**Gap:** current in-session Pulse is an ephemeral live signal. A recurring check-in series is a
different asynchronous workflow; do not label link-sharing instructions as a native integration.

**Checkpoints:** (a) manually opened series rounds with a frozen rating prompt, optional moderated
comment, deadline and aggregate history; (b) timezone-aware scheduled rounds and pause/resume;
(c) explicit opt-in distribution, duplicate prevention and unsubscribe. Start with link sharing;
no email or workspace-channel delivery is authorized by this backlog alone.

**Acceptance:** preview never saves responses; opening collection differs from sending invitations;
one authorized response per eligible round under the chosen identity policy; low samples suppress
unsafe trends/comments; average/count/change use disclosed denominators. DST, retries, overlapping
deadlines, retention, deletion and cancellation are deterministic. A guest series must not quietly
become longitudinal employee tracking. Correlation with learning recovery is not claimed.

**Dependencies:** privacy/identity decision, existing Survey/job/history infrastructure. Distinct
from the learning follow-up in IDEA-008 / R2-04. Owner: async delivery + privacy.

### WX-08 One new interaction: 100-point allocation

**Job:** distribute a fixed budget among workshop priorities, beyond an ordinal ranking. Existing
scales, ratings, ranking, free text and live clouds should not be added again as new features.

**Checkpoints:** first additive contracts, stored readers and a disabled rendering path; then a
complete Round writer/host/participant/report/export slice behind a negotiated capability. Extend
IDEA-004 / R2-03 rather than opening another response-format epic.

**Acceptance:** explicit integer budget, zero/negative/overflow rules and accessible keyboard inputs;
the author chooses/discloses whether the full budget must be allocated. Server validation is
authoritative; refresh/retry does not double-count. Aggregates disclose allocation totals and
respondent counts, remain unscored and stay outside accuracy/recovery denominators. Old clients
receive a clear update boundary; old reports retain deterministic rendering.

2×2 grids, image choices and image pinning stay unselected alternatives until an observed job
justifies one. Spatial/image interactions require a meaningful non-pointer/text equivalent before
selection. Owner: contracts + live experience + accessibility.

### WX-09 Moderator-only invitation

**Existing:** cohosting, Companion credentials, Q&A and moderation. The increment is narrower
delegation, not another general-purpose host token.

**Smallest delivery:** host issues a short-lived room-bound pass for Q&A approval/highlight/answered
actions. Show expiry, revocation and the exact permission summary before creating the pass.

**Acceptance:** server-side action allowlist rejects advancing/ending the room, participant export,
billing and unrelated content reads; credentials are hashed, revocable and not placed in analytics
or logs. Reconnect and takeover revalidate authority. Moderator screens show only data needed for
their permitted task. Keyboard/mobile moderation, auditing, expiry and cross-room denial are tested.
Approval behavior does not imply organizer-blind anonymity.

**Dependencies:** explicit credential and audit design. Persistent pre/post-meeting Q&A remains the
separate IDEA-014 / R2-09. Owner: realtime + security + frontend.

### WX-10 Report comparison

**Smallest delivery:** compare two retained, finished sessions of the same immutable published
source, starting with selected question-level aggregates. Reuse IDEA-015 / R2-10 and current
Question Health/version bindings.

**Acceptance:** show publication/question identity, collection windows, eligible counts and sample
limitations; absent data is not zero. Unpaired cohorts are labelled unpaired; no individual learning
gain or causal improvement is inferred. Changed/non-equivalent questions cannot silently produce a
recovery delta. Private/low-sample results remain protected across the UI, summaries and exports;
revoked/deleted sessions disappear from saved comparisons. Test mismatched versions and scopes.

**Dependencies:** comparison disclosure design and current report privacy projections. Owner:
reporting + learning evidence. Broader Recovery Trail/Concept Health remains R2-04.

### WX-11 Consistent surfaces and commercial explanations

**Checkpoints:** select one remaining surface per delivery—Library, Sessions, Results or Workspace.
Apply shared spacing/type/action/status patterns, then its empty/loading/error/retry/access states.
A separate small increment audits capability/plan explanations and upgrade destinations.

**Acceptance:** one primary task at each decision point; intentional density with wrapping titles;
consistent component states; focus/keyboard/320px behavior; dark and high-contrast token use;
no repeated card blur that reintroduces the WebKit memory failure. Distinguish plan limits,
administrator policy, paused rollout and missing provider setup using authoritative grants.
Templates/core navigation must not acquire an invented paid gate. No fabricated discounts, trials,
adoption numbers or changed billing prices.

**Dependencies:** existing design/brand tokens and entitlement projection. Verify unchanged
publication, permission and payment behavior. Owner: design system + frontend.

### WX-12 Integrations: one provider at a time

Reuse IDEA-002, IDEA-007 and IDEA-005 / R2-11; do not duplicate their backlogs. Begin with a bounded
provider/permission/managed-device spike, then select one native slide or meeting workflow.
Google Sheets summary delivery is a separate connector increment.

**Acceptance:** document what is actually native versus a web link or static image conversion;
explicit OAuth scopes/consent; least-privilege access; tenant binding; revocation and retention;
retry/idempotency; join-link/QR fallback; no presenter notes in shared displays. Vendor review,
deployment and product observation remain dependencies. No account signup, provider provisioning
or outbound notification is performed by this first UI delivery. Owner: integrations + security.

### WX-13 Ordered learning sequences

Treat Wayground-style courses as evidence for a broader job, not authorization to build an LMS.
Reuse IDEA-008 / R2-04 and existing published sources, reading/practice assignments and recovery
evidence. First discover whether an ordered set of independent activities solves a concrete job.

**Smallest selected prototype:** explicit sequence, immutable source/version links, availability
and progress meaning. No automatic enrollment, certificates, verified employee completion,
gradebook synchronization or persistent learner profiles are implied by account-free links.

**Acceptance before implementation selection:** an agreed identity/privacy policy; a distinction
between link attempts and unique learners; clear behavior when sources expire or permissions are
revoked; accessible resume/skip/retry; no claim of long-term retention from one completed sequence.
Owner: learning delivery + privacy + product research.

### WX-14 Organization-curated template collections

**Existing:** organization Library, Groups, published sharing, can-view/can-use actions and independent
copies. The remaining job is finding sanctioned reusable starters from the same organization.

**Smallest delivery:** curator-labelled collections over eligible existing published shares, exposed
in the template discovery flow. Reuse the current organization/group access model; do not grant
source editing merely because an artifact is in a collection.

**Acceptance:** explicit curator role; version/owner/source attribution; exact can-use/can-view state;
independent copies with fresh IDs; no private drafts/notes/responses in previews; immediate removal
after revocation/deletion or organization change. Scope-aware search/facets and audit tests cover
cross-tenant denial. Public creator submissions, payments and marketplace licensing remain IDEA-003.
Dependencies: WX-03, existing organization sharing projections and a curation policy. Owner:
Library + organization access.

## Local acceptance and next working session

### WX-01/02 local verification, 2026-11-17

- `VITEST_MAX_WORKERS=1 pnpm check` passed: formatting, Docker-context checks, repository lint and
  typechecks, all test tasks, production builds and server startup smoke. This includes **484 web
  files / 5,812 tests**, **1,596 server tests** and **522 smoke-support tests**. Environment-dependent
  tests retained their configured skips.
- Web typecheck, final web lint, scoped browser-test lint, changed-file formatting and
  `git diff --check` passed. `pnpm --filter @openround/web build` passed with production TypeScript
  and route generation. Test-server-generated `next-env.d.ts` changes were removed.
- `pnpm exec playwright test --config=playwright.canvas.config.ts tests/canvas-e2e/workspace-start-experience.spec.ts
--max-failures=1`: **all six cases passed**, covering desktop Chromium, mobile Chromium and mobile
  WebKit. Synthetic fixtures verify Home hierarchy, viewer/paused-feature behavior, URL/history,
  preview-only reads, independent editable Round/Survey copies, unchanged authored source content,
  and compact-dialog keyboard/focus behavior.
- Scoped Axe audits and responsive screenshots passed in light/dark/high contrast at desktop,
  390px and 320px. Manual screenshot inspection confirmed the desktop summary/preview arrangement
  and mobile single-column flow. An explicit template-selector label color and palette-settlement
  assertion corrected a mobile WebKit theme-switch contrast finding; contrast checks remain enabled.
- An independent read-only implementation review found no actionable issues. No server contracts,
  migrations, dependencies or copied assets were introduced. Existing Presentation previews and
  compact template callers retain their workflows; the existing 23-card mobile WebKit regression
  remains in the browser suite.
- The follow-up copy-confirmation finding is fixed: filtering, selecting or closing a preview no
  longer discards a submitted copy's result. Creation warnings survive preview-only changes until
  a new copy attempt or context change. Eight new Round/Survey compact/full regressions failed
  before the fix and passed afterward; all 44 focused chooser/preview/copy tests passed, including
  duplicate-submit, stale-authority and exact Survey retry-body checks. The reviewer verified the
  fix read-only with no further issues. The three template-copy browser cases passed again across
  desktop Chromium, mobile Chromium and mobile WebKit, now withholding the Round copy response
  while filtering away its preview and verifying the original draft still opens exactly once.
- Rebuilt the local development core profile. The app at `http://localhost:8080/home` returns 200;
  API and control readiness endpoints both report ready. No migration was needed.

These checks cover the selected slice. Automated accessibility checks do not replace
assistive-technology, native-language or physical-device review. Run the repository's full
`pnpm check` before opening a pull request, as required by the contribution guide.

The next work session should select **one ID/checkpoint**, confirm its current baseline and scope,
assign an owner and define a testable completion target. Recommended next choices are WX-03
(mixed Library discovery) or one WX-04 collection, depending on observed customer friction.
Do not mark all later items implemented because the first UI slice is complete.

Local product polish does not close the [release-readiness ledger](release-readiness.json),
hosted capacity/security/legal/backup evidence, customer research, or public launch gates.
