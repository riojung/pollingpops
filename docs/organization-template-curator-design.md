# Organization template collection curator design

WX-14 candidate based on `a7f3975` after [PR #316](https://github.com/riojung/pollingpops/pull/316).
An organization can identify the published starters it wants colleagues to reuse in **Templates**.
The proposed audience is the organization, with an explicit **Template curator** grant for managing
collections. Product, organization access, and security owners need to accept this boundary before
implementation.

## Authority and audience

Bind each grant to a current organization membership and assign it its own identity. Allow at most
one active grant per member per organization. The recipient must be a verified, nondeleted,
non-billing member of an active organization account. The grant is independent of creator seats
and workspace roles. It is issued after a person joins the organization. Existing organization
invitations and roles stay the source of membership. Organization Groups provide a precedent for
separating coordination and publication roles. [Groups access and actions](groups-workspaces-organizations.md#access-and-actions)

| Actor                                                                   | Organization template collection actions                                                                                                                                   |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current verified organization owner                                     | Appoint or revoke a curator in that active organization. Can appoint themselves. Collection writes require an active curator grant.                                        |
| Current member with a curator grant                                     | Create, read, and rename private or published collections, add or remove pinned publications, and publish or unpublish. Management is limited to the grant's organization. |
| Current verified non-billing organization member                        | Discover published collections and visible entries in the selected authorized organization. Each entry's preview and copy actions come from current Library authority.     |
| Billing-only member, former member, outside principal, or public bearer | No collection discovery, management, or content access through this feature.                                                                                               |

The grant carries no organization administration, group ownership, original authoring or delivery,
publication sharing or revocation, response or report access, billing authority, or copy entitlement.
Organization admin, group owner, and workspace editor roles do not apply curator rights implicitly.
Organization group collections retain their joined-only audience. An organization-wide template
collection always uses the audience of the original organization-wide publication.

An eligible member can join a workspace-licensed organization without being assigned a workspace.
Provide an identity-only route under Templates outside the workspace provider. Link it from
Organization and the regular Templates page. Resolve the signed-in principal independently of the
active creator workspace. The organization route's
discovery, preview, media, and curator management requests use identity plus current organization
membership and applicable curator or owner authority. The current Templates workspace shell
redirects authenticated users without workspace access to account setup, so organization
discovery and management need an entry point outside that gate. With no eligible destination,
show the publication and the reason copying is unavailable. Copy operations continue to require
authenticated workspace authority.

## Curation and discovery

1. A curator names a private collection and optionally adds a short plain-text description. They
   choose from existing eligible same-organization Library shares with `audience: "organization"`.
   Each entry stores the exact share ID, once per collection. The server checks the curator's
   current Library read access and the publication and version eligibility on every add request.
   Direct recipient shares, drafts, foreign publications, and unsupported types cannot be added.
   An explicit **Publish collection** makes the selection discoverable to eligible members.
2. **From your organization** in Templates lists published collections for the selected authorized
   organization. The server resolves that selection from current membership. Apply membership,
   collection status, visibility of each share, and supported-format checks before search, facets,
   counts, ordering, and pagination. Omit a collection with no visible entries from discovery.
   Direct entry reads verify the current association, publication, and recipient. Metadata includes
   collection label, title, artifact kind, source workspace as owner attribution, and the pinned
   publication version. Look up the ordinal from the exact authorized published record for the
   share's workspace, artifact, and version ID. Display the stored ordinal for Rounds and
   Presentations. Use **Published version** for a format without a publication ordinal, such
   as Survey, whose published record carries a draft revision. Use the immutable version ID as
   the binding for every format. An unverifiable pinned record makes the entry unavailable.
   The latest version and the Presentation review projection's placeholder version do not
   supply this label.
   The internal share creator is the publisher and supplies no personal ownership label.
3. Reuse the Library's authorized published-content and media readers for the exact version.
   The collection preview response projects only the needed published fields. It omits sharing
   messages and follow-up metadata from the network payload as well as private drafts, speaker
   notes, source citations, and participant records. Fetch preview and media through current
   collection-aware authorization and recheck placement before returning prepared content or
   media. Use a client that performs reads only. The full shared
   reader can mark a first open **In progress**. [Library access and lifecycle](organization-shared-library.md)
4. Display the source's **Can view** or **Can use** permission and the current destination copy
   capability. A **Can use** share can be temporarily unavailable for copying. Offer **Use a copy**
   only when the current destination is active, in the same organization, and the member has the
   required role, license, and format capability. Show the destination before confirmation.
   Include the expected workspace ID, published placement, and request ID in the collection
   copy request. The existing Library copy request supplies only a request ID, so the collection
   entry point must compare the expected workspace with the authenticated active workspace before
   a fresh copy or receipt recovery. Return a stale-destination conflict on mismatch. Refresh
   and confirm the new destination as a new intent. Once validated, reuse the canonical Library
   copy service with the confirmed destination and its commit-time checks.

   Before looking for a receipt, verify the actor, the current placement, source visibility and
   use permission, and the destination's current membership, authoring role, and license. The
   receipt still requires an accessible destination draft. Bind the request key and its receipt
   to the actor, organization,
   collection, exact entry ID and collection publication revision, share and pinned version,
   and destination workspace. Persist the receipt with the draft and media in the same transaction.
   A key used for another placement or standalone Library copy conflicts, even for the same share
   and destination. Return a matching committed receipt for a still-authorized destination draft
   before checking fresh writer availability, reserving copy capacity, or reading or cloning source
   media. An original source image outage or writer pause therefore has no effect on an otherwise
   authorized receipt. With no receipt, apply fresh writer checks and prepare the copy. Recheck
   authority and the receipt in the final transaction before committing so concurrent exact
   requests create only one draft.

   Qualify destination format restrictions before exposing supported Round, Presentation, or Survey
   entries in Templates. In particular, check the destination Round response protocol and Survey
   copy availability. Keep authorized preview available when a destination writer is paused.
   A committed copy has a new artifact identity and independent media and history. Authored
   checkpoint IDs may remain scoped to that copy under the existing format.

Use an authorized metadata query derived from Library visibility. Search only displayed collection
names and descriptions, published item titles, and source workspace names. Filter and facet on
artifact kind and publication permission. Sort by the displayed title with deterministic ID
tie-breakers. Compute matches, counts, facets, ordering, and cursor positions from that same
authorized projection. Sharing messages, review dates, progress and other recipient follow-up
fields are excluded from both the discovery response and every query input. Bind cursor and client
request state to the actor, selected organization, copy destination (including no destination),
collection, and filters. Reject a mismatched cursor and recheck current visibility on every page.
Use private, no-store responses.
[Library discovery and pagination](library-discovery.md#queries-and-pagination)

## Revocation, cleanup, and audit

- Recheck the owner's verified identity, membership and organization status inside appointment
  and revocation writes. Revoke the exact grant ID so an older confirmation cannot revoke a
  replacement appointment.
  Removing membership, account deletion, or moving to billing-only membership ends the grant.
  Returning membership requires explicit reappointment. Revoking the grant stops management and
  leaves the collection owned by the organization. Another authorized curator can take over.
  A former curator who remains an eligible member can still browse published collections.
- Removing an entry or unpublishing a collection invalidates its placement on subsequent server
  requests. Check the exact entry ID and current collection publication revision for all preview,
  media, copy, and copy receipt reads. A new entry or publication revision also cannot recover
  a receipt bound to the old placement. Recheck placement in the same transaction as a fresh
  copy commit. If withdrawal wins the race, the collection action becomes unavailable.
  If the copy committed first, the new artifact remains accessible through the recipient
  workspace's authority.
  Standalone Library actions retain the share's independent audience and capabilities. A newer
  version needs a new share and an explicit curator selection. Share revocation, source or version
  deletion, and the source leaving the collection's organization remove the entry from every
  collection result and facet. Retire those associations durably. A source returning to the
  organization requires a new authorized share and selection.
  Temporarily unavailable sources can retain a hidden association while Library access is
  suspended. An authorized curator can remove the association without seeing any restricted source
  data. Restoration requires the original share to qualify again. Completed independent copies
  keep their existing lifecycle.
- Revalidate list and preview on navigation, focus, or reconnect. Clear existing results when
  identity, organization, or destination changes or the server denies access. Ignore stale
  responses. The server enforces revocation on subsequent requests. Confirm whether open tabs
  also need push invalidation before accepting the experience. Source revocation always uses the
  canonical Library media and copy checks even when a user still sees an old card.
- Serialize grant changes, curator commands, and source eligibility checks with membership loss,
  collection state changes, and share revocation. Use the existing identity and organization
  lock order and the same transaction/client for each write. Check current authority and grant
  identity before serving a matching receipt for the request key and original intent. Apply the
  expected collection revision to new mutations after checking for an exact retry. An old grant's
  request cannot attach to a new appointment. Commit the successful mutation, audit event, and
  minimal receipt together. A retry with current authority replays the receipt without another
  write or audit entry.
- Record grant, revocation, create, metadata change, entry add/remove, and publish/unpublish using
  organization-scoped audit. Include actor, action, timestamp, request correlation, organization
  and target IDs, and relevant state transitions. Omit snapshots, descriptions, emails, and
  participant data. Establish audit visibility, export and erasure behavior, and retention before
  enabling writes. [Current platform audit transaction](../apps/server/src/platform-routes.ts)

## Qualification before rollout

| Scenario                                                                   | Expected behavior                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner appoints an eligible member who has no active workspace              | The member opens Templates, discovers, and previews eligible items without account setup, and can manage collections in the grant's organization. Copy is unavailable until there is an eligible destination. Organization admin, group owner, and workspace editor alone cannot curate. |
| A known direct, draft, revoked, unsupported, or foreign source is supplied | It is absent from the picker and cannot be attached by direct request. Foreign, removed, or billing-only principals receive no entry data, metadata totals, or cursors for that organization.                                                                                            |
| Publish, unpublish, or filter a mixed collection                           | Search, counts and page boundaries use the same authorized entries as detail. A principal switching between two organizations loses prior rows, cursors, media and pending client results.                                                                                               |
| A sharing message, review date, or recipient progress changes              | Search matches, counts, facets, order, cursor boundaries, and returned discovery metadata stay the same. Query parameters for those fields are rejected.                                                                                                                                 |
| A collection pins the second published Presentation and a Survey           | The Presentation shows the second publication's ordinal even after a later version appears. The Survey shows **Published version**. An unavailable pinned record is withheld.                                                                                                            |
| Source author publishes an update, then revokes the original               | The entry stays pinned until revoked or deliberately replaced. List, detail, preview and subsequent media/copy access stop using the revoked share. Earlier independent copies remain available through workspace authority.                                                             |
| Unpublish or unlink during preview or copy                                 | Old placement requests fail, including after republishing or re-adding the entry. Test withdrawal racing copy commit and a lost copy acknowledgement. A transferable source returning to the organization cannot revive its old placement.                                               |
| Re-pin the same share or copy it from a different collection               | Reusing the first placement's request key conflicts and neither returns the old receipt nor creates a draft. Exercise the standalone Library route with that key as well.                                                                                                                |
| Lose the acknowledgement after an image-bearing copy commits               | With the original placement and destination still authorized, retry returns the receipt even when source storage is unavailable or fresh creation is paused. It performs no new media cloning. Concurrent exact requests commit one draft.                                               |
| Preview and Use a copy                                                     | Preview creates no progress, draft, response, or session. Enforce view-only, read-only destination, no seat, a paused destination Round protocol or Survey writer, and a stale destination. An exact copy retry recovers one local draft with independent media.                         |
| Concurrent writes, revoke, and remove/rejoin                               | Test a curator command racing grant removal, share revocation or membership change. Stale revocations leave replacement grants intact. Audit failure rolls back the mutation, and retry adds at most one successful audit event.                                                         |
| Recovery and accessibility                                                 | Test private/published, empty, unavailable, and error/retry states, plus narrow-screen and keyboard preview, focus return, destination change, and revoked media.                                                                                                                        |

After acceptance, start with the grant and association repository and qualify forced RLS and
concurrency in PostgreSQL and equivalent behavior in memory. Then qualify Templates discovery
and each format's preview and copy. Organization-wide curation is the proposed scope. Group-only
template discovery and the public marketplace remain separate product decisions.

## Baseline verification

On `a7f3975`, 83 existing tests passed across Library sharing APIs and projections, organization
Groups, database adapters, Templates, and the shared Library and reader. The database suites
skipped 27 environment-dependent cases. The current collection proposal still needs the
qualification above, including PostgreSQL concurrency and restricted-role RLS.
