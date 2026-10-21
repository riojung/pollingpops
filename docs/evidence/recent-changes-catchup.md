# Recent changes catchup — October 21, 2026

## Candidate and current readiness

The inspected merged-main commit is `427f3e658e6307507fab451c7b7e35f712e17927`.
Its [CI](https://github.com/riojung/pollingpops/actions/runs/39557976752),
[Security](https://github.com/riojung/pollingpops/actions/runs/39557976778), and
[Production-path smoke](https://github.com/riojung/pollingpops/actions/runs/39557976777)
workflows failed. The source checks, database migration job, CodeQL, secret scan and mobile beta
browser projects passed, but those partial results do not pass the complete engineering gates.
The production media browser failure skipped the subsequent observability, multi-process,
backup/restore and load steps.

The [release ledger](../release-readiness.json) therefore returns `source-ci` and
`local-production-smoke` to pending. It retains the older successful run references as historical
evidence and adds the current failed runs. All fifteen gates are pending; thirteen continue to
depend on external environments or human acceptance. A local repair or a passing pull-request
check does not establish a passing merged-main candidate.

## Repairs

- Updated business and production media journeys for default workspace Home and the current
  account, Library and organization navigation. Preserved authorization, funding, scanned-media,
  private-delivery and account-deletion assertions.
- Made beta fixture destinations explicit and added Home accessibility coverage. Account
  lookup failures and null, missing or incomplete feature responses must hide workspace content,
  preserve the current route and session, and recover through an explicit account retry.
- Validated the feature response before publishing workspace identity to content loaders. A failed
  account refresh clears stale access data; a malformed response is an error rather than an
  indefinite loading state.
- Pinned the development-only Vite peer used by Vitest to `8.3.3`, the patched release identified in
  the [upstream advisory](https://github.com/advisories/GHSA-587h-7wmj-h5pm), and regenerated the
  lockfile and third-party license report. The audit also reports
  [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv) and
  [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw) for the old peer.
- Aligned active guides with separate administrator username/password/TOTP authentication,
  verified-email account creation and separate PIN sign-in, default Home navigation, migrations
  through 075, and the compatible cutover and rollback procedure.

## Verification and handoff

The catchup branch is `codex/recent-changes-catchup`. Verification results for its final working
tree are recorded here after execution; they are local engineering evidence, not external gate
acceptance.

- Dependency audit after the Vite update: no known vulnerabilities reported.
- `CI=true VITEST_MAX_WORKERS=1 pnpm check`: passed, including formatting, lint, types,
  package tests, 272 passing smoke-support tests (one additional test intentionally skipped),
  and production builds.
- Beta browser coverage verified all 306 unique scenarios: 96 desktop Chromium, 96 desktop
  Firefox, 57 mobile Chromium and 57 mobile WebKit. The initial run passed 92 Chromium cases;
  four new retry assertions needed to exclude Next's route-announcer alert, and Firefox hit
  the local environment issue described below. After those corrections, the remaining 214
  cases passed with no retries, flaky cases, skips or failures.
- Business administration browser journeys: all three passed, including the real PIN resend
  cooldown, invitation, billing-only access and credit funding assertions.
- Operator console browser journeys: all four passed. Standalone password/TOTP admin journeys:
  all eight passed, including customer/admin session separation, fresh authentication, CSRF,
  feature/plan management and role restrictions.
- Isolated production images built; their one-shot migration completed successfully through
  migration 075 after normal startup migration. The production media browser journey passed
  scanning, private guest delivery and account-deletion revocation. The API smoke passed tenant
  isolation, operational switches, live play, retries, reports, exports and deletion.
- Observability passed with 25 alert rules, 54 dashboard queries and a healthy Grafana database.
  The two-process smoke passed duplicate/conflicting commands, primary-process loss and durable
  report reconciliation. The local restore reproduced all 104 database tables and their
  fingerprints, plus the synthetic media object.
- The local 100-client Round exercise accepted and reconciled all 100 responses with no lost or
  duplicate accepted responses or detected leakage. Its configured latency thresholds passed,
  and the server recovered after restart.

The production-path checks used a separate disposable Compose project and loopback SSH forwarding
for this Mac's Colima ports. Their development images reported `unversioned`; this is local
engineering verification, not immutable target-region candidate evidence or an off-host restore
acceptance. The disposable containers, volumes, image tags and forwards were removed afterward;
the normal product and admin console remained available.

Local Firefox validation uses the same Playwright revision 1543 engine in a task-owned download
with a separate application identity. This avoids the documented
[macOS 27 app-data lookup issue](https://github.com/microsoft/playwright/issues/42768) without
changing the installed Firefox, its profile, the shared browser cache or OS privacy permissions.
The temporary wrapper prepends `-app` with an otherwise identical application manifest whose
Name and Vendor are unique to this test. Linux CI configuration is unchanged.

After review and merge, retain fresh passing CI, Security and complete Production-path smoke
workflows for the exact resulting main commit. Update the engineering gate statuses and remove
their next actions only when that evidence exists. Keep historical runs distinguished from the
accepted candidate.

The remaining external work is unchanged: provision EC2 staging with the selected region, domains
and verified host key; configure mail delivery, private media, telemetry and receiver destinations;
exercise target-region load/soak and off-host restoration; and complete governance, independent
security, manual accessibility/device, legal, billing and design-partner/usability acceptance.
Follow the [beta preparation runbook](../runbooks/beta-release-preparation.md) and the individual
[evidence templates](README.md). Leave those gates pending until their actual exercises and
required reviews are complete.
