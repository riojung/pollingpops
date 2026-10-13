# Polling Pops documentation

Polling Pops is a pre-release, independently branded comprehension recovery system for higher
education and workplace learning. Use this index to choose the shortest path for your role.

## Start here

The public name is now Polling Pops. The [brand and interface guide](brand.md) includes
the new logo assets, palette, Candy Pop preset, and the technical names kept for compatibility.

| I want to…                                                   | Read                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Get guidance that matches my enabled workspace               | Sign in and open the in-product `/help` page                                                 |
| Run Polling Pops locally and complete a first round          | [Quick start](quick-start.md)                                                                |
| Create, host, join, recover, and review understanding        | [User guide](user-guide.md)                                                                  |
| Position and resize Presentation text, or use layout guides  | [Slide arrangement guide](user-guide.md#arrange-text-on-a-presentation-slide)                |
| Permanently remove archived work or retained session history | [Deletion guide](user-guide.md#delete-archived-content-and-session-history)                  |
| Understand product behavior and interaction choices          | [Product and experience design](design.md)                                                   |
| Review current market evidence and the gated roadmap         | [2026 market research and development plan](market-research-and-development-plan-2026-09.md) |
| Review the 2026 Kahoot-alternatives UX benchmark and plan    | [Kahoot-alternatives UX gap plan](kahoot-alternatives-2026-ux-gap-plan.md)                   |
| Review the competitive position and post-P0 roadmap          | [Competitive strategy and roadmap](competitive-strategy-and-roadmap.md)                      |
| Understand services, state, storage, and trust boundaries    | [Architecture and protocol](architecture.md)                                                 |
| Integrate with REST or realtime interfaces                   | [API and realtime reference](api.md)                                                         |
| Configure a gated institution pilot                          | [Institution integration guide](institution-integrations.md)                                 |

## Build and operate

- [Hosted business management](business-management.md) covers organization billing, workspace
  licenses, event credits, the operator console, dedicated jobs, and commercial launch gates.
- [Local operations quick guide](quick-start.md#day-to-day-commands) covers routine profile-aware
  restarts, logs, data-preserving stops, and the boundary between cleanup and an intentional reset.
- [Implementation status](implementation-status.md) describes what is implemented and what remains a release gate.
- [Recent contract and deletion upgrades](runbooks/upgrade.md#recent-content-report-and-deletion-upgrades)
  cover Presentation v2, Report V4, migration 048, and compatible rollback targets.
- [Release readiness ledger](release-readiness.json) is the machine-validated source of truth for
  single-VM beta and GA promotion gates; [evidence templates](evidence/README.md) cover human and
  provider verification.
- [Evidence command reference](evidence/README.md#repository-evidence-tools) lists the synthetic
  alert rehearsal, target-load bundler, backup/restore validator, research aggregate evaluator, and
  release-ledger checks. These tools validate structure and binding; they do not authenticate an
  external record or complete a gate.
- [Phase 0 evidence campaign](runbooks/phase0-evidence-campaign.md) sequences the interviews,
  observed sessions, usability study, independent review, and Phase 1 branch decision.
- [Production readiness](runbooks/production-readiness.md) is the promotion checklist for a public environment.
- [Build, service, and deployment](runbooks/deployment.md) is the command reference for product
  images, local service lifecycle, safe Docker cleanup and rebuilds, and digest-pinned remote
  single-VM promotion.
- [Single-VM staging readiness](runbooks/staging-readiness.md),
  [repository rename compatibility](runbooks/repository-rename.md),
  [Ubuntu 26 runner migration](runbooks/ubuntu-26-runner-migration.md),
  [repository governance](runbooks/repository-governance.md),
  [backup and restore](runbooks/backup-restore.md), [upgrade](runbooks/upgrade.md),
  [audience interaction moderation](runbooks/audience-moderation.md),
  [incident response](runbooks/incident-response.md), and
  [observability](runbooks/observability.md) cover release and routine operations.
- [Free-pilot Cloud Run guidance](../infra/cloudrun/README.md) is a separate pilot reference. The
  [Fly profile](../infra/fly/README.md) is legacy/reference material, not an active target.
- [Privacy data map](privacy-data-map.md) identifies stored data, purpose, and retention behavior.
- [Institution integrations](institution-integrations.md) documents creator OIDC, instructor LTI,
  audit export, residency evidence, and the capabilities that remain deliberately disabled.
- [Asset register](asset-register.md) records the origin and licensing of bundled product assets.
- [Creator authentication ADR](decisions/001-creator-authentication.md) records the deliberate P0
  choice and migration triggers.

## Release boundary

Development uses the local Compose stack. Staging and production use a remote single-VM Compose
profile with digest-pinned images and separate runtime and migration credentials. This topology
has one failure domain and provides no high availability or SLA. It remains blocked for public
production until TLS, strict SSH host-key pinning, encrypted off-host backups, a clean
replacement-VM restore drill, target-host capacity evidence, and all other readiness gates pass.
The repository and deployment scripts do not establish that any environment has been provisioned
or deployed, nor do they establish legal approval, school-contract readiness, external security
assurance, or production capacity.

The signed-in `/help` page is available in the default Compose profile and adapts its written
steps and destinations to the active rollout. Its two captioned professional-builder videos are
shown only when the workspace shell, Round Builder v2, Presentations, Groups, Discover, and
practice assignments are all enabled for that allowlisted workspace.
