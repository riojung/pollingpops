# Organization Library and Shared with me

## Problem and current behavior

Rounds, Presentations and Surveys belong to a workspace. Today every workspace member can read its content, and workspace owners/editors can author it. The current Library is therefore a workspace library, rather than a private per-author library. User-licensed organizations commonly give each member a separate workspace, which prevents colleagues from discovering one another's content.

The new organization library adds explicit distribution across those workspace boundaries. It does not automatically expose existing content or grant recipients membership in the source workspace.

## Product model

The Library has three primary scopes:

| Scope                | Contents                                                   | Main action                                                                 |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| My workspace         | Existing content in the active workspace                   | Continue its current edit, host, assignment or collection workflow          |
| Organization library | Published versions explicitly shared with the organization | Open, then use a copy when permitted                                        |
| Shared with me       | Published versions sent directly to the signed-in member   | Read the sender's request, review the content, acknowledge it or use a copy |

A management view lets authorized sharers inspect and revoke their publications. Content types remain Rounds, Presentations and Surveys inside each scope. Search retains the selected scope and type.

Each shared item identifies its organization, source workspace, content type, permission, sharing time, optional message and due date. Personal follow-up state is **New**, **In progress** or **Done**. These states describe the recipient's acknowledgement, not learning mastery or verified assessment completion.

The first version searches the metadata pages already loaded; **Load more** expands the searched set. Review dates display an overdue indicator for unfinished items when the view renders or refreshes. They do not send reminders or expire access.

The scope label is **My workspace**, not **My private files**: existing workspace access remains in force.

## Access and ownership

Sharing is authenticated and organization bounded. A verified, current organization member may receive an item without becoming a member of its source workspace. Billing-only membership does not grant content access. Suspended/closed organizations, suspended/deleting source workspaces and removed members cannot use retained share records to recover access.

Only an authorized source-workspace editor/owner can publish its content. Organization administrators can manage organization distribution according to the server's management capability; ordinary recipients cannot reshare, edit or delete the original by receiving a share.

| Permission | Read shared publication | Copy into an authorized workspace                            | Edit original / see existing results         |
| ---------- | ----------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| Can view   | Yes                     | No                                                           | Requires separate, existing source authority |
| Can use    | Yes                     | Yes, after destination role, organization and license checks | Requires separate, existing source authority |

A copy is a new independent draft. It does not share the original's responses, sessions, results, delivery links, assignments or authoring history. The recipient uses the existing local publishing, hosting and assignment workflows after reviewing the draft. Copying stays inside the source organization and requires an active destination workspace where the recipient can author. The interface explains an unavailable copy action instead of implying that an organization content grant grants a paid seat or a workspace editor role.

Collaborative editing of an original across workspaces is a separate feature. It requires resource-level authorization across draft mutation/history, publishing, media, assistance, delivery and export routes; adding an editor dropdown alone would be unsafe.

## Publication and lifecycle

Sharing pins one immutable published version. Draft changes do not silently update it. A later publication must be shared deliberately, so a recipient never acknowledges different content under an unchanged version identifier.

The sharing dialog distinguishes organization-wide discovery from selected organization members. Direct recipient selection uses a narrow verified member directory rather than organization administration data. Permission defaults favor reading, and sharing requires an explicit action.

Private speaker notes and source citations are excluded from the shared reader and reusable copy. The reader renders questions without accepting participant responses. Viewing does not start a session or practice attempt. Readable content and protected images are delivered only after current authorization checks.

Revocation prevents future list, detail, media, acknowledgement and copy operations. Copies already created remain independent; this distinction must be visible when sharing and revoking. Source deletion cleans up associated sharing metadata. Account deletion/export follows the existing repository lifecycle model. Repeated mutation requests use durable idempotency receipts, and revoked records do not become active again through a replay.

## Architecture

- Additive contracts in `packages/contracts/src/library-sharing.ts` describe share creation, metadata, permissions and recipient progress.
- A unified `LibrarySharingRepository` supports all three artifact types in memory and PostgreSQL. It owns publication snapshots, discovery, recipients, progress, revocation and copy receipts.
- A new migration adds organization-scoped sharing records with forced row-level security, bounded recipient lists and discovery indexes. Source/version identity must match, and authorization must be current inside mutation transactions.
- A dedicated server route/service boundary under `/v1/library/shares` resolves the authenticated principal separately from the active workspace. Lists return metadata; detail/media routes return only an authorized published projection.
- Copying prepares independent media objects and commits destination media metadata, a new draft and an idempotency receipt together after rechecking source access and destination authority. Partial or rejected preparation must not leave an accessible foreign-workspace media reference.
- Existing canonical workspace authoring and delivery routes remain the authority for the new independent draft. A foreign source workspace ID is never substituted into them based only on client state.
- Frontend Library scope state and pending requests are bound to identity/workspace. Uncertain copy request IDs survive component remounts and use per-tab storage for reload recovery, so retries replay the original copy receipt. Server capabilities determine actions on shared items; the active workspace's global `canEdit` flag is not authority over a foreign source.
- Authenticated image reads use a bounded client queue with cancellation and finite retries for temporary server limits. Reader cleanup removes waiting requests and releases object URLs; images are not placed in a shared content cache.

Organization and identity changes must serialize with shared-content writes using the existing platform lock ordering. SQL and in-memory implementations must agree on real membership and must not use legacy synthetic workspace membership as an authorization shortcut.

## Verification

Required coverage includes:

- Company members with separate workspaces can discover explicitly published content of all three types.
- Unpublished workspace content and foreign organizations remain undiscoverable, including counts, directories, media and direct URLs.
- Direct shares reach only the intended organization members and appear in Shared with me.
- View-only access cannot copy or mutate the original; Can use creates an independent draft in a permitted same-organization destination.
- Source updates do not alter a pinned publication; notes, source citations and existing participant data do not leak.
- Membership removal, suspension, source deletion and revocation invalidate every subsequent operation, including concurrent copy commits and request retries.
- Copy receipts, media cleanup and recipient acknowledgement are idempotent and identity scoped.
- Keyboard operation, narrow screens, light/dark contrast, empty/error states, search scope and stale request cancellation work in the Library and reader.

Run targeted contract, database and server conformance tests first, then browser journeys and the repository check before a pull request. PostgreSQL integration checks require the documented disposable test database; an in-memory pass is not evidence that PostgreSQL RLS or concurrency was exercised.

## Further product increments

After the published-content workflow is qualified, add group/department recipients, resource-scoped collaborative editing, reviewed updates to existing copies, richer administrative curation and aggregate distribution analytics. These must retain explicit access boundaries and should not repurpose public audience/review bearer links as authenticated company grants.

## Design references

The separation between organization-wide distribution and selected-member access follows established collaboration patterns, while the implementation remains original:

- [Canva: Share designs with your team](https://www.canva.com/help/team-sharing/) — whole-team and selected-member sharing with distinct access levels.
- [Canva: Set sharing permissions](https://www.canva.com/help/set-sharing-permissions-canva/) — explicit access levels and unshared work.
- [Google Workspace: How file access works in shared drives](https://support.google.com/a/users/answer/12380484) — distinguish inherited team access from direct access.

These are product design references, not specifications for Polling Pops authorization. The local contracts, repository rules and tests define its actual behavior.
