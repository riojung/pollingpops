# Presentation reading insights

Date: November 8, 2026. Branch: `codex/presentation-reading-reports`.

## Delivered scope

Each assignment in **Assign reading** now offers **Reading insights**. A creator explicitly
loads a snapshot of anonymous started attempts, explicitly completed attempts, in-progress
attempts and the number of attempts that acknowledged each frozen published page. Opening the
dialog does not load a report. Refresh is explicit; the CSV exports exactly the displayed
snapshot without fetching later activity.

The denominator is retained, explicitly started attempts for that assignment, including attempts
with no page acknowledgements. Preview opens do not create attempts and are not counted. An
accepted start, acknowledgement or completion retry does not create another observation. Counts
represent attempts, not unique people, devices or verified learners. Completion is self-reported
reading, not assessment, mastery, time spent or confirmed comprehension.

Reports remain pinned to the assignment's publication. Later drafts/publications cannot change
the page order or denominator. Activity blocks are readable pages; no answer collection, scoring,
learner identity, individual attempt report or response feedback is added.

## Access, privacy and retention

Only a current owner/editor in the source workspace can read the creator report. A shared
assignment or private resume capability grants no creator-report access. The existing Presentation
feature gate and bounded request admission also apply. Authorization and parent/source existence
are checked in the repository; PostgreSQL uses the assignment scope under forced RLS. Other
editors can still report on retained assignments whose original publisher lost authority.

Reports expose no attempt IDs, credentials/hashes, operation receipts, individual activity times,
authored page bodies, notes or answers. Fewer than five started attempts suppresses every count.
For completion/in-progress and each read/not-read partition, a nonzero group below five suppresses
both sides; page coverage also suppresses small in-progress groups that could be inferred by
subtracting the visible completed count. Zero remains distinguishable only when the total
reaches five. Null is displayed and
exported as **Suppressed**, never as zero. This protects direct and complementary small cells in
one snapshot; it does not establish protection against repeated-observation inference over time.

Revocation and deadlines stop recipient access while retaining creator aggregate reports for the
existing recovery window. Reports stop at assignment expiry plus seven days even if cleanup is
delayed. Archiving preserves them; permanent source, workspace or account erasure follows the
existing assignment lifecycle. No additional event tracking or retention extension is introduced.

The client checks assignment and publication identity before showing or exporting a report.
Identity/workspace changes, assignment selection, closing and auth-change notifications cancel
requests, fence late results and clear report/download state. Report requests are private/no-store.
CSV cells are quoted and formula-safe; the file contains only the validated aggregate snapshot.

## Architecture and operating cost

One bounded SQL statement computes totals and page coverage from the same database snapshot.
The repository returns counts rather than materializing attempt rows or receipt history in the
HTTP process. The existing limits of 1,000 attempts and 200 pages per assignment bound the scan;
the existing five-second database statement timeout and request admission bound report work.
Memory repository behavior follows the same frozen-version, authority and retention semantics.

No new table, migration, provider call, paid dependency, service, worker or entitlement is required.
Migration105 remains the prerequisite. Existing live reports and private-link viewing retain their
meanings. Deploy matching server/web code through the existing release process; old binaries
do not gain the new endpoint or UI automatically.

## CI qualification correction

The preceding E08 change added migration105 but left the migration-ledger test expecting104.
The hosted migration steps succeeded; the stale assertion failed, then its unclosed test pool
caused a secondary database-teardown error. This increment updates the expected ledger and closes
the setup pool even when setup fails. The restricted PostgreSQL CI selection now includes the
reading-assignment test file instead of leaving its opt-in cases skipped. A support regression
checks that selection and distinct admin/runtime database principals.

## Validation

`VITEST_MAX_WORKERS=1 pnpm check` passed in **407.43 seconds**: formatting, Docker dependency
closure, lint, workspace types, **6,430 package tests plus 423 support tests (6,853 passing)**
and all four application/admin builds. Normal opt-in external-service skips remain. The final
display-copy/date-label refinement is additionally covered by the focused web checks, a fresh
production web build and the final browser qualification below.

- Eight focused contract checks and 21 focused HTTP checks passed. They include direct,
  complementary and completed-subset suppression, exact mutation retries, preview exclusion,
  current-authority/cross-source denial, no private payload fields and revoked report access.
- Six Memory and eight restricted PostgreSQL assignment tests passed, including frozen pages
  after a later publication, current editor/publisher-demotion behavior, source/workspace deletion,
  archive continuity and retention expiry after waiting for a lock.
- The updated actual restricted PostgreSQL CI command passed **482 tests**, including all eight
  reading-assignment PostgreSQL cases; eight unrelated opt-in cases remained skipped. The selected
  migration/reading files also passed separately with 203 tests. PostgreSQL18.3 used an isolated
  cluster and a restricted runtime principal; migration105 was applied twice.
- Thirty-two focused web checks, web types and lint passed. They cover source/auth/scope changes,
  late results, retry, suppression rejection, displayed snapshot CSV and download cleanup.
- Eight production-browser workflows passed across desktop Chromium/Firefox and mobile
  Chromium/WebKit: the new reading-insights workflow and the existing reading-assignment flow.
  The final candidate was built once and reused with four fresh API fixtures; its complete build
  manifest remained unchanged. Actual CSV bytes, explicit refresh, preview exclusion, small groups,
  revoked reports, close/reopen clearing, Axe WCAG A/AA and narrow-screen overflow were checked.
  Mobile screenshots were inspected. An initial Firefox run exposed an ambiguous test locator
  matching both the revoked label and explanatory copy; its assertion now targets the assignment
  row. No deadlines, product assertions or acceptance criteria were weakened.
- A focused independent audit found the completed-subset inference case; schema/projection and
  contract/HTTP/client regressions now cover it. The follow-up audit found no remaining actionable
  issues.

Phase logs, browser results and screenshots are local under
`/tmp/pops-reading-validation-r8lcd_my/`. Owned database/browser fixtures and credentials were
removed after qualification. Deployment and physical-device/manual assistive-technology
acceptance remain separate from source qualification.
