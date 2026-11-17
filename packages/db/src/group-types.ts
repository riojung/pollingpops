import type {
  ArtifactType,
  CollaborationGroupPurpose,
  CollaborationGroupStatus,
} from "@openround/contracts";

export interface CollaborationGroupRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  purpose?: CollaborationGroupPurpose;
  status?: CollaborationGroupStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollaborationGroupMemberRecord {
  workspaceId: string;
  groupId: string;
  userId: string;
  role: "owner" | "member";
  joinedAt: Date;
}

export interface CollaborationGroupArtifactRecord {
  id: string;
  workspaceId: string;
  groupId: string;
  artifactType: ArtifactType | "idea_board";
  artifactId: string;
  addedBy: string;
  createdAt: Date;
}

export interface CollaborationGroupMessageRecord {
  id: string;
  workspaceId: string;
  groupId: string;
  authorId: string;
  body: string;
  createdAt: Date;
}

export interface CollaborationGroupScheduleRecord {
  id: string;
  workspaceId: string;
  groupId: string;
  artifactType: ArtifactType;
  artifactId: string;
  kind: "live_session" | "round_assignment";
  scheduledFor: Date;
  note: string;
  createdBy: string;
  createdAt: Date;
}

export interface CollaborationGroupRepository {
  listGroups(workspaceId: string, userId: string): Promise<CollaborationGroupRecord[]>;
  createGroup(
    group: CollaborationGroupRecord,
    owner: CollaborationGroupMemberRecord,
  ): Promise<CollaborationGroupRecord>;
  getGroup(workspaceId: string, groupId: string): Promise<CollaborationGroupRecord | null>;
  updateGroup(
    workspaceId: string,
    groupId: string,
    update: Partial<Pick<CollaborationGroupRecord, "name" | "description" | "purpose" | "status">>,
  ): Promise<CollaborationGroupRecord | null>;
  changeMember(
    workspaceId: string,
    groupId: string,
    userId: string,
    role: "owner" | "member" | null,
  ): Promise<boolean>;
  listMembers(groupId: string): Promise<CollaborationGroupMemberRecord[]>;
  addMember(member: CollaborationGroupMemberRecord): Promise<CollaborationGroupMemberRecord>;
  listArtifacts(groupId: string): Promise<CollaborationGroupArtifactRecord[]>;
  addArtifact(
    artifact: CollaborationGroupArtifactRecord,
  ): Promise<CollaborationGroupArtifactRecord>;
  removeArtifact(workspaceId: string, groupId: string, artifactId: string): Promise<boolean>;
  listMessages(groupId: string, limit?: number): Promise<CollaborationGroupMessageRecord[]>;
  addMessage(message: CollaborationGroupMessageRecord): Promise<CollaborationGroupMessageRecord>;
  listSchedule(groupId: string): Promise<CollaborationGroupScheduleRecord[]>;
  addSchedule(item: CollaborationGroupScheduleRecord): Promise<CollaborationGroupScheduleRecord>;
}
