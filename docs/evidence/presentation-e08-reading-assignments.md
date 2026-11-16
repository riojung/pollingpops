# E08 self-paced reading assignments

Date: November 8, 2026. Branch: `codex/presentation-e08-self-paced`.

## Selected scope

This increment adds an independent reading-assignment and attempt workflow for a published
Presentation. A creator chooses the frozen publication and an expiry, copies a private assignment
link, and can revoke it. Opening the link previews readable content without creating an attempt.
The recipient explicitly starts reading, marks pages read and confirms completion after all pages
have been acknowledged. Page navigation alone does not mark reading complete.

Questions are readable previews. This slice collects no answers and produces no assessment score,
mastery claim, verified learner identity or unique-person participation count. Self-reported reading
completion remains distinct from demonstrated understanding. Scored and unscored responses,
feedback/reveal policy, attempt reports and identified learner assignments remain later E08 work.

## Architecture and compatibility

Assignment and attempt records are separate from live sessions and private view-only shares.
An assignment pins an immutable existing publication; draft edits and later publications cannot
change the reading material. Existing document, scene, live response, private review and report
contracts retain their meanings.
Archiving preserves existing assignments, while new assignments cannot be created for an archived
source. Permanent source deletion removes its assignments and attempts.

Public content reuses the recipient-safe Presentation projection and shared content renderer.
Speaker notes, answer keys, private source attribution, moderation data and capability hashes
stay outside recipient DTOs. Private images must belong to that projection, be clean, and pass
current capability and expiry checks both before and after storage reads.

Progress writes return only the accepted attempt receipt, not another copy of the complete deck.
Repository transactions serialize attempt mutations, fence expected revisions, and retain exact
operation receipts. Replaying an accepted operation cannot increment progress or completion again;
a reused operation ID with different content conflicts. Explicit completion requires all frozen
page IDs to have been acknowledged.

Receipts store compact revision/time/current-page data and reconstruct the original acknowledged
page set from first-read revisions. Reading history therefore avoids a complete growing page-set
copy per acknowledgement. Database readers share source locks; admission locks protect aggregate
limits, and progress writes lock the individual attempt rather than serialize a whole workspace.

## Recipient privacy and recovery

The assignment link opens preview, never a previous reader's progress. Each started attempt has a
separate private capability. The shared assignment credential cannot read an attempt. Only hashes
are stored by the server; capability values travel in URL fragments and Authorization headers,
and public responses are private/no-store with no-referrer and noindex policy.

The reader copies a personal resume link. Opening that link requires explicit Resume reading;
fragment secrets are removed from the current browser-history entry. Recipient credentials and
pending mutation intents stay in memory rather than localStorage or sessionStorage. Refreshing
without the personal link intentionally returns no private attempt state. Clear reader discards
the active credentials, loaded progress and pending actions from that view.

An ambiguous network failure retains the exact in-memory request for Retry. Returning with the
personal link reads the current server acknowledgement, including a write whose response was lost.
The reader cannot treat an unacknowledged offline operation as submitted.

## Operating boundary

The workflow uses existing HTTP, PostgreSQL, storage and retention infrastructure and the existing
Presentation feature policy. It adds no provider call, worker service, paid dependency or creator
seat allocation. Assignment, attempt, receipt, request and media budgets remain bounded.

The implemented retention budgets are 100 retained/20 active assignments per Presentation, 1,000
attempts per assignment, 2,000 per Presentation and 5,000 per workspace, with at most 250 accepted
progress receipts per attempt and 200 frozen pages. These are storage/admission limits, not
measured concurrent-reader capacity or unique-person counts. Assignment lifetime is at most
30 days; expired assignment, attempt and receipt data are removed together after a seven-day
receipt-recovery grace period.

`105_presentation_reading_assignments.sql` is additive and must be deployed with matching server
readers and lifecycle handlers.
Revocation, expiry, source deletion, author permission loss and workspace/account erasure must fence
future access and mutation. Retention removes expired assignment data through the existing cleanup
path; account exports exclude capability and request hashes.

This is source implementation work. Deployment, customer task observations, physical-device
acceptance, and the existing beta/production reliability and release gates remain separate.

## Executed qualification

`VITEST_MAX_WORKERS=1 pnpm check` passed in **406.65 seconds**, including formatting, Docker
workspace dependency checks, lint, full workspace type checks, **6,402 package tests plus 422
support tests (6,824 passing tests)**, and all four application/admin builds. Normal opt-in
external-service skips remain; the separate restricted PostgreSQL qualification below executed
the selected real-database cases.

- Four new contract tests cover strict reading-only requests, bounded metadata and private-field
  rejection. Contract type checking also passes.
- The database qualification passed 41 checks: six new restricted PostgreSQL conformance tests,
  four existing private-sharing PostgreSQL cases, five Memory repository cases and 26 migration
  tests. PostgreSQL 18.3 ran in an isolated local cluster using a restricted runtime principal.
  Migration105 was applied twice; raw SQL/RLS, concurrent admission/CAS, exact compact replay,
  reopened completed attempts, queued expiry, archive continuity, deletion and erasure were covered.
- Seventeen focused HTTP checks cover new reading routes and existing private sharing. These
  include wrong credentials/workspaces, canonical UUID retries, private projection, explicit
  completion, feature/deadline/revocation fences, image concurrency and reauthorization after
  in-flight reads. Server type checking and relevant lint pass.
- Thirty-five focused web tests cover private fragment parsing, actor-scoped creation recovery,
  explicit resume, memory-only recipient state, exact retry, stale/late acknowledgements, reader
  clearing, deadlines and existing protected image transport. Web type checking and lint pass.
- Eight actual production-browser workflows passed: the new reading assignment and existing
  private-sharing workflow in desktop Chromium, desktop Firefox, mobile Chromium and mobile WebKit.
  One prepared web build served four fresh synthetic API/media fixtures without recompilation or
  manifest changes. Each teardown released its ports and output lease.

Browser coverage includes lost acknowledgement recovery, frozen content after a newer publication,
explicit personal resume, completion, fresh-reader isolation, cookie omission, private-field
exclusion, revocation, Axe WCAG A/AA checks and narrow-screen overflow. Masked completion and
preview screenshots were inspected for mobile layout. These are headless desktop/mobile profiles;
physical-device and manual assistive-technology acceptance remain open.

Local phase logs, masked screenshots and machine-readable browser results are under
`/var/folders/t8/b14tz4y546b3t061lp7lsrz00000gn/T/pollingpops-e08-validation-a4z7b7um/`.
The browser launcher used a short private socket directory to avoid macOS's Unix-socket path
length limit. Neither the feature code nor fixture deadlines were changed for that launcher issue.
Full source/environment/standalone integrity was rechecked after the repository check. All owned
browser/API/media and database ports were released, output leases were empty, and the temporary
database credentials, database files and browser scratch profiles were removed.
