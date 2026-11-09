# Presentation self-paced choice practice

Date: November 8, 2026. Branch: `codex/presentation-self-paced-practice`.

## Delivered boundary

**Assign practice** creates a private practice link pinned to an existing published Presentation.
The creator chooses a one-, seven- or thirty-day deadline, can recover the same creation request,
revoke assignments and explicitly load anonymous started/completed/in-progress counts. The first
slice supports 1–50 visible pages with 1–25 ordinary assessed single-choice or true/false checks.
Other visible activity formats, linked rechecks and required-confidence questions reject creation
with an actionable explanation; content is not silently dropped. Optional confidence may be omitted.

Opening a link previews the frozen content without starting an attempt. A recipient explicitly
starts practice, marks content pages read and submits one final answer for each check. Only a
durably accepted answer acknowledges its question page and reveals that reader's correctness,
correct choice, authored explanation and selected-choice feedback. Other choice feedback, notes,
private citations and unsubmitted answer keys are excluded. Each answer remains final. Explicit
completion requires every frozen page acknowledged and every question answered.

The reader can review accepted feedback and a personal correct/answered summary. This is anonymous
practice with no timer, points, leaderboard, verified identity or mastery claim. Existing reading
assignments keep their reading-only meaning and cannot acquire responses or assessment results.
Multi-select/numeric activities, opinion responses, configurable delayed feedback, identified
assignments and individual creator response reports remain later E08 work.

## Privacy, recovery and compatibility

Practice has separate assignment, attempt and compact-receipt tables and separate HTTP/recipient
routes. It reuses immutable publications, recipient-safe content/media projection, shared content
rendering and existing creator authorization/feature policy. No document/scene version, billing
entitlement, AI provider or paid service changes. Reading hashes, old receipts, live response
schemas and reading/live report meanings retain their bytes and behavior.
Practice additionally rejects ambiguous case-equivalent legacy page/choice identifiers without
rewriting old publications or changing their existing readers.

Assignment and per-attempt capabilities are distinct; only hashes persist on the server. Personal
resume links use fragments stripped from the current history entry. Opening one requires explicit
resume. Recipient credentials and uncertain mutations remain in memory; shared assignment links
never discover another person's attempt from browser storage. Clear reader discards the active
attempt and fences late responses. Creator pending creation recovery is bound to the actor/workspace.

Each mutation uses an operation ID and expected revision. Accepted retries return the original
receipt even after later progress/completion while the assignment remains available. Changed retries
conflict; stale writes must refresh authoritative progress. Start retries return the original empty
acknowledgement, so the client explicitly reads current progress. Compact receipts reconstruct the
read/answer set at the accepted revision instead of copying growing answer histories per operation.
If a saved pending-start link finds no attempt, the client first verifies current assignment access
and then offers an explicit retry using the original attempt credentials. It never silently starts
a replacement attempt.

Feedback projection takes only accepted answers belonging to the authenticated attempt and looks
up their immutable questions. Correctness agrees with the existing engine evaluator. Preview,
creator aggregate reports and another attempt cannot obtain those accepted answer bodies.
Creator reports suppress total samples below five and related completion/in-progress cells of
one to four. Attempts are not unique people; no aggregate correctness distribution is introduced.

Current creator membership, source/workspace existence, feature policy, publisher permission,
deadline and revocation fence access. Archiving preserves existing delivery; permanent deletion
and account/workspace erasure remove practice data. Creator reports remain available during the
existing seven-day recovery period after expiry, including revoked assignments. Delayed cleanup
does not extend access. Account exports include safe creator assignment metadata, excluding
capabilities/hashes and individual anonymous answers.

## Operating and rollout boundary

The existing API, PostgreSQL, storage and cleanup processes run practice. Limits are 50 retained/
10 active assignments per Presentation, 250 attempts per assignment, 1,000 per Presentation,
2,000 per workspace and 100 accepted operation receipts per attempt. At most 50 page
acknowledgements plus explicit finish are needed for a complete pass, leaving bounded retry/history
headroom. A maximum thirty-day assignment lifetime plus seven-day cleanup grace bounds retention.
These are admission/storage limits, not measured concurrent-reader capacity.

Private image reads are bounded to four concurrent reads, at most 10 MiB each, and must belong to
the safe publication. Media scan/source authorization is rechecked after storage returns.
Reports aggregate counts from one scoped SQL snapshot and add no event-stream or AI dependency.

Migration106 is additive and follows105. Deploy matching HTTP, web, retention and account-lifecycle
readers before enabling practice writes. Once records exist, rollback retains106 and compatible
lifecycle/receipt readers; fence new practice admission rather than dropping private accepted
progress or frozen publications. No deployment or existing release-gate bypass is part of this task.

## Qualification

`VITEST_MAX_WORKERS=1 pnpm check` passed in **408.89 seconds**, including formatting, Docker
dependency closure, lint, all workspace types, **6,466 package tests plus 423 support tests (6,889
passing)** and all four application/admin builds. Normal opt-in external-service skips remain;
the real database qualification below executed the selected PostgreSQL cases separately.

- Six new contract tests and 27 focused HTTP checks passed, including practice, reading and
  existing private sharing. They cover supported formats, private feedback, immutable answers,
  historical receipt replay, completion, role/tenant/feature fences, revocation/deadlines and
  bounded image reads with authorization rechecked after storage returns.
- Sixty-four focused database checks passed, including seven Memory and seventeen restricted
  PostgreSQL practice cases, existing reading conformance and migration checks. Raw SQL races
  wait on real locks and reject writes after committed permission/deletion changes. Case-equivalent
  legacy UUIDs, immutable publication bytes, CAS, reopened completed attempts, quota admission,
  exact replay, safe export and lifecycle cleanup are covered.
- The actual updated restricted PostgreSQL CI command passed **499 tests** with eight unrelated
  opt-in skips. All seventeen practice PostgreSQL cases executed. PostgreSQL 18.3 used an isolated
  cluster with distinct administrative and restricted runtime principals; migrations were applied
  twice, including the final migration106 source against a fresh qualification database.
- Sixty-four focused web/reading/media checks and 21 builder tests passed, followed by web types
  and scoped lint. The full web suite passes all 3,017 tests. Coverage includes exact pending
  requests, actor changes, late responses, private resume, missing-start recovery, accepted-only
  feedback and legacy reading rendering.
- Sixteen actual production-browser workflows passed across desktop Chromium/Firefox and mobile
  Chromium/WebKit: eight new practice journeys plus existing reading-assignment and private-sharing
  journeys. One production artifact served four fresh synthetic API/media fixtures; its manifest
  remained unchanged. Tests cover lost creator/answer acknowledgements, frozen newer publication,
  correct and incorrect answers, required content pages, explicit completion, personal resume/clear,
  new-reader isolation, suppressed creator insights, unsupported-source correction, deadlines and
  revocation. Axe WCAG A/AA and narrow-screen overflow checks pass; the masked mobile completion
  screenshot was inspected.
- The independent focused audit found and verified fixes for raw SQL lifecycle locking, ambiguous
  legacy UUIDs and interrupted-start recovery, then reported no remaining actionable issue. An
  initial full check stopped on a test-only Buffer type annotation; after correction the complete
  pipeline above passed. Product source was unchanged after browser compilation.

Phase results, logs and masked screenshots are local under
`/tmp/pops-practice-validation-xpwywngw/`. Final source/environment/standalone integrity passed.
Owned database/browser fixtures, credentials and scratch data were removed; fixture ports were
released. Physical-device/manual assistive-technology acceptance, deployment and customer task
observation remain separate.

The preceding PR215's check and PostgreSQL jobs passed, as did its reading-assignment/reading-insight
browser journeys in all four beta profiles. Its broad browser matrix still fails on existing
Recovery Pack acknowledgement retry pointer interception, WebKit word-cloud viewport and import/
export contrast problems; Firefox signup overflow also failed outside the changed reading code.
Those unrelated failures are not reclassified as green or repaired by this feature.
