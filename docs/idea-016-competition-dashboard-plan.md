# IDEA-016 competition dashboard

Requested and selected by the product owner: 2026-10-27.
Priority: **High / P1**. Status: **implemented locally**; release gates remain separate.

The product owner's subsequent [Kahoot visual refinement](idea-016-kahoot-scoreboard-refinement.md)
adds a separate current benchmark and selected graphical/interactive improvements to this foundation.
That follow-up is implemented and locally verified: original medal/podium graphics, race/table
controls, positive-gain climb recognition, server-released gains/streaks, replayable decoration,
persisted motion choices and a wide projector stage. The final full repository check and production
desktop/mobile browser checks pass; see the linked refinement record for scope and evidence.

## Audited problem

Rounds had a host top-five list and an optional projector standings phase, including ordinary
numbered positions 1–3. The final projector switched to a thank-you screen. Participants saw
their own final score but no standings or personal rank. There was no podium, rank movement,
points-gap view or cohesive competition dashboard.

The product owner selected this upgrade after the competitor-research round. This is direct
product-owner prioritization, separate from external customer-demand signals and release acceptance.

## Slido benchmark

[Slido's current quiz guide](https://community.slido.com/interactive-poll-types-210/create-and-run-a-quiz-538),
checked October 27, documents an automatic final top-five projector leaderboard, participants'
own final ranks, manual interim standings and optional per-question scheduling. It ranks by
correct answers and response speed. Its original publication date does not date every current feature.
The [tie clarification](https://community.slido.com/community-q-a-7/can-there-be-a-tie-for-winners-in-a-quiz-993)
explains millisecond timing and the five-person projector limit.

Polling Pops adds a distinct top-three podium, expandable accessible standings, personal movement
and points-gap information. These are selected improvements, not a claim that Slido lacks every
similar interaction. Per-question scheduling and native slide add-ins remain separate options.

## Delivered scope

| Surface                  | Behavior                                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Round host               | Compact main-stage summary during questions; full-width standings/final stage with revealed progress, top three, top five and expandable full standings. Existing phase controls remain. |
| Round projector          | Compact standings during the main-question flow, full standings when selected, and automatic retained final podium. Audience race views pause during interventions/rechecks.             |
| Round participant        | Top three and standings plus personal rank, score, rank movement, points behind the leader and points to the next position. Final results survive refresh.                               |
| Presentation host        | Dashboard for the facilitator's already-authorized participant results. Only completed main scored questions contribute; an open question cannot move standings.                         |
| Presentation participant | Own existing rank and score on the final screen. Other participants' identities remain outside this projection.                                                                          |
| Private Round            | No competition dashboard or public competition payload. Existing private feedback remains.                                                                                               |
| Opinion-only session     | Clear unscored explanation; no ranked winners, podium or personal race card.                                                                                                             |
| Early-ended Round        | Only released scores contribute. If none were revealed, an explicit empty final state replaces invented winners.                                                                         |

Presentation audience-wide podiums need a separate explicit public-standings policy. Existing
Presentations have no such setting; the staff-only improvement does not broaden identity access.
Older active Rounds without release history retain the existing interface; new Rounds receive
the full dashboard.

## Scoring and continuity

- A scored main checkpoint releases atomically at reveal. An additive durable ledger retains
  released metrics and previous ranks through reconnect, cache reload and process restoration.
- Unrevealed open/locked/paused responses cannot move public totals or their order. Answer
  receipts confirm durability without a score that could reveal correctness.
- Rechecks, revotes and opinions do not add competition points. Progress and disclosure describe
  revealed scored questions, including at final.
- Only accepted responses enter the ledger. A participant draft is visibly marked as unsubmitted
  until the server confirms it. Correct timed speed submissions retain positive earned points
  through reveal, finish and reconnect; host pauses do not count toward their response time.
- All-zero finals retain truthful standings without a winner spotlight, confetti or replay reward.
- Early ending does not release the current question. Historical reports retain their existing
  accepted-answer scoring semantics and can therefore differ from the released competition total.
- Round ordering remains points, correct count, then response time in timed mode, with a stable
  technical fallback. Flex does not use time to break ties. Exact merit ties are marked explicitly.
- Presentation ordering retains points, joining order and its deterministic fallback. Equal-point
  ties are marked, and the display rule is explained.
- No scoring formula, persistent learner identity, grade sync, public sharing rule, plan or
  third-party dependency is added.

## Use and verification

For a scored Round, choose **Leaderboard** results or the **Friendly competition** recipe. The
compact dashboard follows revealed main questions; **Show standings** opens the full competition
phase. Finishing retains the final podium. Private-result sessions keep their existing experience.

The component provides explicit first/second/third labels, semantic table headers, native
expandable standings, accessible movement labels, a progress indicator, reduced-motion support,
long-name wrapping and copy in all ten interface locales. Color alone never conveys rank.

Verification sources:

- `packages/contracts/test/competition-standings.test.ts`
- `packages/game-engine/test/competition-standings.test.ts`
- `apps/web/components/competition-dashboard.test.tsx`
- `apps/server/test/presentation-session-projections.test.ts`
- `tests/e2e/competition-dashboard.spec.ts`

Verification completed locally on 2026-10-27: `CI=true VITEST_MAX_WORKERS=1 pnpm check` passed,
including formatting, lint, types, package/support tests and production builds. Eight production
browser cases passed across desktop Chromium and mobile Chromium. Their light/dark dashboard
accessibility scans, final reload and 320px layout checks passed. Database tests that require a
separate PostgreSQL environment retain their ordinary skipped status in the repository check.

The tests cover release boundaries, rank history, ties, early end, private and opinion modes,
first/retried API receipts, Presentation projections and desktop/mobile host/projector/participant
journeys. Browser checks include final reload, light/dark accessibility and 320px layout. Local
verification does not establish a production deployment or manual assistive-technology acceptance.
