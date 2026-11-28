# Motion, sound, and charts for live Rounds and Presentations

Research checked November 28, 2026. The comparison uses published product documentation and
the Polling Pops source. It describes product capabilities and design choices.

## What leading products do

| Product    | Documented behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Implication for Polling Pops                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Kahoot!    | Answer results, intermediate standings, and a final podium create distinct beats. Professional hosting lets presenters control scoreboards and the podium, and sound effects can be turned off. [Live hosting](https://support.kahoot.com/hc/en-us/articles/360039900153-Tips-for-hosting-a-live-game) · [Professional experience](https://support.kahoot.com/hc/en-us/articles/33774933800595-Professional-experience-the-interactive-presentation-tool-for-hosting) | Use finite effects to mark a beat and respect the room’s purpose.                                   |
| Wayground  | Session settings separate music, sound effects, ranking, and game mechanics. Learners can adjust media preferences on their devices. [Session settings](https://help.wayground.com/support/solutions/articles/158000404930) · [Learner settings](https://help.wayground.com/support/solutions/articles/158000404945-join-a-wayground-session-as-a-student)                                                                                                            | Keep mood and device preferences independent of the scoring and response model.                     |
| Mentimeter | Multiple choice results offer bars, pie, donut, or dots. Quiz slides separately support music, scoring, and leaderboard placement. [Results layouts](https://help.mentimeter.com/en/articles/2350085-change-the-results-layout-for-your-menti) · [Quiz competition](https://help.mentimeter.com/en/articles/410463-how-to-create-a-quiz-competition)                                                                                                                  | Make charts readable on the shared screen and distinguish unscored participation from competition.  |
| Slido      | Hosts can show a growing word cloud or keep results hidden. A quiz can show standings during the session and at the end. [Word cloud](https://community.slido.com/interactive-poll-types-210/create-and-run-a-word-cloud-418) · [Quiz](https://community.slido.com/interactive-poll-types-210/create-and-run-a-quiz-538)                                                                                                                                              | Give a result energy only after the surface is authorized to show it.                               |
| Wooclap    | Competition can reveal current standings on demand or after eligible questions, and participants can see their own position. [Competition mode](https://docs.wooclap.com/en/articles/674966-how-to-use-the-competition-mode)                                                                                                                                                                                                                                          | Keep the facilitator in control of when the group shifts from answering to reflection or standings. |
| PowerPoint | Slide transitions are authored separately from object animations and can be previewed. [Slide transitions](https://support.microsoft.com/en-us/powerpoint/training/add-change-or-remove-transitions-between-slides)                                                                                                                                                                                                                                                   | Keep a short entrance separate from authored media and motion.                                      |

## First delivery

- **Round projector.** Give disclosed choice and rating distributions clearer bars and exact
  values. Use short, distinct original sounds for meaningful question and finish moments on
  projectors with sound enabled. Ordinary data updates and reconnects should be quiet.
- **Presentation stage.** Add horizontal marks to revealed poll and ranking tables. The marks
  make the exact values easier to scan across a room. Polls use percent of respondents and rankings
  use weighted points. Keep a brief slide entrance focused on the host’s change of block.
- **Accessibility and visibility.** Honor both device and saved reduced-motion preferences.
  Keep the controls and exact values available throughout an effect. Preserve existing result
  disclosure and scorer authority. Use original interface graphics and synthesized cues.

To try the cues, launch a Round that has experience settings available. Open **Review settings**
when shown in setup and select **Enable optional presenter sound cues**. On the projector
device, open **Display & sound** in Presenter view and clear **Mute sound cues**. If **Enable
sound cues** appears when you open or reload the projector, select it before starting. A preset with
cues, such as Spark, will play short tones as the host opens, locks, and reveals a question or
finishes the Round. To see the chart reveal, lock an eligible choice or rating question with
at least five saved responses.

For Presentations, open the audience stage and run a live poll or ranking. Advance to see the
slide entrance, then reveal the results to see the bars alongside the exact values.

## Follow-up increments

| Order | Increment                           | Acceptance                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Author and rehearse display style   | Offer calm, standard, and livelier delivery using existing Round presets where possible. Preview the actual projector effects and audition audio by explicit action. Include a silent choice and keep device accessibility settings effective.                                                                                                                    |
| 2     | Show recovery as it happens         | After an authorized linked recheck, show what changed for the measured paired responses, with counts, the eligible denominator, and any withheld or unavailable state. Make it easy for the facilitator to explain the original misconception and open supporting evidence. Evaluate this same-session experience before expanding to comparison across sessions. |
| 3     | Add response-specific chart choices | Qualify part-to-whole charts only for data with a valid whole. Start with compatible single-choice questions and retain respondent-based bars for multiple selection. Keep exact values and a table available.                                                                                                                                                    |
| 4     | Expand playful moments              | Evaluate optional original room audio, team recognition, and additional transitions in education and team-building rehearsals. Any public standings or device-wide sound require explicit visibility and audio controls. Keep learning feedback and scoring independent of decorative effects.                                                                    |

The recovery reveal is the clearest opportunity to differentiate. The facilitator can use the
visual moment to discuss a misconception, run a targeted recheck, and see the paired evidence
that helps decide whether to move on. Evaluate it with actual educators and facilitators before
making engagement or learning claims. See the [Recovery Loop comparison](implementation-status.md#r2-00-recovery-loop-comparison)
and [existing competition work](idea-016-kahoot-scoreboard-refinement.md).
