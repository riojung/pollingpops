# API and realtime reference

REST endpoints are versioned under `/v1`. Shared Zod schemas validate HTTP, realtime,
environment, persisted-version, and webhook boundaries. Errors use:

```json
{ "error": { "code": "STABLE_CODE", "message": "Actionable explanation", "requestId": "..." } }
```

Creator routes use the secure HttpOnly creator cookie. Session, staff, presenter, participant,
embed, and follow-up routes use their own scoped credentials as documented by the returned flow.

## Audience-scope foundation (partial M1)

These additive interfaces do not replace legacy `/v1/sessions/:id/...` routes or game events.
Use `Authorization: Bearer <room credential>`; credentials are never accepted in URLs. Responses
are `private, no-store`. The explicit `kind` selector prevents cross-engine ID ambiguity.

| Interface                                                          | Implemented behavior                                                                                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/audience-scopes`                                         | Body `{kind:"presentation",sessionId,idempotencyKey}` (UUIDs). Native host pass only. Returns 201 on first activation, 200 on retry; scope/event commit atomically.              |
| `GET /v1/audience-scopes/:scopeId?kind=round\|presentation`        | Authorized version-1 metadata, identity disclosure, audience sequence, permissions, and enabled interaction features.                                                            |
| `GET /v1/audience-scopes/:scopeId/availability?kind=presentation`  | Native host/participant/Companion credential. Read-only `{schemaVersion:1,available,activated,canActivate}` discovery; creates no scope. Only a host can activate.               |
| `POST /v1/audience-scopes/:scopeId/sync`                           | Body `{kind,limit?}`; limit 1–50, default 50. Round returns `{scope,round:{interactions,qna}}`; disabled Round Q&A is `null`. Presentation returns `{scope,presentation:{qna}}`. |
| `GET /v1/audience-scopes/:scopeId/qna/questions?kind=presentation` | Authorized version-1 Q&A page; optional cursor and limit 1–50 (default 50).                                                                                                      |
| `POST /v1/audience-scopes/:scopeId/qna/commands`                   | Body `{kind:"presentation",command}`; atomic Q&A mutation. Returns `{receipt,duplicate}` after commit.                                                                           |

Activation requires `FEATURE_AUDIENCE_SCOPES=true` and the workspace in
`CORE_PARITY_WORKSPACE_ALLOWLIST`; its distributed per-credential budget is 20 requests/minute,
in addition to the normal per-IP limiter. The native Presentation host pass is not interchangeable
with a creator cookie or Companion pass. Reads, sync, and accepted activation retries remain
available during writer rollback, but expired/revoked credentials do not.

Audience reads use individual room/credential-hash buckets rather than the generic 300/minute IP
budget. Every read first consumes an independent 10,000/minute IP ceiling, shared across discovery,
scope metadata, Q&A pages and sync, regardless of caller-supplied tokens or scope IDs. Both local
and shared-cache guards run before credential-bucket allocation and repository authentication.
Discovery allows 120 requests/minute; scope metadata, Q&A pages and sync share a separate
720/minute state-read budget. Local and shared-cache limits enforce the same budgets across API
processes. No raw pass or alias appears in a limiter key. Temporary 429/server/network read failures
retry with bounded backoff; authorization and schema failures require a fresh credential or client.

The Presentation scope shares its source session ID, freezes facilitator-visible alias policy and
source retention. Activated scopes now advertise Q&A availability; chat and Pulse remain false.
Presentation host/participant/Companion Q&A panels use native passes and omit creator cookies.
Replies remain pending. Existing Round aliases remain moderator-visible, including
when their public Q&A display is anonymous. Organizer-blind feedback is not implemented yet.

Additive Socket.IO messages:

- `audience.scope.subscribe`: `{kind,scopeId,token}`; acknowledges `{data:{scope}}`.
- `audience.scope.sync.request`: same plus `limit?`; returns the REST sync shape.
- `audience.scope.activated`: `{schemaVersion:1,eventId,scopeId,audienceSeq,serverTime,
type:"audience.scope.activated",payload:{kind:"presentation"}}`.
- `audience.qna.updated`: the same metadata envelope with this type, no question ID/body/author.
  Fetch current authorized Q&A state; removed bodies are never replayed.

Bindings and sequence cursors are separate from game/Presentation control subscriptions. Revalidate
credentials on sync and before delivery. Duplicate outbox deliveries retain `eventId`; consumers
must deduplicate. A reconnect/gap requests current state rather than assuming exactly-once delivery.
Sockets allow at most five scoped subscriptions and twenty scope requests per ten seconds. Only
metadata-only activation and Q&A invalidations are supported; arbitrary/private outbox payloads are
not broadcast. Legacy Round `audience.sync.request`, `qna.*`, and interaction events are unchanged.
Scoped subscription does not yet replace the legacy Round live-event subscription; Round clients
continue using existing session bindings for ongoing Q&A/chat/Pulse updates.

Scope errors include `UNAUTHORIZED` (401), `NOT_FOUND` (404), `ROOM_CLOSED` and idempotency
`CONFLICT` (409), `VALIDATION_ERROR` (400), and `RATE_LIMITED` (429). Messages identify the
credential/rollout/lifecycle problem and a retry or rejoin action. Apply migrations 059–060 and
compatible readers before activation. Surveys, feedback-room admission/settings, scoped chat/Pulse,
Q&A replies and export/share routes are deliberately not registered by this increment.

### Presentation Q&A commands (gated preview)

Every command requires a UUID `idempotencyKey`. Retry the same command/key after network loss.
The receipt is `{schemaVersion:1,idempotencyKey,resourceId,audienceSeq}`. Reusing a key for different
content returns `CONFLICT`. Accepted retries do not increment sequences, votes or action budgets
and never return historical question bodies.

- `question.create`: `{type,idempotencyKey,body}`; participants only; 1–1,000 characters.
  Text is normalized; HTML/invisible controls are removed. Education defaults to premoderation
  and anonymous-public display; workplace to postmoderation and alias-public display. Hosts can
  see aliases in both modes. Replies are disabled in this preview.
- `vote.set`: `{type,idempotencyKey,questionId,voted}`; participants only, public questions only.
  One vote per participant/question; `voted:false` removes it.
- `settings.update`: `{type,idempotencyKey,expectedAudienceSeq,settings}`; host only. Supply
  `{enabled,displayMode,moderationMode,participantReplies:false}`.
- `question.moderate`: `{type,idempotencyKey,expectedAudienceSeq,questionId,status,label,banAuthor}`;
  host only. `label` is null or 1–80 characters. Banning targets the author internally without
  exposing an author identifier. Removed questions cannot be republished.

Use the latest page's sequence for host changes; on conflict refetch and give the revised command
a new key. Pages include `schemaVersion:1`, `lifecycle`, `audienceSeq`, `settings`, `questions`,
and `nextCursor`. Hosts see the moderation queue, participants public/own questions, Companion
public questions only. Removed bodies are blank for everyone. Reads allocate no settings/event.
Finished rooms are read-only while credentials remain valid; accepted receipts remain retryable.
Companion credentials cannot submit, vote, change settings or moderate.

Additional errors: `QNA_DISABLED`, `MODERATION_REQUIRED` (409) and `QNA_RATE_LIMITED` (429).
Durable accepted-action limits are five questions or thirty vote actions per actor/minute;
moderator actions allow 120/minute. Capacity is 200 questions per participant and 2,000 per scope.
A separate shared request limit allows 120 mutation requests per credential/scope/minute,
including retries. These interaction budgets do not increase participant caps or add edition gates.

## Service and feature APIs

- `GET /health/live` — process liveness and the build-time `buildId` used to bind readiness
  evidence to the deployed candidate.
- `GET /health/ready` — active PostgreSQL and Redis-compatible checks; returns 503 without secret
  connection detail when either is unavailable.
- `GET /v1/features` — public URL, edition mode, effective
  signup/session/media/experience/Pulse/chat switches, and deployment-level `uxBeta` and
  `recoveryRehearsal` availability.
- `POST /v1/product-events` — creator-authenticated batch of 1–20 schema-allowlisted beta events;
  accepted names are `creation_started`, `creation_completed`, `round_published`,
  `first_block_created`, `draft_save_failed`, `draft_conflict`, `publish_blocked`,
  `creation_abandoned`, `presentation_host_started`, `presentation_reconnected`,
  `setup_recipe_selected`, `host_setup_completed`, `participant_joined`,
  `first_answer_submitted`, `response_saved_acknowledged`, `question_locked`, `insight_shown`,
  `intervention_started`, `recheck_opened`, `linked_recheck_opened`, `report_reconciled`,
  `report_viewed`, `followup_shared`,
  `practice_assignment_created`, `practice_assignment_shared`, `rehearsal_started`, and
  `rehearsal_completed`. Feature-on plus explicit workspace allowlist
  membership is required; excluded workspaces receive `{ "accepted": 0 }`. `accepted` means the
  events entered the bounded best-effort persistence queue; the request does not wait for storage.
- `GET /metrics` — private Prometheus output when enabled and authorized.

`FEATURE_UX_BETA`, `FEATURE_RECOVERY_REHEARSAL`, `FEATURE_PRACTICE_ASSIGNMENTS`,
`FEATURE_WORKSPACE_SHELL`, `FEATURE_BUILDER_V2`, `FEATURE_PRESENTATIONS`,
`FEATURE_PRESENTATION_REALTIME`, `FEATURE_PRESENTATION_COMPANION`, `FEATURE_LIVE_FLEX_MODE`, `FEATURE_QUESTION_HEALTH`,
`FEATURE_DECISION_REPLAY`, `FEATURE_GROUPS`, and `FEATURE_DISCOVER` default off. These
opt-in switches are independent rollback ceilings. Disabling Presentations blocks
new Presentation authoring; disabling Presentation realtime, or removing its workspace allowlist,
blocks new live-session creation. Existing live sessions, scoped credentials, reports, joins,
commands, responses, and recovery reads remain registered and usable so a rollback cannot strand
an active room or make its evidence unreadable. Disabling Groups removes its collaboration routes.
`FEATURE_PRESENTATION_REALTIME`, `FEATURE_PRESENTATION_COMPANION`, `FEATURE_LIVE_FLEX_MODE`, `FEATURE_QUESTION_HEALTH`, and
`FEATURE_DECISION_REPLAY` require explicit `EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST` membership.
Disabling `FEATURE_LIVE_FLEX_MODE` prevents new flex Rounds or Presentations, but never disables
control, joining, answering, or reporting for an existing flex room. Decision replay eligibility
is resolved by the server and frozen on each new Round session; disabling its creation gate preserves captured evidence and existing reports.
Question Health has separate rollback behavior described below.
The authenticated
`productFeatures` view requires explicit membership in `UX_BETA_WORKSPACE_ALLOWLIST`; an empty
allowlist fails closed and enables no workspace. Presentation authoring, new Presentation-session
creation, Groups, Home, and Library-metadata APIs enforce their applicable workspace eligibility;
a deployment flag alone cannot make new gated content available to an unlisted workspace. Public
Presentation join and participant routes authenticate against the existing session rather than
re-evaluating creation eligibility. Rehearsal requires both flags and allowlist membership.
Standalone practice creation similarly requires the UX beta, its
independent practice flag, and allowlist membership; already-issued participant links and creator
close/revoke controls remain available when creation is disabled.
Because guests do not call `/v1/auth/me`, every role-filtered session snapshot carries the
workspace-resolved `uxBeta` value. The public feature view is deployment availability, not evidence
that a particular workspace is allowlisted.

Product events accept only `creationPath`, `artifactType`, `recipe`, `scenario`, `segment`,
`betaVersion`, and `durationBucket` categorical dimensions. The server replaces `segment` and
`betaVersion` with trusted workspace/release values. Actor/object IDs, content, answers, aliases,
source text, and free-form metadata are rejected. Creation events require `creationPath`; creation
and authoring events require the bounded `artifactType` value (`round` or `presentation`); setup
selection requires `recipe`; both rehearsal events require `scenario`; and rehearsal completion
also requires `durationBucket`. Raw rows expire after 30 days and the same bounded labels feed the
Prometheus counter.
Browser-submitted events remain useful product telemetry but are excluded from the
`openround_recovery_funnel_stages_total` server-recorded gate metric.
Authoritative server transitions emit publish, room-created, join, first-answer, durable-save,
lock/insight, intervention, recheck, ready-report-view, and committed practice-assignment creation
milestones. `followup_shared` and `practice_assignment_shared` are emitted only from an explicit
Copy or link-download action, never merely because a practice link was created.
All product-event writes run through a bounded serial dispatcher, are drained before repository
shutdown, and log failures without delaying or failing the originating product flow.
The retention result/log and `openround_retention_records_total` expose deleted product-event
counts under the bounded `product_event` resource label.

## Authentication, workspaces, and account

- `POST /v1/auth/magic-link`
- `GET /v1/auth/verify?token=...`
- `GET /v1/auth/me` — creator/workspace context, entitlements (including `cohosting`), branding,
  and workspace-resolved `productFeatures` after the partner allowlist and global switches are
  applied.
- `POST /v1/auth/logout`
- `GET /v1/workspaces`
- `POST /v1/workspaces/{id}/select`
- `GET /v1/workspace/members`
- `POST /v1/workspace/invitations`
- `POST /v1/invitations/accept`
- `DELETE /v1/workspace/invitations/{invitationId}`
- `PATCH|DELETE /v1/workspace/members/{userId}`
- `GET|PUT|DELETE /v1/account/theme`
- `GET|PUT /v1/account/embed-origins`
- `GET /v1/account/export`
- `GET /v1/workspace/audit-export?since=...` — contract-gated owner export, at most 10,000
  ordered events with explicit truncation metadata.
- `DELETE /v1/account` with `{ "confirmation": "DELETE" }`

Owners manage members, billing, and workspace deletion. Editors create and host. Viewers have
read-only content/report access. Account export excludes bearer-token hashes and includes
collaboration, Pulse, chat, moderation, Q&A, recovery, follow-up, and authoring records owned by
the workspace.

Account deletion durably marks every owned workspace as deleting before its media object sweep.
That fence rejects new media records and invalidates in-flight finalization commits before account
metadata is cascaded. Any token-scoped object copied by an interrupted finalizer remains tagged
temporary and is removed by the bucket lifecycle even if the account row no longer exists.

## Institution identity and LTI APIs

These routes are disabled by default and require an operator-granted workspace policy. Enabling a
creator integration does not change anonymous guest participation.

- `GET /v1/workspace/institution-policy` — authenticated read-only capability policy; owners
  cannot self-enable it. `GET /v1/workspaces` carries the home-region assignment.
- `GET /v1/auth/oidc/status?workspaceId=...`
- `POST /v1/auth/oidc/start` with `mode=login|link`
- `GET /v1/auth/oidc/callback` — authorization-code callback with one-time state, PKCE, and nonce.
- `GET /v1/auth/federated-identities`
- `DELETE /v1/auth/federated-identities/{identityId}`
- `GET /v1/lti/jwks` — public half of the active tool signing key only.
- `POST /v1/lti/login` — third-party-initiated login (`application/x-www-form-urlencoded`).
- `POST /v1/lti/launch` — platform-signed form-post launch.
- `POST /v1/lti/link` — explicit link of a verified LMS subject to the current creator.
- `GET /v1/lti/launches/{launchId}`
- `POST /v1/lti/launches/{launchId}/deep-link`
- `GET /v1/workspace/lti-registrations` — owner-visible, read-only registration inventory.

OIDC login accepts only a previously linked workspace/issuer/subject identity; email hints never
create a link. LTI validates issuer, audience/authorized party, nonce, deployment, version, message
type, signed target, role, and registration. Deep Linking supports a single published
`ltiResourceLink` and returns the same signed result on retry. Instructor launches are supported;
learner launches, NRPS, and AGS are deliberately rejected in this release.

## Round and portability APIs

Legacy `/v1/quizzes` naming is intentionally stable through v1 even though the UI says **Round**.

- `GET /v1/starters` — six immutable, versioned first-party starter summaries.
- `POST /v1/starters/{id}/use` — owner/editor creation of a normal draft with fresh Round,
  question, and choice IDs while preserving linked-recheck relationships.
- `GET|POST /v1/quizzes`; `GET` accepts `archived=true|false` and `summary=true|false`. Normal
  library rows include the tenant-scoped `lastHostedAt` across retained versions; `summary=true`
  returns only each Round's `id` and `title` for filter controls.
- `GET|PATCH /v1/quizzes/{id}` — draft replacement on the legacy path remains supported, but the
  `PATCH` body must be `{ draft, expectedDraftRevision }`; unfenced writes return
  `PRECONDITION_REQUIRED`.
- `PUT /v1/quizzes/{id}/draft` — revision-fenced, idempotent Builder save with
  `{ draft, expectedRevision, mutationId, schemaVersion }`.
- `POST /v1/quizzes/{id}/publish` — requires `expectedDraftRevision` and atomically publishes that
  exact acknowledged draft revision.
- `GET /v1/quizzes/{id}/history`; `POST /v1/quizzes/{id}/history/{revision}/restore`
- `POST /v1/quizzes/{id}/duplicate`
- `POST /v1/quizzes/{id}/archive`
- `GET|POST /v1/folders`
- `PATCH|DELETE /v1/folders/{id}`
- `PATCH /v1/quizzes/{id}/organization`
- `POST /v1/quizzes/import` for `bulk`, `csv`, `openround_json`, or base64 `qti3`
- `GET /v1/quizzes/{id}/export.json`
- `GET /v1/quizzes/{id}/export.csv`
- `GET /v1/quizzes/{id}/export.qti.zip`

Authenticated `GET /v1/quizzes` library reads, including `summary=true`, and
`GET /v1/quizzes/{id}` detail reads are tenant-scoped and return `Cache-Control: private,
no-store` with `Pragma: no-cache`. The UX-beta private question picker uses those existing reads and
the normal draft `PATCH`; it appends fresh-ID independent copies in the browser, remaps a valid
main-to-recheck link to the copied recheck, and does not mutate or synchronize with the source
Round. There is no separate question-bank API or shared question identity.

Imports always return a validation report. Polling Pops JSON is lossless and versioned. The QTI 3
profile supports single select, true/false, multiple select, and numeric response; unsupported
types and omitted media are explicit warnings/errors. CSV output escapes spreadsheet formula
prefixes.

## Question Health APIs

Question Health evaluates saved Round content with deterministic, versioned rules. Findings have
`severity: "advisory"` and do not block publication. Reads are creator-authenticated and
workspace-scoped; mutations require an owner/editor. Responses use `Cache-Control: private,
no-store` and `Pragma: no-cache`.

- `GET /v1/quizzes/{id}/question-health` — saved-draft findings, `draftRevision`,
  `rulesetVersion`, matching dismissals, and explicit `findingsTruncated`; returns a draft ETag.
  Evaluation is bounded to 200 questions and 1,000 findings.
- `GET /v1/quizzes/{id}/versions/{versionId}/question-health` — findings for the exact immutable
  published version, with version identity/hash and `source: "published"`. Draft dismissals do not
  apply, and the version must belong to the Round in the URL.
- `GET /v1/quizzes/{id}/versions/{versionId}/question-health/observations` — aggregate post-use
  evidence for that exact published version.
- `PUT /v1/quizzes/{id}/question-health/dismissals/{findingId}` — record a dismissal with
  `{ ruleVersion, rulesetVersion, contentHash, draftRevision, reason }`. Reasons are
  `false_positive`, `intentional_choice`, or `will_address_later`.
- `DELETE /v1/quizzes/{id}/question-health/dismissals/{findingId}` — reopen the finding using the
  same identity and revision fields, without `reason`.
- `POST /v1/quizzes/{id}/question-health/findings/{findingId}/preview` — submit the finding
  identity, `draftRevision`, and `action`; return one or two before/after field changes without
  saving them.
- `POST /v1/quizzes/{id}/question-health/findings/{findingId}/apply` — the preview body plus a
  UUID `mutationId`; atomically save a new draft revision, history, mutation receipt, application
  provenance, and audit event. Returns the authoritative `quiz`, `applicationId`,
  `appliedRevision`, and changes.
- `POST /v1/quizzes/{id}/question-health/applications/{applicationId}/undo` —
  `{ expectedRevision, mutationId }`; restore the source draft as a new revision only while the
  application's applied revision is still current. A later edit prevents undo with a conflict.

A finding identity includes its rule/ruleset versions and content hash. Dismissals appear only
while that identity still matches the saved content. Preview/apply reevaluate the saved finding,
require the acknowledged revision, and require the proposed edit to resolve its original rule.
Allowed actions are `align_opinion_settings`, `set_explanation`, `set_choice_feedback`,
`set_choice_label`, `set_prompt`, and `set_recheck_prompt`; published versions and question/choice
IDs remain unchanged. Stale identity/revision or reused mutation IDs with different input return
`409`; unsupported or unresolved edits return `422`. Identical apply/undo retries return current
Round state, even after a newer edit, rather than presenting an old receipt snapshot as current.

New evaluation, dismissal, preview, and apply actions require the Question Health flag and
allowlist. After rollback, matching stored draft dismissals can still be read and reopened, and
accepted application retries and undo remain available. Published evaluation and observation
reads require current eligibility.

Post-use observations select at most 250 recent ready reports from retained sessions for the exact
version and expose `history.hasMoreReports`. They consider scorable main questions only and keep
learning/verified, timed/flex, and accuracy/speed cohorts separate. Each included question/session
sample needs at least 20 responses. Instability requires at least three compatible sessions and a
range of at least 30 percentage points; an unused incorrect choice requires complete choice
coverage across the selected eligible samples. Output contains aggregate counts and descriptive
advisories, without learner rows, aliases, or raw answers. It does not establish causation or
learning efficacy.

## Presentation authoring and Library APIs

- `GET|POST /v1/presentations`; `GET` accepts `archived=true|false`.
- `GET /v1/presentations/{id}` — saved draft and version metadata, with a draft ETag.
- `PUT /v1/presentations/{id}/draft` — fenced, idempotent save with
  `{ draft, expectedRevision, mutationId, schemaVersion: 2 }`.
- `POST /v1/presentations/{id}/publish` — publish the exact `expectedDraftRevision`.
- `GET /v1/presentations/{id}/history`;
  `POST /v1/presentations/{id}/history/{revision}/restore`
- `POST /v1/presentations/{id}/blocks/import` — copy 1–50 selected `questionIds` from an exact
  `sourceQuizVersionId`, using `expectedRevision`, `mutationId`, and optional `afterBlockId`.
  Selecting either side of a linked Recovery pair copies the pair in source order, with fresh
  block/question/choice IDs, remapped links, and source provenance. Copies are independent.
- `PATCH /v1/presentations/{id}/organization`; `POST /v1/presentations/{id}/archive`
- `GET /v1/library/favorites` — the current workspace member's private favorites.
- `PUT /v1/library/favorites/{artifactType}/{artifactId}` with `{ favorite: boolean }`, where
  `artifactType` is `round` or `presentation`. Adding a favorite requires an existing item in the
  same workspace; favorites never grant content access.
- `DELETE /v1/quizzes/{id}`; `DELETE /v1/presentations/{id}` — owner-only permanent deletion of
  archived Library content under its workspace and Presentation gates. Success returns `204`;
  missing/foreign items return `404`; unarchived items return `409 ARTIFACT_NOT_ARCHIVED`.
  Any retained session or practice assignment prevents deletion with `409 ARTIFACT_IN_USE`,
  including finished/expired sessions and closed assignments. Delete associated sessions first;
  content needed by an assignment must remain archived until that dependency is removed.

Presentation authoring and organization mutations require an owner/editor and the applicable
authoring/workspace gates. Permanent deletion requires an owner. Existing list/detail reads remain available after authoring rollback and return private, no-store
responses. Permanent deletion atomically removes drafts, immutable versions, history, mutation
receipts, Question Health records where applicable, every member's favorites, group links/schedule
entries, and content media references. It preserves unrelated content and media assets; removing a
reference does not itself delete its stored image. Successful deletions are audited.

Presentation content schema v2 stores `textElements` with stable string IDs, a `title` or `body`
role, one of nine `top|middle|bottom` × `left|center|right` regions (such as `top_left`), and
integer `order` 0–7. IDs are nonempty strings of at most 200 characters. A slide has **one to eight text elements total, including exactly one title**. IDs and
`(region, order)` pairs must be unique within the slide. Title text is at most 160 characters and
body text at most 4,000. Layout is `title`, `title_body`, `media`, `quote`, `section`, or `callout`.
Optional `frame: { x, y, width, height }` values are finite canvas percentages: coordinates 0–100, width 12–100, height 6–100, and the rectangle must fit inside the
canvas. Arbitrary CSS is not accepted. Drafts may keep empty text or incomplete image descriptions;
publishing requires slide text or an image, and nonblank `mediaAlt` for an image. A Presentation
contains at most 200 blocks and publication requires a valid interactive main question.

Read upcasters project legacy content-slide `title`/`body` fields into v2 text elements with
stable IDs; they do not rewrite immutable published rows. Unsupported future schema versions fail
closed. Public live content projections include layout, text elements, media ID, and image alt,
while excluding speaker notes, citations, and source disclosure.

## Source-grounded authoring APIs

- `GET /v1/authoring/status` — configured state and current monthly usage.
- `GET /v1/authoring/jobs`
- `POST /v1/authoring/jobs` — pasted text or base64 PDF/DOCX/PPTX; returns 202.
- `GET /v1/authoring/jobs/{id}`
- `POST /v1/authoring/jobs/{id}/apply` — idempotently creates one unpublished review draft.
- `POST /v1/authoring/jobs/{id}/apply-presentation` — creates an unpublished mixed Presentation
  from the explicitly selected content-slide proposals and Recovery questions; an omitted
  selection preserves the select-all legacy behavior.
- `POST /v1/presentations/{id}/blocks/source-proposals` — revision-fenced insertion after an
  optional block. The request carries the authoring job, selected proposal IDs, expected draft
  revision, and mutation ID; retries are idempotent and every inserted block/question/choice gets
  a fresh ID with Recovery links remapped inside the inserted selection.

Uploaded files are limited to 6 MB. Arbitrary URLs are rejected. A disabled deployment returns
`AUTHORING_DISABLED` before storing the source. Hosted monthly limits return `AUTHORING_LIMIT`.
Jobs expose no retained raw source through ordinary API views. Output is schema- and
citation-validated and includes bounded, reviewable content-slide excerpts derived directly from
extracted sections plus the linked Recovery pair. Each proposed block retains citations and
provider/model disclosure. Nothing mutates an artifact until a creator confirms a proposal
selection, and source-created artifacts remain unpublished drafts.

## Media APIs

- `POST /v1/media` — constrained signed quarantine upload.
- `POST /v1/media/{id}/complete` — verify metadata/bytes/signature, scan, and promote clean data.
- `GET /v1/media/{id}` — creator-scoped signed clean-object URL.
- `DELETE /v1/media/{id}` — owner/editor logical deletion for unreferenced workspace media.
- `GET /v1/sessions/{sessionId}/media/{mediaId}` — authorized frozen-session media.
- `GET /v1/followups/{id}/media/{mediaId}` — current follow-up checkpoint media.

Pending, rejected, or deleting media is never returned by a read endpoint. DELETE rejects media
that still has a durable content reference, immediately blocks completion/download/reference
creation, and retains an internal tombstone beyond the ten-minute presigned-upload lifetime.
Retention performs a second object sweep before removing that metadata; a successful DELETE means
the public metadata is unavailable, not that the internal tombstone has already been purged.
Abandoned quarantine uploads and temporary finalization candidates also have bucket lifecycle
expiry. This deferred physical cleanup prevents a late PUT or stale finalizer from recreating a
permanent untracked object.

## Live session, staff, presenter, and embed APIs

- `GET /v1/sessions` — tenant-scoped summary history with status, Round, and date filters.
- `POST /v1/sessions`
- `GET /v1/sessions/join/preflight?code=...` — rate-limited, non-mutating nickname-policy lookup
  for the join form.
- `POST /v1/sessions/join`
- `GET /v1/sessions/{id}/snapshot?role=...`
- `POST /v1/sessions/{id}/commands`
- `POST /v1/sessions/{id}/answers`
- `POST /v1/sessions/{id}/control-pass` — owner/editor secure resume for an active room.
- `DELETE /v1/sessions/{id}` — owner-only deletion of a Round session, its answers, report,
  and linked follow-ups.
- `DELETE /v1/presentation-sessions/{id}` — owner-only deletion of a finished or expired
  Presentation session and its responses, report, credentials, and room-code claim.
  Returns `204`, tenant-scoped `404`, or `409 CONFLICT` for an active, unexpired room.
  Eligibility uses durable status/`liveExpiresAt`, checked atomically with deletion.
- Session staff credential creation/list/revocation routes under `/v1/sessions/{id}/staff`
- Presenter/embed policy issuance under the session routes
- `GET /v1/embed/policies/{sessionId}/{policyKey}`

Presentation REST endpoints additionally include:

- `GET|POST /v1/presentation-sessions` — creation accepts `presentationId` and optional
  `timeMode`; the private list returns `{ sessions }` with an additive `liveExpiresAt` field,
  including retained expired rooms.
- `GET /v1/presentation-sessions/{id}` — creator host snapshot.
- `POST /v1/presentation-sessions/{id}/advance` with `expectedRevision`.
- `POST /v1/presentation-sessions/{id}/control-pass`;
  `DELETE /v1/presentation-sessions/{id}/control-passes/{credentialId}`
- `POST /v1/presentation-sessions/join`;
  `GET /v1/presentation-sessions/{id}/participant`
- `POST /v1/presentation-sessions/{id}/responses` — scoped participant credential,
  idempotency key, and validated response payload; acknowledge only after durable commit.
- `GET /v1/presentation-sessions/{id}/host-media/{mediaId}`;
  `GET /v1/presentation-sessions/{id}/media/{mediaId}` — role-scoped frozen media access.
- `GET /v1/presentation-sessions/{id}/report` — private creator response; `202` while pending
  without a report, otherwise `200`. The default strict envelope and stored Presentation Report V1
  remain compatible.

New Presentation rooms require their workspace and realtime creation eligibility. Creator control
requires an owner/editor; guest routes use session-scoped credentials. Deleting a room disconnects
its sockets through the shared adapter and removes credentials, pending broadcasts, and durable
report work. In-flight projections and report completions recheck durable existence so deletion
cannot recreate the room or its report.

Live Round creation accepts `settings.timeMode: "timed" | "flex"`; omission preserves the
existing timed behavior. Flex is frozen at creation: an open question has no deadline, the host
closes it, and speed scoring is replaced by accuracy scoring. This applies to the whole room,
including linked rechecks and revotes; there is no per-question timed/flex override. Timed and flex
Round snapshots and ready reports expose their effective `timeMode`. Live Presentation creation likewise accepts a
top-level `timeMode` and defaults to timed. Its flex questions have no `questionClosesAt` and
remain open until the host reveals/closes them. Both creation paths require the deployment flag
and workspace allowlist for flex; existing rooms remain usable if eligibility changes later. The
stored Presentation V1 report and default report response remain unchanged for strict legacy
readers; `GET /v1/presentation-sessions/{id}/report?includeSessionContext=true` adds
`sessionContext.timeMode` to an opt-in response.

`POST /v1/sessions/join` accepts an optional `JoinRequest.avatarId` from the fixed, content-free
allowlist `comet`, `fox`, `owl`, `otter`, `panda`, `robot`, `rocket`, and `star`. Omitting it keeps
older clients compatible: after allocating the participant UUID, the server deterministically
selects one of the same valid IDs. An unrecognized value fails request validation. The selected or
fallback ID is stored in canonical game state and survives refresh/reconnect; a reconnect cannot
replace it. Participant, staff-audience, and report DTOs expose `avatarId` additively so legacy
payloads remain readable. Host and presenter snapshots, moderator audience views, and authorized
reports may show session avatars. In private-result participant snapshots, only the requesting
participant's avatar remains visible; every other participant's avatar is suppressed.

Host commands carry `commandId` and `expectedVersion`. Recovery actions include
`intervention.start`, `intervention.finish`, and `recheck.open`; the engine validates when peer
discussion, explain/example/break, linked recheck, or revote is legal. A dedicated presenter or
embed credential is read-only and never reuses the host token.

Shareable cohost credential creation requires the `cohosting` entitlement (Pro, Team, or Community);
presenter credentials remain core. Staff credential views include
`purpose: collaboration | creator_resume`. A creator control pass is a host-equivalent cohost
credential with purpose `creator_resume`, expires after four hours or at session expiry (whichever
comes first), and does not depend on the cohosting entitlement. Issuing another pass for the same
creator/session atomically revokes the prior one. The response is `Cache-Control: private,
no-store`; clients keep its bearer only in session storage and never place it in a URL.

Join preflight accepts only a seven-digit code, is limited to 20 requests per minute, returns
`Cache-Control: no-store`, and exposes only `nicknamePolicy` for a joinable room. Invalid, expired,
locked, full, finished, and institution-restricted rooms all return the same `INVALID_CODE`
response. It creates no participant, changes no session version, and reveals no title, workspace,
phase, capacity, or participant count.

After lock/reveal, staff snapshots may include an additive `responseDistribution` only when at
least five people answered. Choice and rating payloads contain aggregate buckets; multi-select uses
`percentBasis: respondents`; numeric payloads expose only correct/incorrect totals. Participant
snapshots never contain this field.

Normal routes deny framing. `/embed/present/{sessionId}` is constrained by a server-issued policy
and the workspace's allowlist of at most ten HTTPS origins.

## Round Experience and audience interaction APIs

- `GET /v1/experience-presets` — immutable public registry summaries and validated semantic
  tokens.
- `GET|PATCH /v1/sessions/{id}/interactions/settings`
- `GET /v1/sessions/{id}/interactions/summary`
- `GET /v1/sessions/{id}/interactions/sync?limit=...`
- `PUT /v1/sessions/{id}/signals/current`
- `GET|POST /v1/sessions/{id}/chat/messages`
- `PATCH /v1/sessions/{id}/chat/messages/{messageId}`
- `PUT|DELETE /v1/sessions/{id}/chat/messages/{messageId}/reaction`
- `POST /v1/sessions/{id}/chat/messages/{messageId}/report`
- `PATCH /v1/sessions/{id}/interactions/participants/{participantId}`

Interaction synchronization includes `capabilities.audiencePulse` and `capabilities.roomChat` so
clients can disable unavailable controls instead of treating a rollout gate as a session setting.

Round drafts and Polling Pops JSON v2 carry `category` and `{ id, version }` experience preset
metadata. JSON v1 remains importable and defaults to General/Focus with a visible validation
warning. `POST /v1/sessions` may carry a one-session preset override and presenter-sound choice;
its returned snapshot contains the frozen validated theme.

Interaction list endpoints use opaque cursor pagination and accept at most 50 rows. Mutations use
idempotency keys—inside the validated Pulse/chat body where specified, otherwise in
`x-idempotency-key`. A durable acknowledgement includes the newly allocated audience sequence.
Presenter credentials are read-only. Chat begins disabled, supports only plain text, and limits
replies to one level. Private-at-creation aliases remain anonymous on every non-moderator read even
after the current identity setting changes.

Participant summaries return only that participant’s own current signal. Public/presenter signal
counts are null until five unique participants have signalled in the current context. Host/cohost
summaries additionally include participant activity and moderation projection but never individual
answer content or correctness while a checkpoint is open.

## Q&A APIs

- `GET|POST /v1/sessions/{id}/qna/questions`
- Reply creation under `/v1/sessions/{id}/qna/questions/{questionId}/replies`
- Vote add/remove under a question
- Question moderation under `/v1/sessions/{id}/qna/questions/{questionId}`
- Reply moderation under `/v1/sessions/{id}/qna/replies/{replyId}`
- Creator/staff Q&A settings routes under the session

Lists use cursor pagination. Questions use `pending | published | answered | dismissed | removed`;
replies use `pending | published | removed`. Stable errors include `QNA_DISABLED`,
`MODERATION_REQUIRED`, and `QNA_RATE_LIMITED`. Unique participant votes, sanitization, limits,
moderation, kick/ban, retention, export, and deletion are enforced server-side.

## Reports and self-paced practice APIs

- `GET /v1/sessions/{id}/report`
- `GET /v1/reports` — tenant-scoped recovery-oriented result summaries; filters are
  `status=pending|ready|failed`, `quizId`, `from`, and `to`.
- `GET /v1/reports/{id}`
- `GET /v1/reports/{id}.csv`
- `GET /v1/reports/{id}.json`
- `GET /v1/reports/{id}/interactions`
- `GET /v1/reports/{id}/interactions.csv`
- `POST /v1/reports/{id}/followups`
- `POST /v1/quizzes/{id}/practice-assignments` — create an immutable standalone assignment from
  the reviewed published version identified by the required `sourceQuizVersionId`; returns `409`
  if that version is no longer current, and returns the generic link and any requested labelled
  one-attempt links exactly once.
- `GET /v1/followups` — tenant-scoped recovery-follow-up and standalone-assignment summaries and
  attempt counts; filters are
  `purpose=recovery|assignment`, `status=scheduled|open|closed|expired`, `quizId`, `from`, and `to`.
- `GET /v1/followups/{id}` — creator view, immutable Round/version context, aggregate progress, and
  access management; bearer tokens and answer bodies are never returned.
- `POST /v1/followups/{id}/personal-passes` — create a labelled, revocable, single-attempt link for
  a standalone assignment; the bearer URL is returned exactly once.
- `POST /v1/followups/{id}/accommodation-passes`
- `DELETE /v1/followups/{id}/access/{accessId}`
- `POST /v1/followups/{id}/close`
- `POST /v1/followups/{id}/start`
- `GET /v1/followups/{id}/snapshot`
- `POST /v1/followups/{id}/answers`
- `POST /v1/followups/{id}/advance`

Finished rounds create pending versioned reports. Until the worker completes, export returns a
conflict with an actionable “still being generated” message. Report v3 derives from durable rows,
not cached historical state, and adds the frozen experience plus aggregate Pulse, chat, reaction,
report, and moderation evidence. Sessions created with decision replay enabled produce Report v4,
which extends v3 with `decisionTimeline`, `decisionReplayAvailable`, and `decisionReplayComplete`.
Report v1–v3 remain renderable; sessions without capture retain v3 output. The standard report omits
raw chat and participant-level signals; the transcript requires report access, CSV follows the export
entitlement, and revealing removed bodies additionally requires owner/editor audit access.

Decision capture is server-resolved at Round creation and never backfilled into older sessions.
The durable timeline records accepted insight/reveal, intervention, recheck/revote, question-advance,
and finish decisions with server timestamps and sequence numbers, without prompt text, raw answer
bodies, or aliases. It is bounded to 5,000 events plus an optional `capture_truncated` marker.
Availability/completeness flags distinguish missing or truncated evidence from a complete trail.
Existing report/detail/JSON/CSV routes serve the versioned report; there is no separate replay API.
This facilitator decision trail is separate from realtime reconnect replay.

Practice start accepts a generic, personal, or accommodation bearer and returns the credential to
use for that attempt. Generic access receives a separate client- or server-generated resume
credential. A personal or accommodation bearer is also its attempt credential so repeated starts
deterministically resume its one allowed attempt. Attempt answer and advance calls require the
returned credential. Generic links create unpaired anonymous attempts. Standalone assignments
clone only the published version's main questions: linked conditional rechecks stay in the live
Recovery Loop and are not made unconditional practice. All timing, resume, completion,
idempotency, revocation, and expiry are server-owned.

The session, report, and follow-up history endpoints return `{ items, nextCursor }`, default to 25
rows, cap at 50, and order by `(createdAt DESC, id DESC)`. Cursors are opaque base64url values;
malformed cursors return a validation error. These endpoints expose summaries only—never answer
bodies, aliases, chat content, or state snapshots. Report detail keeps the versioned `report` and
adds Round/session context (`quizId`, `quizTitle`, `sessionCreatedAt`, `sessionUpdatedAt`) when
available. Recovery-follow-up creation accepts ready Report V2, V3, and V4 evidence. Standalone
assignment creation and personal-link issuance require the independent practice-assignment beta
feature plus the workspace beta allowlist; existing practice remains manageable and answerable if
that creation switch is later disabled.

## Billing APIs

- `GET /v1/billing/status`
- `POST /v1/billing/checkout`
- `POST /v1/billing/portal`
- `POST /v1/webhooks/stripe`

Stripe webhooks require a verified signature and apply provider event identity plus event ordering
idempotently before changing entitlements. Billing remains disabled in community mode.

## Realtime interface

Round game messages carry `eventId`, `sessionId`, `sessionVersion`, `seq`, `type`,
`schemaVersion`, `serverTime`, and a validated role-filtered `payload`.

Required client messages are:

- `session.join`
- `answer.submit`
- `host.command`
- `sync.request`

Principal server messages are:

- `lobby.updated`
- `question.open`
- `question.locked`
- `question.reveal`
- `leaderboard.updated`
- `session.snapshot`
- `game.finished`
- `qna.question.*`, `qna.reply.*`, and `qna.vote.updated`

Client acknowledgements return `{ data }` or `{ error: { code, message } }`. An answer uses the
canonical versioned response payload plus confidence; legacy `choiceId` remains accepted for
single-select/true-false clients and is canonicalized. Keep idempotency keys until acknowledged.

After reconnect, send `sync.request` with the last observed sequence. The response includes a
role-filtered authoritative snapshot, bounded replay metadata, and `replayComplete`. Treat the
snapshot as authoritative whenever the journal cannot cover the full gap.

Audience interaction uses an independent `audienceSeq` and envelope with `eventId`, `sessionId`,
`schemaVersion`, `serverTime`, `type`, and role-filtered payload. Server events are:

- `audience.settings.updated`
- `audience.signal.updated` for host/cohost projection only
- `audience.summary.updated`, coalesced for public aggregate projection
- `chat.message.created|updated|removed|pinned`
- `chat.reaction.updated`
- `audience.moderation.updated`
- `audience.event`, carrying sequenced `qna.*` envelopes during the compatibility release

Send `audience.sync.request` with the last audience cursor after reconnect or a gap. The response
contains current settings, visible recent messages, aggregate signal state, the participant’s own
signal where applicable, and moderation state. Clients deduplicate at-least-once delivery by
`eventId`. Existing direct `qna.*` notifications remain available for compatibility while the same
committed Q&A changes also advance the audience cursor through `audience.event`.

### Presentation realtime

Presentation uses its own strict protocol. Clients send `presentation.join`,
`presentation.sync.request`, `presentation.command`, and `presentation.response.submit`.
Server events are `presentation.session.updated` and `presentation.room-status.updated`; envelopes
carry `{ eventId, sessionId, revision, seq, type, serverTime, payload }`. They do not use the Round
`sessionVersion`/`schemaVersion` envelope fields.

Sync requests contain `sessionId`, `afterSeq`, and a `projection` of `host`, `participant`, or
`companion`, with the matching `controlToken`, `participantToken`, or `companionToken`. The response
contains `{ resetRequired, events, snapshot }`, with at most 1,000 role-filtered replay events and
an authoritative role snapshot. Honor the revision and stream sequence independently; use the
snapshot when a reset is required. An advance command includes `commandId`, `expectedRevision`,
and `action: "advance"`; response submission uses an idempotency key. Credential scope and phase
projection prevent participants/companions from receiving unrevealed answers or authoring notes.

### Presentation Companion foundation

- `POST /v1/presentation-sessions/{id}/companion-pass` — owner/editor issuance, returning
  `{ credentialId, companionToken, expiresAt }`. Requires professional Presentation eligibility,
  both `FEATURE_PRESENTATION_REALTIME` and `FEATURE_PRESENTATION_COMPANION`, and explicit evidence
  workspace membership. Rotates only the companion role; the host control pass is unchanged.
- `DELETE /v1/presentation-sessions/{id}/companion-passes/{credentialId}` — owner/editor revocation,
  restricted to the companion role. Available even when new issuance is paused.
- `GET /v1/presentation-sessions/{id}/companion` — bearer companion pass, returning `{ snapshot }`.
  Add `includeQuickChecks=true` and/or `includePublishedQuestions=true` to opt independently into
  the Quick Check/published-question capability fields. Default reads preserve the legacy strict shape.
- `GET /v1/presentation-sessions/{id}/companion-recovery-packs` — bearer companion pass,
  returning a bounded `{ packs: [{ packId, packVersionId, packVersion, title }] }` catalog of
  current published, text-only versions in the session's workspace. Drafts, checkpoints,
  interventions, citations, and source-review data are not returned.
- `GET /v1/presentation-sessions/{id}/companion-published-questions` — bearer companion pass,
  returning `{ questions, hasMore }`, at most 100 matching questions from current published,
  non-archived Rounds in the session's workspace. Optional `search` is trimmed, limited to 100
  characters, and matches literal case-insensitive title/prompt substrings (not SQL wildcards).
  Each item contains only `sourceQuizId`, `sourceQuizVersionId`, `sourceQuizVersion`,
  `sourceQuestionId`, `contentHash`, `title`, `prompt`, and `type`. The hash identifies the exact
  immutable Round version. Refine search when `hasMore` is true. Keys, choices, explanations,
  concepts, citations, media, and draft content are never returned. Rechecks, linked sources,
  Pack-derived questions, and media-backed items are excluded. All current non-archived source
  schema versions are checked before JSON interpretation, search, eligibility, or the result cap;
  unsupported versions fail the catalog read rather than appearing as an empty catalog.
- `POST /v1/presentation-sessions/{id}/companion-command` — strict
  `{ sessionId, companionToken, commandId, expectedRevision, action, ...actionFields }`, returning
  `{ snapshot }`. Actions are `advance`, `insert_recovery_pack` with `packVersionId`, and
  `start_recovery_card` with `recoveryPackCard: { insertionId, cardId }` and
  `interventionType: "explain" | "example"`, and `insert_quick_check` with
  `quickCheck: { prompt, choices, timeLimitSeconds }`. Quick Checks accept a 1–500-character
  prompt, 2–6 distinct 1–180-character choice labels, and an integer 10–300-second limit.
  Prompt/labels are trimmed; choice uniqueness ignores Unicode compatibility, case, and repeated
  whitespace. Correctness, scoring, media, identity, and other extra fields are rejected.
  `insert_published_question` accepts only
  `publishedQuestion: { sourceQuizVersionId, sourceQuestionId, contentHash }`; the server resolves
  and validates that exact retained version. The client cannot supply question content or keys.
  The same commands are accepted by
  `presentation.command` over Socket.IO.
  Add `includeQuickChecks=true` and/or `includePublishedQuestions=true` to the REST command URL
  to receive the respective capability fields; default acknowledgements retain the legacy shape.

Passes expire after at most one hour and never outlive the live session. Tokens are hashed in the
existing tenant-scoped credential store; responses are private/no-store and admission controls
are session/credential-scoped. Read, command, synchronization, and revocation paths remain usable
after flag/allowlist rollback for existing valid passes. New Pack insertion/catalog access require
current professional Presentation, Companion/realtime, Pack/live-card, and workspace eligibility,
plus a session created with live Pack cards enabled. Exact accepted insertion retries and already
frozen card playback remain available during rollback. A companion cannot use a host-only
credential, change settings, kick participants, or retrieve identities.

Companion snapshots contain a participant-safe current block and aggregate room counts. Optional
`resultSummary` contains only `{ blockId, responseCount, choiceCounts: [{ choiceId, count }] }` for
the current question after reveal. It contains no correctness, keys, explanations, citations,
participant responses, raw numeric/rating values, or leaderboard. Before reveal it is `null`.
The browser consumes `#pass=...`, removes it from URL history before requests, and keeps the pass
in session storage, with no inherited host passes or creator cookies on companion API fetches.

Optional `canInsertPublishedQuestion` uses the same safe closed-boundary/pending-recheck fence.
New catalog access and insertion require current professional Presentation, Companion/realtime,
and workspace eligibility, independently of Pack flags and the Pack session-creation latch.
Only standalone text-only main questions are eligible, including supported choice, numeric,
poll, and rating types. Both outgoing and incoming recovery links and Pack provenance are
excluded. A selected retained version remains valid after a newer publication, but new insertion
requires a still-present, non-archived workspace source and an exact version hash.
Source eligibility is revalidated and locked in the insertion transaction through the state,
timeline, and receipt commit. An archive or delete that wins the race rejects the new insertion
without partial writes; accepted receipt recovery does not require the source to remain present.

The command freezes the full published question, derives new destination IDs, retains existing
block provenance, and records `livePublishedQuestions` with command/block/source Round/version/
question IDs, version number, and version hash. This metadata exists only in live snapshots,
survives durable reads/restoration, and is not copied into authoring drafts. Content, timer,
revision, sequence, event, and receipt commit atomically. Existing sources/drafts remain unchanged.
Timed/flex behavior and ordinary scoring/confidence follow the frozen question and room settings.
Reports use existing question evidence with no new provenance fields or schema version; this
standalone insertion creates no linked/paired recovery claim. Existing snapshots retain the
internal provenance for session export and retention/deletion with their parent session.

Exact receipt recovery occurs before source, phase, gate, or stale-revision rejection, including
after source deletion and feature rollback. New commands cannot interrupt open responses,
interventions, or pending linked rechecks. Limits remain 100 live blocks/insertions and the existing
size bound. Best-effort audit action `presentation.session.published_question.insert` records IDs
only, never question bodies or participant data; version/hash provenance remains frozen in the snapshot.

Optional `canInsertRecoveryPack` is the server-authoritative insertion capability. Insertion is
allowed in the lobby, on a content block, or after a closed question only when no previously
visited source question has a linked recheck still ahead, including practice-purpose sources.
Intervening content or standalone questions
do not bypass that fence. It is never allowed while responses are open, during an intervention,
or after finish.
The command inserts the frozen diagnostic/recheck pair after the current block (first in the
lobby) and immediately opens the diagnostic. Content, question timing, revision, event sequence,
timeline, and command receipt change atomically; published Presentation/Pack versions and drafts
remain untouched. Every copy retains immutable Pack/version/item-role/hash provenance and a full
frozen baseline. Limits remain 100 blocks/insertions and the existing Presentation size bound.
Media on diagnostic, recheck, or delayed probe is rejected until live-session media ownership and
retention are implemented. The delayed probe is not run by this live insertion.

After diagnostic reveal, optional `recoveryPackCards` contains only title/reference choices;
unselected bodies and citations are never supplied to the sidecar. An explicit card action starts
the existing explanation/worked-example intervention and returns only the selected card in
`recoveryPackIntervention`. Advance then opens the linked recheck. Receipt recovery precedes
phase/revision/source/rollout checks, so an exact retry does not duplicate an insertion even after
the source Pack is deleted or the host advances.

Optional `canInsertQuickCheck` uses the same closed-boundary and pending-linked-recheck fence,
with a one-per-session limit. New Quick Checks require current professional Presentation,
Companion/realtime, and workspace eligibility, but not Pack/live-card flags or the Pack session
creation latch. The poll is inserted after the current block (first in the lobby) and opens
immediately through the same atomic content/timer/revision/event/receipt transition. The command
fingerprint includes prompt, ordered choices, and timing; exact receipt recovery precedes new
creation gates and stale-state checks. New creation stops during rollout rollback, while existing
polls, responses, report reads, and accepted retries remain usable.

Quick Checks are immutable session-only opinion polls: no correct answer, confidence, points,
media, concept metadata, or recovery links. The best-effort audit action
`presentation.session.quick_check.insert` records the block ID and choice count only, never prompt,
choice text, or participant data; the durable receipt remains authoritative if audit delivery fails.
Timed rooms use the submitted deadline; flex rooms
have no deadline/countdown and the facilitator closes responses. The frozen live snapshot stores
`liveQuickCheck: { commandId, blockId }`, excluded from authoring drafts and retained across
PostgreSQL reads/restoration. Published sources remain unchanged. Presentation Report V3
question evidence optionally carries `sessionOnly: "quick_check"`, with null correctness/accuracy
and zero score. This records participation/opinion only, not learning or recovery evidence.
Reports without a Quick Check still use V1/V2; those strict formats are unchanged. Add
`?includeQuickChecks=true` to report retrieval for V3 evidence (combinable with
`includeSessionContext=true`). Default retrieval projects V3 to a compatible unscored V1/V2
response without session-only metadata; the ready stored report is never rewritten.

Upgrade order: pause new Companion use via `FEATURE_PRESENTATION_COMPANION=false` on every API
node, upgrade all API/report-worker readers and web clients, then re-enable the flag/allowlist.
Live published-question markers also require compatible API/report-worker snapshot readers;
retain these readers when disabling creation rather than deploying an older binary that strips
session-only provenance. Older clients can continue to use the legacy REST projection.
Once V3 reports exist, do not roll back API/report workers to binaries that only read V1/V2.
Disable new creation and retain compatible readers, or apply a forward fix; feature rollback
continues to preserve existing polls and reports. Older web clients use the legacy REST projection.

## Stable errors

Core stable errors include `INVALID_CODE`, `SESSION_FULL`, `SESSION_LOCKED`,
`NICKNAME_REJECTED`, `STALE_VERSION`, `ANSWER_LATE`, `ANSWER_INVALID`, `ENTITLEMENT_LIMIT`,
`UNAUTHORIZED`, and `RATE_LIMITED`, plus `ARTIFACT_NOT_ARCHIVED`, `ARTIFACT_IN_USE`,
revision/mutation `CONFLICT`, and the Q&A, follow-up, portability, and authoring errors
described above.

Experience/audience errors add `THEME_NOT_FOUND`, `THEME_VERSION_UNSUPPORTED`,
`INTERACTIONS_DISABLED`, `CHAT_DISABLED`, `CHAT_MUTED`, `CHAT_RATE_LIMITED`,
`CHAT_CAPACITY_REACHED`, `AUDIENCE_BANNED`, `SIGNAL_RATE_LIMITED`, `MESSAGE_REMOVED`,
`INVALID_REACTION`, and `AUDIENCE_SYNC_REQUIRED`.

## Administrative APIs

- `GET|PATCH /v1/admin/features`
- `PUT /v1/admin/workspaces/{id}/institution-policy`
- `POST /v1/admin/workspaces/{id}/lti-registrations`
- `PUT /v1/admin/workspaces/{id}/lti-registrations/{registrationId}`
- `POST /v1/admin/retention/run`
- `GET /v1/admin/sessions/by-code/{code}`

They require the configured `ADMIN_TOKEN`, are audited, and must never be called from public
browser code.

Institution errors add `INSTITUTION_NOT_ENABLED`, `INSTITUTION_AUTH_REQUIRED`,
`FEDERATED_AUTH_DISABLED`, `FEDERATED_IDENTITY_NOT_LINKED`, `FEDERATED_AUTH_REPLAYED`,
`LTI_DISABLED`, `LTI_REGISTRATION_NOT_FOUND`, and `LTI_LAUNCH_INVALID`. See the
[institution integration guide](institution-integrations.md) for callback URLs, registration
fields, and pilot gates.
