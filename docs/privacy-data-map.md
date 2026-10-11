# Privacy data map

This engineering inventory is not a legal opinion. Confirm purposes, legal basis, processor location, notices, and contracts before production.

## Self-paced Survey beta

Survey versions/rooms retain organizer-authored opinions, category/preset references, deadlines and
an immutable organizer-blind policy. No participant alias, email, account or learning identity is
requested. Browser-local room credentials support resume; PostgreSQL stores hashes and internal
room IDs, bounded draft responses, revision/finalization state and random receipts. This is operational
pseudonymous data, not a claim that infrastructure operators cannot process network information.

Organizer results expose finalized submission totals while collecting, but question-level
counts/distributions only after manual closure or the server deadline. Each question is suppressed
below five finalized responses, including optional questions. Results cannot be refreshed to subtract
one respondent's answers from changing live distributions. APIs never expose guest IDs/hashes, linked
rows, precise respondent timestamps or personal
activity. Creator account exports contain Survey content and room metadata, not respondent records or
credentials. Owner-only room deletion, retention and owner-workspace deletion cascade through
attempts/receipts, including room-creation receipts. Editors may close runs but not delete them.
New runs freeze expiry at scheduled close plus the plan retention period: 30 days on Free, 365 on
Pro, or operator configuration in Community. The collection window is separately limited to 30 days,
so a 30-day Free run can retain responses for up to 60 days from creation. Closing early never
extends expiry, and existing frozen deadlines are not rewritten.
Logs/metrics must not record responses/credentials; guest requests omit creator cookies. Only polls and
ratings are accepted initially, so respondent-authored text/attachments are absent. One completion per
credential is enforced, not verified one-person participation. Cross-device resume, passcodes,
individual revocation and independent privacy/security acceptance remain pending.

The Core-Parity audience foundation stores opted-in Presentation scope metadata (workspace/source
ID, immutable facilitator-visible alias policy, creation receipt, audience sequence, and source
retention deadline) and metadata-only activation/Q&A outbox events. Scoped Presentation Q&A now
stores plain-text questions, existing session aliases, moderation status/labels, unique votes,
room-scoped bans, body-free retry receipts, durable action budgets and moderator audit records.
It adds no cross-session identities, signals or survey attempts. Parent session/workspace deletion cascades in
PostgreSQL and memory; scheduled session retention removes these records. Owner account export
includes scope metadata and Q&A records, not authorization credentials, retry hashes or socket bindings.
Removed bodies are blank in ordinary views, reconnect snapshots and account exports. Stored
removed text expires with the room; no public replay or raw removed-content export exists. Scoped websocket
bindings contain only native credential hashes for revalidation; reusable bearer credentials are
not retained in distributed socket data, Redis adapter fetches, account exports, or logs.
No scope event exposes credentials, aliases, individual activity, or answers.

Learning Round/Presentation scope responses explicitly disclose that moderators can see the session
alias even when the public room display says Anonymous. Organizer-blind Q&A/live feedback-room
modes remain pending. The separate self-paced Survey beta is described above; do not market
learning Q&A as organizer-blind anonymous feedback. Future feedback-room modes require separate projections
and privacy/security acceptance across every API, event, moderation, report, export, and account path.

Source-assisted Recovery Pack conversion reuses an existing validated authoring output; it makes
no new provider request. Pack content copies the selected diagnostic/recheck, source-derived card,
and citations. A separate creator-only record retains source name/digest, logical job ID, canonical
source-output hash, and a bounded catalog of originally validated citation spans. It does not copy
the uploaded source file or raw source body. Content/citation approval records the saved revision,
complete content hash, time, and creator principal; idempotency receipts retain request hashes,
not request bodies. Review metadata and approval are absent from published content, participant
projections, and native Pack JSON. An import does not claim or inherit the original approval.

These records follow the Pack's retention/deletion lifecycle, not temporary authoring-job expiry.
They are included in the creator's private account export and cascade with Pack/workspace deletion.
Approval retry receipts are additionally pruned after 30 days; the current approval binding and
original citation catalog remain with the Pack.
Existing separately copied published content follows its destination's retention. Creation and
approval audit entries store action/target metadata, not citation excerpts, source text, or learner
responses. Terminal authoring processing still clears raw source text/file bytes; source-job purge
does not delete the Pack's bounded source evidence. Human approval attests review of that exact
saved content and those source spans; it is not evidence of factual or pedagogical correctness.

Recovery Pack practice is session-scoped/accountless. A full-sequence assignment freezes the
published diagnostic, intervention cards/citations, and linked recheck; a delayed-probe assignment
continues to freeze only its optional probe. These copies and question media follow the assignment's
plan-stamped retention and survive source Pack deletion. Only the current question or active card
is delivered to a participant. Cards have no response deadline and do not expose the unrevealed
recheck, other cards, source metadata, or answer keys. No participant responses are sent to an AI
provider by this workflow.

Accepted version fences and bounded Continue receipts support safe retry/resume. They contain
request identifiers and accepted versions, not authorization credentials or copies of learner
responses, and expire/delete with their parent attempt and assignment. Private access and attempt
credentials remain hash-only in storage. Labelled personal links still do not establish a persistent
learner identity or pair an assignment to a participant from an earlier live session. The two
checkpoint aggregates describe this practice attempt cohort, not delayed retention or causal learning.

Published Recovery Pack CSV/QTI downloads and their loss reports are workspace-authorized creator
reads, including viewers; they are not public participant endpoints. Conversion projects only the
frozen diagnostic, linked recheck, and optional probe. It omits Pack cards, citations, and private
media references/bytes and discloses those losses rather than fetching media URLs. Reports contain
the published title, Pack/version identifiers, content hash, bounded field paths, and static reasons,
not authored excerpts, participant answers, credentials, or media identifiers. QTI embeds the same
report; CSV exposes a separately downloadable report. No additional durable data or retention clock
is created. Downloaded content is held by the recipient and cannot be remotely erased. Native JSON
continues to include complete content and media references, not image bytes or access tokens.

| Data                                                | Purpose                                                                           |                                                                              Default retention | Location rule                                                               | Deletion                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------: | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Creator email and session                           | Account access and support                                                        |                                                                  Account life; session 30 days | Workspace home region                                                       | Account deletion anonymizes email and revokes sessions                                              |
| Policy consent and version                          | Evidence of creator acknowledgement                                               |                                                                       Policy/legal requirement | Workspace home region                                                       | Counsel-approved retention/anonymization procedure                                                  |
| Round/Presentation content, versions, draft history | Authoring, recovery, and frozen live delivery, including slide text and placement |                                                                                   Account life | Workspace home region                                                       | Owner deletion of an archived artifact without retained dependencies, or workspace/account deletion |
| Question Health decisions and edit provenance       | Content-specific dismissal/reopen and approved draft apply/undo                   |                                                                          Source Round lifetime | Workspace home region                                                       | Source Round or workspace/account deletion                                                          |
| Session decision events                             | Aggregate evidence of the facilitator's live decisions                            |                                                                     Free 30 days; Pro 365 days | Session home region                                                         | Session purge or early deletion                                                                     |
| Image objects and metadata                          | Instructional question and slide media                                            | Account life while referenced; quarantine 24 h; unreferenced assets eligible at seven days old | Workspace home region                                                       | Account deletion, quarantine cleanup, or orphan cleanup after reference removal                     |
| Participant nickname                                | Room identification                                                               |                                                                     Free 30 days; Pro 365 days | Session home region                                                         | Session purge or early deletion                                                                     |
| Participant avatar ID                               | Session-scoped visual identification from a fixed allowlist                       |                                                                     Free 30 days; Pro 365 days | Session home region                                                         | Session purge or early deletion                                                                     |
| Answers, scores, timestamps                         | Correctness, recovery, reports                                                    |                                                                     Free 30 days; Pro 365 days | Session home region                                                         | Session purge or early deletion                                                                     |
| Confidence/interventions                            | Recovery diagnosis and evidence                                                   |                                                                     Free 30 days; Pro 365 days | Session home region                                                         | Session purge or early deletion                                                                     |
| Pulse signals/events                                | In-room pacing/help context                                                       |                                                                     Free 30 days; Pro 365 days | Session home region                                                         | Session purge or early deletion                                                                     |
| Chat/reactions/reports                              | Room conversation and safety                                                      |                                                                     Free 30 days; Pro 365 days | Session home region                                                         | Session purge, moderation, or early deletion                                                        |
| Mutes/bans/moderation                               | Audience safety and accountability                                                |                                                                     Free 30 days; Pro 365 days | Session home region                                                         | Session purge or early deletion                                                                     |
| Q&A, replies, votes                                 | Audience voice and moderation                                                     |                                                                     Free 30 days; Pro 365 days | Session home region                                                         | Session purge, moderation, or early deletion                                                        |
| Practice attempts/answers                           | Accountless recovery or assigned practice                                         |                                       Recovery: source-session window; assignment: plan window | Workspace/session home region                                               | Source-session purge, assignment expiry, or workspace deletion                                      |
| Practice recipient label                            | Let a facilitator distribute and revoke a one-attempt assignment link             |                                                                 Standalone assignment lifetime | Workspace home region                                                       | Assignment purge or workspace/account deletion                                                      |
| Authoring source/job                                | Create cited review-only drafts                                                   |                                          30/365 days; source cleared after terminal processing | Workspace home region; configured provider receives bounded source sections | Job retention or account deletion                                                                   |
| External creator identity                           | Explicit institution sign-in/linking                                              |                                                                     Account or membership life | Workspace home region; identity provider processes its own authentication   | Creator unlink, membership removal, or account deletion                                             |
| LTI registration/launch                             | Instructor launch and Deep Linking                                                |                                                    Registration life; launches are short-lived | Workspace home region; registered LMS receives the signed response          | Operator disable, launch expiry, or workspace deletion                                              |
| Live-room token hashes                              | Session-scoped resume and authorization                                           |                                                                                  Live use 24 h | Session home region                                                         | Session purge                                                                                       |
| Practice token hashes                               | Accountless practice access, revocation, and resume                               |                                       Recovery: source-session window; assignment: plan window | Workspace/session home region                                               | Source-session, assignment, or workspace purge                                                      |
| Creator-resume token hash                           | Secure recovery of an active room                                                 |                                                      At most 4 h and never past session expiry | Session home region                                                         | Replacement, explicit revocation, or session purge                                                  |
| Bounded beta product events                         | Measure the creation, live recovery, report, follow-up, and rehearsal funnels     |                                                                                        30 days | Workspace home region                                                       | Scheduled retention purge or workspace deletion                                                     |
| Security metadata                                   | Abuse prevention and incident review                                              |                                                                                 30 days target | Primary region                                                              | Scheduled purge                                                                                     |
| Audit records                                       | Sensitive-operation accountability                                                |                                                       365 days by default, operator-configured | Workspace home region                                                       | Scheduled purge plus workspace deletion                                                             |
| Stripe identifiers/status                           | Entitlement reconciliation                                                        |                                                                     Contract/legal requirement | Provider plus application region                                            | Provider and application workflow                                                                   |

Account export includes authoring source text and uploaded-source bytes while a job still needs
them, because it is the creator's private account export. Ordinary authoring API views never return
the raw source. Terminal processing clears source text/bytes and retains only the digest, proposal,
and citations until job retention expires. Provider processing location depends on the operator's
approved configuration and must be disclosed separately.

Account export includes media metadata but not binary image bytes. Account deletion first removes
the workspace's private objects and then cascades durable product records; it stops before deleting
the account record if object storage or cache cleanup fails. Host and participant token hashes are
not included in export.

The standard report contains aggregate Pulse and conversation measurements, not raw chat or a
participant-to-signal mapping. Authorized report users may open a separate interaction transcript;
removed message bodies require an explicit owner/editor audit view. A private-alias chat row stores
that mode at creation and can never become publicly attributed after a settings change. Hosts and
cohosts can see the session alias attached to a current signal for live facilitation. Presenter and
participant views receive signal totals only after five unique signalers and never receive the
mapping. Logs and metric labels must not contain message bodies, aliases, or signal-to-participant
mappings.

Avatar IDs are cosmetic identifiers from the fixed `comet`, `fox`, `owl`, `otter`, `panda`,
`robot`, `rocket`, and `star` allowlist; the join path accepts no uploaded image or free-form avatar
metadata. When an older client omits the field, the server derives a deterministic allowlisted ID
from the generated session participant UUID. The resolved ID is retained in the canonical live
session snapshot and authorized report participant detail for the same session/report retention
window. It is not copied into a normalized participant avatar column because live state is the
canonical source for reconnect, audience, and reporting, and no independent avatar query exists.
Host, presenter, and moderator projections may receive session avatars. A participant projection
in private-result mode retains only that participant's own avatar and suppresses everyone else's.

Live session access and report retention are separate clocks. Host and participant credentials
stop working when the 24-hour live window ends; the session tree remains inaccessible to guests
but available to its creator until the stored plan-based purge deadline or an earlier explicit
deletion.

Archiving a Round or Presentation keeps its draft, immutable versions, history, and media
references; it is reversible. An owner can separately delete an archived item permanently. Retained
live sessions or practice/follow-up assignments block source deletion, including closed or expired
assignments awaiting retention cleanup. Successful deletion removes authoring records, Question
Health decisions/provenance for a Round, all users' favorites, Group artifact/schedule links, and
media references. It does not delete a shared media object immediately; unreferenced assets
become eligible once they are at least seven days old under the existing orphan cleanup. This is
asset age, not a new seven-day wait after deletion. Deletion audit records retain their
separate audit lifetime and contain action/target metadata rather than a copy of deleted content.

The Sessions page exposes owner deletion for finished or live-expired Round and Presentation rooms.
The Presentation endpoint also enforces this terminal-state rule; the existing Round deletion API
continues to permit owner deletion of an active room. Session deletion removes retained responses,
reports, credentials, and session-owned evidence/dependents, releases the room-code claim, and
invalidates live access. Successful Library deletion clears that browser's builder recovery entry;
successful session deletion clears that browser's scoped credentials. Other browsers and previously
downloaded exports are not remotely erased.

Application deletion does not rewrite encrypted backup generations or downloaded exports. Backups
age out under the operator's approved retention policy. A restore from a pre-deletion backup must
reconcile subsequent approved deletions before reopening traffic; see the
[backup and restore runbook](runbooks/backup-restore.md#deletion-and-restored-data).

Presentation content v2 stores stable text IDs, roles, text, snap regions, stack order, and optional
percentage frames alongside media, notes, citations, and starter style. Read upcasting of older
content creates no new participant identity or retention period. Question Health dismissals store a
finding identity, rule/content hash, bounded reason, actor, and revision provenance; approved edits
retain a bounded before/after field diff for undo. Both are included in private account export and
follow source deletion. Static and exact-version post-use analysis calls no AI provider; post-use
observations are derived from at most 250 retained ready reports, divided by trust, timing, and
scoring cohort, with minimum-sample suppression. They do not create a learner-level history store.

Decision Replay is captured only for new eligible Round sessions and is frozen at creation. Its
strict event payloads contain sequence/time, question/round references, aggregate insight counts,
recommendation/ruleset codes, intervention type, recheck kind, advance/finish, and a truncation marker
when the 5,000-event bound is reached. They contain no aliases, participant IDs, raw answers,
free-form facilitator notes, or answer distributions. Events are committed with live state and
retained under the existing session clock. Authorized Report V4/JSON/CSV views expose this journal;
participant snapshots do not. Earlier sessions are not reconstructed from retained responses.

Creator control passes are stored as one-way hashes with a `creator_resume` purpose. The bearer is
returned once with a no-store response, belongs only in browser session storage, and is never
placed in a URL by the product. Only one unrevoked pass exists per creator/session; replacement
revokes the prior credential. Issuance and explicit revocation are audited, tenant-scoped, and
rate-limited. Shareable collaboration cohosts are a separate entitlement and credential purpose.

Beta product events contain an event name, occurrence/expiry timestamps, workspace boundary, and
only these bounded categorical dimensions: creation path, setup recipe, rehearsal scenario,
workspace segment, beta version, and duration bucket. The server supplies the segment and beta
version. The event table has no actor ID or product-object ID and cannot store content, answers,
aliases, source text, or free-form metadata. Raw rows are purged at 30 days by the scheduled
retention worker. Its result, structured completion log, and bounded retention counter expose only
the number purged. The Prometheus product counter uses the same bounded label vocabulary and
follows the operator's separately configured metrics retention. Participant join and answer
milestones are anonymous counts: they do not contain participant IDs, aliases, responses, room
codes, or Round/report identifiers. A recovery-follow-up or practice-assignment share milestone is
recorded only after an explicit copy or link-download action. Recipient labels, bearer tokens,
Round/version IDs, and assignment IDs are never telemetry dimensions.

Live response distributions are derived projections rather than separately persisted answer
copies. A ready report may retain the same aggregate projection inside its existing retention
window. Distributions are absent before lock/reveal, when fewer than five people answered, and
from every participant snapshot. Choice/rating evidence contains only aggregate buckets;
multi-select percentages use respondents as the denominator; numeric evidence contains only
correct and incorrect totals.

Never collect participant birth date, phone, precise location, advertising ID, biometric
information, social graph, or marketing consent in the guest experience. Never place participant,
session, report, Pulse, chat, or Q&A data in authoring prompts. Normal logs must redact email,
nickname, chat body, participant-linked signal, tokens, answer content, cookies, and billing
payloads.

Federated identity records store provider, issuer, subject, optional verified email hint, link
time, and last-use time. Ordinary identity APIs omit the subject. OIDC state and LTI state are
stored only as short-lived hashes; OIDC PKCE verifiers/nonces and LTI nonces expire with those
transactions. Account export excludes bearer hashes and LTI response JWTs. An approved
institution audit export includes actor IDs, actions, targets, request IDs, timestamps, metadata,
and the workspace home-region label, so its recipients and retention require institutional policy.
The scheduled retention worker deletes audit records older than `AUDIT_RETENTION_DAYS` (365 by
default, configurable from 30 to 3,650 days); an institution must approve that value before launch.

Creator OIDC and instructor LTI do not change participant anonymity. Identified learner launch,
NRPS, AGS, managed SAML/SCIM, and K–12 remain disabled or unimplemented in this release.
