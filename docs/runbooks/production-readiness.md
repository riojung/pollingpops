# Production readiness checklist

## Product and legal

- Final name, domain, interface, scoring explanation, comparison claims, and asset register reviewed independently.
- Terms, privacy notice, cookie notice, acceptable use, content policy, DPA, subprocessors,
  retention, deletion, access, incident, residency, and law-enforcement procedures are approved by
  qualified counsel for every selected launch market and captured in the
  [privacy/legal approval record](../evidence/privacy-legal-approval.md).
- Education onboarding uses anonymous guest mode, private results, friendly aliases, and accuracy scoring by default.
- US school self-service remains disabled until US counsel approves COPPA, FERPA, contracts, and notices.

## Platform

- Production uses the reviewed remote `compose.single-vm.yaml` profile on one dedicated VM. Caddy,
  web, API/realtime, PostgreSQL, Valkey, MinIO, and ClamAV share one failure domain. This is not a
  high-availability design and carries no SLA; public production remains blocked until every item
  in this checklist and the release ledger has current evidence.
- The VM meets the measured CPU, memory, disk, IOPS, and network envelope; its supported OS,
  Docker/Compose versions, security updates, firewall, disk alerts, time synchronization, and
  dedicated non-root deployment account are documented and owned. Docker access is treated as
  host-administrator privilege. Only required SSH and HTTPS traffic is admitted from approved
  sources.
- The deployment pins the VM's SSH host key in the checked known-hosts file using an independently
  verified provisioning channel. Automation uses `StrictHostKeyChecking=yes`, never accepts a new
  key interactively, and requires explicit review when a host is replaced.
- Production secrets differ from development and originate in an approved secrets system. Any
  temporary deployment environment file is mode `0600`, is transferred only over the pinned SSH
  connection, and is removed according to the deployment runbook.
- Production startup passes the fail-fast configuration checks: public web, API, and media URLs
  use HTTPS; creator cookies cannot be explicitly insecure; and SMTP is configured before the
  sign-up ceiling is enabled. Keep `FEATURE_SIGNUPS=false` until email delivery is verified. The
  `ALLOW_INSECURE_LOCAL_HTTP` escape hatch is restricted to non-billing community deployments on
  loopback or private-network URLs and must never be enabled in hosted production. Keep
  `AUTH_DEBUG_MAGIC_LINKS=false`; exposing verification tokens or sign-in PINs in API responses is only for explicit,
  loopback-bound local testing.
- Build the exact candidate image with `OPENROUND_BUILD_ID` set to its full Git commit (or immutable
  image digest) and execute `node dist/config-check.js` with the deployment's server environment
  before migration or promotion. Retain its non-secret JSON summary with the release evidence. A
  zero exit code proves schema and cross-field validation; it does not prove that external
  credentials authenticate. Remote probes must compare both the running server's `/health/live`
  build ID and the web root's `X-OpenRound-Build-Id` with that candidate marker; target-host
  probes independently compare the server marker.
- Hosted production requires `METRICS_ENABLED=true`, a non-default bearer token, and the private
  authenticated collector overlay. Bind the collector scrape path only on the private service
  network, retain the token outside evidence/logs, and never expose the metrics route through the
  public Caddy ingress.
- Application traffic uses a non-owner PostgreSQL role; only the migration job receives the
  owner-level `DATABASE_MIGRATION_URL`, and the production-like forced-RLS test passes.
- PostgreSQL, Valkey, MinIO, Caddy, web, API/realtime, and ClamAV run on the same production VM.
  No local volume, VM snapshot, or second path on that host counts as an off-host backup.
- `AUDIT_RETENTION_DAYS` matches the approved institutional policy, and a scheduled retention run
  has demonstrated that records at the cutoff are purged while newer records remain exportable.
- Encrypted PostgreSQL and MinIO backups leave the VM on the approved schedule, retain multiple
  verified generations in a separately administered location, and have checksum/age alerting.
  A current timed drill restores them onto a patched, clean replacement VM without relying on the
  original host and demonstrates the approved RPO and RTO.
- Production has Valkey available for both the Streams transport adapter and owner-fenced
  per-session mutation leases; PostgreSQL version compare-and-swap remains the durable fence.
- Realtime runs as one server container on the active topology. A second writer or multi-host
  topology is a future architecture change and requires a separate load-balancing, shared-storage,
  failover, lease-expiry, and rolling-deployment qualification before use.
- TLS, origin allowlist, rate limits, CSP, private storage, ClamAV signature freshness and failure
  behaviour, email authentication, Stripe signatures, administrator controls, and log redaction
  are verified. The application and media DNS names both use valid public certificates, HTTP is
  redirected to HTTPS, certificate-expiry monitoring has an owner, and no database, Valkey, MinIO
  administration, metrics, or Docker socket is exposed publicly.
- Keep `AUTHORING_AI_MODE=disabled` until the exact endpoint/model passes privacy, DPA,
  subprocessors, residency, source-retention, prompt-leakage, citation-quality, correction-rate,
  latency, cost, redirect, oversized-response, and failure-mode review. When enabled, use HTTPS,
  store the API key in the secret manager, verify that participant/session data never enters a
  prompt, and rehearse disabling the capability independently of live rounds.
- Keep `OIDC_MODE=disabled` and `LTI_MODE=disabled` unless an institution contract and
  operator-granted workspace capability exist. Before enabling OIDC, verify discovery, issuer,
  callback, PKCE/state/nonce, explicit linking, revocation, removed membership, and provider key
  rotation. Before enabling LTI, store a dedicated RSA private JWK in the secret manager, verify
  that the public JWKS exposes no private parameters, register exact platform issuers/clients/
  deployments/return origins, and test replay, wrong audience/deployment, disabled registration,
  return-origin rejection, and key rotation in the real LMS.
- Keep identified learner launch, NRPS, AGS, managed SAML/SCIM, and K–12 disabled. Instructor LTI
  and creator OIDC are not evidence that learner privacy, roster, grade, provisioning, or school
  contract requirements are met. Complete independent interop/certification, DPA, residency,
  identity threat-model, and counsel review before an institution pilot.
- `/metrics` is reachable only from the monitoring network, an OTLP collector is configured when
  tracing is enabled, alert thresholds have owners, and signup/session/media/experience/Pulse/chat
  kill switches are rehearsed without interrupting an active game.
- Status page, security contact, privacy contact, support rota, incident commander, and escalation contacts are live.
- Accept the monitoring, paging, and support-rehearsal gate only after the same candidate passes
  end-to-end alert delivery and a support incident drill covering intake, triage, escalation,
  status communication, an applicable kill switch, and closure. The operations owner and an
  independent reviewer must both accept the retained record; automated route checks alone do not
  satisfy the gate.

## Release evidence

- `pnpm check`, `pnpm readiness:check`, alert routing, and collector configuration validation pass
  from a clean checkout.
- `pnpm audit --audit-level low` passes; `THIRD_PARTY_NOTICES.md` matches
  `pnpm licenses:report`; release SBOMs, provenance, signatures, and container scans are retained.
  Container scans include fixed and unfixed HIGH/CRITICAL findings; the release path has no
  implicit `ignore-unfixed` exception.
- Staging promotion uses the complete manifest from the protected, repository-dispatched
  **Staging images** workflow on `main`; production promotion uses the complete manifest from the
  protected tag-triggered release workflow. Both signatures verify against the exact allowlisted
  GitHub Actions identity in the target config. Production also requires GitHub to report a valid
  signature for the exact bound annotated tag object and confirms its name and target commit. A
  workstation build, signature, reconstructed manifest, unsigned tag, or recreated tag is not
  accepted.
- Database migration succeeds on a production-like copy and has a forward-repair plan.
- Chromium, WebKit, Firefox, mobile Safari, and mobile Chrome critical flows pass.
- Recovery interventions/rechecks, cohosting, Q&A moderation, hostile portability imports,
  secure embed, follow-up expiry/revocation/accommodations, and source-authoring review paths pass.
- For enabled Presentation candidates, legacy v1 reads and v2 save/recovery/history behavior pass;
  bounded move/resize, inspector/keyboard equivalents, image reservation, overflow guidance, and
  narrow-screen reading order agree in editor, preview, facilitator, and participant views.
- For enabled Question Health and Decision Replay candidates, verify revision-fenced
  dismissal/apply/undo, exact-version/cohort/sample bounds, aggregate-only event capture, retry
  idempotency, explicit unavailable/truncated timelines, and V1–V4 report/follow-up compatibility.
- Owner-only archived Library deletion and finished/expired session-history deletion pass with
  confirmation, tenant isolation, retained-assignment guards, concurrent restore/dependent writes,
  metadata/media-reference cleanup, socket revocation, and report-worker fencing. Migration 048
  runs under the migration principal; runtime permissions remain restricted. Include post-cutoff
  deletion reconciliation in the replacement-host restore rehearsal.
- All six Round Experience presets pass contrast, keyboard, screen-reader, reduced-motion, 200%
  zoom, phone, projector, and visual-regression checks. Presenter sound begins muted and every cue
  has an equivalent visual state.
- Audience Pulse/chat are independently feature-flagged. A two-process rehearsal proves
  monotonic audience sequence allocation, outbox retry/deduplication, sub-two-second sync, no
  private-alias leakage, public five-signaler suppression, distributed limits, moderation, and
  deletion/export completeness. Complete the [moderation rehearsal](audience-moderation.md).
- For an institution candidate, creator OIDC link/login/revoke and LTI instructor first-link,
  repeat launch, Deep Linking, idempotent response, state replay, and audit export pass against the
  named provider/LMS; retain platform/version and result evidence. Repository tests do not replace
  1EdTech certification.
- Keyboard, screen-reader, 200% zoom, contrast, reduced-motion, and extended-time tests pass.
- A 100-player session is supported; 250-player single-session and 1,000-player multi-session load suites pass without answer loss or duplicate scores.
- Join p95 is below 500 ms; answer acknowledgement p95 below 250 ms and p99 below 600 ms;
  acknowledged `question.open` client receipt p95 below 500 ms with a rehearsed timeout-rate
  alert; recovery below two seconds; report below 60 seconds.
- The co-located GitHub-hosted aggregate job enforces the beta's one-second client-latency budget
  because runner CPU and storage are variable. Only a controlled or target-environment run using
  the default 250/600/500 ms answer-p95/answer-p99/question-p95 gates qualifies as release capacity
  evidence.
- Clean replacement-VM restore, Valkey loss, server restart, whole-VM loss, Stripe replay, and
  failed-email exercises pass. Whole-VM loss is expected to cause an outage until replacement and
  restore complete; no availability commitment may imply otherwise.
- The shared-store two-writer integration suite and the two-container cross-process/process-loss
  smoke pass against the release image.
- External security review has no unresolved critical or high finding.

For a disposable local production-path sample, start the full media Compose profile and run
`CLIENTS=100 ASSERT_PERFORMANCE=true RESTART_SERVER=true pnpm load:compose`. Retain the JSON output
with host hardware, container resource limits, build identifier, and date. Repeat from an isolated
load generator near the actual target VM before using the result as release evidence, and retain
the VM resource limits and saturation signals.

To exercise the local multi-writer path against one release image:

```bash
docker compose -f compose.yaml -f compose.test.yaml build server
docker compose -f compose.yaml -f compose.test.yaml -f compose.multiwriter.yaml up -d --no-build --wait server server-secondary mailpit
pnpm smoke:multi-process
```

This proves application-level ownership, database fencing, adapter delivery, and takeover with
direct WebSockets. It is future horizontal-scale evidence; the active single-VM topology runs one
server container and this test does not provide host failover or high availability.

For the local Phase 6 stress profiles, add `compose.test.yaml`, run the single-session harness with
`CLIENTS=250 JOIN_BATCH_SIZE=25 ASSERT_PERFORMANCE=true RESTART_SERVER=true`, then run the
`load`-profile container for ten staggered 100-client lobbies and a synchronized 1,000-client game
burst. Do not translate either local result into a production capacity claim without a rerun on
the provisioned target VM and its real network path.

The Presentation profile additionally sets `PRESENTATION_CONCURRENT_RESPONSE_WRITES=true` on its
disposable, single-version stack. Production must follow the staged enable/rollback procedure in
the [upgrade runbook](upgrade.md#presentation-concurrent-response-rollout); a result gathered while
the compatibility mode is enabled does not represent the optimized 250-client path.

See [observability and operational controls](observability.md) for metric, trace, alert, and
kill-switch guidance. Use the [single-VM staging workflow](staging-readiness.md) for the remote
probe and target-host game, and complete its
[deployment record](../evidence/single-vm-staging.md). Use the
[evidence templates](../evidence/README.md) for the other non-code gates and
`pnpm readiness:require:beta:preflight` before creating a beta tag. After the workflow publishes
and verifies the signed artifacts, complete and independently review the
[signed release candidate record](../evidence/signed-release-candidate.md), merge the independently
reviewed ledger-only acceptance with its exact `releaseBinding`, and run
`pnpm readiness:require:beta` for the final beta decision. Deploy the exact retained manifest from
that acceptance commit; any other descendant change requires a new candidate and tag.

None of these instructions establishes that a staging or production VM exists. Provisioning,
operational ownership, and every external evidence item must be verified separately before public
traffic is approved.
