# Observability and operational controls

## Access and correlation

`METRICS_ENABLED=true` serves Prometheus text on the server's `/metrics` route. The included Caddy
configuration deliberately does not publish that route. Keep it on a private monitoring network;
if another proxy exposes it, set a random `METRICS_TOKEN` of at least 24 characters and configure
the scraper to send it as a bearer token.

Every HTTP response carries `x-request-id`. When tracing is active it also carries `x-trace-id`,
and browser CORS exposes both. Support may ask for these identifiers, but must not ask for creator,
host, or participant credentials.

Set `TRACING_ENABLED=true` and an explicit, credential-free HTTP(S)
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`—normally ending in `/v1/traces`—to export HTTP, Fastify,
session join, answer, and host-command spans. For the supported single-VM target this value must be
`http://otel-collector:4318/v1/traces`; it is private Compose traffic, not the provider endpoint.
Other hosted targets reject reserved, placeholder, loopback, and unspecified destinations.
Configure authentication at a private collector or proxy boundary rather than embedding
credentials, query parameters, or fragments in the application URL. Health and metrics scrapes
are omitted from traces. Hosted spans identify the reviewed deployment environment and use the
immutable Polling Pops build ID as their service version, regardless of an operator-supplied generic
OTel service-version value.
Validate export during deployment; `pnpm smoke:tracing` verifies the application path against a
local temporary collector but does not test a production backend.

The hosted single-VM profile ships `compose.single-vm.observability.yaml`. It starts digest-pinned
OpenTelemetry Collector, Prometheus, and Alertmanager containers. The collector receives
application traces, scrapes `http://server:4000/metrics` with the bearer token, and exports both
signals to the explicitly configured HTTPS OTLP/HTTP backend with
`OPENROUND_OTLP_BACKEND_TOKEN`. Prometheus independently scrapes the same protected private route
to evaluate `infra/observability/alerts.yml`, then sends alerts to Alertmanager over an internal
network. Alertmanager reads page, warning, and ticket receiver URLs from files in a mode-`0700`
tmpfs directory; the resolved URLs are neither checked in nor placed in its configuration file.

The `telemetry` and `monitoring` networks are internal. The collector and Alertmanager each join a
separate egress network for the reviewed backend or receivers. OTLP receivers are not published.
Collector health (`13133`), Prometheus (`9090`), and Alertmanager (`9093`) bind to host loopback
only. A digest-pinned, networkless BusyBox init container installs the static `wget` used by the
distroless collector's health check; the check probes the live `13133` endpoint rather than merely
re-validating configuration. Prometheus renders the deployment label from the reviewed
`OPENROUND_DEPLOYMENT_ENVIRONMENT`, so staging and production signals cannot share a hard-coded
label. Do not expose those ports directly. Hosted validation requires
`METRICS_ENABLED=true`, `TRACING_ENABLED=true`, the exact private application trace endpoint, a
non-placeholder HTTPS backend base endpoint, its token, and three non-placeholder HTTPS receiver
URLs. The deployment waits for the three containers' health checks and rejects a server
configuration summary that does not report protected metrics, external host-agent log shipping,
and OTLP tracing.

The bundled overlay intentionally does not collect container logs. It has no Docker socket and no
host/container-log mount. Hosted single-VM deployment therefore requires
`OPENROUND_LOG_SHIPPING_MODE=external-host-agent`: install a separately managed, least-privilege
host agent that ships the server's structured stdout to the selected log backend. The deployed
configuration receipt records only `logs: external-host-agent`, never an agent credential or
backend URL. This is an operator attestation, not delivery proof; the staging readiness observer
must find the exact synthetic `x-request-id` in the real backend before the remote probe passes.

Choose and review the telemetry backend, authentication boundary, retention, residency, ownership,
outage behavior, and alert receivers before deployment. The repository intentionally supplies no
provider URL. Parsing, container health, and a successful deployment do not prove that the external
backend retained telemetry or request logs, or that a human received an alert; verify them end to
end and retain the real rehearsal references.

`infra/observability/otel-collector.example.yml` remains a validated starting point for a
non-single-VM platform. It
accepts application OTLP, scrapes the HTTPS metrics endpoint with its bearer token, batches both
signals, and exports them to an authenticated OTLP backend. Supply all five `OPENROUND_*`
environment values through the platform secret/configuration service, keep receiver ports private,
and change resource limits to match the deployment. `pnpm test:collector-config` validates the
template with the pinned collector image; successful parsing is not proof that the backend accepts
or retains telemetry.

## Prometheus signals

The server exports Node.js runtime metrics plus these Polling Pops families:

- `openround_http_request_duration_seconds`
- `openround_session_events_total`
- `openround_session_joins_total`, `openround_join_acknowledgement_duration_seconds`, and
  `openround_join_batch_size`
- `openround_answers_total`, `openround_answer_acknowledgement_duration_seconds`, and
  `openround_answer_batch_size`
- `openround_host_commands_total`
- `openround_sync_requests_total` and `openround_replay_events_total`
- `openround_realtime_connections` and `openround_active_sessions`
- `openround_session_mutation_lease_wait_seconds`,
  `openround_session_mutation_lease_renewal_failures_total`, and
  `openround_session_version_conflicts_total`
- `openround_broadcast_duration_seconds` and
  `openround_client_event_receipt_duration_seconds`
- `openround_presentation_admission_attempts_total`,
  `openround_presentation_admission_duration_seconds`, and
  `openround_presentation_response_acknowledgement_duration_seconds`
- `openround_presentation_broadcast_duration_seconds` and
  `openround_presentation_client_event_receipt_duration_seconds`
- `openround_media_finalizations_total`
- `openround_billing_webhooks_total` and `openround_billing_webhook_lag_seconds`
- `openround_retention_records_total` and `openround_media_deletion_backlog`
- `openround_reports_generated_total`
- `openround_recovery_funnel_stages_total`
- `openround_authoring_jobs_total` and `openround_authoring_job_duration_seconds`
- `openround_database_connections`

Build dashboards around rates and histograms rather than raw counters. At minimum, correlate HTTP
5xx rate, answer acknowledgement p95/p99, failed broadcasts, reconnect snapshot fallbacks,
database waiters, rejected/error media finalizations, webhook lag, and deletion backlog with
active sessions. When authoring is enabled, monitor completed, retry-scheduled, extraction-failed,
and generation-failed attempts by source type without adding workspace, file, or creator labels.
For multi-writer deployments, break lease wait and version conflicts down by
outcome/operation and correlate them with Redis latency and process restarts.

`openround_broadcast_duration_seconds` measures server fan-out work. The client-receipt histogram
measures the round trip from server emission until the browser immediately acknowledges receipt,
without relying on the device clock. Query acknowledged participant samples by `event_type`,
`role`, and `outcome`; no session, socket, or participant identifier is used as a label. Treat its
latency as a conservative arrival measure because it includes the acknowledgement's return trip.
Track timeout rate separately and require both the p95 and timeout-rate gates before claiming the
broadcast SLO.

Presentation metrics use only bounded transport, projection, event, and outcome labels. Apply the
same acceptance thresholds to both delivery engines: join p95 below 500 ms, durable response
acknowledgement p95 below 250 ms and p99 below 600 ms, and participant receipt p95 below 500 ms.
The manual Presentation room probe (`pnpm load:presentation`) emits a machine-readable sample but
does not replace the self-contained target-region profile, restart/reconnect exercise, or
reconciliation review.

`openround_recovery_funnel_stages_total` projects only server-recorded create, publish, join,
acknowledged-answer, intervention, linked-recheck, and reconciled-report events; telemetry posted
through the browser-facing product-event endpoint is excluded. Its bounded
`artifact_type` and `segment` labels support aggregate rollout comparisons. Each stage has a
different counting unit, however, so stage totals and adjacent-stage ratios are operational and
directional volume—not a session-level cohort funnel. They cannot prove that one facilitator
completed a valid recovery loop or that a partner returned. Use the reviewed, pseudonymous
[session observation record](../evidence/session-observation.md) for those product decisions.

## Bundled dashboard and rules

The optional observability profile starts pinned Prometheus and Grafana images, keeps both ports on
loopback, scrapes the server over the private Compose network, loads the alert rules in
`infra/observability/alerts.yml`, and provisions the **Polling Pops Operations** dashboard:

```bash
docker compose -f compose.yaml -f compose.media.yaml -f compose.observability.yaml \
  --profile observability up -d
pnpm smoke:observability
```

- Prometheus: <http://127.0.0.1:9090>
- Grafana: <http://127.0.0.1:3001>, using `OPENROUND_GRAFANA_USER` and
  `OPENROUND_GRAFANA_PASSWORD`

If an existing local Grafana container restarts with `data source with the same uid already
exists`, check the data-source provisioning configuration. The Polling Pops rename keeps the
`openround-prometheus` UID, so provisioning must remove both the legacy **OpenRound Prometheus**
name and **Polling Pops Prometheus** before recreating the configured source. Use the current
`infra/observability/grafana/provisioning/datasources/pollingpops.yaml` and restart only Grafana.
Deleting the Grafana database or other service volumes is unnecessary. `pnpm smoke:observability`
checks the source's UID, current name, type and URL, plus the dashboard and Prometheus queries.

The default Grafana credentials are only for a loopback-bound local evaluation. Set a unique
password before use and never expose these ports directly to the internet. Prometheus stores 15
days locally by default; change `OPENROUND_PROMETHEUS_RETENTION` only after sizing disk and backup
expectations.

This local profile is a reproducible validation baseline, not evidence of hosted monitoring. It
deliberately has no active paging receiver, because a silent or example destination would create
false confidence. `infra/observability/alertmanager.example.yml` maps `page`, `warning`, and
`ticket` labels to separate placeholder webhook receivers for non-single-VM platform evaluation.
The hosted single-VM overlay uses `alertmanager.single-vm.yml` and secret-backed `url_file`
receivers instead. Run `pnpm test:alert-routing`, protect metrics transport, and rehearse each
hosted route end to end with a named responder. Alert delivery alone does not close the
beta-preflight gate: activate the named support rota, incident and escalation ownership, and public
status, security, privacy, and support contacts, then exercise support intake, triage, escalation,
communication, mitigation, and closure for the same exact build candidate.

CI runs `pnpm test:alerts`, `pnpm test:alert-routing`, and `pnpm test:collector-config`. The first
executes `promtool test rules` against
`infra/observability/alerts.test.yml`. The fixture feeds synthetic failure series into every rule
and verifies the checked-in alert names, hold periods, severity labels, summaries, and runbook
annotations.
The routing check parses the hosted Prometheus and Alertmanager configurations and verifies that
each severity reaches exactly its intended receiver. The collector check parses both the generic
and single-VM pinned templates. These catch configuration regressions; none proves delivery to a
human-owned paging destination. Record that separately with the
[operations rehearsal template](../evidence/operations-rehearsal.md).

## Initial alert candidates

Tune every threshold in staging and assign an owner before paid beta. Suggested starting
conditions are:

- page when answer acknowledgement p99 exceeds 600 ms for ten minutes during active sessions;
- page on sustained HTTP 5xx or failed broadcasts during an active session;
- page when participant event-receipt timeouts are sustained during an active session, and warn
  when acknowledged `question.open` p95 exceeds 500 ms;
- ticket on any nonzero media deletion backlog that survives two retention runs;
- ticket when billing webhook lag exceeds five minutes or invalid signatures spike;
- page when PostgreSQL waiters remain nonzero and acknowledgement latency is rising;
- page on any sustained mutation-lease acquisition timeouts or renewal failures during active
  sessions;
- investigate an unexpected version-conflict increase; the fence preserves correctness, but a
  continuing rate indicates lease loss, excessive pauses, or an uncoordinated writer;
- warn when reconnect synchronization falls back to a snapshot unusually often.
- ticket on sustained authoring extraction/generation failures or a latency/cost shift from the
  provider-specific baseline; disable authoring while investigating without affecting live rounds.

Avoid alerting on a single event or an idle, scale-to-zero pilot. Record the final query, window,
severity, owner, escalation route, and rehearsal date in the production environment's operations
repository.

## Kill switches

The following startup settings are hard capability ceilings:

- `FEATURE_SIGNUPS=false` pauses new magic-link requests.
- `FEATURE_SESSION_CREATION=false` pauses creation of new live sessions.
- `FEATURE_MEDIA_UPLOADS=false` pauses new quarantine uploads.
- `FEATURE_ROUND_EXPERIENCES=false` freezes newly created sessions to Focus.
- `FEATURE_AUDIENCE_PULSE=false` disables new Pulse signals and masks retained live signal data.
- `FEATURE_ROOM_CHAT=false` disables new chat activity and masks live chat history.

`THEMED_INTERACTIONS_WORKSPACE_ALLOWLIST` optionally narrows all three new capabilities to a
comma-separated set of workspace UUIDs during partner rollout. An empty value allows every
workspace, subject to the global startup and runtime switches.

An administrator can pause or resume any capability at runtime without a process restart:

```bash
curl --fail-with-body --request PATCH https://quiz.example.ca/v1/admin/features \
  --header "Authorization: Bearer $OPENROUND_ADMIN_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"sessionCreation":false}'
```

`GET /v1/admin/features` shows `configured`, `runtime`, and `effective` values. A runtime value can
never enable a capability whose startup ceiling or required infrastructure is disabled. Changes
are stored in PostgreSQL, take effect on every API/realtime process on its next guarded request,
and commit atomically with a global audit event. Verify the public effective result through
`GET /v1/features`.

Pausing these switches does not terminate existing creator sessions or active live games. Pausing
uploads does not prevent already-quarantined files from completing scanning, and pausing
interactions does not delete retained evidence. Record the reason, owner, and restoration criteria
in the incident timeline. Do not use a kill switch as a substitute for revoking exposed
credentials or isolating a compromised dependency.
