# Polling Pops competitive strategy and implementation roadmap

Research date: 2026-09-17

> **Current implementation checkpoint (2026-10-04):** The strategy and competitor claims below keep
> their original research dates. PRs #60–69 have since added gated whole-room flex timing, the first
> Question Health workflow, aggregate Session Decision Replay, bounded text-box placement/resizing
> for Presentations, and owner-only deletion of archived Library content and finished/expired
> session history. These are implemented code slices, not evidence that public rollout or product
> usefulness gates have passed. The remaining frontier is evidence and release readiness, individual
> time accommodations, accessible team delivery, selected response breadth, a browser slide
> companion, and contract-gated institutional services. See the [2026 market research and
> development plan](market-research-and-development-plan-2026-09.md) for current sequencing.

This document uses public product and pricing material as market evidence. It is a product strategy
and delivery plan, not a claim that planned capabilities already exist. Prices, limits, provider
terms, and competitor features must be checked again before a launch or pricing decision.

## Future product ideas

The [future product ideas backlog](future-product-ideas.md) captures product-owner requests and
additional customer enhancement suggestions. Social sign-in, virtual meeting integrations, and
a creator template/theme marketplace were added on 2026-10-13 as deferred ideas. Capturing them
does not schedule implementation or change the delivery gates in this roadmap.

## Implementation update — 2026-09-19

This document records the strategy baseline that led to the Recovery Loop. The merged P0 beta now
implements six response types, confidence, misconception rationale, deterministic intervention and
recheck flows, source-grounded authoring, import/export, cohosting, accountless follow-ups,
workspace history, participant-selected session avatars, the Recovery Rehearsal, and standalone
practice assignment from any published Round. The first P1 authoring slice also adds private
cross-Round question reuse as an independent snapshot with fresh IDs and remapped valid recheck
links; it is not a synchronized question bank. Statements below describing those capabilities as
absent should be read as historical audit findings.

The current product frontier is validating implemented whole-room flex, Question Health, and
Session Decision Replay; closing hosted-capacity and release-readiness evidence; and deciding from
observed need whether to add individual time accommodations, team discussion delivery,
short-text/rank response types, or a browser slide companion. NRPS/AGS remains contract-gated. The
Single-VM beta is gated by deployment, operational, accessibility, security, legal, device, and
design-partner evidence rather than by an unfinished P0 feature epic.

## Current implementation checkpoint — 2026-10-04

Merged PRs #60–69 extend the 2026-09-19 implementation update. Code availability and public
readiness remain separate: several features are default-off or workspace-allowlisted, and their
usefulness and accessibility evidence is still open.

| Shipped code slice                                  | Current boundary                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whole-room flex timing for Rounds and Presentations | No countdown; the facilitator closes the response window. Gated by `FEATURE_LIVE_FLEX_MODE` and workspace allowlisting. Private participant-specific extra-time passes remain deferred.                                                                                                              |
| Question Health advice                              | Deterministic advice, persistent dismiss/reopen, facilitator-approved draft edits with same-revision undo, immutable published-version analysis, and exact-version aggregate post-use observations are implemented. Usefulness and retained-revision thresholds remain unmeasured; rollout is gated. |
| Session Decision Replay                             | New sessions can capture aggregate facilitator-decision events in durable state and show a read-only Report V4 timeline. Older report versions remain readable but have no replay. Rollout and partner-value evidence remain open.                                                                   |
| Bounded Presentation slide editing                  | Text boxes can be placed and resized within a 16:9 slide, with guides, keyboard controls, and an image-safe region. This is not a freeform design canvas, PPTX editor, or slide companion.                                                                                                           |
| Archived content and session deletion               | Workspace owners can confirm permanent deletion of archived Rounds/Presentations and finished or expired session history. Retained sessions and practice assignments block content deletion.                                                                                                         |

## Executive decision

Polling Pops should not position itself as another live quiz platform. That category is mature, and
feature breadth alone would put a small team into a long catch-up race against products with large
content libraries, AI generation, presentation editors, learning-management integrations, and many
interaction types.

The recommended position is:

> **Polling Pops is the open, privacy-preserving live comprehension system that helps a facilitator
> see what did not land, repair it immediately, and verify that understanding recovered.**

The shortest expression of the workflow is **ask → diagnose → intervene → recheck → prove**. It
extends the existing promise, “See what landed while it still matters,” without changing the calm,
guest-first product principles already implemented.

The initial market focus should be higher education and workplace learning sessions with roughly
10–250 participants, especially technical, safety, compliance, certification, and concept-heavy
training. K–12 can continue to use the product, but institutional school sales should remain gated
by child-privacy, contract, roster, and counsel work.

## What Polling Pops has today

The implemented P0 already provides several useful foundations:

- Account-free participant entry by code, link, or QR, with full questions on every device.
- Accuracy/private-result defaults as an alternative to speed and public ranking.
- Immutable quiz versions and server-authoritative deadlines, scoring, and transitions.
- Durable answer acknowledgement, idempotency, reconnect snapshots, and report reconciliation.
- Session-scoped identities, deletion, retention, regional deployment profiles, and self-hosting.
- Apache-2.0 distribution with a production-oriented Compose stack and operational runbooks.

At the original 2026-09-17 audit, the product was narrow in the areas buyers could see most
easily: two question types, no
confidence signal, no in-session remediation workflow, no self-paced follow-up, no content
interchange, no co-facilitation, and no LMS or presentation integration.

## Competitive landscape

The following is a representative comparison, not an exhaustive feature audit. “Emphasis” means
the capability is prominent in the reviewed public material; it does not prove that an unlisted
capability is absent.

| Product               | Publicly emphasized strengths                                                                                                                            | Strategic implication for Polling Pops                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Kahoot!               | Large ready-made library, many question types, AI creation, live and self-paced modes, reports, team play, and presentation content                      | Do not compete on entertainment, marketplace scale, or generic AI generation                                            |
| Wayground             | Up to 100 participants on its starter plan, richer assessments, accommodations, anti-cheating, AI, assignments, and LMS/rostering on institutional plans | Accessibility and flexible checks are table stakes for education; roster-heavy workflows are expensive                  |
| Mentimeter            | Full interactive presentations, 23 slide types, polls, quizzes, word clouds, Q&A, surveys, AI creation, and slide integrations                           | Do not build a general slide editor; make Polling Pops work beside existing slides                                      |
| Slido                 | Anonymous and moderated Q&A, upvoting, polls, quizzes, analytics, and deep meeting/presentation integrations                                             | Lightweight audience voice and co-moderation matter, particularly for workplace and higher education                    |
| Wooclap               | More than 20 learning-oriented activity types, AI-assisted creation, learning-science positioning, analytics, and LMS/presentation integrations          | “Built for learning” alone is not differentiated; the product must own a more specific learning workflow                |
| Vevox                 | Polling, anonymous Q&A, quizzes, attendance, analytics, and presentation/LMS integrations, with 100 participants on the free plan                        | A two-question-type product with a 20-person free limit will look constrained without a stronger outcome story          |
| Poll Everywhere       | Slideware and LMS integration, attendance, reports, unlimited questions, and audience sizes from 40 free to 700 on the entry paid plan                   | Integration and audience capacity are established buying criteria, but both can follow the core wedge                   |
| AhaSlides             | Broad presentation, quiz, poll, word-cloud, Q&A, game, AI, and reporting suite; 50 free education participants                                           | Broad interaction suites are available at low prices, so breadth is not a defensible first strategy                     |
| Particify / ClassQuiz | Open-source or self-hostable alternatives, anonymous participation, polling/Q&A or live quizzes, and privacy/data-control positioning                    | “Open source,” “self-hosted,” or “privacy-friendly” are valuable proof points, but not sufficient differentiation alone |

### Market conclusions

1. **Basic breadth must improve.** Multiple selection, numeric response, an unscored poll/rating,
   and accessible time controls are more important than adding cosmetic game modes.
2. **AI generation is already commoditized.** It should be a later, source-grounded authoring aid,
   not the product thesis.
3. **Self-hosting is a trust and distribution advantage, not the whole product.** Particify,
   ClassQuiz, and other open projects already occupy that claim.
4. **Reliability is necessary but mostly invisible.** Durable receipts and recovery should be made
   legible to buyers, while the product's visible value comes from better facilitation decisions.
5. **The whitespace is the closed loop.** Competitors prominently help a facilitator ask,
   entertain, poll, or report. The reviewed public material does not make an immediate,
   measurable comprehension-recovery workflow its primary product promise.

This last point is a positioning inference from public material, not a claim that competitors
cannot repeat questions or support formative practice.

## The differentiated product: Polling Pops Recovery Loop

### Core workflow

1. **Ask:** run a diagnostic checkpoint on every participant device.
2. **Diagnose:** after locking, show correctness, response distribution, confidence, and authored
   misconception signals without identifying participants publicly.
3. **Intervene:** recommend deterministic facilitator actions such as explain, show an example,
   discuss with a peer, or continue.
4. **Recheck:** launch a linked checkpoint that tests the same concept. Rechecks are unscored by
   default so learning is not confused with leaderboard optimization.
5. **Prove:** report initial understanding, recovered understanding, unresolved confusion, and the
   intervention used.

Peer discussion followed by another concept question is supported by classroom research: the
reported improvement transferred to a similar follow-up question rather than merely reflecting
copying. Retrieval and corrective feedback research also supports treating questions as part of
learning, not only measurement. Polling Pops should operationalize that loop while avoiding claims
that one software interaction proves durable learning.

### Diagnostic signals

- **Correctness × confidence:** distinguish secure understanding, uncertain understanding,
  productive uncertainty, and high-confidence misconception.
- **Distractor rationale:** an author may privately label why a wrong choice is tempting. The host
  sees aggregate misconception labels after lock; the participant can receive choice-specific
  feedback after reveal.
- **Response shape:** identify split decisions, low participation, slow response, and unexpectedly
  broad numeric answers.
- **Participant reflection:** optionally ask a constrained follow-up such as “between two choices,”
  “term was unclear,” “need an example,” or “guessed.” Start with fixed choices to avoid open-text
  moderation and sensitive-data collection.

### Facilitator action cards

Action cards must be deterministic, explain why they appeared, and remain suggestions. Examples:

| Signal                                                                | Suggested action                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| At least 80% correct and median confidence high                       | Continue                                                            |
| Correctness high but confidence low                                   | Reinforce why the answer is correct, then continue                  |
| Responses split between the correct choice and one labeled distractor | Explain that misconception or run peer discussion                   |
| Correctness low but confidence mixed                                  | Show an example, then launch the linked recheck                     |
| High-confidence wrong responses are material                          | Address the misconception before revealing or rechecking            |
| Participation is low                                                  | Extend time, check connectivity, or ask whether the prompt is clear |

Thresholds must be workspace-configurable later, but the first release should use documented,
tested defaults. Recommendations must never be generated from demographic or cross-session learner
profiles.

## Strategy backlog and current disposition

The priority labels preserve the original 2026-09-17 strategy order. The current status column
prevents already-shipped work from reading as pending implementation.

| Original priority     | Capability                                                                                                                                                     | Current status                           | Remaining boundary or next decision                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Now                   | Confidence, misconception labels, linked rechecks, interventions, and recovery reports                                                                         | Implemented                              | Validate comprehension, accessibility, and evidence quality with facilitators.                                                         |
| Now                   | Multi-select, numeric, rating, and poll responses                                                                                                              | Implemented                              | Add exact-match short text or rank/order only if observed sessions establish demand.                                                   |
| Next                  | Cohost role and handoff                                                                                                                                        | Implemented                              | Complete cofacilitation usability and hosted rollout evidence.                                                                         |
| Next                  | Bulk paste, CSV/QTI import/export, folders, tags, and reusable checkpoint sets                                                                                 | Implemented                              | Reuse creates independent snapshots; a versioned Recovery Pack with update review remains a candidate.                                 |
| Next                  | Whole-room flex timing                                                                                                                                         | Implemented behind a feature gate        | Validate the no-countdown, facilitator-closed flow. Individual time passes remain deferred for privacy, fairness, and reveal research. |
| Next                  | Signed self-paced follow-up links and standalone assignments                                                                                                   | Implemented                              | Validate hosted use and retention; do not imply learner accounts or gradebook semantics.                                               |
| Now, evidence pending | Question Health advice and Session Decision Replay                                                                                                             | Implemented as bounded, gated slices     | Measure advice usefulness, accepted revisions, report comprehension, and whether the replay changes facilitator decisions.             |
| Later                 | LTI 1.3 Advantage, institutional SSO/SCIM, and optional roster/grade passback                                                                                  | Foundations only                         | Contract, privacy, certification, and named-pilot gates remain.                                                                        |
| Later                 | Browser slide companion                                                                                                                                        | Not implemented as a production workflow | Prototype only if observed deck use and context-switching meet the evidence gate.                                                      |
| Defer                 | Full freeform slide editor, public content marketplace, persistent avatar/reward profiles, native apps, generic chat assistant, and 1,000-player single events | Deliberate non-goals                     | Bounded text-box placement is implemented; broader design tools do not strengthen the recovery thesis.                                 |

## Technical design

### Content contracts

Replace the choice-only assumption with a discriminated response model while retaining current
question IDs and immutable versioning:

```text
question.type = single_select | multi_select | numeric | rating | poll
question.purpose = diagnostic | practice | opinion
question.conceptKeys[]
question.confidence = off | optional | required
question.linkedRecheckQuestionId?

choice.isCorrect?
choice.feedback?
choice.misconceptionKey?
```

Opinion items have no correct answer and never affect score. Numeric items define exact or ranged
acceptance. A recovery metric is separate from game score, and a linked recheck is unscored unless
the author explicitly changes it before publication.

### Durable data model

Use expand-and-contract migrations:

- Add a typed `response_payload` JSON column and response schema version to answers; backfill
  existing `choice_id` data before eventually making `choice_id` optional.
- Add `confidence` with a small bounded scale and keep it nullable.
- Add `parent_round_id`, `round_purpose`, and `intervention_id` to question rounds.
- Add append-only `session_interventions` containing type, source round, facilitator, timestamps,
  and optional linked recheck round.
- Add concept and misconception metadata inside immutable quiz-version content first; normalize
  only if reporting queries demonstrate a need.
- Version report metrics so old sessions remain readable and exports remain reproducible.

No migration may rewrite a published quiz version or change the result of a completed session.

### Game and realtime protocol

- Keep `answer.submit` for compatibility and add a schema-versioned response payload rather than
  introducing parallel correctness paths.
- Add idempotent host commands for `intervention.start`, `intervention.finish`, and
  `recheck.open`, all guarded by `commandId` and `expectedVersion`.
- Add role-filtered events for `checkpoint.insight`, `intervention.updated`, and `recheck.open`.
- Never emit correctness, misconception labels, or aggregate distributions while a diagnostic
  checkpoint remains open.
- Persist response and canonical session state before acknowledgement, exactly as for P0 answers.
- Reconnect must restore intervention and recheck state from the authoritative snapshot.

### Insights engine

Implement the first insights engine as a pure deterministic package beside the game engine. Its
inputs are the published item metadata plus aggregate accepted responses; its outputs are signal
codes, supporting measurements, and candidate action cards. It must have property tests for empty,
partial, tied, low-participation, and adversarial response sets.

Do not use an LLM in the live decision path. A later AI helper may draft authored content, but
live recommendations must remain fast, explainable, testable, and available to self-hosters.

### Privacy and accessibility

- Confidence and reflection are session-scoped learning data and follow the session's deletion
  deadline.
- Reports default to aggregates; participant rows continue to use ephemeral aliases unless the
  operator has an approved identified workflow.
- Participant-specific feedback is projected only to that participant and the authorized host.
- Whole-room time-flex keeps checkpoints host-locked instead of pressuring participants with a
  speed countdown. The gated implementation is available for Rounds and Presentations. A later
  signed accommodation pass may alter an individual's deadline without creating an account, but
  reveal timing, fairness, privacy, and usability still require a separate decision.
- Every new response type must pass keyboard, screen-reader, zoom, contrast, reduced-motion, touch,
  and no-shared-display acceptance under WCAG 2.2 AA.

### Interoperability

- Start with documented CSV and Polling Pops JSON import/export.
- Add a constrained QTI 3 import/export profile for supported item types; produce a validation
  report instead of silently dropping unsupported content.
- Treat LTI 1.3 Advantage as an institutional phase, with certification and security review as
  release gates.

## Phased implementation plan

The following is the original schedule, not the current implementation queue. It assumed one
full-time engineer plus fractional product/design, accessibility, security, and research support;
the separate single-VM production-readiness gates still apply.

| Phase                           |      Timing | Scope                                                                                                                                                                                           | Exit gate                                                                                                                                                                            |
| ------------------------------- | ----------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0 — Validate the wedge          |   Weeks 1–2 | Interview at least six higher-education instructors and six workplace facilitators; prototype confidence, action cards, and recheck; measure current workflow and willingness to switch         | At least eight interviewees report a recurring “what do I do after the result?” problem, six agree to a pilot, and both segments can complete the prototype without product coaching |
| 1 — General response foundation |   Weeks 3–5 | Add response schema versioning, expand-and-contract answer migration, multi-select, numeric, rating/poll, confidence, contract compatibility, editor/preview/report fallbacks                   | Existing sessions and exports are unchanged; all response types pass engine, PostgreSQL, API, browser, accessibility, and migration rollback/forward-repair tests                    |
| 2 — Recovery Loop MVP           |   Weeks 6–9 | Add concept keys, distractor rationale, linked rechecks, deterministic insights, action cards, intervention commands, discussion timer, role-filtered events, and reconnect behavior            | A 100-participant scripted session completes diagnosis, intervention, and recheck through a process restart with no duplicate effects, answer leakage, or report mismatch            |
| 3 — Recovery evidence           | Weeks 10–12 | Add initial/recheck pairing, correctness-confidence matrix, recovery/unresolved metrics, intervention timeline, participant-private feedback, facilitator notes, and versioned CSV/JSON exports | Report values reconcile exactly with durable responses; a facilitator can identify what changed and what remains unresolved in under two minutes                                     |
| 4 — Adoption and portability    | Weeks 13–16 | Add co-facilitator role, folders/tags, bulk paste, CSV import/export, constrained QTI profile, reusable checkpoint sets, and duplicate-from-report workflow                                     | Two facilitators can hand off safely; imports round-trip supported content without loss and clearly report unsupported fields                                                        |
| 5 — Follow-up and access        | Weeks 17–20 | Add signed self-paced follow-up links, time-flex live mode, account-free accommodation prototype, expiry/deletion controls, and recovery comparison across the live/follow-up pair              | No participant account is created; expiration and deletion cascade correctly; manual assistive-technology and representative-device tests pass                                       |
| 6 — Institutional option        | Weeks 21–28 | Pilot LTI 1.3 launch/deep linking, optional assignment/grade services, institutional SSO, admin policy controls, residency selection, audit/export, contracts, and support procedures           | 1EdTech conformance target, threat model, independent accessibility/security review, DPA/legal approval, and two named institutional pilots pass before general availability         |

### Phase sequencing rules

- Do not begin Phase 2 until the response migration has compatibility coverage against real P0
  data.
- Do not add open text or public Q&A until moderation, retention, abuse reporting, and export rules
  are designed.
- Do not promise a 250-participant hosted plan until target-region load, rolling-process-loss, and
  managed Redis failover evidence pass.
- Do not enable identified institutional reporting or grade passback until contracts, access
  controls, deletion semantics, and audit behavior are approved.
- Each phase must preserve community mode and must not put the recovery engine behind a software
  license gate.

## Quality and release plan

Add the following to the existing test suite:

- Contract fixtures for every response schema version and old-client/new-server combinations.
- Property tests for multi-select normalization, numeric boundaries, confidence values, linked
  cycles, arbitrary intervention sequences, and report reconciliation.
- PostgreSQL tests for migration backfill, immutable published metadata, response idempotency,
  intervention uniqueness, RLS, retention, and deletion.
- Browser journeys for confidence, alternate response types, discussion/recheck, reconnect,
  co-facilitator conflict, imports, and accessible time-flex behavior.
- Load profiles containing mixed response types and an intervention/recheck cycle, preserving the
  existing acknowledgement, broadcast, recovery, and report thresholds.
- Security tests for hidden misconception metadata, unauthorized insight access, malicious import
  archives, formula/CSV injection, replayed co-host commands, and follow-up-link enumeration.

Release the work incrementally rather than waiting for the entire roadmap:

- `v1.1 Signal`: Phase 1 response types and confidence.
- `v1.2 Recover`: Phase 2 live recovery loop.
- `v1.3 Evidence`: Phase 3 recovery reporting.
- `v1.4 Portable`: Phase 4 collaboration and content interchange.
- `v1.5 Follow-up`: Phase 5 self-paced recovery and access work.

## Product and business metrics

### Primary outcome

**Recovery rate** = participants who were incorrect on an initial diagnostic and correct on its
linked recheck, divided by participants who answered both and were initially incorrect.

This is a session-level product metric, not proof of long-term learning. Report both numerator and
denominator, and do not compare facilitators or participants without sufficient context.

### Supporting metrics

- Percentage of sessions containing a linked recheck.
- Percentage of flagged checkpoints followed by a facilitator intervention.
- Time from lock to visible insight, target p95 below one second at the supported ceiling.
- Unresolved misconception rate after recheck.
- Answer acknowledgement and report-reconciliation reliability, preserving current SLOs.
- Four-week repeat use by facilitators and checkpoint-set reuse.
- Import completion rate and unsupported-item rate.
- Participant join/reconnect completion and accessibility defects by workflow.
- Data deletion backlog and follow-up-link expiry correctness.

Avoid optimizing time-on-product, question count, or leaderboard activity as primary success
metrics; they do not establish that the facilitator made a better decision.

## Packaging and pricing hypothesis

The current hosted Free limit of 20 participants is below the reviewed free offers of roughly
40–100 participants. The current 100-participant Pro ceiling also competes with entry plans that
often support hundreds or more while offering much broader interaction suites.

Recommended packaging after cost and target-region validation:

- **Community:** Apache-2.0, recovery engine included, billing disabled, operator-configured limits,
  and no artificial feature lock. Infrastructure and support remain the operator's responsibility.
- **Hosted Free:** target 50 participants, five published checkpoint sets, core Recovery Loop,
  aggregate reports, and 30-day retention. Keep the current 20-person pilot limit until hosted
  capacity and unit cost are measured.
- **Hosted Pro:** target 250 participants, unlimited checkpoint sets, co-facilitation, exports,
  branding, and 365-day retention. Validate a USD 12–15 monthly annual-billing range rather than
  assuming the current hypothesis is accepted.
- **Institution:** SSO/LTI, policy controls, selected region, contractual retention, audit/admin
  reporting, support, and an availability commitment; quote-based after pilot evidence.

Price discovery must test the value of faster remediation and evidence, not merely audience size.

## Key risks and controls

| Risk                                               | Control                                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Feature-parity scope overwhelms one engineer       | Protect the recovery workflow; require direct evidence before adding a suite feature                              |
| New response model breaks P0 answers or reports    | Expand-and-contract migration, schema versions, immutable fixtures, and dual-read compatibility                   |
| Recovery rate is mistaken for lasting learning     | Use careful language and recommend delayed follow-up when retention matters                                       |
| Confidence prompts add friction                    | Make them optional by item and measure completion/time impact                                                     |
| Open responses collect sensitive or abusive text   | Begin with fixed reflection choices and defer open text until moderation exists                                   |
| Anonymous participation conflicts with LMS grading | Keep guest mode as default; make identified institutional mode explicit, isolated, and contract-gated             |
| AI produces incorrect assessment content           | Keep AI out of live decisions; later require source citations, editable drafts, evaluation, and human publication |
| Free hosted usage becomes uneconomic               | Raise limits only after per-session cost, concurrency, abuse, and support measurements                            |

## Research sources

Competitor product and plan material:

- [Kahoot! school features and plans](https://kahoot.com/schools/plans/) and
  [school workflow](https://kahoot.com/schools/how-it-works/)
- [Wayground plan comparison](https://help.wayground.com/support/solutions/articles/158000403874-understanding-wayground-plans),
  [pricing](https://wayground.com/super-pricing), and
  [accommodations](https://help.wayground.com/support/solutions/articles/158000404955-accommodations-available-on-wayground)
- [Mentimeter features](https://www.mentimeter.com/features) and
  [plans](https://www.mentimeter.com/plans)
- [Slido product](https://www.slido.com/product),
  [live Q&A](https://www.slido.com/features-live-qa), and
  [education workflow](https://www.slido.com/education)
- [Wooclap features](https://www.wooclap.com/en/features/) and
  [pricing explanation](https://docs.wooclap.com/en/articles/14402104-what-is-wooclap-s-pricing)
- [Vevox features](https://www.vevox.com/features),
  [integrations](https://www.vevox.com/features/integrations), and
  [education plans](https://www.vevox.com/pricing/education-pricing)
- [Poll Everywhere plans](https://www.polleverywhere.com/plans) and
  [higher-education workflow](https://www.polleverywhere.com/higher-ed)
- [AhaSlides features](https://ahaslides.com/features/) and
  [education plans](https://ahaslides.com/edu-plan/)
- [Particify features](https://www.particify.de/en/features/),
  [open-source/privacy help](https://www.particify.de/en/help/), and
  [ClassQuiz self-hosting](https://www.classquiz.de/docs/self-host)

Learning and interoperability references:

- [Smith et al., peer discussion and concept-question performance](https://pubmed.ncbi.nlm.nih.gov/19119232/)
- [Testing, retrieval practice, and feedback literature review](https://pubmed.ncbi.nlm.nih.gov/29929801/)
- [Confidence judgments in real classroom tests](https://pubmed.ncbi.nlm.nih.gov/22029451/)
- [1EdTech QTI specification](https://www.1edtech.org/standards/qti/index)
- [1EdTech LTI Advantage implementation guide](https://standards.1edtech.org/lti/guides/implementation_guide/implementation-guide)
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
