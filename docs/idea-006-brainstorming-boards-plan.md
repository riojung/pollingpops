# IDEA 006 brainstorming and prioritization boards

Updated: 2026-10-16

Implementation was requested after confirming IDEA-004 and IDEA-005 are complete for their
selected scope. IDEA-004's Presentation/Survey format expansion and IDEA-005's Google Sheets
delivery remain separate deferred increments. Their selected changes and follow-up fixes are
merged into `main`.

## Customer workflow

A standalone board can collect ideas before, during, or after a meeting. Its shareable participant
link does not require a Round or Presentation to remain live. Workspace owners and editors create
and facilitate boards; viewers can read approved content. Owners can delete a board.

1. Create a board with a title, prompt, collection window, identity policy, moderation setting,
   and priority-vote budget. Anonymous participation is the default; optional aliases are chosen
   separately for this board and visible with approved ideas. Identity policy is immutable.
2. Open collection and share the participant link. Guests submit plain-text ideas without an
   account. Moderation is enabled by default; pending ideas are visible only to moderators and
   their submitter. Hosts may hide or reveal approved ideas during collection.
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
  Receipts and stored documents are bounded. Removed ideas lose their text and alias.
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

The selected local implementation is complete. The repository check passes with
`CI=true TURBO_ENV_MODE=loose VITEST_MAX_WORKERS=1 pnpm check`; reduced worker parallelism avoids
an observed local Vitest temporary-file failure. The isolated restricted PostgreSQL suite passes
195 tests with one existing skip. It covers concurrent budgets, retries, tenant isolation, role and
privacy projections, read/write deadline waits, delayed account exports, expiry and account lifecycle.
There are also 44 deterministic read deadline regressions and a guest API retention-wait regression.
Its disposable container was
removed after verification.

Three production-browser journeys pass on desktop Chromium, mobile Chromium and mobile WebKit.
They cover anonymous/alias admission, moderation, manual grouping, ballots, refresh, closure,
deletion, account-cookie omission, classic navigation, narrow automated accessibility checks, and
light/dark desktop/mobile layout evidence. See the
[implementation checkpoint](implementation-status.md#idea-006-brainstorming-and-prioritization-boards-october-16-2026).
External/manual acceptance and production enablement remain separate. See the
[upgrade notes](runbooks/upgrade.md#standalone-brainstorming-boards) before enabling or rolling back.
