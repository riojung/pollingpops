# Polling Pops customer needs and differentiation backlog — round 2

Captured: 2026-10-27 · Repository baseline: `main` at `948d515`

This backlog turns the [October competitor research](competitor-research-2026-10-27.md) into
scoped discovery and delivery candidates. The product owner requested research and backlog
creation, not implementation. **Every feature increment below remains Deferred.** R2-00 continues
the existing evidence campaign. Priorities express evaluation order, not an approved schedule.
The stable product idea register remains [future product ideas](future-product-ideas.md).

**Subsequent product-owner selection:** [IDEA-016 competition dashboard](idea-016-competition-dashboard-plan.md)
is a separate **High / P1** request selected for implementation after this research. It improves
the existing leaderboard and is implemented locally. The twelve research candidates below retain
their existing statuses; this selection does not close their evidence or release gates.

## Decisions and evidence rules

Keep two benefits together: remove a customer's practical workflow blocker, and make the
Ask → Diagnose → Intervene → Recheck → Prove chain easier to run and substantiate. More question
types, AI generation, anonymous joining, peer discussion, accessible exports, or asynchronous
delivery alone are established market capabilities.

Evidence labels used below:

- **D — direct external demand:** a dated first-person public request. It proves that person's
  problem, not prevalence, willingness to pay, a current competitor omission, or demand from our customers.
- **S — sector evidence:** research or an institution's own user evaluations. Relevant context,
  with geography, population and sampling limits.
- **M — market capability:** current first-party competitor documentation. Establishes an
  expectation or comparison boundary, not customer demand.
- **H — hypothesis:** our proposed solution or benefit. Requires Polling Pops observation.

There is no newly collected Polling Pops customer evidence in this round. The
[Phase 0 decision](evidence/phase0-stage-decision.md) remains pending. Public requests, votes and
vendor announcements cannot close it. Do not manufacture reach, revenue, RICE scores or dates.

**Selection rule:** complete the existing campaign and use its ordered Access/Companion decision.
Then fund one measured workflow blocker and one differentiated experiment, within the existing
capacity envelope. The per-ticket selection signals below are proposed additional discovery
criteria; they do not relax or replace existing gates. Freeze task populations and success
thresholds before running a study, and retain failures and exclusions.

**Complexity:** S = bounded UX/evidence work; M = multiple connected surfaces or services;
L = new protocol, privacy model or longitudinal behavior. These are rough relative judgments,
not estimates in weeks. Owner entries identify a responsible role to assign, not a person.

## Prioritized items

| Ticket | Parent                        | Priority                     | Candidate                                                  | Evidence                            | Complexity | Responsible role                        |
| ------ | ----------------------------- | ---------------------------- | ---------------------------------------------------------- | ----------------------------------- | ---------- | --------------------------------------- |
| R2-00  | Existing Phase 0 campaign     | P0                           | Establish demand and select the next increment             | Existing evidence gap               | S          | Product research + independent reviewer |
| R2-01  | IDEA-009                      | P1, Access branch            | Validate and improve participation recovery guidance       | S + H                               | M          | Realtime + product design               |
| R2-02  | IDEA-007 extension            | P1, Companion branch         | Finish the existing-deck recovery workflow                 | M + H; older adjacent D             | M          | Presentation + product design           |
| R2-03  | IDEA-004 extension            | P1, only if observed blocker | Bring selected response formats to the next needed surface | M + H                               | L          | Contracts + live experience             |
| R2-04  | IDEA-008 extension            | P1 differentiated experiment | Concierge-test a bounded Recovery Trail                    | M + H; adjacent D                   | L          | Learning evidence + reporting           |
| R2-05  | IDEA-010                      | P2, Access option            | Offer private live extra-time accommodations               | M + H                               | L          | Realtime + accessibility                |
| R2-06  | IDEA-011                      | P2                           | Deliver reviewed multilingual question and recheck content | D + M + H                           | L          | Authoring + localization                |
| R2-07  | IDEA-012                      | P2                           | Support accessible structured peer discussion              | M + H                               | L          | Learning design + live experience       |
| R2-08  | IDEA-013                      | P2                           | Carry board priorities into documented decisions           | D for prioritization; H for actions | M          | Boards + reporting                      |
| R2-09  | IDEA-014                      | P2                           | Keep moderated anonymous Q&A open around a meeting         | S + M + H                           | L          | Audience interaction + privacy          |
| R2-10  | IDEA-015, related to IDEA-008 | P2                           | Compare equivalent cohorts with visible evidence limits    | D + M + H                           | M          | Reporting + learning evidence           |
| R2-11  | IDEA-005 extension            | P3, reconfirm demand         | Deliver a frozen aggregate summary to Google Sheets        | Historical D + H                    | M          | Reporting + integrations                |

### R2-00 Establish demand and select the next increment

**Problem:** the repository has substantial implemented capability, but the evidence record does
not yet establish which customer workflow is most costly or which new increment will change buying
or repeat-use decisions. Broad feature requests alone would create an unbounded catch-up roadmap.

**Scope:** use the existing [interview record](evidence/design-partner-interview.md),
[campaign](runbooks/phase0-evidence-campaign.md), and decision record. Associate each candidate with
pseudonymous partner/workflow references, the observed workaround, frequency, consequence,
requested outcome, current alternative, procurement constraint, and willingness to pilot/pay.
Use the existing feedback collection and operator triage rather than building another intake form.

**Acceptance criteria:**

- The existing campaign's twelve-facilitator cohort, repeat-partner, ten-session, usability,
  evidence-completeness and independent-review requirements are evaluated without relaxing them.
- Findings distinguish a missing capability from an implemented feature participants could not
  discover or use. Test first-use explanation → intervention → different recheck, standalone
  practice for a multi-site training task, and an accessible summary download.
- Each considered ticket records supporting and contrary evidence, eligible denominators,
  existing workarounds and a disposition: select, revise, retain, or reject. Unresolved records stay pending.
- Segment and Phase 1 branch selection follow the existing ordered rules. No market-research
  document marks a release gate passed. Raw identities, answers and private notes stay outside Git.

**Measure/decision:** use the established campaign targets, not a second competing scoring model.
Record first-use completion, repeat use and willingness to pay with their denominators. New feature
delivery is selected separately after the evidence supports it. Dependencies: named research owner,
independent reviewer, approved private evidence system and an eligible pilot build.

### R2-01 Participation recovery guidance

**Parent/status:** IDEA-009 · Deferred · P1 only if the Access branch is selected.

**Customer job:** complete a response despite unstable connectivity and understand whether it was
accepted. Facilitators need to distinguish a delivery problem from confusion or voluntary nonresponse.
Jisc's [2025/26 student survey](https://repository.jisc.ac.uk/10586/1/DEI-2026-student-he-report.pdf)
supports the problem context; the proposed product treatment is H.

**Existing foundation:** durable acknowledgement, reconnect snapshots, room readiness, Companion
room health, and whole-room flex already exist. This is an observed-friction increment, not a new
realtime engine, offline voting system, or duplicate connectivity dashboard.

**Smallest scope:** test those existing paths on representative mobile networks; add only missing
state explanations, stale-sample disclosure and recovery actions. If the current paths work unassisted, close the feature
candidate and retain the evidence. Any new aggregate host signal must distinguish server-confirmed
receipts from connection presence and must not guess why a participant did not answer.

**Acceptance criteria:**

- A lost acknowledgement followed by refresh restores the authoritative receipt without duplicate
  scoring. An unconfirmed local attempt is never described as saved.
- Timeout, reconnect, expired room and closed response window give distinct, accessible next steps.
  Connectivity failure is not classified as a wrong answer or a misconception.
- Any host guidance uses the existing privacy threshold and reveals neither participant choices
  nor individual accommodation status. Test what the host sees when only one learner disconnects.
- Existing connected/answered counts disclose freshness when synchronization is stale. Guidance
  offers a bounded next action, such as waiting for reconciliation or using whole-room flex,
  without treating stale counts as current or promising offline submission.
- Slow-network media failure preserves the question's text/alternative content where meaningful;
  a content-dependent image question explains its limitation instead of fabricating equivalence.

**Measure/selection:** compare unassisted recovery and acknowledged eligible response opportunities
before/after; retain timeouts in the denominator. Use the existing Access gate: three affected partner
workflows, at least 10% affected attempts, or a serious accessibility finding. Dependencies: current
realtime helpers, host/player/Companion surfaces, manual device and assistive-technology review.

### R2-02 Finish the existing-deck recovery workflow

**Parent/status:** IDEA-007 extension · Deferred · P1 only if the Companion branch is selected.

**Customer job:** run a planned explanation and linked recheck beside an existing deck without
losing the audience or exposing backstage controls. Competitors already offer
[PowerPoint add-ins](https://help.mentimeter.com/en/articles/1720503-add-and-present-mentimeter-slides-in-the-powerpoint-add-in)
and [slide-independent overlays](https://support.polleverywhere.com/pe2/poll-everywhere-live-app-install-setup).
The [offline-authoring request](https://mentimeter.canny.io/feature-requests/p/powerpoint-plugin-offline)
is older and concerns preparation; it does not establish demand for offline live hosting.

**Existing foundation:** browser Companion, join/result overlays, text-only Pack insertion, selected
card playback, frozen published questions and a provisional Quick Check. Native slide add-ins remain
the separate IDEA-007 option.

**Smallest scope:** validate focus return, screen sharing and cohost handoff first. If text-only
insertion blocks observed teaching, extend it to scanned media-backed Recovery Packs with
session-owned media provenance and retention. Select that increment independently of native add-ins.

**Acceptance criteria:**

- A facilitator using PowerPoint or Slides can open a prepared check, run its linked recheck and
  return to the deck without revealing staff-only data; a restricted managed-machine path is tested.
- Media inserted into the session remains bound to the selected immutable source and cannot be
  silently changed by later Pack edits. Authorization, alternative text, deletion and retention
  apply to the session-owned copy; unavailable media has an explicit host-visible failure state.
- Disconnect and cohost takeover preserve authoritative phase and exactly-once commands.
- No deck import or native add-in is required for the selected browser workflow.

**Measure/selection:** the existing Companion gate requires Access to fail, four repeat external-deck
facilitators and two observed sessions with material switching interruptions. Measure complete
recovery-loop task success and interruptions; require three paying design partners before selecting
native add-in development under the existing roadmap. Dependencies: Companion routes,
`presentation-live-recovery-packs.ts`, media authorization and real screen-sharing observation.

### R2-03 Response formats on the next needed surface

**Parent/status:** IDEA-004 extension · Deferred · P1 only for an observed mixed-format blocker.

**Customer job:** collect explanations and priorities in a Presentation or Survey without switching
artifacts. [Slido's product](https://www.slido.com/product) and
[Poll Everywhere's feature set](https://support.polleverywhere.com/pe2/key-features-) support M;
this round did not establish direct demand for Polling Pops' exact surface expansion.

**Existing foundation:** Live Round multiple-selection opinion polls, ranking, moderated open text
and word clouds are implemented. Surveys already support multiple-selection opinions. The
[IDEA-004 plan](idea-004-response-formats-plan.md) explicitly defers other surfaces.

**Smallest scope:** select one surface and the minimum formats demonstrated by partner workflows.
For example, Presentation ranking/text/cloud is one increment; Survey ranking/moderated text is
another. Do not inherit formats automatically from the shared question union.

**Acceptance criteria:**

- A format has an explicit supported-surface decision across authoring, preview, publication,
  client negotiation, response receipt, reconnect, moderation, report and export. Unsupported
  combinations fail clearly before hosting.
- Opinion responses earn zero points and stay outside correctness and recovery denominators.
  Multi-select percentages use respondents; ranking supports keyboard controls and disclosed ties.
- Pending/removed text never appears in public results, reconnect payloads or ordinary summaries.
  Each surface preserves its identity policy, reveal boundary and minimum aggregate sample.
- Existing immutable artifacts and room clients retain their compatibility path. Rollout remains gated.

**Measure/selection:** select only after partner observation shows the existing Round or Board
workaround prevents a necessary task. Pre-register completion and switching-friction targets.
Dependencies: per-surface versioned contracts, persistence, moderation and report semantics.

### R2-04 Bounded multi-stage Recovery Trail

**Parent/status:** IDEA-008 extension · Deferred · P1 differentiated experiment after workflow fit.

**Customer job:** learn whether an immediate improvement persists on a later, meaningfully different
task and decide what to teach next. [AhaSlides Courses](https://community.ahaslides.com/t/ahaslides-now-does-elearning-introducing-courses/281)
shows that self-paced learning is already competitive territory. A recent
[self-guided safety quiz request](https://community.slido.com/ideas/self-guided-quiz-8720) supports
an adjacent training job; it does not prove demand for a longitudinal Trail.

**Existing foundation:** linked immediate rechecks, accountless practice/follow-ups, Pack delayed
probes and full-sequence practice, decision replay and aggregate exports. Pack practice is unpaired
to source-session participants. Do not recreate practice or label existing unpaired attempts as matched.

**Smallest scope:** a concierge experiment using existing delayed probes: one versioned concept/Pack,
one facilitator-selected later window and one delayed transfer probe. This does not select a new
Trail engine. Start with explicit aggregate/unpaired evidence. Any optional within-Trail pairing
needs a separately reviewed, purpose-limited access model before implementation; no global learner ID.

**Acceptance criteria:**

- The evidence view preserves source/question version, intervention, immediate recheck and delayed
  probe, with denominators, eligible population, nonresponse and attrition visible at each stage.
- Different-question and timing metadata are visible. Repeated-question change, immediate recovery,
  delayed retention and transfer are separately labelled; none implies causal effectiveness.
- Unpaired cohorts cannot generate person-level recovery rates. Insufficient samples remain
  suppressed; exports retain the same limitations as the screen.
- Facilitators can close/revoke access and delete retained data. No unsolicited email, meeting
  message, persistent identity or certification is introduced by this experiment.

**Measure/selection:** have partners choose a next teaching action from the evidence and explain
its limits unassisted. Record eligible completion/attrition, interpretation errors and repeat use.
The [existing later-horizon gate](market-research-and-development-plan-2026-09.md#later-horizon-a--connect-immediate-recovery-to-later-evidence)
remains mandatory: full Trail development stays outside the first 24-week commitment and starts
only if at least 30% of eligible pilot sessions issue the concierge delayed check, at least 50%
of invited participants complete it, and facilitators use it to change a later action. Later exit
criteria also retain the documented 40% delayed-probe completion (or a credible researched workflow
change) and at least half of pilot facilitators choosing a next action. Pre-registered experiment
thresholds supplement these gates. Dependencies: R2-00, valid alternate-probe review,
practice/reporting models and privacy review of any proposed pairing.

### R2-05 Private live extra-time accommodations

**Parent/status:** IDEA-010 · Deferred · P2 Access option.

**Customer job:** receive necessary additional response time without public disclosure or seeing
the answer before submitting. [Wayground accommodations](https://help.wayground.com/support/solutions/articles/158000404955-accommodations-available-on-wayground)
establish M, not a unique Polling Pops proposition or validated demand for a guest-pass design.

**Existing foundation:** whole-room flex and self-paced 1.5×/2× passes already exist. Live individual
passes remain deferred because reveal, privacy and fairness affect the whole room.

**Smallest scope:** prototype a session-scoped, reason-free live pass. Compare it with existing flex;
prefer flex if it solves the observed need. Scope any implementation to unscored/private-result
recovery sessions first, pending an explicit timing and reveal policy.

**Acceptance criteria:**

- Participants see only their own timing entitlement. Peers and presenter views reveal neither
  pass holder nor reason; the product does not collect a disability diagnosis.
- The server enforces the selected deadline/reveal policy through reconnect, pause, host close,
  revocation and retry. Answers/results cannot leak while a valid extended window remains open.
- The host understands the room's remaining response window without identifying recipients.
- A participant can complete the path with keyboard and assistive technology; the study includes
  stigma and fairness comprehension, not just successful timer execution.

**Measure/selection:** require an observed exclusion that flex does not resolve, plus approved
reveal/privacy rules before build selection. Measure eligible response completion, public inference
risk and host misunderstanding. Dependencies: Access decision, engine timing/projections and manual review.

### R2-06 Reviewed multilingual question and recheck content

**Parent/status:** IDEA-011 · Deferred · P2.

**Customer job:** answer the same checkpoint in a chosen language while the facilitator sees one
coherent result. The [public multilingual-poll request](https://mentimeter.canny.io/feature-requests/p/more-than-one-language-at-a-time)
began in 2020 and includes a January 2026 comment. Mentimeter's
[UI language settings](https://help.mentimeter.com/en/articles/465592-how-can-i-change-the-language-in-mentimeter)
are distinct from translated authored content; Wayground already documents content translation.

**Existing foundation:** ten Polling Pops interface/summary locales. That is not a versioned set of
human-reviewed question, explanation, misconception and linked-recheck translations.

**Smallest scope:** manually authored and reviewed translations for one partner's two languages.
Preserve stable choice/concept IDs across translations; show explicit fallback when a translation
is unavailable. Automatic translation and multilingual free-text clustering are later options.

**Acceptance criteria:**

- Participants can change supported content language without losing the accepted response or
  changing question/choice identity. Confidence and submission controls remain localized.
- Publication freezes the translation set and reviewer approval. Source edits invalidate affected
  translation approvals; missing content never appears silently as a reviewed translation.
- Explanations and alternate rechecks receive equivalent human review. Reports disclose languages
  offered and avoid claiming psychometric equivalence across translations without evidence.
- Text direction, fonts and assistive pronunciation are tested for selected languages. Supporting
  one language pair does not advertise complete RTL or automatic translation support.

**Measure/selection:** recruit partners with mixed-language sessions; validate comprehension,
translation review burden, participation and pooled-result interpretation. Build only if a single
reviewed bilingual workflow solves an observed recurring barrier. Dependencies: content schemas,
translation review/versioning and qualified language reviewers.

### R2-07 Accessible structured peer discussion

**Parent/status:** IDEA-012 · Deferred · P2.

**Customer job:** use discussion to repair reasoning, then answer a different question independently.
[Wooclap peer learning](https://www.wooclap.com/en/peer-learning/) already supports the broad method.
The differentiated hypothesis is a usable, private discussion-to-evidence chain.

**Existing foundation:** intervention tracking, re-voting, linked rechecks and live facilitator
controls. Workspace Groups are not a session team-assignment or peer-discussion delivery system.

**Smallest scope:** facilitator-controlled pairs or self-chosen small groups, a clear discussion
prompt, a nonverbal/solo alternative, then an individual linked recheck. Defer algorithmic grouping,
breakout-room integration, team scores and persistent social profiles.

**Acceptance criteria:**

- Hosts start/close discussion and proceed to the linked different question through legal engine
  phases. No participant sees a peer's correctness, confidence or misconception label by default.
- Everyone can choose an equivalent solo/text-based path; instructions work with keyboard,
  screen readers and low-bandwidth devices without requiring speech or audio.
- Recheck answers remain individual and independently acknowledged. Reports separate group
  activity from individual evidence and record the facilitator's action without claiming causality.
- Late join, group absence and reconnect do not expose answers or prevent the alternative path.

**Measure/selection:** validate three partner workflows using peer instruction and observe a
delivery blocker beyond the existing intervention controls. Measure equitable task completion,
host effort and evidence interpretation before choosing automated grouping. Dependencies: learning
design, live phases/projections and accessibility review.

### R2-08 Board priorities into documented decisions

**Parent/status:** IDEA-013 · Deferred · P2; extends IDEA-006 rather than replacing it.

**Customer job:** carry a workshop's selected priorities into an explainable next step. The
[September 2026 categorized-ideas-to-ranking request](https://community.slido.com/ideas/using-categorize-results-from-an-idea-slide-to-prepopulate-a-ranking-slide-for-those-results-8590)
is D for the prioritization transition. Action owners, due dates and follow-through are H.

**Existing foundation:** moderated rich ideas, manual groups, frozen private ballots and aggregate
totals. Test that workflow first; no new generic board, drawing canvas or voting engine is needed.

**Smallest scope:** a facilitator-approved decision record referencing a closed board's frozen
priorities, with a plain-text rationale and next action. Add an internal action owner or target date
only if partners need them. Shared board summaries require a separate explicit sharing boundary.

**Acceptance criteria:**

- Decisions link to the exact closed board/priority snapshot and preserve ballot integrity.
  Facilitator choices may differ from popularity, with the rationale visible.
- Summary/export projections include approved content and aggregate totals only; they never
  reveal ballots, guest credentials, pending ideas or unapproved attachments.
- Corrections are versioned, and access/retention/deletion remain enforceable. External messages
  and task creation require separately authorized integrations.
- Reports call votes expressed preferences, not comprehension or learning recovery.

**Measure/selection:** observe whether facilitators can already finish prioritization, then validate
the missing handoff with workshop owners. Measure manual copying and decision clarity. If no action
handoff problem appears, retain the existing boards and reject the extra scope. Dependencies:
board lifecycle, summary authorization and explicit owner/editor permissions.

### R2-09 Moderated anonymous Q&A around a meeting

**Parent/status:** IDEA-014 · Deferred · P2.

**Customer job:** ask a sensitive question before or after a session and see whether it was addressed.
[University of York user evaluations](https://vle-support.york.ac.uk/other-tools/mentimeter/anonymity/)
support the value of anonymity and the need for moderation. They do not validate our proposed
persistent-room model. [Mentimeter Q&A](https://www.mentimeter.com/features/live-questions-and-answers)
establishes a market expectation, not a unique feature claim.

**Existing foundation:** moderated Round Q&A and separate scoped Presentation interaction.
Learning-session aliases can be facilitator-visible. The `feedback_room` scope enum is scaffolding,
not an implemented standalone anonymous room.

**Smallest scope:** one standalone Q&A room with a defined collection window, immutable identity
policy, moderation, upvotes and answered/unanswered states. Keep it independent of a live Round's
finish time. Clarify organizer-blind versus public-alias-hidden behavior before admission.

**Acceptance criteria:**

- Guests see who can see their identity/content before posting. An anonymous policy cannot
  later be changed to reveal prior authors. Do not promise technical untraceability.
- Moderation/revocation, abuse limits, close/expiry and deletion work before, during and after
  a meeting. Pending content is private; admitted readers understand approved text is shared content.
- A cohost can curate and mark answered without exposing backstage queues on a shared screen.
- Exports preserve unanswered follow-up work and the room's privacy policy, without guest
  credentials or identity correlation to learning sessions.

**Measure/selection:** demonstrate a recurring sensitive pre/post-session Q&A job that the existing
Presentation Q&A or Board cannot satisfy. Measure participation, moderation effort and privacy
comprehension; reject the room if abuse/support costs outweigh the observed benefit. Dependencies:
scoped interaction contracts, privacy/admission model and moderation operations.

### R2-10 Comparable cohort evidence

**Parent/status:** IDEA-015 · Deferred · P2; related to IDEA-008, with no persistent learner tracking.

**Customer job:** compare repeated deliveries and decide which concept or explanation to revise
without manually reconciling spreadsheets. The
[October 2025 comparison request](https://mentimeter.canny.io/feature-requests/p/compare-results-across-sessions-after-clear-results)
is direct workflow evidence. [Poll Everywhere reports](https://support.polleverywhere.com/pe2/creating-a-report-view-)
already span dates/questions, so cross-session reporting alone is not differentiation.

**Existing foundation:** immutable published versions, separate session histories, per-session
recovery evidence and summaries. Question Health already aggregates exact-version post-use reports
by trust, timing and scoring, with at least twenty responses per eligible session; this is not a
first cross-session aggregation engine. New sessions already isolate groups; a reset engine
is unnecessary. The [repeat-class request](https://community.slido.com/ideas/clear-voting-results-as-the-presentation-ends-8622)
supports testing rerun discoverability; its requester accepted Slido's existing bulk-reset workaround.

**Smallest scope:** compare two or more retained sessions from the same immutable Round/Pack
version. Show aggregate concept/checkpoint counts, intervention and recheck availability; allow
the facilitator to understand a missing or incomparable cell. Extend existing Question Health
eligibility and aggregation primitives instead of duplicating them; the new scope is an explicit
facilitator comparison of recovery evidence, not another accuracy-range advisory.

**Acceptance criteria:**

- Different content versions, question purposes, timing modes or unmatched rechecks are labelled;
  the system never silently pools incomparable accuracy/recovery rates.
- Each cohort exposes eligible/responding counts, small-sample suppression, missing evidence
  and selection/attrition caveats. Group differences never imply a causal intervention effect.
- No participant is tracked across sessions. Filters/exports cannot reveal suppressed groups
  through subtraction or arbitrary overlapping cohorts; compare fixed sessions first.
- Deletion or expired source data removes its contribution. Running again creates a new session
  and preserves earlier results rather than clearing them.

**Measure/selection:** ask repeat facilitators to choose a teaching revision using comparison;
record time spent, interpretation errors and repeat use. Select only if current session summaries
and spreadsheet exports cause recurring material work. Dependencies: version/concept binding,
privacy-safe aggregation and reporting; optional program-wide Concept Health remains later scope.
Any expansion to program-wide Concept Health retains the [later-horizon B prerequisites](market-research-and-development-plan-2026-09.md#later-horizon-b--privacy-safe-program-insight),
including following Recovery Trail, meaningful concept metadata on at least 60% of reused pilot
content, and finding/explaining the main unresolved concept and its limits in under 45 seconds.

### R2-11 Aggregate delivery to Google Sheets

**Parent/status:** IDEA-005 extension · Deferred · P3 until demand is reconfirmed.

**Customer job:** reuse a session's outcomes in a client or training report without repeatedly
copying exports. The [trainer's Sheets request](https://mentimeter.canny.io/feature-requests/p/google-sheet-integration-for-results)
dates to 2019; it is historical demand, not proof of current urgency or a current competitor gap.

**Existing foundation:** revocable aggregate summary links and tagged/selectable PDF, PNG and XLSX
exports already exist. The renderer has a bounded worker/queue and explicit errors; validate those
paths before adding a new export-job system.

**Smallest scope:** explicit creator-triggered delivery of one frozen aggregate snapshot to one
authorized Sheet, with a preview of the columns and destination. Defer continuous sync, scheduled
messages and arbitrary integration automation.

**Acceptance criteria:**

- Delivery uses a versioned schema containing source version, sample denominators, intervention,
  linked-recheck evidence and limitations wherever those are present in the frozen summary.
- A retried operation is idempotent; users see pending/success/failure and can reconnect access
  without duplicating rows. Exported text cannot become spreadsheet formulas.
- The creator grants least-privilege destination access explicitly. No participant identity,
  pending text or private response is exported by this aggregate path.
- Disconnecting blocks future delivery. The UI explains that an existing copy in Sheets cannot
  be recalled by revoking a Polling Pops link or deleting the source.

**Measure/selection:** reconfirm with three current partners who repeatedly build external reports,
observe the XLSX workaround and compare delivery time/errors. If the existing export is sufficient,
retain that path. Dependencies: Google authorization/provider review, token handling, connector
failure policy and summary source/retention permissions.

## Guardrails and items deliberately left in their existing backlog

- Social sign-in (IDEA-001), meeting embeds (IDEA-002), and a marketplace (IDEA-003) have no new
  customer evidence sufficient to raise them in this round. Their existing entries remain deferred.
- Native slide add-ins stay within IDEA-007 and its paying-partner gate. AhaSlides' editable PPTX
  import does not justify building another slide editor.
- Accessible PDFs, richer Live Round formats, brainstorming media, basic practice, visible receipts,
  ordinary moderation and summaries are implemented foundations, not new feature epics.
- Automatic sentiment diagnosis, fully automatic remediation, public misconception grouping,
  grade sync, certifications, verified learners, device-free scanning and institutional identity
  remain outside these increments. Their separate product, contract and release decisions still apply.

The October 21 implementation checkpoint records all fifteen release-readiness gates as pending.
This research does not revalidate hosted CI or deployment, establish public availability, or change
that ledger. Consult [implementation status](implementation-status.md) and
[release readiness](release-readiness.json) before selecting a pilot or release.
