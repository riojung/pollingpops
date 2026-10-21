# Beta release preparation

This is the staging handoff, not an acceptance record. Follow the existing
[deployment](deployment.md), [staging readiness](staging-readiness.md), and
[gate acceptance](../evidence/gate-acceptance.md) procedures; the
[release ledger](../release-readiness.json) remains authoritative.

As of 2026-10-17, AWS EC2 is the selected staging provider, but the instance is not ready.
The checked-in staging target still has placeholder domains/host and a comment-only SSH key
file. Repository governance also awaits a second human collaborator with write access and
accepted review responsibility. These inputs must be supplied rather than inferred from a
successful local run.

## Work that can proceed now

Refresh engineering validation after the merged readiness work. From the reviewed checkout, use
the existing commands below and retain the candidate SHA and results. Run browser suites sequentially,
without another build writing their shared Next output directory.

```bash
pnpm install --frozen-lockfile
CI=true VITEST_MAX_WORKERS=1 pnpm check
pnpm audit --audit-level low
pnpm licenses:report
git diff --exit-code -- THIRD_PARTY_NOTICES.md
PLAYWRIGHT_PRODUCTION=true pnpm test:e2e
PLAYWRIGHT_PRODUCTION=true BETA_E2E_AUTHORING=true \
  BETA_E2E_ROUND_PROTOCOL=true BETA_E2E_SESSION_SUMMARIES=true \
  BETA_E2E_IDEA_BOARDS=true pnpm test:e2e:beta
pnpm readiness:check
pnpm research:check
```

Retain the required CI, PostgreSQL, browser, and security results described in
[repository governance](repository-governance.md). A valid readiness ledger can still contain
pending gates; `research:check` without an input validates the deliberately pending example.
Neither command supplies human acceptance. Schedule reviewers and prepare the private evidence
index now using the [existing records](../evidence/README.md), without copying private evidence
or secrets into the repository.

## Inputs needed before staging execution

| Decision                 | Required handoff                                                                                                                                                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EC2 target               | AWS region, instance type/resources, supported Linux baseline, storage, network/security groups, non-root deployment user and release-directory ownership, and approved SSH sources. Verify compatibility with the current `imagePlatform: linux/amd64`; do not select an Arm instance without a reviewed platform change. |
| DNS and SSH trust        | Real application/API and separate media domains, DNS ownership, certificate-monitoring owner, host/port, and the exact SSH host key obtained through an independently verified provisioning channel.                                                                                                                       |
| External services        | SMTP provider and dedicated sink, telemetry backend and observer adapters, host log shipping, page/warning/ticket receivers, named responders, support and incident contacts.                                                                                                                                              |
| Recovery and measurement | Separately administered encrypted off-host database/object backups, key custody, approved RPO/RTO, clean replacement EC2 host, private durable evidence archive, and an isolated load runner near the target VM.                                                                                                           |
| People and scope         | Operations owner, independent gate reviewers, second human write collaborator, research/accessibility/security/legal reviewers, exercise windows, launch populations/markets, and the exact enabled feature/workspace scope.                                                                                               |

Record non-secret target choices in `config/deploy/staging.json` and the reviewed exact key pin
in `config/deploy/ssh/staging_known_hosts`. Review and merge those changes before building.
Do not use an unverified `ssh-keyscan` result, accept a key on first connection, or disable strict
host checking. The following check is expected to fail until real target values and the pin are
committed in a clean checkout:

```bash
node scripts/check-deployment-target.mjs staging
```

The [governance rollout](repository-governance.md#current-rollout-state--2026-09-19) requires the
second human reviewer before activating the existing main ruleset, followed by a normally merged,
independently approved canary PR. An owner self-approval or bot does not replace that reviewer.

## Protected environment and secret handoff

- Create and protect `single-vm-staging` before dispatch: required reviewer, prevent self-review,
  and administrator bypass disabled. An automatically created empty environment is insufficient;
  both staging workflows check protection before privileged jobs.
- Fill every expected feature/region variable and the environment-scoped secrets listed in
  [staging readiness](staging-readiness.md#github-environment). Origins come from the checked-in
  target, not duplicated environment variables. Use dedicated synthetic accounts and observers.
- Keep runtime, SMTP/telemetry/paging, registry, deployment-key, and backup credentials in the
  approved secret store. Prepare separate ignored, regular, non-symlink mode-`0600` files at
  `artifacts/deploy/staging/runtime.env` and `migration.env` using the
  [deployment input rules](deployment.md#runtime-and-migration-environment-files). The long-lived application
  gets the restricted database role; only the one-shot migration receives the owner credential.
- Register the nearby isolated runner only after verifying its location and installed version.
  Apply the exact labels and minimum-version procedure in
  [target-VM load runner](staging-readiness.md#target-vm-load-runner); do not relabel an unsuitable
  runner to clear a queued job.
- Keep cookies, tokens, receiver URLs, private evidence, and raw participant records out of PRs,
  logs, and uploaded evidence. Revoke synthetic sessions after the exercise.

## Signed images and deployment

Use a clean checkout of the reviewed current `main` after the preparation and real target changes
are merged. Bind every run to its full commit; coordinate the exercise window so a new `main`
commit does not invalidate a waiting build or readiness run.

```bash
git fetch origin main
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
export CANDIDATE_BUILD_ID="$(git rev-parse HEAD)"
node scripts/check-deployment-target.mjs staging

gh api --method POST repos/riojung/pollingpops/dispatches --input - <<'JSON'
{"event_type":"staging-images"}
JSON
```

Approve the protected **Staging images** job only for that candidate. The workflow rechecks the
current main tip after approval, then builds, scans, signs, and verifies the images. If main has
advanced, select and validate the new candidate and repeat. Do not substitute a workstation build
or a ref-selectable workflow dispatch.

Set `STAGING_IMAGES_RUN_ID` to the successful run whose SHA equals `CANDIDATE_BUILD_ID`, then
download its manifest. Keep the matching server/web digests together. The deployment operator
needs the supported Cosign version from the deployment runbook.

```bash
gh run download "$STAGING_IMAGES_RUN_ID" --repo riojung/pollingpops \
  --name "single-vm-staging-manifest-${CANDIDATE_BUILD_ID}" \
  --dir "artifacts/deploy/staging/${CANDIDATE_BUILD_ID}"

./scripts/deploy.sh staging \
  --config config/deploy/staging.json \
  --manifest "artifacts/deploy/staging/${CANDIDATE_BUILD_ID}/build-manifest.json" \
  --runtime-env artifacts/deploy/staging/runtime.env \
  --migration-env artifacts/deploy/staging/migration.env \
  --confirm "staging:${CANDIDATE_BUILD_ID}" \
  --dry-run
```

Inspect the plan, then run the identical deploy command without `--dry-run` in the approved window.
Use the approved SSH agent or the documented `--ssh-identity` option. Verify TLS/redirects for both
origins, dependency readiness, server and web build markers, media scanning, and external telemetry.
Preserve the exact successful deployment receipt and signed manifest. Copy the receipt unchanged
to `OPENROUND_DEPLOYMENT_RECEIPT_JSON`; the operations owner and independent reviewer must reconcile
its checksum, manifest, image digests, and reviewed runtime-input hash with the probe output.

The first deployment is a bootstrap: keep workspace-gated features disabled and allowlists empty,
create the synthetic creator through normal sign-in, and follow
[synthetic capacity provisioning](staging-readiness.md#provision-the-synthetic-capacity-workspace)
to auditably grant its isolated workspace the required 250-participant capacity. Keep billing
disabled. Then make a second reviewed, signed build/config deployment with that workspace's
allowlists and feature ceilings. Merge a reviewed non-secret configuration change or deployment
change record to establish a new descendant `main` commit before repeating the candidate binding,
signed-image dispatch, manifest download, and deployment above. Updating ignored runtime inputs
alone does not change the build ID, and deployment rejects an already-active build ID. Retain both
build IDs and the matching private runtime-input records.
Do not edit an active release or redeploy the same build in place. Use the final candidate for
readiness and gate acceptance; capture its synthetic cookie only after confirming effective flags.

## Remote exercises and acceptance

1. Configure and verify encrypted off-host backups and the real observer/alert destinations.
   Dispatch remote probes and the fixed target-region matrix for the final deployed main candidate:

   ```bash
   gh api --method POST repos/riojung/pollingpops/dispatches --input - <<'JSON'
   {
     "event_type":"staging-readiness",
     "client_payload":{"run_stripe_replay":false,"soak_minutes":"0"}
   }
   JSON
   ```

2. Inspect the remote-probe artifact and all four 50/250-client Round/Presentation artifacts.
   After the matrix passes, repeat with `"soak_minutes":"15"`; use `"60"` for the release
   candidate only after the resource/window checks in the staging runbook. Retain target CPU,
   memory, disk, network, PostgreSQL/Valkey measurements, runner provenance, bundle checksums, and
   the durable archive reference in the [target-region record](../evidence/target-region-load.md).
   A zero-soak run is incomplete, and a passing soak still requires external evidence review.
3. Rehearse a timed restore onto the clean replacement host using
   [backup and restore](backup-restore.md). Validate the retained redacted records with
   `pnpm evidence:backup-restore:check -- <manifest.json> <receipt.json>`.
4. In the approved receiver-owner window, follow the
   [alert rehearsal](../evidence/README.md#repository-evidence-tools) and
   [operations record](../evidence/operations-rehearsal.md). Verify actual delivery, named responder
   acknowledgement, and the support incident drill; accepted API requests alone are insufficient.
5. Complete the existing device, accessibility, security, privacy/legal, design-partner, and
   usability records for the exact enabled scope and candidate. Schedule these reviews early;
   use the [evidence index](../evidence/README.md) and
   [Phase 0 campaign](phase0-evidence-campaign.md). Any billing rehearsal uses the separately
   approved test configuration and real provider flow; the optional local webhook replay does not
   complete that gate.

Keep templates pending until the gate owner and independent reviewer accept actual retained
evidence. Bind accepted records to the same exercised candidate and record UTC times, stable
redacted manifest references, and checksums as required by
[gate acceptance](../evidence/gate-acceptance.md). Source/configuration changes require review and
re-exercise of affected evidence. Follow that document's ledger-only descendant rule for the
later release commit rather than relabelling staging artifacts.

Run `pnpm readiness:check` as records are indexed. `pnpm readiness:require:beta:preflight` remains
blocked until its canonical gates pass; the signed-release procedure and
`pnpm readiness:require:beta` follow afterward. Preparation and local checks do not authorize an
external beta or change the canonical release gates.
