import type { PoolClient, QueryResultRow } from "pg";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import type { Repository } from "./types.js";
import type {
  CollaborationGroupArtifactRecord,
  CollaborationGroupMemberRecord,
  CollaborationGroupMessageRecord,
  CollaborationGroupRecord,
  CollaborationGroupRepository,
  CollaborationGroupScheduleRecord,
} from "./group-types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function mapGroup(row: QueryResultRow): CollaborationGroupRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    description: String(row.description),
    createdBy: String(row.created_by),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
  };
}

function mapMember(row: QueryResultRow): CollaborationGroupMemberRecord {
  return {
    workspaceId: String(row.workspace_id),
    groupId: String(row.group_id),
    userId: String(row.user_id),
    role: row.role,
    joinedAt: row.joined_at instanceof Date ? row.joined_at : new Date(String(row.joined_at)),
  };
}

function mapArtifact(row: QueryResultRow): CollaborationGroupArtifactRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    groupId: String(row.group_id),
    artifactType: row.artifact_type,
    artifactId: String(row.artifact_id),
    addedBy: String(row.added_by),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
  };
}

function mapMessage(row: QueryResultRow): CollaborationGroupMessageRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    groupId: String(row.group_id),
    authorId: String(row.author_id),
    body: String(row.body),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
  };
}

function mapSchedule(row: QueryResultRow): CollaborationGroupScheduleRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    groupId: String(row.group_id),
    artifactType: row.artifact_type,
    artifactId: String(row.artifact_id),
    kind: row.kind,
    scheduledFor:
      row.scheduled_for instanceof Date ? row.scheduled_for : new Date(String(row.scheduled_for)),
    note: String(row.note),
    createdBy: String(row.created_by),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
  };
}

export class MemoryCollaborationGroupRepository
  implements CollaborationGroupRepository, MemoryRepositoryLifecycleExtension
{
  private readonly groups = new Map<string, CollaborationGroupRecord>();
  private readonly members = new Map<string, CollaborationGroupMemberRecord>();
  private readonly artifacts = new Map<string, CollaborationGroupArtifactRecord>();
  private readonly messages = new Map<string, CollaborationGroupMessageRecord>();
  private readonly schedule = new Map<string, CollaborationGroupScheduleRecord>();

  constructor(
    private readonly repository?: Pick<MemoryRepository, "isLibraryArtifactDeleted"> &
      Partial<Pick<MemoryRepository, "deleteCollaborationGroupMetadata" | "isIdeaBoardDeleted">>,
  ) {}

  deleteIdeaBoardMetadata(sourceBoardId: string) {
    for (const [id, artifact] of this.artifacts)
      if (artifact.artifactType === "idea_board" && artifact.artifactId === sourceBoardId)
        this.artifacts.delete(id);
  }

  deleteLibraryArtifactMetadata(
    workspaceId: string,
    artifactType: "round" | "presentation",
    artifactId: string,
  ) {
    for (const [id, artifact] of this.artifacts) {
      if (
        artifact.workspaceId === workspaceId &&
        artifact.artifactType === artifactType &&
        artifact.artifactId === artifactId
      )
        this.artifacts.delete(id);
    }
    for (const [id, item] of this.schedule) {
      if (
        item.workspaceId === workspaceId &&
        item.artifactType === artifactType &&
        item.artifactId === artifactId
      )
        this.schedule.delete(id);
    }
  }

  exportAccount({ userId, ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    return {
      collaborationGroups: [...this.groups.values()]
        .filter((group) => ownedWorkspaceIds.has(group.workspaceId))
        .map(clone),
      collaborationGroupMembers: [...this.members.values()]
        .filter((member) => ownedWorkspaceIds.has(member.workspaceId) || member.userId === userId)
        .map(clone),
      collaborationGroupArtifacts: [...this.artifacts.values()]
        .filter((artifact) => ownedWorkspaceIds.has(artifact.workspaceId))
        .map(clone),
      collaborationGroupMessages: [...this.messages.values()]
        .filter((message) => ownedWorkspaceIds.has(message.workspaceId))
        .map(clone),
      collaborationGroupSchedule: [...this.schedule.values()]
        .filter((item) => ownedWorkspaceIds.has(item.workspaceId))
        .map(clone),
    };
  }

  deleteAccount({ userId, ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    for (const [id, group] of this.groups) {
      if (ownedWorkspaceIds.has(group.workspaceId)) this.deleteGroupTree(id);
    }
    const ownedGroupIds = new Set(
      [...this.members.values()]
        .filter((member) => member.userId === userId && member.role === "owner")
        .map((member) => member.groupId),
    );
    for (const [id, member] of this.members) {
      if (member.userId === userId) {
        this.members.delete(id);
      }
    }
    for (const groupId of ownedGroupIds) {
      if (!this.groups.has(groupId)) continue;
      const remaining = [...this.members.values()]
        .filter((member) => member.groupId === groupId)
        .sort(
          (left, right) =>
            left.joinedAt.getTime() - right.joinedAt.getTime() ||
            left.userId.localeCompare(right.userId),
        );
      if (remaining.some((member) => member.role === "owner")) continue;
      const successor = remaining[0];
      if (!successor) {
        this.deleteGroupTree(groupId);
        continue;
      }
      successor.role = "owner";
    }
  }

  private deleteGroupTree(groupId: string) {
    this.repository?.deleteCollaborationGroupMetadata?.(groupId);
    this.groups.delete(groupId);
    for (const [id, member] of this.members) {
      if (member.groupId === groupId) this.members.delete(id);
    }
    for (const [id, artifact] of this.artifacts) {
      if (artifact.groupId === groupId) this.artifacts.delete(id);
    }
    for (const [id, message] of this.messages) {
      if (message.groupId === groupId) this.messages.delete(id);
    }
    for (const [id, item] of this.schedule) {
      if (item.groupId === groupId) this.schedule.delete(id);
    }
  }

  async listGroups(workspaceId: string, userId: string) {
    const joined = new Set(
      [...this.members.values()]
        .filter((member) => member.workspaceId === workspaceId && member.userId === userId)
        .map((member) => member.groupId),
    );
    return [...this.groups.values()]
      .filter((group) => group.workspaceId === workspaceId && joined.has(group.id))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map(clone);
  }

  async createGroup(group: CollaborationGroupRecord, owner: CollaborationGroupMemberRecord) {
    this.groups.set(group.id, clone(group));
    this.members.set(`${owner.groupId}:${owner.userId}`, clone(owner));
    return clone(group);
  }

  async getGroup(workspaceId: string, groupId: string) {
    const group = this.groups.get(groupId);
    return group?.workspaceId === workspaceId ? clone(group) : null;
  }

  async listMembers(groupId: string) {
    return [...this.members.values()]
      .filter((member) => member.groupId === groupId)
      .sort((left, right) => left.joinedAt.getTime() - right.joinedAt.getTime())
      .map(clone);
  }

  async addMember(member: CollaborationGroupMemberRecord) {
    this.members.set(`${member.groupId}:${member.userId}`, clone(member));
    return clone(member);
  }

  async listArtifacts(groupId: string) {
    return [...this.artifacts.values()]
      .filter((artifact) => artifact.groupId === groupId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map(clone);
  }

  async addArtifact(artifact: CollaborationGroupArtifactRecord) {
    if (
      artifact.artifactType === "idea_board" &&
      this.repository?.isIdeaBoardDeleted?.(artifact.artifactId)
    )
      throw new Error("Workshop not found");
    const existing = [...this.artifacts.values()].find(
      (candidate) =>
        candidate.groupId === artifact.groupId &&
        candidate.artifactType === artifact.artifactType &&
        candidate.artifactId === artifact.artifactId,
    );
    if (existing) return clone(existing);
    if (
      artifact.artifactType !== "idea_board" &&
      this.repository?.isLibraryArtifactDeleted(
        artifact.workspaceId,
        artifact.artifactType,
        artifact.artifactId,
      )
    )
      throw new Error("Library item not found");
    this.artifacts.set(artifact.id, clone(artifact));
    return clone(artifact);
  }

  async removeArtifact(workspaceId: string, groupId: string, artifactId: string) {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact || artifact.workspaceId !== workspaceId || artifact.groupId !== groupId)
      return false;
    return this.artifacts.delete(artifactId);
  }

  async listMessages(groupId: string, limit = 100) {
    return [...this.messages.values()]
      .filter((message) => message.groupId === groupId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(-limit)
      .map(clone);
  }

  async addMessage(message: CollaborationGroupMessageRecord) {
    this.messages.set(message.id, clone(message));
    return clone(message);
  }

  async listSchedule(groupId: string) {
    return [...this.schedule.values()]
      .filter((item) => item.groupId === groupId)
      .sort((left, right) => left.scheduledFor.getTime() - right.scheduledFor.getTime())
      .map(clone);
  }

  async addSchedule(item: CollaborationGroupScheduleRecord) {
    if (
      this.repository?.isLibraryArtifactDeleted(
        item.workspaceId,
        item.artifactType,
        item.artifactId,
      )
    )
      throw new Error("Library item not found");
    this.schedule.set(item.id, clone(item));
    return clone(item);
  }
}

export class PostgresCollaborationGroupRepository implements CollaborationGroupRepository {
  constructor(private readonly repository: PostgresRepository) {}

  private async transaction<T>(
    workspaceId: string | null,
    work: (client: PoolClient) => Promise<T>,
  ) {
    const client = await this.repository.pool.connect();
    try {
      await client.query("BEGIN");
      if (workspaceId) {
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      } else {
        await client.query("SELECT set_config('app.system_access', 'on', true)");
      }
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listGroups(workspaceId: string, userId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `SELECT groups.* FROM collaboration_groups groups
         JOIN collaboration_group_members members ON members.group_id = groups.id
         WHERE groups.workspace_id = $1 AND members.user_id = $2
         ORDER BY groups.updated_at DESC`,
        [workspaceId, userId],
      );
      return result.rows.map(mapGroup);
    });
  }

  async createGroup(group: CollaborationGroupRecord, owner: CollaborationGroupMemberRecord) {
    return this.transaction(group.workspaceId, async (client) => {
      const created = await client.query(
        `INSERT INTO collaboration_groups
          (id, workspace_id, name, description, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          group.id,
          group.workspaceId,
          group.name,
          group.description,
          group.createdBy,
          group.createdAt,
          group.updatedAt,
        ],
      );
      await client.query(
        `INSERT INTO collaboration_group_members
          (workspace_id, group_id, user_id, role, joined_at) VALUES ($1,$2,$3,$4,$5)`,
        [owner.workspaceId, owner.groupId, owner.userId, owner.role, owner.joinedAt],
      );
      return mapGroup(created.rows[0]!);
    });
  }

  async getGroup(workspaceId: string, groupId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        "SELECT * FROM collaboration_groups WHERE workspace_id = $1 AND id = $2",
        [workspaceId, groupId],
      );
      return result.rows[0] ? mapGroup(result.rows[0]) : null;
    });
  }

  async listMembers(groupId: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        "SELECT * FROM collaboration_group_members WHERE group_id = $1 ORDER BY joined_at",
        [groupId],
      );
      return result.rows.map(mapMember);
    });
  }

  async addMember(member: CollaborationGroupMemberRecord) {
    return this.transaction(member.workspaceId, async (client) => {
      const result = await client.query(
        `INSERT INTO collaboration_group_members
          (workspace_id, group_id, user_id, role, joined_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role RETURNING *`,
        [member.workspaceId, member.groupId, member.userId, member.role, member.joinedAt],
      );
      return mapMember(result.rows[0]!);
    });
  }

  async listArtifacts(groupId: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        "SELECT * FROM collaboration_group_artifacts WHERE group_id = $1 ORDER BY created_at DESC",
        [groupId],
      );
      return result.rows.map(mapArtifact);
    });
  }

  async addArtifact(artifact: CollaborationGroupArtifactRecord) {
    return this.transaction(artifact.workspaceId, async (client) => {
      const result = await client.query(
        `INSERT INTO collaboration_group_artifacts
          (id, workspace_id, group_id, artifact_type, artifact_id, added_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (group_id, artifact_type, artifact_id)
         DO UPDATE SET added_by = EXCLUDED.added_by RETURNING *`,
        [
          artifact.id,
          artifact.workspaceId,
          artifact.groupId,
          artifact.artifactType,
          artifact.artifactId,
          artifact.addedBy,
          artifact.createdAt,
        ],
      );
      return mapArtifact(result.rows[0]!);
    });
  }

  async removeArtifact(workspaceId: string, groupId: string, artifactId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `DELETE FROM collaboration_group_artifacts
         WHERE workspace_id = $1 AND group_id = $2 AND id = $3`,
        [workspaceId, groupId, artifactId],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async listMessages(groupId: string, limit = 100) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `SELECT * FROM (
           SELECT * FROM collaboration_group_messages
           WHERE group_id = $1 ORDER BY created_at DESC LIMIT $2
         ) recent ORDER BY created_at`,
        [groupId, limit],
      );
      return result.rows.map(mapMessage);
    });
  }

  async addMessage(message: CollaborationGroupMessageRecord) {
    return this.transaction(message.workspaceId, async (client) => {
      const result = await client.query(
        `INSERT INTO collaboration_group_messages
          (id, workspace_id, group_id, author_id, body, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          message.id,
          message.workspaceId,
          message.groupId,
          message.authorId,
          message.body,
          message.createdAt,
        ],
      );
      return mapMessage(result.rows[0]!);
    });
  }

  async listSchedule(groupId: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        "SELECT * FROM collaboration_group_schedule WHERE group_id = $1 ORDER BY scheduled_for",
        [groupId],
      );
      return result.rows.map(mapSchedule);
    });
  }

  async addSchedule(item: CollaborationGroupScheduleRecord) {
    return this.transaction(item.workspaceId, async (client) => {
      const result = await client.query(
        `INSERT INTO collaboration_group_schedule
          (id, workspace_id, group_id, artifact_type, artifact_id, kind, scheduled_for,
           note, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          item.id,
          item.workspaceId,
          item.groupId,
          item.artifactType,
          item.artifactId,
          item.kind,
          item.scheduledFor,
          item.note,
          item.createdBy,
          item.createdAt,
        ],
      );
      return mapSchedule(result.rows[0]!);
    });
  }
}

export function createCollaborationGroupRepository(
  repository: Repository,
): CollaborationGroupRepository {
  if (repository instanceof PostgresRepository) {
    return new PostgresCollaborationGroupRepository(repository);
  }
  if (repository instanceof MemoryRepository) {
    return repository.getOrCreateLifecycleExtension(
      "collaboration-groups",
      () => new MemoryCollaborationGroupRepository(repository),
    );
  }
  return new MemoryCollaborationGroupRepository();
}
