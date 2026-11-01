# Canvas capacity evidence

This opt-in repository harness measures the current bounded mixed workload. It does not authorize
higher canvas limits, establish commit-to-peer latency, or qualify production capacity.

`tests/load/canvas-load.mts` uses explicit `CANVAS_SCHEMA_VERSION` requests and the current object
schema. Frozen V1/V2 inputs are unchanged. `tests/load/canvas-capacity.ts` owns deterministic scene
construction, schema-validated request packing, configuration and measured repository gates.
`tests/support/canvas-capacity.test.ts` covers those builders and executable memory smokes at 20
objects/two editors and 250 objects/20 editors, including groups split across seed transactions.

## Small local verification

The following run needs no services and creates only disposable in-memory state:

```sh
CANVAS_LOAD_OBJECTS=20 CANVAS_LOAD_EDITORS=2 CANVAS_LOAD_UPDATES=1 CANVAS_LOAD_WARMUP=0 CANVAS_LOAD_READ_ROUNDS=1 pnpm exec tsx tests/load/canvas-load.mts
pnpm exec vitest run tests/support/canvas-capacity.test.ts
```

Defaults remain 500 objects and 20 separately licensed editors. Isolated repository candidate
profiles may use up to 50 licensed actors, within the existing grant limit; this changes no product
admission limit and establishes no measured or contractual concurrent-editor guarantee. Every actor awaits its
previous acknowledgement; this is closed-loop concurrency, not a fixed offered request rate.

| Variable                  | Default  | Allowed range                                          |
| ------------------------- | -------- | ------------------------------------------------------ |
| `CANVAS_LOAD_BACKEND`     | `memory` | `memory`, `postgres`                                   |
| `CANVAS_LOAD_OBJECTS`     | 500      | 20–500; at least editor count plus eight mixed objects |
| `CANVAS_LOAD_EDITORS`     | 20       | 2–50 for isolated evidence candidates                  |
| `CANVAS_LOAD_UPDATES`     | 10       | 1–50 per editor, excluding warm-up                     |
| `CANVAS_LOAD_WARMUP`      | 1        | 0–10 updates per editor                                |
| `CANVAS_LOAD_READ_ROUNDS` | 3        | 1–10 rounds of concurrent actor reads                  |
| `CANVAS_LOAD_TEXT_CHARS`  | 160      | 16–1,000 characters of synthetic multilingual text     |
| `CANVAS_LOAD_PEN_POINTS`  | 32       | 2–128 points per synthetic stroke                      |

Scenes include independent editor nodes, sticky/text/rectangle/ellipse/diamond/parallelogram nodes,
world-coordinate frames, coherent geometric groups, visible-endpoint connectors and bounded pen
strokes. Seed batches pass the actual current mutation validator, including both 50 affected objects
and 64 KiB serialized operation limits. Scene data stays within 500 objects and 2 MiB.
When a seed transaction joins an existing geometric group, its related-version fences come from
the previously acknowledged board. Packing counts those existing peers within the same 50-object
budget and includes their serialized fences in the byte limit. Seed transactions run sequentially;
timed editor updates retain the configured concurrency. A failed run reports only a static phase
and optional numeric fixture index, without scene or principal content.

Before timed writes, the fixture retains up to eight resolved discussions with two messages each,
exercises author edits and replies, starts/pauses/resumes a server timer, and saves two manual
checkpoints. Those states remain present during warm-up, timed writes and reads. Existing history,
comment and operation limits are preserved. The computed receipt upper bound must leave room below
the 5,000-receipt document lifetime budget. Fixtures are synthetic and contain no external assets.

Correctness checks require every independent edit, unchanged unrelated objects, an exact retry with
the original receipt and unchanged sequence, rejection of stale writes, denied outsider/revoked
access to scene and history, retained facilitation, and metadata-only outbox pagination. A memory
reopen creates another repository facade over the same process; it is not a persistence/restart
claim. PostgreSQL additionally reopens an independent database connection.

## PostgreSQL runs

Coordinate resource use before running the PostgreSQL profile. Supply an existing dedicated
restricted runtime login and a separate admin login on the same disposable test cluster through
`CANVAS_LOAD_DATABASE_URL` and `CANVAS_LOAD_DATABASE_ADMIN_URL`. Never put their values in an evidence
document or committed file. The harness creates, migrates and drops a uniquely named test database;
it never changes cluster roles or forcibly terminates unrelated sessions. The runtime role must
have neither superuser nor `BYPASSRLS` privileges.

```sh
mkdir -p artifacts/canvas-capacity
CANVAS_LOAD_BACKEND=postgres pnpm exec tsx tests/load/canvas-load.mts > artifacts/canvas-capacity/postgres.json
```

Use the actual provisioned test-cluster configuration, migration compatibility and application
revision. A passing local database run does not supply the target deployment's CPU, IOPS, network,
multi-node, media-pipeline or physical-device evidence.

## Evidence and optional gates

JSON records the source revision and dirty-tree status, current protocol, deterministic fixture hash,
object/type and byte counts, bounded workload parameters, sample counts, nearest-rank p50/p95/p99/max,
closed-loop throughput, and sampled process RSS/heap/external-memory high-water values. Memory
values are observed samples, not continuous peak measurements; database memory is not included.
Environment metadata contains Node/kernel/platform/architecture, logical CPU count, host RAM,
PostgreSQL version, runtime pool maximum and whether restricted RLS was checked. It excludes
connection strings, hostnames, identities, credentials, object bodies, ballots and media paths.

No numeric latency gate is enabled by default. Set a finite, nonnegative maximum in milliseconds
only when the operator has chosen an appropriate **repository** budget:

| Variable                              | Exact measured field                             |
| ------------------------------------- | ------------------------------------------------ |
| `CANVAS_LOAD_MAX_COMMIT_P95_MS`       | `repositoryLatencyMs.commitAcknowledgement.p95`  |
| `CANVAS_LOAD_MAX_READ_P95_MS`         | `repositoryLatencyMs.concurrentSnapshotRead.p95` |
| `CANVAS_LOAD_MAX_FACILITATION_P95_MS` | `repositoryLatencyMs.facilitationMutation.p95`   |

The artifact lists every requested threshold and observed value. A breached threshold or missing
requested measurement exits nonzero after emitting JSON and cleaning up. Successful repository
gates still report `capacityIncreaseAuthorized: false`. Warm-up is recorded separately from timed
acknowledgements. Facilitation mutations are setup measurements with the growing retained state;
they are not sampled concurrently with timed scene writes. Small sample p99 values are diagnostic,
not statistically established tail latency.

## Production-browser collaboration harness

`tests/load/canvas-collaboration-capacity.mts` is separate from repository timing. Supply dedicated
loopback services through `CANVAS_COLLAB_DATABASE_ADMIN_URL`, `CANVAS_COLLAB_DATABASE_URL` and
`CANVAS_COLLAB_REDIS_URL`; never commit their values. The runtime database login must be a separate
restricted principal. The harness creates/drops a unique database and uses a unique Valkey namespace;
it does not alter cluster roles or flush shared caches. Default ports are 3500/4500/4501 and must be
free. It builds a production Next bundle in `.next-canvas-capacity`, starts two real HTTP API nodes
inside one coordinator process, and opens separately licensed Chromium contexts.

```sh
CANVAS_COLLAB_OUTPUT=/tmp/canvas-collaboration.json pnpm exec tsx tests/load/canvas-collaboration-capacity.mts
pnpm exec vitest run tests/support/canvas-collaboration-config.test.ts
```

Defaults are 500 mixed objects, 20 editors, one warm-up and three measured waves, 100 guest objects
and nominal 100 ms CDP latency. `CANVAS_COLLAB_OBJECTS` (20–500), `CANVAS_COLLAB_EDITORS` (2–20),
`CANVAS_COLLAB_UPDATES` (1–20), `CANVAS_COLLAB_WARMUP` (0–3), `CANVAS_COLLAB_GUEST_OBJECTS` (2–300)
and `CANVAS_COLLAB_LATENCY_MS` (0–1,000) configure bounded profiles. Use
`CANVAS_COLLAB_BUILD_ONLY=true` to prepare the isolated bundle; `CANVAS_COLLAB_BUILD=false` reuses it
only if its source fingerprint and compiled API origin match. Execution failures emit an incomplete report
with the failing stage and any collected samples; they do not become capacity acceptance.

Every actor calibrates actual health-fetch RTT. Measured editor targets must intersect both the
canvas and viewport; the full authorized accessible outline is retained. Scene commands resolve
after the repository transaction, then another node's browser observes changed SVG text and two
animation frames on the coordinator's monotonic clock. This is an upper-bound **paint opportunity
after repository resolution**, not exact SQL COMMIT timing or physical pixels. HTTP acknowledgement
is measured independently. The fixture also checks exact retry, stale rejection, outsider/revoked
access, guest cookie omission, moderation, initial rendering and reconnect after destroying a real
stream response. A paused raw TCP consumer supplies an isolation observation, not saturation/cutoff
proof. Two placements share tiny synthetic clean PNG bytes through the authorized media endpoint;
S3, scanning and realistic media decode cost are substituted.

Reconnect completion requires both the latest authorized text plus two animation frames and a
renewed stream request. Polling can restore content before the fixed stream retry; neither
observation alone completes recovery. The existing request timeout and 12-second smoke threshold
remain, and reconnect timing includes the later observation.

Reports retain source/build hashes, actual RTT calibration, distributions and sample counts,
correctness, stream recovery, screenshots and limitations. Default smoke p95 gates are 2,000 ms
HTTP/stalled-consumer acknowledgement, 3,000 ms peer/guest, 15,000 ms initial render, 100 ms navigation
interval and 12,000 ms reconnect. `CANVAS_COLLAB_MAX_<METRIC>_P95_MS` changes an explicitly declared
smoke threshold, never the separate roadmap targets or required evidence. The roadmap assessment
still requires peer p95 ≤500 ms, guest ≤2 seconds, initial render ≤3 seconds and physical/navigation
acceptance. Literal 16.7 ms rAF comparisons are quantized diagnostics, not a formal 60 fps p95 SLO.
Every local report keeps `capacityIncreaseAuthorized: false`.

### Optional query and pool profiling

Set `CANVAS_COLLAB_PROFILE=true` to add harness-only numeric profiling. Disabled mode installs no
repository or pool wrappers. `CANVAS_COLLAB_PROFILE_MAX_SAMPLES` defaults to 20,000 and accepts
1–100,000 completed samples across all kinds; use the same value for compared variants. Reports
include sample-truncation and censored in-flight counts. Truncated retained quantiles can be biased
and do not represent a complete distribution.

The measured epoch begins after warm-up and ends after the concurrent writes/peer observations.
Numeric operation/parent ordinals correlate existing public repository methods with direct SQL
category, elapsed time, driver row count and pool-acquisition wait. Setup and operations begun
before the epoch are excluded. Query text, parameters, principals, result bodies and error text
are never retained. Wrappers preserve original Promise identity and callback receivers, arguments
and failures; they do not move the existing repository-resolution paint-ledger boundary.

SQL duration includes driver/network/lock waits and is not database CPU or an exact SQL COMMIT
timestamp. Row counts include writes and reveal neither byte cost nor row content. Pool pressure
is sampled at acquisition boundaries; its high-water values are individual-pool observations,
not continuous maxima or a sum across nodes. Only work inside wrapped Canvas methods is attributed;
credential/policy queries outside them remain excluded. Nested method wall times overlap and direct
SQL belongs to the innermost method, so do not add their durations or independent p95 values.

Fixed initiating-origin labels distinguish presenter HTTP polls, scene reads, facilitation,
commands, stream work and other/unscoped work. HTTP requests have numeric ordinals; stream and
outbox samples deliberately have no handshake request ordinal. The separate origin context does
not own the measured epoch: work that began before warm-up finished remains excluded. Paths and
query strings are inspected only to select a fixed label and are never retained. Grouped method
completions describe a partial measured window, not complete HTTP request counts or lifetimes.
This can identify repeated presenter checks without mislabeling them as stream reauthorization.

The report records API/DB/harness source hashes alongside browser-build provenance. Compare equally
instrumented variants with unchanged scene, actor count, network calibration and batching; then
confirm the end-to-end result with profiling disabled. Instrumentation has overhead and changes no
product behavior, workload or acceptance gate. All timed runs require a quiet host, without other
builds, browser suites or database tests.

## October 30, 2026 local observations

These are short, single-machine observations on the dirty Order 7 branch based on `6a8e828`, with
restricted PostgreSQL 17 and real Valkey. They do not establish a causal improvement or production
capacity. Repository samples use 500 objects, 20 actors and 200 independent writes, with retained
facilitation/history. The indexed variant replaces repeated persistence-array scans with maps;
authorization and transaction behavior are unchanged.

| Repository variant  |   Ack p50 |     Ack p95 |     Ack p99 |     Ack max | Snapshot-read p95 (60 samples) |
| ------------------- | --------: | ----------: | ----------: | ----------: | -----------------------------: |
| Baseline            | 397.66 ms | 3,979.50 ms | 5,439.89 ms | 7,928.45 ms |                      478.42 ms |
| Indexed comparisons | 395.99 ms | 2,625.80 ms | 6,893.64 ms | 7,067.73 ms |                      464.60 ms |

Both repository runs passed correctness. No numeric repository budget was requested. Lower p95
alongside a higher p99 in one pair is not robust evidence of a speedup; host load was uncontrolled.

The production-browser profile used the same 500-object scene, 20 licensed editors, 60 measured
writes and nominal 100 ms network shaping. Per-actor median calibration was approximately
105–107 ms for the supported 350 ms notification coalescing setting, and 108–112 ms for the 200 ms
experiment. All correctness checks passed in both runs; both exited nonzero because the declared
2,000 ms acknowledgement gates failed. The 200 ms experiment was reverted.

| Metric                                                  |   Samples | Supported 350 ms setting p50 / p95 / p99 / max | Reverted 200 ms setting p95 |
| ------------------------------------------------------- | --------: | ---------------------------------------------- | --------------------------: |
| HTTP acknowledgement                                    |        60 | 1,529.60 / 2,086.80 / 2,283.10 / 2,283.10 ms   |                 2,279.20 ms |
| Repository resolution to visible peer paint opportunity |        60 | 444.30 / 895.61 / 1,206.06 / 1,206.06 ms       |                 1,307.63 ms |
| Initial render                                          |        20 | 1,031.10 / 1,056.30 / 1,058.30 / 1,058.30 ms   |                 1,051.50 ms |
| Guest publication                                       |         1 | 479.77 ms                                      |                   520.86 ms |
| Reconnect                                               |         1 | 918.47 ms                                      |                 1,231.33 ms |
| Navigation rAF interval                                 | 158 / 153 | 16.70 / 16.70 / 16.80 / 16.80 ms               |                    16.80 ms |

The peer p95 missed 500 ms. Single guest/reconnect samples do not establish tail latency. Mean
rAF cadence was approximately 60 Hz; no physical-device frame-rate claim follows. Shorter batching
did not improve this observed run and produced additional stream-unavailable recoveries; one pair
does not isolate a cause. The source scene SHA-256 was
`da58ab23444f9aff8669e35d6baa9b5d98ca31993f764c745627937bf79346f1`. Local raw reports are
`/tmp/pollingpops-diagrams-capacity-{baseline,indexed}-postgres.json` and
`/tmp/pollingpops-canvas-collaboration-500-20{,-200ms}.json`; retain their JSON and sibling artifacts
with a release's evidence bundle rather than treating temporary paths as durable evidence storage.

Physical mobile/touch devices, realistic scanned media, independent API processes/hosts, deployed
proxy/TLS, long-duration saturation, near-limit discussion/history/receipts and all-to-all peer
observations remain unmeasured. **Capacity acceptance failed; all product limits remain unchanged.**

## October 31, 2026 Node 22 comparison

This follow-up starts from merged `6cb8e2e` with the CI repairs on
`codex/ci-and-canvas-performance`. The baseline contains those repairs; the candidate adds only
the Canvas database changes below. Both variants use the same production browser bundle,
350 ms notification coalescing and unchanged product limits. The workload is 500 objects
(313,422 scene bytes), 20 separately licensed browser contexts, one warm-up and ten measured
waves: 200 commands per run, plus 100 ordinary guest objects and the same tiny synthetic image.
Browser runs do not seed retained discussions/manual checkpoints; separate repository fixtures
and conformance tests cover those features. These observations do not qualify a dense-history
or realistic-media workload.

Node 22.23.4 and Chromium 156.0.8078.4 run on ARM64 macOS. Dedicated PostgreSQL 17.11 and Valkey
8.1.10 run in a 4-vCPU Docker VM reporting 8,309,010,432 bytes of total memory. The cache artifact
records its advertised Redis compatibility version, 7.2.4. Two HTTP API nodes share one
coordinator process with independent repository pools, each limited to 15 connections.
Nominal CDP request latency stays 100 ms; each run records 100 actual health-fetch calibrations.
No other task builds, suites or timed runs execute during a measurement.

The run order is B1, C1, C2, B2, B3, C3, then B-off and C-off. Each run creates a fresh disposable
database/cache namespace and browser process. Guarded source switches accept only the captured
baseline/candidate bytes; browser and fixture hashes match across all eight runs. The dirty-tree
base revision alone does not identify either variant, so the recorded SHA-256 values are:

```text
Baseline API/DB/harness: 1917efb4b344a614d3e937b0009889336d9485179a50f8c173050414720522ce
Candidate API/DB/harness: f987f1a2672460fddee65118b1938b80264395f99ff53a1337edb18375a5071f
Shared browser sources: 43dcc627c793a99e2600c10440791f06fcddf434d2e86d3920637d4ea6c88208
Shared scene: da58ab23444f9aff8669e35d6baa9b5d98ca31993f764c745627937bf79346f1
```

### Bounded database changes

- Ordinary scene reads load current objects, sharing metadata and actor-owned undo/redo heads.
  They do not hydrate every inverse receipt, discussion or saved scene. Their distinct read-only
  type never enters `put()` or the complete-originals cache. Authorization preflight, loaded-role
  and expiry checks, workspace/board/source lock order and accepted operation-ID casing remain.
- License decisions reuse facts read within the same locked transaction, through the canonical
  pure policy. There is no cross-request authority cache. Origin-assignee membership remains
  distinct from the actor's membership, and quantity, fallback, hold and clock semantics remain.
- Complete write-state hydration parses current objects once. Persistence skips object,
  discussion-thread and saved-version DELETEs only when a complete locked original proves that
  no IDs were removed. Unknown prior state and real removals retain DELETEs and cascades; full
  receipt/version validation remains on write/history paths.

All 369 selected Memory/restricted-PostgreSQL cases pass, with one existing skip, including the
new license/snapshot parity cases. The legacy retry test also reproduced an array-order
assumption on the baseline; it now compares every current object field by ID. All 25 dedicated
desktop/mobile Canvas browser cases pass. Independent read-only checks found no issue in the
combined authorization, snapshot/originals and real-deletion behavior.

### Per-run latency

Every row below has 200 measured commands. Profiling-on pairs therefore provide 600 command
samples per variant; the separate profiling-off pair supplies 200 more each. Percentiles are
per run, not pooled or averaged. B-off/C-off install no profiling wrappers; this single pair
confirms the direction without the observer and does not estimate its overhead precisely.
The [numeric/provenance summary](canvas-capacity-comparison-2026-10-31.json) retains all per-run
metric distributions, raw-artifact hashes, gate results, calibration and profiling coverage.

| HTTP acknowledgement, ms |     p50 |     p95 |     p99 |     max |
| ------------------------ | ------: | ------: | ------: | ------: |
| B1, profiling on         | 1660.60 | 2589.80 | 2835.60 | 3081.60 |
| C1, profiling on         | 1172.80 | 1701.00 | 1748.60 | 1876.90 |
| B2, profiling on         | 1582.80 | 2450.30 | 2677.10 | 2766.80 |
| C2, profiling on         | 1149.70 | 1705.70 | 1832.30 | 1906.60 |
| B3, profiling on         | 1660.20 | 2531.50 | 3098.30 | 3186.20 |
| C3, profiling on         | 1141.30 | 1635.30 | 1684.90 | 1724.20 |
| B-off                    | 1554.50 | 2428.40 | 2653.50 | 2760.70 |
| C-off                    | 1146.50 | 1781.70 | 1884.60 | 1976.10 |

| Repository resolution to peer paint opportunity, ms |     p50 |     p95 |     p99 |     max |
| --------------------------------------------------- | ------: | ------: | ------: | ------: |
| B1                                                  | 1046.48 | 2217.85 | 2660.94 | 2757.12 |
| C1                                                  |  519.62 | 1159.82 | 1350.98 | 1440.86 |
| B2                                                  |  800.94 | 1681.95 | 1923.82 | 2021.59 |
| C2                                                  |  773.93 | 1399.21 | 1475.62 | 1497.56 |
| B3                                                  |  947.10 | 1748.70 | 1970.20 | 2078.13 |
| C3                                                  |  673.17 | 1324.64 | 1634.90 | 1711.30 |
| B-off                                               |  955.38 | 1776.99 | 2189.30 | 2283.57 |
| C-off                                               |  627.92 | 1115.58 | 1247.09 | 1287.63 |

### SQL and pool observations

Exact direct SQL joins cover retained completed operations, with no query-count mismatches.
The three profiled runs give the following counts; p50, p95, p99 and max coincide in each cell.
Driver row totals include writes and are not transferred bytes or distinct business records.

| Completed operation            | Baseline SQL statements | Candidate SQL statements | Completed samples B / C |
| ------------------------------ | ----------------------: | -----------------------: | ----------------------: |
| Owner command                  |                      58 |                       49 |                 30 / 30 |
| Other-editor command           |                      58 |                       50 |               570 / 570 |
| Owner current-scene get        |                      42 |                       32 |               186 / 142 |
| Other-editor current-scene get |                      42 |                       33 |           1,637 / 1,468 |

Platform-category statements fall from 14 to 8 for the owner and 9 for other editors. Commands
also omit three empty DELETEs. Ordinary gets omit comment/timer/version hydration, and their
receipt query returns one history head instead of the growing full receipt set. They still
return 500 current object rows. Background refresh counts and measured-window durations differ,
so full-window query totals are not used as a fixed-work query-reduction percentage.

| Pair | Pool acquisition wait p95, baseline / candidate ms | Node-1 waiting boundary maximum B / C |
| ---- | -------------------------------------------------: | ------------------------------------: |
| 1    |                                  321.086 / 278.880 |                               49 / 53 |
| 2    |                                  348.777 / 182.029 |                               57 / 48 |
| 3    |                                  347.555 / 272.832 |                               52 / 51 |

Node 1 reaches 15 connections in every run. Node-0 connection maxima are 5/5/5 for baseline
and 6/5/5 for candidate, with no sampled queue. These are individual-pool acquisition-boundary
maxima, not cluster totals or continuous maxima; queue maxima are not universally lower.
Pool contention remains measurable.

All six profiled runs retain samples below the same 100,000-completion bound, with no drops,
unsupported returns, invalid samples or failed completed operations. At window stop, unfinished
operation/query/pool counts are B: `13/12/1`, `13/13/0`, `13/13/0`; C: `9/9/0`, `10/10/0`,
`18/14/4`. Their partially observed get/authorize queries are excluded from the completed-operation
denominators above. These censored windows are not claimed as exhaustive accounting of every
background request.

All eight runs complete with all correctness checks passing: observed edits, final object versions,
exact retry, stale rejection, cross-node outsider/revocation denial, guest privacy/cookie omission
and zero application page errors. Every baseline fails the unchanged 2,000 ms acknowledgement
and stalled-consumer gates; every candidate passes every smoke gate. **Every run still fails the
500 ms peer roadmap target.** Initial-render p95 is 1,050.0–1,063.9 ms (20 samples/run).
Guest publication is 461.29–531.71 ms and reconnect 420.80–1,257.37 ms, each with only one
observation per run. Navigation rAF p95 is 16.7–16.8 ms; these quantized headless observations do
not establish physical-device frame delivery or touch performance.

Raw reports and sibling screenshots are under `/tmp/pollingpops-canvas-comparison/`; retain them
with a release's evidence bundle. These are bounded local comparisons, not production capacity
acceptance. Physical devices, real media/scanning, independent serving processes, deployed
proxy/TLS, near-limit retained state and sustained staging load remain required. The 500-object,
2 MiB, 50-affected-object, 64 KiB-operation and 5,000-receipt limits remain unchanged;
20 editors describes this workload, not a new admission cap. Every report retains
`capacityIncreaseAuthorized: false`.

## Required next evidence phase

Keep a separate production-browser/two-node harness so repository timing cannot be mistaken for
delivery or rendering. Before a cap raise, agree on these profiles and record immutable build
revision, network shaping, host/database/cache resources and whether media services are real:

1. At current caps, combine HTTP scene edits, checkpoint/comment reads, opt-in presence/presenter
   traffic, admitted guest publication, reconnects and slow consumers across both serving nodes.
   Measure submitted-to-ack, true committed-to-peer-rendered and guest-publication times separately.
   The existing outbox creation timestamp alone is not an exact post-COMMIT timestamp.
2. Use a production web build with dense and sparse scenes. Measure cold/warm initial visible
   content, pan/drag frame-time distributions, DOM/heap/decoded-image cost and recovery. Any render
   culling must retain the full authorized accessible outline and resolve connectors against the
   authorized scene, rather than treating offscreen objects as private or missing.
3. Record the approximately 100 ms RTT profile and agreed bandwidth/device. Test the plan's proposed
   peer p95 ≤500 ms, guest publication p95 ≤2 seconds, initial visible content p95 ≤3 seconds and
   desktop navigation targeting 60 fps as their own gates. They are not repository-ack budgets.
4. Exercise near-limit receipts/history/comment bytes, realistic private scanned images and a
   sustained run with bounded board rotation. Require exact retry, revocation, moderation, freeze,
   deletion and cookie-omission invariants throughout; do not expand quotas to keep a test running.
5. Repeat on the intended staging host and named physical mobile devices. Local headless browsers,
   substituted media/scanning and development-server runs cannot close those gates.

Only after applicable current-cap gates pass should an isolated candidate vary one dimension at
a time. Any object-cap change also needs compatible current/frozen contract readers, checkpoint
SQL constraints and deployment coordination. Editor workload increases remain subject to existing
licenses, grants, presence/connection limits, database resources and abuse controls. No such limits
are raised by this evidence tooling.

## October 31, 2026 delivery confirmation: presenter only retained

The retained change consolidates the creator presenter GET guards. The client covered-notification
refresh experiment was rejected and its four client files reverted: it produced fewer observed
scene reads and faster acknowledgements, but worse peer p95 in all three profiled comparisons and
the profiling-disabled comparison. The separate presenter-only phase does **not** establish a
latency win: its ranges overlap the baseline, and its unprofiled peer p95 is slightly higher.
All twelve confirmation runs completed and passed correctness and every unchanged harness smoke
gate. **Every peer p95 still exceeds the 500 ms roadmap target; capacity acceptance remains open.**

[The durable numeric/provenance summary](canvas-delivery-comparison-2026-10-31.json) records every
run's p50/p95/p99/max/count, calibration, origin counts, partial request histograms, pool boundaries,
censoring and artifact hashes. The rejected client patch is preserved in
[the experiment archive](experiments/canvas-covered-notification-refresh.patch): 29,997 bytes,
SHA-256 `446c64182dcbf6b494ab832a1d135c924866946c696dd6d92caf04627a64e2fe`.

The archive omits three optional blank-context space markers to pass whitespace checks; its
applied client source/test bytes match the measured variant exactly.

### Corrected recovery oracle and confirmation order

The earlier `candidate-pair-2.json` remains **incomplete**, at `offline-reconnect`, with detail
`Offline recovery must open a renewed stream`. It already had 200 acknowledgement samples,
200 peer-paint samples and 20 initial-render samples, but polling could paint before the fixed
one-second stream retry. Its SHA-256 is
`b7dac3d69c136e237ce7c8bfd58d3e2c8db6dd37e53132c5cd1d94063909e9bb`;
it is excluded from accepted confirmation results. The harness now awaits **both** matching text
plus two rAF and a renewed stream request, and reconnect timing ends after both. It retains the
same configured timeout, final stream-count assertion, real offline/existing-stream interruption
and 12,000 ms reconnect smoke gate. Product retries and 350 ms notification batching are unchanged.
The complete earlier `baseline-pair-1`, `presenter-exploratory` and `candidate-pair-1` artifacts are
also excluded as pre-oracle-fix exploratory runs; their hashes remain in the durable summary.

Confirmation order was **B1, C1, C2, B2, B3, C3, B-off, C-off**, then **P1, P2, P3, P-off**.
B is the current-main baseline, C combines presenter and rejected client changes, and P retains
only presenter. P is a later separate phase, not an interleaved pair or a statistical causal
comparison. Each run uses a fresh disposable database/cache namespace and browser process,
500 mixed objects (313,422 scene bytes), 20 licensed contexts, one warm-up and ten measured waves
(200 commands), 100 ordinary guest objects and one 68-byte synthetic image placed twice.
Twenty editors describes this workload, not an admission cap. Source revision is dirty-tree
`7282d5ce34a307d099a6b720d2807ab3f8cb37ec`; the variant hashes identify the actual measured bytes:

| Variant      | API/DB/harness SHA-256                                             | Browser-source SHA-256                                             |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| B            | `a8a5d19aca67e68895390f41206d9bd35cd74f4f674530d49f53e11e4800a5d3` | `383753e30fedcd3eb24a7c7f5147206f9dd99631298f6321e5804d5175091927` |
| C (rejected) | `4875b37d24cf00ad1d907649ff25ed2a200b9761838dcf7d123c729b4aba6b9e` | `1187c97b4064421319d01737924c8fcaa08687a88e492536ae99b0c0b33b16ce` |
| P (retained) | `4875b37d24cf00ad1d907649ff25ed2a200b9761838dcf7d123c729b4aba6b9e` | `383753e30fedcd3eb24a7c7f5147206f9dd99631298f6321e5804d5175091927` |

The fixture hash is unchanged:
`da58ab23444f9aff8669e35d6baa9b5d98ca31993f764c745627937bf79346f1`.
B/P reuse the browser compiled at `2026-10-31T20:27:54.998Z`; C uses its own browser compiled at
`2026-10-31T20:34:53.842Z`. Both API variants share the corrected harness. Artifact hashes and
compiled/source checks are retained in the JSON, without raw sample IDs, URLs or application content.

### End-to-end observations

Times below are **p50 / p95 / p99 / maximum in ms**, with 200 samples per cell. Ack includes shaped
browser HTTP/auth/repository/projection work. Peer is repository resolution to matching SVG plus
two rAF, not an exact database commit timestamp or a physical presented frame.

| Run              | HTTP acknowledgement                  | Repository resolution to peer paint opportunity |
| ---------------- | ------------------------------------- | ----------------------------------------------- |
| B1               | 1,293.6 / 1,874 / 1,952.6 / 2,066.1   | 565.94 / 1,161.96 / 1,316.91 / 1,403.02         |
| C1 (rejected)    | 1,104.3 / 1,506.4 / 1,586.2 / 1,697.1 | 950.61 / 1,751.21 / 1,869.58 / 1,948.37         |
| C2 (rejected)    | 1,029.7 / 1,519.6 / 1,691.3 / 1,747.8 | 732.7 / 1,340.96 / 1,490.77 / 1,601.56          |
| B2               | 1,243.9 / 1,798 / 1,886.3 / 1,969.6   | 643.19 / 1,252.16 / 1,381.75 / 1,471.5          |
| B3               | 1,209.9 / 1,740.6 / 2,050.1 / 2,211.3 | 591.96 / 1,179.38 / 1,342.12 / 1,489.65         |
| C3 (rejected)    | 1,049.3 / 1,457 / 1,541.8 / 1,675.6   | 856.17 / 1,422.95 / 1,567.56 / 1,663.46         |
| B-off            | 1,154.5 / 1,760.9 / 1,835.5 / 1,877.6 | 710.93 / 1,151.36 / 1,248.21 / 1,391.28         |
| C-off (rejected) | 1,074.2 / 1,621.2 / 1,789.8 / 1,906.6 | 842.66 / 1,431.8 / 1,660.32 / 1,791.05          |
| P1               | 1,209.3 / 1,779.2 / 1,999.6 / 2,071   | 524.33 / 1,073.9 / 1,239.2 / 1,252.36           |
| P2               | 1,227.4 / 1,756.4 / 1,958.1 / 2,251.9 | 643.75 / 1,277.95 / 1,462.28 / 1,693.3          |
| P3               | 1,223.3 / 1,772.5 / 1,908.5 / 1,961.3 | 629.14 / 1,198.79 / 1,420.07 / 1,474.36         |
| P-off            | 1,135.2 / 1,619.2 / 1,730.5 / 1,779.9 | 632.81 / 1,179.34 / 1,288.47 / 1,327.98         |

Initial render has 20 samples/run; guest publication and reconnect each have only one, so their
reported p95 does not establish a tail distribution. Their complete quantiles, navigation rAF
samples and stalled-consumer acknowledgements are retained in the JSON. Across all twelve runs,
100 health fetches/run produced p50 107.3–114.2 ms, p95 110–120.4 ms and maximum 111.2–122.3 ms;
actor p50 values were 101.9–115.1 ms. Every actor passed the unchanged calibration check against
nominal 100 ms CDP latency. These health fetches include browser/HTTP overhead, not pure WAN RTT.

### Origin and pool observations

The inactive creator presenter GET has two direct Canvas `authorize` calls after consolidation,
compared with four before. Active presenter owner/frame validation can add work. Initial access,
feature checks before/after cache and owner/frame awaits, fresh same-session identity, final
captured-principal authorization, expiry and board/source-sequence fences remain required.
The extra final feature-policy lookup is **outside** wrapped Canvas SQL profiling: lower profiled
query totals do not establish a percentage reduction in all SQL or system load.

| Run           | Wrapped SQL completions | Presenter-origin authorize completions | Scene-origin get completions | Pool wait p95 / max ms | In flight: operation / query / pool | Orphan queries |
| ------------- | ----------------------- | -------------------------------------- | ---------------------------- | ---------------------- | ----------------------------------- | -------------- |
| B1            | 64,696                  | 929                                    | 401                          | 255.697 / 722.812      | 17 / 16 / 1                         | 297            |
| C1 (rejected) | 49,644                  | 450                                    | 281                          | 238.128 / 452.794      | 1 / 1 / 0                           | 19             |
| C2 (rejected) | 50,734                  | 461                                    | 273                          | 162.939 / 295.405      | 2 / 2 / 0                           | 40             |
| B2            | 59,454                  | 830                                    | 352                          | 272.817 / 522.405      | 19 / 11 / 8                         | 228            |
| B3            | 62,032                  | 907                                    | 378                          | 272.736 / 769.697      | 7 / 7 / 0                           | 119            |
| C3 (rejected) | 49,645                  | 466                                    | 269                          | 170.831 / 449.601      | 0 / 0 / 0                           | 0              |
| P1            | 49,576                  | 377                                    | 368                          | 341.856 / 648.861      | 11 / 10 / 1                         | 173            |
| P2            | 48,832                  | 398                                    | 335                          | 289.152 / 711.482      | 14 / 13 / 1                         | 176            |
| P3            | 52,416                  | 426                                    | 406                          | 333.943 / 554.426      | 15 / 14 / 1                         | 218            |

All nine profiled runs retained every completed sample: **zero drops**, no invalid or unsupported
observations, and no recorded operation/query/pool failures. The bound was 100,000 completions;
eight runs still had in-flight work when the epoch stopped (C3 had none). Orphan query samples
lack a retained completed operation and remain disclosed. Every retained exact completed command
used 49 direct queries on node A or 50 on B; scene/projecting `get` used 32 or 33 respectively.
Those counts do not include SQL outside the wrapped method. The JSON retains counts by node,
fixed origin and method, and **PARTIAL WINDOW** authorize histograms; requests may cross epoch
boundaries, so these are neither complete HTTP request counts nor request lifetimes. Nested
method wall times and independent p95 values are never added.

Individual pool acquisition-boundary samples reached 15 connections on node B (its configured
maximum), with up to 60 queued acquisitions in P1; node A reached 4–6 connections with no observed
queue. These are individual-pool boundary maxima, not continuous maxima or cluster connection
totals. C's completed scene reads were 269–281 versus B's 352–401, while P observed 335–406;
window durations and polling schedules differ, so these counts are not a throughput/load claim.

### Resource and acceptance limits

Node 22.23.4 and native headless Chromium 156.0.8078.4 ran on ARM64 macOS with 24 GiB RAM.
PostgreSQL 17.11 and Valkey 8.1.10 ran in the same 4-vCPU VM reporting 8,309,010,432 bytes RAM
(the artifact records Redis compatibility 7.2.4). Two API nodes share one coordinator with
independent 15-connection pools; the restricted runtime RLS check passed. The existing user stack
was idle and no other task build/suite ran during timing. macOS memory-pressure levels 1–2 were
observed intermittently, not continuously sampled.

Physical desktop/mobile/touch and presented-frame acceptance, real media/S3/scanner decoding,
independently serving API processes/hosts, deployed proxy/TLS, sustained soak, all-to-all delivery
and near-limit retained history/comments/receipts remain unmeasured. This is local current-cap
evidence only. The **500-object, 2 MiB, 50-affected-object, 64 KiB-operation and 5,000-receipt limits
remain unchanged**, and every report retains `capacityIncreaseAuthorized: false`.
