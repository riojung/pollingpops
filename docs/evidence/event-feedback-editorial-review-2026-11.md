# Event feedback collection editorial record

WX-04 candidate on `codex/event-feedback-collection`, based on `61d1094` after PR #312.
Codex performed automated editorial and implementation checks. Human editorial, native-language
and observed customer usability acceptance remain pending.

| Format       | Original template   | Content                                           | Planning time       | Facilitator follow-up                                                                |
| ------------ | ------------------- | ------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| Round        | `training-feedback` | 1 improvement poll and 1 usefulness rating        | 3 minutes           | Choose a change to try and say when the group will see it.                           |
| Round        | `event-feedback`    | 5 opinion polls and 3 ratings                     | 10 minutes          | Use revealed question-level patterns to select an improvement.                       |
| Presentation | `demo`              | 6 slides, including 2 polls and 1 clarity rating  | 20 minutes          | Pick an unanswered question and agree on a concrete follow-up.                       |
| Presentation | `native-event-talk` | 8 content slides with a fictional library example | 20 minutes          | Give attendees a decision record they can apply to their own context.                |
| Survey       | `event-feedback`    | 8 opinion items, including 2 optional items       | 5 minutes to answer | Close the run before reviewing eligible results and tell attendees what will change. |

The times are planning estimates. Each template works independently. Feedback reflects the
respondents’ experience and helps facilitators choose what to examine or change. The native talk
works as a complete explanation and can be followed by a separate Round or Survey.

Event experience appears twice by design. The live Round collects one question at a time,
and discussion follows the reveal. The self-paced Survey lets participants skip questions
4 and 8. A question’s distribution appears only after the run closes and at least five
finalized submissions answer that question. The guide treats skipped answers as missing and
asks facilitators to protect identities when reviewing small groups.

The live Round’s description is now specific to live feedback. The Survey keeps its own
participant introduction. The starter content version advances so a pending Round copy can
ask the creator to review the current starter before making a new draft. A committed copy
remains recoverable with its original request.

The collection uses original Polling Pops content and existing preview and independent-copy
paths. No assets, dependencies or content schema were added. The
[localization workflow](native-language-review.md) binds the collection membership, labels, and
facilitator guides to the source. The English packet is reference material. All ten decision
records start pending. Export fresh packets from the committed candidate before collecting
human decisions.

## Local verification

- All 210 focused web tests passed, covering exact membership, format navigation, localized
  guides, and the demo and talk content.
- All 190 focused server tests passed, covering live and self-paced guide and description parity,
  independent copies, stale uncommitted requests, and recovery of a previously committed Round.
- Seven Playwright cases passed across desktop Chromium, mobile Chromium, and mobile WebKit.
  They covered exact counts and independent copies for the shared source, read-only preview,
  the native talk guide, and the five collection controls at 320px.
- All 39 localization workflow tests passed. Ten packets generated against base `61d1094` and
  the local bound source each contain 804 pending decisions. Both Event experience formats
  have separate guide entries.
- The full `VITEST_MAX_WORKERS=1 pnpm check` passed with 10,691 package tests, 529 smoke-support
  tests, four builds, and compiled server startup. Environment-dependent suites retained their
  configured skips.
- After review, the Italian Event talk guide uses **Questionario**, matching the Survey creation
  label. All 81 focused web tests and 39 localization workflow tests passed. All ten packets
  were regenerated, and the Italian packet contains the corrected guide.
