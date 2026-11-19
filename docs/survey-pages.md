# Ordered Survey pages

WX-06A1 introduced the versioned layout and compatible stored, participant and creator readers.
WX-06A2 adds explicit page organization in the Survey editor behind the separate `surveyPages`
product capability. It starts disabled and depends on `surveys`. Ordinary blank/template creation
continues to write v2. The selected [conditional-page foundation](survey-branching.md) is a
separate proposed contract; application writers and readers remain on v1–3.

## Content and compatibility

| Boundary                | v1/v2                                      | v3                                                          |
| ----------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| Content layout          | Existing flat `items`; `pages` is rejected | Flat `items` plus explicit ordered `pages`                  |
| Stored documents        | Original versions remain supported         | Records, frozen versions, rooms and guests accept version 3 |
| Default author writer   | v2                                         | Explicit conversion with the `surveyPages` grant            |
| Question/response kinds | Existing unscored polls and ratings        | Same kinds, selection limits and UUID response map          |
| Aggregate projection    | Version 2                                  | Version 2; same question order and privacy rules            |

Each v3 page contains a stable UUID, a title of up to 160 characters, a description of up to
1,000 characters, and question UUID references. Titles and descriptions default to empty text.
There must be 1–20 pages. Concatenating their `questionIds` must equal the flat `items` question
IDs exactly: no omitted, duplicate, reordered or dangling references. Page IDs are unique.
Temporary empty pages are valid drafts; every published page must contain a question. The
existing 100-question limit and Survey-only metadata restrictions still apply.

This layout preserves one authoritative question order and one response namespace. It adds no
eligibility rules, hidden questions, branch targets, scored work or diagnostic metadata.
Unknown versions and condition fields fail validation. Branching needs a separate versioned
decision about eligible answers, clearing hidden responses and skipped-question results.

`CURRENT_SURVEY_SCHEMA_VERSION` remains 2 for ordinary factories. The supported reader maximum
is 3. `upgradeSurveyDraft` preserves existing v1→v2 behavior and returns v3 with its pages intact;
it never synthesizes pages into stored historical content. Published versions and room snapshots
are not backfilled or rewritten. A v3→v2 save is rejected rather than silently discarding layout.

## Writer and reader boundaries

The repository accepts an explicit maximum-schema writer policy, defaulting to 2. HTTP writers
select 3 only when the current workspace resolves the `surveyPages` capability. The capability
has no legacy environment mapping: an operator must explicitly enable it for eligible plans in
the existing durable product policy. It depends on the parent `surveys` capability and adds no
new paid-plan requirement. `/v1/auth/me` exposes the effective `productFeatures.surveyPages` boolean;
older payloads default to false. Existing edit roles are still required.

The policy check runs after exact accepted-receipt recovery, so pausing `surveyPages` cannot alter
a committed acknowledgement or its request hash. This does not change the existing parent
`surveys` creation gate or allow revoked members to recover unauthorized content.
Metadata archive/organization operations, retention and erasure keep their existing meaning.

Legacy source copies still generate v2 drafts. A v3 source must retain v3 and remap question
references together with deterministic copied IDs; it cannot be converted to a flat copy as a
fallback. Independent Library copy paths follow the destination workspace's effective page
grant. Discovery capabilities use an internal schema discriminator from the existing metadata
query, without fetching private snapshot bodies or exposing that discriminator publicly. A paused
grant blocks fresh copies but preserves exact accepted-copy receipt recovery. No external
provider is introduced.

The page-aware participant declares `x-pollingpops-survey-schema: 3` on Survey guest requests,
including admission from the common join page. Missing or unsupported reader declarations for
a v3 room return `SURVEY_CLIENT_UPDATE_REQUIRED` before admission or delivery of content or a
response acknowledgement. Legacy v1/v2 rooms remain usable without the new header. The header
declares reader support; it grants no access without the existing room credential and password
checks. Existing retained v3 rooms remain readable after page writing is disabled.

The creator view renders retained v3 pages read-only when the page capability or edit role is
unavailable. Current authority fences captured callbacks and autosave, including a grant change
while a local draft contains pages. Unsaved local content remains available for download; it is
not flattened or silently discarded. Actor/workspace changes replace the editor scope. Legacy
editor behavior remains available for v1/v2 drafts.

An account loading/error state masks the editor and disables writes without destroying an already
confirmed scope's local draft. Retry confirms the current identity/workspace before revealing it
again. Initial account failures still expose the workspace retry screen. Authentication expiry or
a confirmed different scope clears the retained editor rather than revealing earlier content.

## Authoring pages

- **Organize into pages** explicitly converts the current draft to v3 after confirmation. Existing
  question IDs, content and order are retained on the first page. Existing published links keep
  their frozen content. There is no implicit conversion or downgrade control.
- Authors can add pages, edit titles/instructions, select pages and reorder them using keyboard
  buttons. Page order and the flat question order change together; IDs remain stable.
- Questions can be added to a page, reordered within it or moved to another page. Existing poll
  and rating editing remains available. Removing a question requires confirmation.
- Removing a page requires confirmation and moves its questions into the adjacent page in order.
  Only the removed page's title/instructions are lost. The final page cannot be removed.
- Drafts may contain empty pages while being organized. Publishing requires a question on every
  page, with the same 20-page and 100-question limits enforced by the contract. Preview is
  read-only and sends no participant response.
- Autosave and publish/share actions use the existing saved-revision barrier. Retried unknown
  writes retain their captured request rather than minting a new mutation identity.
  When the account snapshot confirms page editing is paused, the editor disables retries and
  retains the exact intent for recovery after authority returns; the API can still recover already
  accepted receipts.
  A server `SURVEY_PAGES_NOT_ENABLED` response received before account flags refresh is a
  resumable capability pause, not a stale-draft conflict. The local draft and captured save remain
  available for an explicit retry; the server still denies any fresh write while the grant is off.

## Participant navigation and resume

- Page headings, descriptions and progress identify the current section. Back preserves the
  response map and does not require answers. Next validates the current page's required fields,
  saves the complete response map and advances only after the authoritative acknowledgement.
  Enter on an intermediate page invokes Next; only the final page can submit the Survey.
- Final submission still validates all required questions on the server. Every item is eligible
  in this checkpoint; page navigation is not conditional visibility or authorization.
- One synchronous operation owns the captured room, credential, path, body and intended page
  transition. Unknown failures retain that exact operation. A retry cannot turn a pending progress
  save into final submission or mint a new mutation key. Room changes, unmounts and later sessions
  fence stale acknowledgements before they can replace the current answers or navigate pages.
- Resume uses saved server responses. It opens the earliest page with an unanswered item,
  including optional items; when all items have responses it opens the last page for review.
  This is a deterministic display hint, not a claim to restore the exact last visited screen.
  No page cursor, visits, drop-off profile or answer content is added to browser storage.
- Closed retained runs permit read-only page review. Accepted mutation retries keep their
  existing receipt-recovery behavior; closure does not authorize a new response write.

## Results, sharing and lifecycle

Pages change layout only. Aggregate schema 2 and the existing summary projection retain the same
question order, respondent denominator and final-only release. Runs must be closed and have at
least five respondents; individual questions still need at least five answers. Page visits and
page-level cohorts are not exposed. There is no new individual completion or learning claim.

Authorized shared Library readers retain the pinned page headings and instructions. A v3
projection adds whitelisted `surveyPages` metadata (`id`, `title`, `description`, `questionIds`)
alongside its existing safe flat question list. The client validates the exact ordered partition
and renders each page's instructions with its questions. Legacy flat reader payloads stay
unchanged. Source-workspace explanations, answer keys and later unpublished edits remain private;
the shared view remains read-only. An eligible recipient may create an independent page-preserving
copy when use permission, destination edit access and the destination page grant all allow it.

Account exports retain the versioned content, including page metadata. Existing workspace RLS,
frozen snapshot guards, room retention, account/workspace erasure and cascades remain applicable.
Tests use synthetic isolated fixtures. Page-authoring tests exercise the public HTTP interface
with an explicit test-only product-policy grant.

## Deployment and remaining work

Apply migration `117_survey_pages_readers.sql` using the owner migration connection before deploying
the matching readers. It expands four stored-version constraints without new tables, row
backfills or changes to published snapshots. Deploy compatible API, worker/export/lifecycle and
web readers together before enabling `surveyPages`. Deploy compatible control/API binaries before
adding the new key to the durable product policy. Unconfigured deployments remain off; ordinary
Survey creation still works. No additional migration is needed for WX-06A2.

Keep v3-compatible readers deployed once v3 records exist. Never flatten frozen content, strip
the reader declaration or change accepted mutation bodies to fit an older binary. Preserve the
migration during rollback and use a compatible forward repair. See the
[upgrade runbook](runbooks/upgrade.md).

Pausing `surveyPages` blocks fresh page writes, publications, launches and copies. Existing rooms,
guest responses, retained readers and aggregate privacy stay independent of the authoring grant.
The existing parent Survey creation gate remains separate. Conditional paths remain WX-06B and
require a separate contract and privacy checkpoint before implementation selection.
