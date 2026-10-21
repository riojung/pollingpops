# Polling Pops Slido feature gap analysis and development plan

Research date: October 9, 2026. Status: proposed roadmap, not an implementation or release claim.

## Executive recommendation

Polling Pops should catch up with Slido's everyday meeting and feedback workflows before attempting its enterprise integration breadth or conference-scale capacity. The immediate gaps are response variety, organizer-blind anonymous feedback, standalone surveys and Q&A, interaction consistency across Rounds and Presentations, convenient report sharing, and native presentation integrations.

The existing product is not starting from zero. Its repository already contains live quizzes, moderated Round Q&A, Audience Pulse, room chat, collaboration, themes, recovery evidence, source-grounded authoring, practice, structured Presentations, and a Presentation Companion. Rebuilding these would waste time. The plan instead extends their shared services and preserves the defining workflow:

**Ask → Diagnose → Intervene → Recheck → Prove.**

“Prove” means show bounded session evidence, not establish durable learning. Opinion polls, survey satisfaction, reaction counts, and brainstorming popularity must not be presented as comprehension or recovery.

Recommended delivery order:

1. Baseline the current work, protect privacy, and continue closing production-readiness gates.
2. Add open text, word clouds, ranking, and unscored multiple-selection polls.
3. Add standalone feedback surveys and Q&A rooms that work before, during, and after a meeting.
4. Improve moderation, exports, and aggregate report sharing.
5. Add an Ideas board and finish the existing Companion workflow.
6. Build one demand-selected native presentation integration, then event rooms and organization reporting.
7. Fund enterprise identity, further meeting integrations, and larger events only when demand and operational evidence justify them.

## Research scope and evidence

This is a comprehensive inventory of Slido's publicly documented feature families and important subfeatures, including its 2026 Ideas and AI changes. It is not a claim to have inspected every tenant configuration, private roadmap, or licensed integration. Sources are Slido/Cisco product pages, official help articles, and staff product announcements. Availability can depend on plan, integration, organization policy, and rollout.

The interactive pricing page failed to render during this research. Consequently, exact localized prices and a complete current plan-by-plan entitlement matrix are not asserted. Documented capacity and feature restrictions are cited below; recheck commercial terms before changing Polling Pops pricing or buying a competitor account.

The Polling Pops audit covers `HEAD` at `1b03a00`, the current staged/unstaged working tree, and relevant untracked Companion files on `codex/companion-published-questions`. This is source inspection, not a fresh full test run or proof of deployed behavior. Published-question Companion insertion is explicitly distinguished from merged work. Existing files were not changed by this research.

Status labels in the inventory:

- **Implemented:** a relevant code path exists; feature flags, editions, and production acceptance still apply.
- **Partial:** some capability exists, but the competitor workflow is materially broader or differs.
- **Missing:** no corresponding implemented workflow was found in the audited application/contracts.
- **External gate:** engineering scaffolding exists, but a human, provider, certification, or operational gate remains.
- **Selective:** capture the capability, but defer or deliberately limit matching it.

Priorities: **P0** safety and launch foundations; **P1** everyday workflow parity; **P2** expansion after core validation; **P3** demand-funded enterprise or large-event work. These are development priorities, not defect severities.

## Slido functionality inventory and Polling Pops gaps

### Participation and event setup

Slido supports browser participation through a code, link, or QR code, without requiring an app. Its event setup also includes scheduling, testing, duplication, and pre-event question collection. See [participant access](https://community.slido.com/slido-fundamentals-205/how-many-participants-can-ask-questions-or-vote-in-polls-553) and [setup and organization](https://community.slido.com/setting-up-a-slido-207).

| ID  | Slido functionality                                                      | Polling Pops status and gap                                                                                    | Priority |
| --- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------- |
| A01 | Mobile/desktop browser participation without installation                | Implemented: responsive guest participation and independent resume credentials                                 | Preserve |
| A02 | Join code, direct link, QR, and presenter joining instructions           | Implemented; final-domain and physical-device validation remains external                                      | P0       |
| A03 | Named or anonymous participation                                         | Partial: session aliases and public anonymity exist; organizer-blind anonymity does not                        | P0/P1    |
| A04 | Test as a participant before presenting                                  | Implemented: preview/rehearsal; add an explicit isolated feedback-room test run                                | P1       |
| A05 | Duplicate events and interactions; organize and reorder polls            | Implemented for content; reusable feedback-room/event templates are missing                                    | P1       |
| A06 | Configurable event dates and customized event code                       | Partial: session expiry/scheduling exist; no equivalent reusable event lifecycle or vanity-code workflow found | P2       |
| A07 | Collect questions and feedback before/after a meeting                    | Partial: practice and live Round Q&A exist; standalone asynchronous feedback/Q&A is missing                    | P1       |
| A08 | Multiple rooms, room switching, permanent room links, separate polls/Q&A | Missing: independent sessions are not a unified multi-room event                                               | P2       |
| A09 | Activate/deactivate rooms and copy interactions across tracks            | Missing as an event-management workflow                                                                        | P2       |

Multiple Rooms is documented for Professional and higher plans, with up to 200 rooms. Slido counts participants across the event, not independently for each track. Polling Pops should start with a much smaller tested room limit rather than copy the maximum. [Multiple Rooms](https://community.slido.com/general-settings-220/set-up-multiple-rooms-in-your-slido-412)

### Polling and response formats

The current polling catalog includes multiple choice, word cloud, rating, open text, ranking, quizzes, surveys, and Ideas. Ideas is a distinct newer workflow, not just a word-cloud skin. [Live polling catalog](https://www.slido.com/features-live-polling)

| ID  | Slido functionality                                                       | Polling Pops status and gap                                                                                  | Priority |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------- |
| P01 | Single-selection multiple choice                                          | Implemented as scored checkpoints and unscored polls                                                         | Preserve |
| P02 | Multiple selections and optional correct answer marking                   | Partial: scored exact-set multi-select exists; opinion `poll` responses currently require exactly one choice | P1       |
| P03 | Rating questions and result summaries                                     | Implemented; add survey-oriented scales/labels and multiple-item composition                                 | P1       |
| P04 | Word clouds with frequency-weighted display                               | Missing                                                                                                      | P1       |
| P05 | Word-cloud multiple submissions, length limits, filtering, and removal    | Missing; requires moderated text storage, not just a chart                                                   | P1       |
| P06 | Open-text responses, optionally repeated and named                        | Missing; Q&A/chat do not substitute for checkpoint feedback                                                  | P1       |
| P07 | Open-text reactions and chronological/popular sorting                     | Missing for responses; existing chat reactions provide a reusable pattern                                    | P1/P2    |
| P08 | Ranking, restricted top-N selection, randomized options, weighted results | Missing                                                                                                      | P1       |
| P09 | Description/image accompanying a poll                                     | Implemented: explanations/descriptions and private scanned images; scanner deployment remains gated          | P0       |
| P10 | Hide/show live results; choose percentage/count display                   | Partial: safe reveal and report distributions exist; feedback-specific live result controls need expansion   | P1       |
| P11 | Reset testing results and rerun interactions                              | Partial: use new isolated attempts/runs, not destructive overwriting of immutable learning evidence          | P1       |
| P12 | “Other” feedback using a multiple-choice plus open-text survey            | Missing until survey/text support; Slido does not document a native inline write-in choice                   | P1       |
| P13 | Poll duplication, survey merge/split, dividers, and templates             | Partial: library/templates exist; survey composition/dividers are missing                                    | P1       |

Relevant behavior is documented separately in [multiple choice](https://community.slido.com/interactive-poll-types-210/create-and-run-a-multiple-choice-poll-854), [word clouds](https://community.slido.com/interactive-poll-types-210/create-and-run-a-word-cloud-418), [open text](https://community.slido.com/interactive-poll-types-210/create-and-run-an-open-text-poll-885), and [ranking](https://community.slido.com/interactive-poll-types-210/create-and-run-a-ranking-poll-727). The [staff answer about “Other”](https://community.slido.com/community-q-a-7/can-i-add-an-other-option-to-a-multiple-choice-poll-7111) describes a survey workaround, not a native text field. Polling Pops may offer a better integrated version later, but should not mislabel it as required Slido parity.

### Quizzes and surveys

| ID  | Slido functionality                                             | Polling Pops status and gap                                                                   | Priority |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------- |
| S01 | Live quiz, correct answers, timer, and leaderboard              | Implemented, with additional accuracy mode and Recovery Loop branches                         | Preserve |
| S02 | Quiz participation/results and hardest-question review          | Implemented; production evidence remains separate                                             | P0       |
| S03 | Quiz templates and generated quiz questions                     | Implemented/partial: starters and grounded authoring exist; native-deck generation is missing | P2       |
| S04 | Several survey questions answered at the participant's pace     | Missing as an opinion-feedback artifact; self-paced learning practice is not equivalent       | P1       |
| S05 | Pre-meeting, live, and post-meeting survey links                | Missing unified feedback lifecycle                                                            | P1       |
| S06 | Required questions, reorderable items, and per-question results | Missing survey-specific validation and completion model                                       | P1       |
| S07 | Mixed survey formats and optional anonymous/named feedback      | Missing                                                                                       | P1       |
| S08 | Survey participation, rating summaries, and exports             | Partial: report/worker/export infrastructure can be reused                                    | P1       |

Sources: [quizzes](https://www.slido.com/features-live-quizzes), [survey product overview](https://www.slido.com/features-survey), and [survey creation and settings](https://community.slido.com/interactive-poll-types-210/create-and-run-a-survey-405). Survey availability is paid/plan-dependent; verify the current matrix rather than infer that every paid tier contains every survey feature. Surveys are not a full branching-form or LMS product in the sources reviewed.

### Audience Q&A and moderation

| ID  | Slido functionality                                          | Polling Pops status and gap                                                              | Priority |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | -------- |
| Q01 | Continuous audience Q&A alongside polling                    | Implemented for live Rounds; missing on the separate Presentation/Companion surface      | P1       |
| Q02 | Anonymous or named questions, with participant choice/policy | Partial: public alias hiding is not organizer-blind anonymity                            | P0/P1    |
| Q03 | Upvotes and popular/recent question sorting                  | Implemented for Round Q&A                                                                | Preserve |
| Q04 | Premoderation and publish/dismiss/remove controls            | Implemented for Round Q&A                                                                | Preserve |
| Q05 | Facilitator answers and optional participant replies         | Implemented for Round Q&A                                                                | Preserve |
| Q06 | Labels, answered states, and cohost moderation               | Implemented for Round Q&A                                                                | Preserve |
| Q07 | Highlight one question fullscreen for presentation           | Partial: Q&A projection exists; an explicit spotlight/queue workflow was not found       | P1       |
| Q08 | Optional question downvotes                                  | Missing; selectively defer because of silencing/abuse risks                              | P3       |
| Q09 | Open Q&A before/after the event, not only while a quiz runs  | Missing; current service closes when its live Round finishes                             | P1       |
| Q10 | Q&A participation, popular topics, sentiment, and exports    | Partial: statistics/transcripts exist; topic summary and sentiment classification do not | P1/P3    |

See [Q&A product features](https://www.slido.com/features-live-qa), [optional downvotes](https://community.slido.com/q-a-settings-222/enable-downvotes-for-your-q-a-440), and [Q&A insights and sentiment](https://community.slido.com/analytics-data-exports-230/q-a-insights-and-question-sentiment-in-slido-732). Slido documents automated English sentiment with manual correction. Matching that classifier is lower priority than safe participation, moderation, and useful summaries. It must not become an assessment of individual participants.

### Ideas and AI assistance

| ID  | Slido functionality                                                | Polling Pops status and gap                                                                                          | Priority |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------- |
| I01 | Brainstorming board before, during, or after a meeting             | Missing; existing chat/Q&A are different workflows                                                                   | P2       |
| I02 | Multiple ideas, optional names, hide/reveal, recent/popular order  | Missing as a board; reuse validated audience infrastructure                                                          | P2       |
| I03 | Emoji reactions to ideas                                           | Partial: chat reactions exist, but idea-board reactions do not                                                       | P2       |
| I04 | AI grouping, editable categories, manual reassignment, undo/retry  | Missing; introduce manual grouping first and optional asynchronous suggestions later                                 | P2       |
| I05 | Topic-to-poll generation and question wording/options assistance   | Partial: grounded authoring and deterministic Question Health exist; lightweight feedback-poll assistance is missing | P2       |
| I06 | Generate interactions from native PowerPoint/Google Slides content | Missing native integrations; file-upload authoring is not equivalent                                                 | P2       |
| I07 | Participant Question AI before Q&A submission                      | Missing; optional and privacy-gated, not part of initial parity                                                      | P3       |
| I08 | Organization controls over enabled AI functions                    | Partial: deployment/provider/feature controls exist; finer organization-level governance needs work                  | P2/P3    |

[Slido Ideas](https://www.slido.com/features-ideas) adds brainstorming and prioritization. Its [current help guide](https://community.slido.com/interactive-poll-types-210/create-and-run-an-ideas-poll-8010) documents five reaction types, a 200-idea limit, AI grouping and category editing, but excludes Ideas from surveys and PowerPoint/Google Slides integrations. The [June 2026 announcement](https://community.slido.com/product-news-announcements-108/introducing-slido-ideas-8088?postid=15749) discusses further work; upcoming items are not counted as shipped here.

The [April 2026 AI announcement](https://community.slido.com/product-news-announcements-108/slido-ai-2-0-work-smarter-than-ever-7896) covers host poll generation, writing assistance, slide-based generation, quizzes, participant question refinement, and administrator controls. Do not treat Polling Pops' authoring consent as permission to send live audience feedback to an AI provider.

### Presentation, meeting, and embedding integrations

| ID  | Slido functionality                                                        | Polling Pops status and gap                                                                        | Priority |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------- |
| N01 | PowerPoint integration on Windows/macOS; interactions activate with slides | Missing; web Companion is useful but not native slide synchronization                              | P2       |
| N02 | Google Slides add-on and extension-based presentation support              | Missing                                                                                            | P2       |
| N03 | Webex integrated audience interaction                                      | Missing; platform partnership/capability feasibility requires investigation                        | P3       |
| N04 | Microsoft Teams meeting app                                                | Missing                                                                                            | P2/P3    |
| N05 | Zoom meetings/webinars app                                                 | Missing                                                                                            | P2/P3    |
| N06 | Combined slide and meeting integrations                                    | Missing; requires one authoritative shared interaction instance                                    | P3       |
| N07 | Embedded live video alongside participation                                | Missing combined experience; a normal browser link is not equivalent                               | P3       |
| N08 | Participant/event embedding in websites and event apps                     | Partial: secure read-only presenter embed exists; interactive participant embed does not           | P2       |
| N09 | Present mode with live results and Q&A                                     | Partial: strong presenter/Companion base, but feedback formats and Presentation Q&A need expansion | P1/P2    |

Sources: [integration catalog](https://www.slido.com/features-integrations), [PowerPoint](https://www.slido.com/powerpoint-polling), and [Google Slides](https://www.slido.com/google-slides-polling). Slido's PowerPoint page currently excludes PowerPoint Online. Its Slides workflow can require a Chrome extension to preserve presentation features. These constraints matter: a thin sidebar alone is not equivalent to complete slideshow support.

### Analytics, reports, and portability

| ID  | Slido functionality                                            | Polling Pops status and gap                                                                          | Priority |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------- |
| R01 | Per-event participation and engagement statistics              | Implemented/partial: Round interaction reports exist; new feedback artifacts need compatible reports | P1       |
| R02 | Poll distributions, quiz results, and Q&A summaries            | Implemented for supported formats and Round Q&A                                                      | Preserve |
| R03 | Question sentiment/topics and anonymous participation measures | Partial: counts exist; organizer-blind anonymity metrics and topic summaries need new models         | P1/P3    |
| R04 | Result images, clipboard sharing, and PDF summaries            | Missing as purpose-built report exports                                                              | P1       |
| R05 | Excel and Google Sheets exports                                | Partial: UTF-8 CSV/JSON exist; native workbook and Sheets delivery are missing                       | P1/P2    |
| R06 | Detailed Q&A, replies, poll responses, and leaderboard exports | Implemented/partial: authorized exports exist; broaden formats while preserving privacy/entitlements | P1       |
| R07 | Per-room reporting and exports                                 | Missing unified event/room reporting                                                                 | P2       |
| R08 | Organization usage/engagement trends across events             | Partial: workspace navigation/activity is not equivalent to program analytics                        | P2       |
| R09 | Enterprise BI Data Connector beta                              | Missing; first offer documented scoped exports, not an unbounded data API                            | P3       |
| R10 | Compliance archive integration                                 | Missing; contract/residency-specific and selectively deferred                                        | P3       |

Sources: [analytics](https://www.slido.com/features-analytics), [export guide](https://community.slido.com/analytics-data-exports-230/export-your-poll-results-and-q-a-questions-532), and [enterprise analytics](https://www.slido.com/enterprise). The documented Theta Lake integration is EU-residency-only; the Data Connector is labeled beta. Neither is evidence of a generally available unrestricted public API.

### Branding, collaboration, and administration

| ID  | Slido functionality                                                 | Polling Pops status and gap                                                                         | Priority |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------- |
| B01 | Preset presentation treatments and custom colors                    | Implemented: seven accessible presets, including Candy Pop, and bounded workspace branding          | Preserve |
| B02 | Main logo, partner/sponsor logos, presenter image/GIF background    | Missing/Selective: prioritize validated logo support; retain restrictions on arbitrary theme assets | P2/P3    |
| B03 | Participant welcome treatment and external resource links           | Partial: themed join/help exist; configured room resources/welcome content need work                | P2       |
| B04 | Co-hosts and shared meeting preparation/moderation                  | Implemented for Rounds; broaden the role consistently to feedback rooms and Presentations           | P1       |
| B05 | Organization members, roles, and license management                 | Partial: workspace roles/invitations/billing exist; enterprise seat/admin lifecycle needs expansion | P3       |
| B06 | Spaces for sharing events with selected organization members        | Partial: workspaces/Groups provide organization, not identical per-space event permissions          | P2       |
| B07 | Organization-wide branding, privacy, access, and retention defaults | Partial: several policies exist; enforceable organization-wide feedback defaults are missing        | P2/P3    |
| B08 | Bulk integration installation and managed rollout                   | Missing until native integrations exist                                                             | P3       |

Sources: [branding controls](https://community.slido.com/customizations-and-branding-225/add-branding-and-custom-colors-to-your-slido-454) and [Spaces](https://community.slido.com/co-hosting-and-shared-access-228/use-spaces-to-collaborate-on-slidos-2278). Slido's guide does not offer removal of its logo or arbitrary font styling. Full white-labeling and a freeform theme engine are therefore not required to catch up.

### Security, accessibility, support, and commercial packaging

| ID  | Slido functionality                                                    | Polling Pops status and gap                                                                                                     | Priority |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------- |
| T01 | Passcode access and hide-from-search settings                          | Partial: join codes/rate limits/locks exist; a separate feedback-room passcode is missing                                       | P0/P1    |
| T02 | Require name/email or verify allowed emails/domains                    | Missing for participants; plain email collection must not be described as verification                                          | P2/P3    |
| T03 | Participant SSO with anonymous submission still possible               | Missing; current creator OIDC/LTI foundation is not participant SSO                                                             | P3       |
| T04 | Enterprise SAML SSO, domain claim, SCIM creator provisioning           | Partial: creator OIDC/operator policy exists; managed SAML/SCIM and domain claims are missing                                   | P3       |
| T05 | Encryption, external assurance, resilience, and security documentation | Partial/External gate: engineering controls exist; independent review, restore, hosted operation, and assurance evidence remain | P0/P3    |
| T06 | Custom enterprise retention and privacy settings                       | Partial: session/account retention and deletion exist; broader organization policy enforcement needs work                       | P0/P3    |
| T07 | Accessibility documentation and published VPAT                         | External gate: automated checks and design targets exist; independent manual review/report is pending                           | P0       |
| T08 | Help center, academy, webinars, and enterprise success support         | Partial: written/video help exists; expand feature guidance, onboarding, and staffed support                                    | P1/P3    |
| T09 | Free, annual, one-time event, education, and enterprise plans          | Partial: Community and hosted subscriptions exist; event passes/enterprise seats need demand validation                         | P2/P3    |
| T10 | Free 100-participant events; paid larger-event tiers                   | Gap: current hosted Free/Pro ceilings are 20/100; do not raise them without target-host/cost evidence                           | P0/P2/P3 |

Sources: [access protection](https://community.slido.com/security-privacy-essentials-224/secure-your-slido-491), [participant privacy](https://community.slido.com/security-privacy-essentials-224/participant-privacy-choose-anonymous-or-named-participation-1609), [security information](https://www.slido.com/security), and [accessibility/VPAT](https://community.slido.com/technical-setup-troubleshooting-206/accessibility-with-slido-533). Slido documents areas of partial accessibility support; this is not a blanket certification of every feature against WCAG 2.2 AA. Its published uptime figure is historical performance, not a verified contractual SLA in this research.

[Slido's March 2026 update](https://community.slido.com/product-news-announcements-108/what-s-new-in-slido-march-2026-7714) discontinued native iOS/Android apps in favor of browser participation. Building native mobile apps is not a Slido catch-up requirement.

## Polling Pops baseline and exact findings

### Reusable capabilities

The following should be preserved and reused rather than scheduled as greenfield work:

- Six checkpoint types: `single_select`, `true_false`, `multi_select`, `numeric`, `rating`, and `poll`.
- Durable acknowledgements, server-owned deadlines/scores, immutable published versions, exact command retries, and reconnect snapshots.
- Confidence, concept tags, misconception labels, intervention branches, linked rechecks, and separately labeled revotes.
- Background report jobs, versioned recovery/interaction reports, CSV/JSON exports, transcripts, and aggregate Decision Replay.
- Moderated Round Q&A; separate room chat and structured Pulse; transactional audience delivery and retention/deletion coverage.
- Workspace roles/invitations, revocable session staff and read-only presenter credentials.
- Themes, safe branding, private scanned media, bulk/CSV/JSON/constrained QTI portability, folders/tags, and starters.
- Asynchronous source-grounded drafting with citations and explicit human publication; self-paced learning practice/follow-up.
- Structured Presentations, their authoritative live engine, and the merged Companion foundation, text-only Recovery Pack insertion, and one session-only unscored Quick Check.
- Recovery Packs with reviewed diagnostic/recheck/probe content and intervention cards; Question Health advice and reviewed revisions.
- Creator OIDC and LTI instructor launch/Deep Linking foundations, not completed enterprise or identified-learner capabilities.

The professional shell, Presentation features, and several differentiated capabilities are opt-in/allowlisted. “Implemented” does not mean globally enabled or independently production-accepted. Recovery Trail and Concept Health entitlement fields are not evidence that those products are built.

### Five code-level findings that change the plan

| Finding                                                                                   | Evidence                                                                                                                                            | Planning consequence                                                                                     |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Only six current checkpoint types                                                         | [contracts](../packages/contracts/src/index.ts), `QuestionTypeSchema`                                                                               | Open text, word cloud, and ranking require model, persistence, editor, player, and report changes        |
| Opinion polls accept exactly one selection                                                | [contracts](../packages/contracts/src/index.ts), `PollResponseSchema`                                                                               | Add explicit single/multiple-selection opinion policy; do not reuse scored multi-select semantics        |
| “Anonymous public” Q&A still reveals aliases and moderation participant IDs to moderators | [Q&A service](../apps/server/src/qna-service.ts), `questionView` and reply projection                                                               | Introduce a different organizer-blind mode; retain honest facilitator-visible alias mode for learning    |
| Q&A authenticates against Round sessions and closes at Round completion                   | [Q&A service](../apps/server/src/qna-service.ts), `authenticate` and `ensureOpen`                                                                   | Reuse the service through explicit audience scopes; standalone rooms need their own open/close lifecycle |
| Current hosted limits and release topology are smaller than Slido's                       | [entitlements](../apps/server/src/entitlements.ts), [architecture](architecture.md#deployment-topologies), [release ledger](release-readiness.json) | Capacity and operational readiness require evidence, not a constants-only change                         |

Current state/report versions also differ from earlier plans: the Round engine supports state v5/v6, Round reports v1–v4, and Presentation reports v1–v3. Artifact schemas have their own versions. Allocate the next versions from the implementation baseline; do not blindly reapply an old “upgrade to v4” or “report v3” task. See [engine constants](../packages/game-engine/src/index.ts), [artifact upcasters](../packages/db/src/artifact-schemas.ts), and [report contracts](../packages/contracts/src/index.ts).

The current uncommitted Companion increment inserts an explicitly selected immutable text-only question from a published Round. It is not yet a merged/deployed capability, does not include published Presentation sources, and does not solve session-owned media retention. Preserve it and baseline it through the normal review/release workflow before dependent work. [Current implementation checkpoint](implementation-status.md#staged-implementation-plan-checkpoint)

### Capabilities worth differentiating rather than copying

The reviewed Slido catalog emphasizes participation and meeting insight. It does not document an equivalent end-to-end workflow combining misconception-aware intervention, linked rechecks, Recovery Packs, and distinct recovery evidence. That is a positioning inference from the reviewed sources, not a claim that no competitor can ever support similar behavior.

Polling Pops should demonstrate three reusable workflows:

| Use case                                 | Familiar interaction workflow                                   | Polling Pops-specific value                                                                      |
| ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Higher-education lecture or workshop     | Word-cloud opener, Q&A, diagnostic checkpoint                   | Identify an unresolved concept, use a prepared intervention, and compare a linked recheck        |
| Technical, safety, or workplace training | Ranking needs, knowledge checks, feedback survey                | Separate confidence from correctness and record bounded recovery evidence with source provenance |
| All-hands or retrospective               | Organizer-blind questions, Ideas, priorities, post-event survey | Record decisions and next steps without turning employee opinions into learning scores           |

Keep numeric answers, evidence distinctions, Community distribution, and learner-accountless participation. Add opinion/meeting workflows without weakening those guarantees. Recovery Trails and Concept Health remain separate future increments, with pairing/privacy and demand review before any cross-session analysis.

## Development architecture

### Shared interaction scope

Keep the modular monolith, shared contracts, PostgreSQL, audience outbox, and current realtime foundation. Add an explicit audience-scope abstraction rather than duplicating Q&A/chat for each surface:

- Scope kinds: existing live Round, live Presentation, and standalone feedback room.
- Resolve workspace, region, lifecycle, participant credential, staff permissions, moderation, retention, and access policy through the scope adapter.
- Existing Round IDs and `/v1/sessions/...` routes remain compatible. Additive routes for other scope kinds must not reinterpret an existing token as broader authorization.
- Separate audience sequence/cursors from game sequence. Reuse at-least-once outbox delivery, event deduplication, bounded synchronization, and removed-content projections.
- Survey attempts and idea submissions stay outside canonical game snapshots. Opinion interactions never modify scores or hidden answer keys.
- Share projector/participant/Companion rendering components, but preserve role-specific projections. Presentation adoption must not leak facilitator-only Pulse aliases or learning responses.

This foundation is an early dependency for standalone Q&A, Presentation Q&A, Ideas, and native integrations.

### Privacy and access modes

Offer clearly named, distinct modes rather than using “anonymous” for several incompatible promises:

| Mode                                 | Facilitator visibility                                                                    | Suitable use                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Session alias                        | Alias and scoped activity visible under current policy                                    | Learning checkpoints, private Pulse, moderated training    |
| Publicly anonymous alias             | Room does not see alias; moderators do                                                    | Existing classroom-style Q&A/chat with explicit disclosure |
| Organizer-blind anonymous submission | No author alias, participant ID, roster linkage, or identity export exposed to organizers | Sensitive opinion polls, feedback surveys, employee Q&A    |

Freeze submission privacy at creation. Changing room policy must never expose an earlier anonymous author's identity. Protect moderator projections, exports, search, staff APIs, audit views, realtime, and indirect metadata, not merely the visible username. Use opaque abuse-control handles that permit moderation without showing the alias. Keep technical/security data under a separate restricted operator policy and disclose it accurately; user text itself can identify its author, and anonymity is not a promise of absolute untraceability.

Do not pair organizer-blind submissions with individual score, confidence, roster, or cross-session learning records. Provide aggregate feedback only. Preserve facilitator-visible learning signals as a separate explicitly disclosed mode.

Add passcodes independent of the join code, with secure hashing, distributed attempt limits, expiry/rotation, and session-scoped authorization. Later email-domain access must actually verify control of the address; creator OIDC cannot be advertised as participant authentication. Organization-required identity must remain contract/policy-gated and must not silently disable anonymous submission where that is promised.

### New response contracts and evidence

Add three discriminated checkpoint types and two canonical response shapes through explicit contract negotiation/upcasters:

- `open_text` and `word_cloud` use validated text responses with defined submission limits and visibility policy.
- `ranking` uses an ordered, distinct list of permitted choice IDs. Never sort it in the current choice canonicalizer: order is the response.
- Opinion choice polls gain `selectionMode` and an explicit maximum selection count.
- Ratings gain clear scale endpoints/labels without implying correctness.

First-release behavior:

- All new opinion formats are unscored, confidence off, with null correctness. They are excluded from accuracy and recovery denominators.
- Open text is plain text, bounded initially to 1,000 characters; repeated submissions are explicitly configured and capped. No attachments, arbitrary HTML, or automated grading.
- Word clouds retain Unicode and a documented normalization policy. Display an accessible count table/list alongside the visual. Filtering and moderator removal must update all projections and exports without exposing removed content on reconnect.
- Ranking supports top-N and full-list ordering. Use a documented deterministic weighted score, a clear respondent denominator, and a stable tie-breaker. Keyboard move controls must be available instead of requiring drag-and-drop.
- Live results have independent visibility controls for opinion feedback. Scored checkpoint answers and private metadata remain hidden while open.
- Multi-submission feedback uses its own durable submission/idempotency constraints. Preserve the one-accepted-answer-per-participant/round invariant for scored learning checkpoints.

Use expand-and-contract migrations, RLS, scoped foreign keys, existing migration checksums, and transactional acknowledgements. Add compatible readers/workers before enabling new writers; reject unknown future versions. Feature rollback disables new creation while keeping accepted content, responses, reports, and retries readable. Do not relabel or rewrite old reports as new evidence.

### Surveys and standalone feedback rooms

Add a versioned `survey` artifact and an immutable published snapshot, reusing checkpoint rendering/validation where appropriate. It is an opinion-feedback product, not a renamed practice assignment.

Required behavior:

- Builder with mixed supported formats, required/optional questions, reordering, preview, and publish readiness.
- Open/close windows, reusable links, anonymous/named policy, explicit retention, server-owned attempts, resume, and idempotent final submission.
- Clearly distinguish drafts, in-progress attempts, and submitted responses. Aggregate only the chosen completion basis and display the denominator.
- Pre/live/post-event access without an active scored Round. Standalone Q&A uses the same room lifecycle and staff permissions.
- New test/rerun attempts leave original records unchanged. Merge/split helpers create new artifact drafts and preserve provenance rather than mutating live evidence.
- Initial release excludes complex branching, respondent CRM identity, email campaigns, sensitive demographics, and automatic satisfaction-to-learning judgments.

Reuse background report jobs for durable survey reports and deletion/retention cascades. Completion of a linked live Round must not accidentally close a separately scheduled survey/Q&A room.

### Q&A and Ideas improvements

For Q&A, add an explicit spotlight command, a facilitator queue, participant-safe fullscreen rendering, and moderation consistency across supported scope kinds. Downvotes stay optional/deferred pending evidence that they help rather than suppress participation.

For Ideas, add a separate board with plain-text submissions, bounded multiple contributions, reactions, manual categories, moves, moderation, and explicit hide/reveal. Start with 200 accepted ideas per board as a proposed tested ceiling; make operator/edition limits clear. Do not reuse the scored-answer uniqueness constraint or treat reactions as truth.

Optional AI categorization is a later asynchronous job with explicit feedback-processing permission, configured provider/region, deletion policy, budget limits, and human review/undo. The board remains usable without AI. Live answer acknowledgements, transitions, and recovery recommendations never await an LLM. Participant Question AI and sentiment classification are separate lower-priority privacy decisions, not automatic extensions of authoring AI.

### Reports and sharing

Extend the current durable report worker rather than building a second analytics pipeline:

- Versioned survey, text, ranking, idea, and shared-scope Q&A summaries.
- Native XLSX, accessible PDF summaries, and PNG/SVG visual exports with accessible text alternatives.
- Revocable, expiring aggregate-only report links; raw transcripts and identifiable learning data require normal authenticated authorization.
- CSV formula escaping and XLSX text-cell handling; no credentials, hidden metadata, or organizer-blind author mappings in any export.
- Scoped Google Sheets delivery only after basic file exports work; explicit OAuth permissions and separate retry/idempotency receipts.
- Organization dashboards initially aggregate activity and outcomes, with cohort thresholds and anti-differencing controls. Do not invent persistent learner identity to imitate usage charts.

Keep linked-recheck recovery separate from same-question revote improvement and from opinion feedback. Show numerator, denominator, sample warnings, and evidence type. Reports should remain available within 60 seconds of finalization.

### Presentation and meeting integrations

First finish the existing Companion's session-owned media retention and shared Q&A/feedback surfaces. Then build one native integration selected by observed partner workflows, not all five platforms simultaneously.

The first integration spike must establish:

1. Supported desktop/web clients, install/admin constraints, slideshow event/rendering capabilities, and marketplace review requirements.
2. Create/link an interaction from the deck, advance/activate safely, display results, and return to the deck with correct notes/animations behavior.
3. Dedicated revocable integration credentials, minimal scopes, audit identity, region binding, and no participant-visible host secrets.
4. Exact acknowledgement retry and reconnect without duplicate opening, advancement, or scoring.
5. A browser Companion fallback when installation, permissions, or client support prevents native operation.

Microsoft documents PowerPoint add-in capabilities in its [object model](https://learn.microsoft.com/en-us/office/dev/add-ins/powerpoint/core-concepts). Google documents [Slides add-ons](https://developers.google.com/workspace/add-ons/editors/slides) and [trigger restrictions](https://developers.google.com/workspace/add-ons/guides/workspace-restrictions). These APIs do not by themselves prove seamless slideshow synchronization. Treat a browser extension or native helper as a separately reviewed security/deployment decision if required.

After that, select Teams or Zoom from paying customer demand. Investigate Webex distribution/access separately rather than assuming Cisco's native Slido privileges are available to an independent vendor. A combined integration must address the same authoritative room; it cannot create two unrelated sets of responses.

Interactive participant embedding requires a new tightly scoped route and explicit allowed HTTPS origins. Preserve `frame-ancestors 'none'` on normal routes; never relax the whole application's CSP to support an iframe. Test browser storage restrictions and avoid embedding creator cookies or bearer secrets in slide/deck metadata.

## Prioritized development backlog

Effort is indicative focused engineering time for one experienced full-time engineer, excluding marketplace, procurement, legal, and independent review waiting time. Dependencies and existing scaffolding can change estimates. Fractional design, QA/accessibility, operations/security, and legal support are assumed.

| Epic | Priority | Deliverable                                                                                             | Dependencies                                          | Indicative effort                                           |
| ---- | -------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| E00  | P0       | Baseline current Companion work, feature/edition audit, partner workflow tests, update release evidence | Normal review of current changes                      | 1–2 weeks plus external gates                               |
| E01  | P0/P1    | Shared audience scope, lifecycle policy, organizer-blind anonymity, passcodes, projection/export tests  | E00                                                   | 3–4 weeks                                                   |
| E02  | P1       | Open text, word cloud, ranking, multi-selection opinion polls, editor/player/report compatibility       | E01; contract readers first                           | 4–6 weeks                                                   |
| E03  | P1       | Surveys and standalone scheduled Q&A/feedback rooms; test/rerun isolation                               | E01–E02                                               | 4–6 weeks                                                   |
| E04  | P1       | Q&A spotlight/queue, XLSX/PDF/visual exports, revocable aggregate sharing                               | E01–E03; report workers                               | 3–4 weeks                                                   |
| E05  | P2       | Ideas board, manual grouping, reactions, moderation; optional AI grouping as separate increment         | E01–E04; AI privacy approval for AI only              | 3–5 weeks without AI                                        |
| E06  | P2       | Companion media retention, feedback/Q&A reuse, host workflow polish                                     | Current Companion baseline, E01–E02                   | 2–3 weeks                                                   |
| E07  | P2       | One PowerPoint or Google Slides integration including installation and failure paths                    | E06; three paying partner requests and feasible spike | 6–10 weeks plus platform review                             |
| E08  | P2       | Event hub, bounded multiple rooms, permanent links, room staff, per-room reports                        | E03–E04                                               | 4–6 weeks                                                   |
| E09  | P2/P3    | Organization aggregates, policy defaults, scoped Sheets/BI export                                       | E04/E08; privacy review                               | 4–6 weeks                                                   |
| E10  | P3       | Managed SAML/SCIM, verified domain claims, enterprise policy/seat lifecycle                             | Existing OIDC plus funded institutional demand        | 8–12 weeks plus provider/contracts                          |
| E11  | P3       | Each additional slide or meeting integration                                                            | E07 and platform/customer evidence                    | 4–8+ weeks per platform                                     |
| E12  | P0/P3    | Target-host capacity, multi-host failover, operational assurance, optional certification program        | External ops/security support and budget              | Separate funded track; do not hide inside feature estimates |

Do not aggregate this table into a “percentage caught up.” A poll type, an identity broker, a support organization, and a 5,000-person production service are not equivalent units of work.

## Phased delivery and acceptance

Week ranges below are planning bands, not fixed release dates. E00–E07 total approximately 26–40 focused engineering weeks including one native presentation integration; the table shows a nominal 34-week sequence. A calendar commitment should add about 20% contingency and account for partner/platform delays. Broad enterprise and large-event parity is a further funded program, not a promised quarterly deliverable.

| Phase                                 | Indicative sequence        | Scope                                                                     | Exit gate                                                                                                                                                |
| ------------------------------------- | -------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Baseline and validate               | Weeks 1–2                  | E00; select three representative workflows; continue the 13 release gates | Reviewed baseline, six design partners, documented priority/installation constraints; no existing code/data regressions                                  |
| 1 Safe shared feedback                | Weeks 3–5                  | E01                                                                       | Tenant/scope isolation, anonymous projection/export tests, revoked-token/passcode tests, compatible migration and rollback rehearsal                     |
| 2 Response parity                     | Weeks 6–10                 | E02                                                                       | Host and participant journeys for every new format, no hidden-answer leakage, deterministic results, keyboard/phone coverage                             |
| 3 Before and after the meeting        | Weeks 11–15                | E03                                                                       | Participants complete/resume a mixed survey; standalone Q&A remains usable in its configured window; retry/retention/deletion pass                       |
| 4 Useful evidence                     | Weeks 16–19                | E04                                                                       | Source rows reconcile with exports; report generation within 60 seconds; anonymous identities never appear in shares/transcripts                         |
| 5 Brainstorming                       | Weeks 20–23                | E05 without automatic AI processing                                       | Moderated board survives reconnect/process loss; categories/reactions are consistent; human grouping usable without AI                                   |
| 6 Companion completion                | Weeks 24–26                | E06                                                                       | Session-owned media survives source deletion; shared Q&A/formats work with scoped credentials; no deck-context interruption in observed pilots           |
| 7 First native integration            | Weeks 27–34                | E07, one platform                                                         | At least three paying partners run full sessions; supported-client and admin-install matrix passes; safe fallback and marketplace requirements satisfied |
| 8 Events and organization             | Following 8–12 weeks       | E08–E09, sequenced by demand                                              | Room isolation/capacity, permanent links, scoped cohosting, aggregate privacy, and export authorization pass                                             |
| 9 Enterprise and broader integrations | Subsequent funded releases | E10–E12 and additional integrations                                       | Provider/legal/security acceptance, customer interoperability, independent accessibility evidence, failover and support readiness                        |

The first 90 days should deliver a reviewed foundation, privacy/access improvements, and the new response types, with survey development beginning if capacity permits. It should not be presented as completion of all Slido functionality.

### Production work proceeds alongside feature work

The [release ledger](release-readiness.json) has fifteen pending gates after October 21 engineering
revalidation reopened source CI and local production smoke. The thirteen external or human-evidence
gates remain pending, and earlier September engineering passes remain historical evidence. This
research does not close any gate. Keep exact-build evidence for:

- Single-VM staging with public TLS, strict SSH pinning, private telemetry, SMTP, object storage, and scanning.
- Named paging/support rota and incident rehearsal.
- Target-region load/soak and client-receipt latency, not just local loopback results.
- Encrypted off-host database/media backup and clean replacement-host restore.
- Manual accessibility and independent security review.
- Privacy/legal approval and provider-originated billing rehearsal.
- Repository governance with a second human reviewer and a normal canary.
- Real-phone/tablet QR and network coverage.
- Design-partner demand evidence and unassisted usability.
- Signed release and a stable beta observation window before public GA.

The current active hosted profile is a single remote VM. It has no high-availability or SLA claim. Enterprise assurance requires actual operations, external evidence, and staffed response; security controls in code alone do not provide SOC 2, ISO certification, or contractual availability.

## Editions, capacity, and operating cost

### Current policy

The audited entitlement code caps Hosted Free at 20 participants and five published checkpoint sets, with 30-day report retention. Hosted Pro is capped at 100 participants, with unlimited sets and 365-day default retention. Community is operator-configured and does not use an artificial application billing gate. Export/cohost/follow-up capabilities have their current edition controls. [Entitlement implementation](../apps/server/src/entitlements.ts)

Slido documents [100 participants on Basic](https://community.slido.com/community-q-a-7/how-many-participants-for-a-free-plan-user-7842) and [three polls plus one quiz per free event](https://community.slido.com/community-q-a-7/how-many-polls-can-i-use-in-the-free-plan-6781). Its documented paid range is 200–5,000 participants, with cumulative event counting. Webex has separate integration-specific limits, so do not market the largest Webex number as universal standalone capacity. [Participant limits](https://community.slido.com/slido-fundamentals-205/how-many-participants-can-ask-questions-or-vote-in-polls-553), [Webex limits](https://community.slido.com/webex-247/how-many-participants-can-use-slido-in-webex-2442)

### Proposed packaging

Keep fundamental participation, organizer-blind privacy, moderation, and the Recovery Loop accessible in Community and hosted Free. Use capacity, retention, collaboration, advanced exports, native integration administration, and institutional support to distinguish paid packages. Do not gate anonymity or abuse reporting as a premium safety feature.

Validate these changes rather than applying them immediately:

- Test Hosted Free at 50, then 100 only after cost, abuse, concurrency, and region-matched load evidence supports it.
- Test Pro at 250 after mixed workload and process-loss gates pass. Keep the current 100 cap until then.
- Consider a one-time event pass when occasional hosts demonstrate demand. It requires clear participant counting, tax/refund/billing behavior, and date windows, not just a new checkout button.
- Add enterprise seats, identity, policy/residency, and support only with contracts and staffed operation.
- Stage 1,000/5,000-person events as a different capacity program with explicit audience/workload limits, multiple failure domains, failover tests, and cost estimates.

Use target-region telemetry to model cost per completed session: compute/WebSockets, database writes, Redis/outbox traffic, media, email, backups, report jobs, AI, and support. Include concurrent events, not just one large synthetic room. No provider-free-tier or free-production-cost guarantee is made. Community remains Apache-2.0; operators pay infrastructure and operations costs.

Annual, one-time, and education packaging are documented in [Slido's pricing](https://www.slido.com/pricing) and [annual-plan guide](https://community.slido.com/pricing-plan-options-235/all-about-annual-plans-561). Revalidate prices and entitlement details manually before publishing a commercial comparison.

## Verification and release gates for new work

### Correctness and compatibility

- Fresh database, current-baseline upgrade, checksum verification, repeated migration, and forward-repair tests.
- Old Round/Presentation artifacts, legacy responses, state snapshots, reports, exports, and exact accepted retries remain readable.
- Property tests for ranking order/weighted calculation, Unicode text normalization, selection limits, required survey questions, and arbitrary visibility/room transitions.
- Durable response uniqueness/idempotency, monotonic audience sequencing, transactional outbox retry, and no duplicate reaction display.
- Restart and process-loss tests reconcile submitted surveys, idea/text submissions, moderation, and reports with database rows.
- RLS, cross-workspace/scope/region access, staff revocation, and deletion/retention/account-export cascades on every new table.

### Privacy, abuse, and security

- Organizer-blind anonymity tested through REST, realtime, reports, search, exports, audit interfaces, and setting changes; never rely on client-only redaction.
- Hidden learning responses/confidence/correctness never appear in open-phase text/feedback dashboards.
- Rate limits include anonymous/verified access, passcode attempts, repeated feedback, reaction storms, and distributed workers.
- Plain-text/XSS handling, Unicode-control abuse, payload bounds, CSV/XLSX injection, URL/asset fetching, SSRF, and media quarantine/scanning.
- Participant embeds have exact origin policy; normal routes retain frame denial. Native credentials cannot grant host powers to the audience.
- AI authoring and AI feedback-processing permissions are separated; no silent transfer of participant data.

### Accessibility and usability

- Keyboard ranking, accessible word-count tables, labeled reactions/scales, visible focus, non-color answer labels, reduced motion, and large touch targets.
- Batched live announcements so clouds, votes, and chat do not overwhelm screen readers.
- Axe plus manual keyboard, VoiceOver, NVDA, mobile, 200% zoom, contrast, and projector testing.
- Guest entry within 30 seconds and a first useful hosted interaction within five minutes in uncoached partner tests, treated as proposed targets.
- Five of six partners correctly explain who can see an anonymous response; no misleading anonymous UI.
- New privacy-sensitive workflows require independent review before production, not after the feature flag is globally enabled.

### Load and reliability

Maintain existing answer targets under mixed quiz, Q&A, chat, signals, text, ranking, and survey traffic:

| Measurement                        | Release target                                    |
| ---------------------------------- | ------------------------------------------------- |
| Accepted-answer reliability        | At least 99.95%                                   |
| Live session completion            | Above 97%                                         |
| Answer acknowledgement             | p95 below 250 ms; p99 below 600 ms                |
| Signal acknowledgement             | p95 below 250 ms; p99 below 600 ms                |
| Chat/text/idea acknowledgement     | p95 below 300 ms; separately instrument each path |
| Broadcast receipt                  | 95% of connected clients within 500 ms            |
| Reconnect/audience synchronization | Within two seconds; recovery above 95%            |
| Audience outbox lag                | p95 below one second                              |
| Finalized report availability      | Within 60 seconds                                 |
| Support contacts                   | Below 2% of sessions during the observed beta     |

Run 100-client continuous tests and 250-client target-region mixed tests before increasing caps. Include multiple simultaneous rooms, background surveys, moderation/reactions, Redis interruption, process termination, worker restart, and database saturation. Test larger supported tiers separately; a 250-client pass cannot establish a 5,000-client service. Metrics must use bounded labels and exclude participant aliases, message bodies, anonymous identity mappings, and raw feedback.

## Demand gates and roadmap decisions

Recruit three higher-education and three workplace facilitators. Use competitor task testing where access permits, not feature-count questionnaires alone. Observe at least ten real sessions and distinguish the workflows:

1. Prepare and run a lecture diagnostic with Q&A and a linked recheck.
2. Run a training session with ranking, confidence, intervention, and post-session feedback.
3. Run an all-hands/retro with organizer-blind Q&A, Ideas, and an asynchronous survey.

Collect consented measurements on setup time, guest entry, completion, moderator workload, privacy comprehension, unresolved-concept discovery, and deck switching. Ask which installation/identity constraints actually block adoption.

Proposed expansion gates:

- At least 50% of pilot facilitators repeat within four weeks.
- At least three partners are willing to pay or deploy, not merely interested.
- At least five of six can complete new workflows without coaching and understand the privacy policy.
- At least three paying partners need the same native presentation integration and Companion cannot adequately meet their workflow.
- At least 30% of eligible learning sessions use intervention/recheck without prompting; meeting-feedback sessions are not counted in that denominator.
- Facilitators identify an unresolved learning concept within two minutes; chat popularity is not a substitute.
- Larger capacity is funded by a real expected audience/concurrency workload and meets regional cost/failover gates.

If these gates fail, revise workflow, positioning, or packaging before adding another integration. Recovery Trail/Concept Health expansion should not displace essential opinion formats, safe anonymity, or launch evidence.

## Deliberate deferrals

- Native mobile apps, arbitrary CSS/fonts, uploaded sound packs, freeform slide authoring, and a public content marketplace.
- Automatic opinion grading, individual sentiment judgments, inferred employee performance, or cross-session learner tracking without an explicit approved identity model.
- Q&A downvotes, participant Question AI, and automatic sentiment classification unless user evidence and privacy review justify them.
- All five native integrations at once, unrestricted public data APIs, compliance archiving without contracts, or certifications represented as code tasks.
- Universal 5,000-person capacity, global high availability, institutional learner identification, K–12 use, or an SLA without independent operational/legal acceptance.

Use original UI, documentation, templates, and assets. Public competitor research is input to product decisions, not permission to copy proprietary code, branding, wording, screenshots, or licensed media.

## Implementation handoff

This document is the proposed planning input. The next development increment is **E00/E01**, not an automatic implementation of every row. Before coding, confirm the target workflows and exact baseline, allocate new schemas/migrations from the current repository, and create small reviewable changes on a new scoped branch. Preserve existing `/v1/quizzes`, immutable artifacts, current sessions, internal compatibility names, accepted receipts, and report readers.

For each epic, create a short acceptance checklist covering contracts, memory/PostgreSQL parity, role projections, UI, documentation, export/deletion/retention, metrics, migration/rollback, and external evidence. Update the implementation ledger only with actual evidence. Keep test results from this future work separate from the source audit that produced this plan.
