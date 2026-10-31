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

Reports retain source/build hashes, actual RTT calibration, distributions and sample counts,
correctness, stream recovery, screenshots and limitations. Default smoke p95 gates are 2,000 ms
HTTP/stalled-consumer acknowledgement, 3,000 ms peer/guest, 15,000 ms initial render, 100 ms navigation
interval and 12,000 ms reconnect. `CANVAS_COLLAB_MAX_<METRIC>_P95_MS` changes an explicitly declared
smoke threshold, never the separate roadmap targets or required evidence. The roadmap assessment
still requires peer p95 ≤500 ms, guest ≤2 seconds, initial render ≤3 seconds and physical/navigation
acceptance. Literal 16.7 ms rAF comparisons are quantized diagnostics, not a formal 60 fps p95 SLO.
Every local report keeps `capacityIncreaseAuthorized: false`.

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
