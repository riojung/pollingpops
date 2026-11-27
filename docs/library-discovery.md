# Library discovery: All content

WX-03 extends the merged WX-01/02 foundation. It adds metadata discovery across Rounds,
Presentations and Surveys, using the existing workspace and published-sharing authority.
Boards retain their separate library. This increment does not introduce collaborative editing,
new sharing grants or a new published-content format.

## Entry points and actions

`/library` opens **All content** for the active workspace. The **All content**, **Rounds**,
**Presentations** and **Surveys** navigation works in My workspace, Shared with me, Organization
and Manage sharing. Category links set the `kind` query and filter metadata across the collection.
Discovery offers grid and list layouts and shares the per-workspace layout preference with the
specialized management views.

Own-workspace results open the existing canonical editor/reader. The user's current role still
controls editing, publishing, delivery and deletion. A workspace category offers its own management
link, such as **Manage Rounds**, for folder management, favorites and bulk actions. Existing
`type=rounds|presentations|surveys` management links continue to work. Discovery can filter by
existing favorites and folders.

Shared results retain the pinned version, source attribution, permission, personal follow-up,
review date and authoritative actions. **Can view** does not become **Can use** because a result
appears beside an editable workspace item. Opening a publication does not open its source draft.
Already-created independent copies retain their existing lifecycle.

## Queries and pagination

Search is submitted with the Search action or Enter. Content kind, status, sort and applicable
scope-specific filters update the URL. Reload and back/forward restore those controls. Switching
scopes preserves the search, category and sort while resetting scope-specific filters. A new query
or authority context starts a new first page. A failed next-page request keeps the loaded results
and offers retry. An initial failure is distinct from an empty collection or no matching results.

The workspace endpoint is `GET /v1/library/items`, authenticated with the current creator cookie:

| Parameter   | Meaning                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| `q`         | Literal title/description search; trimmed, at most 160 characters           |
| `kind`      | `all`, `round`, `presentation`, `survey`                                    |
| `status`    | `active`, `draft`, `published`, `archived`, `all`; active excludes archived |
| `sort`      | `recent`, `title_asc`, `title_desc`                                         |
| `favorites` | Optional explicit `true`/`false`; omitted includes either                   |
| `folder`    | `all`, `unfiled` or a folder UUID                                           |
| `limit`     | 1–100, default 30                                                           |
| `cursor`    | The opaque next cursor returned for this exact context/query                |

Each item contains only identity, kind, title, description, status, update time, folder, favorite,
current-version reference and item count. The response includes `nextCursor` and `facets`.
Pausing new-content creation does not hide retained readable items or their counts. Creation,
mutation and specialized management entry points keep their existing capability checks.

The existing `GET /v1/library/shares` adds optional `q`, `kind`, `sort`, `progress` and `permission`.
It retains scope, organization, page size and compatible legacy cursor support. New discovery
clients request `includeFacets=true`; without this opt-in, the HTTP response remains exactly
`{shares,nextCursor}` for already-open clients with strict legacy parsers. Search covers
authorized publication title/description, organization, source workspace and sharing message.
`progress` is `all|new|in_progress|done`; `permission` is `all|view|use`. Recent shared results use
sharing time, rather than implying the source draft was recently edited. Paused shared-content
creation retains the existing visible metadata and unavailable-action explanations.

Kind/status buckets in the workspace cover the search/favorite/folder matches before kind and
status selection. Shared kind/progress/permission buckets cover authorized search matches before
those filters. The result total applies all selected filters. These are complete eligible counts,
distinct from the number of rows currently loaded; unauthorized content never contributes.

Ordering has deterministic identity tie-breakers. Search/title keys use NFC normalization,
Unicode root lowercase, then NFC again so lowercasing cannot leave noncanonical cursor keys;
title comparisons use UTF-8 byte order, rather than promising language-
specific dictionary collation. PostgreSQL uses its ICU root collation for lowercase and C ordering.
PostgreSQL deployments must provide the ICU root collation used by the query/index migration.

Cursors carry validated ordering boundaries and a fingerprint of their actor, scope and query.
They are pagination positions, not authorization credentials or cryptographic signatures. A
well-formed altered position still cannot broaden current access. Deleted/revoked anchors do not
need to be fetched to continue. Malformed or query-mismatched cursors require restarting the query.
Keyset pages reflect current reads, not a retained historical snapshot: concurrent edits can move
items. Identity deduplication prevents displaying the same item twice after loading another page.

## Access and storage

Workspace metadata queries recheck the active user, membership and workspace/organization state.
PostgreSQL rows and facet counts are projected in the same transaction with workspace/user context
and forced RLS. Shared discovery reuses its principal-specific organization, recipient, management,
source-existence and revocation predicates before filtering, ordering, counts and page limits.

PostgreSQL performs metadata queries in the database; it does not materialize all private drafts
in the API to merge three content kinds. No notes, questions, answer keys, participant responses,
source snapshots or media bodies are returned by discovery. No per-row artwork requests are added.

The browser clears or replaces query state on actor/workspace/role/grant/scope changes and auth or
session events. It aborts stale requests and fences late callbacks. Focus/visibility refreshes
revalidate the collection; all item actions continue to check current server authority. Receiving
metadata earlier is not a durable access grant.

Migration `113_library_discovery.sql` adds discovery indexes; forward migration
`114_library_discovery_canonical_titles.sql` replaces the three title indexes with canonical
lowercase expressions. Apply both with the matching API/web; preserve migrations 001–113
and existing immutable records. See the
[upgrade runbook](runbooks/upgrade.md). Exact search/facet counts can scan matching workspace
metadata; bounded response size is not a constant-cost query guarantee.

## Verification record

Focused contract, API and frontend checks pass, including URL/history, query/cursor fencing,
retry preservation, baseline strict-client compatibility and retained reads during paused creation.
The latter uses a real application API test: existing list/detail/search/counts and a pre-pause
cursor remain usable while new Presentation/Survey creation returns unavailable.

Memory and restricted PostgreSQL discovery conformance passed against isolated PostgreSQL17
databases with a non-owner, non-superuser runtime role. Coverage includes all three kinds,
favorites/user isolation, source access, complete search beyond a page, Unicode normalization,
literal wildcards, deterministic ties, malformed/context-mismatched cursors and deleted anchors.
Migration113 was applied twice successfully. Shared-query checks also verify metadata-only SQL
with a single-connection pool and no per-row source-draft/progress fetch.

Six browser cases passed across desktop Chromium, mobile Chromium and mobile WebKit. Real APIs
exercise mixed-kind pages, search beyond the first page, failed-page retry without losing rows,
history/reload, favorite discovery, organization/direct separation, permissions, review progress,
private-source denial and revocation followed by revalidation. Screenshots and scoped Axe audits
cover light/dark/high contrast at 1440px, 390px and 320px; controls have at least 44px hit height.
The existing 23-Round mobile WebKit management regression also passed through grid/list,
filters, light/dark and Recovery Packs navigation using the explicit typed route.

Manual screenshot review corrected native-control styling and WebKit theme inheritance. Browser
audits wait for actual foreground colors after a mode change; contrast rules remain enabled.
These automated checks do not replace physical-device, assistive-technology or native-language
usability review.

`VITEST_MAX_WORKERS=1 pnpm check` passed, including formatting, Docker-context validation,
repository lint/typechecks, all test tasks, production builds and server startup smoke. The web
suite passed **487 files / 5,860 tests**; server **1,604 tests**; smoke support **522 tests**.
Environment-dependent tests retain their configured skips in that command; the focused restricted
PostgreSQL runs above were separate. Focused browser lint and strict TypeScript also passed.

Independent review findings were resolved and verified: shared facets are explicitly opt-in for
older strict clients, and retained-content reads remain independent of writer rollout flags.
The disposable PostgreSQL container and its credential file were removed after testing; normal
development data was not used for those tests.

At the initial implementation checkpoint, the local development core profile rebuilt successfully,
API/control readiness reported ready, and the discovery route rejected anonymous requests with 401.
Migration113 was applied in that local database; the Unicode follow-up requires the next rebuild
and migration through114. The interface is available at `http://localhost:8080/library`.

The Unicode review follow-up adds final NFC after lowercase in JavaScript and PostgreSQL, including
search, cursor validation and title indexes. A new regression reproduced the invalid-next-cursor
failure before the fix. Afterward, workspace/shared conformance passed **41 tests** across memory
and isolated restricted PostgreSQL, and the focused Library API suites passed **18 tests**. Coverage
includes `J\u030c workshop` and `ǰ workshop`, title paging in both directions, shared recent paging,
canonical search equivalence and duplicate-free traversal. Migration114 preserves migration113 and
all stored title text while replacing its three title indexes. The PostgreSQL row-isolation suite
also passed **190 tests**, including migration-ledger/checksum validation and repeat migration.
Focused database lint, TypeScript and changed-file formatting checks passed.
The complete `VITEST_MAX_WORKERS=1 pnpm check` gate passed again after the Unicode fix, including
production builds and compiled server startup/configuration smoke.
