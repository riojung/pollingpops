# Component build pipeline and compiler diagnosis

Date: November 7, 2026. Baseline: merged `main` at `4526c66`. Implementation branch:
`codex/component-build-pipeline`. This changes build and verification tooling, not application
content schemas, subscription allowances or deployed services.

## Findings and remedies

| Finding                                            | Evidence                                                                                                                                                                                                                                                                                                                      | Implemented remedy                                                                                                                                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repeated cold browser compilation                  | A passing configuration invoked four production beta builds per profile, plus core and check builds: 21 web compilations across CI. Preparation deleted the entire `.next`, including its compiler cache.                                                                                                                     | One verified prebuild per role/profile job, compiler-cache preservation and separate build/serve phases. The configured total is nine web compilations; additional fresh API phases reuse the same web output.                |
| Unused declaration work on the critical path       | All seven shared packages export TypeScript source. The original task graph nevertheless required their `tsup --dts` builds before app builds and checks. Existing declaration logs showed about 18.8 seconds on the serial dependency path; contracts emitted a 7.61 MB declaration file that source consumers did not read. | Source-hash transit dependencies replace declaration prerequisites. Default build executes web, server, control and admin tasks. `pnpm build:packages` retains optional library artifacts.                                    |
| Cache inputs omitted configuration and environment | Original dry-run metadata omitted root TypeScript/ESLint configuration and custom Next output/build identity variables. External integration settings could be stripped by strict Turbo environment handling.                                                                                                                 | Explicit configuration, helper declaration, public environment and transitive source inputs; behavioral invalidation tests. Database/server test tasks are uncached with explicit integration environment forwarding.         |
| Output ownership and quiet failures                | Core/beta fixtures reused `.next`; another preparation could remove output. Compiler phases had no shared ownership or bounded command-level progress reporting.                                                                                                                                                              | Dedicated role outputs, exclusive compiler/server leases, fail-fast contention diagnostics, heartbeat phase/PID reporting, a configurable build deadline and awaited process-group cancellation.                              |
| Duplicate host and image compilation               | `product-build` ran complete host compilation before Docker; Docker ignored host outputs and compiled again.                                                                                                                                                                                                                  | Image builds run the dependency-context preflight and selected image compilation. Development image units are `server`, `web` and `control`. Hosted releases retain their complete exact-SHA manifest and promotion controls. |
| Docker cache invalidation                          | Control wrote each commit SHA before dependency installation. Server copied unrelated package source. Install/compiler caches were not persistent mounts.                                                                                                                                                                     | Control marker follows compilation; server copies its workspace closure. Component pnpm stores and web/control compiler caches use BuildKit mounts. Closure validation also covers mounted compiler instructions.             |

Application separation follows the existing architecture: customer web, server/API plus jobs,
operator control and admin CLI. API and jobs reuse one image as separate processes. Independent
component builds do not silently introduce independently versioned hosted releases or mixed
schema-reader versions. See the [component runbook](../runbooks/component-builds.md).

## Local compiler measurements

Representative observations on the same 12-CPU development host, Node 26.10.0 and pnpm 10.15.1.
Each cold run used a new dedicated output; its warm run reused that compiler cache. Process-tree
RSS was sampled every 500 ms. These are individual observations, not p95 estimates or a controlled
capacity certification. The first baseline was captured before the task interruption; its values
are retained from that measurement's tool output.

| Path                                                                                 | Cold elapsed | Warm elapsed | Cold peak process-tree RSS | Warm peak RSS |
| ------------------------------------------------------------------------------------ | -----------: | -----------: | -------------------------: | ------------: |
| Original direct Next build, full app/test type profile, default 11 prerender workers |      32.69 s |      17.35 s |                   2.46 GiB |      1.70 GiB |
| Guarded source build and production type profile, default workers                    |      25.57 s |      15.40 s |                   3.04 GiB |      1.81 GiB |
| Guarded production profile, two prerender workers                                    |      20.51 s |      20.80 s |                   1.90 GiB |      0.77 GiB |

The final cold observation is about 37% shorter and uses about 23% less peak memory than the
baseline. Warm latency varied and was not uniformly better. The reproducible architectural
savings are removing duplicate invocations and preserving cache, rather than promising a fixed
speedup for every compile. Type checking remains strict: production checks exclude test code,
while the ordinary workspace typecheck still includes it and all checks remain release gates.
Prerender workers and root Turbo concurrency are bounded independently at two.

Post-change logs/results are under `/tmp/pollingpops-build-optimization/`; the intermediate
uncapped observations are retained separately. No unconditional cache deletion, type-error
suppression, reduced test assertions, increased service rate limits or larger CI deadlines are
used to obtain these results.

## Hosted CI diagnosis

The baseline [main CI run](https://github.com/riojung/pollingpops/actions/runs/42396677535)
completed its build step successfully in 60 seconds. The
[WebKit beta job](https://github.com/riojung/pollingpops/actions/runs/42396677535/job/128475435409)
spent approximately 53 seconds starting its first production server/build, then ran 104 serial
tests for 26.7 minutes. Five retry windows added roughly 149 seconds. Its later media phase was
cancelled at the job's 30-minute budget. There was no compiler-startup timeout; diagnostics
reported no OOM and at least 10,036 MiB available memory in retained samples.

Two fixture defects contributed avoidable failures and retries:

- Private-sharing tried uploads against an API without configured media scanning, returning 503. It now runs with the existing synthetic-media fixture, alongside import/download tests.
- The receipt-heavy text-assistance case and its retry consumed the shared actor's admission
  window, causing a later source-fence case to return 429. Receipt recovery and the remaining
  text cases now get separate fresh API phases, reusing the already-built web application.

The full browser matrices, retries, assertions, admission policies and fail-closed aggregate gate
remain. Reports and resource diagnostics are retained per phase. A genuinely late failure of
the receipt-heavy case can still consume that case's own retry allowance; this split fixes the
observed cross-case coupling rather than granting unlimited operations.

Two pre-existing beta product failures remain separate: the mobile word-cloud header is not
fully within its viewport, and a Pack-update retry button is inside an inert editor section.
The baseline also had a flaky text-dialog contrast assertion that passed its retry. These
checks remain enabled; this work does not claim that all hosted CI or release gates are green.

## Qualification

Focused behavioral checks cover actual Turbo hash changes, required environment forwarding,
missing integration configuration, component image selection, complete Docker workspace input
closure, compiler leases, metadata restoration, deadline/signal process-tree cleanup, complete
standalone integrity and fresh-fixture CI coverage. Compiler checks use isolated owned processes;
image orchestration checks use fake Docker and pnpm executables.

`VITEST_MAX_WORKERS=1 pnpm check` completed successfully in **395.98 seconds**. Formatting,
Docker workspace closure validation, lint, full workspace type checks, tests and the four
application/admin build tasks passed. The run contains **6,362 passing package tests** and
**420 passing support tests**, for **6,782 passing tests**. Normal opt-in skips remain:
472 database, 15 server and one support test. Those skipped cases are not new database or
external-service qualification.

This complete run preceded the final import-only cleanup that makes Node built-ins explicit for
ESLint. After that cleanup, seven focused support files passed **131 tests in 55.78 seconds**;
`pnpm lint` passed across all ten workspaces and the new `lint:build` check passed fresh. Targeted
formatting, whitespace and Docker workspace closure checks also passed. These results do not
claim a second full check. The full log and exit/timing record are
`/tmp/pollingpops-build-optimization/full-check.log` and `full-check-result.json`.

Actual production browser qualification passed **22 cases using two web compilations and seven
fresh API phases**:

- Core accessibility cases ran in desktop Chromium and mobile WebKit from one core build.
- Private sharing and static/offline exports ran with the synthetic-media fixture in all four
  beta browser profiles, reusing one beta build.
- Receipt recovery and the remaining selected-text assistance cases ran in separate fresh APIs
  on mobile WebKit, with the same beta build and unchanged admission limits.

Manifest content hashes and modification times remained unchanged across the serve phases, and
their logs showed no recompilation. Full schema-2 source, environment and complete standalone
runtime provenance validation passed at the end of those phases. After exit, no build leases or
owned fixture ports remained, and the owned measurement outputs were removed. The phase results
and cleanup summary are `/tmp/pollingpops-build-optimization/browser-results.json` and
`browser-proof.json`; the corresponding phase logs and browser artifacts are in the same local
directory. These results qualify the selected production workflows, not the entire hosted matrix.

The first teardown attempt exposed a lifecycle defect: Playwright's default forced kill could
terminate the supervising helper while its detached Next process survived, causing a hang.
Both core and beta configurations now set
`gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 }` for the web helper. The corrected runner
allows the helper to signal and await its child process group, then release its output lease.
The passing browser run and empty post-exit port/lease checks above include this correction.

After the import-only cleanup, both roles were rebuilt from the then-current source and independently
passed schema-2 provenance validation, standalone HTTP 200, SIGTERM exit status 143, unchanged
manifest contents and modification time, and released output leases and ports. Core completed
in 25.40 seconds and beta in 16.74 seconds. This checks that source's build/start/shutdown
lifecycle without representing another run of the 22 browser cases. The result is
`/tmp/pollingpops-build-optimization/final-lifecycle-results.json`, with per-role build and serve
logs in the same directory.

Subsequent review found that terminal SIGHUP could exit the compiler wrapper while leaving its
detached compiler running. SIGHUP now uses the existing termination, escalation and awaited
cleanup path, returns exit status 129, restores both configuration files and releases both leases.
The compiler guard suite passed **22 tests**, including actual SIGINT/SIGTERM/SIGHUP supervisor
and descendant cleanup, unrelated process survival and signal-listener cleanup on success and
failure. Build-helper lint, test-file ESLint, formatting and whitespace checks passed. These
focused checks follow the earlier full-check and browser measurements above.

The local Docker daemon was unavailable, so **no actual application images were built**.
Workspace dependency closure checks and fake-tool image orchestration tests passed, including
component selection and hosted complete-manifest enforcement. BuildKit dependency and Next
compiler cache mounts are implemented, but their image-build performance, registry signing and
hosted deployment were not locally qualified. No services were deployed or restarted, and no
application persistence or schema change requires a new migration qualification. The two known
baseline beta product failures above and the existing release gates remain open.
