# Polling Pops future product ideas

Captured: 2026-10-13

This is the ongoing backlog for customer-facing enhancements we may explore later. Entries are
**deferred ideas** unless a status update below records a separate implementation request.
Capturing an idea does not authorize development or change the existing roadmap and release gates.

## Requested ideas

### Social sign in

**IDEA-001 · Requested by the product owner · Deferred**

Let customers sign up and sign in with **Google, Facebook, and Apple** so they can use an existing
account without creating a separate Polling Pops password or repeatedly entering profile details.
Request only the identity information needed, with clear consent.

Keep email magic-link access as a fallback and preserve account-free audience participation.
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

**IDEA-004 is implemented locally for Live Rounds as of 2026-10-13**, following the product owner's
implementation request. Multiple-selection polls, ranking, moderated open text and word clouds
pass the full repository check, PostgreSQL conformance and production-browser journeys. Writers
remain rollout-gated; Presentation/Survey expansion is deferred. See the
[response formats implementation plan](idea-004-response-formats-plan.md) for behavior, evidence
and rollout details. The other ideas remain deferred.

| ID       | Suggested enhancement                           | Customer value and future scope                                                                                                                                                                                 | Existing foundation                                                                                                                                                                                                                |
| -------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDEA-004 | Richer response formats                         | Add moderated open text, word clouds, ranking, and live multiple-selection opinion polls so facilitators can collect explanations and priorities as well as fixed-choice answers.                               | Initial Live Round scope is implemented and gated; Surveys retain existing multiple-selection opinions. See [implementation status](implementation-status.md).                                                                     |
| IDEA-005 | Shareable session summaries                     | Offer aggregate report links, PDF summaries, result images, and optional spreadsheet delivery so customers can share outcomes and next steps after a session. Respect audience privacy and sharing permissions. | Extend existing reports and CSV/JSON exports; see the [report and export gaps](slido-feature-gap-analysis-and-development-plan-2026-10.md#analytics-reports-and-portability).                                                      |
| IDEA-006 | Brainstorming and prioritization boards         | Let audiences contribute ideas before, during, or after a meeting; let facilitators group them manually and invite priority voting. Include moderation and optional anonymity.                                  | A distinct workflow beyond chat and Q&A; see the [Ideas gap analysis](slido-feature-gap-analysis-and-development-plan-2026-10.md#ideas-and-ai-assistance).                                                                         |
| IDEA-007 | Native PowerPoint and Google Slides integration | Launch synchronized Polling Pops interactions from familiar slide tools to reduce presentation switching. This complements meeting integrations.                                                                | Extend the existing browser Companion; native slide integrations remain future work in the [integration gap analysis](slido-feature-gap-analysis-and-development-plan-2026-10.md#presentation-meeting-and-embedding-integrations). |
| IDEA-008 | Follow-up learning checks and concept trends    | Offer optional follow-up checks over time and aggregate views of concepts that need revisiting, helping facilitators plan the next session. Avoid introducing persistent learner tracking into guest mode.      | Extend existing practice and delayed-probe assignments toward the proposed Recovery Trail and Concept Health views; see the [current product checkpoint](market-research-and-development-plan-2026-09.md).                         |

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
