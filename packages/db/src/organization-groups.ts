import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CollaborationGroupPurpose, CollaborationGroupStatus } from "@openround/contracts";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { getMemoryPlatformRepository } from "./platform-memory.js";
import type { OrganizationMemberRecord, OrganizationRecord } from "./platform-types.js";
import type { Repository } from "./types.js";
import { createLibrarySharingRepository, MemoryLibrarySharingStore } from "./library-sharing.js";
import { createPresentationRepository } from "./presentations.js";
import { createSurveyRepository } from "./surveys.js";

export class OrganizationGroupError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT",
    message: string,
  ) {
    super(message);
  }
}
interface Member {
  userId: string;
  role: "owner" | "member";
  joinedAt: string;
}
interface Message {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string;
}
export interface OrganizationGroupState {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  purpose: CollaborationGroupPurpose;
  status: CollaborationGroupStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  members: Member[];
  messages: Message[];
  shareIds: string[];
}
interface Context {
  organizationId: string;
  organizationName: string;
  canCreate: boolean;
  directory: Array<{ userId: string; email: string }>;
}
interface Transaction {
  publication(shareId: string, organizationId: string): Promise<boolean>;
  retainedPublications(shareIds: string[], organizationId: string): Promise<string[]>;
  context(organizationId: string): Promise<Context | null>;
  workspaceOrganization(workspaceId: string): Promise<string | null>;
  get(id: string): Promise<OrganizationGroupState | null>;
  list(): Promise<OrganizationGroupState[]>;
  save(group: OrganizationGroupState, previous: OrganizationGroupState | null): Promise<void>;
}
type Run = <T>(actorId: string, work: (tx: Transaction) => Promise<T>) => Promise<T>;
const unavailable = () => {
  throw new OrganizationGroupError("NOT_FOUND", "Group not found");
};
function owner(group: OrganizationGroupState, actorId: string) {
  if (!group.members.some((member) => member.userId === actorId && member.role === "owner"))
    throw new OrganizationGroupError("FORBIDDEN", "Only group owners can manage this group");
}
function active(group: OrganizationGroupState) {
  if (group.status === "archived")
    throw new OrganizationGroupError("CONFLICT", "Restore this group before making changes");
}
export class OrganizationGroupRepository {
  constructor(private readonly run: Run) {}
  context(actorId: string, workspaceId: string) {
    return this.run(actorId, async (tx) => {
      const id = await tx.workspaceOrganization(workspaceId);
      const context = id ? await tx.context(id) : null;
      return context
        ? {
            organizationId: context.organizationId,
            organizationName: context.organizationName,
            canCreateOrganizationGroup: context.canCreate,
          }
        : { organizationId: null, organizationName: null, canCreateOrganizationGroup: false };
    });
  }
  private async access(tx: Transaction, actorId: string, id: string) {
    const group = await tx.get(id);
    if (!group) return unavailable();
    const context = await tx.context(group.organizationId);
    if (!context || !group.members.some((member) => member.userId === actorId))
      return unavailable();
    const current = new Set(context.directory.map((member) => member.userId));
    // Stale roster records never confer access, including billing-only and unverified identities.
    group.members = group.members.filter((member) => current.has(member.userId));
    if (!current.has(actorId)) return unavailable();
    return { group, context };
  }
  list(actorId: string) {
    return this.run(actorId, async (tx) => {
      const result: Array<{ group: OrganizationGroupState; context: Context }> = [];
      for (const group of await tx.list()) {
        const context = await tx.context(group.organizationId);
        if (!context) continue;
        const current = new Set(context.directory.map((member) => member.userId));
        group.members = group.members.filter((member) => current.has(member.userId));
        if (group.members.some((member) => member.userId === actorId))
          result.push({ group, context });
      }
      return result;
    });
  }
  detail(actorId: string, id: string) {
    return this.run(actorId, (tx) => this.access(tx, actorId, id));
  }
  create(
    actorId: string,
    organizationId: string,
    input: { name: string; description: string; purpose: CollaborationGroupPurpose },
  ) {
    return this.run(actorId, async (tx) => {
      const context = await tx.context(organizationId);
      if (!context?.canCreate)
        throw new OrganizationGroupError(
          "FORBIDDEN",
          "Only organization owners and administrators can create organization groups",
        );
      const now = new Date().toISOString();
      const group: OrganizationGroupState = {
        id: randomUUID(),
        organizationId,
        name: input.name,
        description: input.description,
        purpose: input.purpose,
        status: "active",
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
        members: [{ userId: actorId, role: "owner", joinedAt: now }],
        messages: [],
        shareIds: [],
      };
      await tx.save(group, null);
      return { group, context };
    });
  }
  private mutate<T>(
    actorId: string,
    id: string,
    change: (group: OrganizationGroupState, context: Context) => T,
    allowArchived = false,
  ) {
    return this.run(actorId, async (tx) => {
      const { group, context } = await this.access(tx, actorId, id);
      if (!allowArchived) active(group);
      const before = structuredClone(group);
      const result = change(group, context);
      group.updatedAt = new Date().toISOString();
      await tx.save(group, before);
      return result;
    });
  }
  update(
    actorId: string,
    id: string,
    update: Partial<Pick<OrganizationGroupState, "name" | "description" | "purpose" | "status">>,
  ) {
    return this.mutate(
      actorId,
      id,
      (group) => {
        owner(group, actorId);
        if (
          group.status === "archived" &&
          !(update.status === "active" && Object.keys(update).length === 1)
        )
          active(group);
        Object.assign(group, update);
        return group;
      },
      true,
    );
  }
  addMember(actorId: string, id: string, userId: string) {
    return this.mutate(actorId, id, (group, context) => {
      owner(group, actorId);
      if (!context.directory.some((member) => member.userId === userId))
        throw new OrganizationGroupError("NOT_FOUND", "Organization member not found");
      const existing = group.members.find((member) => member.userId === userId);
      if (existing) return existing;
      if (group.members.length >= 500)
        throw new OrganizationGroupError("CONFLICT", "A group can have up to 500 members");
      const member: Member = { userId, role: "member", joinedAt: new Date().toISOString() };
      group.members.push(member);
      return member;
    });
  }
  changeMember(actorId: string, id: string, userId: string, role: "owner" | "member" | null) {
    return this.mutate(actorId, id, (group) => {
      owner(group, actorId);
      const member = group.members.find((candidate) => candidate.userId === userId);
      if (!member) return unavailable();
      if (
        member.role === "owner" &&
        role !== "owner" &&
        !group.members.some(
          (candidate) => candidate.userId !== userId && candidate.role === "owner",
        )
      )
        throw new OrganizationGroupError("CONFLICT", "A group must keep at least one owner");
      if (role === null)
        group.members = group.members.filter((candidate) => candidate.userId !== userId);
      else member.role = role;
      return member;
    });
  }
  message(actorId: string, id: string, body: string) {
    return this.mutate(actorId, id, (group) => {
      const message = {
        id: randomUUID(),
        authorId: actorId,
        body,
        createdAt: new Date().toISOString(),
      };
      group.messages.push(message);
      // Discussion is deliberately bounded; this is not an organization chat archive.
      group.messages = group.messages.slice(-100);
      return message;
    });
  }
  link(actorId: string, id: string, shareId: string, add: boolean) {
    return this.run(actorId, async (tx) => {
      const { group } = await this.access(tx, actorId, id);
      active(group);
      owner(group, actorId);
      const before = structuredClone(group);
      if (add) {
        if (!(await tx.publication(shareId, group.organizationId)))
          throw new OrganizationGroupError("NOT_FOUND", "Organization publication not found");
        // Revoked/deleted publications cannot be removed through the authorized reader.
        // Release their slots in this same mutation; reversible source suspension/archive
        // retains its association and reserved slot, so restoring it cannot exceed the limit.
        group.shareIds = await tx.retainedPublications(group.shareIds, group.organizationId);
      }
      if (add && !group.shareIds.includes(shareId)) {
        if (group.shareIds.length >= 100)
          throw new OrganizationGroupError(
            "CONFLICT",
            "A group can collect up to 100 publications",
          );
        group.shareIds.push(shareId);
      } else if (!add) group.shareIds = group.shareIds.filter((candidate) => candidate !== shareId);
      group.updatedAt = new Date().toISOString();
      await tx.save(group, before);
      return group;
    });
  }
}
class MemoryOrganizationGroups implements MemoryRepositoryLifecycleExtension {
  readonly groups = new Map<string, OrganizationGroupState>();
  constructor(private readonly repository: MemoryRepository) {}
  deleteLibraryShareMetadata(shareId: string) {
    for (const group of this.groups.values())
      group.shareIds = group.shareIds.filter((id) => id !== shareId);
  }
  run: Run = (actorId, work) =>
    getMemoryPlatformRepository(this.repository).withTransaction(async () => {
      const platform = getMemoryPlatformRepository(this.repository).memoryStore;
      const before = structuredClone(this.groups);
      try {
        return await work({
          retainedPublications: async (ids, organizationId) => {
            const store = this.repository.getOrCreateLifecycleExtension(
              "library-sharing",
              () => new MemoryLibrarySharingStore(this.repository),
            );
            const retained: string[] = [];
            for (const id of ids) {
              const share = store.shares.get(id);
              if (
                !share ||
                share.revokedAt ||
                share.organizationId !== organizationId ||
                share.audience !== "organization"
              )
                continue;
              const source =
                share.artifactType === "round"
                  ? await this.repository.getQuiz(share.sourceWorkspaceId, share.artifactId)
                  : share.artifactType === "presentation"
                    ? await createPresentationRepository(this.repository).getPresentation(
                        share.sourceWorkspaceId,
                        share.artifactId,
                      )
                    : await createSurveyRepository(this.repository).get(
                        share.sourceWorkspaceId,
                        share.artifactId,
                      );
              if (source) retained.push(id);
            }
            return retained;
          },
          publication: async (id, organizationId) => {
            const share = await createLibrarySharingRepository(this.repository).read({
              actorId,
              id,
            });
            return share?.organizationId === organizationId && share.audience === "organization";
          },
          workspaceOrganization: (id) => platform.organizationIdForWorkspace(id),
          context: async (id) => {
            const org = platform.getSync<OrganizationRecord>("organization", id);
            const actor = this.repository.users.get(actorId);
            const membership = platform.getSync<OrganizationMemberRecord>(
              "member",
              `${id}:${actorId}`,
            );
            if (
              !actor?.emailVerifiedAt ||
              actor.deletedAt ||
              !membership ||
              membership.role === "billing" ||
              org?.status !== "active" ||
              org.accountType !== "organization"
            )
              return null;
            const directory = platform
              .listSync<OrganizationMemberRecord>("member", id)
              .flatMap((member) => {
                const user = this.repository.users.get(member.userId);
                return member.role !== "billing" && user?.emailVerifiedAt && !user.deletedAt
                  ? [{ userId: member.userId, email: user.email }]
                  : [];
              })
              .sort((a, b) => a.email.localeCompare(b.email));
            return {
              organizationId: id,
              organizationName: org.name,
              canCreate: membership.role === "owner" || membership.role === "admin",
              directory,
            };
          },
          get: async (id) => structuredClone(this.groups.get(id) ?? null),
          list: async () =>
            structuredClone(
              [...this.groups.values()].filter((group) =>
                group.members.some((member) => member.userId === actorId),
              ),
            ),
          save: async (group) => {
            this.groups.set(group.id, structuredClone(group));
          },
        });
      } catch (error) {
        this.groups.clear();
        for (const [id, group] of before) this.groups.set(id, group);
        throw error;
      }
    });
  deleteOrganizationGroupMembership(organizationId: string, userId: string) {
    const before = structuredClone(this.groups);
    for (const group of this.groups.values())
      if (group.organizationId === organizationId) {
        group.members = group.members.filter((member) => member.userId !== userId);
        if (group.members.length && !group.members.some((member) => member.role === "owner"))
          group.members.sort(
            (a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.userId.localeCompare(b.userId),
          )[0]!.role = "owner";
        if (!group.members.length) this.groups.delete(group.id);
      }
    return () => {
      this.groups.clear();
      for (const [id, group] of before) this.groups.set(id, group);
    };
  }
  exportAccount({ userId }: MemoryRepositoryLifecycleContext) {
    return {
      organizationGroups: structuredClone(
        [...this.groups.values()]
          .filter((group) => group.createdBy === userId)
          .map(({ members: _members, messages: _messages, shareIds: _shares, ...group }) => group),
      ),
      organizationGroupMemberships: [...this.groups.values()].flatMap((group) =>
        group.members
          .filter((member) => member.userId === userId)
          .map((member) => ({ groupId: group.id, ...member })),
      ),
      organizationGroupMessages: [...this.groups.values()].flatMap((group) =>
        group.messages
          .filter((message) => message.authorId === userId)
          .map((message) => ({ groupId: group.id, ...message })),
      ),
    };
  }
  deleteAccount({ userId }: MemoryRepositoryLifecycleContext) {
    for (const group of this.groups.values()) {
      if (group.createdBy === userId) group.createdBy = null;
      for (const message of group.messages)
        if (message.authorId === userId) {
          message.authorId = null;
          message.body = "Message removed";
        }
    }
  }
}
function postgresRun(repository: PostgresRepository): Run {
  return async (actorId, work) => {
    const client = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.system_access','on',true),set_config('app.group_user_id',$1,true)",
        [actorId],
      );
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('identity',73501))");
      const locked = new Set<string>();
      const lock = async (org: string) => {
        if (!locked.has(org)) {
          await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1,73501))", [
            `org:${org}`,
          ]);
          locked.add(org);
        }
      };
      const load = async (id: string) => {
        const found = await client.query(
          "SELECT organization_id FROM organization_collaboration_groups WHERE id=$1",
          [id],
        );
        if (!found.rows[0]) return null;
        await lock(found.rows[0].organization_id);
        const result = await client.query(
          "SELECT * FROM organization_collaboration_groups WHERE id=$1 FOR UPDATE",
          [id],
        );
        const row = result.rows[0];
        if (!row) return null;
        const members = await client.query(
          "SELECT user_id,role,joined_at FROM organization_collaboration_group_members WHERE group_id=$1 ORDER BY joined_at,user_id",
          [id],
        );
        const messages = await client.query(
          "SELECT id,author_id,body,created_at FROM organization_collaboration_group_messages WHERE group_id=$1 ORDER BY created_at,id",
          [id],
        );
        const links = await client.query(
          "SELECT share_id FROM organization_collaboration_group_library WHERE group_id=$1 ORDER BY created_at,share_id",
          [id],
        );
        return {
          id: row.id,
          organizationId: row.organization_id,
          name: row.name,
          description: row.description,
          purpose: row.purpose,
          status: row.status,
          createdBy: row.created_by,
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
          members: members.rows.map((member) => ({
            userId: member.user_id,
            role: member.role,
            joinedAt: new Date(member.joined_at).toISOString(),
          })),
          messages: messages.rows.map((message) => ({
            id: message.id,
            authorId: message.author_id,
            body: message.body,
            createdAt: new Date(message.created_at).toISOString(),
          })),
          shareIds: links.rows.map((link) => link.share_id),
        } as OrganizationGroupState;
      };
      const result = await work({
        retainedPublications: async (ids, organizationId) => {
          if (!ids.length) return [];
          const result = await client.query(
            `SELECT share.id FROM library_shares share
             WHERE share.id=ANY($1::uuid[]) AND share.organization_id=$2
               AND share.audience='organization' AND share.revoked_at IS NULL
               AND CASE share.artifact_type
                 WHEN 'round' THEN EXISTS(SELECT 1 FROM quizzes parent WHERE parent.id=share.artifact_id AND parent.workspace_id=share.workspace_id)
                 WHEN 'presentation' THEN EXISTS(SELECT 1 FROM presentations parent WHERE parent.id=share.artifact_id AND parent.workspace_id=share.workspace_id)
                 ELSE EXISTS(SELECT 1 FROM surveys parent WHERE parent.id=share.artifact_id AND parent.workspace_id=share.workspace_id)
               END FOR SHARE OF share`,
            [ids, organizationId],
          );
          const retained = new Set<string>(result.rows.map((row) => row.id));
          return ids.filter((id) => retained.has(id));
        },
        publication: async (id, organizationId) => {
          // Same transaction/client: acquiring a second pool connection under the group lock
          // would deadlock a bounded pool during concurrent curation.
          const result = await client.query(
            `SELECT share.id FROM library_shares share JOIN workspaces workspace ON workspace.id=share.workspace_id WHERE share.id=$1 AND share.organization_id=$2 AND share.audience='organization' AND share.revoked_at IS NULL AND workspace.platform_status='active' AND workspace.deletion_started_at IS NULL AND NOT EXISTS(SELECT 1 FROM workspace_media_deletion_jobs job WHERE job.workspace_id=workspace.id) AND CASE share.artifact_type WHEN 'round' THEN EXISTS(SELECT 1 FROM quizzes parent WHERE parent.id=share.artifact_id AND parent.workspace_id=share.workspace_id AND parent.status<>'archived') WHEN 'presentation' THEN EXISTS(SELECT 1 FROM presentations parent WHERE parent.id=share.artifact_id AND parent.workspace_id=share.workspace_id AND parent.status<>'archived') ELSE EXISTS(SELECT 1 FROM surveys parent WHERE parent.id=share.artifact_id AND parent.workspace_id=share.workspace_id AND parent.data->>'status'<>'archived') END FOR SHARE OF share,workspace`,
            [id, organizationId],
          );
          return result.rows.length === 1;
        },
        workspaceOrganization: async (id) =>
          (await client.query("SELECT organization_id FROM workspaces WHERE id=$1", [id])).rows[0]
            ?.organization_id ?? null,
        context: async (id) => {
          await lock(id);
          const result = await client.query(
            `SELECT organization.name,member.role FROM organizations organization JOIN organization_members member ON member.organization_id=organization.id JOIN users principal ON principal.id=member.user_id WHERE organization.id=$1 AND principal.id=$2 AND principal.email_verified_at IS NOT NULL AND principal.deleted_at IS NULL AND member.role<>'billing' AND organization.account_type='organization' AND organization.status='active'`,
            [id, actorId],
          );
          const row = result.rows[0];
          if (!row) return null;
          const directory = await client.query(
            "SELECT principal.id AS user_id,principal.email FROM organization_members member JOIN users principal ON principal.id=member.user_id WHERE member.organization_id=$1 AND member.role<>'billing' AND principal.email_verified_at IS NOT NULL AND principal.deleted_at IS NULL ORDER BY principal.email",
            [id],
          );
          return {
            organizationId: id,
            organizationName: row.name,
            canCreate: row.role === "owner" || row.role === "admin",
            directory: directory.rows.map((person) => ({
              userId: person.user_id,
              email: person.email,
            })),
          };
        },
        get: load,
        list: async () => {
          const rows = await client.query(
            "SELECT group_id FROM organization_collaboration_group_members WHERE user_id=$1 ORDER BY group_id",
            [actorId],
          );
          const groups: OrganizationGroupState[] = [];
          for (const row of rows.rows) {
            const group = await load(row.group_id);
            if (group) groups.push(group);
          }
          return groups;
        },
        save: (group, before) => savePostgres(client, group, before),
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
}
async function savePostgres(
  client: PoolClient,
  group: OrganizationGroupState,
  before: OrganizationGroupState | null,
) {
  if (!before)
    await client.query(
      `INSERT INTO organization_collaboration_groups(id,organization_id,name,description,purpose,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        group.id,
        group.organizationId,
        group.name,
        group.description,
        group.purpose,
        group.status,
        group.createdBy,
        group.createdAt,
        group.updatedAt,
      ],
    );
  for (const member of before?.members ?? [])
    if (!group.members.some((candidate) => candidate.userId === member.userId))
      await client.query(
        "DELETE FROM organization_collaboration_group_members WHERE group_id=$1 AND user_id=$2",
        [group.id, member.userId],
      );
  for (const member of group.members)
    if (
      !before?.members.some(
        (candidate) => candidate.userId === member.userId && candidate.role === member.role,
      )
    )
      await client.query(
        `INSERT INTO organization_collaboration_group_members(organization_id,group_id,user_id,role,joined_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(group_id,user_id) DO UPDATE SET role=EXCLUDED.role`,
        [group.organizationId, group.id, member.userId, member.role, member.joinedAt],
      );
  for (const shareId of before?.shareIds ?? [])
    if (!group.shareIds.includes(shareId))
      await client.query(
        "DELETE FROM organization_collaboration_group_library WHERE group_id=$1 AND share_id=$2",
        [group.id, shareId],
      );
  for (const shareId of group.shareIds)
    if (!before?.shareIds.includes(shareId))
      await client.query(
        "INSERT INTO organization_collaboration_group_library(organization_id,group_id,share_id) VALUES($1,$2,$3)",
        [group.organizationId, group.id, shareId],
      );
  for (const message of before?.messages ?? [])
    if (!group.messages.some((candidate) => candidate.id === message.id))
      await client.query(
        "DELETE FROM organization_collaboration_group_messages WHERE group_id=$1 AND id=$2",
        [group.id, message.id],
      );
  for (const message of group.messages)
    if (!before?.messages.some((candidate) => candidate.id === message.id))
      await client.query(
        "INSERT INTO organization_collaboration_group_messages(id,organization_id,group_id,author_id,body,created_at) VALUES($1,$2,$3,$4,$5,$6)",
        [
          message.id,
          group.organizationId,
          group.id,
          message.authorId,
          message.body,
          message.createdAt,
        ],
      );
  if (before)
    await client.query(
      "UPDATE organization_collaboration_groups SET name=$2,description=$3,purpose=$4,status=$5,updated_at=$6 WHERE id=$1",
      [group.id, group.name, group.description, group.purpose, group.status, group.updatedAt],
    );
}
export function createOrganizationGroupRepository(repository: Repository) {
  if (repository instanceof PostgresRepository)
    return new OrganizationGroupRepository(postgresRun(repository));
  if (repository instanceof MemoryRepository) {
    const store = repository.getOrCreateLifecycleExtension(
      "organization-groups",
      () => new MemoryOrganizationGroups(repository),
    );
    return new OrganizationGroupRepository(store.run);
  }
  throw new Error("Organization groups require a supported repository");
}
