# Single-VM hosted profile

This profile runs one Polling Pops environment on one Linux VM with Docker Compose. The web app,
API/realtime service, PostgreSQL, Valkey, MinIO, ClamAV, Caddy, OpenTelemetry Collector,
Prometheus, and Alertmanager remain separate containers, but share one host. Only Caddy publishes
public host ports (`80/tcp`, `443/tcp`, and `443/udp`). Observability administration and health
ports bind to host loopback; database, coordination, storage-console, scanning, application, OTLP,
and metrics ports remain private.

Use one VM and one Compose project per environment. Do not place development, staging, and
production data on the same host. The repository's normal `compose.yaml` remains the local
development profile; hosted environments use `compose.single-vm.yaml` together with
`compose.single-vm.observability.yaml`.

## Availability boundary

This is a cost-conscious alpha and small-beta topology, not a high-availability topology. A host,
disk, Docker daemon, network, or operating-system failure stops the entire product and may
interrupt live sessions. Container restart policies do not provide failover. Before committing to
an availability SLA, move PostgreSQL and media off-host, run redundant application instances, and
introduce provider-level health routing.

Start with at least 4 vCPUs, 8 GB RAM, and 100 GB of SSD storage. Keep 25% of the disk free and
validate the supported participant load on the actual VM. ClamAV signature updates and scans,
PostgreSQL checkpoints, media writes, and backups all compete for the same CPU, memory, and disk.
The checked-in resource limits are starting values for this host size, not capacity guarantees.

## Host and network prerequisites

Install a currently supported Docker Engine and Compose plugin. Configure the host before launch:

- Set `vm.overcommit_memory=1` persistently for Valkey background persistence.
- Allow inbound `80/tcp`, `443/tcp`, and `443/udp` from the internet.
- Restrict SSH to operator VPN or allowlisted addresses. Use keys only and disable password login
  and direct root login. The deployment user requires Docker control, which is effectively
  host-administrator access; dedicate its account and key to this VM and do not run unrelated
  workloads under it.
- Enable security updates, host time synchronization, disk monitoring, and an external uptime
  check.
- Install a separately managed, least-privilege host log agent that forwards the server's
  structured stdout to the reviewed backend. The Compose observability overlay intentionally has
  no Docker socket or broad host/container-log mount.
- Do not publish Docker daemon, PostgreSQL, Valkey, MinIO, ClamAV, application, OTLP, metrics, or
  observability administration ports to a non-loopback interface.

Create DNS `A`/`AAAA` records for both `OPENROUND_APP_DOMAIN` and `OPENROUND_MEDIA_DOMAIN` before
starting Caddy. Both records must resolve to the VM. Caddy obtains and renews certificates
automatically; `caddy-data` and `caddy-config` are persistent volumes so certificate state survives
container replacement. The MinIO administration console is disabled and is never routed publicly.

## Runtime configuration

Copy `.env.single-vm.example` to the ignored deployment-artifact directory, replace every
placeholder, and restrict it to the local deployment user. For example, for staging:

```sh
install -m 600 .env.single-vm.example artifacts/deploy/staging/runtime.env
```

Use URL-safe randomly generated PostgreSQL and Valkey passwords, or URL-encode them separately in
`DATABASE_URL` and `REDIS_URL`. The application database URL must use `POSTGRES_APP_USER` (the
default is `openround_app`); the long-running server intentionally receives no owner or migration
credential. MinIO uses a separate root identity for initialization and a bucket-scoped identity for
application traffic.

Caddy reaches the API over a dedicated internal network and has the fixed address configured by
`OPENROUND_CADDY_PROXY_IP`. The API trusts forwarded client addresses only from that exact IP so
per-client rate limits remain distinct without accepting spoofed forwarding headers. If
`OPENROUND_SERVER_INGRESS_SUBNET` conflicts with a host route, change the subnet and proxy IP
together, keeping the proxy IP inside the replacement subnet.

`OPENROUND_SERVER_IMAGE`, `OPENROUND_WEB_IMAGE`, and `OPENROUND_BUILD_ID` are reserved release
values. The deployment automation injects them from the verified build manifest; do not put them
in the operator runtime file. The image references must identify the same tested release by digest,
and the web release must be built with the reviewed API URL equal to the public web origin. The
infrastructure images are also digest-pinned in `compose.single-vm.yaml` and
`compose.single-vm.observability.yaml`; upgrade them through a reviewed source change and record
them in the release software bill of materials.

The example defaults to a non-billing Community deployment with Home, Library, Sessions, and
Results available on every plan. Core workspace navigation does not require UX beta flags or
pilot allowlists; explicit Admin availability and plan assignments remain authoritative.
`FEATURE_WORKSPACE_SHELL` is retained only for configuration compatibility. Other professional
capabilities remain off by default. An approved alpha or beta can enable
Builder, Presentations, Groups, and Discover without changing Compose by
setting their `FEATURE_*` values to `true`, enabling `FEATURE_UX_BETA`, and adding the pilot
workspace UUID to `UX_BETA_WORKSPACE_ALLOWLIST`. Commercial production can set
`COMMUNITY_MODE=false`, `BILLING_MODE=stripe`, and the required Stripe secrets after the billing
runbook is approved.

Production sign-in requires a real SMTP provider. Mailpit and debug magic links are not part of
this profile. Public media uploads always pass through the included ClamAV service.

Hosted deployment requires protected metrics, tracing, and
`OPENROUND_LOG_SHIPPING_MODE=external-host-agent`. The server sends traces only to
`http://otel-collector:4318/v1/traces` on the private telemetry network. The collector scrapes
`http://server:4000/metrics` with `METRICS_TOKEN` and exports both signals to the explicitly
configured HTTPS OTLP/HTTP backend using `OPENROUND_OTLP_BACKEND_TOKEN`. Set
`OPENROUND_OTLP_BACKEND_ENDPOINT` to the reviewed OTLP/HTTP base endpoint, without a signal suffix,
query, fragment, or embedded credential. Select and review the backend's retention, residency,
ownership, and outage behavior before deploying; the checked-in template intentionally does not
invent a provider URL. Alertmanager similarly requires reviewed HTTPS page, warning, and ticket
receiver URLs. Polling Pops stamps spans with the deployment environment and immutable build ID.
The deployment receipt records the log-shipping mode, but only an end-to-end lookup of the
readiness probe's exact `x-request-id` proves the external agent and log backend path.

The `telemetry` and `monitoring` networks are internal. The collector and Alertmanager each join a
separate egress network to reach, respectively, the authenticated telemetry backend and the three
receiver URLs. Prometheus evaluates the checked-in alert rules locally and forwards them to
Alertmanager over the internal monitoring network. Loopback defaults are collector health on
`13133`, Prometheus on `9090`, and Alertmanager on `9093`; access them only through an approved SSH
tunnel or local operator session. Collector health probes the live endpoint using a static helper
installed by a digest-pinned, networkless init container. Prometheus renders its deployment label
from the exact reviewed `OPENROUND_DEPLOYMENT_ENVIRONMENT` value.

Optional feature allowlists need the real UUID created by the first hosted sign-in. Bootstrap a new
target with optional workspace-gated features disabled and empty allowlists, capture and review the
synthetic workspace UUID, run the staging-capacity provisioner when required, and activate that
UUID through a second signed build/config deployment. Do not edit the active release `.env` or
replace its immutable directory in place; the deployment command rejects the currently active
build ID.

## Validate, migrate, and start

The paths below use the new-install `/opt/pollingpops` defaults. Existing hosts must retain their
actual reviewed deployment root, SSH account, and Compose project name; see the
[repository rename guide](../../docs/runbooks/repository-rename.md) before changing them.

The deployment command combines the reviewed operator runtime with the reserved image and build
values, uploads a generated release `.env`, then performs Compose interpolation validation, image
pull, application configuration validation, build-ID validation, one-shot migration, startup, and
health checks. A raw copy of `.env.single-vm.example` cannot drive Compose by itself because it
intentionally does not contain the release-owned image variables.

For diagnostics after deployment, run validation from the active release with the environment's
reviewed Compose project name. For example:

```sh
cd /opt/pollingpops/staging/current
COMPOSE_PROJECT_NAME=openround-staging docker compose \
  --env-file .env \
  -f compose.single-vm.yaml \
  -f compose.single-vm.observability.yaml \
  config --quiet
```

The same generated release file can run the server's production configuration check without
starting dependencies:

```sh
COMPOSE_PROJECT_NAME=openround-staging docker compose \
  --env-file .env \
  -f compose.single-vm.yaml \
  -f compose.single-vm.observability.yaml \
  run --rm --no-deps server node dist/config-check.js
```

Put `DATABASE_MIGRATION_URL` in a separate ignored mode-`600` input file based on
`.env.single-vm.migration.example`. The deployment automation supplies it only to the one-shot
migration container and deletes its remote copy immediately after the attempt. Never add it to the
runtime input or server service:

```sh
install -m 600 .env.single-vm.migration.example artifacts/deploy/staging/migration.env
```

After deployment, inspect container health without recreating services:

```sh
COMPOSE_PROJECT_NAME=openround-staging docker compose \
  --env-file .env \
  -f compose.single-vm.yaml \
  -f compose.single-vm.observability.yaml \
  ps
```

`minio-init` is repeatable and reconciles the private media bucket, bucket-scoped policy, and
application storage identity on every run. PostgreSQL creates the restricted runtime role only when initializing
a new data volume. Credential rotation therefore requires a reviewed database-role rotation step;
changing only the env file does not update an existing PostgreSQL volume.

## Backups and recovery

The named volumes make container replacement durable, but they are not backups. A lost VM or disk
loses every local volume at once. At minimum:

- create an encrypted PostgreSQL dump every night and transfer it to a different provider account
  or failure domain;
- copy MinIO objects off-host with versioning and retention enabled at the destination;
- retain several generations and alert when the newest successful copy exceeds the recovery-point
  objective;
- keep runtime configuration, encryption keys, and recovery credentials outside the VM; and
- perform scheduled restore rehearsals onto a clean host.

Provider VM snapshots are useful for rapid recovery but do not replace logical PostgreSQL and
object backups. Before each deployment, record the current image digests. Rollback means restoring
compatible data when required, then restarting the previously tested image pair; never assume an
application rollback can reverse a database migration.
