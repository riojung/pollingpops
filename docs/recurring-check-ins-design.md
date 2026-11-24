# Recurring check-ins eligibility and disclosure design

WX-07 discovery candidate on `codex/check-in-privacy-design`, based on `0877465` after
[PR #313](https://github.com/riojung/pollingpops/pull/313). Product and privacy owners must accept
an identity model and disclosure policy before selecting a runtime increment.

## Manual check-in candidate

A facilitator opens a separate check-in each week to learn what the group would change about its
work. Start with one required, anchored 1–5 rating. For example, ask people who used the team’s
handoff process how clear the next step was, with anchors **Very unclear** and **Very clear**.
Use the result as group feedback. Evaluate whether facilitators can use it to choose one improvement
without needing to know who answered, whether a particular person took part, or how a person’s
answer changed over time.

Use a draft series definition for the prompt and anchors, then freeze each manually opened run
against an immutable version. Record its collection start, server deadline and retention deadline.
Allow at most one collecting run per series in this candidate. Check that invariant in the same
transaction that opens a run, including deadline expiry and concurrent requests.

1. **Preview** shows the actual invite and question without creating a run, issuing a credential,
   accepting a response or adding to history.
2. **Open check-in** creates the run once, within existing role, plan, and operator policy. Confirm
   the prompt and deadline before opening. Freeze the run configuration with the creation receipt.
3. **Copy link** and QR use the already opened run. The facilitator distributes them separately.
   Schedule setup, automated invitations, subscriptions, and outbound delivery remain later work.
4. **Answer** uses a room-scoped resume credential. A saved draft can be resumed in the same
   browser. Final submission is atomic and produces one receipt. A participant can resume or retry
   an accepted request using the original credential and payload under the existing lifecycle
   policy.
5. **Close** ends fresh admissions and submissions at the effective cutoff. Manual close,
   deadline finalization and **Cancel** serialize on the same run. A successful cancellation
   ends collection and fences result release. The ordering below defines when cancellation
   can succeed and how retries are resolved.
6. **Expire or delete** removes the run’s evidence and any dependent history entries or deltas.
   Retention cleanup uses the same visibility rule as manual deletion.

The first implementation candidate is rating-only. An optional moderated comment needs its own
policy for accidental identification, who can see or moderate raw text, what gets released,
reporting and retention. Comments, scheduling and opt-in delivery remain tracked under WX-07.

### Close and cancellation ordering

Use authoritative server time after acquiring the run lock. Before the deadline, the first
committed terminal transition wins. If Cancel wins, commit the cancelled state and the
cancellation receipt atomically. Both manual Close and the deadline worker then leave the run
cancelled, and result readers can only show cancelled status. If manual Close wins before the
deadline, commit the cutoff and the one frozen disclosure outcome atomically.

At the deadline, fresh admissions and submissions close even if the worker is delayed.
Finalize using that deadline as the cutoff. A fresh Cancel at or after the deadline, or after
manual Close has committed, returns a conflict stating that collection has closed. Keep the
final outcome available according to policy and use the separate withdrawal or deletion
workflow when an authorized organizer needs to remove it. Exact retry of an accepted Cancel
returns its original receipt until expiry or deletion, including after the deadline. Terminal
state fences stale retries of the original open action.

## Identity decision

| Option                                                 | What the product could enforce                                    | Decision constraint                                                                                                                                                                                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared link or QR with a fresh credential for each run | One finalized submission per admitted run credential              | A fresh browser or cleared storage can produce another credential. A shared link or password establishes access to the run, and anyone with it may be able to join. Use only for a job where verified eligibility and a one-person guarantee are unnecessary. |
| Independent single-use passes issued for one run       | One completion per redeemed authorization with room-scoped resume | Define who can issue a pass, forwarding, loss, retry and revocation. Issuance could be associated with a person. Approval must address that link and who can see issuance or usage before a pass is trusted as private.                                       |
| Verified roster or persistent member identity          | A defined participant population and a possible one-person rule   | This introduces identity and completion data beyond guest Survey participation. It requires a separate approved policy for visibility, cross-run linkage, access and erasure.                                                                                 |

Recommend shared-link admission for the first candidate if the facilitator’s job is group
feedback and the group accepts the per-credential limitation. Use **finalized submissions**
when naming denominators. Keep participation state, answers, credentials, and exact response
times out of the organizer view. Establish how the runtime will mint or scope credential
material so a series cannot create a stable guest identifier. Preserve the current Survey roles
as the starting point for authorization tests. The owner still needs to approve the model.

## Disclosure decision

Existing Survey aggregate-v2 exposes a finalized submission total during collection. It releases
question distributions after closure and five finalized answers per question, and it can show
small rating buckets once a question passes. Its figures apply to one run. A check-in series
needs an explicit disclosure decision for repeated observations and related cohorts.

During collection, report readers show the run’s state and deadline. Withhold exact live
submission totals across all readers. At the first terminal close, evaluate authoritative finalized
submissions and persist one outcome per run, either an approved aggregate or a withheld outcome.
Use a provisional floor
of five valid finalized submissions to rule out release below five. Human acceptance must also
define which statistics, sample patterns, related runs, and combinations can be released.
Design the first outcome contract around withholding, with release separately approved.
The availability status itself can reveal information in closely observed groups. Include that in
the assessment.

Use a server-owned run classification to enforce disclosure on every read or projection of
check-in results. Resolve that classification from the stored run, including when a caller
supplies an underlying Survey room ID. Each authorized check-in reader returns only its
approved frozen outcome or the allowed collection, cancelled or withheld status. Legacy
Survey report and summary endpoints reject check-in runs. A missing classification or an
unavailable outcome fails closed. Ordinary Survey rooms retain their existing aggregate-v2
contract. Qualify direct API reads and summary creation as well as the series view.

Where approved, display the prompt and scale version, collection windows and finalized submission
counts. A mean is the sum of eligible finalized rating values divided by the number of those
values. Skip missing values. Use **Withheld** for a suppressed outcome and use zero only when an
approved statistic is actually zero. A change between two eligible released means is a comparison
of **unpaired groups**. Require the same immutable prompt and scale version, non-overlapping
windows, and approved comparison conditions. Individual improvement, participation rates based
on an unknown roster, and longitudinal progress remain outside the model.

History reads check current workspace authority and source availability. If erasure or a policy
withdrawal affects an outcome, remove it from history and remove any dependent comparison. Avoid
recomputing a replacement from the remaining responses. Keep share links, downloads and external
exports out of the initial candidate. Review retention of any minimal terminal receipt needed to
prevent a stale open retry from recreating a deleted run.
Limit audit entries to authorized creator actions and run metadata. Keep answers, bearer values
and exact response timestamps out of audit entries and metrics.

## Synthetic qualification cases

| Case                                                                            | Required behavior for the candidate                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview, repeated Open and repeated Copy link                                   | Preview and link copying accept no responses and create no extra runs. Exact retry returns the original open result. A conflict prompts the facilitator to refresh the run.                                                                                                      |
| Two runs of the same version                                                    | Each run requires its own admission and resume credential. Only the intended run’s finalized submissions enter its outcome. The series cannot fetch an individual’s history.                                                                                                     |
| Manual close and a final answer race                                            | The authoritative close boundary determines which writes are accepted. An exact retry of a committed submission recovers its receipt. A new answer after close is rejected.                                                                                                      |
| Cancel commits before close and before the deadline                             | A delayed close or finalization leaves cancelled status in place, with no evidence released. Exact retry returns the accepted cancellation receipt.                                                                                                                              |
| Manual close commits first, or Cancel reaches the lock at or after the deadline | Cancel returns a closed conflict even if the deadline worker is late. The winning close commits one outcome at its effective cutoff. Withdrawal follows its separate authorization path.                                                                                         |
| Open or cancelled with submissions                                              | No per-question distributions or exact series totals appear. A cancelled run cannot later become an available report.                                                                                                                                                            |
| Direct report and summary reads using a check-in’s backing Survey ID            | The check-in reader withholds data for open, cancelled and withheld runs. Legacy Survey results and summary creation reject the check-in. Ordinary Survey runs still return aggregate-v2 through their existing routes.                                                          |
| Zero to four finalized answers, or an unsafe sample of five or more             | The outcome is withheld. Do not replace missing evidence with zero or publish a reason that exposes a rare response.                                                                                                                                                             |
| Known overlap between adjacent runs                                             | In a synthetic run of five ratings averaging 3 and a later run of six averaging 3⅓, a person who knows the first five answers were retained can infer a sixth rating of 5. Both runs clear a floor of five. Independent sample checks alone are insufficient for series release. |
| Different prompt or reversed rating direction                                   | Mark the proposed comparison unavailable. Preserve any individually approved results with their original prompt and window.                                                                                                                                                      |
| Delete, expire, revoke access, or retry an old open                             | Remove affected views and deltas. Access loss does not expose them through saved links. A stale retry cannot reopen the deleted logical run. An explicit new run creates a fresh intent.                                                                                         |

## Existing foundations and gaps

- Existing Survey freezes a version and deadlines, uses room-scoped bearer resume, and enforces
  one finalized response per admitted credential. The browser creates a new random credential
  per room. The server accepts client-supplied bearers at admission, so it does not prove raw
  credential uniqueness across rooms or distinct people. See [Survey API](api.md#self-paced-survey-beta)
  and [participation data map](privacy-data-map.md#self-paced-survey-participation).
- The existing Survey authoring action creates a run while preparing to share it. The proposed
  check-in workflow gives preview, opening and link copying separate meanings. Existing Survey
  deletion removes its original creation receipt. A later request with the same key can create a
  new room, so terminal logical-run fencing needs separate design and retention approval.
- The [conditional Survey disclosure work](survey-branching-disclosure-policy.md) outlines one
  immutable outcome and withdrawal after erasure. It is a precedent for the lifecycle, with its
  own human acceptance still pending. The proposed check-in policy needs separate approval for
  repeated releases and overlap. Keep existing Survey response and report behavior compatible.

Before selecting runtime work, confirm the feedback job and shared-link model with the product
owner and obtain human privacy acceptance of the display, overlap, and lifecycle rules.
Use synthetic fixtures for technical qualification and the existing research process for customer
observation.

## Baseline verification

The [Survey API isolation test](../apps/server/test/survey-api.test.ts) opens two runs of the
same immutable publication. It verifies room-scoped resume and rejection when the bearer
has only been admitted to the first room. It then explicitly admits the same bearer to the
second room and verifies independent answers, revisions, receipts and report suppression.
The second attempt and report survive deletion of the first room.

All 29 focused server tests, 19 contract tests and 11 in-memory repository tests passed. Four
PostgreSQL cases were skipped by the local configuration. Server type checking, targeted lint
and formatting passed. These checks qualify the existing Survey foundation. The synthetic
case matrix for a check-in series remains an acceptance target for the proposed runtime.
