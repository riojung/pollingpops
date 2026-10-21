# Build, service, and deployment runbook

This runbook defines the supported operator interfaces for building Polling Pops and running every
environment on one Linux host. It does not claim that a staging or production host, domain, backup,
monitoring route, or provider account has been provisioned.

## Supported topology

The canonical repository and new checkout/deployment directory names use `pollingpops`.
Existing image/data namespaces and provisioned roots are not migrated automatically. Follow the
[repository rename guide](repository-rename.md) before operating an existing hosted environment.

| Environment   | Single-host implementation                                     | Image policy                                 |
| ------------- | -------------------------------------------------------------- | -------------------------------------------- |
| `development` | Local `compose.yaml` and optional overlays                     | Locally built images                         |
| `staging`     | Remote single-VM base + observability overlays over pinned SSH | Registry images selected by immutable digest |
| `production`  | Remote single-VM base + observability overlays after all gates | Signed digest-selected registry images       |

The hosted stack places Caddy, web, API/realtime, PostgreSQL, Valkey, MinIO, ClamAV, OpenTelemetry
Collector, Prometheus, and Alertmanager on one VM. Only TCP 80/443 and UDP 443 are public.
Observability health and administration ports bind to loopback; the database, cache, scanner,
MinIO administration, OTLP, and application metrics ports are not published. Caddy obtains TLS
certificates and routes the application origin to web/API services and the separate media origin
to MinIO.

This is an initial alpha/beta topology. A host, disk, kernel, Docker daemon, or availability-zone
failure can interrupt every service at once. It has no high-availability or SLA claim. Keep
encrypted database and media backups off the VM, rehearse restoration onto a clean replacement
host, and do not call the deployment production-ready until the release ledger is complete.

## Command summary

All wrappers accept the environment as their first positional argument. The explicit
`--environment development|staging|production` form is equivalent.

### Build product images

Build local development images:

```bash
./scripts/product-build.sh development
```

Hosted builds require a clean Git worktree, Buildx, a stable Cosign release from 3.0.6 up to but not
including 4.0.0, an HTTPS application origin matching the checked-in target config, a registry
prefix matching that config, and `--push`. The build and deployment wrappers reject an unsupported
or unparseable `cosign version` before signing or verifying because Cosign 2 cannot be relied on to
discover the Cosign 3 signature format, while Cosign 4 compatibility has not been qualified. This
preflight must pass before requesting access to the protected build environment:

```bash
node scripts/check-deployment-target.mjs staging
```

The check rejects reserved, example, placeholder, loopback, and unspecified target names. For a
single-VM target, it also requires the checked-in OpenSSH known-hosts file to contain a valid,
non-revoked key for the exact configured host and port. An OpenSSH hashed exact-host entry is
valid; wildcard host patterns and `@cert-authority` trust entries are not exact pins and are
rejected. The check is intentionally red while the checked-in `.example` targets or comment-only
key files remain. Both staging workflows run it in their unprotected `main` preflight.

After replacing and reviewing those target values, this is the underlying command used by the
protected staging-image workflow (set the URL to the exact `publicApiUrl` in the reviewed config):

```bash
export OPENROUND_STAGING_API_URL="https://staging.your-domain.tld"
./scripts/product-build.sh staging \
  --api-url "$OPENROUND_STAGING_API_URL" \
  --registry ghcr.io/riojung/openround/openround \
  --push
```

Active staging requires signatures from `.github/workflows/staging-images.yml` running on `main`;
an arbitrary workstation signature cannot satisfy its identity policy. Create and protect the
`single-vm-staging` GitHub environment before the first dispatch; allowing GitHub to create it from
a workflow job would leave the signing job without the required reviewer protection. After the
target config is reviewed, dispatch **Staging images** through the default-branch-only repository
event:

```bash
gh api --method POST repos/riojung/pollingpops/dispatches --input - <<'JSON'
{
  "event_type": "staging-images"
}
JSON
```

The event intentionally accepts no caller-selected ref or inputs. GitHub loads the workflow from
the default branch, and an unprotected preflight verifies that the checkout is the current
`origin/main` tip before the environment, package-write permission, or signing identity becomes
available. The protected job repeats that freshness check after reviewer approval and before
package login or OIDC signing, so an approval delayed past a new `main` commit fails closed. Do not
substitute `gh workflow run`, which uses the `workflow_dispatch` interface and can select another
ref. Download the signed manifest only after the protected job succeeds. Before a real deployment,
replace the `.example` domains and placeholder host names in
`config/deploy/staging.json` and `config/deploy/production.json`. The build writes digest-selected
references and the full Git commit to:

```text
artifacts/deploy/<environment>/build-manifest.json
```

Do not replace digest references with mutable tags or combine server and web images from different
manifests. Production images are built by the protected tag-triggered release workflow, scanned,
signed using its allowlisted OIDC identity, and verified before promotion. After those steps pass,
the workflow retains the manifest, SBOMs, provenance, SARIF scans, source archive, and checksums in
a draft GitHub Release. It never publishes the draft; independent evidence review and the final
readiness decision remain manual gates. Its unprotected
preflight runs `node scripts/check-deployment-target.mjs production`, so a release tag cannot
produce signed images while the production origin, VM target, or exact SSH key pin is still a
placeholder.

### Operate services

Local development supports fixed profiles:

```text
./scripts/service.sh development start|stop|restart|status|logs \
  [--profile core|media|observability] [--docker-context NAME] [--no-build] [--follow]
```

| Profile         | Services                                                                  |
| --------------- | ------------------------------------------------------------------------- |
| `core`          | PostgreSQL, Valkey, MinIO, Mailpit, server, web, and Caddy                |
| `media`         | Core plus ClamAV                                                          |
| `observability` | Media plus Prometheus and Grafana; this is the complete development stack |

Examples:

```bash
./scripts/service.sh development start --profile core
./scripts/service.sh development restart --profile media --no-build
./scripts/service.sh development status --profile observability
./scripts/service.sh development logs --profile core --follow
./scripts/service.sh development stop --profile core
```

#### Docker readiness and the Polling Pops rebrand

Development service commands check the Docker CLI, Compose v2 plugin, and daemon before changing
services. Development product builds make the same check before running the host build. Each
preflight subprocess has a ten-second timeout; dry runs need no running Docker daemon.

A missing `/var/run/docker.sock` is a runtime/context problem, not an image-name problem. Start
the runtime that owns the existing data, verify `docker info`, and then retry. On macOS use
`open -a Docker` for Docker Desktop, or `colima start --profile YOUR_EXISTING_PROFILE` for an
existing Docker-backed Colima profile. Do not delete or recreate the VM as a first troubleshooting
step. Inspect `docker context ls` and stale `DOCKER_HOST` / `DOCKER_CONTEXT` overrides.

To select an existing context for one service command without changing Docker's global selection:

```bash
pnpm service development restart --profile core --docker-context colima-YOUR_EXISTING_PROFILE
```

Use the exact name listed by `docker context ls`; the default Colima profile commonly uses
`colima`. For build commands, or an entire sequence of development commands, use the standard
Docker environment override:

```bash
DOCKER_CONTEXT=colima-YOUR_EXISTING_PROFILE pnpm product:build development
DOCKER_CONTEXT=colima-YOUR_EXISTING_PROFILE pnpm service development start --profile core --no-build
```

`--docker-context` is development-only. Hosted service control still uses the pinned SSH target
and current release in the checked-in configuration. Ordinary service/build commands do not
start runtimes, switch global contexts, delete VMs, or rename volumes. The dedicated local
startup helper below may start the explicitly selected existing Colima VM.

All local profiles now build `polling-pops-server:development` and
`polling-pops-web:development`; the multiwriter secondary uses the same server image. Rebuild
once after this update before using `--no-build`. Registry paths and immutable hosted image
references remain unchanged. The Compose project stays `openround`, preserving its existing
containers and PostgreSQL, Valkey, and MinIO volume namespace. The profile names `core`, `media`,
and `observability` describe service bundles and are intentionally unchanged. A Colima profile
is a separate VM/runtime choice, not the `--profile` service bundle.

#### Colima startup after a reboot

With Node.js 22+, pnpm, and repository dependencies installed, run:

```bash
pnpm local:start
pnpm local:start --dry-run
```

`scripts/ops/local-start.mjs` validates the saved profile and local context endpoint before
performing any runtime mutation. Defaults are the existing `default` VM, `colima` context, and
`core` service bundle. It starts stopped VMs with global context activation, saved-config writes,
and SSH-config writes disabled; it then waits for Docker and delegates to normal service control.
The readiness budget is 180 seconds, adjustable with `--wait-seconds` (1–900). A running but
unresponsive daemon is waited for, not implicitly stopped. Failures prevent product startup.

Use `--no-build` only for already-built, unchanged application images, `--restart` to recreate
product containers, and `--colima-profile NAME --docker-context NAME` for a different verified
existing profile. There is no automatic selection of another running VM or profile creation.
The `openround` Compose namespace and named data volumes remain unchanged.

For a stuck `Running` profile whose Docker daemon returns `EOF`, explicitly opt into recovery:

```bash
pnpm local:start --restart-runtime
```

This permits one stop/start of the same unhealthy VM, **interrupting every container in it**.
It never deletes profiles or volumes and does not restart an already healthy VM. Review other
workloads in that profile first. The helper clears Docker host/context, TLS, and API-version
environment overrides only in child processes, leaving the parent shell untouched. It does not
install a login agent or change saved Colima settings; run it manually after a reboot.
See the [quick start](../quick-start.md#one-command-startup-after-a-reboot-colima) for examples.

#### Reclaim local Docker disk space and rebuild

`pnpm service development restart --profile core` rebuilds and force-recreates only the core
profile. It does not start the optional media or observability services, remove old images, or
reclaim unrelated Docker storage. Inspect usage before cleanup:

```bash
docker system df
docker system df --verbose
```

To remove the complete local Polling Pops Compose project and every image referenced by its core,
media, and observability services while preserving named data volumes, run from the repository
root:

```bash
docker compose \
  --project-name openround \
  --file compose.yaml \
  --file compose.media.yaml \
  --file compose.observability.yaml \
  --profile observability \
  down --remove-orphans --rmi all
```

This targets the `openround` project's containers, networks, and service images. It deliberately
omits `--volumes`, so the PostgreSQL, MinIO, Valkey, ClamAV, and Prometheus named volumes remain.
Grafana's checked-in provisioned dashboards and data-source configuration are recreated on start,
but its runtime database, runtime-created dashboards, users, and settings are ephemeral because
`/var/lib/grafana` has no data volume. Mailpit messages are also ephemeral. Export any runtime state
that matters before teardown. Images shared with another project may need to be pulled again the
next time that project starts.

If host-wide cleanup is also required, review `docker system df --verbose` first, then run:

```bash
docker system prune --all --force
```

This second command is global: it removes stopped containers, unused networks, unused images, and
build cache from every Docker project on the host, not only Polling Pops. It does not remove volumes
without an explicit volume option.

**Data-preservation boundary:** do not add `--volumes`, and do not run `docker volume prune` or
`docker volume prune --all`, unless an intentional data reset has been approved and PostgreSQL and
MinIO backups have been created and verified. Those operations can permanently remove databases,
uploaded media, queued state, malware signatures, and monitoring history.

Rebuild the Polling Pops application images once, start the complete stack without rebuilding them a
second time, and verify application and observability health:

```bash
pnpm product:build development
pnpm service development start --profile observability --no-build
pnpm service development status --profile observability
pnpm smoke:compose
pnpm smoke:observability
docker system df
```

Replace `observability` with `media` or `core` only when the corresponding smaller profile is the
intended target. For a routine rebuild and restart that does not need disk cleanup, use
`pnpm service development restart --profile observability`.

For staging and production the same interface operates the already-deployed remote release through
strict host-key-checked SSH:

```text
./scripts/service.sh staging|production start|stop|restart|status|logs \
  --config config/deploy/<environment>.json \
  [--ssh-identity /path/to/private-key] [--follow]
```

The identity option is optional when a suitable key is already loaded in `ssh-agent`. A supplied
identity must be a regular, non-symlink file with mode `0600`. Hosted lifecycle actions use the
Compose project and current-release path from the checked-in configuration; they do not accept an
arbitrary host or remote command.

### Deploy an environment

Development deployment starts the local Compose stack:

```bash
./scripts/deploy.sh development
```

The hosted deployment contract is:

```text
./scripts/deploy.sh staging|production \
  --config config/deploy/<environment>.json \
  [--manifest artifacts/deploy/<environment>/build-manifest.json] \
  --runtime-env artifacts/deploy/<environment>/runtime.env \
  --migration-env artifacts/deploy/<environment>/migration.env \
  --confirm <environment>:<full-build-id> \
  [--ssh-identity /path/to/private-key] \
  [--backup-reference <reference>] [--recover-lock] [--dry-run] \
  [--published-release-redeploy \
   --prior-deployment-receipt artifacts/deploy/production/receipts/<receipt>.json \
   --prior-deployment-receipt-sha256 sha256:<reviewed-receipt-digest>]
```

Production requires `--backup-reference`. The value identifies an operator-verified off-host
backup or recovery anchor; passing a string neither creates a backup nor proves restoration.
The three published-release options are valid only together for a forward production redeploy.
They are not needed—and are rejected—while the accepted GitHub release is still a draft.

Code-only rollback selects a previously approved, schema-compatible manifest:

```text
./scripts/deploy.sh staging|production \
  --rollback \
  --rollback-from <current-full-build-id> \
  --manifest <target-build-manifest.json> \
  --runtime-env artifacts/deploy/<environment>/runtime.env \
  --confirm rollback:<environment>:<target-build-id>:from:<current-build-id> \
  [--ssh-identity /path/to/private-key] [--backup-reference <reference>]
```

Rollback omits the migration file and never reverses a database migration.

## Provision each hosted VM

Provision staging and production independently. At minimum:

1. Select a supported Linux VM whose architecture matches `imagePlatform` (`linux/amd64` or
   `linux/arm64`). Start with measured resources; the example resource limits assume roughly four
   vCPUs and 8 GB of memory.
2. Install current Docker Engine and the Compose v2 plugin. Configure Docker to start at boot and
   authenticate the deployment user to the image registry without putting a token in this repo.
3. Create a dedicated non-root `openround` deployment user, its SSH key, and the configured deploy
   root (for example `/opt/pollingpops/staging`) owned only by that user. Docker control is effectively
   host-administrator access even without `sudo`; restrict this account and key to the dedicated VM,
   prohibit unrelated workloads, and do not grant additional passwordless administration.
4. Permit inbound HTTP/HTTPS only (TCP 80/443 and optionally UDP 443) plus SSH from the approved
   operator or CI network. Do not expose PostgreSQL, Valkey, MinIO administration, ClamAV, or the
   Docker socket.
5. Point the application and media DNS names at the VM. Caddy can obtain certificates only after
   public DNS and the firewall are correct.
6. Obtain the VM's SSH host key through an independently verified channel and place the exact entry
   in `config/deploy/ssh/<environment>_known_hosts`. The checked-in comment is deliberately not a
   usable key. Never populate it from an unverified connection or disable strict checking.
7. Configure an external SMTP service. Configure an external telemetry/paging destination before
   a customer beta. Schedule encrypted PostgreSQL and MinIO backups to storage that does not share
   the VM's credentials or failure domain.

The active non-secret target files are:

```text
config/deploy/dev.json
config/deploy/staging.json
config/deploy/production.json
compose.single-vm.yaml
compose.single-vm.observability.yaml
infra/single-vm/Caddyfile
infra/single-vm/postgres-init.sh
infra/observability/alerts.yml
infra/observability/alertmanager.single-vm.yml
infra/observability/otel-collector.single-vm.yml
infra/observability/prometheus.single-vm.yml
```

The historical `infra/fly/` profiles remain reference material and are not the active target.

## Runtime and migration environment files

Start from the checked-in templates, then restrict the copies:

```bash
mkdir -p artifacts/deploy/staging
chmod 700 artifacts/deploy/staging
cp .env.single-vm.example artifacts/deploy/staging/runtime.env
cp .env.single-vm.migration.example artifacts/deploy/staging/migration.env
chmod 600 artifacts/deploy/staging/runtime.env artifacts/deploy/staging/migration.env
git check-ignore artifacts/deploy/staging/runtime.env artifacts/deploy/staging/migration.env
```

Replace every placeholder and make domain, billing, community-mode, regional, feature-flag, and
observability values agree with the reviewed target. Hosted single-VM validation requires protected
metrics, tracing to the private collector endpoint, an explicit external-host-agent log-shipping
attestation, an explicitly selected HTTPS OTLP/HTTP backend with its bearer token, and reviewed
HTTPS page, warning, and ticket receivers. The host log agent is installed and credentialed outside
the Compose stack; the overlay receives neither the Docker socket nor host log mounts. The
repository does not supply provider URLs. Use URL-encoded passwords inside connection URLs. For the professional
alpha, enable workspace features deliberately and prefer a workspace allowlist before broad
enablement. Do not copy staging secrets into production.

The runtime file is the complete reviewed Compose input for long-lived services. It includes the
restricted application database URL and infrastructure credentials required by their respective
containers, but must not contain `DATABASE_MIGRATION_URL`. The migration file contains only the
owner-level `DATABASE_MIGRATION_URL` (and optional migrations directory) and is transferred only for
the one-shot migration. Automation deletes the remote migration file after use. The server and web
containers never receive that owner URL.

Both files must be regular non-symlink files, ignored by Git, mode `0600`, and located under the
literal non-symlinked `artifacts/deploy/<environment>/` directory. Do not put secrets in target
JSON, manifests, command arguments, logs, receipts, or release artifacts.

### Core-parity audience canary

The Round client protocol canary is independent of audience activation. Set
`FEATURE_ROUND_CLIENT_PROTOCOL=true` and include the intended workspace UUID in
`CORE_PARITY_WORKSPACE_ALLOWLIST` to create new schema-7 Rounds. Both Compose deployment profiles
forward this flag; it defaults to false. It does not enable any new poll response format or alter
existing sessions. The redacted config-check summary exposes the `roundClientProtocol` boolean;
deployment receipts accept it without changing older receipt hashes. Deploy compatible readers
before enabling this writer, then verify host and presenter views, participant join/refresh,
exact answer retry, and process restoration in staging.

To pause new schema-7 creation, disable the flag. Existing schema-7 sessions must remain readable
and writable by compatible clients. Do not roll back to older binaries that reject schema 7;
retain a compatible release or forward-repair it. No migration or data deletion is required for
this canary. Local verification can opt in with `BETA_E2E_ROUND_PROTOCOL=true` when running the
beta Playwright Round protocol tests. Target-region load and physical-device checks remain launch
gates; local automated tests are not substitutes.

Apply ordered migration 059 before deploying the audience-scope API and outbox relay. Do not alter
older applied migrations or add another join-code directory. New activation defaults off; a local
or reviewed canary may set `FEATURE_AUDIENCE_SCOPES=true` and explicitly include its workspace in
`CORE_PARITY_WORKSPACE_ALLOWLIST`. Compose forwards these settings and config-check exposes only
the allowlist size, never its IDs. Activation is host-pass-only and metadata-only: it does not enable
Presentation Q&A/chat/Pulse. `FEATURE_FEEDBACK_ROOMS`, `FEATURE_SURVEYS`, and
`FEATURE_FEEDBACK_EXPORTS` reserve later writers and should remain false.

For a feature rollback, disable new activation and preserve the compatible API/worker readers,
existing scope rows, receipts, and migrations. Native credential expiry/revocation remains enforced
on reads, sync, and event delivery. Scope/outbox rows follow the source Presentation's frozen
retention and cascade on source/workspace deletion. Inspect relay retry errors without recording
event payloads or socket credentials. The exact-image Fly reference checks prohibit new flags
being enabled; public promotion still requires all existing independent release gates.

## Promotion sequence

For staging:

1. Review and update `config/deploy/staging.json`, DNS, host-key pin, runtime values, and VM sizing.
   Run `node scripts/check-deployment-target.mjs staging`; do not proceed until it validates the
   exact target and SSH key pin.
2. Invoke the `staging-images` repository dispatch shown above. Its default-branch preflight must
   pass before the protected job builds, scans, signs, and verifies both image digests. Download and
   review its complete manifest.
3. Run the deploy command first with `--dry-run`, then without it using the exact confirmation value.
4. The deployer verifies inputs and gates, uploads a private incoming release, validates Compose,
   pulls exact images, runs the candidate configuration check, verifies the embedded web build ID,
   starts data dependencies, runs the one-shot migration, and activates the full stack—including
   collector, Prometheus, and Alertmanager health checks—under a remote deployment lock.
5. The deployer verifies public API readiness and web/server build markers, then reads the exact
   active release's configuration summary. It rejects summaries with extra fields or without
   protected metrics, external host-agent log shipping, and OTLP tracing. The observability overlay
   never mounts the Docker socket or host logs; configure that least-privilege agent separately.
   If post-activation verification fails, it attempts to
   restore the previously active release. Retain the non-secret deployment receipt, whose
   `configuration` object contains that redaction-safe summary and the SHA-256 of the reviewed
   runtime input, while `manifestSha256` binds the exact build manifest and its immutable images,
   plus any failure evidence. The digests prove input identity; they are not copies of the inputs
   and cannot prove external telemetry or log delivery.
6. Run the [staging readiness workflow](staging-readiness.md), physical-device tests, restore drill,
   and target-region load/soak checks. A public health response is not capacity evidence.

Production repeats the process with an independently reviewed signed release manifest, all
[production readiness](production-readiness.md) gates complete, a verified off-host backup
reference, a rehearsed replacement-host restore, named responders, and a rollback decision owner.
Run it from the reviewed evidence-acceptance commit described in the
[repository governance runbook](repository-governance.md#release-controls). The normal source rule
still requires operations `HEAD` to equal the manifest build ID. The sole exception is this
production acceptance commit: the tagged build must be its ancestor; the full tree delta may
contain only `docs/release-readiness.json`; only the `signed-release` acceptance may change inside
that ledger; and its owner/independent-reviewer acceptance, tag object, tagged commit,
downloaded-manifest SHA-256, both image digests, acceptance-time GitHub draft release ID, and exact
release asset inventory must match. The deployer fetches `origin/main` and the exact release tag from the trusted
Polling Pops GitHub remote, requires `HEAD` to equal the fetched main tip, and verifies the exact
annotated tag object's valid signature and target through the GitHub API. It also requires the bound
release to remain the exact accepted release and downloads its `SHA256SUMS` and preflight assets to
verify the accepted bytes, complete checksum inventory, exercised candidate, and successful
main-push CI, Security, and Production-path smoke provenance. The first deployment occurs while the
release is a draft. A published release can never serve as the first production deployment. Later
normal or replacement-host deployments may use that unchanged published release only with
`--published-release-redeploy` and a reviewed, SHA-256-pinned receipt from its successful draft
deployment. The receipt must be a bounded regular file under
`artifacts/deploy/production/receipts/`; it must start after signed-release acceptance and complete
before publication, and it must bind the exact release ID/tag/tag object, manifest and images,
production host/project, redaction-safe configuration summary, verification results, operations
revision, and reviewed deployment-input hashes. Preserve that receipt and its independently
recorded digest outside the replacement host's failure domain. Run initial deployment with network
access and a `GITHUB_TOKEN` with read access to draft releases and release assets. A local-only,
unsigned, recreated, mutated, or substituted
commit, tag, release, or asset—or any documentation, code, configuration, or unrelated gate
change—requires a new reviewed release build and tag.

## Failure and rollback policy

- Stop on signature, configuration, migration, pull, Compose readiness, public health, build-marker,
  backup, or release-gate failure. Do not weaken a check to make a deployment pass.
- Remote deploy and lifecycle actions share a lock. `--recover-lock` is only for a verified dead
  owner after the minimum stale interval; it is not a concurrency override.
- Database migrations are forward-only. Repair schema/data with a reviewed forward migration.
- A code rollback is safe only when the older images tolerate the current schema. Preserve
  expand/contract compatibility during every rollout window.
- Apply the complete ordered migrations through `075_verified_email_pin_auth.sql` before the
  current server. Rollback must preserve verified-email/PIN authentication and verification-only
  legacy callbacks; a pre-PIN image can restore unsafe session-issuing behavior. Follow the
  [authentication rollout and rollback checklist](upgrade.md#verified-email-and-sign-in-pin-compatibility).
- Presentation v2/custom geometry and capture-enabled Round sessions/Report V4 also constrain the
  rollback target. Follow the
  [content, report, and deletion upgrade checklist](upgrade.md#recent-content-report-and-deletion-upgrades).
  An older image cannot undo a completed deletion or safely reconstruct missing decision events.
- Keep `FEATURE_RECOVERY_PACK_LIVE_CARDS=false` throughout a mixed-version canary. Authoring-only
  and ordinary rooms stay v5-readable; enabling live cards requires draining all v5 servers and
  workers first. After enabled rooms or reference-bearing decision evidence exist, retain a
  v6-capable, live-card-aware rollback target. Disabling the switch does not downgrade existing
  rooms. Follow the [live-card compatibility checklist](upgrade.md#live-recovery-pack-card-compatibility).
- Deploy a flex-capable image with `FEATURE_LIVE_FLEX_MODE=false` first, and retain that image as
  the approved rollback target before enabling flex creation. Do not roll back to a pre-flex image
  after flex creation is enabled: older code cannot accept untimed responses, reads null Round
  deadlines as invalid numbers, and may overwrite them with synthetic deadlines on a later save.
  If the flex-capable image is defective, disable new flex creation and use a reviewed forward fix
  or another flex-capable image; draining rooms alone does not make a pre-flex rollback safe.
- Keep at least the current and previous approved release available on the VM, but treat the
  off-host database/media backup as the disaster-recovery source when the host is lost.
- After rollback or recovery, verify readiness, build markers, live-session behavior, reports,
  background work, email, media, and telemetry before closing the incident.

See the [upgrade runbook](upgrade.md), [backup and restore runbook](backup-restore.md), and
[incident-response runbook](incident-response.md) for the corresponding evidence and ownership.
