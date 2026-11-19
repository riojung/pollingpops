# Ordered Survey pages: reader foundation

WX-06A1 is the first contract and reader checkpoint for Survey pages. It adds a versioned
layout and compatible stored, participant and creator readers. Page authoring, page-aware
creation controls and conditional paths remain subsequent increments. Ordinary blank/template
creation continues to write v2; fresh v3 authoring, publishing, copying and launches remain
unavailable through the production HTTP routes in this checkpoint.

## Content and compatibility

| Boundary                | v1/v2                                      | v3                                                          |
| ----------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| Content layout          | Existing flat `items`; `pages` is rejected | Flat `items` plus explicit ordered `pages`                  |
| Stored documents        | Original versions remain supported         | Records, frozen versions, rooms and guests accept version 3 |
| Default author writer   | v2                                         | Not enabled                                                 |
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

The repository accepts an explicit maximum-schema writer policy, defaulting to 2. A future
verified page-authoring grant can select 3 after its own checkpoint. This foundation's HTTP
writers never grant that policy. The policy check runs after exact accepted-receipt recovery,
so a new writer restriction cannot alter a committed acknowledgement or its request hash.
Metadata archive/organization operations, retention and erasure keep their existing meaning.

Legacy source copies still generate v2 drafts. A v3 source must retain v3 and remap question
references together with deterministic copied IDs; it cannot be converted to a flat copy as a
fallback. Independent Library copy paths follow the same writer restriction. No new paid plan
or external provider is introduced.

The page-aware participant declares `x-pollingpops-survey-schema: 3` on Survey guest requests,
including admission from the common join page. Missing or unsupported reader declarations for
a v3 room return `SURVEY_CLIENT_UPDATE_REQUIRED` before admission or delivery of content or a
response acknowledgement. Legacy v1/v2 rooms remain usable without the new header. The header
declares reader support; it grants no access without the existing room credential and password
checks. Existing retained v3 rooms remain readable after page writing is disabled.

The creator view renders v3 pages read-only with an explanation. It does not start autosave or
enable captured edit/publish/copy/share actions. This protects retained layouts while page-aware
authoring controls are developed. Legacy editor behavior remains available for v1/v2 drafts.

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
the shared view does not enable page authoring or independent copying.

Account exports retain the versioned content, including page metadata. Existing workspace RLS,
frozen snapshot guards, room retention, account/workspace erasure and cascades remain applicable.
Tests use synthetic isolated fixtures; the normal HTTP interface cannot create paged test runs.

## Deployment and next checkpoint

Apply migration `117_survey_pages_readers.sql` using the owner migration connection before deploying
the matching readers. It expands four stored-version constraints without new tables, row
backfills or changes to published snapshots. Deploy compatible API, worker/export/lifecycle and
web readers together before any future page writer is enabled.

Keep v3-compatible readers deployed once v3 records exist. Never flatten frozen content, strip
the reader declaration or change accepted mutation bodies to fit an older binary. Preserve the
migration during rollback and use a compatible forward repair. See the
[upgrade runbook](runbooks/upgrade.md).

The next WX-06A checkpoint is page-aware authoring: explicit conversion, add/move/delete page
and question actions, confirmation around destructive changes, accessible author preview and
an effective writer grant. Conditional paths remain WX-06B and require a separate contract and
privacy checkpoint before implementation selection.
