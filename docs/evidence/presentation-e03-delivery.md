# Presentation E03 desktop delivery

Date: November 4, 2026. Branch: `codex/presentation-e03-delivery`.
Base: `5d57f3a2b564db302f33c6c3af5f29c77ffde597`, the merged
[E02 PR](https://github.com/riojung/pollingpops/pull/193).

The desktop E03 software scope is implemented and automated verification passed. This record
distinguishes executed automated checks from outstanding human and operational qualifications.
There is no paid SDK, model/rendering service, video service, new entitlement or document-format
upgrade. A separate stage credential role requires migration 090 and coordinated reader rollout.

## Creator behavior

- The presenter workspace separates current slide, private read-only speaker notes and next-slide
  preview. Cues and authorized preview media come from the immutable session version, skipping
  hidden planning slides and ignoring later draft/publication changes.
- An explicit local Start/Pause/Reset timer persists elapsed state in tab storage when available.
  Background time is measured from the clock rather than interval counts. It does not change
  session time, response deadlines or command state.
- Right Arrow, Page Down and Space advance the existing phase action. Native controls, editing,
  scrollable data, modifiers, repeats, composition and open dialogs retain their keyboard input.
  Disconnected/pending/busy states retain the existing receipt/revision fences.
- The audience stage is a separate window/tab with the current public content, phase-fenced
  answer reveal, persistent join code/address/QR, and optional full screen. A visible direct link
  recovers a blocked popup. A denied full-screen request leaves the stage usable.
- Stage refresh retains its scoped pass when storage is available. Lost connectivity labels the
  last confirmed slide; terminal credential rejection clears both content and the in-memory pass.
  Per-session component keys prevent old-session content from rendering during navigation.

## Authority and compatibility

Stage credentials are distinct from host, participant and Companion credentials. Mint/revoke
requires an eligible owner/editor creator cookie. Mint replaces stage credentials only; expiry is
capped at one hour and session expiry. Existing host control-pass creation still rotates host
credentials, and Companion behavior is unchanged. Creator-cookie authority remains independent
of a stage pass; a stage credential alone grants no editing or facilitation authority.

Stage snapshot/media routes require a stage Bearer pass, enforce current-block media scope,
return no-store responses and never fall back to creator cookies. The stage browser sends
`credentials:"omit"` and polls sequentially every two seconds, with request cancellation,
revision/sequence fences and bounded rate-limit delay. It does not open a control socket or
create a fake participant. Launch passes travel in a fragment, are removed before networking,
and remain only in the receiving tab's storage/in-memory state.

Strict public projections omit private notes, future slides, participant records, citations,
source disclosure, moderation and unrevealed answers. Generic audience/Q&A authentication
explicitly accepts only host/Companion facilitator roles; stage rows are excluded in both memory
and PostgreSQL. Audience/Companion realtime unions do not gain the stage role.

Migration `090_presentation_stage_credentials.sql` extends the credential role CHECK only.
Stored decks, hashes, command receipts and old credentials retain their representation.
Migration alone does not make a mixed reader pool safe: keep stage mint closed until every
server/jobs/web reader enforces the new role. An older Q&A reader could mistake that role for
facilitator authority. See the [rollout and rollback requirements](../runbooks/upgrade.md#presentation-stage-credential-compatibility).

## Verification

Full `pnpm check` passed, including repository formatting, Docker-context dependency checks,
lint, type checking, unit/integration tests, production builds and the admin build/help check.
Final-source local log: `/tmp/pollingpops-e03-check-viewport.log`. The principal affected suites reported:

| Suite     | Passed | Default-run skips |
| --------- | -----: | ----------------: |
| Contracts |    615 |                 0 |
| Web       |  2,301 |                 0 |
| Server    |  1,059 |                15 |
| DB        |    507 |               343 |
| Support   |    354 |                 1 |

These default DB skips are separate from the live PostgreSQL execution below. Other repository
suites also passed as part of the full command. Focused checks overlap these totals:

- Timer/keyboard utilities: 47 tests, scoped lint/format and web typecheck passed.
- Stage launch helper: 14 tests passed, covering fragment removal, bounds, per-session storage,
  malformed/replaced passes, denied storage and stale rejection.
- Backend contracts, API, service, projection and DB checks: 126 targeted tests passed before
  adapting the legacy native-scene assertions for newly private host notes.
- PostgreSQL 17: all 90 migrations applied and checksum-verified twice. The runtime principal was
  `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEROLE`, `NOCREATEDB`, with the expected runtime membership
  and forced credential-table RLS. Stage/Q&A and v7/v8 conformance passed: **3 passed, 122 filtered
  skips**. Its unique tmpfs container and SSH forward were removed and verified absent; all
  preexisting application container IDs, running/start states and data were retained. Local
  evidence: `/tmp/pollingpops-e03-pg-prepare-20261104/result-22eabba3d4.json`.
- Independent read-only review found no actionable issue across stage role isolation, projections,
  media, credentials, command fences and the new web surfaces. A focused utility review identified
  a transient old-session render and a denied-storage StrictMode launch edge. Per-session keys
  and retaining the initially captured pass in a ref corrected these before browser validation.

The initial repository check failed five native-scene assertions that prohibited any private
string in a host snapshot. E03 intentionally adds host-only notes. The revised test allows only
the exact `presenter.speakerNotes` value; every remaining host field, including `nextBlock`, and
the complete participant/Companion projections retain the privacy checks. That file passed 9/9.
Two unrelated five-second test timeouts in the initial parallel run passed in an unchanged,
quiet 21-test rerun. The subsequent complete repository command passed without timeout changes.

The first four-case Chromium run stopped in setup because its hidden-slide fixture used an older
document version. It now explicitly uses v6. The next invocation passed two workflows and found
two test selectors matching Next's route announcer as well as the intended alert. Scoping those
selectors to the stage main retained the alert assertions; both affected workflows then passed.
All four Chromium workflows have passing observations across these runs. No production validation
rule was relaxed.

The production sixty-case, nine-file matrix then passed **60/60**, with zero failures or skips in
8.8 minutes: sixteen cases each in desktop Chromium/Firefox and fourteen each in emulated mobile
Chromium/WebKit. It covers delivery, information components, content-only decks, Companion,
published questions, Quick Checks, Recovery Packs and Q&A. Local log:
`/tmp/pollingpops-e03-browser-matrix.log`.

Visual review found an additional viewport defect: the desktop join panel was below the fold
despite its DOM visibility assertion. The stage now fits native 16:9 content inside the available
canvas, gives dense content a labelled keyboard-scroll region and retains a compact sticky-header
join code for short windows. Its join panel uses the remaining viewport space. The revised browser
fixture explicitly sizes stage popups to each profile; earlier emulated mobile popups inherited
the requested desktop popup width.

After that stage-only change, the complete repository check passed again and a final production
rerun passed **8/8**, with zero failures/skips in 1.9 minutes: public delivery/privacy and popup,
fullscreen-denial, disconnect and expiry flows in all four profiles. Whole join-panel and QR
intersection ratios were one at actual 1280×720 desktop and 390×844 mobile CSS viewports; Axe
checks passed. Sampled desktop and mobile host/stage captures were legible without clipping.
The final stage captures measure 1280×720 and 1170×2532 (mobile DPR 3). Local log:
`/tmp/pollingpops-e03-browser-viewport-final.log`. The original full matrix was not repeated after
the layout-only correction; this record distinguishes that matrix from the final focused checks.
Independent review also cleared the focused layout change.

Firefox used task-owned `CFFIXED_USER_HOME`/`TMPDIR` to avoid the existing macOS application-data
boundary, as in the [reported Playwright issue](https://github.com/microsoft/playwright/issues/42768).
The exact owned directory contained no symlinks. macOS deny-delete ACLs were cleared only there,
then the directory was removed and verified absent. Actual `HOME`, personal browser profiles and
permissions on personal directories were unchanged.

The merged E02 PR's late WebKit CI found insufficient contrast on existing **Open map** and
**Close preview** buttons during the new information-preview test. Both buttons now use the
existing themed button rule. The Axe assertion is unchanged, and the original WebKit regression
passed in the full E03 matrix. This is separate from the earlier passing local E02 runs.

## Local application

The local application at [localhost:8080](http://localhost:8080) was rebuilt and its web/API/jobs
services were updated together after the final browser pass. All three build identifiers match
`5d57f3a2b564db302f33c6c3af5f29c77ffde597-dirty-f7b419cbcfeb`; the suffix fingerprints the actual
uncommitted application sources. API liveness/readiness and web sign-in returned HTTP 200, the
web build header matches, and the deployed chunks contain the E03 controls.

Startup applied migration 090 using the existing migration configuration. Runtime inspection
verified the exact ninety-row name/checksum ledger, the stage role CHECK and every prior
migration row. Settings and mounts were retained. All eleven other containers (nine running,
two previously exited initialization containers) and the control service were unchanged.
Live Presentation creation remains disabled by the existing local feature flag; the isolated
browser environment explicitly enables it for testing. This is a local reader update, not a
hosted deployment or a claim that local live creation was enabled.

Two updater attempts stopped before any service mutation: an outer log redirect conflicted with
the updater's exclusive log creation, and Docker returned identical Grafana mount entries in a
different order. The invocation was corrected and the comparator now sorts container names and
mount destinations while retaining every value check. The subsequent coordinated update passed.
Local result: `/tmp/pollingpops-e03-local-update-result.json`; private build log:
`/tmp/pollingpops-e03-local-update.log`.

## Qualification boundary

Automated browser profiles, controlled popup/full-screen rejection and injected disconnect/expiry
cases are software checks. They do not establish actual video-conferencing screen sharing,
managed-browser policy acceptance, manual assistive-technology behavior, physical device support,
native browser zoom, production capacity/cost or hosted rollout success. Those gates remain open.
The richer phone remote remains optional follow-up work; the existing scoped Companion is retained.
