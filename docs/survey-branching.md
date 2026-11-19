# Survey conditional pages: contracts and readers

WX-06B1 follows the product owner's 2026-11-19 selection: **show or hide a page based on one
earlier single-choice answer**. It implements an isolated proposed v4 contract and pure eligibility,
cleanup and validation helpers. B1 merged in [PR #286](https://github.com/riojung/pollingpops/pull/286)
at `f08ccbd`. WX-06B2 merged through PR #287 at `ed011d0` and adds compatible stored-content and participant readers while keeping every
new conditional-Survey authoring, publication, launch, Library sharing and copy path disabled.

The module is exported separately as `@openround/contracts/survey-branching`. Its readable schemas
accept v1–4 without changing the v1–3 mutation schemas or their parsed key order. Ordinary creation
still writes v2; `surveyPages` authorizes v3 page organization only. No branching feature grant is
introduced. There is no ordinary path for creating a v4 record in this checkpoint; verification
uses synthetic frozen records inserted directly by test fixtures.

## B2 reader and storage checkpoint

Migration `118_survey_branching_readers.sql` expands four stored-version checks to 1–4 without
backfills, new identity fields, or rewriting frozen content. Deploy matching API, web, worker and
account-export/lifecycle readers together. Keep compatible readers and the expanded constraint
after any v4 document exists; an older binary cannot safely read or flatten a conditional Survey.

The browser advertises `x-pollingpops-survey-schema: 4`. The API recognizes exact declarations 3
and 4 as supported maxima; missing, malformed and unknown declarations use the legacy v2 maximum.
V4 public metadata, creator content, guest admission/resume and mutation acknowledgements require
a v4 reader. V1–3 guest compatibility stays supported; the header conveys capability, not authority.
Room credentials, passwords, workspace scope, expiry and admission limits still apply.

Participant navigation renders only visible pages. Changing a controller immediately replaces
the local answer map with the cascading cleanup result. Next validates the current visible page,
saves the complete replacement map and advances only after its acknowledgement. Final submission
checks required fields only on eligible questions, and the server rejects hidden or unknown answers
rather than silently accepting them. It replaces stored responses atomically under the existing
revision and idempotency checks. Reopening a path presents unanswered questions.

Unknown save outcomes retain their exact room, credential, key, body and intended transition;
edits and navigation wait for resolution. Acknowledgements must match the frozen content, normalized
response map, expected revision and operation type. Historical accepted receipt replay remains
unchanged and never rewrites a newer attempt. Stale acknowledgements cannot restore an earlier
answer map. Reconnect resumes from authoritative saved answers; no answers or page history are
stored in the browser. Closed retained attempts remain navigable read-only.

Authorized creators can inspect every retained page and its condition read-only, including pages
currently hidden from an unanswered participant. This is explicit all-page inspection, not a
participant eligibility bypass. No autosave controller, rule editor, copy or launch action is enabled.
Existing Library projections and new shares/copies refuse v4 instead of flattening conditions.

V4 results return `SURVEY_BRANCHING_RESULTS_NOT_AVAILABLE` before closure capture or aggregation.
Summary creation and derived PDF/PNG/XLSX exports remain unavailable; aggregate-v2 is never used
for conditional content. Account exports preserve versioned authored content and continue excluding
guest answers, credentials and receipts. Room/account deletion, retention and RLS are unchanged.

## Selected rule model

A proposed v4 document retains the flat question list and exact ordered page partition. Each
page can have one optional condition:

```json
{
  "visibleWhen": {
    "kind": "choice_equals",
    "questionId": "00000000-0000-4000-8000-000000000001",
    "choiceId": "00000000-0000-4000-8000-000000000002"
  }
}
```

The reference must identify an existing poll with a single-choice selection limit on an earlier
page, and one of that question's existing choices. The first page is unconditional. References
to the same/later page, missing questions/choices, ratings, multiple-selection polls, composite
conditions and unknown expression fields are rejected. Earlier-page ordering prevents cycles;
moving a page or question must not silently change or discard its condition.

An unconditional page is always visible. A conditional page is visible only when its controller's
page is visible and the controller has one valid matching choice. Missing, invalid or nonmatching
answers hide the page. This supports a bounded cascade without general expressions or routing
targets: if the controller's own page becomes hidden, its dependent pages become hidden too.
Later unconditional pages remain reachable.

Draft/publication limits stay aligned with v3: 1–20 unique pages, at most 100 unique questions,
every question referenced exactly once in flat-item order, and the existing unscored Survey
question/metadata restrictions. Drafts may have empty pages; published pages must have a question.
This contract adds no scoring or learning-evidence interpretation.

## Responses, clearing and validation

Eligibility is derived from the frozen document and the current response map. It is not a stored
page-visit history and does not authorize access to a Survey or room.

- Reconciliation removes responses belonging to known hidden questions, including malformed
  values in those hidden entries. Cascading conditions use only controllers on visible pages.
  Helpers return a replacement map; callers must not merge removed answers back into it.
- Cleanup is not submission approval. Unknown question IDs and invalid values on visible
  questions remain detectable and must fail separate validation. Validation itself never prunes
  inputs; a submitted hidden response is an explicit ineligible-response error.
- Changing an earlier choice and applying reconciliation clears the newly hidden answers.
  Changing it back does not recover a hidden answer cache. Newly visible questions are unanswered
  until the participant answers them again.
- Final required-field validation applies only to eligible questions. Current-page validation and
  navigation apply only to visible pages. Internal question states distinguish answers, unanswered
  items and questions skipped by logic; invalid input does not become an answered item.
- Inputs remain unchanged. The proposed helpers are pure and bounded by the document limits.
  Future HTTP body limits and room/credential/revision checks remain mandatory.

These helpers are not a report or export projection. In particular, a skipped question is not a
zero answer, and the internal state must not become a facilitator-visible per-person branch trace.

## Compatibility and release gates

No legacy content, publication, room, receipt hash or aggregate is upgraded by B1 or B2. Current
`SurveyDraftSchema`, `SurveyContentSchema`, `CURRENT_SURVEY_SCHEMA_VERSION` and
`MAX_SUPPORTED_SURVEY_SCHEMA_VERSION` retain their existing meanings. Production APIs and clients
continue rejecting v4 authoring requests rather than flattening them into v3. Runtime read support
uses the separate `SurveyReadableDraftSchema` / `SurveyReadableContentSchema` and
`MAX_SUPPORTED_SURVEY_READER_VERSION = 4`; the existing mutation maximum remains 3.

The remaining work is split into reviewable checkpoints:

| Checkpoint          | Required work before completion                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B2: runtime/readers | Merged through PR #287: versioned storage/read paths, v4 negotiation, eligibility and replacement maps, revision/idempotency/reconnect safeguards, lifecycle compatibility and accessible visible-page/retained previews. New writers remain disabled.                               |
| C: results/privacy  | C1 implemented locally: isolated internal counting and a proposed aggregate-v3 withheld-only contract. C2 disclosure-policy qualification, C3 runtime result readers and C4 summaries/exports/lifecycle remain pending. See [conditional result scope](survey-branching-results.md). |
| B3: authoring/grant | Add explicit conversion and rule editing, safe reorder/delete/copy behavior with remapped condition IDs, previews and explanations; enable a separate effective writer grant only after B2 and C readers/privacy paths are qualified.                                                |

Runtime mutation design must prevent a late acknowledgement or an exact retry from resurrecting
answers cleared by a newer branch change. Reconciliation results replace the current answer map;
they must not be combined with an older saved map. Client operation scope, authoritative revision
and accepted-receipt semantics need paired tests before collection is enabled.

No new participant identity, enrollment, page analytics, notification or external provider is
selected here. Existing native-language, hosted-release and human acceptance gates stay separate
from this contract's automated verification.

## Local qualification

On 2026-11-19, full `VITEST_MAX_WORKERS=1 pnpm check` passed all stages, including builds and compiled
server startup. Separate restricted PostgreSQL checks passed the new B2 and existing page-reader
conformance suites (11 tests) and Library memory/PostgreSQL qualification (29 tests). Six browser
runs passed desktop Chromium, mobile Chromium and mobile WebKit, exercising visible navigation,
required-field focus, cascading clearing, exact retries, stale acknowledgements, authoritative
resume, closed/finalized review, axe and overflow checks. Synthetic route-fulfilled browser fixtures
verify reader behavior; they do not create a production authoring bypass or qualify hosted rollout.
The backlog records counts and remaining editorial/release acceptance separately.
