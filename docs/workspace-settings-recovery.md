# Workspace settings initialization and recovery

Selected checkpoint: **WX-11C**, November 20, 2026.
Baseline: merged Results WX-11B, [PR #292](https://github.com/riojung/pollingpops/pull/292), `6e85bcf`.
Branch: `codex/workspace-settings-recovery`.
Owner: frontend and accessibility.

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

All current required reads gate the page. An unavailable member or integration read therefore
withholds the remaining settings until recovery. Independent subsection availability/retry is a
separate follow-up, not a capability delivered by this increment.

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

## Remaining work

Library pagination/reset focus is the next ready surface checkpoint. Independent settings-section
recovery and capability/plan explanations remain pending. The current entitlement/feature booleans
support effective availability, but not every underlying cause. Neutral unavailable copy can be
corrected independently; precise plan/operator/rollout/provider explanations need an authoritative
reason projection. No cause taxonomy, pricing change or new paid gate is added here.

Survey C3/C4 reporting and B3 authoring remain pending the recorded privacy acceptance. See the
[overall delivery backlog](workspace-experience-backlog-2026-11.md).
