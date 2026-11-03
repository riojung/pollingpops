# Content-only Presentation E01 verification

Date: November 3, 2026

Base: `f4c1df5`, after E00 merged in PR 181. Working branch:
`codex/presentation-content-only`.

This is the first E01 production-code slice using existing content-slide layouts. It allows
complete, nonempty decks without questions to publish, run through their slides, finish and
produce a participation/timeline report. Native scene persistence, shapes and multiple-image
editing remain separate E01 work. Existing feature and workspace rollout policies still apply.

## Behavior verified

- Create, revision-save, retry, reload and publish content-only decks. Publication retries return
  the same immutable version. Later unpublished edits do not alter hosted or reported content.
- Advance lobby to content, continue through each slide and finish with null question timers.
  Durable command replay does not advance twice or create a second finish/report event.
- Accountless participants reconnect with their existing credentials. No responses are accepted
  during content delivery, and private notes/source information stay out of participant views.
- Zero- and one-attendee sessions finish and reconcile reports. Participant standings are null;
  host competition data and report leaderboards are absent/empty. Reports retain join counts,
  slide titles and the actual timeline without inventing assessment or recovery results.
- Empty/invalid slides, unavailable/unscanned images, and malformed question/recheck topology
  remain blocked. Existing mixed v2/v3 payload hashes and v1 upcasting remain unchanged.
- Legacy REST roster aliases retain their existing equality with participant rosters; they are
  not used to display competition for a content-only deck.

## Targeted local checks

| Check                                                                     | Result                                                                                              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Presentation contract, report, realtime and recovery compatibility suites | 117 focused tests passed                                                                            |
| Builder readiness, host/participant completion and report rendering       | 43 focused web tests passed                                                                         |
| Authoring/session/content-only/projection/report-worker API suites        | 34 tests passed across six files                                                                    |
| Memory session conformance and existing Pack artifact readers             | 27 tests passed across two files                                                                    |
| PostgreSQL publication/media/tenant and shared session conformance        | Two selected cases passed against a real isolated database                                          |
| Actual beta editor to finished report                                     | Four cases passed across desktop Chromium, Firefox, mobile Chromium and mobile WebKit, zero retries |
| Server, web and database type checks; targeted formatting/lint            | Passed                                                                                              |

The full repository `pnpm check` passed formatting, Docker-context validation, lint, type checks,
tests, support tests and production builds, including 497 contract, 1,956 web and 1,028 server tests.
Its default environment skipped 338 database, 15 server and one support case; the two focused
PostgreSQL checks above ran separately against the configured real database. An independent
read-only review of tracked/untracked code and tests found no actionable issues.

The real PostgreSQL run used PostgreSQL 17.11 in a task-owned disposable `postgres:17-alpine`
container, a tmpfs data directory and a restricted runtime role created by the existing test
bootstrap. A loopback SSH forward handled this Mac's Colima port boundary after the initial
direct host connection was refused. The tests ran the real migrations and forced tenant rules.
The task-owned container and tunnel were removed afterward. This was not the product database,
the deployed topology, production image/media bytes or target-region capacity evidence.

The beta browser tests used real API calls and the real editor/autosave/publication flow without
network response stubs. They checked guest DOM and fresh API snapshots for private-note leakage,
reloaded both host and guest, and verified the neutral finished report. Firefox used the same
task-owned application-data isolation described in the [E00 record](presentation-scene-prototype.md).

Reproduce the relevant checks with configured isolated services:

```sh
pnpm --filter @openround/server exec vitest run test/presentation-content-only-api.test.ts test/presentation-content-only-session.test.ts
pnpm --filter @openround/db exec vitest run test/presentation-session-response.test.ts test/presentation-pack-artifact-schemas.test.ts
pnpm --filter @openround/db exec vitest run test/postgres.test.ts -t 'content-only publications|shared Presentation repository conformance contract' --hookTimeout=60000
pnpm exec playwright test --config=playwright.beta.config.ts tests/beta-e2e/presentation-content-only.spec.ts
pnpm check
```

The PostgreSQL command requires `TEST_DATABASE_ADMIN_URL` and `TEST_DATABASE_URL` pointing to
the isolated cluster; otherwise it skips rather than establishing conformance. The broader
repository check is recorded separately from these focused real-service results.

## Compatibility and remaining scope

The new content-only policy expands accepted content in existing schema versions 2 and 3. Older
readers reject those new decks. Follow the [upgrade runbook](../runbooks/upgrade.md#content-only-presentation-compatibility):
fence publication/session creation, deploy compatible server/jobs/web readers before reopening
writers, and retain a compatible rollback image after new data exists. No SQL migration or new
paywall is introduced.

Human creator timings, assistive-technology acceptance, physical-device checks and deployed
capacity remain open. This local implementation does not close the release ledger or establish
the remaining native scene editor's production readiness.
