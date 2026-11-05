# Presentation E08 private review links

Implementation branch: `codex/presentation-interactions-sharing`. This is E08's bounded private
view-only slice. Independent assignments, learner attempts, deadlines, feedback and completion
remain separate work. This private-review software slice and local verification are complete;
it remains undeployed.

## Access and recipient behavior

An owner/editor shares one immutable published version for one, seven or thirty days. Subsequent
draft edits and publications never change that link. Creation is blocked for archived decks;
existing links remain explicitly revocable. Links expire absolutely and also become invalid when
the publisher loses authority, the feature is disabled, or the source/version/workspace is deleted.
There are at most 20 active and 100 retained links per deck; expired metadata is purged after seven
days. No per-view analytics, learner record, model call or background rendering job is created.

The capability uses a cryptographically generated 32-byte token in the URL fragment. The review
page scrubs it into per-tab state; API calls carry it only in Bearer headers, omit cookies and use
no-store/no-referrer policies. The server stores a hash, never plaintext. Exact create intent
retains the request ID, version, absolute expiry and token before sending, so a lost acknowledgement
or reload recovers the same link rather than creating another one. Expired requests cannot mint a
fresh expiry. Metadata and account export omit both token and intent hashes.

Authorization resolves the exact capability, then uses workspace-scoped reads with forced RLS.
The recipient projection explicitly allowlists slide/scene content, section labels and question
prompts/options. It excludes speaker notes, answer keys, explanations, provenance, Pack baselines,
branches, moderation, scores, credentials and live state. Questions are for reading; there are no
answer controls or learner attempts. Preview bots receive no sensitive metadata and create no
attempts or completion events.

Readers navigate locally through pages, sections and internal links. A small capability check
precedes each page change; revocation stops an already-open reader from navigating further.
Definitive denial clears the review and tab credential. Transient failures retain the current
cursor and offer retry. No periodic polling or full-deck transfer per page is required. Native
dialogs/hotspots remain local, and broadcast audience text becomes a viewer-local reveal in review.

Assets are served through a capability-authorized proxy, not a signed URL that survives revocation.
Only scanned images referenced by that frozen safe version are readable. Image reads are bounded
to 10 MiB, four concurrent server reads and two per client, with authorization checked again after
storage returns. Revocation prevents subsequent access; already delivered bytes cannot be erased
from a recipient's possession.

Authorized overload returns 503 with `Retry-After`. Clients make at most three automatic attempts
with bounded delay/jitter, then offer **Retry image**. Authorization denials never retry. The
client queue is capped at 64 pending reads and removes canceled entries. The server has no image
wait queue, keeping its memory bound explicit.

## Verification

- The focused API/memory/client/UI checks passed **21 tests**, with package typechecks and scoped
  lint. Coverage includes exact retries, immutable pinning, safe projections, revocation during
  media reads, publisher/feature changes, record limits, canonical UUID retries and access checks
  before every local cursor change. A six-request burst proves four storage reads are admitted,
  two return 503, later attempts recover, and a revoked waiting capability never starts a read.
  Client tests verify three total attempts, delay clamps, abort/cancellation, queue bounds,
  terminal authorization denials and explicit retry after temporary failure.
- Restricted PostgreSQL 17 run **`20df94cce3` passed 69 cases**, including three sharing cases,
  advanced interactions and the E07 baseline. Both 97-entry checksum-ledger checks passed; forced
  RLS/restricted runtime and raw immutable/retention/capability guards were exercised. The actor
  soft-delete regression removes a collaborator's share while retaining another owner's source
  version/hash. Both account-erasure cleanup paths now delete the actor's link records explicitly.
  All fourteen original containers were unchanged and owned resources were removed. Private
  result: `/tmp/pollingpops-interactions-sharing-pg/result-20df94cce3.json`.
- The combined **eight production-browser workflows passed** across desktop Chromium/Firefox and
  mobile Chromium/WebKit (**107.86 seconds** including build/fixture/cleanup). Four sharing cases
  verify real image upload/rendering, a lost create acknowledgement followed by reload/exact retry,
  fragment scrubbing, anonymous cookie-free viewing, public-data exclusions, local interactions,
  read-only questions, immutable pinning after a newer publication, revoked page transitions and
  a fresh denied media read. No learner response or attempt API is called. Axe, reduced motion,
  overflow and all four final review captures were checked. Mobile Share visibility/occlusion was
  corrected before the passing final run.
- The four final review captures show the decoded image, opening title, page counter and matching
  map selection. Desktop fixture frames still overlap some controls; outline/mobile layouts
  provide the complete actions. These are emulated devices using production Next plus a local
  in-memory API, synthetic scanner and loopback object store. Hosted storage/scanning, physical
  devices and WAN/soak acceptance remain open. Task ports had no remaining listeners, owned
  Firefox data was removed and actual `HOME` was unchanged. Private evidence:
  `/tmp/pollingpops-interactions-sharing-browser-verified-98dc50c0276c/result.json`.
- **`VITEST_MAX_WORKERS=1 pnpm check` passed**, including formatting, Docker-context checks, lint,
  package typechecks/tests, smoke-support, production builds and the admin CLI. Principal passed
  counts: contracts 896, database 529, server 1,177, web 2,514 and smoke-support 354. Default opt-in
  integration skips remain; the 69 PostgreSQL cases were run separately above. Private full log:
  `/tmp/pollingpops-interactions-sharing-check.log`.

## Review follow-up: expired create recovery

The review found that an unaccepted pending intent could expire and leave the dialog retrying
it indefinitely. The repository now distinguishes `REQUEST_EXPIRED` after checking for an
existing receipt. The API returns 410/`PRESENTATION_SHARE_REQUEST_EXPIRED` only for that terminal
case. Matching accepted receipts still replay before expiry validation; authentication, source,
limit and conflict behavior is preserved.

The dialog releases only the matching expired intent after this authoritative response, restores
the editable form, and waits for an explicit new Create action. It never clears based on the
client clock, a network failure or an unrelated error. Conditional storage cleanup also prevents
an older dialog's late result from erasing a newer pending intent.

Focused checks passed 22 web tests and 11 server/database tests, with package typechecks and lint.
Restricted PostgreSQL run `8c3fd6f602` passed 70 cases, 97-entry checksum checks twice, the immutable
v9 hash and 65 legacy probes. All 14 original containers were unchanged; owned resources were
removed. The four targeted sharing browser profiles passed in 75.49 seconds, including real expired
request rejection, a fresh request/secret/expiry, lost-ACK reload recovery, immutable pinning and
revocation. Firefox data was removed and actual `HOME` unchanged. Private result:
`/tmp/pollingpops-interactions-sharing-browser-expired-recovery-1c5b90478358/result.json`.
Migrations are unchanged. **`VITEST_MAX_WORKERS=1 pnpm check` passed again** after the fix,
including formatting, lint, typechecks, package/support tests, production builds and the admin
CLI. Principal passed counts: contracts 896, database 530, server 1,178, web 2,521 and smoke-support 354.
Default integration skips remain; the 70 selected PostgreSQL cases ran separately. Private log:
`/tmp/pollingpops-share-recovery-check.log`.

## PR review follow-up: storage-unavailable focus recovery

PR #199 identified that returning focus to a review tab could discard its valid in-memory token
after the URL fragment had been scrubbed and per-tab storage was unavailable. Focus reloads now
retain the current token when no replacement credential is present. A new valid fragment replaces
it; malformed, duplicate or query credentials still reject access. Authoritative access failures,
expiry and effect cleanup continue to clear the in-memory token.

The 12 new lifecycle regressions pass using the real fragment-capture helper with all per-tab
storage operations throwing. They cover focus reuse, four authoritative denial statuses,
network/503 recovery, malformed/duplicate/query credentials, replacement tokens and share-change/
unmount isolation. The existing 22 sharing tests, scoped lint and web typecheck also pass.
`VITEST_MAX_WORKERS=1 pnpm check` passed after this fix, including all 2,533 web tests and
production builds. Server contracts, migrations and stored credentials are unchanged.

## Rollout

Apply migration097 and deploy the matching sharing repository, routes, recipient schemas and web
assets together. Existing Presentation availability/role policies still apply. Keep the new table
and RLS/foreign-key guards on rollback; retain immutable published versions and media references.
Account/workspace/source deletion and retention cleanup must keep their sharing hooks.

This slice uses existing authentication, storage and transaction infrastructure, with no new paid
service or subscription entitlement. Customer pricing, hosted performance and manual assistive
technology/device acceptance remain qualification work. Self-paced delivery is not implemented by
these review links.
