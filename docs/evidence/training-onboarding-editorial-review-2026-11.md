# Training and onboarding collection editorial record

WX-04 candidate on `codex/training-onboarding-collection`, based on `70b7e60` after PR #310.
Codex performed automated editorial and implementation checks. Human editorial, native-language
and observed customer usability acceptance remain pending.

| Format       | Original template          | Content                                                      | Planning time | Facilitator follow-up                                                                        |
| ------------ | -------------------------- | ------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------- |
| Round        | `new-hire-knowledge-check` | 2 scored questions                                           | 5 minutes     | Practise an access request with a fictional case and share the approved support route.       |
| Round        | `feedback-skills`          | 4 scored questions, including 2 linked rechecks              | 12 minutes    | Practise specific, actionable feedback and revisit it with a new example.                    |
| Presentation | `training`                 | 6 slides, including 2 linked checks and 1 readiness rating   | 15 minutes    | Ask learners to retrieve an idea from memory the next day and check gaps against the source. |
| Presentation | `onboarding`               | 5 slides, including 1 support poll and 1 help-clarity rating | 20 minutes    | Share a small first task, a support contact and a first-week check-in.                       |
| Survey       | `onboarding-experience`    | 8 unscored items, including 3 optional                       | 5 minutes     | Review group patterns and name one change, an owner and a follow-up date.                    |

The times are planning estimates. Templates share a collection and can be used independently.
The New-hire answer key directs people to the approved support channel and discourages credential
sharing. The Feedback skills and Training and recovery checked answers have explanations and
linked rechecks. The readiness rating, onboarding Presentation feedback and Survey items are
unscored. The guides keep usefulness, confidence and clarity separate from demonstrated knowledge.
The Survey guide directs individual access issues to support. It explains that a question’s
distribution appears after the run closes and requires at least five finalized answers to that
question. It also advises facilitators to protect identities when reviewing small groups.

The collection uses original Polling Pops catalog definitions from the existing Round, Survey
and Presentation factories. It adds guides and localized collection labels, with no new assets,
dependencies or template content schema. Stored drafts and published content keep their existing
identities. Preview stays read-only and the existing permissions and copy paths govern creation.

The [localization review workflow](native-language-review.md) binds the collection labels, exact
memberships, Presentation guides and server-backed Round and Survey guidance to the candidate
source. The English packet is reference material. All ten locale decision records start pending
and existing Preview labels remain in effect. Export fresh packets from the final committed
candidate before collecting human decisions.

## Local verification

- 188 focused web tests and 103 starter and API tests passed. They cover exact collection
  membership, localized guides, answer keys, Survey optionality and independent copies.
- All four Playwright cases passed across desktop Chromium, mobile Chromium and mobile WebKit.
  They cover keyboard navigation, URL history, read-only previews, real draft creation for each
  format, source preservation after editing and a 320px viewport.
- All 39 localization workflow tests passed. Ten local packets exported 794 pending decisions
  each, including both collection memberships and all new guides. The export used base
  `70b7e60` with a source binding that included the local changes.
- The full `VITEST_MAX_WORKERS=1 pnpm check` passed with 10,602 package tests, 529 smoke-support
  tests, four builds and compiled server startup. Environment-dependent suites retained their
  configured skips.
- After restoring the Survey distribution threshold in all locales, 49 focused server tests
  and 39 localization workflow tests passed. All ten review packets were regenerated with
  794 pending decisions each.
