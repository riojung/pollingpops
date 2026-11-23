# Workspace settings initialization and recovery

Selected checkpoint: **WX-11C**, November 20, 2026.
Baseline: merged Results WX-11B, [PR #292](https://github.com/riojung/pollingpops/pull/292), `6e85bcf`.
Branch: `codex/workspace-settings-recovery`.
Owner: frontend and accessibility.
Merged through [PR #293](https://github.com/riojung/pollingpops/pull/293) at `223095c`.

## Selected behavior

The account route has an explicit loading, unavailable and ready boundary. Account-dependent
navigation and controls render only after all currently required settings reads succeed. The
page commits their results together instead of presenting default personal-account values,
empty membership or absent institution setup after a failed request.

- Read `/v1/auth/me` as the authority before requesting dependent settings. Preserve owner-only
  reads and the organization user-license exclusion for workspace-member administration.
- If that authority returns 401, check the existing `/v1/auth/user` fallback. A confirmed signed-in
  identity retains the personal-account view. Confirmed unauthenticated status retains the
  existing sign-in destination, including pathname, query and hash.
- Peripheral settings failures and transient authority errors remain recoverable read failures;
  they do not establish a billing-only account or an unauthenticated identity.
- **Try again** repeats GET initialization only. Abort and generation checks reject obsolete
  completions after retry or unmount. Requests do not replay invitations, member changes,
  identity unlinking, billing, exports, account deletion or any other mutation.
- A named busy loading region retains retry focus while pending. On success, the selected
  settings panel receives focus if recovery still owns it; deliberately moved focus is respected.
  Hash selection and the existing workspace-shell, legacy and personal-account modes remain.

This is a client initialization boundary. Server authorization continues to govern every read
and mutation. Existing permission helpers, billing-status recovery, payment destinations,
destructive confirmations and loaded settings forms remain unchanged.

At WX-11C, all settings reads gated the page. The independent section recovery below changes
the behavior for member and LTI registration reads.

## Copy and experience acceptance

Reuse existing loading/retry copy and interface tokens. One new unavailable heading is provided
in all ten account catalogs; automated key/placeholder checks do not constitute human
native-language acceptance. The heading makes no plan, permission, provider or rollout diagnosis.

Verify pending/core/owner failures, GET-only retry, trusted initialization, stale completion
rejection and authentication fallback. Check keyboard focus, retained hash selection, 320px
layout, light/dark/forced colors and scoped axe. Human assistive-technology and physical-device
acceptance remain separate.

## Local verification — November 20, 2026

- `VITEST_MAX_WORKERS=1 pnpm check` passed formatting, Docker dependency checks, lint, type checks,
  all repository test suites, four application builds and compiled server startup. The suites include
  6,470 web, 1,140 contracts, 1,672 server, 666 default-database and 529 support tests. Existing optional
  integration skips remain.
- Focused account loading, page, role/license, permission, navigation and billing-related checks
  passed 67 tests across eight files.
- The production `account-recovery.spec.ts` regression passed six cases across desktop Chromium,
  320px mobile Chromium and mobile WebKit. It exercises held/core/owner failures, GET-only retry,
  selected hash/query preservation, focus handoff and cancellation after deliberate focus movement,
  legacy layout and signed-in personal-account fallback. Scoped axe and reflow checks passed;
  loading/error/ready screenshots were inspected, including light, dark and Chromium forced colors.
- The existing Free-personal `customer-settings.spec.ts` case passed against the business fixture:
  trusted workspace initialization, rename/reload, selectable categories, keyboard navigation,
  embed-origin persistence, deletion confirmation and desktop/320px light/dark accessibility.
  It also verifies local appearance exploration sends no branding write and that saving remains
  disabled for this fixture's false branding entitlement.
- An independent read-only review of tracked and untracked changes found no actionable issue.

The first full check ran alongside a production browser build and failed five existing process-startup
or deadline support checks. The complete isolated rerun passed with unchanged test deadlines. The
browser fixture was also corrected to use a mounted legacy navigation link for its moved-focus
scenario; all six final production cases then passed. The Free-personal test's outdated theme-control
expectations were aligned with the existing gallery's local-preview and gated-save behavior; the
gallery implementation and grants were not changed. These automated checks do not supply human
privacy, assistive-technology, native-language or physical-device acceptance.

## Independent section recovery

WX-11F merged through PR #296 at `68b8716`. The account authority and required settings reads
still form the initial load.
Member and LTI registration reads start separately for eligible owners once it succeeds.
The People panel distinguishes pending or unavailable data from a list that loaded successfully.
The institution area shows an empty LTI registration notice only after the registration read
succeeds with no registrations. A failure in either section leaves the rest of Settings usable.

Each section's **Try again** repeats its read and keeps keyboard focus on that section when
activated from the focused button. After a successful member or invitation change, a failed list
refresh offers the same read retry. This lets users recover the current list without submitting the
change again. A successful invite's local link remains available during list recovery. Workspace
and session transitions invalidate pending reads and stale responses. The required theme,
embed-origin, institution-policy and linked-identity reads, owner-section operations and related Settings actions
carry the expected workspace ID. The loader also checks the active workspace returned by the
workspace list before presenting the snapshot. If the session switches workspaces during loading,
the settings stay hidden until Retry reads the current workspace. If a rename, idle-policy, theme,
embed, identity removal or audit export request detects a workspace change, Settings discards the
stale view. A workspace conflict during a People or LTI read also opens page-level recovery and
cancels pending reads for the old workspace. Focus moves to recovery when Settings previously held
it. Retry only reloads Settings.
The query parameter is optional for existing clients. See the [API reference](api.md).

The section messages use ten locale catalogs. Focused verification passed 94 account, 39 API and
19 locale tests. Ten production browser cases passed across desktop Chromium, mobile Chromium and
mobile WebKit. They cover pending, unavailable and recovered sections, continued use of billing,
privacy confirmation and unrelated Security controls, GET-only retries, keyboard focus, reflow and
automated accessibility in light, dark and forced-color appearances. The cross-tab case exercises a
switch to an editor workspace during the required reads, before a stale rename, and during an
independent People read. It checks the conflict, focus and retry without replaying stale requests.
Server tests exercise all 16 guarded methods and check matching-workspace permissions. The business
browser check verifies successful renaming and embed-origin saves in the current workspace and
accessible landmarks in People.

The full `VITEST_MAX_WORKERS=1 pnpm check` passed, including 6,505 web tests, 1,676 server tests,
529 support tests, four application builds and compiled server startup. Optional PostgreSQL suites
were skipped in this run. Automated checks cover locale parity and browser accessibility.
Native-language and manual accessibility review remain open.

## Remaining work

Library pagination and reset focus merged as WX-11D in PR #294. See the
[scope and acceptance record](library-recovery-focus.md). WX-11E availability copy merged in
PR #295. Checkpoint-set import availability copy merged in PR #297 and import reasons merged in
PR #298. Live-brand save reasons merged in PR #299 and workspace CSV export reasons merged in
PR #300. Retained Round report export reasons merged in PR #301 and live Presentation launch
reasons merged in PR #302. Source upload availability merged in PR #303. LTI availability
explanations merged in PR #304, checkpoint-set export reasons in PR #305, and visual import
explanations in PR #306. The Presentation navigator resize landmark fix merged in PR #307. Board
creation feature-policy explanations merged in PR #308. Board launch explanations for operational
pauses and inactive organizations or workspaces are implemented locally. Round staff availability
remains pending.

Survey C3/C4 reporting and B3 authoring remain pending the recorded privacy acceptance. See the
[overall delivery backlog](workspace-experience-backlog-2026-11.md).
