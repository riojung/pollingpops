# Polling Pops future product ideas

Captured: 2026-10-13

Latest research round: **2026-10-27**. See the [competitor research](competitor-research-2026-10-27.md)
and [twelve prioritized backlog items](competitor-backlog-2026-10-27.md) for evidence, scoped acceptance
criteria, dependencies and selection gates. This round adds IDEA-009–015 and refines remaining work
under IDEA-004, IDEA-005, IDEA-007 and IDEA-008. Those research candidates remain **Deferred**;
no new Polling Pops customer interviews were performed. A subsequent product-owner request selected
**IDEA-016, the high-priority competition dashboard**, for implementation; see its separate status below.

This is the ongoing backlog for customer-facing enhancements we may explore later. Entries are
**deferred ideas** unless a status update below records a separate implementation request.
Capturing an idea does not authorize development or change the existing roadmap and release gates.

## Requested ideas

### Competition leaderboard and winner dashboard

**IDEA-016 · Requested by the product owner on 2026-10-27 · High priority / P1 · Implemented locally**

Improve the existing leaderboard into a competition dashboard during scored Rounds and at their
finish. Show **1st, 2nd and 3rd**, top-five and expandable full standings, each participant's own
position, movement, points behind the leader and points to the next position. Keep final standings
after finish and refresh. Only revealed scores contribute; private sessions and unscored opinion
polls do not expose or invent winners.

The selected increment also improves the Presentation host's staff-only dashboard and each
Presentation participant's own final rank/score. Audience-wide Presentation podiums require a
separate explicit visibility policy. See the [implementation and Slido benchmark](idea-016-competition-dashboard-plan.md)
for behavior, tie rules, compatibility and verification. Local implementation does not establish
deployed availability or close release gates.

The product owner's same-day [Kahoot refinement request](idea-016-kahoot-scoreboard-refinement.md)
extends IDEA-016 with a more expressive podium, graphical race/table views, biggest-climb recognition,
released point gains and correct streaks, and replayable motion-aware celebration. Recognition adds
no bonus points. Rich animated characters, host-scheduled reveal and public Presentation podiums
remain separately scoped follow-ups under the same high-priority idea.

### Social sign in

**IDEA-001 · Requested by the product owner · Deferred**

Let customers sign up and sign in with **Google, Facebook, and Apple** so they can use an existing
account without creating a separate Polling Pops password or repeatedly entering profile details.
Request only the identity information needed, with clear consent.

Keep verified-email PIN sign-in as a fallback and preserve account-free audience participation.
Existing customers should be able to explicitly link or unlink a provider without losing their
workspace or creating duplicate accounts. The current generic institution OIDC foundation is
separate from this customer-facing, multi-provider sign-in experience; see the
[institution integration guide](institution-integrations.md) and
[creator authentication decision](decisions/001-creator-authentication.md).

### Virtual meeting integrations

**IDEA-002 · Requested by the product owner · Deferred**

Integrate with **Zoom, Webex, and Google Meet** so facilitators can run live **Rounds and
Presentations** during virtual or hybrid meetings. Participants should be able to respond with
minimal switching between tools, while hosts control the session and present aggregate results.

Explore an embedded meeting experience where the platform permits it, with a join link or QR
fallback for other devices. Preserve guest participation and make any meeting identity sharing
explicit. Evaluate one provider at a time based on customer demand and platform capabilities.
The [integration gap analysis](slido-feature-gap-analysis-and-development-plan-2026-10.md#presentation-meeting-and-embedding-integrations)
provides related future scope.

### Creator template and theme marketplace

**IDEA-003 · Requested by the product owner · Deferred**

Let creative users publish custom **Round and Presentation templates** and **workspace themes**
that other customers can discover, preview, copy, and apply. Help creators share useful work and
help customers prepare attractive sessions faster.

Start future exploration with free community sharing and curated collections; consider paid
listings and creator revenue only after adoption supports them. Include creator attribution,
clear reuse permissions, accessible theme previews, content reporting, and versioned copies so
creator updates do not silently alter customer work. Shared assets must exclude private session
or participant data.

The built-in starter templates and existing visual presets are foundations. Public creator
publishing, custom workspace theme distribution, and a marketplace are the future expansion.

## Additional suggested ideas

These suggestions were added on 2026-10-13. Several consolidate opportunities already identified
in the roadmap; their existing delivery status and gates still apply.

**IDEA-004 is complete for its selected Live Round scope and merged into main**, following the product owner's
implementation request. Multiple-selection polls, ranking, moderated open text and word clouds
pass the full repository check, PostgreSQL conformance and production-browser journeys. Writers
remain rollout-gated; Presentation/Survey expansion is deferred. See the
[response formats implementation plan](idea-004-response-formats-plan.md) for behavior, evidence
and rollout details. **IDEA-005 is complete for its selected scope and merged into main**, covering Rounds,
Presentations, and Surveys at the product owner's request. See the
[session summaries implementation plan](idea-005-session-summaries-plan.md). A code and test-definition
audit on 2026-10-16 confirmed both selected scopes; rollout and external acceptance remain separate.
IDEA-004's Presentation/Survey expansion and IDEA-005's Google Sheets delivery are still deferred.
**IDEA-006 is implemented and verified locally as of 2026-10-16**; see the
[brainstorming board plan](idea-006-brainstorming-boards-plan.md). Its October 21 follow-up adds
scanned images, a sketch per idea, and website/social link cards. Other ideas remain deferred.

| ID       | Suggested enhancement                           | Customer value and future scope                                                                                                                                                                                 | Existing foundation                                                                                                                                                                                                                                                   |
| -------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDEA-004 | Richer response formats                         | Add moderated open text, word clouds, ranking, and live multiple-selection opinion polls so facilitators can collect explanations and priorities as well as fixed-choice answers.                               | Initial Live Round scope is implemented and gated; Surveys retain existing multiple-selection opinions. See [implementation status](implementation-status.md).                                                                                                        |
| IDEA-005 | Shareable session summaries                     | Offer aggregate report links, PDF summaries, result images, and optional spreadsheet delivery so customers can share outcomes and next steps after a session. Respect audience privacy and sharing permissions. | All three session types are implemented locally with gated, revocable aggregate links and PDF/PNG/XLSX. See the [implementation plan](idea-005-session-summaries-plan.md). Google Sheets delivery remains deferred.                                                   |
| IDEA-006 | Brainstorming and prioritization boards         | Let audiences contribute text, images, sketches and links before, during, or after a meeting; let facilitators moderate, group and prioritize them with optional anonymity.                                     | Standalone moderated boards, manual grouping and private final ballots are implemented; the rich-content follow-up adds scanned images, editable sketches and link cards. Writers remain gated. See the [implementation plan](idea-006-brainstorming-boards-plan.md). |
| IDEA-007 | Native PowerPoint and Google Slides integration | Launch synchronized Polling Pops interactions from familiar slide tools to reduce presentation switching. This complements meeting integrations.                                                                | Extend the existing browser Companion; native slide integrations remain future work in the [integration gap analysis](slido-feature-gap-analysis-and-development-plan-2026-10.md#presentation-meeting-and-embedding-integrations).                                    |
| IDEA-008 | Follow-up learning checks and concept trends    | Offer optional follow-up checks over time and aggregate views of concepts that need revisiting, helping facilitators plan the next session. Avoid introducing persistent learner tracking into guest mode.      | Extend existing practice and delayed-probe assignments toward the proposed Recovery Trail and Concept Health views; see the [current product checkpoint](market-research-and-development-plan-2026-09.md).                                                            |

## October 27 research additions

Origin for these ideas is the product owner's request for another competitor/customer-needs review.
External requests and sector research support the problems indicated below; the proposed Polling
Pops solutions still require customer validation. They are not requests received from Polling Pops
customers. Detailed tickets distinguish direct demand, market capabilities and hypotheses.

| ID       | Suggested enhancement                              | Customer problem and intended benefit                                                                                        | Evidence and current boundary                                                                                                                                                                                          | Status and detail                                                                                             |
| -------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| IDEA-009 | Participation recovery guidance                    | Help participants recover from delivery failures and help hosts distinguish connectivity from unanswered learning checks.    | Jisc sector research supports access barriers. Receipts, reconnect and room-health counts already exist; validate them and add only missing freshness/explanation/recovery guidance.                                   | Deferred · [R2-01](competitor-backlog-2026-10-27.md#r2-01-participation-recovery-guidance)                    |
| IDEA-010 | Private live extra-time accommodations             | Give guests additional response time without public disclosure or premature answer reveal.                                   | Competitor accommodations establish market expectations. Whole-room flex and self-paced passes exist; individual live timing/reveal remains a separate privacy/fairness decision.                                      | Deferred · [R2-05](competitor-backlog-2026-10-27.md#r2-05-private-live-extra-time-accommodations)             |
| IDEA-011 | Reviewed multilingual question and recheck content | Let a mixed-language audience answer equivalent, reviewed content in one session with coherent results.                      | A direct external multilingual-poll request supports the job. Ten UI locales exist; authored language variants, review and version binding do not.                                                                     | Deferred · [R2-06](competitor-backlog-2026-10-27.md#r2-06-reviewed-multilingual-question-and-recheck-content) |
| IDEA-012 | Accessible structured peer discussion              | Guide discussion and an individual alternate recheck, including a nonverbal/solo path.                                       | Competitor peer-learning capability supports the method. New delivery/group controls are a hypothesis; existing intervention and recheck controls are foundations.                                                     | Deferred · [R2-07](competitor-backlog-2026-10-27.md#r2-07-accessible-structured-peer-discussion)              |
| IDEA-013 | Board priorities into documented decisions         | Preserve the link between workshop priorities, facilitator rationale and the next action.                                    | A direct external request supports ideas-to-ranking. Boards/grouping/ballots exist; decision records and action follow-through remain hypotheses to validate. Extends IDEA-006.                                        | Deferred · [R2-08](competitor-backlog-2026-10-27.md#r2-08-board-priorities-into-documented-decisions)         |
| IDEA-014 | Moderated anonymous Q&A around a meeting           | Keep sensitive questions and answered status available before and after a live session.                                      | Institutional user evaluations support anonymity with moderation. Standalone room duration and identity policy need validation; existing Round/Presentation Q&A is not organizer-blind persistent-room delivery.       | Deferred · [R2-09](competitor-backlog-2026-10-27.md#r2-09-moderated-anonymous-qa-around-a-meeting)            |
| IDEA-015 | Comparable cohort evidence                         | Help repeat facilitators compare recovery evidence without manual spreadsheet reconciliation or persistent learner tracking. | A direct external cohort-comparison request supports the task. Exact-version Question Health aggregates already exist; explicit session comparison and evidence-limit interpretation extend them. Related to IDEA-008. | Deferred · [R2-10](competitor-backlog-2026-10-27.md#r2-10-comparable-cohort-evidence)                         |

Remaining work under existing IDs is refined without reopening completed scopes:

- **IDEA-004:** [R2-03](competitor-backlog-2026-10-27.md#r2-03-response-formats-on-the-next-needed-surface)
  selects one needed Presentation/Survey surface and its full response/moderation/report journey.
- **IDEA-005:** [R2-11](competitor-backlog-2026-10-27.md#r2-11-aggregate-delivery-to-google-sheets)
  scopes explicit aggregate delivery to Sheets; PDF/PNG/XLSX and links remain implemented.
- **IDEA-007:** [R2-02](competitor-backlog-2026-10-27.md#r2-02-finish-the-existing-deck-recovery-workflow)
  first validates the existing Companion and scoped media insertion. Native add-ins retain their
  separate paying-partner gate.
- **IDEA-008:** [R2-04](competitor-backlog-2026-10-27.md#r2-04-bounded-multi-stage-recovery-trail)
  scopes a bounded multi-stage Trail beyond existing practice/delayed probes. IDEA-015 separates
  aggregate cohort comparison from longitudinal follow-up access.

[R2-00](competitor-backlog-2026-10-27.md#r2-00-establish-demand-and-select-the-next-increment)
continues the existing evidence campaign before a new feature increment is selected.

## Adding and revisiting ideas

- Append new ideas here with the next stable `IDEA-###` ID, the date, origin, customer problem,
  and intended benefit. Link related ideas instead of duplicating them.
- Keep new entries **Deferred** until a separate request selects them for discovery or development.
  Record customer demand, effort, and success measures when evaluating them; do not invent delivery dates.
- Check [implementation status](implementation-status.md) before calling a capability new. When
  an idea advances, link its decision or delivery plan and update its status here.

## Provider references for future discovery

- [Google sign-in overview](https://developers.google.com/identity/gsi/web/guides/overview)
  describes provider consent and signing in without re-entering a separate site's credentials.
- [Google Meet add-ons overview](https://developers.google.com/workspace/meet/add-ons/guides/overview)
  describes embedding an app in Meet for shared interaction.

Recheck provider requirements when an integration is selected for discovery.
