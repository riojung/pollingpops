# Polling Pops threat model

- Version: 1.1
- Engineering inventory updated: 2026-10-04
- Status: Engineering input for independent review; not a security certification

This model describes the implemented single-VM beta boundary. It must be re-frozen against the
exact release commit, image digests, deployment configuration, enabled flags, providers, and
architecture before an independent review. Institution learner identity, roster/grade services,
managed SAML/SCIM, multi-host routing/failover, native add-ins, and K–12 sales are outside this
candidate and must remain disabled.

## Security objectives

- A creator can access only workspaces and artifacts authorized by current membership and role.
- A participant, host, presenter, companion, or practice bearer receives only its explicit
  session/artifact projection and only for its scoped lifetime.
- Accepted live responses are unique, durable, fenced to the current block/revision, and recoverable
  after reconnect without score duplication.
- Correct answers, explanations, citations, speaker notes, hidden diagnostics, aliases, private
  results, and media are not disclosed before or outside their authorized state.
- Published versions and ready reports remain immutable; changes create new reviewed state.
- Permanent deletion requires current owner authority and preserves retained source dependencies;
  deleted rooms and reports cannot be recreated by an in-flight join, response, or worker.
- Private media remains quarantined until scanned and is delivered only after artifact/session
  authorization.
- Billing, identity, administration, deployment, and release state cannot be advanced by an
  unsigned, stale, replayed, cross-tenant, or unreviewed input.
- Logs, metrics, traces, exports, evidence, and support workflows do not become a secondary source
  of credentials, participant content, answers, or identity linkage.

Availability is bounded by the documented single-VM failure domain. This model does not claim high
availability or an SLA.

## Assets and actors

Protected assets include creator sessions and email addresses; workspace memberships; draft and
published content; participant/host/presenter/companion/practice credentials; aliases, responses,
confidence, interventions, aggregate decision events, Q&A, chat, reports, Question Health decisions
and edit provenance, and audit records; quarantined/clean media; Stripe,
OIDC, LTI, SMTP, database, object-store, telemetry, backup, signing, deployment, and administrator
credentials; immutable images, manifests, SBOM/provenance, and accepted evidence.

Actors are accountless participants; authenticated owners/editors/viewers; hosts/cohosts,
presenters, and future companion clients; support and operations staff; institution identity/LMS
providers when explicitly enabled; billing/email/storage/telemetry providers; independent
reviewers; and unauthenticated or authenticated attackers. A facilitator seeing a participant's
chosen session alias is expected Learning-mode behavior, not full anonymity.

## Trust boundaries

1. **Public browser ↔ Caddy:** only HTTPS application/media origins are public. Caddy forwards the
   bounded API, health, and Socket.IO paths; metrics and administration stay private.
2. **Caddy ↔ web/API:** the API trusts only the configured proxy address, validates origin/cookies
   and bearer purpose, and constructs server-authoritative snapshots.
3. **API ↔ PostgreSQL/Valkey:** PostgreSQL is durable truth with forced tenant RLS and a non-owner
   runtime role. Valkey is a rebuildable transport/lease layer; database revision compare-and-swap
   remains the durable mutation fence.
4. **API ↔ object storage/scanner:** uploads enter a private quarantine path through signed,
   bounded tickets; type/size/signature and ClamAV results gate clean promotion and download.
5. **API ↔ SMTP/Stripe/OIDC/LTI/AI:** each provider is a separate external trust boundary with an
   explicit disabled-by-default mode, credential, redirect/origin, timeout, and replay boundary.
6. **Application ↔ telemetry/support/backups:** operational systems receive bounded metadata and
   require separate access/retention. They must never receive raw participant answers or bearer
   values through labels, logs, traces, alerts, or evidence.
7. **Source/tag/workflow ↔ registry/deployer:** protected review, exact-commit workflows, OIDC
   signing, immutable digests, provenance, scans, signed tags, reviewed manifests, and pinned SSH
   host keys separate source intent from production execution.

See [architecture](architecture.md), [API authorization](api.md), and the
[privacy data map](privacy-data-map.md) for detailed flows and retention.

## Threats, controls, and required verification

| Threat/abuse case                                                        | Primary controls                                                                                                                                                                                                                                                   | Independent verification focus                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email verification/PIN theft, guessing, replay, or cookie downgrade      | Verification alone issues no session; one-time expiring credential hashes; challenge-bound PIN hash; five wrong attempts; resend replacement; shared issuance/verification limits; secure HttpOnly/SameSite cookie; logout/revocation; no hosted debug credentials | No identity before verification; no session before PIN; expiry/replay/concurrent consumption; deletion; purpose/return-path/membership validation; cross-instance limits; SMTP failure; cookie flags |
| Room-code enumeration, NAT abuse, or bearer reuse                        | Authoritative room registry; rate limits/abuse telemetry; random session-scoped credentials stored as hashes; purpose, expiry, replacement, and revocation                                                                                                         | Enumeration cost, distributed/NAT behavior, wrong room/role/purpose, expired/revoked tokens                                                                                                          |
| Cross-tenant creator or report access                                    | Workspace role checks plus forced PostgreSQL RLS using a non-owner runtime principal; tenant-scoped keys and queries                                                                                                                                               | Direct-object references, role changes, removed membership, export/delete/support/admin paths                                                                                                        |
| Unauthorized deletion, restored-item races, or loss of retained practice | Owner checks; tenant-scoped lookup; archived-state check under a parent lock; retained session/assignment guard and foreign-key backstop; migration 048 scopes cleanup to the deleted parent                                                                       | Editor/viewer/foreign-tenant requests, restore-versus-delete, dependent creation-versus-delete, all-user favorites and Group links, runtime grants, account cascades                                 |
| Deleted-room resurrection or stale bearer access                         | Serialized Round deletion; transactional Presentation cascade; room-code release; socket disconnect, credential/cache invalidation, and report-worker foreign-key fencing                                                                                          | Finished and expired deletion, active Presentation refusal, concurrent join/response/report generation, cross-process reconnect, stale list requests                                                 |
| Decision Replay leaks identity or invents missing evidence               | Strict aggregate-only payloads committed with state; frozen creation gate; bounded event capture; explicit unavailable/incomplete status; authorized reports only                                                                                                  | No alias/participant ID/raw answer/free-form field, command/deadline retries, truncation, legacy report reads, retention/export/deletion, no historical backfill                                     |
| Question Health mutates published content or exposes learner history     | Deterministic advisory rules; revision-fenced human-approved draft apply/undo; immutable-version read analysis; retained-report sample/cohort bounds; no AI call                                                                                                   | Stale apply/undo and idempotent retry, content-hash dismissal matching, tenant/version isolation, cohort suppression, export/deletion of decisions and field diffs                                   |
| Participant or presenter projection leakage                              | Allowlisted role projections; private-result/identity settings independent of trust mode; no participant connectivity broadcast; current-block media authorization                                                                                                 | Pre-reveal answer/explanation/note/citation leakage, aliases, private results, reconnect/replay payloads                                                                                             |
| Stale/replayed commands or duplicate responses                           | Expected revision/block, command/response idempotency, durable receipts, server receipt time, event sequence, transaction/CAS fencing                                                                                                                              | Duplicate-before-stale order, concurrent advance/submit, process/Valkey loss, reconnect during save/reveal                                                                                           |
| Score/report tampering or lost acknowledged answers                      | Server-side deterministic scoring; accepted-response uniqueness; immutable event/version history; report reconciliation worker                                                                                                                                     | Concurrent writers, restart, retry, old clients, ready-report counts and immutable published inputs                                                                                                  |
| Stored/reflected XSS, CSRF, injection, or malicious imports              | Schema/bounds validation; parameterized storage; origin checks; nonce CSP, HSTS and frame controls; formula escaping; bounded archive/XML parsing; secure embed allowlist                                                                                          | Authoring, chat/Q&A, filenames/alt text, imports/exports, redirects, CSP bypass, cross-origin requests                                                                                               |
| Malicious upload or private-media disclosure                             | MIME/signature/size checks; signed quarantine upload; ClamAV; private bucket; clean-only authorization; retention cleanup                                                                                                                                          | Polyglots, scanner unavailable/stale, object-key substitution, pre-scan read, cross-tenant/session media                                                                                             |
| Authoring-source exfiltration, SSRF, prompt leakage, or auto-publication | Provider-neutral async jobs; disabled/BYO mode; bounded extraction and redirects/timeouts; source cleanup; draft-only apply; participant/session data prohibited                                                                                                   | Redirect/DNS behavior, oversized output, provider retention/residency, prompt contents, citation and human approval                                                                                  |
| Billing forgery, reordering, retry, or entitlement rollback              | Stripe signature verification; durable event idempotency and ordering; provider reconciliation; browser redirect never grants access                                                                                                                               | Invalid signatures, duplicates, stale-after-new, transient retry, cancellation, restart and final provider truth                                                                                     |
| OIDC/LTI login/link replay or subject confusion                          | Exact issuer/client/deployment registrations; state/nonce/PKCE; explicit account linking; one-time transactions; exact return origins; public-only JWKS                                                                                                            | Wrong issuer/audience/deployment, replay, email-based implicit linking, disabled registration, key rotation/revocation                                                                               |
| Administrator or kill-switch abuse                                       | Long random bearer, private handling, bounded startup ceilings, audited database-backed runtime changes; controls cannot enable a disabled ceiling                                                                                                                 | Token leakage/redaction, cross-workspace effects, audit attribution, active-room preservation, credential rotation                                                                                   |
| Denial of service or resource exhaustion                                 | Per-route/session-aware limits, participant/content/upload caps, bounded payload/history, connection health, no public data services, operational kill switches                                                                                                    | Distributed joins, large messages/files/imports, reconnect storms, slow clients, report/worker queues, disk exhaustion                                                                               |
| Telemetry/evidence privacy leakage                                       | Structured redaction; bounded label vocabulary; aggregate thresholds; protected metrics; private collector; redaction-safe manifests/checksums                                                                                                                     | Headers/bodies/errors, aliases/answers/tokens, URL query credentials, provider exports, support screenshots and retention                                                                            |
| Backup theft, incomplete restore, or destructive operator error          | Encrypted off-host generations; separately held key; checksums/inventory; clean replacement-host drill; credential rotation; forward repair                                                                                                                        | Least-privilege backup access, point-in-time consistency, missing media, RPO/RTO, plaintext cleanup, source-host independence                                                                        |
| Dependency, workflow, image, tag, or deployment substitution             | Lockfile/audit/CodeQL/secret scan; pinned actions/images; SBOM/provenance/Trivy; signed annotated tag and OCI digests; evidence-only acceptance; strict SSH pin                                                                                                    | Fork/PR permissions, stale successful runs, tag rewrite, certificate identity, mutable refs, manifest/source mismatch, copied deployment-receipt authenticity, bypass audit                          |

## Highest-risk misuse cases

- A participant changes a block ID/revision or replays an idempotency key to affect another answer.
- A presenter/companion requests host identity, credentials, hidden notes, or pre-reveal keys.
- A creator from workspace A guesses an artifact/report/media ID belonging to workspace B.
- A delete races a restore, new retained dependency, live response, or report worker and leaves
  orphaned metadata, removes retained practice, or restores access to a deleted room.
- A replay or Question Health endpoint returns learner-linked evidence through an aggregate view.
- An attacker uploads a polyglot or replaces a signed object before finalization.
- A billing event is duplicated, delayed, reordered, forged, or replayed after cancellation.
- A compromised support, telemetry, backup, or release artifact exposes data intentionally absent
  from participant-facing APIs.
- An operator deploys an unreviewed descendant, mutable image tag, recreated release tag, changed
  environment, or unpinned replacement host.

The security review must attempt these cases against both expected and failure/reconnect paths.

## Deployment assumptions and residual risk

- PostgreSQL, Valkey, object storage, scanner, API, web, Caddy, and hosted telemetry run in one VM
  failure domain. Whole-VM loss causes an outage until replacement and restore.
- Provider credentials and receiver URLs come from an approved secret system, not repository files.
- Hosted metrics/tracing, paging, SMTP, backups, billing, DNS/TLS, and signing are not proven until
  the external Phase 0 exercises pass on the exact candidate.
- The remote probe hashes and validates deployment-receipt claims but does not authenticate the
  copied JSON's source. Staging acceptance therefore requires the operations owner and independent
  reviewer to compare that hash with the deployer's protected original and reconcile its manifest
  and runtime-input hashes through an independent evidence channel.
- Accountless Learning mode prevents a persistent learner profile but is pseudonymous: facilitators
  may see the session alias, and possession of an unexpired scoped bearer grants its documented
  access until revocation/expiry.
- Human moderation, policy, legal basis, participant consent, reviewer independence, and provider
  contract/residency are organizational controls outside source-code enforcement.
- Application deletion does not erase older backup generations or downloaded exports. Operators
  must reconcile later approved deletions before serving a restored backup and apply their approved
  backup retention policy; the application does not provide an automatic backup-erasure journal.

## Review and change control

The independent reviewer must record methodology, qualifications, independence, exclusions,
severity rubric, every finding/retest, and a final decision in the
[security review record](evidence/security-review.md). No critical or high finding may remain open
or be accepted as launch risk.

Re-review is required after a material authentication/authorization or projection change, new
question/identity mode, provider/data path, public endpoint, storage/retention change, institution
learner capability, native integration, multi-host topology, release/deployment trust change, or a
critical/high incident. Automated CI supports this model but cannot supply the independent decision.
