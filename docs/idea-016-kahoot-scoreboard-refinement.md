# IDEA-016 Kahoot scoreboard benchmark and visual refinement

Requested: 2026-10-27. Extends the [competition dashboard](idea-016-competition-dashboard-plan.md).
Priority: High / P1. The product owner selected implementation of a more enjoyable, graphical
and interactive scoreboard. Competitor material guides the comparison; this is not a new customer study.
Status: **implemented and verified locally**. Deployment and release acceptance remain separate.

## Current benchmark

Checked against official material on 2026-10-27. Feature availability depends on Kahoot account,
plan and experience. The following are documented behaviors, not independent quality findings.

| Evidence                                                                                                                                                                                                                                                                                                       | Verified behavior                                                                                                                              | Polling Pops response                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [Kahoot event playbook](https://support.kahoot.com/hc/en-us/articles/42321615442707--Playbook-Use-Kahoot-for-an-event-where-you-can-test-the-knowledge-of-your-audience-while-keeping-them-active-and-engaged-with-quiz-questions-and-points-adding-a-competitive-element-to-your-event), updated September 17 | Classic shows between-question scoreboards and an automatic top-three finish. Other experiences handle scoring and podium control differently. | Existing live and final standings cover the basic flow; improve visual hierarchy and the finish moment.                                      |
| [Kahoot feature updates](https://support.kahoot.com/hc/en-us/articles/32601683697053-New-Kahoot-features-and-updates), updated October 6, September 29 section                                                                                                                                                 | Animated characters appear in reactions and final celebrations, including the shared Classic podium.                                           | Give existing Polling Pops avatars a stronger original podium treatment and a short decorative celebration. No competitor assets are copied. |
| [Kahoot points guide](https://support.kahoot.com/hc/en-us/articles/115002303908-How-points-work), updated September 30                                                                                                                                                                                         | Ordinary correct-answer streaks do not currently earn bonus points. Separate specialized experiences can use different mechanics.              | Recognize a correct streak visually, with no new points, multipliers or scoring formula.                                                     |
| [Professional experience](https://support.kahoot.com/hc/en-us/articles/33774933800595-Professional-experience-the-interactive-presentation-tool-for-hosting), updated October 20                                                                                                                               | Hosts control scoreboard/podium visibility rather than always displaying them automatically.                                                   | Keep competition opt-in, preserve private/opinion modes and recovery pauses, and support calm motion settings.                               |
| [Accuracy experience](https://support.kahoot.com/hc/en-us/articles/39818967108627-Accuracy-experience-How-to-host-a-kahoot), updated October 3                                                                                                                                                                 | Uses correctness rather than speed and supports celebration of multiple top performers.                                                        | Disclose ties and retain existing accuracy/flex semantics. Do not imply a single sole winner when results are tied.                          |

The [2024 leaderboard-animation discussion](https://support.kahoot.com/hc/en-us/community/posts/27419135249299-leaderboard-animation)
contains user reports that static results felt less enjoyable. It also highlights reduced-motion
preferences. This is historical external feedback, not evidence that animations should override
accessibility settings or that Polling Pops customers share a measured preference.

## Selected improvements

1. **A stronger podium:** distinct first/second/third treatments, raised steps, larger avatar focus
   and a clear final-result moment using original Polling Pops colors and shapes.
2. **A graphical race:** proportional score bars for the top five, with an accessible table-view
   control and full standings. Bar length compares released points; it is not a probability of winning.
3. **Progress recognition:** spotlight the greatest positive rank movement with a positive released
   point gain, including participants outside the podium. Equal greatest climbs receive equal
   recognition; zero gain, unknown history or no movement means no award.
4. **Personal momentum:** show the last released scored-question gain and correct-answer streak.
   These are server-derived facts, not browser-generated rewards or extra points.
5. **A replayable celebration:** finite decorative effects and an explicit replay control that never
   resubmits commands, changes scores or delays access to results.
6. **Participant control:** race/table and motion controls work by keyboard. Device and saved app
   reduced-motion preferences take precedence. Audio remains controlled by the existing experience
   preferences; this increment adds no autoplay sound or third-party music.

Race bars, the biggest-climb treatment and the exact celebration controls are our design choices.
This review did not verify that Kahoot currently provides identical features or reveal timing.

## Data and safety acceptance

- `lastScoreDelta` and `correctStreak` are optional additive entry fields. Older snapshots remain
  readable; the UI does not infer missing recognition from historical totals.
- A scored main reveal commits the gain and streak with the existing durable release ledger.
  An incorrect or missed scored question resets the streak. Opinion polls, rechecks and revotes
  neither extend nor break it. These recognition fields never affect score or tie-breaking.
- Accepted but unrevealed responses cannot alter bars, gains, streaks, movement or spotlight data.
  Reconnect and early finish use the same released evidence.
- A presence update or unrelated snapshot cannot restart a celebration. Explicit replay is purely
  local; results remain available immediately, including under reduced motion.
- Empty, private, opinion-only and tied cases retain their existing safeguards. A zero-point room
  must not produce a fabricated sole-winner celebration or a full-length score bar.
- The Presentation dashboard remains staff-only. This visual increment grants no new audience
  access to names or results.
- Presentation reveals freeze the participant roster in staff-private timeline data (migration
  `077_presentation_reveal_rosters.sql`). Previous ranks include participants who skipped an answer
  and exclude people admitted later. Legacy reveals without a saved roster keep rank history unknown.
- During rechecks and revotes, the projector keeps the recovery question visible when the host
  selects Show standings. The competition dashboard returns for final results.

## Remaining options

Keep these as separately selected IDEA-016 increments: per-room calm/playful presentation policy,
host-scheduled intermediate standings and a deliberate final-podium reveal; public Presentation
podiums with explicit identity policy; richer animated character assets; and optional original audio
with clear controls. The present increment focuses on graphical feedback and local interaction.
It does not introduce arcade game modes or alter the comprehension-recovery workflow.

## Verification

Verify durable gain/streak behavior, missed/wrong resets, no bonus scoring, pre-reveal freezing,
and older-state compatibility in contract/engine/projection tests. Component and production-browser
checks cover race/table controls, replay, persisted motion choice, system/app reduced motion,
biggest climbs, final ties, unscored/private sessions, light/dark contrast and 320px layout.
The production interaction run also checks the existing Display & sound menu over the dashboard;
its full-width header background is clipped independently so the controls remain clickable.
The scoreboard has its own scoped dark palette within the selected live-session canvas.
Wide projector layouts place podium and race side by side; narrow screens retain the stacked view.
Completed locally on 2026-10-27: `CI=true VITEST_MAX_WORKERS=1 pnpm check` passed, including
formatting, lint, types, package/support tests and production builds. Eight production desktop/mobile
browser cases passed; two additional primary desktop/mobile runs verified the final wide layout and
clean projector standings stage. Sixteen component/preference tests cover the recognition, empty/tied
states and motion choices. Existing environment-dependent PostgreSQL skips remain separate.
The review follow-up added production regressions for revote and linked-recheck standings,
including reload and the final podium. Those four desktop/mobile cases and both primary competition
journeys passed (six cases).
Projection regressions cover skipped-answer climbs, late admissions with earlier join timestamps,
and unavailable legacy reveal history. The shared repository roster conformance test also passed
against a temporary PostgreSQL database, including migration application and replay.
