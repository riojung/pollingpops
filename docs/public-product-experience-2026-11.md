# Public product experience, November 2026

## Selected direction

The product owner approved implementation of the product-led public website, preserving the
Polling Pops identity, “Make every voice pop.” headline, teal controls, 14px corners, light/dark
appearance, and a compact **Join a live Round** form at the right of the main navigation.
The authenticated `/home` workspace remains a separate journey.

This increment replaces the oversized homepage join card with product discovery. It adds a
feature-based Product disclosure, public product/use-case pages, original example previews,
and public guides. Participants retain the existing `/join?code=...` flow; creators retain
the canonical sign-in, creation, workspace and template routes.

## Research and original interpretation

Official pages inspected on November 19, 2026:

- [Slido product home](https://www.slido.com/): feature-led product navigation and a concise
  introduction to participation tools.
- [Live polls](https://www.slido.com/features-live-polling) and
  [Q&A](https://www.slido.com/features-live-qa): an outcome, a concrete example, a short
  workflow, deeper capabilities and relevant use cases.
- [Word clouds](https://www.slido.com/features-word-cloud) and
  [quizzes](https://www.slido.com/features-live-quizzes): show the audience experience and
  explain how to get from setup to a useful result.
- [Analytics](https://www.slido.com/features-analytics) and
  [ideas](https://www.slido.com/features-ideas): explain what happens after collection and
  connect the tool to facilitation.

These are information-architecture references, not evidence of Polling Pops feature parity,
customer demand or conversion improvement. Polling Pops uses original copy, local HTML/CSS
sample interactions and existing original starters. No competitor artwork, screenshots,
testimonials, customer logos, numbers or expressive text are included. No asset or dependency
was added; new examples and diagrams are repository-authored Apache-2.0 source.

## Public information architecture

| Destination                          | Purpose                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `/`                                  | Product-led introduction, local samples, workflows, use cases and creator entry  |
| `/product`                           | Ten feature pages grouped around participation and follow-through                |
| `/product/[slug]`                    | Outcome, illustrative demo, workflow, details, scope, FAQs and related features  |
| `/solutions` and `/solutions/[slug]` | Meetings, education, training and events                                         |
| `/examples`                          | Nine original read-only previews, filters and facilitator guidance               |
| `/resources` and `/resources/[slug]` | Six practical guides, including joining, report interpretation and data controls |
| `/pricing`                           | Existing plan limits and current commercial availability                         |

“Templates” in public navigation opens `/examples`; “Resources” opens `/resources`.
Neither requires creator authentication. A preview never copies or creates content.
**Open in Templates** explicitly continues through sign-in with a validated local return path
containing the source, format and applicable collection when authentication is needed.
Authenticated creators open creation, their selected template or board starters directly;
public links refresh their session state on authentication changes and window focus. A quick
click waits for the initial session check rather than restarting authentication.
Existing authenticated template
controls perform any eventual copy under their normal capability and role checks. Boards
explain that the user must choose the named starter after entering the board workflow.

The header uses one code form across breakpoints. It preserves leading zeros and strips
formatting after receiving a full paste. Enter or Join explicitly submits; entering the seventh
digit does not navigate. Product navigation collapses before the code form is squeezed. On
small screens Join reveals its form and Menu reveals navigation and appearance controls.
Product uses a disclosure with ordinary links, keyboard activation and Escape focus restoration.
The shared Join form receives its localized accessible name from public shell copy, including
routes that do not load the participant-authoring translation catalog.
Signed-in public navigation retains feature discovery, the canonical workspace link, and
authorized management/account actions.

## Claims and release boundaries

| Area             | What the public copy can describe                                                              | Boundary retained                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Rounds / quizzes | Nine question formats, explanations, optional standings, linked rechecks                       | Advanced formats and delivery depend on capability; opinions are unscored                                                |
| Word clouds      | Whole short phrases, normalized repeated phrases, growing counts, live or review-first display | No semantic AI clustering claim; moderated display thresholds still apply                                                |
| Q&A              | Questions, votes, moderation and Round facilitator replies                                     | Anonymous public display does not hide the alias from the host; Presentation replies are not promised                    |
| Presentations    | Editable native slides, designs, private notes, audience activities, supported intake/export   | Visual imports are flattened; optional provider-backed AI is reviewed and does not auto-publish                          |
| Surveys          | Self-paced responses, saved progress, privacy-aware aggregates                                 | Ordered pages are opt-in; conditional-page authoring/publication/launch remains unavailable                              |
| Idea boards      | Shared canvas and facilitated grouping/voting                                                  | Availability and collaboration scope depend on workspace access                                                          |
| Assignments      | Published Round practice, private/generic links and account-free participation                 | Attempts are not verified people; the product does not email links; linked rechecks are not unconditional practice items |
| Reports          | Participation, question results, paired rechecks and recorded interventions                    | Samples, suppression, denominators and access gates matter; no lasting-mastery or causal claim                           |
| Shared library   | Stable publications and independent editable drafts                                            | Sharing content does not grant source editing, response access or organization seats                                     |
| Plans / trust    | Current plan limits and concrete privacy/access guidance                                       | No invented prices, certifications, enterprise SLA, approved legal claim or customer proof                               |

All sample interactions are local and visibly labelled illustrative. They do not submit
responses, create practice attempts or save reports. Resource guidance distinguishes a
selected answer from a confirmed saved answer.

The existing translated hero remains translated. New long-form editorial content is explicitly
marked English (`lang="en-CA"`, left-to-right); the public navigation/Join/account chrome has
ten-locale copy. This is not a claim that all new editorial pages are translated or have human
native-language acceptance.

## Follow-up chunks

| Priority | Small next increment                                                                           | Acceptance                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| P1       | Editorial and native-language acceptance, then translated public content one journey at a time | Human review of claims, product terminology, links and each translated page; accurate language metadata                   |
| P1       | Qualify commercial plans and legal/public trust content with owners                            | Approved offers, contact channels and legal text replace existing unresolved drafts; no invented price or certificate     |
| P2       | Observed first-use navigation study                                                            | Measure finding a feature, joining and reaching an eligible starter; record actual friction before changing the funnel    |
| P2       | Additional job-based example collections                                                       | Original source, editorial review and existing copy factories; public previews remain read-only                           |
| P2       | Optional integration-specific pages                                                            | Only after an integration is implemented and qualified; distinguish file intake/export from a native provider integration |

This work does not advance release-readiness gates or enable unfinished Survey branching.
The next implementation checkpoint in that backlog remains separate from public marketing work.

## Local verification

- `VITEST_MAX_WORKERS=1 pnpm check` passed: formatting, Docker build-context checks, lint,
  TypeScript, package/support tests, production builds and compiled-server startup smoke.
  Web tests: 519 files / 6,406 tests passed. Database-dependent suites retain their configured
  skips; this is not a new deployed-service or live-database qualification.
- Chromium desktop/mobile: public route access, local sample interactions, template continuation,
  Product disclosure keyboard/Escape behavior, formatted leading-zero code submission,
  canonical workspace destinations and light/dark/System appearance passed. Light/dark axe
  checks passed on the homepage, a feature page, a use-case page, examples and a resource guide.
- WebKit mobile: shell checks, sample interactions, public-page contrast, brand assets and
  existing public-surface accessibility passed. The real core-browser sign-in/Home/sign-out
  journey and both canonical workspace-shell destinations also passed in Chromium.
- Key public surfaces fit 320px. Shell fit was checked through 1440px with longer locale labels.
- Firefox could not launch on this host (`Could not find profile folder`); its browser assertions
  did not execute. No Firefox pass is claimed.

### Review corrections

Public creator links now resolve the existing creator session before following a sign-in
continuation. Creation opens directly for an authenticated creator, and examples retain their
source, format and collection when opening Templates. Guest continuations remain intact.
Session-change/expiry events and a pending refresh after returning from another tab are covered
by regression tests. The Join form's accessible name comes from localized public shell copy
instead of a catalog absent from some public routes.

The original reviewer rechecked both corrections and the refresh race with no remaining findings.
Twelve Chromium desktop/WebKit mobile browser cases passed, including a real creator's
product-to-creation and selected-example-to-Templates journey and public-route form labels.
