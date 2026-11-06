# Presentation E11 private review feedback

Implementation branch: `codex/presentation-e11-review`, from merged E10 baseline
`e7afd6f33da82bf6c672f970345563d004d72f8d` (PR #202). This is the first E11 review slice;
concurrent authoring remains separate. The selected software slice is implemented and verified
on this branch and remains undeployed.

## Scope and authority

An owner/editor explicitly enables comments for an existing private review link. Its immutable
published version remains the source. Existing links stay view-only by default, and the E08
share, access and ReviewV1 response formats retain their meanings. Anonymous recipients can
continue viewing; commenting requires the existing free account sign-in plus the active link.
It does not invite reviewers into the creator's workspace or allocate a paid creator seat.

Feedback consists of page-anchored, plain-text threads and replies. Reviewers can edit or erase
their own messages. Current source-workspace owners/editors can reply, resolve/reopen and approve
that link's review of the pinned version. Approval does not publish, edit the draft, approve
another link or carry into a later publication. It requires an exact feedback sequence and no
open threads. Later feedback makes the earlier sign-off stale until explicit reapproval.

Each completed mutation has an operation UUID and immutable request hash; thread versions and
approval sequences fence conflicts. Accepted retries recover the same compact receipt and return
freshly authorized state rather than old message bodies. A per-link opaque `viewerKey` binds
submitted intents to the authenticated account, preventing replay under a different sign-in.
Uncertain acknowledgements retain the original operation and page/version anchor for retry.
Enabling is a one-time transition per link. Once a cycle exists, new enable operations are
rejected without consuming receipts or changing feedback; exact retries of the original enable
receipt still return the current authorized review, including at the receipt limit.
Returning to the tab preserves unsubmitted replies and edits while the same source revalidates,
including delayed or transient reads. Changed credentials, source versions, revoked/expired
access and account changes clear discussion drafts. Resolved threads explain that an author
must reopen the thread before replying.

Recipients see server-assigned `Reviewer N` labels and an `Author` role, with ownership derived
from the current request. Account IDs and emails stay outside the feedback DTO. Merely reading a
link does not allocate a reviewer identity, create a learner attempt or record view completion.
The existing recipient-safe content/media projections continue excluding speaker notes, hidden
planning pages, source evidence, private assessment fields and live participant data.

## Persistence, bounds and lifecycle

Migration099 adds review cycles, threads, messages and compact receipts beside the existing
share. It does not change document14, scene6, immutable publication bytes, ReportV1–V7 or live
response/window semantics. No dependency, paid provider, model call or hosted service is added.

Each cycle permits at most 100 threads, 20 messages per thread, 500 retained messages, 2,000
characters per message, 512KiB retained comment text and 5,000 receipts. Plain text is normalized
and validated; reads remain bounded. Existing HTTP admission budgets and explicit/focus refresh
avoid a new realtime fan-out or polling service.

Forced workspace RLS and source/version/reference guards protect the new tables. Mutation
transactions recheck the active account, source ownership, original share creator's current
membership and share expiry/revocation. Share/source locks serialize accepted mutations against
revocation and deletion. Page anchors must belong to the exact pinned publication.

Revoked or expired links deny recipient feedback and future writes. Authorized creators may
read retained closed feedback. Existing share expiry cleanup removes its sidecars after the
seven-day receipt retention window. Library/workspace deletion cascades, and account lifecycle
handling erases the account's comment bodies and includes authorized feedback in account exports.

## Verification

- **Four contract checks, eight Memory feedback cases and four E08 repository compatibility
  cases pass.** They cover strict DTOs, bounded text, identity fences, exact receipts/CAS,
  approval staleness, own-message export after revocation and account erasure without body
  resurrection during a yielding deletion lifecycle. Contracts/DB typing, scoped lint and
  formatting pass. Fresh enable attempts leave enabled, commented, resolved and approved reviews
  unchanged. Reusing rejected operation IDs for real commands proves no receipt allocation;
  exact original enable/comment receipts remain replayable at the 5,000-receipt cap.
- **Fifteen feedback API checks and 47 focused authentication checks pass.** Real AuthService
  cookies plus the Memory repositories exercise membership-free reviewer permissions, typed
  view-only state, pseudonyms, cross-version/page rejection, account-bound replay, fresh policy/
  cookie/share expiry checks and separate admission buckets. Unexpected database errors produce
  static retryable failures with metadata-only logging; private error details stay out of logs.
  Malformed JSON and oversized requests retain safe 400/413 responses. Identity-only users can
  return to a clean canonical review path; unrelated sign-in destinations retain existing rules.
- **Sixty-six focused UI/client checks pass.** They cover credential routing, strict response
  identity, page/version anchors, submitted-intent recovery after reload, account changes,
  conflict text preservation, older-server fallback and reply/edit form clearing only after
  acknowledgement. The production browser caught a nested banner landmark in the existing
  share dialog; its local header now uses neutral markup. Current web typing, scoped lint and
  formatting pass. All feedback UUIDs use the existing `clientUuid` fallback when `randomUUID`
  is unavailable. Clearing an abandoned empty draft releases its page anchor; nonempty drafts
  and pending submissions retain their original anchors and exact intent.
  Regressions reproduce both review findings before their fixes: parent focus revalidation now
  retains reply/edit state without adding stored drafts, and resolved threads hide the reply
  form until reopening. Identity changes also remount discussion instances by opaque viewer key,
  including a changed account cookie without an explicit auth event.
- **Sixteen selected real PostgreSQL cases pass:** eight E11 cases, four E09 cases, three E10
  cases and the shared Presentation repository conformance baseline. E11 covers free-account
  feedback, concurrent CAS/receipts, per-message external-account export, body erasure, forced
  RLS/raw guards, expiry while reads/replays wait, source cleanup and deletion lock ordering.
  The enable-once regression verifies unchanged state and exactly five legitimate receipts
  after rejected enable attempts across the review lifecycle.
  Run `9f5073f669` applies all 99 migrations twice, verifies the exact checksum ledger and
  preserves migrations001–098 against the merged baseline. All 65 legacy raw-mutation rejection
  probes pass. Runtime access uses a non-owner restricted role; immutable publication rows stay
  SELECT-only. Source reads lock the mutable parent, with canonical user locks before workspace
  locks. The owned container, SSH forward and lock are removed; OOM is false and all 14 original
  containers remain unchanged. There were 194 unselected integration skips. Private result:
  `/tmp/pollingpops-e11-review-pg/result-9f5073f669.json`.

- **Four production-browser workflows pass (UI baseline `c059a8e`):** Chromium/Firefox desktop and Chromium/WebKit
  mobile. The final matrix tests the existing UUID fallback with `randomUUID` unavailable on
  both author and reviewer pages. It verifies explicit enablement, clean sign-in return paths,
  view-only compatibility, empty-draft reanchoring, nonempty draft pinning across page changes,
  dropped acknowledgement/reload/exact replay, no duplicate comment, identity rejection,
  resolve/approve/stale/reopen, unchanged draft revision, later-publication isolation, access
  revocation and retained closed author history. Reply/edit text and its DOM nodes survive
  blocked and transient-failing parent focus reads; changing the account cookie without an auth
  event clears both drafts. Resolved threads expose no reply form, and a reply after reopening
  succeeds and clears its composer. Axe and strict 320px overflow checks pass; desktop/mobile
  captures were inspected. All four cases pass against a fresh standard production build in
  1.4 minutes including build/startup. Private log:
  `/tmp/pollingpops-e11-review-browser/review-fixes-browser.log`; artifacts:
  `/tmp/pollingpops-e11-review-browser/review-fixes-results/`.
- Owned browser/API listeners are stopped, ports14560/15560 are free, temporary Firefox
  directories are removed and the real home directory is unchanged. Per-run authentication
  caches are private and removed by the existing test teardown. Generated logs, captures,
  credentials and disposable database artifacts stay outside the repository.

- **The final `VITEST_MAX_WORKERS=1 pnpm check` passes:** formatting, Docker workspace context,
  lint/typecheck (17 tasks each), package tests, smoke support, production builds (10 tasks) and
  admin CLI build. Principal totals are 914 contracts, 557 database, 1,310 server, 2,685 web and
  354 smoke-support tests passed. Normal opt-in database skips remain; the sixteen real
  PostgreSQL cases above were run separately. The browser spec also passes scoped strict
  TypeScript checking. Private full-check log:
  `/tmp/pollingpops-e11-review-check-pr203.log`.
- The final source scope is 39 files, with no package manifest or lockfile changes and only
  migration099 added. Historical migrations001–098 match the merged baseline byte for byte.
  Source on the implementation branch is ready for review and remains undeployed.

## Rollout

Apply migration099 before deploying the new feedback writers/readers. Existing E08 clients can
continue using the unchanged view-only endpoints. Keep review sidecars during a rollback; older
readers do not need to reinterpret them or rewrite published content. Hosted rollout, physical
devices, manual assistive technology, observed creator tasks and operating-cost qualification
remain separate from local software verification.
