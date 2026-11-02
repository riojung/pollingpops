# Prepared-target Canvas rehearsal

`tests/load/canvas-target-capacity.mts` observes an already running application through its normal
HTTP APIs and headless desktop Chromium. It never builds or deploys the app, seeds a database,
creates/deletes boards, bypasses authentication, replaces storage/scanning, changes feature flags,
or relaxes production rate limits. Prepare dedicated synthetic accounts and boards through the
supported product UI/APIs before using it. Do not point this driver at customer content or an
unknown board.

The loopback collaboration harness is a separate diagnostic. A successful local
rehearsal cannot satisfy deployed staging, physical-device or release acceptance. Target mode also
requires independent deployment, media, saturation and operations review; its artifact always
keeps `stagingAcceptanceComplete` and `capacityIncreaseAuthorized` false.

## Prepare the target

1. Use matching production server/web images for one immutable full Git commit. Record and verify
   their signed manifest and deployment receipt separately. The driver requires that exact marker
   from API `/health/live` and web `X-OpenRound-Build-Id` both before and after measurement; markers
   identify the declared candidate but do not independently prove image provenance or build mode.
   Only explicit loopback local-rehearsal mode may use the literal `unversioned` when both existing
   local API/web markers match it. Its artifact distinguishes matching markers from immutable build
   identity. Target mode always requires the exact 40-character lowercase Git commit.
2. Have an operator create a dedicated synthetic organization/workspace and 2–20 distinct paid,
   licensed users. Sign in through verified email and the separate PIN step. Each actor may keep
   their own organization-owned workspace; explicitly share every target board with each actor as
   an editor/facilitator. The driver validates each expected user, subscription-backed plan and
   current board edit capability. It never grants access or changes the selected workspace.
3. Prepare **team** canvases in one dedicated workspace. Every board title must start with
   `CANVAS TARGET REHEARSAL:`. Every nonempty object text and native-image alternative text must
   start with the same marker. The operator's dedicated-synthetic confirmation covers the actual
   image bytes too. Guided source references/workshops are excluded from this write driver.
4. On each board prepare one distinct, unlocked, ungrouped, parentless sticky/text object per
   actor, also marked, with at most 512 characters of original text. Arrange every target so its
   text is visible and unoccluded in every actor's initial 1440×1000 canvas viewport. The driver
   does not pan, reveal or resize objects to make a hidden target count as a painted observation.
   Other marked scene objects and genuinely scanned original images may remain on the board;
   those are not modified. The existing 500-object/2 MiB scene caps remain, with a small text-growth
   margin required before writing.
5. Prepare enough boards for the complete planned duration and leave at least five minutes of
   expiry headroom beyond it. Do not reuse boards near their lifetime receipt limit. No other
   writer, facilitator or cleanup operation should change these fixtures during the run. The
   driver detects unexpected sequence, object membership, geometry, text and version changes.
6. Coordinate an isolated execution window and collect target CPU, memory, disk, network,
   PostgreSQL, Valkey and storage/scanner observations separately. This driver does not start,
   stop, resize or inspect infrastructure and cannot infer target saturation from client memory.

## Private configuration

Store JSON outside the repository in a regular, non-symlink file at mode `0600`. Its size is limited
to 64 KiB. It contains cookie **environment-variable names only**, never cookie values, emails,
credentials or copied request headers. Replace the illustrative identifiers before execution:

```json
{
  "schemaVersion": 1,
  "mode": "local-rehearsal",
  "confirm": "dedicated-synthetic-only",
  "expectedBuildId": "0000000000000000000000000000000000000000",
  "apiOrigin": "http://127.0.0.1:4500",
  "webOrigin": "http://127.0.0.1:3500",
  "workspaceId": "00000000-0000-4000-8000-000000000001",
  "profile": "smoke",
  "durationSeconds": 30,
  "waveIntervalMs": 2000,
  "peerFanout": 1,
  "maxPeerObservations": 10000,
  "actors": [
    { "userId": "00000000-0000-4000-8000-000000000002", "cookieEnv": "CANVAS_TARGET_COOKIE_A" },
    { "userId": "00000000-0000-4000-8000-000000000003", "cookieEnv": "CANVAS_TARGET_COOKIE_B" }
  ],
  "boards": [
    {
      "boardId": "00000000-0000-4000-8000-000000000004",
      "targetObjectIds": [
        "00000000-0000-4000-8000-000000000005",
        "00000000-0000-4000-8000-000000000006"
      ]
    }
  ]
}
```

Use `mode: "target"` with credential-free HTTPS origins for a deployed target. Explicit local mode
accepts only `localhost`, `127.0.0.1` or `[::1]`; it is labelled incapable of staging acceptance.
Origins cannot contain paths, query strings or fragments. Unknown fields, raw cookies, duplicate
actors, duplicate cookie pairs and duplicate board/target IDs fail closed.

Inject each cookie pair privately under its configured environment name, for example through the
approved secret manager. Each value is exactly `cookie_name=opaque_value`, without attributes,
semicolon-separated cookies or copied headers. Values are used only for normal requests/browser
cookies and never appear in artifacts or console output. Use the real deployment cookie name.

```sh
# Cookie environment keys must already be injected privately; never put their values here.
CANVAS_TARGET_CONFIG=/private/exercise/canvas-target.json \
CANVAS_TARGET_OUTPUT=/private/exercise/canvas-target-result-unique.json \
pnpm exec tsx tests/load/canvas-target-capacity.mts
```

The output must not already exist. It is reserved exclusively at mode `0600` before any target
request, then the report is written through the same file descriptor. The driver prints a small numeric
and fixed-code completion summary, not the config/output path, origins, IDs or response bodies.
It produces no screenshots, traces or raw browser/network logs. Keep both config and artifacts
in the private exercise record. The report includes only a config checksum, build marker, actor/
board indices, numeric measurements, budget decisions and bounded fixed failure classifications.

## Pacing, budget and cleanup

- Smoke is exactly a requested 30-second observation window. Soak is 15–60 whole minutes. Each
  wave waits for acknowledgements and sampled peer observations before the next wave; explicit
  pacing is 2–60 seconds between starts. This is closed-loop work, not a fixed offered rate.
- Fan-out defaults to one different peer per actor and may explicitly include every other prepared
  actor (`peerFanout: actorCount - 1`). The artifact distinguishes sampled from all-to-all fan-out.
  Planned peer observations must fit `maxPeerObservations` (default 10,000; hard maximum 100,000),
  checked before requests. This budget counts write-to-peer measurements, not initial-render
  readiness checks. For 20 actors at 15-second pacing, a 60-minute all-to-all request plans 91,200
  peer observations; the operator must explicitly accept that budget. More fan-out adds measurement
  overhead and does not authorize a higher editor limit. The planned maximum number of
  waves is `ceil(duration / pacing)`. Slower waves can reduce actual completed waves; the artifact
  reports actual samples and duration. No extra writes are issued to catch up.
- Preflight reads **all** listed boards for **all** actors and rejects insufficient total capacity
  before any writes. Every receipt insertion path (scene command, facilitation and invitation)
  advances the board sequence through the existing commit path. Therefore current `canvasSeq`
  is used only as a conservative receipt upper bound, never as the exact receipt count.
- Assigned writes, one potential restore/fence per actor and 100 drift headroom must fit below 4,500,
  leaving at least 500 below the unchanged 5,000-receipt lifetime limit. Each wave re-reads current
  authority/sequence and budget. Exhausted assigned capacity rotates only to the next listed
  pre-provisioned board. No board, object or receipt cap is raised.
- Only text on this run's targets is mutated. Before restoration, browser contexts are closed and
  browser shutdown must be confirmed, preventing timed-out queued browser work from writing behind
  cleanup. Unconfirmed shutdown fails closed for operator reconciliation. Closing the browser does
  not cancel a command already running on the server. The driver therefore re-reads current
  authority, sequence, text and version, then requires an acknowledged versioned write of the
  original text. Even an unchanged first-wave target gets a same-text write that advances its
  version, fencing delayed commands that still expect the previous version. Success is reported
  as `restored` or `fenced-unchanged`; observing original text alone never proves cleanup.
  Only an exact own proposal or its immediately preceding acknowledged state (the original baseline
  for the first wave) is eligible. If the fence loses a definite 409 race, one fresh read must show
  the exact own proposal at its expected next version before one further fence is allowed. A
  rejected conflict creates no receipt, so at most one accepted cleanup write per target consumes
  the existing reserve. Budget, edit authority and deadline are rechecked before that write.
  Lost/malformed acknowledgements, timeouts, second conflicts, rate limits and authorization errors
  remain unresolved without another mutation. Third-party edits, including original text at an
  unfamiliar version, are never overwritten. Targets are never recreated and boards never deleted.
  Cleanup has a bounded one-minute attempt window; each request is independently bounded. A
  skipped/conflicting/denied or unacknowledged fence is a failed cleanup outcome requiring operator
  review.
- Stop the exercise on a real 429 or authorization/error response; do not raise budgets or retry
  around it. Retain the fixed status/code and reconcile synthetic fixtures through normal tools.
  Original text restoration itself consumes a receipt and does not rewind history or usage.

## Interpret measurements

HTTP acknowledgement is coordinator request-start through normal browser fetch, response and
receipt validation. Peer latency uses that **same request-start clock** through a different
actor's matching visible SVG text, hit test and two animation frames. It is an upper bound on a
paint opportunity including network/dispatch time, **not remote SQL COMMIT-to-peer timing or
physical displayed pixels**. Do not subtract acknowledgement from peer time.

The unchanged smoke gates are acknowledgement p95 ≤2,000 ms and peer p95 ≤3,000 ms. The report
separately compares peer p95 with the 500 ms roadmap target; passing a smoke gate cannot pass that
target or authorize a capacity increase. Sequential initial render and natural stream restarts
are observations, not newly invented release thresholds. A stream recovery observation requires a
renewed same-board stream request and a later matching visible scene/two-frame check. Navigation
aborts are counted too; short runs without a rotation leave recovery unmeasured. No forced
disconnect, guest-publication, physical touch, frame-rate or slow-consumer saturation proof is
claimed. A long soak remains a sampled text-collaboration workload, not saturation of every
comment/history/media feature. Optional all-to-all observations cover only the prepared actors and
their text targets, not every canvas role or workload.

Zero exit means this driver's declared correctness, cleanup and smoke gates passed. Nonzero
means a preflight, execution, cleanup, transport/application or numeric gate failed; retain the
artifact, including partial samples. External target/device acceptance remains pending until the
normal owner and independent reviewer accept its complete evidence set.

## Local functionality checkpoint

The [November 1 local rehearsal](../evidence/canvas-target-local-2026-11-01.json) passes twelve
commands across two actors on a separately prepared two-object synthetic board, verifies matching
local markers, and restores original text before its adapter deletes only that extra board.
This validates driver functionality; the adapter uses seeded fixture credentials and substituted
storage, and its `unversioned` marker is not immutable deployment provenance. It supplies no
current-cap, real-media, physical-device or staging acceptance.

The [November 2 cleanup-fence follow-up](../evidence/canvas-target-cleanup-fix-2026-11-02.json)
records the new driver separately from that historical run. A timed-out server command may
outlive browser shutdown; cleanup therefore needs an acknowledged versioned fence even when
its initial read shows the original text. Earlier read-only `unchanged` outcomes do not establish
that guarantee.
