# Release evidence records

The files in this directory are blank, redaction-safe templates for gates that cannot be proven by
source code alone. Copy a template into the private operations record for each exercise; do not
commit customer content, participant names, credentials, private provider URLs, or unredacted
screenshots.

For each completed gate:

1. Record the immutable image digest, Git commit, environment, UTC start/end time, owner, and
   reviewer.
2. Attach redacted logs or checksums and a stable evidence URL with access appropriate to the
   reviewers.
3. Record failures and follow-up issues; a partial exercise is not a passing gate.
4. Update `docs/release-readiness.json` only after the named reviewer accepts the evidence. For the
   signed-release gate, use the exact evidence-only transition and `releaseBinding` documented in
   the signed release candidate record; do not combine that acceptance with any other change.
5. Run `pnpm readiness:check`; run `pnpm readiness:require:beta:preflight` before tagging a beta
   candidate, then run `pnpm readiness:require:beta` after the signed-release evidence is accepted.

## Repository evidence tools

| Command                                                                | Purpose                                                                                                                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm alerts:rehearse`                                                 | After receiver owners approve the exercise window, inject and resolve synthetic `page`, `warning`, and `ticket` alerts and write a build-bound request receipt. |
| `pnpm evidence:target-load -- <command> ...`                           | Validate references with `validate-references`, create a soak summary with `summarize-soak`, or bind the exact matrix with `bundle`.                            |
| `pnpm evidence:backup-restore:check -- <manifest.json> <receipt.json>` | Recompute and validate the redaction-safe off-host backup manifest and clean replacement-host restore receipt.                                                  |
| `pnpm research:check -- [aggregate.json]`                              | Validate and recompute the Phase 0 research aggregate; with no path it checks the committed pending example.                                                    |
| `pnpm readiness:check`                                                 | Validate gate shape, stable unique evidence references, and required owner/independent-reviewer acceptance for completed human-assurance gates.                 |

The alert rehearsal is intentionally confirmation-gated. Set
`ALERT_REHEARSAL_CONFIRM=send-and-resolve-synthetic-alerts`, an HTTPS `ALERT_REHEARSAL_URL`, a full
Git commit or image digest in `ALERT_REHEARSAL_BUILD_ID`, and a redaction-safe
`ALERT_REHEARSAL_DEPLOYMENT`; provide `ALERT_REHEARSAL_TOKEN` privately when required. The default
45-second firing interval intentionally exceeds the checked-in Alertmanager 30-second `group_wait`;
production runs reject shorter intervals. The default receipt is
`artifacts/readiness/alert-rehearsal.json`. An outcome of `requests_accepted` establishes only that
Alertmanager accepted the inject and resolve requests—it does not prove receiver delivery, named
responder acknowledgement, support readiness, or gate acceptance.

The hosted single-VM Alertmanager is intentionally HTTP on host loopback only. Run the rehearsal
from a shell on that host, or through an approved SSH local-forward, without adding a public proxy:

```sh
ALERT_REHEARSAL_CONFIRM=send-and-resolve-synthetic-alerts \
ALERT_REHEARSAL_URL=http://127.0.0.1:9093 \
ALERT_REHEARSAL_ALLOW_HTTP=true \
ALERT_REHEARSAL_BUILD_ID="$REVIEWED_BUILD_COMMIT" \
ALERT_REHEARSAL_DEPLOYMENT=single-vm-staging \
pnpm alerts:rehearse
```

For an SSH tunnel, bind an unused local loopback port (for example `19093`) to the remote
`127.0.0.1:9093` and use that local port in `ALERT_REHEARSAL_URL`. HTTP is accepted only for an
explicit loopback URL; every non-loopback target still requires HTTPS.

Every command above is a consistency or rehearsal aid. Keep populated private evidence outside the
repository, retain the command output and input checksums with the reviewed record, and leave the
ledger pending until the gate owner and independent reviewer accept the complete external exercise.

Available release templates cover [single-VM staging](single-vm-staging.md),
[monitoring, paging, and support rehearsal](operations-rehearsal.md),
[target-region load and soak](target-region-load.md),
[provider restoration](provider-restore.md), [accessibility](accessibility-review.md),
[security](security-review.md), [privacy/legal approval](privacy-legal-approval.md),
[live billing](live-billing-rehearsal.md), [repository governance](repository-governance-canary.md),
[physical devices](device-matrix.md), and the [signed release candidate](signed-release-candidate.md).

Research templates cover [design-partner interviews](design-partner-interview.md),
[observed beta sessions](session-observation.md), the aggregate
[P0 beta usability study](beta-usability.md), and the
[Phase 0 segment/Phase 1 branch decision](phase0-stage-decision.md). Use the
[research prototype evaluation](research-prototype-evaluation.md) for the allowlisted Companion,
Question Health, and delayed-probe studies when those optional studies are run. Prototype Lab tasks
are optional research inputs, not Phase 0 closure prerequisites; a completed prototype record does
not pass a release or roadmap gate by itself.
Use the [Phase 0 evidence campaign runbook](../runbooks/phase0-evidence-campaign.md) to sequence
recruitment, observation, independent review, aggregation, and the ordered branch decision.

The current research P0, [R2-00](../competitor-backlog-2026-10-27.md#r2-00-establish-demand-and-select-the-next-increment),
has an [execution checklist](../runbooks/phase0-evidence-campaign.md#r2-00-execution-checklist) and
ticket-linked sections inside the existing interview, observation, and decision records. Use them
to retain supporting and contrary evidence and the three required workflow tasks. Their blank
Pending state is preparation, not observed evidence or a change to any gate or Deferred candidate.

For the first-use workflow comparison, pair the
[Wooclap head-to-head protocol](../runbooks/phase0-evidence-campaign.md#wooclap-head-to-head-recovery-loop-test)
with a private copy of the [comparison scorecard](session-observation.md#wooclap-recovery-loop-comparison).

The [Phase 0 research aggregate schema](phase0-research-aggregate.schema.json) and deliberately
empty [pending example](phase0-research-aggregate.example.json) provide a machine-readable handoff
for independently reviewed counts. Copy the example to the approved private working location and
populate only pseudonymous aggregate records. Evidence references in that file must be content
checksums or opaque `ref:` handles resolved in the approved private evidence index; do not put a
private URL or raw research material in the aggregate. Every included record carries its final
disposition, predeclared reason code when excluded/rejected, and accepted independent review. The
aggregate also records the research-owner and independent-reviewer gate decisions explicitly.

Run `pnpm research:check -- path/to/redacted-aggregate.json` to validate and recompute the research
gate, acquisition-segment tie-break, and ordered Phase 1 branch. With no path, the command validates
the committed empty example and must report pending. Passing validation proves internal consistency
only; it does not replace the evidence, research-owner decision, independent review, or readiness
ledger transition.
