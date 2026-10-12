# Incident response runbook

## Severity

- **SEV1:** participant data or private-alias exposure, broad authentication failure, durable answer
  corruption, committed interaction loss, or most live sessions unavailable.
- **SEV2:** one customer or region materially impaired, billing/retention failure, elevated
  answer/report mismatch, audience outbox backlog, or moderation controls unavailable.
- **SEV3:** degraded non-critical workflow with a safe workaround.

## Response

1. Acknowledge, name an incident commander, preserve evidence, and open a timestamped decision log.
2. Protect active rooms: stop deployment, disable Pulse/chat independently, set presenter feeds to
   `off`, reject new lobbies if necessary, and preserve durable answers and committed interaction
   rows.
3. Assess affected region, deployment version, sessions, data classes, audience outbox lag, and
   time window using identifiers rather than participant content.
4. Mitigate with pause, rollback, credential rotation, traffic isolation, or provider failover as appropriate.
5. Update the independent status page. Use counsel-approved customer notification procedures for possible privacy incidents.
6. Reconcile answers, audience sequences/outbox delivery, transcript projections, and reports
   before declaring recovery. Verify that private-at-creation aliases were never projected publicly.
7. Complete a blameless review with root cause, detection gap, customer impact, corrective owner, due date, and regression test.

Never copy tokens, cookies, participant nicknames, chat bodies, participant-linked Pulse signals,
answer content, email addresses, or full billing events into chat or incident documents.

## Product feedback intake

Signed-in workspace members can use **Feedback** in the header to report a problem, usability issue,
or suggestion. A receipt means the report was committed to private storage; it does not send an
email, create a GitHub issue, page a responder, or guarantee that a human has reviewed it.

- Assign a named support owner to review `GET /v1/admin/feedback` regularly during beta. Authenticate
  using the existing `ADMIN_TOKEN` bearer credential from the private secret manager, never a URL,
  screenshot, checked-in script, or browser bookmark. Pages accept `limit` up to 50 and `cursor`;
  follow `nextCursor` until null. The queue is ordered by opaque ID, not severity or receipt time.
- Treat message text as untrusted and potentially sensitive. Record the receipt reference, severity,
  status, owner, and redacted reproduction steps in the private support system. Do not copy raw
  reports to public issues or telemetry. Escalate incidents through the normal severity procedure.
- The queue exposes a follow-up email only when the author explicitly opted in. Do not infer contact
  permission from workspace membership or resolve a contact address from the workspace reference.
- Feedback is not an urgent incident channel. Keep the approved support/status route visible in Help.
  Reports expire after 90 days, are purged by the retention job, appear in the author's account export,
  and are removed on author/account or owned-workspace deletion. No participant content, screenshots,
  logs, page identifiers, or URL queries are collected automatically.

Verify durable submission, lost-receipt retry, administrator-only access, contact consent, account
deletion, and retention in staging before enabling public-beta intake. The Feedback button does not
replace the external support rehearsal or any release gate.

## Phase 0 support rehearsal

Run this exercise only during an approved window against the exact build used for the staging,
telemetry, and paging evidence. Name the primary/backup responders, incident commander, technical
escalation contact, support owner, communications owner, and independent reviewer before starting.
Keep personal contact details and provider endpoints in the private operations system.

1. Submit a synthetic support report that says a facilitator cannot start a new room while an
   existing room remains active. Record its unique private ticket reference and intake time.
2. Have the support owner acknowledge it through the normal route, classify it using the severity
   rubric, collect only redaction-safe build/request identifiers, and hand it to the technical
   responder. No rehearsal participant may use an out-of-band shortcut unavailable to beta users.
3. Correlate the report to metrics, a trace ID, and a request ID in their real backends. Inject and
   resolve unique `page`, `warning`, and `ticket` alerts with the guarded alert-rehearsal command;
   keep the default 45-second firing interval (it exceeds Alertmanager's 30-second `group_wait`) and
   independently record which named role received each route and its receipt time.
4. Post an initial incident update through the real support/status communication path. State the
   affected capability, existing-room safety, workaround if any, owner, and next update time
   without claiming a root cause prematurely.
5. Disable **new session creation** through the audited runtime control and verify the public
   effective state. Confirm the existing synthetic room can still answer, acknowledge, reconnect,
   finish, and reconcile its report. Do not use a kill switch that interrupts active games.
6. Restore the capability, verify a new synthetic room can be created, reconcile both reports, and
   close the support ticket plus status communication through their normal paths.
7. Revoke exercise credentials and remove synthetic data according to retention policy. Record
   detection, acknowledgement, handoff, communication, mitigation, restore, and closure times;
   route receipts; build ID; redacted artifact hashes; failures; reruns; and follow-up issues.

The exercise passes only when every route reaches its intended human-owned destination, support
handles the report end to end, telemetry correlation works, the kill switch preserves the active
room, restoration succeeds, no severity-1/2 defect remains, and both the operations owner and an
independent reviewer accept the record. Script acceptance proves only that Alertmanager accepted
the injection and resolution requests; it does not prove delivery to a human.
