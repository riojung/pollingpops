# IDEA 005 shareable session summaries

Updated: 2026-10-14

Implementation covers completed Rounds, finished Presentations with ready durable reports, and
closed Surveys. Each source has one immutable aggregate snapshot. Existing private CSV/JSON
exports retain their behavior. This increment supplies native XLSX files; Google Sheets delivery
and OAuth consent remain future work.

## Customer behavior

- Open **Share summary** from a ready report or closed Survey run. Preview accessible aggregate
  tables, add plain-text next steps, and download PDF, PNG, or XLSX.
- PDF and XLSX include the full summary. PNG is a clearly labelled overview excerpt or one selected
  checkpoint. The HTML summary provides the accessible text alternative to the image.
- Workspace owners and editors with the existing report-export entitlement can explicitly create
  a link. Choose 1–30 days, capped by source retention, and whether guests may download files.
- The complete link is displayed once. Its secret is in the URL fragment and is sent to the API
  only as an authorization header, without creator cookies. Retrying an accepted request returns
  its metadata, never a recovered secret; a lost link can be revoked and replaced.
- Owners/editors can revoke links, including when new sharing is paused. Source deletion,
  retention expiry, account deletion, or loss of the publisher's owner/editor membership stops
  public reads and downloads. Previously downloaded files cannot be recalled.

## Evidence and privacy

`AggregateSessionSummary` schema version 1 is a strict allowlist shared by every output format.
It contains totals, authored checkpoint labels, sufficient-sample fixed-choice/rating/ranking
aggregates, scored accuracy numerators/denominators, separate linked/revote recovery, and
creator-authored next steps. At least five respondents are required for checkpoint evidence and
paired recovery. Round initial accuracy additionally requires five distinct scorable contributors.

Participant identifiers, aliases, leaderboard rows, submitted open-text bodies, word-cloud terms,
transcripts, response timings, private feedback, credentials, and source/workspace IDs are excluded
from public documents. Numeric inputs do not become point-value histograms. Opinions are unscored;
content slides are unassessed. Presentation reports do not supply distributions, so summaries do
not reconstruct them from raw responses. Survey suppression remains intact after final closure.
Recovery describes within-session paired responses and does not establish durable learning.

The first accepted share/export freezes the base summary. Each share freezes its creator's next
steps separately. Explicit and natural Survey closure persist a stable close instant and fence
queued submissions before aggregate capture. Older closed Surveys without a recorded close instant
use the earlier of their deadline and first aggregate capture time, persisted on first read.

## Storage and API

Migration 070 adds immutable snapshots and capability metadata with forced workspace RLS,
composite tenant/source foreign keys, deletion cascades, and restricted public lookup. Secrets are
hashed. Every public lookup rechecks source retention and the publishing actor's current role.
Account exports include aggregate snapshots and safe share metadata, never capability/intent
hashes. At most 20 active links per source and 100 listed links bound metadata requests.

Creator endpoints are under `/v1/session-summaries/:kind/:id` (preview, `/shares`, and `/export`).
The feature probe is `/v1/session-summaries/features?kind={kind}&id={id}`. During a writer pause,
availability requires a retained snapshot for that exact source in the current workspace.
Public capability reads and downloads are under `/v1/shared-session-summaries/:id`. Requests validate
intent, source binding, supported formats and locales. Responses are no-store/noindex, public pages
use generic metadata and no-referrer,
and download completion revalidates revocation, role, and deletion after rendering.

## Export implementation

- PDFKit produces tagged, selectable vector/text PDF with embedded licensed fonts and language
  metadata. This is not a PDF/UA certification claim.
- Canvas produces fixed 1600×2000 PNGs. Authored content is drawn as text and never fetches URLs.
- XLSX uses a small OOXML archive with fixed worksheet names, typed numeric cells, and escaped
  literal text cells. It includes no formulas, macros, external relationships, or hyperlinks.
- A single worker with a four-request queue isolates native rendering. Limits are 1 MiB input,
  16 MiB output, 256 PDF pages, 200 checkpoints, and a 10-second deadline. Disconnects cancel work;
  timeout/oversize/overload return explicit errors without partial files.
- Ten locales are supported. Pinned Noto CJK/Emoji fonts and OFL notices are packaged with the
  server; sources and SHA-256 digests are in `apps/server/assets/summary-fonts/README.md`.

## Rollout and verification

New snapshots and links require `FEATURE_SESSION_SUMMARIES=true` and membership of
`CORE_PARITY_WORKSPACE_ALLOWLIST`. The default is disabled. This gate is independent of new Survey
creation. Accepted summaries remain readable, downloadable under current export entitlements,
and revocable while new writers are paused. Event-funded Round/Presentation export coverage is
preserved. Production/global enablement still requires the independent privacy review specified
in the product development plan.

Verification covers strict contracts, projections, all three creator/public API flows, permissions,
retry conflicts, privacy suppression, lifecycle cascades, restricted PostgreSQL/RLS and deletion
races, format validity, Unicode extraction, bounded rendering, and browser accessibility. The
integration check, container smoke, workbook rendering, and production-browser evidence are
recorded in the [delivery checkpoint](implementation-status.md#idea-005-shareable-session-summaries-october-14-2026).
Manual assistive-tech, native-speaker copy,
physical-device, and external production acceptance remain separate release checks.
