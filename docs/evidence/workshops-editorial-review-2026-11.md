# Workshops collection editorial record

WX-04 candidate on `codex/workshops-collection`, based on `01e9765` after PR #311.
Codex performed automated editorial and implementation checks. Human editorial, native-language
and observed customer usability acceptance remain pending.

| Format       | Original template           | Content                                                        | Planning time | Facilitator follow-up                                                                     |
| ------------ | --------------------------- | -------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| Round        | `workshop-expectations`     | 1 priorities poll and 1 familiarity rating                     | 5 minutes     | Adapt one agenda element and explain the change to the group.                             |
| Round        | `exit-ticket`               | 1 scored question and 1 linked recheck                         | 8 minutes     | Practise paraphrasing and checking understanding with a fictional concern.                |
| Presentation | `workshop`                  | 6 slides, including 2 opinion polls and 1 readiness rating     | 30 minutes    | Set an application date and choose what to observe on the next attempt.                   |
| Presentation | `native-practical-workshop` | 8 content slides and an illustrative booking-service blueprint | 25 minutes    | Assign one small service experiment and a review date.                                    |
| Survey       | `learning-needs`            | 8 unscored items, including 2 optional ratings                 | 5 minutes     | Use eligible question-level patterns to adjust one preparation step for the next session. |

The times are planning estimates. Each template works independently. The Exit ticket keys focus
on restating someone’s point and asking them to confirm the interpretation. The guide explains how
to enable optional confidence in Round setup and how to reveal and explain the first answer before
opening the linked recheck. The Workshop expectations poll, Presentation polls and readiness
rating, and the Survey are unscored.
The Practical workshop Presentation uses a fictional community-room booking example. The guide
keeps its observations illustrative and gives the facilitator optional discussion prompts.

The Survey guide asks facilitators to schedule collection early enough to close before committing
to an agenda. A question’s distribution is available after the run closes and the question has
at least five finalized answers. Skipped items count as missing. Facilitators should withhold
breakdowns that might identify people in small groups.

The collection uses original Polling Pops content with existing IDs, preview routes and
independent-copy factories. The increment adds no assets, dependencies or content schema.
The [localization workflow](native-language-review.md) binds the three collection records,
localized labels, and all guides to their source. The English packet is reference material.
All ten decision records start pending. Export fresh packets from the committed candidate before
collecting human decisions.

## Local verification

- All 199 focused web tests passed. They cover collection membership and navigation, localized
  guides, unscored activities and the content-only worked example.
- All 153 focused server tests passed. They cover localized list and preview responses, independent
  copies, the Exit ticket answer keys and linked recheck, Survey optionality, and starter regressions.
- After updating the Exit ticket guide, 33 host setup and phase tests and 28 game-engine
  confidence and recheck tests passed.
- Four Playwright cases passed across desktop Chromium, mobile Chromium and mobile WebKit.
  They exercised exact collection membership, Back navigation, the read-only worked example,
  independent draft creation and editing through the real API, and all four 320px controls.
- All 39 localization workflow tests passed. Ten packets generated against base `01e9765` and
  the local bound source each contain 799 pending decisions. The packets include all five
  Workshops memberships and guides.
- The full `VITEST_MAX_WORKERS=1 pnpm check` passed on the final changes with 10,657 package tests,
  529 smoke-support tests, four builds, and compiled server startup. Environment-dependent
  suites retained their configured skips.
