# Survey conditional pages: contract foundation

WX-06B1 follows the product owner's 2026-11-19 selection: **show or hide a page based on one
earlier single-choice answer**. It implements an isolated proposed v4 contract and pure eligibility,
cleanup and validation helpers. It does not enable conditional Surveys in the application.

The module is exported separately as `@openround/contracts/survey-branching`. Ordinary Survey
contracts, factories, API requests, stored records and participant readers remain on supported
versions 1–3, with ordinary creation still v2. `surveyPages` continues to authorize v3 page
organization only. There is no branching feature grant, migration or runtime import in this
checkpoint. A proposed v4 document must still fail at current production boundaries.

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

No legacy content, publication, room, receipt hash or aggregate is upgraded by B1. Current
`SurveyDraftSchema`, `SurveyContentSchema`, `CURRENT_SURVEY_SCHEMA_VERSION` and
`MAX_SUPPORTED_SURVEY_SCHEMA_VERSION` retain their existing meanings. Production APIs and clients
continue rejecting unsupported v4 data rather than flattening it into v3.

The remaining work is split into reviewable checkpoints:

| Checkpoint          | Required work before completion                                                                                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B2: runtime/readers | Expand versioned storage and read paths; negotiate v4 support; enforce server-side eligibility and hidden-answer cleanup; preserve revision/idempotency, reconnect, retention and erasure behavior; deliver accessible visible-page navigation and retained read-only previews. Keep new writers disabled. |
| C: results/privacy  | Define versioned branch-aware question denominators, unanswered versus skipped semantics, minimum samples and suppression; keep hidden answers out of reports, summaries and exports; preserve historical aggregate-v2 behavior. Qualify reconstruction risks before enabling collection.                  |
| B3: authoring/grant | Add explicit conversion and rule editing, safe reorder/delete/copy behavior with remapped condition IDs, previews and explanations; enable a separate effective writer grant only after B2 and C readers/privacy paths are qualified.                                                                      |

Runtime mutation design must prevent a late acknowledgement or an exact retry from resurrecting
answers cleared by a newer branch change. Reconciliation results replace the current answer map;
they must not be combined with an older saved map. Client operation scope, authoritative revision
and accepted-receipt semantics need paired tests before collection is enabled.

No new participant identity, enrollment, page analytics, notification or external provider is
selected here. Existing native-language, hosted-release and human acceptance gates stay separate
from this contract's automated verification.
