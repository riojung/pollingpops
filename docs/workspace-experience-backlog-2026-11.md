# Polling Pops workspace experience delivery backlog

Requested: **2026-11-17**. Baseline: `origin/main` at `6fd5441`.
Research: [Wayground and Mentimeter benchmark](workspace-experience-benchmark-2026-11.md).

The product owner selected a simpler, more polished workspace and compatible feature expansion.
This plan breaks that request into reviewable increments. **WX-01 and WX-02 are the selected first
delivery**, merged through [PR #271](https://github.com/riojung/pollingpops/pull/271) at `7c537d5`.
**WX-03** merged through [PR #272](https://github.com/riojung/pollingpops/pull/272) at `edac7b6`,
with qualification in [Library discovery](library-discovery.md). **WX-04** merged through
[PR #273](https://github.com/riojung/pollingpops/pull/273) at `efc0254`.
**WX-05A** merged through [PR #281](https://github.com/riojung/pollingpops/pull/281) at `a68df09`.
**WX-05B** merged through [PR #282](https://github.com/riojung/pollingpops/pull/282) at `bcac69e`.
**WX-05C** merged through [PR #283](https://github.com/riojung/pollingpops/pull/283) at `e8cc4ce`.
**WX-06A1** merged through [PR #284](https://github.com/riojung/pollingpops/pull/284) at `5782220`.
**WX-06A2** merged through [PR #285](https://github.com/riojung/pollingpops/pull/285) at `4dcefcc`.
**WX-06B1** merged through [PR #286](https://github.com/riojung/pollingpops/pull/286) at `f08ccbd`.
**WX-06B2** merged through [PR #287](https://github.com/riojung/pollingpops/pull/287) at `ed011d0`.
The [public product website increment](public-product-experience-2026-11.md) merged through
[PR #288](https://github.com/riojung/pollingpops/pull/288) at `ce79b19`.
**WX-06C1** merged through [PR #289](https://github.com/riojung/pollingpops/pull/289) at `01df23d`.
**WX-06C2** merged through [PR #290](https://github.com/riojung/pollingpops/pull/290) at `d6f3fd3`,
adding an isolated whole-report disclosure-control candidate and qualification fixtures. Its human
privacy acceptance remains open. **WX-11A** Sessions recovery and action hierarchy merged through
[PR #291](https://github.com/riojung/pollingpops/pull/291) at `26f7a8c`.
**WX-11B** Results recovery and keyboard continuity merged through
[PR #292](https://github.com/riojung/pollingpops/pull/292) at `6e85bcf`.
The current **WX-11C** slice on `codex/workspace-settings-recovery` adds trustworthy Workspace
settings initialization and GET recovery independently of that gate. Later items are scoped backlog,
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

| ID    | Priority | Size                               | Outcome                                                             | State / dependency                                      | Responsible role                |
| ----- | -------- | ---------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------- |
| WX-01 | P1       | S                                  | Home foregrounds starting and continuing work                       | Merged in PR #271; local acceptance below               | Frontend + product design       |
| WX-02 | P1       | M                                  | Templates are directly reachable, previewable and usable in context | Merged in PR #271; local acceptance below               | Frontend + accessibility        |
| WX-03 | P1       | M                                  | One honest, searchable Library across content kinds                 | Merged in PR #272; All content discovery                | Library API + frontend          |
| WX-04 | P1       | S per collection                   | Job-based, editorially reviewed starter collections                 | Merged in PR #273; Team meetings                        | Content design + localization   |
| WX-05 | P1       | S/M per method                     | One clear creation and source-intake journey                        | Merged through PR #283                                  | Authoring + frontend            |
| WX-06 | P2       | L, staged checkpoints              | Survey pages and answer-based branching                             | A1/A2/B1/B2/C1/C2 merged; privacy acceptance open       | Surveys + contracts + reporting |
| WX-07 | P2       | L, three checkpoints               | Recurring, privacy-preserving team check-ins                        | Discovery; live Pulse is not recurrence                 | Async delivery + privacy        |
| WX-08 | P2       | L, two checkpoints                 | A complete 100-point allocation interaction                         | Candidate under IDEA-004 / R2-03                        | Contracts + live experience     |
| WX-09 | P2       | M                                  | A narrowly scoped moderator invitation                              | Permission design first                                 | Realtime + security + frontend  |
| WX-10 | P2       | M                                  | Comparable session evidence without spreadsheets                    | Extend IDEA-015 / R2-10                                 | Reporting + learning evidence   |
| WX-11 | P2       | S/M per surface                    | Consistent density, states and capability explanations              | Sessions/Results merged; Workspace initialization local | Design system + frontend        |
| WX-12 | P3       | S discovery, then M/L per provider | Native slide/meeting and result-delivery integrations               | Reuse IDEA-002/005/007 and R2-11                        | Integrations + security         |
| WX-13 | P3       | L                                  | Ordered follow-up learning sequences                                | Reuse IDEA-008 / R2-04; discovery                       | Learning delivery + privacy     |
| WX-14 | P2       | M                                  | Organization-curated reusable template collections                  | Extend existing org sharing, not a marketplace          | Library + organization access   |

## Selected first delivery

As of 2026-11-20, the selected deliveries in all five P1 areas (WX-01–05) are merged. WX-06 is
in progress: ordered-page readers and authoring are merged, while conditional pages have not
been enabled in the product. C1's internal counting and withheld-only contract are merged.
C2's candidate whole-report policy is merged; human privacy acceptance, C3/C4 runtime
reporting/exports and B3 writers remain pending.
The public product website is merged in PR #288. WX-11A's Sessions recovery/action hierarchy is
merged in PR #291 and WX-11B Results recovery is merged in PR #292. WX-11C Workspace initialization
and recovery is implemented locally. The rest of WX-11 and WX-07–10/WX-12–14 remain scoped/candidate
work. These are delivery
positions, not a percentage of product completeness or release acceptance. Additional customer-job
collections and human/native-language acceptance remain open even though the selected WX-04
collection is merged.

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

**Delivered:** All content is the default across workspace, organization and direct-sharing scopes.
Search, facets, recency/title sort and deterministic cursors operate on complete authorized server
metadata; explicit typed management views remain available. Retained readable content stays visible
when new creation pauses. Shared facets require opt-in to preserve strict older clients. Migration113
adds indexes; forward migration114 corrects their Unicode title keys. See the
[implementation and verification record](library-discovery.md), including
restricted PostgreSQL conformance, six browser cases and the full repository check.

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

**Selected collection:** Team meetings, using two existing Rounds, two Presentations and one
Survey. The two Rounds now have four purposeful questions each; the Survey keeps four items with
one optional context item. Neutral choices, realistic time estimates, audience/preparation guides,
interpretation limits and concrete follow-up help facilitators choose and adapt the material.
The URL-backed collection shortcut filters existing catalogs and independent-copy routes.
No new catalog persistence, publication format, dependency or asset is introduced.
See the [named editorial and verification record](evidence/team-meetings-editorial-review-2026-11.md).
Automated content/code review is distinct from pending human editorial and native-language
acceptance; existing Preview labels remain. Other customer-job collections remain later increments.

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

**WX-05A: consistent goal and method navigation.** Extend the existing
`workspace-creation-model.ts` rather than adding another launcher or factory. Use the same pure
destination/compatibility resolver and method descriptions in Home, the global Create menu,
Round/Presentation/Survey launchers, Discover links and catalog blank links.

- Selecting a goal or method navigates without writing. Keep writes on explicit create/use/import
  actions; align the current quick-poll action with Home's poll setup destination.
- Preserve Round `product=round`, `type=quiz|poll|custom`, `start=blank|starters|source|import`
  and legacy method hashes; Presentation `start=source|template|outline|design`; Survey and
  Templates format/collection links; and `/dashboard` fallback when the builder is unavailable.
  Explain incompatible methods instead of silently substituting a blank poll.
- Describe input, limits, AI involvement and the next action using the existing implementations
  as authority. Keep source review, outline generation and saved-editor visual conversion distinct.
  Source-assistant availability must not stand in for the separate Presentation outline service.
- Apply current edit/feature authority consistently. A paused provider must not disable ordinary
  blank creation, eligible templates, editing or structured import. Use customer explanations,
  retaining source disclosure, scan/allowance checks and review controls.
- Test the resolver's legacy/unknown/duplicate queries and hashes, feature/role fallbacks,
  navigation without POST, reload/history and all entry surfaces. Browser coverage should include
  provider-disabled ordinary creation, keyboard/mobile behavior and a CJK locale.

**Local implementation:** Home, the global Create menu, Discover and Library use shared format
destinations; catalog blank actions use the same grants and retain the classic Round fallback.
Round, Presentation and Survey launchers resolve methods in the existing pure model. Goal/method
selection performs navigation; only explicit Create/Use/import actions write. Presentation and
Survey overview pages link to one selected workflow rather than repeating full galleries.
Invalid/ambiguous selections require a new choice, and incompatible poll source/import links offer
an explicit Round alternative. Legacy Round hashes follow history/hash navigation. Shared method
explanations cover input, AI, limits and draft boundaries in all ten interface locales; Survey
creation now uses those locale messages and customer-facing unavailable guidance. All translations
remain subject to the existing Preview/native-review gate.

See [creation navigation guidance](user-guide.md#choose-a-creation-method). This increment retains
the existing factories, provider checks, scanning, quotas, review and immutable-publication rules.
It introduces no new parser, provider, storage schema or durable Round-copy intent.

**Local verification — 2026-11-18:** `VITEST_MAX_WORKERS=1 pnpm check` passes formatting, lint,
strict types, package/support tests, production builds and compiled-server startup. This includes
6,018 web tests, 1,636 server tests and 524 support tests; the default optional integration skips
remain. Nine browser scenarios pass using the isolated fixture API: seven new creation checks
across desktop Chromium and mobile Chromium/WebKit, plus the existing owner/viewer workspace
discovery journeys. They cover navigation without content writes, explicit blank creation with
source AI disabled, legacy hashes/history, invalid selections, 320px English/Korean layouts,
light-mode accessibility and dark-mode method-details contrast. This run also verifies the
file-picker/grid sizing repair and valid Home list-row semantics. Independent read-only code
review found no remaining actionable issue after the method-description corrections.
All ten source-bound editorial packets contain 679 pending entries each, including 54 new method
and Survey strings; automated checks do not supply human/native-language acceptance.

**WX-05B: parsed structured-import preview.** Existing JSON, CSV, bulk-text and QTI parsers now
support a read-only preview of the destination title, questions and validation diagnostics.
Only a separate explicit confirmation creates a draft; source/title/format changes invalidate
uncommitted previews. The confirmation endpoint reparses the original source and enforces current
authority and media rules. Migration115 stores compact actor/workspace-bound import receipts so
same-intent retries recover the current original draft, including after a lost response. Input and
answers remain in memory; per-tab browser recovery retains only the request identity, fingerprint
and actor/workspace context. Accepted receipts survive target deletion, preventing recreation with
the same key. The legacy validate-and-create API remains compatible.

**WX-05B local verification — 2026-11-18:** `VITEST_MAX_WORKERS=1 pnpm check` passes formatting,
lint, strict types, package/support tests, production builds and compiled-server startup. It
includes 6,100 web, 1,643 server and 525 support tests; default optional integration skips remain.
All 15 isolated-fixture browser scenarios pass across desktop Chromium and mobile Chromium/WebKit,
including four real import formats, warnings/errors, source/title/format invalidation, exact
lost-response/reload recovery, 320px English/Korean layouts, keyboard, light/dark contrast and axe.
Recovery also works when current response-feature rules block a fresh preview: the browser
regression mocks only that blocked preview snapshot and retries the original confirmation over
real HTTP. A paired API regression disables the actual feature after a committed import and
verifies that the original request recovers its draft while fresh creation remains blocked.
Safari full-control keyboard traversal uses Option+Tab; native Tab behavior is recorded separately.
The updated legacy beta journey has static TypeScript/lint coverage; that beta fixture was not run.
Seven PostgreSQL conformance tests pass on a fresh isolated PostgreSQL17 fixture with a restricted
runtime role, including concurrency, transaction rollback, tenant isolation, deletion/tombstones
and the durable no-media workspace-deletion fence found in independent review. The fixture and
temporary credentials were removed; application data was not used. Independent read-only review
verified both the deletion-fence fix and saved-confirmation recovery with an invalid fresh preview.
All ten fresh source-bound editorial packets have 716 pending entries each, including 37 new import
phrases. Automated verification does not grant human/native-language acceptance.

The durable Round **starter-copy** intent below remains its own API/storage checkpoint. Import
receipts do not change starter-copy semantics. Survey pages/conditional paths (WX-06) still require
their separate contract/design checkpoint after these P1 reliability increments.

**WX-05C: durable Round starter-copy retries.** The selected P1 follow-up adds an explicit
actor/workspace/template/language intent to the existing Round starter-copy endpoint. A lost
successful acknowledgement must recover the current original copy, including later draft edits,
rather than create another draft. Template browsing and preview remain read-only. Ordinary
locale-only API callers retain their existing creation behavior; the new web uses durable intents.

The bounded slice covers a pinned source-content version, a 24-hour new-creation window,
concurrent exact retries, conflicting bodies, reload recovery, role/context changes and
archive/deletion tombstones. Browser storage contains only bounded request metadata, never
template questions or answers. Blocked/corrupt storage prevents an unsafe new creation.
Committed identities stay consumed until workspace erasure; expiry cannot make an accepted key
create another copy. Survey retry behavior and independent Presentation copy contracts stay
separate. Migration116 is required before deploying the matching API and chooser.

**WX-05C local verification — 2026-11-18:** `VITEST_MAX_WORKERS=1 pnpm check` passes formatting,
lint, strict types, package/support tests, production builds and compiled-server startup. It
includes 6,170 web, 1,651 server and 526 support tests; default optional integration skips remain.
All 97 focused client tests pass, covering exact-body reload recovery, disappeared/replaced
metadata, bounded renewal history, current-preview version pinning, feature/authority changes
and reopening a known successful copy after cleanup/navigation failure.

All eight isolated-fixture browser scenarios pass: lost acknowledgement followed by real HTTP
replay of the later-edited original, explicit same-UUID renewal after actual server expiry,
blocked/corrupt storage, and 320px English/Korean recovery across mobile Chromium/WebKit with
keyboard, light/dark, fit and axe checks. The WebKit status-message contrast repair is scoped to
the chooser. The API writer-rollback regression uses a synthetic extended-response starter with
the real feature gate. Independent read-only verification confirms the client recovery and
preview-version fixes.

All 16 new contract/memory/API tests and 11 restricted-role PostgreSQL17 conformance tests pass.
The latter cover concurrent identical and conflicting requests, current-content recovery, expiry
after lock waits, initial-history and receipt-insert rollback, actor/workspace isolation, role
revocation, append-only/RLS guards and archive/deletion/erasure fences. Seven existing import
PostgreSQL regressions also pass. The temporary isolated database fixture and credentials were
removed; application data was not used. All ten source-bound editorial packets contain 729
pending entries, including 13 new recovery phrases. Automated verification does not grant
human/native-language acceptance.

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

**Dependencies:** the owner selected earlier single-choice page visibility on 2026-11-19;
runtime and reporting/privacy design still precede collection enablement. Owner:
Surveys + contracts + reporting.

**Selected WX-06A1 contract/reader foundation:** version 3 retains flat `items` and adds 1–20
ordered pages whose question UUIDs form an exact ordered partition. Legacy drafts and immutable
runs keep their existing route; ordinary writers remain v2. Expand stored readers with migration117,
add participant reader negotiation and accessible Back/Next with a safe progress-save barrier,
and render v3 creator views read-only. Keep fresh v3 authoring, copying, publishing and launches
blocked through HTTP until the separate page-authoring checkpoint. Reports remain aggregate-v2
because layout does not change response eligibility, denominators or suppression. Add no page
visit telemetry. See the [contract and compatibility decisions](survey-pages.md).

This checkpoint selects ordered pages only. Page-authoring controls and their effective writer
grant are the next A increment below; answer-based conditions remain B. Do not describe this reader
foundation as shipped page authoring or branching.

**WX-06A1 local verification — 2026-11-18:** `VITEST_MAX_WORKERS=1 pnpm check` passes formatting,
Docker dependency checks, lint, strict types, package/support tests, production builds and compiled
server startup. This includes 6,234 web, 1,658 server and 527 support tests; default optional
integration skips remain. All 59 focused client tests, 19 scoped contract tests and 13 shared-join
tests pass. Comparing the actual base parser/upgrader at `e8cc4ce` with the new reader produces
identical legacy acceptance and parsed/upgrade JSON for all 340 localized v1/v2 factory samples,
including legacy template IDs.

All 11 isolated-fixture browser scenarios pass across desktop Chromium and mobile
Chromium/WebKit. They cover v3 creator read-only behavior and actual HTTP writer denials,
reader-header negotiation, required validation, native intermediate Enter, save-before-advance,
Back, server-response-based resume, exact lost-ack retry, one final submission and closed review.
English/Korean 320px keyboard, light/dark, axe and 160-character unbroken heading fit checks pass.
The long-heading probe changes DOM text only; reader/save flows use real HTTP. WebKit palette
checks wait for the actual text colors before axe without exclusions. Browser fixtures use
trusted repository version policy to seed retained v3 content; production writers stay blocked.

The shared Library reader preserves frozen v3 page headings, multiline instructions and question
groups through additive, explicitly whitelisted `surveyPages` metadata. The client validates the
exact ordered question partition; legacy flat payloads stay unchanged and unpublished/private
fields remain excluded. All 41 focused Library client tests and 18 focused server tests pass.
Three of the browser scenarios verify actual HTTP shared-reader grouping, published-snapshot
pinning, view-only access, legacy v2 rendering and English/Korean mobile light/dark accessibility.
The reviewer independently confirmed the reported page-context issue is resolved.

Four new restricted-role PostgreSQL Survey conformance tests pass, plus the v3 Library copy
regression in PostgreSQL and memory. They verify legacy paths, exact receipts, immutable pages,
future-version denial, RLS, aggregate privacy and lifecycle cleanup. The temporary isolated
PostgreSQL17 fixture and credentials were removed; application data was not used. Independent
read-only review has no unresolved actionable finding. All ten source-bound editorial packets
contain 752 pending entries, including 23 new page-reader phrases; automated checks do not grant
human/native-language acceptance. Migration117 is required before deploying the matching readers.

**Selected WX-06A2 page authoring:** add explicit conversion in the existing Survey editor, with
page titles/instructions, page selection and keyboard reorder controls, question movement between
pages, confirmed removal and read-only draft preview. Page removal merges its questions into an
adjacent page; only the removed page's title/instructions are discarded. Stable IDs and the exact
flat-item partition remain authoritative. Empty pages are allowed while drafting and rejected at
publication. The existing 20-page/100-question limits stay in force.

The separate `surveyPages` product capability defaults false, depends on `surveys`, and requires
an explicit operator plan-policy grant plus existing edit access. There is no new environment
flag, paid plan, content version or migration. Ordinary blank/template factories remain v2; only
an explicit conversion or page-preserving source copy writes v3. Current destination grants
govern independent Library copies, using bounded metadata for discovery. Pausing the capability
blocks fresh v3 saves/publications/launches/copies while retaining accepted receipts, guest runs,
readers and aggregate privacy. Editor authority changes stop new writes and preserve local work;
actor/workspace changes fence stale content. Parent Survey creation policy remains separate.

This increment does not select answer-based conditions, hidden responses, page analytics or a new
identity model. The selected WX-06B decision and contract checkpoint are recorded below;
WX-06C covers branch-aware result/export changes. See [Survey pages](survey-pages.md) for
rollout and rollback.

**WX-06A2 local verification — 2026-11-19:** repository check stages pass formatting, Docker
dependency checks, lint, strict types, package/support tests, production builds and compiled-server
startup. The initial `VITEST_MAX_WORKERS=1 pnpm check` stopped on two existing five-second
browser-runner diagnostic timeouts. All six diagnostic tests passed immediately in isolation;
`pnpm test:smoke-support --maxWorkers=1` then passed all 528 support tests, followed by successful
`pnpm build` and `pnpm check:server-startup`. Final web verification after the whitespace-title
fallback correction passes all 6,272 tests and a fresh web typecheck; 1,662 server, 1,017 contract
and 657 default database tests passed. Default optional integration skips remain. All changed
files pass formatting and diff checks. Independent read-only frontend review found no actionable
issue; backend grant paths have focused API, contract and repository coverage.

All 15 isolated-fixture browser scenarios pass across desktop Chromium and mobile
Chromium/WebKit, retaining the eleven reader/Library scenarios. New cases cover explicit public
HTTP conversion, stable IDs/order, page/question editing, confirmed merges, empty-page publishing
validation, read-only preview, save/reload, publishing/launch and participant submission. Real
viewer/default-off/paused states deny writes. English/Korean 320px keyboard, light/dark, fit and
axe checks pass. Both affected mobile cases pass again after the authoring title-density polish:
three-line summaries preserve full DOM/accessibility names and inputs, while participant preview
keeps the full title. WebKit waits for actual legend/label colors before dark-mode axe, without
exclusions. Blank/whitespace-only titles retain localized accessible fallbacks without changing
the raw authoring input.

The Survey pages and Library conformance suites pass 33 memory/restricted PostgreSQL17 tests,
with one expected PostgreSQL-only case skipped in the memory branch. They cover the internal
discriminator, page-preserving granted copies and exact replay after page capability removal.
The temporary isolated Colima/tmpfs fixture and credentials were removed; application data was
not used. All ten fresh source-bound editorial packets contain 786 pending entries each, including
34 page-authoring phrases. The packet checker returns its expected pending-only exit 2; automated
checks grant no human/native-language acceptance. No additional migration is required beyond117.

**WX-06A2 review follow-up:** account-load failures keep the workspace loading/error/retry
screen visible. A transient refresh masks the confirmed editor without disposing its local draft;
same-scope recovery resumes it, while changed identity/workspace and authentication revocation
fence the old controller. In-flight owned loads/saves can reconcile masked state; accepted action
responses cannot navigate until fresh authority is confirmed. Server-side
`SURVEY_PAGES_NOT_ENABLED` responses retain the exact save identity as a resumable pause rather
than a stale-draft conflict. Genuine revision/idempotency conflicts keep their existing behavior.
Both reported findings and the late-navigation guard were independently verified resolved.

Follow-up verification passes all 6,281 web tests, 36 focused editor/autosave regressions, whole-web
types/lint, changed-file formatting/diff checks and the production web build. All 17 browser
scenarios pass, retaining the original fifteen and adding initial account failure plus masked
unsaved-refresh recovery, and real server-side policy-pause/exact-save recovery. Only account
503 responses are mocked; successful account retries and all saves use real HTTP. The policy
test changes the actual fixture policy, observes `409 SURVEY_PAGES_NOT_ENABLED`, restores the
grant and verifies byte-identical body/key replay with one revision and no Survey reload. The
final paused-save case also passes separately against the latest guard. Fixtures are stopped.
No shared provider, public contract, storage or localization inventory changes are needed for
these fixes.

**Selected WX-06B1 conditional-page contract foundation:** the owner selected show/hide pages
using one earlier single-choice answer. Implement a separate proposed v4 module with strict
`choice_equals` conditions, earlier-page references, exact page/question partitioning, deterministic
eligibility and cascading hidden-answer cleanup. Missing/nonmatching/invalid controllers do not
reveal dependent pages. Cleanup does not approve input: unknown IDs and eligible invalid values
remain validation errors, and validation does not silently prune hidden submissions. Internal
states distinguish unanswered questions from questions skipped by logic.

At B1 this was an isolated contract and pure-helper delivery. Survey schemas/readers accepted
only v1–3, ordinary factories remain v2, and `surveyPages` still grants v3 only. There is no new
migration, runtime import, branching authoring screen or effective branching writer grant. Existing
production boundaries must continue rejecting v4 even with the page-authoring capability enabled.
See the [selected contract and privacy decisions](survey-branching.md).

After B1 the remaining Survey checkpoints were **B2 runtime/readers**, **C branch-aware results/privacy**, then
**B3 authoring and effective writer enablement** after both reader/privacy prerequisites pass.
Late retries must not resurrect answers cleared by newer branch changes. Branch-aware denominators,
minimum samples and filtered exports need explicit qualification before enabling collection.

**WX-06B1 local verification — 2026-11-19:** `VITEST_MAX_WORKERS=1 pnpm check` passes formatting,
Docker dependency checks, repository lint/types, all package/support tests, four production build
tasks and compiled-server startup. This includes 1,051 contract, 6,284 web, 1,668 server, 657
default database and 528 support tests; configured optional integration skips remain. The proposed
module has 34 focused branching cases covering schema bounds/strictness, invalid references and
cycles, controller validity, cascading cleanup, input independence, required fields, navigation,
resume and explicit question states. Independent read-only privacy/eligibility review found no
actionable defect.

**Selected WX-06B2 runtime/readers:** expand frozen storage and read schemas to v4, negotiate
reader capabilities, show only eligible pages, clear hidden answers on controller changes, and
save complete replacement response maps under existing revision/idempotency checks. Retried
historical acknowledgements cannot restore cleared data. Reconnect derives the resume page from
saved responses. Closed retained attempts remain read-only; creators inspect all pages and rules
without autosave. Existing v1–3 request hashes and writer schemas remain stable.

Migration 118 expands four stored-version constraints only. No conditional authoring grant or
new v4 creation path is enabled. Source/Library copies and new Library shares are explicitly
blocked, and v4 aggregates/summaries/derived exports fail closed pending C. Existing account
exports retain conditional source documents without participant answers or credentials.
Restricted PostgreSQL checks cover migration replay, forced RLS, frozen snapshots, receipt
recovery and room/retention/account erasure. See [reader behavior and gates](survey-branching.md).

**WX-06B2 local verification — 2026-11-19:** full `VITEST_MAX_WORKERS=1 pnpm check` passed:
formatting, Docker dependency checks, lint/types, 1,053 contract tests, 666 default database tests,
6,318 web tests, 1,672 server tests, 529 support tests, four production build tasks and compiled
server startup. Configured optional integration skips remain. Separately, 11 restricted-PostgreSQL
Survey tests and 29 Library tests across memory/PostgreSQL passed against a task-isolated database;
the temporary database server was stopped afterwards. Six Playwright runs passed across desktop
Chromium, mobile Chromium and mobile WebKit, covering cascading cleanup/no resurrection, exact
unknown-outcome retries, stale acknowledgements, saved-map resume, closed/finalized review,
heading/error focus, axe, overflow and light/dark screenshots. The new inspection copy is bound
to three pending editorial review items per locale; native-language and human acceptance stay open.
An independent integration audit found no actionable issues. The B2 increment is prepared for review
on `codex/survey-branching-readers`.

**Selected WX-06C1 counting and withheld-result foundation:** the separate
`@openround/contracts/survey-branching-results` module validates published v4 content and explicit
finalized submissions, computes internal eligible/answered/unanswered/logic-skipped partitions,
and retains answered-respondent distribution denominators separately from eligible-submission
coverage. Invalid finalized rows reject the whole batch; no hidden answers are silently repaired
into evidence. A strict proposed aggregate-v3 DTO always withholds all counts and distributions,
including total submissions, regardless of closure or sample size. There is no approval override.

Adversarial fixtures cover direct small groups, complements, nested 15/10/9 cohorts and independent
controller overlap. Public withheld output cannot expose counts or per-person branch traces.
Historical aggregate-v2 bytes remain pinned across source v1–3. No runtime results, summaries,
exports, writer paths or grants are enabled. See the
[counting semantics, privacy risks and staged follow-up](survey-branching-results.md).

**WX-06C1 local verification — 2026-11-19:** full `VITEST_MAX_WORKERS=1 pnpm check` passed,
including 1,109 contract tests, 6,406 web tests, 1,672 server tests, 529 support tests, four
application build tasks and compiled-server startup. The separate contracts build emitted the new
entry and declarations. Fifty-six added contract cases cover counting, privacy and legacy bytes;
14 focused API/summary boundary cases passed. Independent read-only review found no actionable
issue. Existing optional integration skips and human acceptance gates remain.

**Selected WX-06C2 whole-report disclosure candidate:** the owner selected whole-report
withholding until privacy checks pass. The additive aggregate-v4 candidate groups each valid
finalized submission by all of its released contributions: question eligibility/answer state,
complete poll selection sets and rating buckets. A closed report releases exact evidence only
when every observed joint pattern contains at least five submissions; otherwise all evidence,
including the total, remains null/empty. C1 aggregate-v3 stays permanently suppressed-only.

Automated fixtures cover nested/overlapping groups, rare rating/optional/multi-selection patterns,
same-marginal safe/unsafe populations, Boolean unions and integer arithmetic boundaries. The
bounded property is that every nonempty Boolean cohort over the fixed contribution predicates
has at least five submissions. It is not a guarantee against auxiliary knowledge, homogeneous
answers, unverified/sybil submissions, the data-dependent release decision, or multiple releases.
High-dimensional surveys may therefore remain withheld even with large marginal samples.
See the [policy, limitations and required snapshot protocol](survey-branching-disclosure-policy.md).

**WX-06C2 local verification — 2026-11-19:** full `VITEST_MAX_WORKERS=1 pnpm check` passed,
including 1,140 contract, 6,406 web, 1,672 server, 666 default database and 529 support tests,
four application build tasks and compiled-server startup. The separate contracts build emitted
the additive exports and declarations. All 87 focused C1/C2/legacy cases and 14 API/summary
boundary cases passed; 31 new C2 cases include 625 reference histograms and numeric boundaries.
Independent read-only review found no actionable issue. Configured optional integration skips
remain; automated qualification does not replace human privacy acceptance.

C2's candidate implementation and automated tests do not grant human privacy or hosted release
acceptance. No runtime/writer grant changes. After acceptance, **C3 runtime results/readers**
and **C4 shared summaries/exports/lifecycle** must serialize one immutable final outcome per run,
including withheld outcomes, and withdraw rather than recompute after population erasure.
**B3** then adds condition editing, safe ID
remapping/reordering/deletion, previews, and an explicit writer grant after B2 and C qualify.
WX-07–10, WX-12–14, the remaining WX-11 surfaces and human release acceptance remain pending;
the selected WX-11A/WX-11B surface increments are recorded below. Earlier merged P1 slices do not imply
these later areas are shipped.

At B1, production compatibility used valid proposed v4 content and six server boundary cases,
including six accepted receipt-hash goldens from main `4dcefcc`. B2 retains those goldens and
updates the boundary checks for supported v4 reads, rejected v4 author writes and unknown future
v5 refusal. Branch-aware report/export availability is not claimed by either checkpoint.

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

**Selected WX-11A — Sessions recovery and action hierarchy:** while Survey privacy acceptance
remains open, the ready independent Sessions surface adds typed initial-history Retry, filtered-empty
Clear filters with search focus, static loading placeholders and explicit busy state. Pagination
failures retain loaded rows and the same-cursor Load more retry; action failures retain their
existing controls and confirmations. Each card has one dominant existing permitted action, with
Resume foregrounded for active editable Rounds/Presentations and reports foregrounded for
retained history/viewers. Survey sharing/results availability stays unchanged.

Owner: frontend and accessibility. Merged through PR #291 at `26f7a8c`, based on merged
PR #290 at `d6f3fd3`. Reuse existing translations and local token-based styles; preserve compact
grid/list density, counts, URLs, scope fences and credential/deletion behavior. See the
[Sessions scope and acceptance record](sessions-workspace-polish.md). WX-11B Results is merged;
WX-11C Workspace initialization/recovery is local. Library, independent subsection recovery and
capability/plan explanations remain pending. These selected
surface increments do not complete all of WX-11.

**WX-11A local verification — 2026-11-19:** full `VITEST_MAX_WORKERS=1 pnpm check` passed,
including 6,423 web, 1,140 contract, 1,672 server, 666 default database and 529 support tests,
four application builds and compiled-server startup. All 85 focused Sessions/control cases passed.
Six production Playwright cases passed across desktop Chromium, 320px mobile Chromium and
mobile WebKit, covering recovery and the existing history/Survey-results/deletion journey,
keyboard focus, grid/list, long titles, light/dark/forced colors, reflow and scoped axe checks.
Screenshots were inspected. Independent read-only review found no actionable issue. The
[verification record](sessions-workspace-polish.md) retains the development WebKit cancellation
limitation and distinguishes automated evidence from human acceptance. Configured optional
integration skips remain.

**Selected WX-11B — Results recovery and keyboard continuity:** suppress numeric zero on a failed
first read while preserving genuine empty results, trusted retained-row counts and More available
lower bounds. Filtered empty states use no-match headings and foreground Clear filters. Toolbar
and empty resets restore typed-search focus; Retry moves focus to a stable named busy panel.
Static placeholders match the saved layout while no trusted rows are available. Existing exact
pagination retries, scope fences, evidence/Pack semantics, report links and conditional Survey
restrictions remain unchanged.

Owner: frontend and accessibility. Merged through PR #292 at `6e85bcf`, based on merged
PR #291 at `26f7a8c`. The selected scope spans the overview's existing Rounds, Practice,
Presentations and Surveys views; no report detail route or data contract changes. See the
[Results scope and acceptance record](results-workspace-polish.md). WX-11C Workspace initialization
and recovery is local. Library, independent subsection recovery and capability/plan explanations
remain pending as separate increments.

**WX-11B local verification — 2026-11-19:** full `VITEST_MAX_WORKERS=1 pnpm check` passed,
including 6,437 web, 1,140 contract, 1,672 server, 666 default database and 529 support tests,
four application builds and compiled-server startup. All 63 focused Results tests passed.
Six production Playwright cases passed across desktop Chromium, 320px mobile Chromium and mobile
WebKit, covering all four views' recovery/focus continuity plus the existing pagination,
evidence and report-link journey. Grid/list, long titles, light/dark/forced colors, scoped axe
and direct control bounds passed; screenshots were inspected. A final local date-input sizing
correction passed a fresh production build and all six cases. Independent read-only review found
no actionable issue. Configured optional integration skips and human acceptance gates remain.

**Selected WX-11C — Workspace settings initialization and recovery:** show a trustworthy loading,
unavailable or ready state before settings navigation or account-dependent forms render. Commit all
current required GET responses together, retaining auth-first decisions, owner restrictions and
organization license exclusions. Retry reads only, rejects obsolete completions, preserves the
current hash and restores focus while respecting a user who moves elsewhere. Confirmed personal
identity and sign-in return behavior remain distinct from peripheral/transient failures.

Owner: frontend and accessibility. Branch: `codex/workspace-settings-recovery`, based on merged
PR #292 at `6e85bcf`. Existing mutation handlers, payment paths, permission helpers and destructive
confirmations remain unchanged. One new unavailable heading is supplied in all ten account catalogs.
See the [scope and availability trade-off](workspace-settings-recovery.md). One unavailable required
read currently withholds the page; independent subsection recovery remains a follow-up.

**WX-11C local verification — 2026-11-20:** the full isolated `VITEST_MAX_WORKERS=1 pnpm check`
passed formatting, Docker dependency checks, lint, types, repository tests, four application builds
and compiled startup. This includes 6,470 web tests and 529 support tests. The production browser
regression passed six desktop/mobile Chromium/WebKit cases for core/owner failure recovery,
focus, hash preservation, legacy mode and personal-account fallback. The existing Free-personal
business-browser settings regression also passed, including unchanged mutations and gated branding
save behavior. Scoped axe/reflow and visual checks passed; independent read-only review found no
actionable issue. Existing optional integration
skips and human acceptance gates remain. The [acceptance record](workspace-settings-recovery.md)
records the initial concurrent timing failures and unchanged-deadline isolated pass.

**Next ready WX-11D — Library pagination/reset focus:** All content discovery already has honest
server totals, loading/error counts, deduplicated cursor recovery and scope fences. Keep its failed
pagination recovery near the retained list's end, give Retry/final-page completion a stable focus
destination, and return focus to search after filter reset. Preserve exact totals versus loaded
counts, typed management routes, share actions and the existing cursor/permission regression.
Folder management stays in typed views. Owner: frontend and accessibility; not implemented here.

**Remaining capability/plan explanation checkpoint:** current booleans do not prove every reason
for unavailability. CSV and branding copy can falsely attribute operator-controlled absence to a
paid plan; the nonpayer fallback can mention a community operator in a hosted workspace. Neutral
copy corrections can proceed independently. Precise plan/operator/rollout/provider explanations
need a sanitized authoritative cause projection, server/contracts ownership and compatibility tests.
Preserve actual prices, payment destinations and existing grants; do not invent a paid gate or
diagnose a cause from a false boolean. Neither the copy correction nor the cause projection ships
with WX-11C.

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
assign an owner and define a testable completion target. C2 candidate code is merged in PR #290;
its human privacy acceptance remains open. The next Survey implementation checkpoint after acceptance is
**C3 frozen runtime results/readers**, followed by C4 summaries/exports before B3 enables
writers. **WX-11A Sessions** and **WX-11B Results** are merged in PRs #291–292.
**WX-11C Workspace initialization/recovery** is implemented locally. Library pagination/reset
focus is the next ready surface checkpoint. Independent settings-section recovery and truthful
capability explanations remain separate work. The public-site work merged in PR #288.
WX-14 needs a curator policy;
WX-07/13 need identity/privacy decisions, WX-09 needs credential permissions, and WX-12 needs a
provider choice. Do not mark these later items implemented because earlier slices are merged.

Local product polish does not close the [release-readiness ledger](release-readiness.json),
hosted capacity/security/legal/backup evidence, customer research, or public launch gates.
