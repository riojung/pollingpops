# Polling Pops competitor research: October 27, 2026

Research date: **2026-10-27**. Repository baseline: `main` at **`948d515`**.
Scope: higher education and workplace learning, with adjacent meeting and presentation workflows.
The resulting [prioritized backlog](competitor-backlog-2026-10-27.md) is a discovery and delivery
candidate set, not a commitment to implement every competitor capability.

## Decision

Polling Pops should make its complete comprehension recovery chain easier to use and substantiate:
**ask → diagnose → explain or discuss → different linked recheck → optional delayed check → evidence**.
This is an opportunity to prove through customer use. Confidence, peer instruction, AI follow-ups,
anonymous participation, self-paced activities and before/after charts are individually established
competitor capabilities. We found no basis for claiming this combination is impossible elsewhere.

Keep the existing constraint: validate the current product, then select **one observed workflow
blocker and one differentiated bet** through the [existing evidence gates](market-research-and-development-plan-2026-09.md).
No new Polling Pops interviews, production observations or willingness-to-pay evidence were collected.
The [Phase 0 research and independent-review decisions](evidence/phase0-stage-decision.md) remain pending;
this desk research does not select a segment or Phase 1 branch or accept a release gate.

## How to read the evidence

| Label                                 | Meaning                                             | Limit                                                                   |
| ------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| **M — Market capability**             | Current first-party product/help/release material   | Establishes a documented offering, not independent quality or adoption  |
| **D — Direct request**                | An identifiable public request by a competitor user | A real reported problem; not Polling Pops demand or market prevalence   |
| **S — Sector/institutional evidence** | Research published by an institution or sector body | Applies to its sample and setting, not automatically to our customers   |
| **H — Hypothesis**                    | Our proposed product response or differentiation    | Requires observed Polling Pops use and the existing decision thresholds |

Pages were checked on the research date. Explicit publication/update dates are recorded below;
undated pages are current observations, not evidence of when a feature launched. The editable-PPTX page returned October 15 and October 27 variants during review; its final visible date is recorded without inferring launch timing. Forum relative
timestamps can reflect different crawl dates, so use their absolute dates. Plan, tenant, provider
and rollout restrictions still apply. Prices and packaging were not evaluated for a pricing proposal.

## Reconciled Polling Pops baseline

These findings supersede stale capability rows in the September market plan and October 9 Slido
inventory; those documents retain their historical research dates. This is a source audit, not a new
full test run or proof that a hosted customer rollout is enabled.

| Area                   | Implemented baseline at `948d515`                                                                                                          | Remaining boundary                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Round responses        | Nine registry types: single select, true/false, multi-select, numeric, rating, poll, ranking, open text and word cloud                     | Types and delivery surfaces have different semantics; nine registry types do not mean universal parity |
| IDEA-004               | Live Round multiple-selection opinion polls, ranking, moderated open text and word clouds                                                  | Presentation/Survey expansion remains deferred; writer gates apply                                     |
| IDEA-005               | Aggregate summaries, tagged selectable PDF, PNG, native XLSX and expiring, revocable links for supported Rounds, Presentations and Surveys | Google Sheets delivery remains deferred; rollout and external acceptance remain separate               |
| IDEA-006               | Moderated boards, manual groups, frozen final ballots; scanned images, sketches and link cards                                             | Rich boards are implemented; AI grouping and a public marketplace are separate proposals               |
| Existing-deck delivery | Browser Companion, text-only Pack insertion/playback, published Round-question insertion and bounded Quick Check                           | Media-backed insertion and native slide/meeting integrations remain separate work                      |
| Learning follow-up     | Accountless practice, report-derived follow-ups and Pack delayed-probe assignments                                                         | Multi-stage Recovery Trails and privacy-safe Concept Health remain unimplemented                       |

Sources: [question registry](../packages/contracts/src/index.ts), [implementation status](implementation-status.md),
[IDEA-004 plan](idea-004-response-formats-plan.md), [IDEA-005 plan](idea-005-session-summaries-plan.md),
[IDEA-006 plan](idea-006-brainstorming-boards-plan.md), and [release ledger](release-readiness.json).
Room readiness and connected/answered counts also exist. Question Health already aggregates exact-version post-use reports by trust, timing and scoring, with at least twenty responses per eligible session ([implementation](../apps/server/src/question-health-post-use.ts)). Do not create new epics for an existing board, practice engine, summary exporter, health strip, aggregation engine or browser Companion.

## Current competitor capabilities

| Product         | Verified capability and date caveat (**M**)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Consequence for Polling Pops (**H**)                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wooclap         | [Peer learning](https://www.wooclap.com/en/peer-learning/) explicitly connects first votes, discussion and comparison. [AI live facilitation](https://www.wooclap.com/en/ai-live-facilitator/) organizes answers, summarizes and generates follow-up MCQs; its FAQ says agents are manually triggered and require Pro or an organization AI subscription. Pages have no reliable launch date.                                                                                                                                                                                                                                                                                   | Sell the quality and traceability of a complete recovery workflow; generic peer discussion or AI follow-up generation is insufficient differentiation.                                                 |
| iClicker        | [Analytics](https://www.iclicker.com/analytics) covers confidence, pre/post assignments and performance. [Confidence documentation](https://www.macmillanlearning.com/us/explore/higher-ed/ref/institutional-solutions-blog/gauge-your-students-confidence-in-iclicker-polling-responses/ba-p/16312) dates to January 26, 2022 and describes anonymized confidence aggregates. [Current product material](https://www.iclicker.com/) documents LMS roster/grade sync.                                                                                                                                                                                                           | Preserve accountless recovery and honest evidence limits; confidence and follow-up alone are established expectations.                                                                                 |
| Vevox           | [Comparison help](https://help.vevox.com/hc/en-us/articles/22996157485213-Create-before-and-after-comparisons), updated June 19, 2026, requires Pro+, matching multichoice titles/options and Present view. Comparison images do not appear on participant devices or in reports. Raw results remain exportable.                                                                                                                                                                                                                                                                                                                                                                | Different linked questions and portable, bounded recovery evidence are a concrete workflow contrast, not proof of unique learning effectiveness.                                                       |
| Slido           | [Product catalog](https://www.slido.com/product) documents five poll types, live quizzes, Q&A, surveys and analytics. [Integration catalog](https://www.slido.com/features-integrations) documents existing-slide and meeting workflows. Capabilities depend on configuration and plan.                                                                                                                                                                                                                                                                                                                                                                                         | Finish everyday workflow fit using existing Pops foundations before pursuing every integration or event-scale limit.                                                                                   |
| Mentimeter      | [September 2026 updates](https://mentimeter.canny.io/changelog/product-updates-september-2026) introduce Live/Form/Pulse, recurring anonymous check-ins and an Enterprise/contact-enabled daily JSON Export API. [Compare slides](https://help.mentimeter.com/en/articles/15566318-how-to-compare-two-slides-side-by-side-before-after-results-with-a-compare-slide) work on all plans within one presentation, exclude Quiz slides and remain live. [April updates](https://mentimeter.canny.io/changelog/product-updates-april-2026) document text-based, screen-reader-accessible PDF exports for paid plans. These are documented offerings, not hands-on quality findings. | Recurring checks, comparisons and accessible exports are established expectations. Differentiate source/version binding, interpretation and privacy; content-language choice is a separate hypothesis. |
| Poll Everywhere | Current 2.0 [report views](https://support.polleverywhere.com/pe2/creating-a-report-view-) span dates/questions, saved filters, CSV/Excel and background snapshots retained for 30 days. [Response links](https://support.polleverywhere.com/pe2/using-response-links-surveys-and-asynchronous-polls) support scheduled asynchronous participation; attendance and leaderboards are excluded and audience limits apply.                                                                                                                                                                                                                                                         | Cross-session analysis and self-paced links are established. Differentiate evidence interpretation, not merely exporting or sharing a link.                                                            |
| AhaSlides       | [Courses announcement](https://community.ahaslides.com/t/ahaslides-now-does-elearning-introducing-courses/281), October 15, 2026, adds self-paced lessons, knowledge checks, completion rules and learner reports; learners log in/sign up. [Editable PPTX import](https://ahaslides.com/blog/editable-powerpoint-import/), page dated October 27, 2026 at final review, is Beta on all plans; complex elements may become images.                                                                                                                                                                                                                                              | Validate guest-first follow-up and existing-deck fit; avoid turning Pops into a course platform or full slide editor. Announced functionality was not hands-on tested.                                 |
| Wayground       | [Accommodations guide](https://help.wayground.com/support/solutions/articles/158000404955-accommodations-available-on-wayground), updated May 20, 2026, documents extra time, read aloud, extended deadlines, translation and reduced choices, with activity-specific support.                                                                                                                                                                                                                                                                                                                                                                                                  | Private accommodations and multilingual content need discovery; whole-room flex and ten interface locales do not establish equivalent support.                                                         |

Accessibility is also an active competitor practice: [Wooclap](https://www.wooclap.com/en/accessibility/)
documents screen-reader support and participant pacing; [Vevox](https://www.vevox.com/accessibility)
publishes a conformance report and known limitations. Neither is evidence that every interaction
is accessible. Polling Pops needs manual assistive-technology and real-device evidence for its own flows.

## Direct customer-demand registry

Each request is a signal to validate. Counts/upvotes are intentionally not treated as market share,
willingness to pay, or an ordered backlog score. Older requests do not establish a current product gap.

| Evidence                                                                                                                                                            | Absolute date and reported problem (**D**)                                                                                                                    | Backlog interpretation (**H**)                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — [Participant-selected content language](https://mentimeter.canny.io/feature-requests/p/more-than-one-language-at-a-time)                                       | February 10, 2020 request, with January 11, 2026 support comment: one multilingual audience should choose content language on each device.                    | Discover human-approved translated question variants with one semantic identity and honest aggregation; interface localization is already present.  |
| D2 — [Compare retained session results](https://mentimeter.canny.io/feature-requests/p/compare-results-across-sessions-after-clear-results)                         | October 28, 2025: requester wants visual cross-session comparison rather than manual Excel analysis after clearing results.                                   | Extend IDEA-008 through version/concept-bound aggregate comparisons; do not infer individual learning or merge incompatible cohorts.                |
| D3 — [Google Sheets result delivery](https://mentimeter.canny.io/feature-requests/p/google-sheet-integration-for-results)                                           | October 11, 2019; later comment August 25, 2021: trainer wants results to feed client reporting. This is stale corroboration.                                 | IDEA-005 already supplies XLSX. Revalidate current demand before a scoped Sheets connector; do not claim a new general export gap.                  |
| D4 — [Run the same presentation for another group](https://community.slido.com/ideas/clear-voting-results-as-the-presentation-ends-8622)                            | September 28, 2026: lecturer requests automatic save/reset. September 29 support reply offers bulk manual reset; requester accepts the workaround.            | Validate a discoverable new-session action that preserves prior reports. Demand for automation is weaker than demand for a clean new group.         |
| D5 — [Categories into ranking](https://community.slido.com/ideas/using-categorize-results-from-an-idea-slide-to-prepopulate-a-ranking-slide-for-those-results-8590) | September 18, 2026: user wants categorized ideas to become ranking choices directly.                                                                          | Existing Pops grouping/final ballots overlap. Test their transition before proposing automation or a new board feature.                             |
| D6 — [Self-guided safety quiz](https://community.slido.com/ideas/self-guided-quiz-8720)                                                                             | October 22, 2026: multi-site safety event needs independent completion with answer feedback. Support merged the idea October 23.                              | Existing practice answers much of the job. Validate discovery, templates and optional delayed checks; no new asynchronous engine is justified.      |
| D7 — [Self-service report generation](https://community.slido.com/ideas/remove-the-report-download-restriction-for-large-slido-events-8695)                         | October 15, 2026: a user reports support-dependent large-event exports and asks for processing/ready/download states. The reported restriction is unverified. | Audit existing Pops jobs for visible progress, failure/retry and expiry at the intended room size. This does not justify conference-scale capacity. |

Related usability corroboration: a September 16, 2026 [explanation-slide request](https://community.slido.com/ideas/post-answer-slide-8577)
supports testing the discoverability of Pops' existing explanation → linked recheck flow. An October
12 [waiting-message request](https://community.slido.com/ideas/participants-logged-before-the-host-starts-the-poll-8679)
supports auditing lobby guidance. These are existing-feature validation tasks before new feature epics.

## Broader customer context

**S — Access and resilience:** Jisc's [2025/26 UK higher-education student report](https://repository.jisc.ac.uk/10586/1/DEI-2026-student-he-report.pdf)
covers 13,101 respondents across 20 organizations; 59% reported Wi-Fi difficulties and 39% lacked a
suitable device at some point. Jisc's [July 2, 2026 reflection](https://analytics.jiscinvolve.org/wp/2026/07/02/a-decade-of-digital-insights-reflecting-on-progress-and-looking-to-future-digital-experiences/)
also reports those percentages. This is UK sector context, not a Polling Pops failure rate or a
Canadian/workplace estimate. It supports testing visible save receipts, reconnect and access options;
it does not itself select the Access branch or justify claiming offline participation.

**S — Anonymity with moderation:** the University of York's [Mentimeter evaluation guidance](https://vle-support.york.ac.uk/other-tools/mentimeter/anonymity/)
describes a January 2026 survey of 599 undergraduates across five subject areas. Students valued
anonymity; the institution also warns about inappropriate open responses. This supports preserving
guest privacy alongside moderation and clear disclosure. It is institutional evidence, not proof that
every customer wants organizer-blind anonymity or that anonymity is unique to Polling Pops.

## Product implications and selection discipline

1. **Validate what exists.** Observe first-time hosts joining, explaining, rechecking, rerunning a
   session, sharing evidence and moving board ideas into final ballots. Record a failure before
   turning an existing but hard-to-find capability into another implementation epic.
2. **Select one workflow blocker.** Candidate work includes surface parity, a specific Companion
   interruption, private timing support or content-language choice. Apply the existing ordered
   research gates and choose based on observed exclusions and repeated workflows.
3. **Select one differentiated bet.** Extend IDEA-008 toward opt-in delayed checks and concept-bound
   aggregate evidence only after validating value, access and privacy. Preserve version identity,
   paired/unpaired denominators, attrition and small-sample limits; report association, not causality.
4. **Preserve scope.** Native slide integrations, Sheets delivery and source/media insertion must
   extend IDEA-007, IDEA-005 and the Companion respectively. Social sign-in, meeting integrations
   and marketplace ideas retain their existing IDs and deferred state.

The [detailed backlog](competitor-backlog-2026-10-27.md) records acceptance criteria, dependencies,
demand confidence, measures and discovery gates. No delivery dates, customer validation results,
release readiness or pricing changes are implied by this research.
