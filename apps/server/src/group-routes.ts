import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type {
  CollaborationGroupMemberRecord,
  CollaborationGroupRepository,
  CreatorContext,
  PresentationRepository,
  Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import { professionalFeatureUnavailable } from "./workspace-rollout.js";

const GroupParamsSchema = z.object({ id: z.string().uuid() });
const GroupArtifactParamsSchema = z.object({
  id: z.string().uuid(),
  artifactRecordId: z.string().uuid(),
});
const CreateGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
});
const AddMemberSchema = z.object({ userId: z.string().uuid() });
const AddArtifactSchema = z.object({
  artifactType: z.enum(["round", "presentation"]),
  artifactId: z.string().uuid(),
});
const AddMessageSchema = z.object({ body: z.string().trim().min(1).max(2000) });
const AddScheduleSchema = z
  .object({
    artifactType: z.enum(["round", "presentation"]),
    artifactId: z.string().uuid(),
    kind: z.enum(["live_session", "round_assignment"]),
    scheduledFor: z.coerce.date(),
    note: z.string().trim().max(500).default(""),
  })
  .superRefine((input, context) => {
    if (input.kind === "round_assignment" && input.artifactType !== "round") {
      context.addIssue({
        code: "custom",
        path: ["artifactType"],
        message: "Assignments can only use Rounds in this release",
      });
    }
  });

function apiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return reply.code(status).send({ error: { code, message, requestId } });
}

function canEdit(creator: CreatorContext) {
  return creator.role === "owner" || creator.role === "editor";
}

async function artifactView(
  repository: Repository,
  presentations: PresentationRepository,
  workspaceId: string,
  artifact: Awaited<ReturnType<CollaborationGroupRepository["listArtifacts"]>>[number],
) {
  if (artifact.artifactType === "round") {
    const round = await repository.getQuiz(workspaceId, artifact.artifactId);
    return round
      ? {
          ...artifact,
          title: round.title,
          status: round.status,
          published: Boolean(round.currentVersionId),
          editHref: `/quiz/${round.id}`,
          hostHref: `/host/setup/${round.id}`,
          assignHref: `/quiz/${round.id}/assign`,
        }
      : null;
  }
  const presentation = await presentations.getPresentation(workspaceId, artifact.artifactId);
  return presentation
    ? {
        ...artifact,
        title: presentation.title,
        status: presentation.status,
        published: Boolean(presentation.currentVersionId),
        editHref: `/presentation/${presentation.id}`,
        hostHref: `/presentation/${presentation.id}/host`,
        assignHref: null,
      }
    : null;
}

export async function registerGroupRoutes(
  app: FastifyInstance,
  dependencies: {
    repository: Repository;
    presentations: PresentationRepository;
    groups: CollaborationGroupRepository;
    auth: AuthService;
    workspaceEnabled: (workspaceId: string) => boolean | Promise<boolean>;
    presentationsEnabled: (workspaceId: string) => boolean | Promise<boolean>;
  },
) {
  const { repository, presentations, groups, auth, workspaceEnabled, presentationsEnabled } =
    dependencies;

  async function requireGroupsWorkspace(
    creator: CreatorContext,
    reply: FastifyReply,
    requestId: string,
  ) {
    return (await workspaceEnabled(creator.workspaceId))
      ? true
      : professionalFeatureUnavailable(reply, requestId, "Group not found");
  }

  async function requireMembership(
    creator: CreatorContext,
    groupId: string,
    reply: FastifyReply,
    requestId: string,
  ) {
    const group = await groups.getGroup(creator.workspaceId, groupId);
    if (!group) {
      apiError(reply, 404, "NOT_FOUND", "Group not found", requestId);
      return null;
    }
    const members = await groups.listMembers(groupId);
    const membership = members.find((member) => member.userId === creator.userId);
    if (!membership) {
      apiError(reply, 404, "NOT_FOUND", "Group not found", requestId);
      return null;
    }
    return { group, members, membership };
  }

  async function requireArtifact(
    creator: CreatorContext,
    input: z.infer<typeof AddArtifactSchema>,
    reply: FastifyReply,
    requestId: string,
  ) {
    if (
      input.artifactType === "presentation" &&
      !(await presentationsEnabled(creator.workspaceId))
    ) {
      apiError(reply, 404, "NOT_FOUND", "Artifact not found", requestId);
      return null;
    }
    const artifact =
      input.artifactType === "round"
        ? await repository.getQuiz(creator.workspaceId, input.artifactId)
        : await presentations.getPresentation(creator.workspaceId, input.artifactId);
    if (!artifact || artifact.status === "archived") {
      apiError(reply, 404, "NOT_FOUND", "Artifact not found", requestId);
      return null;
    }
    return artifact;
  }

  app.get("/v1/groups", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if ((await requireGroupsWorkspace(creator, reply, request.id)) !== true) return;
    const workspacePresentationsEnabled = await presentationsEnabled(creator.workspaceId);
    const records = await groups.listGroups(creator.workspaceId, creator.userId);
    const groupViews = await Promise.all(
      records.map(async (group) => {
        const [members, artifactRecords, scheduleRecords] = await Promise.all([
          groups.listMembers(group.id),
          groups.listArtifacts(group.id),
          groups.listSchedule(group.id),
        ]);
        const artifacts = artifactRecords.filter(
          (artifact) => artifact.artifactType === "round" || workspacePresentationsEnabled,
        );
        const schedule = scheduleRecords.filter(
          (item) => item.artifactType === "round" || workspacePresentationsEnabled,
        );
        return {
          ...group,
          role: members.find((member) => member.userId === creator.userId)?.role ?? "member",
          memberCount: members.length,
          artifactCount: artifacts.length,
          upcomingCount: schedule.filter((item) => item.scheduledFor.getTime() >= Date.now())
            .length,
        };
      }),
    );
    return { groups: groupViews };
  });

  app.post("/v1/groups", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if ((await requireGroupsWorkspace(creator, reply, request.id)) !== true) return;
    if (!canEdit(creator)) {
      return apiError(
        reply,
        403,
        "UNAUTHORIZED",
        "Your workspace role does not allow group creation",
        request.id,
      );
    }
    const input = CreateGroupSchema.parse(request.body);
    const now = new Date();
    const id = randomUUID();
    const group = await groups.createGroup(
      {
        id,
        workspaceId: creator.workspaceId,
        name: input.name,
        description: input.description,
        createdBy: creator.userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        workspaceId: creator.workspaceId,
        groupId: id,
        userId: creator.userId,
        role: "owner",
        joinedAt: now,
      },
    );
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "group.create",
      targetType: "collaboration_group",
      targetId: group.id,
      requestId: request.id,
      metadata: { name: group.name },
    });
    return reply.code(201).send({ group: { ...group, role: "owner" } });
  });

  app.get("/v1/groups/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if ((await requireGroupsWorkspace(creator, reply, request.id)) !== true) return;
    const workspacePresentationsEnabled = await presentationsEnabled(creator.workspaceId);
    const { id } = GroupParamsSchema.parse(request.params);
    const access = await requireMembership(creator, id, reply, request.id);
    if (!access) return;
    const [workspaceMembers, artifactRecords, messages, schedule] = await Promise.all([
      repository.listWorkspaceMembers(creator.workspaceId),
      groups.listArtifacts(id),
      groups.listMessages(id),
      groups.listSchedule(id),
    ]);
    const byUserId = new Map(workspaceMembers.map((member) => [member.userId, member]));
    const visibleArtifactRecords = artifactRecords.filter(
      (artifact) => artifact.artifactType === "round" || workspacePresentationsEnabled,
    );
    const visibleSchedule = schedule.filter(
      (item) => item.artifactType === "round" || workspacePresentationsEnabled,
    );
    const artifactViews = (
      await Promise.all(
        visibleArtifactRecords.map((artifact) =>
          artifactView(repository, presentations, creator.workspaceId, artifact),
        ),
      )
    ).filter((artifact) => artifact !== null);
    const artifactsByKey = new Map(
      artifactViews.map((artifact) => [
        `${artifact.artifactType}:${artifact.artifactId}`,
        artifact,
      ]),
    );
    return {
      group: {
        ...access.group,
        role: access.membership.role,
        members: access.members.map((member) => ({
          ...member,
          email: byUserId.get(member.userId)?.email ?? "Former workspace member",
          workspaceRole: byUserId.get(member.userId)?.role ?? null,
        })),
        availableMembers:
          access.membership.role === "owner" || creator.role === "owner"
            ? workspaceMembers.filter(
                (member) => !access.members.some((joined) => joined.userId === member.userId),
              )
            : [],
        artifacts: artifactViews,
        messages: messages.map((message) => ({
          ...message,
          authorEmail: byUserId.get(message.authorId)?.email ?? "Former workspace member",
        })),
        schedule: visibleSchedule.map((item) => ({
          ...item,
          artifactTitle:
            artifactsByKey.get(`${item.artifactType}:${item.artifactId}`)?.title ??
            "Unavailable artifact",
        })),
      },
    };
  });

  app.post("/v1/groups/:id/members", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if ((await requireGroupsWorkspace(creator, reply, request.id)) !== true) return;
    const { id } = GroupParamsSchema.parse(request.params);
    const access = await requireMembership(creator, id, reply, request.id);
    if (!access) return;
    if (access.membership.role !== "owner" && creator.role !== "owner") {
      return apiError(reply, 403, "UNAUTHORIZED", "Only group owners can add members", request.id);
    }
    const input = AddMemberSchema.parse(request.body);
    const workspaceMembers = await repository.listWorkspaceMembers(creator.workspaceId);
    if (!workspaceMembers.some((member) => member.userId === input.userId)) {
      return apiError(reply, 404, "NOT_FOUND", "Workspace member not found", request.id);
    }
    const member: CollaborationGroupMemberRecord = await groups.addMember({
      workspaceId: creator.workspaceId,
      groupId: id,
      userId: input.userId,
      role: "member",
      joinedAt: new Date(),
    });
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "group.member.add",
      targetType: "collaboration_group",
      targetId: id,
      requestId: request.id,
      metadata: { userId: member.userId },
    });
    return reply.code(201).send({ member });
  });

  app.post("/v1/groups/:id/artifacts", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if ((await requireGroupsWorkspace(creator, reply, request.id)) !== true) return;
    const { id } = GroupParamsSchema.parse(request.params);
    const access = await requireMembership(creator, id, reply, request.id);
    if (!access) return;
    if (!canEdit(creator)) {
      return apiError(reply, 403, "UNAUTHORIZED", "Editing access is required", request.id);
    }
    const input = AddArtifactSchema.parse(request.body);
    if (!(await requireArtifact(creator, input, reply, request.id))) return;
    const artifact = await groups.addArtifact({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      groupId: id,
      artifactType: input.artifactType,
      artifactId: input.artifactId,
      addedBy: creator.userId,
      createdAt: new Date(),
    });
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "group.artifact.share",
      targetType: "collaboration_group",
      targetId: id,
      requestId: request.id,
      metadata: { artifactType: input.artifactType, artifactId: input.artifactId },
    });
    return reply.code(201).send({ artifact });
  });

  app.delete("/v1/groups/:id/artifacts/:artifactRecordId", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if ((await requireGroupsWorkspace(creator, reply, request.id)) !== true) return;
    const { id, artifactRecordId } = GroupArtifactParamsSchema.parse(request.params);
    const access = await requireMembership(creator, id, reply, request.id);
    if (!access) return;
    if (!canEdit(creator)) {
      return apiError(reply, 403, "UNAUTHORIZED", "Editing access is required", request.id);
    }
    const removed = await groups.removeArtifact(creator.workspaceId, id, artifactRecordId);
    if (!removed) {
      return apiError(reply, 404, "NOT_FOUND", "Shared artifact not found", request.id);
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "group.artifact.remove",
      targetType: "collaboration_group",
      targetId: id,
      requestId: request.id,
      metadata: { artifactRecordId },
    });
    return reply.code(204).send();
  });

  app.post("/v1/groups/:id/messages", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if ((await requireGroupsWorkspace(creator, reply, request.id)) !== true) return;
    const { id } = GroupParamsSchema.parse(request.params);
    const access = await requireMembership(creator, id, reply, request.id);
    if (!access) return;
    const input = AddMessageSchema.parse(request.body);
    const message = await groups.addMessage({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      groupId: id,
      authorId: creator.userId,
      body: input.body,
      createdAt: new Date(),
    });
    return reply.code(201).send({ message: { ...message, authorEmail: creator.email } });
  });

  app.post("/v1/groups/:id/schedule", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if ((await requireGroupsWorkspace(creator, reply, request.id)) !== true) return;
    const { id } = GroupParamsSchema.parse(request.params);
    const access = await requireMembership(creator, id, reply, request.id);
    if (!access) return;
    if (!canEdit(creator)) {
      return apiError(reply, 403, "UNAUTHORIZED", "Editing access is required", request.id);
    }
    const input = AddScheduleSchema.parse(request.body);
    const artifact = await requireArtifact(creator, input, reply, request.id);
    if (!artifact) return;
    if (!artifact.currentVersionId) {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "Publish the artifact before scheduling it",
        request.id,
      );
    }
    const shared = await groups.listArtifacts(id);
    if (
      !shared.some(
        (artifact) =>
          artifact.artifactType === input.artifactType && artifact.artifactId === input.artifactId,
      )
    ) {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "Share the artifact with this group before scheduling it",
        request.id,
      );
    }
    const item = await groups.addSchedule({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      groupId: id,
      artifactType: input.artifactType,
      artifactId: input.artifactId,
      kind: input.kind,
      scheduledFor: input.scheduledFor,
      note: input.note,
      createdBy: creator.userId,
      createdAt: new Date(),
    });
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "group.schedule.create",
      targetType: "collaboration_group",
      targetId: id,
      requestId: request.id,
      metadata: {
        artifactType: input.artifactType,
        artifactId: input.artifactId,
        kind: input.kind,
        scheduledFor: input.scheduledFor.toISOString(),
      },
    });
    return reply.code(201).send({ item });
  });
}
