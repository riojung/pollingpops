# Presentation E12 outline-first creation

Implementation branch: `codex/presentation-e12-outline-create`, from merged outline assistance
baseline `471f187c9a093bcaee2cdd7f27cb563ee61e9112` (PR #204). This slice completes a new-deck
entry point for the existing reviewed outline workflow. It remains undeployed.

## Creator workflow

Choose **Create → Presentation → From outline**, enter a presentation title and explicitly choose
**Create draft and continue**. A saved native draft exists before the editor opens **Outline to
slides**. Opening the panel never submits an AI job. The creator enters their outline, checks the
existing shared allowance, requests 3–8 proposed slides, reviews exact excerpts and unverified
wording, and confirms selected insertion. The empty starter is replaced by editable native slides;
publication remains explicit. Cancellation or provider failure leaves the draft available for
manual editing. Existing source, template and blank starting points remain available.

## Recovery and persistence

The dedicated `POST /v1/presentations/outline-drafts` requires an opaque creation request UUID,
current actor/workspace context, native starter mode and normal title/description bounds. It
accepts no outline or generated copy. Ordinary creation without a key retains its existing
behavior; the normal endpoint also supports explicit stable creation identities.

Migration101 adds compact, forced-RLS creation receipts. Identity/workspace/member locks and a
request-scoped transaction serialize concurrent retries. The deck, revision-zero history and
receipt commit together. Exact retries return the current deck with later edits/publication
preserved; changed intent or context conflicts. Deleted targets return 410 and cannot be
recreated by retrying their request identity. Append-only triggers preserve receipts even where
runtime grants permit writes. Whole-workspace erasure may cascade receipts; deck/account erasure
cannot release a consumed identity in a surviving workspace. No title, actor ID, outline or
generated text is retained in the compact receipt.

Per-tab launcher recovery retains only the exact title/identity creation request and acknowledged
deck ID, scoped to the current actor/workspace. The request is saved before mutation and reused
byte for byte after uncertain acknowledgements and reloads. Known success offers **Open saved
draft** or deliberate **Start another**. A definitive deleted-target response also permits an
explicit new request. Unknown outcomes retain their identity. Account/permission changes fence
late responses; unavailable storage prevents mutation before recovery can be saved.

The exact scalar editor query `start=outline` is an opening hint. It waits for the loaded,
authorized, clean editor and preserves save/conflict/recovery/overlay protections. It uses the
existing save-drain preparation, then consumes the hint to the fixed local editor URL. Closing
and reloading does not reopen the panel; URLs never submit source text or generate proposals.

Creating a draft consumes no AI allowance. Only explicit proposal admission uses the existing
shared authoring ledger and bounded approved provider. No new paid service, dependency,
entitlement, document/scene version, job contract or worker is introduced. Migrations001–100 and
legacy authoring hashes remain unchanged.

## Verification

- Focused contract, Memory persistence, API, launcher/client and editor-handoff tests, typing,
  lint and formatting pass. Regression coverage includes exact lost-acknowledgement recovery,
  actor/workspace and permission fences, deleted-target restart, unknown outcomes, query
  allowlists, competing recovery and clean-editor preparation.
- All **33 selected real PostgreSQL cases pass**: six creation, nine assistance, eight review,
  four insights, three spatial, the shared Presentation repository case and two legacy authoring
  claim/quota cases. Run `75d233dedc` applies all 101 migrations twice and verifies exact ledger
  checksums, restricted runtime access, forced RLS and all 65 legacy raw SQL rejection probes.
  Creation coverage includes concurrent retries, mutable-deck recovery, authority changes,
  deleted targets, atomic rollback, append-only enforcement under broad runtime grants and
  workspace cascade erasure. Migrations001–100 retain their exact bytes. All fourteen existing
  containers retain their states; the owned container, SSH forward and lock are removed, with
  no OOM. The six-case creation suite is included in the existing PostgreSQL CI job. Private result:
  `/tmp/pollingpops-e12-outline-create-pg/result-75d233dedc.json`.
- The browser workflow exposed and fixed native starter preservation: only the exact untouched
  default native starter is replaced. Its regression reproduced four blocks instead of three;
  exact apply recovery, eleven authored-content preservation cases and native topology pass.
- A second regression reproduces visual-import recovery temporarily blocking automatic modal
  preparation. Temporary deferrals now retry when ready; genuine preparation failures leave a
  manual retry. Real recovery effects are mounted in the handoff tests. Opening remains one-time
  and generation remains explicit.
- All **eight production-browser workflows pass across four profiles**: Chromium/Firefox
  desktop and Chromium/WebKit mobile. The existing full outline recovery journey remains green.
  The new journey verifies lost draft-create acknowledgement, reload with byte-identical retry,
  one saved deck, cancellation without another job, known-draft re-entry, explicit generation,
  reviewed insertion, starter replacement and no automatic publication. Axe and strict 320px
  overflow checks pass. Each profile has a fresh API fixture; existing endpoint rate limits stay
  enabled. A fresh production web build is reused with the same final source across profiles.
  Private matrix: `/tmp/pollingpops-e12-outline-browser/outline-create-verified-matrix-result.json`.
- The full **`VITEST_MAX_WORKERS=1 pnpm check` passes**: formatting, Docker workspace context,
  lint/typecheck (17 tasks each), package tests, smoke support, ten production build tasks and
  the admin CLI build. Passing totals include 920 contracts, 566 database, 1,352 server,
  2,759 web and 354 smoke-support tests. Normal opt-in database skips remain; real PostgreSQL
  qualification above is separate. Private log: `/tmp/pollingpops-e12-outline-create-check.log`.
- The browser spec passes scoped strict TypeScript and ESLint. Representative narrow captures
  were inspected. Owned web/API/provider listeners are stopped and Firefox fixture directories
  are removed. Source is ready for review and remains undeployed.

## Rollout and remaining scope

Apply migration101, upgrade HTTP readers/writers, then deploy the matching web launcher. The
dedicated endpoint returns an unavailable route on older HTTP instead of silently stripping
creation identities; do not fall back to unkeyed creation. Keep migration101 and compact receipts
in a migration-aware rollback release; bundles missing applied migrations fail verification.
Existing migration100/provider admission upgrade requirements still apply.
See the [upgrade runbook](../runbooks/upgrade.md#outline-first-presentation-creation).

Rewrite/shorten, translation, layout/question suggestions, conversational editing and generated
media remain later E12 work. Self-paced attempts and other separately scoped packages remain
planned. Hosted rollout, real-provider cost/quality, physical-device/manual accessibility and
observed creator task acceptance are separate from local software verification.
