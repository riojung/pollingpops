# Polling Pops market research and evidence-led development plan

Research date: 2026-09-23
Committed horizon: 24 weeks with one full-time engineer plus fractional product, design,
accessibility, security, operations, and research support
Option horizon: six to twelve months, released only through the evidence gates below

This document updates the **priority order** in the earlier competitive and UX plans. It does not
replace their historical analysis, implementation detail, or release-readiness gates. Prices,
limits, and competitor capabilities change frequently and must be rechecked before a public claim
or packaging decision.

## Executive decision

Polling Pops should not enter a quiz-feature, game-mode, AI-generation, or slide-editor arms race. The
reviewed market is already crowded with polished products that are broader, better known, and more
deeply integrated than a small team can quickly match.

Polling Pops should instead own a narrower and more valuable job:

> **Turn visible confusion into an explainable action, verify whether understanding changed on a
> different question, and preserve honest evidence of what happened—without requiring participant
> accounts.**

The existing **Ask → Diagnose → Intervene → Recheck → Prove** loop is the right foundation, but the
market has moved. Confidence, peer discussion, repeated polling, and follow-up questions are not
individually unique. The defensible product is the complete chain:

1. An initial response and confidence signal.
2. A source-supported misconception diagnosis.
3. A facilitator-selected intervention or structured discussion.
4. A linked, meaningfully different immediate recheck.
5. An optional delayed transfer or retention check.
6. A privacy-preserving evidence trail with its limits visible.

The next roadmap should therefore run two tightly connected lanes:

- **Workflow fit:** validate reliable rooms and the implemented whole-room access mode; consider an
  existing-slide companion and additional response types only when observed workflows justify them.
- **Evidence depth:** the bounded Question Health workflow and aggregate Session Decision Replay
  are implemented behind rollout gates. Validate advice quality, retained revisions, report
  comprehension, and decision impact before expanding them; versioned Recovery Packs, delayed
  Recovery Trails, and Concept Health remain future candidates with explicit evidence boundaries.

With one full-time engineer, these are not two simultaneous feature trains. The 24-week commitment
is release readiness plus **one observed table-stakes blocker** and **one differentiated bet**. The
remaining items are gated options, not promises disguised as a roadmap.

Before either lane expands, the team must finish the current beta evidence. Polling Pops’ largest
known gap is not another feature epic: it is the absence of observed design-partner, accessibility,
security, hosted-capacity, operational, and willingness-to-pay evidence.

## Research scope and confidence

No bounded review can verify every product in a changing global market. This research instead
covered 26 representative products across live response, formative assessment, interactive
presentations, game-based review, self-study, open-source, and low-connectivity categories. It
combined:

- a repository and implementation audit;
- current first-party product, help, integration, and pricing material;
- current review-aggregator and practitioner discussions for recurring pain patterns;
- learning-science and training-evaluation research; and
- the earlier Polling Pops competitive and UX research.

Evidence is used at three confidence levels:

| Level | Meaning                                                                               |
| ----- | ------------------------------------------------------------------------------------- |
| A     | Implemented repository behavior or current first-party product documentation          |
| B     | Repeated review/community pattern or peer-reviewed research                           |
| C     | Product inference or hypothesis that still requires Polling Pops customer observation |

This work did **not** conduct new customer interviews, observe a production Polling Pops session, or
establish willingness to pay. Review sites have selection bias, vendor pages are marketing
material, and learning studies do not prove a particular product implementation will work. The
roadmap treats those limits as gates rather than footnotes.

## Current Polling Pops baseline

**Implementation snapshot reconciled 2026-10-07:** the repository status below is aligned with
`main` at `aa033c8` (including merged Pack portability PR #89), plus the source-assisted Pack
authoring increment on this implementation branch.
The research date at the top of this document describes the
market-source review and has not been refreshed; it is not the date of this implementation audit.

Polling Pops is already much more than a happy-path quiz application. The audited repository includes:

- six response types, confidence, concepts, misconception labels, private feedback, linked
  rechecks, deterministic insights, and intervention tracking;
- accountless joining by code, link, or QR, durable answer acknowledgement, reconnect, pause/resume,
  cohosting, presenter credentials, and server-authoritative state;
- live Rounds plus accountless self-paced practice and report-derived follow-ups;
- moderated Q&A, Audience Pulse, disabled-by-default chat, reporting, moderation, and privacy
  thresholds;
- source-grounded authoring from text/PDF/DOCX/PPTX with citations and mandatory human review;
- JSON, CSV, bulk, and constrained QTI portability plus private cross-Round snapshot reuse;
- structured interactive Presentations, Groups, Discover, a professional workspace shell, and ten
  interface locales behind gated beta rollouts;
- creator OIDC and LTI launch/Deep Linking foundations; and
- strong local correctness, security, accessibility-automation, recovery, load, backup, and
  observability harnesses.

The current constraints matter more than the feature count:

| Boundary                 | Current reality                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public readiness         | October 21 engineering revalidation reopens source CI and local production smoke after failing current-main runs. All fifteen release-readiness gates are pending; the thirteen external or human-evidence gates remain unchanged. September passes remain historical evidence. See the [catchup record](evidence/recent-changes-catchup.md).                                                                                                                                         |
| Rollout                  | Home, Library, Sessions and Results navigation defaults on for every plan, subject to explicit Admin policy. Builder, Presentation, Group, Discover, rehearsal, practice, live-flex, Question Health, Session Decision Replay and Recovery Pack capabilities retain their applicable gates or workspace allowlists. Repository presence does not mean general availability.                                                                                                           |
| Presentation delivery    | Live Presentations have server-authoritative realtime synchronization, acknowledgement/reconnect handling, role-filtered projections, and report reconciliation. The older polling-only description is obsolete.                                                                                                                                                                                                                                                                      |
| Live accessibility       | Whole-room timed/flex mode is implemented for new Rounds and Presentations behind `FEATURE_LIVE_FLEX_MODE` and a workspace allowlist. It has no countdown; the facilitator closes the window. Private individual extra-time passes remain deferred pending fairness, privacy, and reveal research.                                                                                                                                                                                    |
| Response breadth         | Six response types are implemented. Exact short text and rank/order are not; add them only if the roadmap's observed demand threshold passes. Moderated open response, drawing, and word cloud remain deliberate later decisions.                                                                                                                                                                                                                                                     |
| Existing-deck workflow   | The scoped Presentation Companion provides compact controls, aggregate room health, join QR/code, and safe result overlays behind deployment and workspace gates. Text-only Pack insertion supports selected-card playback and linked recheck; standalone published Round questions freeze the selected source version. One session-only unscored 2–6-choice Quick Check is implemented provisionally. Media-backed insertion remains pending; native slide add-ins are out of scope. |
| Reuse                    | Recovery Packs support immutable versions, independent Round/Presentation draft insertion, three-way update review/undo, eligible live cards, delayed-probe and full-sequence practice, published-checkpoint CSV/QTI exports with source-bound loss reports, and scoped text-only Companion live insertion/playback. Source-assisted drafts require exact-content/source-hash-bound content and citation approval before publication.                                                 |
| Question Health          | Deterministic advice, dismiss/reopen, approved draft edits with same-revision undo, immutable published-version analysis, and exact-version aggregate post-use observations are implemented in a gated slice. Advice usefulness and retained-revision thresholds remain unmeasured.                                                                                                                                                                                                   |
| Session Decision Replay  | New eligible sessions can capture aggregate facilitator-decision events in durable state and show a read-only Report V4 timeline. Older report versions remain readable without replay; rollout and partner-value evidence remain open.                                                                                                                                                                                                                                               |
| Presentation editing     | Text boxes can be positioned/resized on a bounded 16:9 slide with guides, keyboard controls, and an image-safe region. This is not a full freeform design canvas or production slide companion.                                                                                                                                                                                                                                                                                       |
| Content/session deletion | Owners can permanently delete archived Rounds/Presentations and finished or expired session history after confirmation. Retained sessions and practice assignments block content deletion.                                                                                                                                                                                                                                                                                            |
| Longitudinal evidence    | Immediate linked rechecks, accountless practice/follow-ups, and standalone Pack delayed-probe assignments exist. Pack practice does not pair results to source participants. Multi-stage Recovery Trail access/evidence and privacy-safe Concept Health views remain unimplemented.                                                                                                                                                                                                   |
| Institution mode         | Creator OIDC and instructor LTI launch/Deep Linking foundations exist. Verified learners, NRPS/AGS roster and grade delivery, managed SAML/SCIM, certification, and institutional pilots remain contract-gated.                                                                                                                                                                                                                                                                       |
| Maintainability          | Core session repositories and mutation orchestration have been split behind stable facades. Some large routes/builders remain and should be refactored when touched; this is ongoing engineering hygiene, not a Phase 0 feature blocker.                                                                                                                                                                                                                                              |

The repository-side functionality committed for Phase 0 is implemented. Phase 0 is not formally
closed because the research, manual review, and deployment evidence gates remain open. Phase 1 is
also not formally selected: the whole-room flex capability is a provisional Access/resilience slice,
not evidence that the Access branch-selection gate passed. See the [implementation status](implementation-status.md)
and [Phase 0 decision record](evidence/phase0-stage-decision.md) for the separate code and evidence
states.

The implementation source of truth remains [implementation status](implementation-status.md),
[product design](design.md), [architecture](architecture.md), and the
[release-readiness ledger](release-readiness.json).

### Historical implementation checkpoint — 2026-10-04

PRs #60–69 added the whole-room flex, bounded Question Health, Session Decision Replay, bounded
Presentation text geometry, and owner-only archived-content/session-history deletion slices. They
close implementation tasks, not the research or public-release gates. Current work should validate
usefulness, accessibility, usability, hosted behavior, and partner value before widening rollout.
Individual time passes, full freeform slide design, the production browser companion, delayed
Recovery Trail, and Concept Health remain separate deferred or evidence-gated work.

## Competitive market map

### Product archetypes

| Archetype                       | Representative products                                                                                                                                                                                                                                                                  | What they make normal                                                                                                                       | Polling Pops implication                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Higher-education response       | [iClicker](https://www.iclicker.com/), [Learning Catalytics](https://www.pearson.com/en-us/higher-education/products-services/learning-catalytics.html), [Top Hat](https://tophat.com/features/), PointSolutions/EchoPoll                                                                | Confidence, attendance, broad response formats, PowerPoint, roster/grade sync, peer grouping, institutional support                         | Accountless/privacy-first use is an opening, but confidence and peer instruction are not unique |
| Learning-oriented interaction   | [Wooclap](https://www.wooclap.com/en/features/), [Wayground](https://help.wayground.com/support/solutions/articles/158000403874-understanding-wayground-plans), [Socrative](https://www.socrative.com/pricing/), Classtime                                                               | Live and self-paced delivery, many activity types, AI authoring, accommodations, analytics, libraries, and LMS workflows                    | Polling Pops must win on a clearer evidence loop, not generic “active learning”                 |
| Interactive lesson/assessment   | [Nearpod](https://nearpod.com/how-nearpod-works/), [Pear Deck](https://www.peardeck.com/pricing), [Formative](https://www.formative.com/teachers), Quizalize                                                                                                                             | Full lessons, interactive video, real-time feedback, differentiated follow-up, standards/mastery views, shared content, and admin reporting | Do not build a whole-course or K–12 curriculum platform                                         |
| Presentation and audience voice | [Mentimeter](https://www.mentimeter.com/features), [Slido](https://www.slido.com/product), [Vevox](https://www.vevox.com/features), [Poll Everywhere](https://www.polleverywhere.com/plans), [AhaSlides](https://ahaslides.com/features/), [ClassPoint](https://classpoint.io/)          | Polished result visuals, PowerPoint/Google Slides/Teams integrations, Q&A, word clouds, open response, large rooms, and easy joining        | A reliable companion/overlay is more strategic than replacing users' decks                      |
| Game and content ecosystems     | [Kahoot!](https://kahoot.com/schools/how-it-works/), [Blooket](https://help.blooket.com/hc/en-us/articles/21408591795351-Blooket-Game-Mode-Previews), [Gimkit](https://help.gimkit.com/en/article/game-options-explained-16312ua/), [Wordwall](https://wordwall.net/features), StudyGlen | Familiarity, huge libraries, fast source-to-game creation, public discovery, many modes, collectibles, and strong learner pull              | Do not pursue public-marketplace scale, arcade economies, or many modes                         |
| Open/private/low-connectivity   | [Particify](https://www.particify.de/en/help/), [ClassQuiz](https://github.com/mawoka-myblock/ClassQuiz), [Plickers](https://help.plickers.com/hc/en-us/articles/360009395854-What-is-Plickers)                                                                                          | Self-hosting, privacy, guest access, or device-free/offline participation                                                                   | Open source and privacy need a concrete outcome wedge; resilience remains a meaningful need     |

### Capability comparison around Polling Pops’ wedge

Legend: **Strong** means prominent in current first-party material; **Partial** means present but
limited, plan-dependent, or not the product's primary workflow. An empty cell does not prove a
capability is absent.

| Product             | Live + async | Confidence | Intervention / peer recheck | Before/after evidence | Source/AI authoring | Slides/LMS | Guest/private/open |
| ------------------- | ------------ | ---------- | --------------------------- | --------------------- | ------------------- | ---------- | ------------------ |
| Polling Pops        | Strong       | Strong     | Strong                      | Strong                | Strong              | Partial    | Strong             |
| Wooclap             | Strong       |            | Strong                      | Partial               | Strong              | Strong     | Partial            |
| Learning Catalytics | Strong       | Strong     | Strong                      | Partial               |                     | Partial    |                    |
| iClicker            | Strong       | Strong     | Partial                     | Partial               | Partial             | Strong     | Partial            |
| Vevox               | Strong       |            | Partial                     | Strong                | Partial             | Strong     | Partial            |
| Wayground           | Strong       |            | Partial                     | Partial               | Strong              | Strong     | Partial            |
| Formative           | Strong       |            | Partial                     | Strong                | Strong              | Strong     |                    |
| Quizalize           | Strong       |            | Partial                     | Strong                | Partial             | Partial    |                    |
| Particify           | Strong       |            |                             |                       |                     | Partial    | Strong             |

### The competitive claim that must change

Polling Pops must not claim that confidence, peer discussion, re-voting, follow-up questions, or
before/after comparison are unique:

- [iClicker](https://www.iclicker.com/) now prominently markets confidence ratings, multiple
  response formats, assignments, and LMS roster/grade sync.
- [Learning Catalytics](https://help.pearsoncmg.com/learning_catalytics/instructor/en/Content/Topics/get_ready_to_deliver_lc/lc_groups.htm)
  can automatically group learners by response for discussion and a second response.
- [Wooclap's peer-learning workflow](https://www.wooclap.com/en/peer-learning/) describes first
  votes, discussion, and result comparison. Its 2026
  [AI live facilitator](https://www.wooclap.com/en/ai-live-facilitator/) also groups open answers,
  surfaces themes, summarizes, and generates an immediate follow-up question.
- [Vevox comparison polls](https://help.vevox.com/hc/en-us/articles/22996157485213-Create-before-and-after-comparisons)
  visualize how a repeated response changes during a session.
- [Formative](https://www.formative.com/back-to-school) and
  [Quizalize](https://www.quizalize.com/) increasingly turn results into recommended or assigned
  follow-up work.

The stronger claim is that Polling Pops deliberately connects a diagnosed misconception, a recorded
human action, a linked different question, immediate and delayed evidence, explicit sample limits,
and guest-first privacy. This is a position to prove, not an assertion that no competitor can
assemble a similar workflow.

## What users repeatedly need

### 1. Fit existing teaching and meeting workflows

Facilitators do not want another presentation platform to maintain. Major competitors invest in
PowerPoint, Google Slides, Teams, Zoom, or LMS integrations. Mentimeter reviews repeatedly surface
presentation-integration and import friction, while ClassPoint's entire proposition is working
inside PowerPoint. The product response should be a lightweight browser companion first, not a
second full slide editor or immediate native add-in program.

**Polling Pops decision:** build a reliable companion/remote that sits beside any deck, can insert a
prepared Recovery Pack or quick check, shows join/result overlays, and returns focus to the deck in
one action. Require three paying design partners before native PowerPoint or Google Slides add-ins.

### 2. Reliability and equitable access beat novelty

The 2024–25 Jisc higher-education student survey reports widespread Wi-Fi and device problems, and
current reviews of several polling products mention disconnections, lost answers, QR trouble, or
live integration failures. Polling Pops’ durable receipt and reconnect design are valuable only when
users can see and trust them.

**Polling Pops decision:** make room health, durable save state, reconnect, and low-bandwidth behavior
visible. Harden the Presentation live path on the mature realtime/session foundation before adding
more Presentation breadth. Research shared-device and facilitator-tally fallbacks; do not commit to
physical cards or SMS without target-segment demand.

### 3. Participation must feel safe

Anonymous contribution makes it easier for quieter participants to respond, while timers, public
rankings, and identity-linked grading can add pressure or distort the learning job. Polling Pops is
already well positioned with accountless entry, private-result defaults, Q&A moderation, and
accuracy-first modes.

**Polling Pops decision:** keep **Learning mode** private and guest-first. Treat a future identified,
rostered **Verified mode** as a separate, disclosed, institution-controlled product boundary. A
session must never silently switch identity semantics or retroactively deanonymize participation.

### 4. Facilitators need one explainable next action

Raw charts and AI summaries are easy to produce; acting during a live session is harder. Learning
analytics research repeatedly finds that trust and use depend on mapping signals to a comprehensible
decision. Polling Pops’ deterministic Recovery Compass is strategically stronger than a generic
dashboard, provided real facilitators can understand it quickly.

**Polling Pops decision:** preserve one phase-aware recommended action, always show the rule and sample,
and record the facilitator's choice. AI may help author or organize material, but it should not
silently decide the live intervention.

### 5. Question quality is more valuable than faster question generation

AI question generation is now common. Recent evaluation work still finds frequent violations of
multiple-choice quality guidelines and substantial need for human review. Good distractors and
concept checks improve through learner-response evidence, not prompt speed alone.

**Polling Pops decision:** evaluate the implemented **Question Health** slice instead of starting
another generic authoring chatbot. Deterministic advice, facilitator-approved draft edits with
same-revision undo, immutable published-version analysis, and aggregate post-use observations are
behind rollout gates. Measure usefulness and whether revisions are retained; only then decide
whether to extend preflight coverage or aggregate rules. It must never rewrite a published version
or auto-publish a change.

### 6. Immediate improvement is not retention or transfer

Learning research supports retrieval practice, feedback, and peer discussion, but a same-session
gain is not durable learning. Workplace evaluators similarly need evidence beyond attendance and
completion. The [CDC training evaluation guidance](https://www.cdc.gov/training-development/php/about/evaluate-training-measuring-effectiveness.html)
distinguishes learning from later transfer.

**Polling Pops decision:** add an optional **Delayed Recovery Trail** using a concept-matched but
different question at 24 hours, seven days, or a facilitator-selected interval. Label immediate
recovery, delayed retention, and workplace application as different evidence types, with attrition
and denominator warnings.

### 7. Accessibility is both a user need and a buying gate

[Wayground accommodations](https://help.wayground.com/support/solutions/articles/158000404955-accommodations-available-on-wayground)
include extra time, extended deadlines, read-aloud, translation, speech-to-text, reduced choices,
and reading controls. iClicker publishes current accessibility-conformance material. Institutional
technology acquisition increasingly asks for accessibility and security documentation, not just a
feature list.

**Polling Pops decision:** validate the implemented whole-room live time-flex mode, which has no
countdown and leaves window closure to the facilitator. Private participant-specific extra-time
passes remain deferred until fairness, privacy, and shared-reveal behavior are understood. Complete
manual assistive-technology evidence and an accessibility-conformance report before claiming
parity. Add reading supports only after user research establishes which needs are not already met by
browser and OS assistive technology.

### 8. Live plus self-paced, reuse, and interoperability are table stakes

The market expects the same material to work live and asynchronously, be reusable, and connect to
existing systems. Polling Pops now covers live Rounds, practice, imports/exports, and snapshot reuse,
but self-paced Presentations and version-aware reusable content are incomplete.

**Polling Pops decision:** make the Recovery Pack the reusable unit, with explicit version snapshots
and “update available” review rather than hidden synchronization. Add self-paced Presentation
delivery only after live Presentation reliability is proven.

### 9. Capacity and pricing create acquisition friction

Current official free live limits commonly cluster around 40–100 participants: Kahoot! 40,
Wayground 100, Socrative 50, Nearpod 40, Slido 100, Vevox 100, Poll Everywhere 40, AhaSlides 50,
and Blooket 60. Polling Pops Hosted Free at 20 is visibly below this range.

**Polling Pops decision:** target 50 for Hosted Free and 250 for Pro, but change neither public promise
until target-region cost, abuse, support, soak, restart, and report-reconciliation evidence passes.

## Product strategy

### Primary job

The initial behavioral ICP is a self-serve facilitator running recurring, concept-heavy sessions
for roughly 20–100 people and able to adopt without a roster, gradebook, or procurement integration.
Higher-education STEM/health teaching and workplace technical training should both enter discovery,
but the team should choose one primary acquisition channel after the first research gate rather
than fund two institutional roadmaps.

After the Phase 0 research gate, select the segment with more repeat pilots and evidence-complete
recovery loops. If the segment evidence is tied, prefer faster activation and then stronger
willingness-to-pay evidence. Keep the selection pending when reviewed evidence is incomplete or
the deciding measures conflict without a defensible winner.

For those instructors and facilitators:

> When a room is wrong, split, or confidently mistaken, help me choose what to do next and show me
> whether that action changed understanding—without embarrassing people or creating learner
> accounts.

This excludes graded high-stakes testing, certification, attendance enforcement, K–12 institutional
deployment, public content commerce, and general meeting facilitation from the initial wedge.

### Three product pillars

#### 1. Recovery Packs

A Recovery Pack is a versioned, portable teaching unit containing:

- one diagnostic question;
- concept and misconception metadata;
- source citations where applicable;
- one or more human-reviewed intervention cards, such as an explanation, worked example, or peer
  prompt;
- a linked, meaningfully different immediate recheck; and
- an optional delayed transfer/retention probe.

The existing source-grounded authoring and linked-recheck model already implement much of this
content. The product work is to make the unit visible, reusable, quality-checked, and easy to insert
into a Round, Presentation, companion session, or practice assignment.

#### 2. Question Health Lab

The bounded Question Health workflow is implemented behind rollout gates. The broader product
vision and acceptance criteria below are proposals for validation and possible expansion, not a
statement that no Question Health implementation exists.

Before use, the lab should flag deterministic or reviewable issues:

- duplicated, overlapping, or length-cued choices;
- missing correct-answer rationale or source support;
- distractors with no authored misconception purpose;
- a recheck that is identical or tests a different concept;
- inaccessible media or missing alt text;
- mobile overflow and excessively dense prompts; and
- inconsistent scoring, confidence, timing, or purpose settings.

After enough aggregate evidence exists, it should flag—not automatically “fix”—questions with:

- unused distractors;
- unexpectedly high confident-wrong responses;
- high correct-but-unsure responses;
- extreme response-time shape;
- recheck behavior inconsistent with the intended concept; or
- large instability across comparable sessions, with cohort and sample warnings.

Every change creates a new draft/version. Historical reports remain attached to the exact version
that participants saw.

#### 3. Recovery Trail

The Recovery Trail connects:

```text
Initial signal → diagnosed issue → facilitator action → immediate recheck → optional delayed probe
```

The report must separate:

- same-question revote;
- linked near-transfer recheck;
- delayed concept check; and
- self-reported workplace application.

It must show participation/attrition and avoid causal language such as “the intervention caused the
gain.” Session Decision Replay is the facilitator-facing view of this trail; Concept Health is the
privacy-safe aggregate view across eligible sessions.

### Supporting rails

- **Companion mode:** fit existing decks and meetings.
- **Resilient room:** visible receipts, reconnect, low-bandwidth delivery, and honest capacity.
- **Accessible timing:** whole-room time-flex first, private passes only after fairness/privacy
  testing.
- **Two trust modes:** private Learning mode and future contract-gated Verified mode.
- **Open core:** community/self-hosted deployments retain the recovery engine and native exports.

## Priority portfolio

| Rank | Capability                                    | Demand evidence | Strategic fit | Differentiation | Relative effort/risk  | Decision                                                                                                                                |
| ---: | --------------------------------------------- | --------------- | ------------- | --------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
|    1 | Partner and product-evidence decisions        | Very high       | Essential     | Trust layer     | High/external         | Collect evidence needed for Phase 1/2 choices; keep staging and release-readiness work outside this feature sequence                    |
|    2 | Presentation realtime and resilient-room work | Very high       | Essential     | Medium          | Medium                | Realtime implementation is in place; complete target-host and real-session validation before capacity claims                            |
|    3 | Browser slide companion/remote                | Very high       | High          | Medium          | Medium                | Research prototype exists; build production companion only if its Phase 1 gate passes                                                   |
|    4 | Live time-flex and private extra-time design  | High            | High          | Medium          | Medium/high           | Whole-room flex is implemented provisionally; validate it, and defer private passes pending fairness/privacy research                   |
|    5 | Recovery Pack as a reusable unit              | High            | Very high     | High            | Medium, high leverage | Build after the evidence baseline                                                                                                       |
|    6 | Question Health                               | High            | Very high     | High            | Medium                | Bounded gated slice is implemented; measure advice usefulness, retained revisions, and post-use comprehension before expanding          |
|    7 | Delayed Recovery Trail                        | Medium/high     | Very high     | High            | Medium                | Concierge-test, then build                                                                                                              |
|    8 | Exact short text and rank/order               | High            | Medium        | Low             | Medium                | Thin parity lane; do not add a format catalog                                                                                           |
|    9 | Session Decision Replay and Concept Health    | Medium          | Very high     | High            | Medium/high           | Aggregate Report V4 replay is implemented behind a gate; validate decision impact. Concept Health remains dependent on healthy metadata |
|   10 | Self-paced Presentation                       | Medium/high     | Medium        | Low             | Medium                | After live Presentation evidence                                                                                                        |
|   11 | Structured contrast-pair discussion           | Medium          | High          | Medium          | High                  | Pilot only; competitors already do grouping                                                                                             |
|   12 | NRPS/AGS, identified learner, grade passback  | High for buyers | Conditional   | Low             | Very high             | Two named institutional pilots first                                                                                                    |
|   13 | Moderated open response/word cloud            | High            | Low/medium    | Low             | High safety cost      | Later, after moderation evaluation                                                                                                      |

The ordering is deliberately not pure competitor parity. Recovery Pack and evidence validation for
Question Health rank above several common formats because they strengthen the outcome Polling Pops is
trying to own. Rank describes strategic importance, not an unfinished implementation queue.

## Development roadmap

Timing is an engineering estimate, not a launch promise. External review and pilot recruitment can
run in parallel, but a failed gate changes the next phase. Reserve roughly seven of the first 24
engineer-weeks for defects, operations, security, support, and contingency; external specialists
must perform work an engineer cannot self-certify.

### Implementation plan update — 2026-10-04

This sequence is reconciled to the implementation snapshot above. It prioritizes product
functionality and feature readiness; staging and production-readiness work remain separate release
gates and are not substituted with local test results.

| Sequence                   | Current state                                                                                                                                                                                                                                                                             | Next work and completion condition                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 repository scope   | Implemented; no committed Phase 0 feature epic remains.                                                                                                                                                                                                                                   | Preserve compatibility and close the separate evidence record with the required reviewed partner, session, usability, accessibility, and security inputs. Do not mark the formal phase exit accepted without those inputs.                                                                                                                                                                                                                                          |
| Phase 1 branch             | Pending evidence-based selection. Whole-room flex is implemented provisionally for Rounds and Presentations.                                                                                                                                                                              | Apply the ordered Access → Companion → measured activation/correctness decision. For Access, add only room-health/reconnect improvements supported by observations; validate existing flex without reimplementing it or shipping private extra-time passes before a fairness/privacy decision. For Companion, implement the thin browser sidecar only if its gate passes. If neither passes, fix the unique highest measured failure.                               |
| Phase 2 differentiated bet | Question Health MVP, dismissal/reopen, draft apply/undo, published-version analysis, and exact-version aggregate post-use observations merged through PR #64; Session Decision Replay and Report V4 merged through PR #65. Usefulness and retained-revision thresholds remain unmeasured. | Validate Question Health advice, revision retention, Report V4 comprehension, and whether replay changes facilitator decisions. Never reconstruct earlier sessions from current answers. Keep partner thresholds pending and revisit the deferred partner-evidence bet decision later.                                                                                                                                                                              |
| Delayed evidence           | Concierge prototype only; no full Recovery Trail.                                                                                                                                                                                                                                         | Continue the concierge check during Phase 2 hardening. Schedule the full Trail only if at least 30% of eligible pilots issue it, at least 50% of invited participants complete it, and facilitators use the result to change a later action.                                                                                                                                                                                                                        |
| Video-based Round          | Unscheduled candidate; requirements and delivery model are not validated.                                                                                                                                                                                                                 | After the current Phase 1 branch and one Phase 2 bet are decided, run discovery before implementation. Treat recorded/on-demand lessons and live webinars as separate use cases. Choose the initial delivery mode and media-source model from observed workflows; define playback/stream control, timestamped Round interactions, captions/transcripts, reconnect/late-join behavior, accessibility, privacy/retention, and operator cost before committing an MVP. |

At the product owner's direction, partner-evidence branch/bet selection is deferred and will be
revisited later; code implementation is not blocked on that decision. This is a provisional coding
order only: it does not represent any partner threshold as met, select a rollout branch, close a
research gate, or make the separate production-readiness ledger optional for a later hosted release.

**Historical implementation update (2026-10-02; superseded):** after whole-room flex, PR #61 merged a provisional Question
Health MVP: the shared deterministic evaluator, versioned advisory result contract, allowlisted
authenticated draft-analysis endpoint, and read-only Round Builder panel. PR #62 merged
persistent content-bound dismissals and reopen behavior. `FEATURE_QUESTION_HEALTH` and the
workspace allowlist still default closed. The next provisional slice supports facilitator-approved
draft edits for suitable findings with a server-validated before/after preview and same-revision
undo; it never rewrites a published version. Read-only published-version analysis now evaluates
immutable content with stored version provenance in a separate API and Round Builder panel, without
draft dismissal or apply controls. The `codex/question-health-post-use-observations` branch
implemented a separate read-only post-use endpoint and panel for the exact published version; PR #64
merged it. It
uses only the 250 most recent retained aggregate reports and exposes when older history is omitted;
it separates trust/time/scoring cohorts,
requires at least 20 responses within each included session, reports accuracy across sessions, and
flags a distractor selected zero times or a 30-point accuracy range only under explicit sample
rules. The feature adds no participant-level answer storage or AI transmission, and changes no
content.
This is the bounded Question Health post-use slice. It is not the
20-question/70%-usefulness study or proof that the feature is useful. Partner thresholds remain
pending and are explicitly deferred for later review.

At that snapshot, the next provisional branch, `codex/session-decision-replay`, implemented capture of facilitator
insight at lock, answer reveal, intervention start/finish, recheck open, question advance, and session
finish using versioned aggregate-only events. The events are stored in the existing tenant-scoped
journal in the same transaction as the authoritative session-state change. Report V4 adds a timeline
while V1–V3 remain readable and explicitly unavailable for replay. The branch is unmerged and still
needs PostgreSQL integration execution; the replay allowlist is not enabled by default, and no
partner-evidence gate is claimed as passed.

### Implementation checkpoint — 2026-10-04

PR #65 merged Session Decision Replay and Report V4. Eligible new sessions can capture aggregate
facilitator-decision events in durable state and show a read-only timeline. V1–V3 reports
remain readable but do not have replay; rollout remains gated. No partner-value or production gate is
claimed as passed. PRs #66–68 added bounded Presentation text-box geometry, image-safe layout, and
acceptance coverage. PR #69 added owner-only deletion for archived Library content and
finished/expired session history. Question Health and live flex also remain gated. The feature
slices are implemented; the next product work is validation and separate release-readiness evidence.

### Incremental feature checkpoint — 2026-10-07

Following the deferred partner-evidence/staging decision, implementation continues in small
feature slices without claiming those gates passed. Recovery Packs now have immutable publication,
Round draft insertion, three-way Round update review/undo, and frozen live Round intervention cards.
The current increment adds Presentation draft insertion with revision-fenced lost-acknowledgement
replay, independently copied diagnostic/recheck blocks, and complete frozen facilitator references.
Presentation snapshots with complete Pack baselines explicitly use schema v3; ordinary and legacy
documents, including previously imported question-level Pack provenance, remain v2.

Presentation three-way update review/undo now reuses the Round merge workflow, preserving local
slides/block metadata and frozen original evidence while accepting reviewed context separately.
Current-update history protection retains a fenced undo source; reads, exact receipt retries, and
undo survive a rollout pause. This remains a draft-only capability, not live card playback.

Live Presentation card playback now adds host-only post-reveal previews,
explicit explanation/example commands, selected-only role projections, durable acknowledgement
recovery, and aggregate Presentation Report V2 attribution with V1 compatibility. Creation
eligibility stays behind both Pack flags and the evidence allowlist, and migration 055 preserves
the existing RLS, export/delete, and retention boundaries. This is provisional source implementation,
not a passed observation or release gate.

Standalone delayed-probe practice now copies an exact published Pack probe into the existing
accountless runner, with immutable source context, scheduling, generic/personal links, durable
creation retry, and retained media/content after source deletion. Both Pack and practice creation
gates and workspace eligibility apply; flag pauses preserve existing assignments and receipt
recovery. There is no fallback to an immediate checkpoint, no paired-source learning claim, and no
dummy Round. An explicit full-sequence mode now adds the frozen diagnostic, ordered intervention
cards, and linked recheck to that same runner, with durable current-stage resume and fenced answer/
Continue recovery. It does not include the optional probe or claim paired-source/delayed evidence.
Published Pack CSV/QTI exports now project all frozen checkpoints with a deterministic source-
version/hash-bound loss report. They disclose omitted Pack context/media/citations, QTI extension-
only semantics, and format transformations; they are not complete Pack interchange. Native JSON
remains the complete content format, with media references rather than embedded image bytes.
Source-assisted authoring now converts an existing validated source job into an editable Pack draft
without another provider call. Original validated citation spans are retained with the Pack rather
than depending on the temporary source job. Creator content/citation approval is bound to the saved
revision, complete content hash, source digest, and source-output hash; edits require renewed review.
Publication remains a separate action. This is human attestation, not automated verification of
pedagogical quality or a claim of source truth. Native JSON carries content, not that attestation.
At that checkpoint, Companion insertion remained next; the subsequent Companion Pack increment
is recorded below. See the
[delayed-probe checkpoint](implementation-status.md#recovery-pack-delayed-probe-practice--2026-10-07)
[full-sequence checkpoint](implementation-status.md#recovery-pack-full-sequence-practice--2026-10-07),
the [portability checkpoint](implementation-status.md#recovery-pack-qticsv-portability--2026-10-07),
and [source-authoring checkpoint](implementation-status.md#recovery-pack-source-assisted-authoring--2026-10-07).
Delayed Recovery Trail and Concept Health remain later capabilities. This checkpoint does not
change public participant caps, launch readiness, or the institution/video delivery deferrals.

### Phase 0 — prove and harden the product (weeks 0–10, overlapping tracks)

**Outcome:** know whether the current Recovery Loop solves a recurring problem and can run safely
outside a developer machine.

The phases below preserve the original proposed timing. Their scope and implementation state have
since changed; use the dated implementation checkpoints and phase updates as current status.

Product and research work:

- Interview at least six higher-education facilitators and six workplace facilitators using their
  most recent real deck, quiz, report, or training artifact.
- Recruit at least three higher-education and three workplace design partners and observe ten live
  sessions.
- Run the existing creation, action-finding, first-response, receipt, result-finding, and report-
  comprehension usability protocol.
- Validate the implemented Question Health slice; continue discovery for companion mode and a
  delayed concept-matched probe.
- Establish current create → publish → room → join → saved answer → intervention → recheck → report
  funnel baselines.

Engineering and release work:

- Move or adapt live Presentations onto the mature realtime acknowledgement/reconnect foundation;
  add a complete host/participant/reconnect/report browser journey. **Repository implementation is
  complete**; target-host and independent device/accessibility validation remain evidence gates.
- Add visible room/network health and verify low-bandwidth payload behavior without preloading
  answer keys or hidden diagnostic metadata. **Repository controls and automated checks exist**;
  target-host performance and real-device behavior remain unverified.
- Split the largest touched Presentation/session components before expanding them.
- Provision staging and complete the release-ledger work for TLS, pinned hosts, private telemetry,
  paging, off-host backup, replacement-host restore, physical devices, target-host load/soak,
  independent accessibility/security, privacy/legal, billing, and support rehearsal.

Exit gates:

- At least eight of twelve interviewees describe a recurring post-result decision problem.
- At least six agree to a real pilot and at least three in each segment run Polling Pops twice.
- At least half of eligible observed checkpoints complete diagnose → intervention → valid recheck.
- Existing beta usability thresholds pass, including unassisted first value, next-action finding,
  first response, durable receipt, result retrieval, and report comprehension.
- No critical/serious accessibility defect, answer-key leak, unreconciled response, or identity-
  mode ambiguity remains in a critical flow.

**Stop/reframe rule:** if users consistently use Polling Pops only as a generic poll and do not act on
the Recovery Compass, narrow the target segment or revise the workflow before adding breadth.

**Historical implementation checkpoint (2026-10-01):** whole-room timed/flex mode is implemented for Rounds
and Presentations, behind a default-off deployment flag and explicit workspace allowlist. This closes
that repository feature slice only; it does not select the Access branch, close the research gate,
or authorize a public capacity/accessibility claim.

### Phase 1 — remove the highest observed workflow blocker (weeks 11–14)

**Outcome:** Polling Pops works beside the user's existing material and supports a calmer, more
inclusive live session.

Select exactly **one** implementation from observed sessions, in this order:

- **Access path first** if timing or connectivity excludes participants in at least three partner
  workflows, affects at least 10% of observed attempts, or produces a serious accessibility
  finding. Whole-room live time-flex is already implemented provisionally; use accepted observations
  to select and deliver the highest-impact remaining room-health/reconnect improvements. Do not
  ship private 1.5×/2× passes until research establishes reveal, privacy, and fairness behavior.
- **Companion path otherwise** if at least four repeat facilitators use an external deck and at
  least two observed sessions suffer a material context-switch interruption. Ship a thin browser
  companion with join overlay, prepared-question insertion, phase-aware controls, results overlay,
  and one-action return to the deck.
- **Measured-failure path otherwise:** spend the phase on the largest measured activation or
  correctness failure; do not invent a third feature.

In parallel, validate Hosted Free 50 on the actual target host and release it only after the load,
restart, cost, abuse, reconciliation, and support gates pass. Keep Pro at 100 until the corresponding
250-client target-host soak gate passes.

Non-goals:

- Native PowerPoint or Google Slides add-ins.
- Importing or editing a full deck in companion mode.
- Device geolocation, attendance enforcement, or participant profiling.

Exit gates:

- Eighty percent of first-time pilot facilitators launch a prepared interaction beside an existing
  deck within two minutes and return to that deck without coaching.
- Any companion uses the same authoritative command, acknowledgement, role-filter, and reconnect
  contracts as the normal host.
- Manual keyboard, VoiceOver, NVDA, zoom, reduced-motion, and representative-device tests pass.
- No participant is publicly marked as accommodated, and the timing model cannot leak an
  accommodation through participant-specific UI or results.

### Phase 2 — ship one differentiated bet (weeks 15–24)

**Outcome:** facilitators create reusable, defensible diagnostic sequences and improve them from
real evidence.

The bounded **Question Health** slice is implemented. Use this phase to evaluate it: across at least
20 real questions, measure whether at least 70% of reviewed flags are judged useful and whether at
least half lead to an accepted revision. Start by validating the existing deterministic pre-publish
checks and aggregate post-session observations; extend the rules only if results and samples support
it. The feature remains gated until agreed usefulness and privacy thresholds are met.

Use the same slot for **Recovery Pack authoring instead** if observed sessions show that linked
rechecks are rarely authored because preparation cost—not question diagnosis—is the dominant
failure. In that branch, extend the source-grounded assistant to propose a diagnostic, rationale,
misconception-linked distractors, source-cited intervention card, and differently worded recheck,
all with human approval. A visible pack may begin as versioned composition over existing immutable
content before introducing a new durable aggregate.

During weeks 21–24, harden the chosen bet and run a concierge prototype of the Delayed Recovery
Trail. Do not implement both primary bets or the full delayed system in this cycle.

Exact short text and rank/order remain a thin parity option only if at least 30% of otherwise
qualified pilot sessions cannot express a required check with the existing six formats.

**Unscheduled discovery candidate — video-based Rounds:** support for Rounds based on recorded
lectures or live webinars is not part of the committed 24-week scope and has no validated user
workflow yet. Assess recorded/on-demand and live/synchronized delivery as separate jobs, including
video controls and question timing, captions/transcripts, reconnect and low-bandwidth behavior,
host control, accessibility, and media privacy/retention. Do not start implementation until the
current Phase 0/Phase 1 evidence decisions are resolved and this candidate is compared against the
existing Phase 2 gates.

Exit gates:

- Every generated citation resolves to the submitted source span or is visibly rejected.
- Human correction rate, invalid-question rate, latency, and provider cost are measured on an
  approved representative corpus; no hosted enablement occurs without agreed thresholds.
- At least 70% of facilitator-reviewed Question Health flags are judged useful; false positives and
  dismissals are recorded by rule.
- Any shipped pack structure round-trips losslessly in Polling Pops JSON and produces explicit loss
  reports in constrained formats.
- Old published versions and completed reports remain byte/logically reproducible.

### Later horizon A — connect immediate recovery to later evidence

**Outcome:** a facilitator can check whether an apparent recovery survives after the room.

Scope:

- Add optional delayed probes at 24 hours, seven days, or a facilitator-selected interval.
- Reuse expiring generic or labelled accountless links; do not require participant accounts or
  collect an email address merely to schedule a probe.
- Let the facilitator distribute the link through the existing LMS, email, or messaging channel;
  notification integrations are a later decision.
- Add the delayed Recovery Trail, separating revote, linked recheck, delayed retention, and
  workplace application evidence. Session Decision Replay is already implemented as a separate,
  aggregate-only Report V4 timeline; validate its comprehension and decision impact before expanding
  it.
- Show attrition, numerator/denominator, timing, question equivalence, and small-sample warnings.

Exit gates:

- At least 40% of invited pilot participants complete the delayed probe, or research identifies a
  credible workflow change before broader investment.
- At least half of pilot facilitators use the result to choose a next action, not merely view it.
- Expiry, revocation, resume, retention, deletion, and tenant isolation pass memory, PostgreSQL,
  API, browser, and process-restart tests.
- Reports never describe immediate gain as durable learning or imply that an intervention caused
  the change.

This horizon is not part of the first 24-week commitment. Start it only if at least 30% of eligible
pilot sessions issue the concierge delayed check, at least 50% of invited participants complete it,
and facilitators use the result to change a later action.

### Later horizon B — privacy-safe program insight

**Outcome:** repeated users can see which concepts remain fragile without creating hidden learner
profiles or misleading league tables.

Scope:

- Add a Concept Health view using only eligible versioned concept evidence with minimum cohort
  sizes, explicit date/session filters, and numerator/denominator display.
- Show recurring confident misconceptions, unresolved concepts, later-retention evidence, and
  question-quality warnings.
- Add a structured peer-discussion prototype only if observed sessions show facilitators need help
  forming discussion pairs. Start with ephemeral, facilitator-controlled groups and do not reveal
  who is correct.
- Add self-paced Presentation delivery only if live Presentation use and reliability clear the
  prior gate.

Exit gates:

- At least 60% of reused pilot content has meaningful concept metadata; otherwise improve
  authoring before building dashboards.
- Users correctly explain what a trend does and does not mean in observed report tasks.
- No participant-level cross-session profile exists in Learning mode, and aggregates suppress
  small or reconstructable cohorts.
- The main unresolved concept and its evidence can be found in under 45 seconds.

This horizon follows Delayed Recovery Trail and requires meaningful concept metadata on at least
60% of reused pilot content.

### Conditional institution lane — do not schedule by default (8–12 additional weeks)

Start this lane only after two named institutions agree that roster/grade services are required for
a paid pilot and accept the identified-data model.

Scope would include NRPS, idempotent AGS grade delivery, a separately disclosed Verified mode,
managed SSO/SCIM, admin policy, audit, retention, accessibility/security documentation,
certification/interop, support, and contracts. Learning mode remains available and cannot be
silently upgraded into identified reporting.

## Development-ready epic definitions

### Incremental Companion checkpoint — 2026-10-08

The provisional Companion foundation checkpoint implements the compact Presentation sidecar, dedicated
one-hour expiring/revocable pass, primary phase controls, aggregate room health, join QR/code, and
post-reveal choice-count overlay. Server-authoritative command receipts and existing realtime
fences are reused; no participant identities, answer keys, host pass, or creator-cookie authority
are supplied to the sidecar controls. The launch fragment is removed before requests and the
pass lives in session storage. “Return to deck” closes the overlay, not an arbitrary desktop app.

It remains off by default behind `FEATURE_PRESENTATION_COMPANION`, realtime/professional
Presentation eligibility, and the workspace allowlist. Partner branch selection remains deferred,
not passed. Immutable prepared Pack insertion/playback and one session-only unscored Quick Check
were pending at this foundation checkpoint. See the subsequent Pack increment below and
[implementation status](implementation-status.md#presentation-companion-foundation--october-8-2026).

### Incremental Companion Pack checkpoint — 2026-10-08

The next source increment adds live insertion of a selected immutable published text-only Pack.
The catalog is bounded and workspace/pass-scoped, with IDs, version, and title only. At a safe
boundary, one fenced command inserts the frozen diagnostic/recheck pair and immediately opens
the diagnostic. Session content, timing, revision, sequence, timeline, and receipt update atomically;
published sources and drafts remain unchanged. Exact retry recovers before phase, rollout, size,
or source checks, and the frozen copy survives source deletion. Post-reveal card choices expose
titles/references only; explanation/example selection plays only that card before the linked recheck.

New insertion requires the existing Companion/realtime, Presentation, Pack/live-card, workspace,
and session-creation gates. Rollback blocks new insertion, not receipt recovery or frozen playback.
Insertion never splits an open question or a pending linked recheck, including practice-purpose
sources and intervening content/standalone questions. Packs with media on
any diagnostic/recheck/delayed probe remain unsupported until session-owned media retention exists;
the delayed probe is not played in this live slice. At this checkpoint one session-only unscored
Quick Check was next; the subsequent source increment is recorded below. Partner evidence and
production acceptance are still deferred, not passed.

### Incremental Companion Quick Check checkpoint — 2026-10-08

The next source increment adds one immutable session-only unscored opinion poll with 2–6 choices.
It reuses Companion credentials, authoritative live synchronization, closed-boundary/pending-recheck
fences, durable command receipts, and atomic content/timing/revision/event writes. Choice/prompt
bounds are shared by browser and server; retries retain the exact prompt, ordered choices, timing,
revision, and command ID. A state broadcast cannot substitute for server acknowledgement.
The marker survives durable reads and restoration but is absent from authoring drafts. Published
content remains unchanged. Reports identify the poll explicitly and report no correctness, score,
recovery, or learning claim. Whole-room timed/flex behavior is inherited without private timing.
Quick Check evidence uses Presentation Report V3; V1/V2 stay strict and readable. Companion and
report REST metadata is opt-in, with legacy projections by default. API/report workers must be
upgraded before enabling new use and remain V3-compatible during feature rollback; see the
[upgrade order](api.md#presentation-companion-foundation).

New creation uses existing professional Presentation, Companion/realtime, and workspace gates,
independently of Pack/live-card flags. Rollback preserves accepted retries, existing live polls,
responses, and reports. Media-backed Companion insertion remains a separate retention increment.
At this checkpoint standalone published-question insertion was next; the subsequent Round-source
increment is recorded below. Recovery Trails and Concept
Health remain later capabilities. This completes the Quick Check slice, not every original
Companion capability or its deferred partner-value/production acceptance gates.

### Incremental Companion published-question checkpoint — 2026-10-09

The next increment supports standalone text-only questions from published Rounds without requiring
a Pack. A bounded pass/workspace-scoped catalog exposes only published title/version/hash, prompt,
type, and source IDs, with literal title/prompt search and a refinement hint when more than 100
questions match. Linked sources/rechecks, Pack-derived questions, and media are excluded. One
fenced command freezes the explicitly selected retained version and immediately opens the copy.
Block and session-only provenance survive durable reads/restoration and source deletion. Published
sources and drafts are unchanged. Safe boundaries, timed/flex behavior, ordinary scoring/confidence,
durable receipt recovery, and participant-safe projections reuse the authoritative live engine.
Reports retain existing evidence schemas and do not manufacture linked recovery evidence.

New creation requires the existing professional Presentation, Companion/realtime, and workspace
gates, independently of Pack flags. Rollback blocks new use, not accepted retries or frozen copies.
The new capability is independently opt-in for REST readers; API/report-worker snapshot readers
must understand the marker before activation and remain compatible during rollback. No new tables,
migrations, dependencies, CI jobs, or participant caps. Media-backed insertion remains next,
followed by Recovery Trails and Concept Health. Partner-evidence and production acceptance remain
deferred, not passed. This slice does not add published Presentation sourcing or a mutable editor.

### Epic A — Companion mode

**User job:** “I already have a deck. Let me ask, recover, and return to it without losing the
room.”

MVP acceptance:

- compact host window or side panel with current phase, joined/answered count, one primary action,
  and connection state;
- dedicated scoped credential, never a reused creator or presenter token;
- join QR/code overlay and participant-safe result overlay;
- prepared Recovery Pack insertion and one session-only Quick Check;
- immutable standalone published Round question insertion without requiring a Pack;
- keyboard/remote-friendly next action and a reliable return-to-deck action;
- same command idempotency, fencing, acknowledgement, and reconnect behavior as the main host.

### Epic B — Live access and resilience

**User job:** “Let everyone participate without publicly disclosing who needs more time or who lost
connectivity.”

MVP acceptance:

- whole-room time-flex mode where the host closes the response window;
- explicit research decision on how private extended deadlines interact with shared reveal;
- participant-visible saved/offline/reconnecting state and host-visible aggregate room health;
- bounded, text-first low-bandwidth payloads and current-state recovery;
- no correctness or hidden metadata cached before it is authorized for that role and phase.

### Epic C — Recovery Pack

**User job:** “Give me a tested sequence, not a pile of unrelated questions.”

**Incremental implementation:** Pack authoring from published Round pairs, immutable publishing,
revision/history recovery, native JSON, and independent Round/Presentation draft insertion now
preserve item provenance and a complete frozen source baseline. Both draft surfaces support
three-way update review, explicit conflict choices, revision-fenced undo, and retry recovery.
Cards remain frozen facilitator references in builders; live explanation or worked-example playback
is available in eligible new Round/Presentation sessions when enabled for the workspace. The
facilitator explicitly selects a card after revealing the Pack diagnostic. Standalone delayed-probe
practice now reuses the accountless assignment runner with frozen source/version/hash attribution,
private link recovery, and source-independent retention. Full-sequence practice now adds a frozen
diagnostic → ordered cards → linked recheck journey with current-stage projections, reload/resume,
and version-fenced acknowledgement recovery. Immutable published checkpoints can also be exported
as CSV or QTI with an explicit, downloadable loss report; QTI packages embed that same report.
These formats do not replace complete native JSON content. Source-assisted editable drafts and
hash-bound content/citation approval are now implemented; publication stays separate, changes
invalidate approval, and source-job expiry does not erase retained Pack review evidence. Companion
now supports scoped live insertion/playback of published text-only Packs. Media-backed Companion
insertion remains pending session-owned retention. See the
[delayed-probe checkpoint](implementation-status.md#recovery-pack-delayed-probe-practice--2026-10-07)
[full-sequence checkpoint](implementation-status.md#recovery-pack-full-sequence-practice--2026-10-07),
the [portability checkpoint](implementation-status.md#recovery-pack-qticsv-portability--2026-10-07),
and [source-authoring checkpoint](implementation-status.md#recovery-pack-source-assisted-authoring--2026-10-07).

MVP acceptance:

- versioned diagnostic, intervention card, linked recheck, concepts, misconceptions, and citations;
- reusable immutable snapshot with source/version attribution and an explicit update review;
- insertion into Round, Presentation, practice, and companion surfaces;
- lossless Polling Pops JSON and explicit QTI/CSV limitations;
- no automatic mutation of existing drafts or published versions.

### Epic D — Question Health Lab

**User job:** “Tell me whether the question—not only the learner—may be the problem.”

**Implementation status:** the bounded MVP is implemented behind feature/workspace rollout gates.
The items below describe the intended acceptance contract and remaining validation/expansion, not a
claim that the feature is wholly unbuilt.

MVP acceptance:

- deterministic preflight rules with a reason, severity, and exact field/action;
- aggregate post-use observations only after a documented sample threshold;
- compare only compatible item versions/cohorts and show instability rather than hiding it;
- one-click create-revision workflow with undo and a before/after diff;
- author can dismiss a flag with a bounded reason; no automatic publishing or learner judgment.

### Epic E — Delayed Recovery Trail

**User job:** “Show whether the concept still holds later, without forcing accounts.”

MVP acceptance:

- different but concept-matched delayed probe with immutable source relation;
- expiring/revocable generic and labelled accountless access;
- evidence-level labels for revote, immediate linked recheck, delayed probe, and application prompt;
- completion/attrition and exact numerator/denominator;
- retention/delete/export behavior consistent with the source and the selected trust mode.

### Epic F — Two trust modes

**Learning mode:** accountless, session-scoped identity, aggregate-first reports, no attendance or
grade claim, and no participant-level cross-session profile.

**Verified mode:** institution-controlled identities, explicit learner disclosure, roster/grade
contracts, access audit, deletion/appeal behavior, and separate enablement. Identity mode is frozen
when a session or assignment is created.

## Architecture implications

| Capability               | Reuse first                                                              | Additive change                                                         | Safety rule                                                           |
| ------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Companion                | Host command controller, scoped credentials, presenter/embed projections | Companion role projection, overlay state, optional session-only item    | Never create a parallel game engine or bypass command fencing         |
| Presentation reliability | Socket.IO, snapshots, receipts, sequence journal, report reconciliation  | Presentation event adapters and complete reconnect/browser coverage     | Preserve server authority and role filtering                          |
| Recovery Pack            | Immutable quiz/presentation versions, citations, imports/exports         | Pack schema/version, item relationship roles, update-review metadata    | Published content is immutable                                        |
| Question Health          | Report aggregates, confidence, response time, version IDs                | Versioned quality observations and rule outcomes; async aggregation     | No individual ability score or automatic content rewrite              |
| Delayed trail            | Practice/follow-up attempts, access hashes, expiry, revocation           | Relation type and evidence window for delayed probes; decision timeline | No participant email/account required; show attrition                 |
| Concept Health           | Concept keys, versioned reports, retention, RLS                          | Thresholded workspace aggregates or asynchronously built summaries      | Minimum samples, bounded filters, no guest-level longitudinal profile |
| Verified mode            | OIDC/LTI foundation, audit, regional/retention controls                  | NRPS/AGS, identity-mode stamp, roster link, delivery idempotency        | Contract-gated and structurally separate from Learning mode           |

Use expand-and-contract migrations and schema versions. A completed session must always be
renderable from its frozen content, rules, theme, trust mode, response schema, and report version.

Keep AI out of the server-authoritative live decision path. It may draft a Recovery Pack, group
moderator-visible open text in a future experiment, or suggest a post-session revision, but:

- participant answers must not be sent to a provider by default;
- every provider boundary needs an explicit data-purpose and retention review;
- generated material remains a draft;
- deterministic fallback remains available to self-hosted and provider-disabled deployments; and
- the host—not an opaque model—chooses the intervention.

## Validation program

### Who to recruit

- Six higher-education instructors: at least three concept-heavy STEM/health and three other
  disciplines, including one class above 100 participants.
- Six workplace facilitators: technical, safety, compliance, or product training, excluding a
  workflow that legally requires certification until Verified mode exists.
- At least six participants who use accessibility accommodations or assistive technology.
- Two instructional technologists/LMS administrators and two accessibility, privacy, procurement,
  or security stakeholders.

### Test real work, not preference lists

Ask each facilitator to bring the most recent session artifact and complete these tasks:

1. Turn one existing concept into a diagnostic and different recheck.
2. Run it beside the actual deck or material.
3. Respond to a deliberately split or confidently wrong room.
4. Find what remains unresolved in the report.
5. Create and distribute an accountless delayed probe.
6. Decide whether they would replace their current tool, add Polling Pops beside it, or not use it.

Measure preparation time, context switches, join/save/reconnect failures, time from lock to action,
intervention-to-recheck completion, report retrieval, delayed-probe completion, second-session use,
and willingness to pay. Keep participant content and identity out of repository evidence files.

### Decision gates

| Hypothesis                                    | Evidence to continue                                                                              | If it fails                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| “What next?” is a recurring pain              | At least 8/12 facilitators describe it unprompted or from a recent example                        | Reframe toward authoring quality or a narrower vertical before more recovery features |
| Companion removes adoption friction           | At least 80% launch and return uncoached; at least half prefer it to rebuilding a deck            | Keep deep links/import only; do not build native add-ins                              |
| Recovery Pack saves preparation               | Median preparation falls by at least 30% without a higher correction/invalid-item rate            | Simplify the pack and improve examples rather than adding AI breadth                  |
| Question Health produces trusted advice       | At least 70% of reviewed flags are useful and lead to a retained revision or deliberate dismissal | Remove weak rules; never mask false positives with an overall score                   |
| Delayed evidence changes a decision           | At least half of pilot facilitators act on the result and completion is at least 40%              | Keep manual follow-up links; defer scheduling and longitudinal views                  |
| Cross-session Concept Health is interpretable | Users identify the unresolved concept and explain limitations in under 45 seconds                 | Return to per-session reports and improve concept metadata                            |
| A vertical justifies identified mode          | Two named institutions require it for paid pilots and accept the privacy/contract model           | Keep Learning mode anonymous and defer NRPS/AGS                                       |

## Product and business measures

### North-star workflow measure

**Weekly returning facilitators completing at least one evidence-complete recovery loop.** An
evidence-complete loop contains an initial diagnostic, a recorded intervention, a valid linked
recheck answered by a sufficient sample, and a viewed reconciled report.

Track the eligible-session completion percentage underneath it. The returning-facilitator measure
combines the intended workflow with repeat value; neither measure rewards a high recovery rate,
which could be gamed with easy rechecks.

### Outcome measures

- Time from lock to an understood next action.
- Share of high-confidence misconception signals followed by a relevant action.
- Immediate linked-recheck recovery with numerator, denominator, and sample warning.
- Delayed-probe completion, retained understanding, and attrition.
- Percentage of unresolved concepts that receive a follow-up.
- Four-week facilitator repeat use and Recovery Pack reuse.
- Question Health flag usefulness, revision rate, and later stability.
- Create-from-source correction rate, citation validity, latency, and provider cost.

### Reliability and trust measures

- Valid join completion and first-response completion without help.
- Durable answer receipt p95/p99, reconnect success, and report reconciliation.
- Participant/device/network failures by supported profile.
- Critical/serious accessibility defects and manual assistive-technology completion.
- Retention/deletion backlog, access expiry, moderation response, and privacy incidents.
- Support contacts and facilitator recoverability during a live session.

Do not use time-on-product, raw question count, leaderboard activity, or recovery percentage alone
as the primary success measure.

## Packaging hypothesis

| Edition     | Direction after evidence                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Community   | Apache-2.0, operator-configured scale, core Recovery Packs/Trail and exports included; operator owns infrastructure/support     |
| Hosted Free | Target 50 participants, five published Rounds/Packs, core Recovery Loop, bounded reports and source authoring                   |
| Hosted Pro  | Target 250 participants, collaboration, companion controls, longer retention, exports, branding, assignments, and pack insights |
| Institution | Verified mode, SSO/LTI/roster/grade policy, region/retention/audit, accessibility/security package, support and contract        |

Do not paywall the basic recovery engine in Community or Hosted Free. Monetize team/admin workflow,
scale, integrations, retention, governance, support, and metered provider costs. Validate the
current price hypothesis with real willingness-to-switch interviews rather than matching a
competitor's per-host price.

## Explicit deferrals

Do not schedule these without new evidence:

- a public content marketplace or creator commerce;
- a full slide editor, freeform design canvas, or template race;
- native PowerPoint/Google Slides add-ins before the companion proves demand;
- an arcade economy, collectibles, persistent learner avatars, or many game modes;
- generic AI chat or an opaque live AI facilitator that chooses interventions;
- open-text grading or a public word cloud before moderation, retention, and evaluation are proven;
- attendance/geolocation surveillance in private Learning mode;
- real-time coauthoring before version-aware pack reuse and Group lifecycle basics;
- native mobile apps;
- a 1,000-person single-event claim before a multi-host architecture and evidence exist; or
- K–12 institutional sales before child-privacy, roster, contracting, support, and counsel gates.

## Principal risks and controls

| Risk                                                   | Control                                                                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Competitors converge on recovery language              | Differentiate on the integrated evidence chain, privacy model, deterministic decisions, portability, and transparent limits |
| Roadmap becomes another feature-parity list            | Cap the parity lane; every item needs observed job evidence and a maintained non-goal                                       |
| AI produces polished but invalid questions             | Source citations, Question Health, human approval, corpus evaluation, immutable versions, and measured correction rate      |
| Longitudinal views become learner surveillance         | Aggregate concepts, minimum cohorts, bounded filters, no guest profile, explicit Verified mode                              |
| Recovery is mistaken for causality or lasting learning | Distinguish revote/recheck/delayed evidence, show attrition, and use careful language                                       |
| Slide integration destabilizes live sessions           | Browser companion first, scoped credentials, mature realtime path, fallback controls, and observed-device tests             |
| Institution work consumes the roadmap                  | Require two named paid-pilot partners and run it as a separate conditional lane                                             |
| Large files and coupled contracts slow safe change     | Split touched boundaries, preserve shared contracts, add compatibility fixtures, and avoid parallel engines                 |
| Higher free limits create support or abuse exposure    | Target-host load/cost/abuse/support evidence before public cap changes                                                      |

## Sources

### Polling Pops evidence

- [Current implementation](../README.md)
- [Product and experience design](design.md)
- [User guide](user-guide.md)
- [Implementation status](implementation-status.md)
- [Architecture](architecture.md)
- [Release-readiness ledger](release-readiness.json)
- [Beta usability evidence template](evidence/beta-usability.md)
- [Design-partner interview template](evidence/design-partner-interview.md)
- [Earlier competitive strategy](competitive-strategy-and-roadmap.md)
- [2026 Kahoot-alternatives UX plan](kahoot-alternatives-2026-ux-gap-plan.md)

### Current competitor and market material

- [Wooclap peer learning](https://www.wooclap.com/en/peer-learning/),
  [AI live facilitation](https://www.wooclap.com/en/ai-live-facilitator/), and
  [features](https://www.wooclap.com/en/features/)
- [Learning Catalytics groups and teams](https://help.pearsoncmg.com/learning_catalytics/instructor/en/Content/Topics/get_ready_to_deliver_lc/lc_groups.htm)
  and [module types](https://help.pearsoncmg.com/learning_catalytics/instructor/en/Content/Topics/assignment_creation/module_types/lc_modules.htm)
- [iClicker product](https://www.iclicker.com/) and
  [accessibility](https://www.iclicker.com/accessibility/)
- [Wayground plans](https://help.wayground.com/support/solutions/articles/158000403874-understanding-wayground-plans)
  and [accommodations](https://help.wayground.com/support/solutions/articles/158000404955-accommodations-available-on-wayground)
- [Vevox before/after comparisons](https://help.vevox.com/hc/en-us/articles/22996157485213-Create-before-and-after-comparisons)
  and [education plans](https://www.vevox.com/pricing/education-pricing)
- [Formative real-time instruction](https://www.formative.com/teachers) and
  [2026 follow-up features](https://www.formative.com/back-to-school)
- [Quizalize differentiation and follow-up](https://www.quizalize.com/)
- [Nearpod delivery modes](https://nearpod.com/how-nearpod-works/)
- [Pear Deck plans and accessibility](https://www.peardeck.com/pricing)
- [Kahoot! assessment workflow](https://kahoot.com/schools/assessment/) and
  [learning-science guidance](https://kahoot.com/blog/2026/03/18/kahoot-impact-the-science-of-learning-behind-every-kahoot-game/)
- [Mentimeter features](https://www.mentimeter.com/features),
  [Slido product](https://www.slido.com/product),
  [Poll Everywhere plans](https://www.polleverywhere.com/plans),
  [AhaSlides features](https://ahaslides.com/features/), and
  [ClassPoint](https://classpoint.io/)
- [Particify](https://www.particify.de/en/help/),
  [ClassQuiz self-hosting](https://www.classquiz.de/docs/self-host), and
  [Plickers device-free participation](https://help.plickers.com/hc/en-us/articles/360009395854-What-is-Plickers)

### User-needs and review evidence

- [Jisc 2024–25 higher-education student digital experience findings](https://digitalinsights.jisc.ac.uk/reports-and-briefings/our-reports/2024-25-uk-higher-education-students-digital-experience-insights-survey-findings/)
- [Mentimeter reviews](https://www.g2.com/products/mentimeter/reviews?qs=pros-and-cons),
  [Wooclap reviews](https://www.g2.com/products/wooclap/reviews),
  [Poll Everywhere reviews](https://www.g2.com/products/poll-everywhere/reviews), and
  [Slido reviews](https://www.g2.com/products/slido/reviews)
- [Accessibility in technology acquisition with HECVAT 4](https://er.educause.edu/articles/2025/4/accessibility-in-technology-acquisition-with-hecvat-4)
- [2025 workplace learning and development challenges](https://assets.trainingindustry.com/content/uploads/2025/04/Learning-and-Development-Challenges-Report-2025-Watermark-1.pdf)

### Learning and evaluation research

- [Peer discussion and confidence](https://pmc.ncbi.nlm.nih.gov/articles/PMC7145884/)
- [Peer discussion plus instructor explanation](https://pmc.ncbi.nlm.nih.gov/articles/PMC3046888/)
- [Retrieval practice in classroom settings](https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2019.00005/full)
- [Confidence/certainty-based formative assessment](https://pmc.ncbi.nlm.nih.gov/articles/PMC6544949/)
- [Displaying class results can bias a second vote](https://pubmed.ncbi.nlm.nih.gov/20516358/)
- [Generative-AI multiple-choice question quality evaluation](https://researchconnect.suny.edu/en/publications/an-effectiveness-study-of-generative-artificial-intelligence-tool/)
- [CDC training-effectiveness evaluation guidance](https://www.cdc.gov/training-development/php/about/evaluate-training-measuring-effectiveness.html)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
