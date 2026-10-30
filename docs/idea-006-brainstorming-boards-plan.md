# IDEA 006 brainstorming and prioritization boards

Updated: 2026-10-21

Implementation was requested after confirming IDEA-004 and IDEA-005 are complete for their
selected scope. IDEA-004's Presentation/Survey format expansion and IDEA-005's Google Sheets
delivery remain separate deferred increments. Their selected changes and follow-up fixes are
merged into `main`.

The next proposed increment covers a shared team canvas and guided guest experience. See the
[Idea Board canvas analysis and implementation plan](idea-board-canvas-implementation-plan.md)
for the capability gaps, sharing architecture, delivery order, and acceptance gates.

## Customer workflow

A standalone board can collect ideas before, during, or after a meeting. Its shareable participant
link does not require a Round or Presentation to remain live. Workspace owners and editors create
and facilitate boards; viewers can read approved content. Owners can delete a board.

1. Create a board with a title, prompt, collection window, identity policy, moderation setting,
   and priority-vote budget. Anonymous participation is the default; optional aliases are chosen
   separately for this board and visible with approved ideas. Identity policy is immutable.
2. Open collection and share the participant link. Guests explain their idea in text and can add
   images, an editable sketch, and website or social-post link cards without an account.
   Moderation is enabled by default; pending ideas and their attachments are visible only to
   moderators and their submitter. Hosts may hide or reveal approved ideas during collection.
3. Review ideas, approve or permanently remove them, create manual groups, and assign approved
   ideas to groups. Facilitators group audience contributions rather than rewriting their text.
4. Start voting. Approved ideas become visible and grouping/moderation freeze so the ballot
   cannot silently change. Each guest chooses up to the board's budget of distinct ideas, with
   one vote per idea. Submitting a ballot is final; an exact retry restores its receipt, and refresh
   restores the saved choices. Vote totals remain hidden until closure.
5. Close the board to reveal totals. Closure is terminal. Fixed deadlines stop collection and
   voting automatically; retention then removes the board and its operational data.

Popularity describes priorities expressed by this audience. It is not a measure of comprehension,
learning, or recovery. Published collaborative text is intentionally shared with admitted guests;
this is a different privacy boundary from aggregate-only Survey reports.

## Rich ideas

Each idea retains a required text description of up to 1,000 characters. The composer also supports:

- Up to three JPEG, PNG or WebP images, each up to 10 MiB, with a required image description.
  Uploads go through quarantine and scanning before they can be attached. Image controls are
  unavailable when the workspace's media feature, object storage or scanner is unavailable.
- One editable sketch per idea with pen strokes, rectangles, ellipses, lines, arrows and text.
  A fixed 1,000 × 600 canvas supports mouse, pen and touch, plus buttons and numeric controls
  for keyboard editing, undo and redo. Sketches contain at most 32 elements, 1,024 pen points
  overall and 128 points per stroke, with a 16 KiB serialized limit. Typed geometry is rendered
  locally; the API does not accept arbitrary SVG or HTML.
- Up to three HTTP(S) link cards, with optional captions and an optional uploaded image from
  the same idea. Links open separately without a referrer. Polling Pops does not fetch remote
  metadata, load social-network embeds or send guest credentials to the linked site.

The sketch belongs to the idea draft; it is not a shared live canvas. After submission, the
facilitator approves or removes the entire idea. Participants cannot silently replace content
after moderation or voting. An uncertain submission retry uses the same complete rich-content
snapshot and idempotency key.

Image bytes are delivered through a board-authorized endpoint, not a reusable public image URL.
Every read checks current admission, visibility, workspace restrictions and expiry, including
after the storage read. Images belonging to a board cannot be attached to Rounds, Presentations
or Recovery Packs through their generic media APIs. Previously downloaded content cannot be
recalled from a visitor's device.

Upload reservations are bounded to 40 per guest and 600 per board, with a 200 MiB cumulative
board byte budget. Removing an image from an unsubmitted draft does not refund that reservation.
The existing 1 MiB board aggregate limit still applies; a full board rejects the new submission
atomically. Bounded upload reservations, including images removed from an unsubmitted draft and
rejected scans, remain retained until board deletion or expiry; ordinary orphan cleanup does not
release them earlier. Submitted image references are released when the idea is removed or the
board is deleted or expires. Removal clears the
text, nickname, images, links and sketch together, including accepted retry projections.

## Boundaries and access

- Boards have their own versioned contracts and storage. Existing immutable Round/Presentation
  content, audience-scope protocols, Survey responses, and IDEA-005 summary sources retain their
  meanings.
- Anonymous boards collect no alias. Public, staff, and account-export projections exclude guest
  identifiers, credential hashes, and per-person ballots. Only a guest's own credential can read
  its saved ballot and pending submissions.
- Guest access uses a random board-scoped bearer, hashed on the server. Credentials stay out of
  links and query strings. Audience requests omit creator cookies. A chosen alias is not verified
  identity, and audience membership is not inferred from creator login.
- Participant links use server-generated board IDs independent of caller-selected retry keys.
  Reusing a creation key after deletion or retention purging creates a new link, so old links
  cannot be replaced by another workspace's board.
- Server transactions enforce workspace isolation, admission limits, phase/deadline checks,
  revision fencing, retry fingerprints, and vote budgets. Approved ideas cannot acquire duplicate
  votes from one credential. Clearing browser storage creates a new guest identity; this is not
  verified one-person voting.
- Bounds are 200 ideas per board, ten submissions per guest, twenty groups, and one to ten votes
  per guest. Participant limits are the lower of 250 and the workspace plan's limit; retention
  derives from the workspace's plan at creation.
  Receipts and stored documents are bounded. Removed ideas lose their text, alias and rich content.
- Deletion and retention remove guests, receipts and ballots with the board. Account export
  includes safe board content and aggregate outcomes, never raw ballots or credentials.
  Reads evaluate closure and expiry after database waits; account exports recheck expiry after
  their asynchronous queries so expired idea text cannot escape through a delayed export.

## Availability

The admin console exposes **Brainstorming boards** under **Features** with plan assignments.
Explicit policy overrides deployment defaults. Without an explicit policy, creation requires
`FEATURE_IDEA_BOARDS=true` and the workspace in `CORE_PARITY_WORKSPACE_ALLOWLIST`; the default is
disabled. Existing boards remain readable and can be closed or deleted while new writers are
paused. Normal operational admission and workspace restrictions continue to apply.

The first increment uses a dedicated **Boards** workspace entry and direct participant links.
Library folders, numeric join codes, embedding in live Rounds/Presentations, AI grouping, reactions,
reopening completed ballots, and shared summary exports need their own selected follow-up scope.

## Verification

The rich-content follow-up is verified locally on October 21. The repository check passes with
`CI=true VITEST_MAX_WORKERS=1 pnpm check`. The isolated restricted PostgreSQL suite passes
197 tests with one existing skip. It covers concurrent budgets, retries, tenant isolation, role and
privacy projections, read/write deadline waits, delayed account exports, expiry and account lifecycle.
There are also 44 deterministic read deadline regressions and a guest API retention-wait regression.
Rich conformance also covers board/guest upload ownership, generic media-reference rejection,
rich and legacy retry fingerprints, quota bounds, atomic aggregate-size rejection and image
lifecycle cleanup. The disposable database was removed after verification.

Six production-browser journeys pass on desktop Chromium, mobile Chromium and mobile WebKit.
They cover anonymous/alias admission, moderation, manual grouping, ballots, refresh, closure,
deletion, account-cookie omission, classic navigation, narrow automated accessibility checks, and
light/dark desktop/mobile layout evidence. The rich journeys add sketch editing by controls and
pointer and native touch placement, undo/redo, saved links and geometry, pending privacy,
approved visibility, expansion and
removal. The browser fixture has no object store or scanner and correctly disables image controls.

The opt-in `apps/server/test/idea-board-media.integration.test.ts` passed against fresh local
MinIO and ClamAV containers, using real signed uploads, scans and binary reads. It verifies exact
PNG bytes, pending/hidden guest denial, visible approval, generic creator-route denial and
revocation on removal. The real scanner separately rejects the standard raw EICAR test payload.
This probe uses an in-memory repository and API injection; PostgreSQL persistence and browser
behavior are covered by their separate suites. All probe containers, tunnels and temporary files
were removed without changing the running development stack.

To rerun the opt-in pipeline test, supply `IDEA_BOARD_PIPELINE_S3_ENDPOINT` (HTTP on `127.0.0.1`),
`IDEA_BOARD_PIPELINE_CLAMAV_PORT`, `IDEA_BOARD_PIPELINE_ACCESS_KEY` and
`IDEA_BOARD_PIPELINE_SECRET_KEY` for disposable local services, then run
`pnpm --filter @openround/server exec vitest run test/idea-board-media.integration.test.ts`.
The test creates and cleans up a uniquely named bucket. It skips when these inputs are absent.

See the
[implementation checkpoint](implementation-status.md#idea-006-brainstorming-and-prioritization-boards-october-16-2026).
External/manual acceptance and production enablement remain separate. See the
[upgrade notes](runbooks/upgrade.md#standalone-brainstorming-boards) before enabling or rolling back.
