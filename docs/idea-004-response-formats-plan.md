# IDEA 004 richer response formats implementation plan

Updated: 2026-10-13

IDEA-004 adds live multiple-selection opinion polls, ranking, moderated open text, and word clouds.
Implementation was requested on 2026-10-13. Existing research supplies the initial behavior;
implementation needs complete response journeys, compatible storage, and focused verification.
The initial surface is Live Rounds. Other surfaces must explicitly reject formats they cannot
deliver, while their existing supported formats continue to work.

## Customer behavior

| Format                          | Authoring and participant behavior                                                                                                                                         | Results                                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multiple-selection opinion poll | Authors choose a maximum from one to the available options, up to six. Participants select one or more options and explicitly submit when multiple selections are allowed. | Count respondents selecting each option. Percentages use respondents and may sum above 100%.                                                                           |
| Ranking                         | Authors choose full-list ordering or top-N from two to six options. Participants use labelled keyboard move controls and submit an ordered list of distinct option IDs.    | Weight each rank by the number of available options minus the zero-based position. Unranked options receive zero; ties use authored order. Disclose respondent counts. |
| Open text                       | One plain-text response per participant/checkpoint, up to 1,000 characters, with a durable saved receipt.                                                                  | Pending text is moderator-only. Public results contain approved text only.                                                                                             |
| Word cloud                      | One phrase per participant/checkpoint, initially up to 80 characters.                                                                                                      | Group using Unicode NFC, trim/collapse whitespace, and Unicode lowercase. Count approved responses and provide an accessible frequency list beside the cloud.          |

These are opinion interactions: zero points, confidence off, no correctness or learning-recovery
classification, and exclusion from accuracy/recovery denominators. Preserve the five-respondent
minimum for aggregate results. Authorized moderators can review text below that threshold.
Existing facilitator-visible Round aliases retain their current policy; this work does not
introduce organizer-blind anonymity.

## Implementation progress

| Stage                               | Status on 2026-10-13                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live multiple-selection polls       | Implemented locally. Production-browser authoring, submission, refresh and results journeys pass.                                                 |
| Ranking                             | Implemented locally. Full-list/top-N ordering, keyboard/mobile controls, refresh and reports pass.                                                |
| Moderated open text and word clouds | Implemented locally. Private pagination, approval/removal, reconnect, earlier-question moderation, Unicode clouds and approved-only reports pass. |
| Presentation and Survey expansion   | Deferred to a separately selected surface increment.                                                                                              |

## Delivery sequence

### Stage 1 live multiple selection

- Complete contract validation, selection-limit editing, previews, both player variants,
  host/presenter results, reports, and import/export. Removing options clamps the limit;
  reaching it still permits deselection. Refresh restores every accepted selection.
- Freeze protocol requirements from the immutable published content. Extended poll rooms require
  client protocol 3 and `poll.multiselect`. Missing client profiles remain legacy protocol 2.
- Gate new extended Round writes and room creation with `FEATURE_ROUND_CLIENT_PROTOCOL` and the
  core-parity workspace allowlist. Reads and accepted room retries survive disabling the writer gate.
- Introduce Round artifact version 2 and answer response version 3 for extended polls; preserve
  legacy version meanings and reject unknown future versions. Native JSON uses interchange
  version 5; CSV adds an optional selection-limit column. QTI continues to reject opinion polls.
- Explicitly reject unsupported Presentation/Companion/practice paths. Existing Survey
  multiple-selection behavior remains in its separate version 2 workflow.

### Stage 2 ranking

Add the registry entry, draft/publication schemas, an ordered response kind, participant-safe
projections, and frozen client capability. Validate exact top-N/full-list length and distinct
permitted IDs; preserve order in stored responses and retry hashes. Complete keyboard/mobile
authoring-to-report journeys and compatible readers before enabling writers.

Ranking artifacts use version 3, ordered responses version 4, state version 8, native JSON version
6, and Report V6. Required capability is `response.ranking` at client protocol 3. Old artifact,
answer and report readers retain their original meanings.

### Stage 3 moderated text and word clouds

Introduce durable moderation state separately from immutable accepted responses, scoped to
workspace/session/round/answer. Default text to pending; hosts/cohosts approve or remove with
revision fencing and idempotent receipts. Removal is terminal. Public realtime, reconnect,
standard reports, and ordinary account exports exclude pending/removed text; invalidations carry
identifiers only. Render text as text, without attachments, automated grading, or inferred sentiment.
Complete the open-text journey before adding normalized cloud counts and the accessible frequency list.

Text artifacts use version 4, response version 5, state version 9, native JSON version 7, and
Report V7. Protocol 3 requires `response.open_text` or `response.word_cloud` as authored. Text
rooms have at most ten text checkpoints and 250 participants; retained metadata counts all
accepted text responses, including kicked/rejoined audience turnover, against a 250-per-round cap.
State retains at most 2,500 body-free moderation entries and 5,000 command receipts. Missing
metadata fails closed; approval is never reconstructed from accepted bodies.

Hosts/cohosts review a private paginated queue. Public approved-result reads are separately
authorized, reveal-fenced, and require five approved respondents. Main snapshots/events carry no
text bodies, including a participant's own answer; saved/moderation receipt fields support refresh.
Queue/result reads recheck durable versions, and the staff queue rechecks credential revocation.
Client body caches are invalidated on disconnect and require fresh authorized synchronization.
Moderation stops after finish, preserving immutable reports and exact accepted command retries.

### Stage 4 surface expansion and release evidence

Presentations and Surveys need their own response protocols, content versions, moderation, and
report paths. Add them deliberately after Live Round journeys pass. Practice, Recovery Packs,
and Companion insertion require an explicit support decision rather than inheriting new formats
from a shared type union. Existing production, privacy, accessibility, and capacity gates still apply.

## Implementation map

| Area                                                  | Main locations                                                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts and browser compatibility                   | `packages/contracts/src/index.ts`, `packages/contracts/src/round-protocol.ts`                                                                                     |
| Response evaluation, scoring, projections, aggregates | `packages/game-engine/src/index.ts`                                                                                                                               |
| Versioned persistence and migrations                  | `packages/db/src/artifact-schemas.ts`, `packages/db/src/postgres.ts`, `packages/db/src/memory.ts`, `packages/db/migrations/`                                      |
| Writer gates and immutable room requirements          | `apps/server/src/routes.ts`, `apps/server/src/session-service.ts`, `apps/server/src/core-parity-rollout.ts`                                                       |
| Imports, exports, and reports                         | `apps/server/src/portability.ts`, `apps/server/src/reporting.ts`, `apps/server/src/report-worker.ts`                                                              |
| Round authoring, preview, participation, results      | `apps/web/app/quiz/[id]/`, `apps/web/components/editor/`, `apps/web/app/play/[sessionId]/`, `apps/web/app/host/[sessionId]/`, `apps/web/app/present/[sessionId]/` |

## Acceptance checks

`CI=true pnpm check` passes formatting, dependency-context checks, lint, strict types, package and
support tests, and production builds. Current suites include 364 contract, 46 engine, 191 DB unit,
677 server, 857 web and 243 smoke-support tests. The separate restricted PostgreSQL 17 integration
suite has 155 passing tests and one existing skip, including migration replay, workspace isolation,
moderation CAS races, restart and account-export privacy. The isolated test databases were cleaned up.

All 12 final production-browser journeys pass across desktop Chromium, mobile Chromium and mobile
WebKit, covering all formats and client compatibility. Automated axe checks pass for participants,
reports and the moderation region. Visual review verifies readable host moderation cards and
phone ranking columns. New text workflow copy is translated across all ten supported locales;
key/placeholder checks pass. Physical devices, manual assistive technology, native-speaker copy
review, Firefox and external production acceptance remain separate evidence.

Review follow-up: Event-credit setup retains the selected funding allowance, including recipe
changes, while text rooms retain their 250-participant ceiling. Classic reports now display opinion
distributions independently of UX beta; missing distributions still reveal no text. Ten actual-page
report regression tests pass across all four formats and both layouts. Three additional
production-browser checks pass on desktop Chromium, mobile Chromium and mobile WebKit, covering
Free-plan/Event-credit selection, submission, funding changes and the text ceiling in both layouts.

To enable the initial increment, apply migrations 067–069 and deploy matching server, worker and
web readers, then set `FEATURE_ROUND_CLIENT_PROTOCOL=true` and include the workspace UUID in
`CORE_PARITY_WORKSPACE_ALLOWLIST`. Existing deployment configuration was not changed by this work.
See the [upgrade runbook](runbooks/upgrade.md#live-response-format-compatibility) before rollback.

- Contracts: malformed/duplicate/unknown choices, authored bounds, legacy/future versions, ordered
  versus unordered canonicalization, and explicit unsupported-surface behavior.
- Engine/services: deadlines, one accepted response per participant/round, lost receipts,
  reconnect/restart, frozen client requirements, mixed compatibility batches, and zero score impact.
- Database: restricted-runtime writes, workspace isolation, migration repeat/checksums, legacy
  preservation, moderation races, retention/deletion, and rollback reads.
- Reports/privacy: source totals reconcile; opinions stay out of learning metrics; every public,
  reconnect, report, export, and removal path filters text correctly.
- Browsers: editor-to-results for every format, keyboard/phone controls, refresh recovery, limits,
  accessible cloud lists, moderator approval/removal, and automated axe checks.
- Run the repository check before a pull request and focused PostgreSQL/browser suites required
  by changed persistence/response behavior. Record remaining physical-device/manual evidence separately.

## Further research when needed

No new market comparison is a prerequisite for Stage 1. Use targeted usability review for ranking
controls, moderator workload, multilingual cloud normalization, and accessible results as those
stages become concrete. Record findings here and adjust behavior before public rollout.

Ranking controls should work with keyboard input and individual clicks/taps. See the
[W3C dragging guidance](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
and [rearrangeable list example](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/examples/listbox-rearrangeable/)
when validating controls.

Related context: [future ideas backlog](future-product-ideas.md),
[implementation status](implementation-status.md), and the
[existing response architecture](slido-feature-gap-analysis-and-development-plan-2026-10.md#new-response-contracts-and-evidence).
