# Groups, workspaces and organizations

Groups organize people and shared work. A workspace remains the home of authored content and
delivery. An organization connects its members across their separate workspaces without granting
access to one another's drafts, results or authoring tools.

## Scope and purpose

The Groups directory contains only groups the signed-in person has joined. Filter by **Scope**,
**Purpose**, **My access** and **Status**, then search or sort the matching groups. Organization
groups have no public discovery, open join or request-to-join workflow. An organization owner or
administrator who has not joined a group cannot inspect its details or manage it.

| Scope        | People                                                                                        | Content and coordination                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Workspace    | Existing members of the owning workspace                                                      | Existing Round, Presentation, Guided workshop and Canvas collections, discussion and schedules under their current permissions |
| Organization | Verified, current non-billing members of the same active organization, added by a group owner | A curated selection of organization Library publications, group membership and discussion across members' workspaces           |

Each group has a purpose: `team`, `department`, `project`, `cohort`, `community` or `other`.
Purpose helps people find relevant groups; it does not change access. Groups have an `active` or
`archived` status and separate `owner` and `member` roles. An organization role and a group role
are distinct: organization owners and administrators may create organization groups, and the
creator becomes a group owner. Other organization members join only when a group owner adds them.

Use a compact creation form for name, description, scope and purpose. After creation, focus on
one **Content**, **Members** or **Discussion** panel. Workspace groups also have **Schedule**.
Keep membership and group settings separate from content use, so an authoring action is never
implied by a group role.

## Access and actions

All organization-group operations require a current verified, nondeleted identity, non-billing
membership in the same active organization and current membership in that group. Creating a
group requires organization owner or administrator authority instead of an existing group
membership. Personal accounts cannot create organization groups.

| Organization-group action                                 | Group owner                                  | Group member                                 | Organization owner/admin outside the group                            |
| --------------------------------------------------------- | -------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| Create an organization group                              | Only with organization owner/admin authority | Only with organization owner/admin authority | Yes; joins the new group as owner                                     |
| Find and open an existing joined group                    | Yes                                          | Yes                                          | No                                                                    |
| Read members and discussion                               | Yes                                          | Yes                                          | No                                                                    |
| Post to an active group                                   | Yes                                          | Yes                                          | No                                                                    |
| Add/remove members or change owner/member roles           | Yes, subject to the last-owner guard         | No                                           | No                                                                    |
| Add/remove curated Library publications                   | Yes                                          | No                                           | No                                                                    |
| Rename, change purpose or archive an active group         | Yes                                          | No                                           | No                                                                    |
| Restore an archived group                                 | Yes                                          | No                                           | No                                                                    |
| Read or use a publication                                 | Only through current Library capabilities    | Only through current Library capabilities    | Only through current Library capabilities, independently of the group |
| Host, assign or edit an original through group membership | No                                           | No                                           | No                                                                    |

Promote another current member before demoting or removing the last owner. Group membership does
not grant organization administration, workspace membership, a creator license or an editor role.
Workspace groups retain their existing additional workspace-role checks; a group role cannot
override an owning workspace's permissions. Clients use the server's action capabilities rather
than treating an active workspace's global edit flag as authority over organization content.

## Organization content is curation

An organization group can reference only an existing, same-organization Library publication with
`audience: "organization"`. The publication pins a published Round, Presentation or Survey.
Drafts, direct `people` shares, foreign-organization shares, Guided workshops and Canvas boards
cannot be added to an organization group in this increment.

Adding a publication to a group grants **zero additional content permissions**. Invitations
restrict group coordination; they do not restrict an organization-wide publication to that
group. A person outside the group can still discover that publication in the organization
Library when their current Library access permits it. Removing someone from a group stops their
group-detail and discussion access, while their legitimate organization-wide Library access
continues. Removing a group entry does not revoke the underlying publication.

The group reads metadata through current Library authorization and opens the existing shared
reader. Detail, images, progress and copy operations keep the Library's current membership,
source eligibility and revocation checks. A revoked, deleted or otherwise inaccessible
publication disappears from group content; a retained association cannot recover it.

A group can collect up to 100 publications. Adding an item clears associations to revoked,
deleted or invalid publications before applying this limit. Temporarily suspended or archived
sources retain their associations and reserve their slots, so restoring a source preserves the
collection without exceeding the limit.

**Can view** permits the shared reader. **Can use** additionally permits an independent draft
when the recipient can create that content type in an active workspace in the same organization
and has the required license. The copy contains no existing responses, sessions, delivery links
or results. Private speaker notes and source citations are excluded. Source changes do not
silently update the pinned publication, and revoking a publication leaves completed independent
copies intact. See [Organization Library and Shared with me](organization-shared-library.md).

## Schedule and archive

Organization groups omit the Schedule panel. **Content** shows publication follow-up dates and
the **Use a copy** workflow. A publication's optional **Review by** date and recipient progress
remain Library follow-up metadata: they neither expire access, send reminders nor establish
learning mastery. Organization groups do not host original content. After creating a permitted
copy, the recipient reviews and publishes it before using the normal local host, assignment or
Survey workflow.

Workspace groups retain existing schedules, including the owning workspace's published-content
and delivery permissions. Group curation never grants a new moderator or Canvas editing role.

Archive preserves a group's membership, discussion and associations for authorized reading.
Archived groups reject posts, membership changes, curated-content changes and metadata edits;
an authorized owner can restore the group in a separate action. Archiving or restoring a group
does not archive, republish or revoke its Library publications, source activities or copies.
Independent Library reader, acknowledgement and copy operations remain governed by Library access.

Archived workspace groups cannot be selected for new Canvas sharing or grant-role changes.
Existing board access continues under Canvas permissions, and an authorized source-board owner
or facilitator can still revoke the group's grant. Archive must not prevent permission
revocation or source-board cleanup; it does not itself revoke an existing board grant.

## Compatibility and lifecycle

Organization groups are additive. Migration **112** introduces their organization-scoped storage
and the common purpose/status metadata; existing workspace groups and their IDs, members,
artifacts, board grants, messages and schedules remain in place. Existing groups receive the
compatible `team` purpose and `active` status. Requests that omit `scope` continue to create
workspace groups. There is no automatic conversion, content move, extra workspace membership or
creator-seat allocation.

The existing `/v1/groups` collection serves both scopes with explicit scope metadata and current
capabilities. Workspace artifact and schedule endpoints keep their existing authority; organization
curation uses Library share IDs instead. Deploy the additive migration before the matching API
and interface. See the [Groups API reference](api.md#collaboration-groups).

Removing organization membership invalidates subsequent organization-group access. Retained
records must not restore a removed membership merely because a person rejoins the organization.
Account deletion/export and source-publication deletion follow their existing lifecycle hooks
with organization-group metadata included as appropriate. Permission checks remain current for
direct URLs and repeated requests as well as the directory.

Verification must cover joined-only discovery, cross-organization rejection, billing and removed
member denial, owner promotion/removal, archive/restore, current Library authorization, and
preservation of legacy workspace boards and schedules. Group removal must be tested separately
from publication revocation: only the latter revokes the organization-wide publication.

## Design references and rationale

The design separates organization administration, group coordination and content authority.
Purpose and directory filters help manage several kinds of group without multiplying permission
models. Owner-managed membership and a recoverable archive lifecycle keep the first increment
small while preserving existing workspaces.

The following official product documentation informed these choices, reviewed November 16, 2026:

- [Notion: Intro to teamspaces](https://www.notion.com/help/intro-to-teamspaces) separates
  owner/member roles and several access models. Polling Pops chooses owner-managed, joined-only
  organization groups for this increment.
- [Microsoft Teams: Find and join a team](https://support.microsoft.com/en-us/teams/teams-channels/find-and-join-a-team-in-microsoft-teams)
  distinguishes discoverability from joining and approval. Polling Pops exposes only joined
  groups and offers no open-join directory.
- [Slack: Archive or delete a channel](https://slack.com/help/articles/213185307-Archive-or-delete-a-channel)
  distinguishes retained history after archive from permanent deletion. Polling Pops uses
  archive/restore to preserve group coordination history.

These are design references, not inherited product promises or authorization specifications.
The Polling Pops contracts, repositories and API capabilities define the implemented boundary.
