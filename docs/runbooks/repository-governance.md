# Repository governance and release controls

Apply these controls to `main` after the workflow changes that define the checks are merged. GitHub
settings are external state; this file is the required configuration and audit checklist, not
evidence that the rules are active.

## Current rollout state — 2026-09-19

The repository has a [disabled validation ruleset](https://github.com/riojung/pollingpops/rules/23705684)
with the exact checks and pull-request-only owner break-glass path below. Secret scanning, push
protection, Dependabot alerts/security updates, and private vulnerability reporting are enabled.
The ruleset must remain disabled until a second human collaborator with write access accepts the
review responsibility; otherwise every owner-authored change would require a bypass and the
independent-review policy would be nominal rather than effective.

After the reviewer is present and candidate CI is green, activate the existing ruleset, open a
documentation-only canary PR, obtain that reviewer’s approval, pass every required check, resolve
every conversation, update the branch, and merge normally without bypass. Record the resulting
ruleset insight in the
[repository governance canary record](../evidence/repository-governance-canary.md) before marking
the release gate complete.

## Main branch ruleset

- Require a pull request and at least one approving review from someone other than the author.
- Dismiss stale approvals when new commits are pushed and require all conversations to resolve.
- Require branches to be current before merge.
- Require these pull-request checks:
  - `check`
  - `postgres-migration`
  - `browser-smoke`
  - `dependency-review`
  - `dependency-and-secret-review`
  - `sbom`
  - `codeql`

  GitHub’s UI qualifies these with the workflow name, while the ruleset API requires the bare job
  contexts above and the GitHub Actions integration ID `15368`.

- Block force pushes and branch deletion. On this personal repository, restrict bypass to the
  named owner user in `pull_request` mode; do not grant the entire administrator role. If the
  repository moves to an organization, replace that user with an audited break-glass maintainer
  group. Review every bypass after the incident.
- Enable secret scanning, push protection, private vulnerability reporting, and Dependabot alerts.
- Prefer merge commits or squash merges consistently; never publish a release from an unreviewed
  branch tip.

## CI cost and failure handling

Keep the seven required contexts above stable; do not use workflow-level path filters that leave
them pending or remove checks to hide failures. CI and Security cancel superseded pull-request
runs, but retain main-push runs used by the signed-release acceptance policy.

The Ubuntu 26 canary keeps only its distinct production Compose and image-toolchain jobs on
runner-sensitive PRs and weekly/manual runs. Format/build/unit, PostgreSQL, and browser checks run
once in primary CI on the same runner. Source SBOM generation remains a short required check;
digest-bound release image SBOMs cover different artifacts and must not be removed.

CodeQL scans the checked-in JavaScript/TypeScript sources with `build-mode: none`; a second full
application install/build is unnecessary for this interpreted-language scan. See GitHub's
[build-mode documentation](https://github.com/github/codeql-action/blob/2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2/init/action.yml).
The primary CI job still validates the production build. Feature-off and administration browser
suites run once in the core browser job. Each of the four beta profiles runs on its own runner,
with its own seeded workspace, application processes, production build, and failure artifacts.
Beta remains serial within each runner because its seeded workspace includes shared mutable
settings and evidence. The required `browser-smoke` context waits for core and every beta profile
and fails unless all succeed, including when a dependency is skipped or cancelled. Feature-off
and beta runs serve standalone production output, including public/static assets, rather than
paying on-demand development compilation during every journey.
Browser reports and first-failure traces/screenshots are retained for 14 days even when a retry
passes; CI video is recorded on the first retry. A passing job must not discard the evidence
needed to diagnose a flaky case.

For a red run, inspect the failed job and annotations before retrying:

```bash
gh pr checks
gh run view <run-id> --log-failed
pnpm install --frozen-lockfile
pnpm audit --audit-level low
pnpm licenses:report
git diff --exit-code -- THIRD_PARTY_NOTICES.md
```

An advisory requires the smallest patched dependency update, a reviewed lockfile/notices change,
and a clean audit; never lower the threshold or suppress it just to pass. Notices and gitleaks run
independently after an audit failure so one finding cannot hide another. A GitHub annotation that a
hosted runner could not acquire the job is an infrastructure failure, not evidence of a product
defect; a bounded `gh run rerun <run-id> --failed` is appropriate after verifying that cause.
Browser failures require inspecting retained traces and fixing the underlying interaction or
fixture isolation, not increasing timeouts or broadly retrying every step. Hosted timings are not
capacity evidence and runner availability cannot be guaranteed by repository changes.

To reproduce the browser mode used by CI locally, run these sequentially (both use the same Next
output directory):

```bash
PLAYWRIGHT_PRODUCTION=true pnpm test:e2e
PLAYWRIGHT_PRODUCTION=true BETA_E2E_AUTHORING=true BETA_E2E_ROUND_PROTOCOL=true \
  BETA_E2E_SESSION_SUMMARIES=true BETA_E2E_IDEA_BOARDS=true pnpm test:e2e:beta
```

Omit `PLAYWRIGHT_PRODUCTION=true` to keep the normal local development server. Do not run a build
or another browser suite against that output directory while a suite is serving it. Full local
tests also require all three installed browser engines; an engine that cannot launch locally is
not a passing test.

## Release-tag ruleset specifications

Release authority and immutability use two independent rulesets. The creation ruleset
[`../../.github/rulesets/release-tags.json`](../../.github/rulesets/release-tags.json) grants an
`always` bypass only to the named release owner so that person can create a new `v*` tag. The
immutability ruleset
[`../../.github/rulesets/release-tag-immutability.json`](../../.github/rulesets/release-tag-immutability.json)
blocks every update, deletion, and non-fast-forward change with **no bypass actors**. Never combine
these rules: a creation bypass on the immutability ruleset would let the release actor rewrite or
delete a published tag before any workflow could reject the event.

Both request bodies are committed with `enforcement: disabled` and are not proof that live rules
exist. Before applying them, confirm the current bodies and repository owner, then create both
disabled rules:

```bash
jq -e '
  .target == "tag" and
  .enforcement == "disabled" and
  .conditions.ref_name.include == ["refs/tags/v*"] and
  [.rules[].type] == ["creation"] and
  .bypass_actors == [{
    "actor_id": 1459373,
    "actor_type": "User",
    "bypass_mode": "always"
  }]
' .github/rulesets/release-tags.json
test "$(gh api users/riojung --jq .id)" = \
  "$(jq -r '.bypass_actors[0].actor_id' .github/rulesets/release-tags.json)"
gh api --method POST repos/riojung/pollingpops/rulesets \
  --input .github/rulesets/release-tags.json

jq -e '
  .target == "tag" and
  .enforcement == "disabled" and
  .conditions.ref_name.include == ["refs/tags/v*"] and
  ([.rules[].type] | sort) == ["deletion", "non_fast_forward", "update"] and
  ([.rules[] | select(.type == "update") | .parameters] == [{
    "update_allows_fetch_and_merge": false
  }]) and
  .bypass_actors == []
' .github/rulesets/release-tag-immutability.json
gh api --method POST repos/riojung/pollingpops/rulesets \
  --input .github/rulesets/release-tag-immutability.json
```

Do not run either POST command from automation and do not enable the created rules until both
returned URLs and bodies have been independently reviewed. Tag creation cannot use a
pull-request-only bypass, so the creation specification grants `always` bypass to the single named
owner user, `riojung` (GitHub actor ID `1459373`), and never to a repository role. Only that named
owner may create a `v*` tag while the creation rule is active. The immutability specification has
no bypass at all, including for the owner, repository administrators, apps, or deploy keys; an
existing matching tag therefore cannot be moved or deleted through the normal repository API.
Recovery uses a new reviewed commit and version tag, never mutation of the old tag. The release
workflow independently checks the initial tag-creation event's immutable sender ID against the
creation specification, but that workflow is defense in depth rather than the immutability
boundary.

## Release controls

1. Confirm `pnpm readiness:require:beta:preflight` succeeds against reviewed evidence. This target
   includes every single-VM beta gate except the signed-release artifact that the tag will create.
   Every reviewed gate must name one exercised commit, and the release preflight permits the tag
   commit to differ from it only by `docs/release-readiness.json`.
2. Confirm the latest `CI`, `Security`, and `Production-path smoke` runs match the candidate
   commit. The release preflight looks up successful runs for the exact tagged commit and rejects
   stale ledger links; retain target-region readiness separately with the deployment evidence.
3. Create a signed, protected, `v`-prefixed semantic-version tag from `main`. Do not add `+build`
   metadata because the release policy accepts semantic-version tag identities only; images receive
   the commit-derived `production-<full-commit>` tag and are promoted by immutable digest.
4. Let the release workflow build images, provenance, SBOMs, and scan results. After those checks,
   signature verification, and manifest retention succeed, it creates a **draft**
   GitHub Release with the bounded evidence set, source archive, and checksum inventory. The
   workflow never publishes, refreshes, or overwrites that release. A partial draft must be
   reviewed and removed manually before retrying; corrected evidence requires a new tag. Do not
   retag or use `latest` in production.
5. Verify signatures and digests before promotion; retain the workflow URL and digest in the
   [signed release candidate record](../evidence/signed-release-candidate.md).
6. Review the draft and independently verify its manifest digest, image digests, SBOM, SARIF,
   provenance, source checksum, and successful Cosign
   verification are retained, open and independently review an evidence-only PR. Its complete tree
   delta from the tagged commit must be only `docs/release-readiness.json`; within that ledger it
   may update only `updatedAt` and move `signed-release` from pending to complete with stable HTTPS
   evidence and the exact tag object, tagged build commit, manifest SHA-256, and server/web image
   digests in `releaseBinding`. Merge it without bypass, then run `pnpm readiness:require:beta` for
   the final decision. Keep the release in draft state for deployment; publication is not a
   workflow side effect.
7. Deploy the exact downloaded manifest from that evidence-only descendant. The deployer verifies
   the descendant and binding, fetches the protected `origin/main` and exact tag, and requires the
   operations `HEAD` to equal that fetched main tip. It also requires GitHub to report a valid
   signature for the exact bound annotated tag object and confirms that object's name and target.
   A local, unsigned, recreated, or substituted tag cannot satisfy this gate. Cosign must also match
   the exact release-workflow certificate identity for the bound tag, not merely another semver
   release tag. The exact-source rule remains in force for every ordinary deployment. Follow the
   upgrade canary and rollback runbook while the release remains a draft.
8. After the exact deployment and post-deploy verification succeed, a named maintainer may publish
   the unchanged draft manually. Record the publication actor/time in the signed-release evidence.
   A failed gate requires a new reviewed commit and tag rather than rewriting an existing release.

## Audit record

Record the ruleset URL, activation date, maintainer group, required checks, secret-scanning state,
last bypass review, and next quarterly review in the private operations system. Link that record
from the [repository governance canary record](../evidence/repository-governance-canary.md) and the
`repository-governance` gate in `docs/release-readiness.json`.
