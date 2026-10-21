# Single-VM staging readiness workflow

The API-triggered `Staging readiness` GitHub workflow separates three kinds of evidence. A GitHub-hosted
Ubuntu runner probes public TLS and HTTP-to-HTTPS redirects, dependency health, feature flags,
security headers, an upload/scan/private-download/delete media round trip, outbound SMTP delivery,
external trace/metric/request-log arrival, the exact deployment-receipt binding, and the effective
beta switches for one dedicated synthetic workspace. A self-hosted runner located near
the target VM runs fixed 50- and 250-client Round and Presentation profiles plus a bounded soak. A
separate GitHub-hosted job can rehearse signed Stripe webhook ordering. The jobs emit separate
redacted JSON artifacts; the public probe is not target-host capacity evidence, and the workflow
neither provisions a VM nor proves an actual provider-originated Stripe delivery.

The active staging target is one remote VM running `compose.single-vm.yaml` with
`compose.single-vm.observability.yaml`. Caddy, web, API/realtime, PostgreSQL, Valkey, MinIO,
ClamAV, OpenTelemetry Collector, Prometheus, and Alertmanager share that host. The profile has no
automatic failover, high availability, or SLA. A passing workflow does not remove the requirements
for encrypted off-host backups, a clean replacement-VM restore drill, host patching, monitoring,
strict SSH host-key verification, or public-production approval.

The workflow accepts only the `staging-readiness` `repository_dispatch` event. GitHub therefore
loads the workflow definition from the repository's default branch instead of letting a caller
select a branch containing different self-hosted-runner or environment steps. The first unprotected
job also requires the checked-out revision to be the current `main` tip and validates the complete
client payload before any protected or self-hosted job can run.

Open a [single-VM staging evidence record](../evidence/single-vm-staging.md) before provisioning so
the candidate identity, host baseline, independent reviewer, service checks, and redacted artifact
references are captured consistently. A completed workflow without an accepted record does not
close the staging gate.

## GitHub environment

Create a protected `single-vm-staging` environment with at least one required reviewer, enable
**prevent self-review**, and disable administrator bypass before dispatching either staging
workflow. Their unprotected preflight
reads the GitHub environment with an Actions-read token and fails on an absent environment, an
unprotected environment, or an API error; no signing, secret-consuming, or self-hosted job can run
after that failure. GitHub may still auto-create an empty environment when it parses a workflow
reference, so this guard prevents protected-job execution, not environment creation. Recheck the
environment protection in GitHub settings after any failed dispatch; an auto-created empty
environment is not a configured or accepted staging environment. The workflow derives
its API, web, and media targets from the validated `config/deploy/staging.json`; do not duplicate
those origins as environment variables. Configure these non-secret variables:

| Variable                                         | Example/purpose                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `OPENROUND_EXPECTED_BILLING`                     | `disabled` for the active staging profile                                                   |
| `OPENROUND_EXPECTED_COMMUNITY_MODE`              | Reviewed staging value                                                                      |
| `OPENROUND_EXPECTED_SIGNUPS`                     | Expected public signup switch                                                               |
| `OPENROUND_EXPECTED_SESSION_CREATION`            | `true` when running the game                                                                |
| `OPENROUND_EXPECTED_MEDIA_UPLOADS`               | Expected scanner-backed media switch                                                        |
| `OPENROUND_EXPECTED_UX_BETA`                     | Expected deployment-level UX beta switch                                                    |
| `OPENROUND_EXPECTED_RECOVERY_REHEARSAL`          | Expected Rehearsal kill switch                                                              |
| `OPENROUND_EXPECTED_PRACTICE_ASSIGNMENTS`        | Expected practice-assignment kill switch                                                    |
| `OPENROUND_EXPECTED_WORKSPACE_SHELL`             | Expected professional workspace shell switch                                                |
| `OPENROUND_EXPECTED_BUILDER_V2`                  | Expected interactive Round Builder v2 switch                                                |
| `OPENROUND_EXPECTED_PRESENTATIONS`               | Expected Presentation artifact switch                                                       |
| `OPENROUND_EXPECTED_PRESENTATION_REALTIME`       | Expected Presentation realtime workspace allowlist                                          |
| `OPENROUND_EXPECTED_GROUPS`                      | Expected facilitator Groups switch                                                          |
| `OPENROUND_EXPECTED_DISCOVER`                    | Expected approved-content Discover switch                                                   |
| `OPENROUND_EXPECTED_HOME_REGION`                 | Workspace home-region value approved for this staging target                                |
| `OPENROUND_LOAD_RUNNER_REGION`                   | Location of the VM and nearby isolated load generator                                       |
| `OPENROUND_TARGET_SATURATION_EVIDENCE_REFERENCE` | Stable private reference covering target CPU, memory, disk, network, PostgreSQL, and Valkey |
| `OPENROUND_TARGET_DURABLE_ARCHIVE_REFERENCE`     | Stable private archive reference for the complete evidence bundle                           |

Configure these encrypted environment secrets:

| Secret                               | Scope                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `OPENROUND_CREATOR_COOKIE`           | Dedicated synthetic owner with capacity for 250 participants and disposable media/invitations     |
| `OPENROUND_SMTP_PROBE_EMAIL`         | Dedicated non-member sink address monitored by the SMTP observer                                  |
| `OPENROUND_SMTP_OBSERVER_URL`        | Credential-free HTTPS receipt-adapter endpoint; never written to the artifact                     |
| `OPENROUND_SMTP_OBSERVER_TOKEN`      | Bearer credential for the SMTP adapter                                                            |
| `OPENROUND_TELEMETRY_OBSERVER_URL`   | Credential-free HTTPS adapter that queries the real trace, metric, and request-log backends       |
| `OPENROUND_TELEMETRY_OBSERVER_TOKEN` | Bearer credential for the telemetry adapter                                                       |
| `OPENROUND_DEPLOYMENT_RECEIPT_JSON`  | Exact successful deploy receipt for this candidate, including manifest and immutable image hashes |
| `OPENROUND_STRIPE_REHEARSAL_COOKIE`  | Separate synthetic creator used only for an approved billing rehearsal                            |
| `OPENROUND_STRIPE_WEBHOOK_SECRET`    | Test endpoint secret; only present for the optional replay                                        |

Store only the cookie name/value pair, not copied browser headers. Create accounts through the
normal email-verification and separate PIN sign-in path, never use a human or customer account, rotate/revoke sessions after an
exercise, and restrict environment access. Select only an approved synthetic workspace before
capturing `OPENROUND_CREATOR_COOKIE`. The public probe uses that cookie to assert the synthetic
workspace's effective workspace-shell, Builder, Presentations, Presentation realtime, Groups, Discover, and other
workspace-resolved switches; it never writes account or workspace IDs to artifacts. The load
workflow deletes disposable Round sessions and archives temporary Round and Presentation content;
finished Presentation sessions remain subject to the configured retention policy.

The two observer adapters are deliberately provider-neutral. The probe sends an authenticated
HTTPS `POST` and accepts only `202`/`404` while a lookup is pending or `200` with an exact
redaction-safe receipt. The SMTP request identifies the candidate plus the dedicated recipient,
fixed invitation subject, and send timestamp. Its receipt contains only `schemaVersion: 1`,
`kind: "smtp"`, `observed: true`, the exact `candidateBuildId`, an opaque `receiptId`, and normalized
UTC `observedAt`. Every request also has a random `probeId` and `probeSha256`, computed over the
lexicographically key-sorted canonical JSON of the request without `probeSha256`; the adapter must
return both exact values after evaluating that exact query. The telemetry request identifies one
synthetic `traceId`, its safe
`x-request-id`, the required HTTP metric name, and the earliest observation time. Its receipt uses
the same common fields plus `traceObserved: true`, `metricsObserved: true`, and
`logsObserved: true`. A mismatched probe ID or hash, extra response fields, stale or future
timestamps, a wrong build, redirects, non-HTTPS endpoints, embedded endpoint credentials, and
unconfirmed signals fail closed. Adapter
URLs, bearer tokens, the SMTP recipient, signed media URLs, and response bodies on failure are
never written to the uploaded artifact or probe log.

For the media deletion probe, a public `404` after DELETE proves that the asset and its deletion
tombstone are unavailable through the API. It does not prove immediate metadata erasure: the
server deliberately retains the internal tombstone beyond the upload-URL lifetime, repeats the
object sweep, and then purges it through retention. Temporary token-scoped finalization objects are
independently covered by the configured bucket lifecycle.

After every successful deployment, replace `OPENROUND_DEPLOYMENT_RECEIPT_JSON` with the exact
receipt written by the deployer; do not transcribe or reconstruct it. The remote probe validates
the receipt schema, candidate/operations commits, reviewed image repository, immutable image
digests, and redaction-safe configuration claims, then emits a SHA-256 of the exact supplied
receipt. It does not cryptographically authenticate where that JSON came from, so a syntactically
valid hand-written receipt cannot be distinguished automatically. Before acceptance, the operations
owner and independent reviewer must compare the emitted receipt SHA-256 with the deployer's
protected original, independently reconcile its manifest and runtime-input hashes with the signed
build artifact and reviewed runtime input, and retain those references in the staging evidence
manifest. The probe records `sourceAuthenticity: external-review-required` until that external
review is complete.

The checked-in staging deployment keeps billing disabled. Do not set the expected value to
`stripe` merely to make the optional replay run. Billing evidence requires a separately reviewed
test configuration, isolated synthetic workspace, and a real provider test-mode checkout; locally
signed payloads alone do not complete that gate.

## Hosted observability inputs

The ignored staging runtime file must keep `METRICS_ENABLED=true`, `TRACING_ENABLED=true`, and
`OPENROUND_LOG_SHIPPING_MODE=external-host-agent`, and must set
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` exactly to the private collector endpoint documented
in `.env.single-vm.example`. Select the real telemetry and incident providers before filling in:

- the credential-free HTTPS OTLP/HTTP base endpoint and its bearer token; and
- distinct reviewed HTTPS receivers for page, warning, and ticket alerts.

Do not reuse documentation domains, commit resolved provider URLs or tokens, or put a token in the
backend endpoint. Receiver URLs commonly contain secret query values; keep the runtime file at mode
`0600` and treat all three URLs as secrets. The collector and Alertmanager each use a separate
egress network for those destinations. Prometheus reaches the application and Alertmanager only
over internal Compose networks. Collector health, Prometheus, and Alertmanager publish host ports
on loopback only; use an approved SSH tunnel or a local operator session for diagnostics.

The overlay does not collect Docker or host logs and receives neither the Docker socket nor a broad
container-log mount. Install and manage a least-privilege host log agent separately, ship the
server's structured stdout logs to the reviewed backend, and verify that the backend can find the
probe's exact `x-request-id`. The deployment attestation and configuration receipt fail closed
unless external host-agent shipping is declared; the remote observer is the end-to-end proof that
the external prerequisite is actually working.

Deployment runs Compose with `--wait`, so the collector configuration validation, Prometheus
readiness, and Alertmanager readiness checks must pass. It also captures the exact running server's
redaction-safe configuration summary and rejects the candidate unless that summary reports
`metrics: protected`, `logs: external-host-agent`, and `tracing: otlp`. The deployment receipt
records that summary plus the SHA-256 of both the reviewed runtime input and exact build manifest;
it never records runtime secret values. These checks prove
the local configuration and running containers, not backend ingestion or human notification.
Before accepting staging, send a labeled test trace/metric and use the alert rehearsal runbook to
exercise each real route. Retain provider-side, responder, and build-linked references without
copying receiver URLs or tokens into the evidence record.

## Target-VM load runner

Register an ephemeral or tightly controlled GitHub Actions runner near the staging VM. Use Actions
Runner `2.327.1` or newer, keep automatic runner updates enabled, and satisfy any newer GitHub
registration minimum in force at exercise time. From the runner installation directory, capture
the output of `bin/Runner.Listener --version` in the private inventory and have the independent
reviewer confirm it meets the minimum. Only then give the runner the standard `self-hosted` label
and the custom `single-vm-staging` and `actions-runner-2-327-1-plus` labels. The last label is a
reviewed attestation, not runtime discovery; remove it whenever the runner is reinstalled or its
version can no longer be verified.

Restrict the runner to this repository, use an outbound-only network policy, keep its OS and Node
tooling patched, and destroy or reimage it after the exercise. The workflow deliberately leaves
latency and soak queued when no fully matching runner is online; do not relabel a distant or
unverified runner to make the job start. Node 24-based pinned actions fail on older runner binaries,
so a queued job is safer than collecting incomplete evidence on an unsupported runner.

Set `OPENROUND_LOAD_RUNNER_REGION` to the documented VM/load-generator location. The workflow stores
that value, the minimum runner version, the attestation label, all required labels, and non-secret
runner metadata in `load-runner-provenance.json`. This is a declared provenance record, not
independent proof of physical location or the installed binary version, so reconcile it against the
VM and runner inventory plus the captured version output. Do not run unrelated jobs during
measurement. Record provider, location, machine class, network path, runner version, resource
limits, and UTC availability window in the private exercise record.

## Before running

1. Provision the staging VM from the approved baseline, but do not treat checked-in files as proof
   that it exists. Patch the OS, restrict inbound traffic to the approved SSH and HTTPS paths,
   configure the non-root deployment user, and record its CPU, memory, disk, and provider details.
2. Obtain the SSH host key through an independently verified provisioning channel and commit the
   reviewed key to the staging known-hosts file. Deployment must use `StrictHostKeyChecking=yes`;
   never accept a key interactively or use trust-on-first-use.
3. Point the application and media DNS names at the VM. Confirm Caddy has issued valid public
   certificates for both names, HTTP redirects to HTTPS, and certificate-expiry monitoring has an
   owner. Run `node scripts/check-deployment-target.mjs staging` from a clean checkout. It must
   validate the non-placeholder public origins, VM address, and exact host/port key pin before a
   protected workflow can run. Both staging workflows repeat this check in their unprotected
   `main` preflight and fail before requesting environment approval when it does not pass.
4. Create and protect the `single-vm-staging` GitHub environment before invoking the
   default-branch-only `staging-images` repository dispatch documented in the
   [deployment runbook](deployment.md#build-product-images). Do not use a ref-selectable workflow
   dispatch. Download the signed manifest only after its unprotected `main` preflight and protected
   build both pass, and after the workflow builds, scans, signs, and verifies both application-image
   digests with the allowlisted GitHub Actions identity. A workstation build or signature is not
   promotable. Deploy with that manifest through the checked single-VM workflow. Its candidate
   configuration check must report protected metrics, external host-agent log shipping, and OTLP
   tracing. Keep owner-level migration credentials out of the long-lived server. Copy the exact
   resulting deployment receipt into the protected environment secret; never synthesize one. Keep
   the protected original available so the operations owner and independent reviewer can compare
   its exact SHA-256 with the remote-probe artifact and independently reconcile the manifest and
   runtime-input hashes before accepting the gate.
5. Confirm `docker compose ps`, the collector, Prometheus, and Alertmanager health checks, the
   server `/health/ready` dependency checks, the web build marker, the media quarantine/scan path,
   and external TLS probes all pass for the exact build ID.
6. Verify authenticated trace, metric, and request-log ingestion plus all three real alert routes,
   then configure every expected feature variable and observer secret above. Omitted expectations
   fail the workflow; they are never treated as “do not check.”
7. Configure encrypted database and object backups to storage outside the VM. Verify checksums and
   alerting, then complete the current [clean replacement-VM restore drill](backup-restore.md) before
   treating staging as disaster-recovery evidence.
8. Confirm the synthetic creator has room for temporary published content, has an entitlement and
   deployment ceiling of at least 250 participants, belongs to both required Presentation
   allowlists, and that `/v1/workspaces` reports the configured expected home region. Raising this
   synthetic ceiling does not change the public Free 20 or Pro 100 promises.

### Provision the synthetic capacity workspace

The hosted runtime must set `OPENROUND_DEPLOYMENT_ENVIRONMENT=staging`, keep
`COMMUNITY_MODE=false` and `BILLING_MODE=disabled`, and set `MAX_SESSION_PARTICIPANTS=250` before
the capacity exercise. For the first deployment, keep workspace-gated features disabled and their
allowlists empty so the synthetic creator can sign in without pretending an unknown workspace UUID
was pre-approved. After that creator has signed in, copy its exact workspace UUID from
`/v1/workspaces` and run this one-shot command from the active staging release:

```bash
export OPENROUND_CAPACITY_WORKSPACE_ID="the-reviewed-synthetic-workspace-uuid"
export OPENROUND_CAPACITY_REQUEST_ID="the-approved-change-or-exercise-reference"
COMPOSE_PROJECT_NAME=openround-staging docker compose \
  --env-file .env \
  -f compose.single-vm.yaml \
  run --rm --no-deps \
  -e OPENROUND_STAGING_CAPACITY_PROVISIONING=enabled \
  server node dist/staging-capacity-provision.js \
  --workspace-id "$OPENROUND_CAPACITY_WORKSPACE_ID" \
  --request-id "$OPENROUND_CAPACITY_REQUEST_ID" \
  --confirm "provision-staging-capacity:${OPENROUND_CAPACITY_WORKSPACE_ID}:team-250"
```

The command has no HTTP route and inspects PostgreSQL before mutation. It requires membership in
the restricted `openround_runtime` role and rejects database principals that are superusers, bypass
RLS, can create roles or databases, can replicate, entered through `SET ROLE`, inherit any role
other than `openround_runtime`, or own (or can assume the owner of) the database or public-schema
objects. It never receives the migration-owner credential. It also refuses non-staging, Community,
billing-enabled, non-durable, unversioned, below-250, missing, or provider-linked targets, and any
initial state other than untouched Free. The plan change commits in one transaction with its matching
`operations.staging_capacity.provision` audit event. A successful retry is a no-op only when that
durable audit marker already exists for the same workspace; an unrelated pre-existing Team
workspace is rejected. Retain the redacted JSON result and approved request reference with the
staging evidence record; do not retain the creator cookie there.

Then place only that reviewed UUID in the relevant workspace allowlists and activate the required
feature ceilings through a second reviewed, signed build/config deployment. The deployer treats a
release directory as immutable and rejects redeploying the currently active build ID, so do not
edit the remote `.env`, replace an active release in place, or bypass the signed-image workflow to
make this change. Record both build IDs and the approved configuration change in the staging
evidence record. Once the second build is active, create the environment-scoped synthetic cookie
and confirm the effective switches through `/v1/workspaces` before dispatching readiness.

Dispatch the first run with no soak:

```bash
gh api --method POST repos/riojung/pollingpops/dispatches --input - <<'JSON'
{
  "event_type": "staging-readiness",
  "client_payload": {
    "run_stripe_replay": false,
    "soak_minutes": "0"
  }
}
JSON
```

The payload may contain only `run_stripe_replay` (a JSON boolean) and `soak_minutes` (the string
`"0"`, `"15"`, or `"60"`). Omitting either field retains the safe defaults shown above. Unknown
keys, stringified booleans, numeric soak values, and unsupported durations fail the workflow before
protected jobs run. The caller needs repository Contents write access; environment reviewers still
approve jobs that consume `single-vm-staging` secrets.

Confirm the `single-vm-staging-remote-probe-*` artifact from the hosted runner and the
`target-region-evidence-bundle.json` manifest from the target-VM runner. The bundle hashes and
validates runner provenance, the soak summary, and exactly these four build- and region-matched
artifacts:

- `target-region-round-50.json`
- `target-region-presentation-50.json`
- `target-region-round-250.json`
- `target-region-presentation-250.json`

After the fixed matrix passes, dispatch the same event with `"soak_minutes": "15"` and inspect every per-game artifact.
Use the 60-minute option for a release candidate only after confirming VM resources, disk
headroom, backup timing, and synthetic-account isolation. The workflow asserts correctness,
latency, reconnect, client-receipt, zero-timeout, and report-reconciliation thresholds, cleans up
disposable content according to each harness's lifecycle, and writes a redacted soak summary. The
bundle step fails on a missing/extra matrix profile, changed source hash, build or region mismatch,
relaxed threshold, loss, duplicate, leakage, receipt timeout, or report mismatch. Complete the
[target-region evidence record](../evidence/target-region-load.md); one passing profile or a local
Compose run cannot substitute for the four-row target-region matrix.

A dispatch with `"soak_minutes": "0"` intentionally produces a bundle whose
`validation.soakValidated` and `validation.acceptanceComplete` fields are `false`. This is a useful
fixed-matrix artifact, but it is not acceptance evidence. A completed 15- or 60-minute soak can
make only `soakValidated` true. `externalEvidenceContentVerified` and `acceptanceComplete` remain
false until reviewers inspect the checksum-bound saturation/archive contents and record the normal
ledger acceptance; an HTTPS reference by itself never completes the gate.

The disposable local capacity workflow separately clears and restarts Valkey before the
250-participant Presentation process restart. Retain that coordination-loss artifact as a
correctness check; it does not substitute for any target-region latency row.

The local workflow enables `PRESENTATION_CONCURRENT_RESPONSE_WRITES` because its disposable stack
has no mixed-version window. On a target deployment, keep that switch off through the canary and
old-image overlap, then enable it only after every serving image reads the commit-visible aggregate
fence. Disable it before any prior-image rollback; follow the
[upgrade runbook](upgrade.md#presentation-concurrent-response-rollout).

Retain the workflow, VM inventory, runner inventory, and artifact URLs. The remote probe compares
both the API's `/health/live` marker and the web root's `X-OpenRound-Build-Id` header with the
candidate, and verifies the separate media origin over public TLS; the load probe independently
checks the API marker. Artifacts record the verified build ID, and `GITHUB_SHA` is not accepted as
unverified metadata. Retain the four load artifacts, runner provenance, soak summary, and VM
saturation evidence together in the referenced durable archive. The saturation reference must
cover CPU, memory, disk, network, PostgreSQL, and Valkey observations collected from the target VM
and target data services. Load-generator runner metrics are provenance/diagnostic data, never a
substitute for target saturation. Run sustained load against the actual VM size and networking
path: local desktop results and a GitHub-hosted public probe are not capacity evidence for this
target. GitHub retains the load and Stripe artifacts for 90 days; the external durable archive is
still required for the release evidence lifetime.

## Billing-mode rehearsal sequence

Keep billing disabled during capacity work. For the separate Stripe test-mode rehearsal, use this
reviewed and reversible sequence:

1. Approve a dedicated change record naming the synthetic free workspace, Stripe test account,
   endpoint/config checksum, owner, reviewer, enable window, and rollback owner.
2. Produce and deploy a reviewed signed staging build/config with `BILLING_MODE=stripe`, test-mode
   credentials only, and `OPENROUND_EXPECTED_BILLING=stripe`. Do not edit the active release or
   remote `.env` in place. Verify `/health/live` and the remote readiness artifact identify that
   exact immutable commit before continuing.
3. Rotate in the environment-scoped rehearsal cookie and webhook secret, then dispatch
   `staging-readiness` with `run_stripe_replay: true`. The replay checks `/health/live` before and
   after mutation and fails if either build differs from the dispatched `main` commit.
4. Manually perform the provider-originated test checkout, portal cancellation, delivery retry
   after a controlled transient failure, and reconciliation after an application restart. Record
   provider-side redacted references and the exact build. The locally signed replay cannot satisfy
   these provider-originated retry/restart criteria.
5. Reconcile the synthetic workspace to Free, revoke its sessions/secrets, and deploy a newly
   reviewed signed billing-disabled build/config with `OPENROUND_EXPECTED_BILLING=disabled`.
   Re-run readiness and verify no provider-linked entitlement remains.

If enablement, replay, or provider testing fails, stop provider activity and execute step 5
immediately. Preserve the failed exact-build evidence; never weaken signature/build checks, reuse a
partially mutated workspace without reconciliation, or leave the test endpoint enabled while
debugging.

Set `"run_stripe_replay": true` only during step 3 and while no provider test is manipulating the
rehearsal workspace. The replay proves signature, duplicate, stale-event, and
cancellation handling using locally signed payloads and is stored separately as
`single-vm-staging-stripe-replay-*`; complete a real Stripe test-mode checkout, portal, delivery
retry, and cancellation in the [live billing rehearsal record](../evidence/live-billing-rehearsal.md)
before marking the billing gate complete.

If a run fails, preserve workflow logs and partial artifacts, open an issue linked to the candidate
commit, and do not update `docs/release-readiness.json` to complete. Even after a passing staging
run, public production remains blocked until every legal, accessibility, independent security,
capacity, off-host restore, monitoring, and operations gate is evidenced.
