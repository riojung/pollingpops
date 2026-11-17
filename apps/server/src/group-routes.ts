import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  CollaborationGroupCreateSchema,
  CollaborationGroupUpdateSchema,
  type LibraryShareSummary,
} from "@openround/contracts";
import type {
  CanvasBoardRepository,
  IdeaBoardRepository,
  CollaborationGroupMemberRecord,
  CollaborationGroupRepository,
  CreatorContext,
  OrganizationGroupRepository,
  OrganizationGroupState,
  LibrarySharingRepository,
  PresentationRepository,
  Repository,
} from "@openround/db";
import { IdeaBoardError, OrganizationGroupError, createPlatformRepository } from "@openround/db";
import type { AuthService } from "./auth.js";
import { professionalFeatureUnavailable } from "./workspace-rollout.js";

const GroupParamsSchema = z.object({ id: z.string().uuid() });
const GroupArtifactParamsSchema = z.object({
  id: z.string().uuid(),
  artifactRecordId: z.string().uuid(),
});
const CreateGroupSchema = CollaborationGroupCreateSchema;
const GroupMemberParamsSchema = GroupParamsSchema.extend({ userId: z.string().uuid() });
const GroupShareParamsSchema = GroupParamsSchema.extend({ shareId: z.string().uuid() });
const AddMemberSchema = z.object({ userId: z.string().uuid() });
const AddArtifactSchema = z.object({
  artifactType: z.enum(["round", "presentation", "idea_board"]),
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
  boards: IdeaBoardRepository,
  workspaceId: string,
  artifact: Awaited<ReturnType<CollaborationGroupRepository["listArtifacts"]>>[number],
) {
  if (artifact.artifactType === "idea_board") {
    try {
      const board = await boards.getModerator(workspaceId, artifact.artifactId);
      return {
        ...artifact,
        title: board.title,
        status: board.status,
        published: false,
        editHref: `/boards/${board.id}`,
        hostHref: `/boards/${board.id}`,
        assignHref: null,
      };
    } catch (error) {
      if (error instanceof IdeaBoardError && error.code === "NOT_FOUND") return null;
      throw error;
    }
  }
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
  server: FastifyInstance,
  dependencies: {
    repository: Repository;
    presentations: PresentationRepository;
    groups: CollaborationGroupRepository;
    organizationGroups: OrganizationGroupRepository;
    libraryShares: LibrarySharingRepository;
    summarizeLibraryShare: (
      share: LibraryShareSummary,
      creator: CreatorContext,
    ) => Promise<LibraryShareSummary>;
    boards: IdeaBoardRepository;
    canvases: CanvasBoardRepository;
    auth: AuthService;
    workspaceEnabled: (workspaceId: string) => boolean | Promise<boolean>;
    presentationsEnabled: (workspaceId: string) => boolean | Promise<boolean>;
    ideaBoardsEnabled: (workspaceId: string) => boolean | Promise<boolean>;
    canvasEnabled: (workspaceId: string) => boolean | Promise<boolean>;
  },
) {
  await server.register(async (app) => {
    app.addHook("onRequest", async (_request, reply) => {
      reply
        .header("cache-control", "private, no-store")
        .header("vary", "Cookie, Origin")
        .header("x-robots-tag", "noindex, nofollow, noarchive")
        .header("referrer-policy", "no-referrer")
        .header("x-content-type-options", "nosniff");
    });
    app.setErrorHandler((error, request, reply) => {
      if (error instanceof OrganizationGroupError)
        return apiError(
          reply,
          error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 409,
          error.code,
          error.message,
          request.id,
        );
      if (
        error instanceof Error &&
        /Archived groups are read-only|A group must keep at least one owner|Restore this group before making changes/.test(
          error.message,
        )
      )
        return apiError(reply, 409, "CONFLICT", error.message, request.id);
      throw error;
    });
    const {
      repository,
      presentations,
      groups,
      organizationGroups,
      libraryShares,
      summarizeLibraryShare,
      boards,
      canvases,
      auth,
      workspaceEnabled,
      presentationsEnabled,
      ideaBoardsEnabled,
      canvasEnabled,
    } = dependencies;

    // Group collections never create a Library grant. Resolve every publication using the
    // existing current-principal reader and destination-copy capability checks.
    async function sharedLibrary(creator: CreatorContext, group: OrganizationGroupState) {
      const shares = await Promise.all(
        group.shareIds.map((id) => libraryShares.read({ actorId: creator.userId, id })),
      );
      return Promise.all(
        shares
          .filter(
            (share) =>
              share !== null &&
              share.organizationId === group.organizationId &&
              share.audience === "organization",
          )
          .map((share) => summarizeLibraryShare(share!, creator)),
      );
    }
    function organizationCapabilities(group: OrganizationGroupState, creator: CreatorContext) {
      const manage = group.members.some(
        (member) => member.userId === creator.userId && member.role === "owner",
      );
      const active = group.status === "active";
      return {
        manageMembers: manage && active,
        shareContent: manage && active,
        postMessage: active,
        schedule: false,
        manageGroup: manage,
      };
    }
    function workspaceCapabilities(
      group: { status?: string },
      creator: CreatorContext,
      role: string,
    ) {
      const active = group.status !== "archived";
      const manage = canEdit(creator) && (role === "owner" || creator.role === "owner");
      return {
        manageMembers: manage && active,
        shareContent: canEdit(creator) && active,
        postMessage: active,
        schedule: canEdit(creator) && active,
        manageGroup: manage,
      };
    }
    async function organizationView(
      creator: CreatorContext,
      access: Awaited<ReturnType<OrganizationGroupRepository["detail"]>>,
      detail = false,
    ) {
      const { group, context } = access;
      const publications = await sharedLibrary(creator, group);
      const capabilities = organizationCapabilities(group, creator);
      const metadata = {
        id: group.id,
        organizationId: group.organizationId,
        name: group.name,
        description: group.description,
        purpose: group.purpose,
        status: group.status,
        createdBy: group.createdBy,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      };
      const view = {
        ...metadata,
        scope: "organization",
        scopeName: context.organizationName,
        workspaceId: null,
        organizationName: context.organizationName,
        role: group.members.find((member) => member.userId === creator.userId)!.role,
        memberCount: group.members.length,
        artifactCount: publications.length,
        upcomingCount: publications.filter(
          (share) =>
            share.dueAt &&
            new Date(share.dueAt).getTime() >= Date.now() &&
            share.progress !== "done",
        ).length,
        capabilities,
      };
      if (!detail) return view;
      const byUserId = new Map(context.directory.map((member) => [member.userId, member.email]));
      return {
        ...view,
        members: group.members.map((member) => ({
          ...member,
          email: byUserId.get(member.userId) ?? "Former organization member",
          workspaceRole: null,
        })),
        availableMembers: capabilities.manageMembers
          ? context.directory
              .filter((member) => !group.members.some((joined) => joined.userId === member.userId))
              .slice(0, 100)
          : [],
        sharedLibrary: publications,
        artifacts: [],
        canvasBoards: [],
        schedule: [],
        messages: group.messages.map((message) => ({
          ...message,
          authorEmail: message.authorId
            ? (byUserId.get(message.authorId) ?? "Former organization member")
            : "Former organization member",
        })),
      };
    }
    async function organizationAccess(creator: CreatorContext, id: string) {
      try {
        return await organizationGroups.detail(creator.userId, id);
      } catch (error) {
        if (error instanceof OrganizationGroupError && error.code === "NOT_FOUND") return null;
        throw error;
      }
    }
    function archived(reply: FastifyReply, requestId: string) {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "Restore this group before making changes",
        requestId,
      );
    }

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
      if (input.artifactType === "idea_board") {
        if (!(await ideaBoardsEnabled(creator.workspaceId))) {
          apiError(reply, 404, "NOT_FOUND", "Artifact not found", requestId);
          return null;
        }
        try {
          return await boards.getModerator(creator.workspaceId, input.artifactId);
        } catch (error) {
          if (!(error instanceof IdeaBoardError) || error.code !== "NOT_FOUND") throw error;
          apiError(reply, 404, "NOT_FOUND", "Artifact not found", requestId);
          return null;
        }
      }
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
      const workspaceIdeasEnabled = await ideaBoardsEnabled(creator.workspaceId);
      const workspaceCanvasEnabled = await canvasEnabled(creator.workspaceId);
      const records = await groups.listGroups(creator.workspaceId, creator.userId);
      const workspaceName =
        (await repository.listWorkspaces(creator.userId)).find(
          (workspace) => workspace.id === creator.workspaceId,
        )?.name ?? "Workspace";
      const groupViews = await Promise.all(
        records.map(async (group) => {
          const [members, artifactRecords, scheduleRecords] = await Promise.all([
            groups.listMembers(group.id),
            groups.listArtifacts(group.id),
            groups.listSchedule(group.id),
          ]);
          const artifacts = artifactRecords.filter(
            (artifact) =>
              artifact.artifactType === "round" ||
              (artifact.artifactType === "presentation" && workspacePresentationsEnabled) ||
              (artifact.artifactType === "idea_board" && workspaceIdeasEnabled),
          );
          const schedule = scheduleRecords.filter(
            (item) => item.artifactType === "round" || workspacePresentationsEnabled,
          );
          return {
            ...group,
            scope: "workspace",
            organizationId: null,
            scopeName: workspaceName,
            purpose: group.purpose ?? "team",
            status: group.status ?? "active",
            capabilities: workspaceCapabilities(
              group,
              creator,
              members.find((member) => member.userId === creator.userId)?.role ?? "member",
            ),
            role: members.find((member) => member.userId === creator.userId)?.role ?? "member",
            memberCount: members.length,
            artifactCount:
              artifacts.length +
              (workspaceCanvasEnabled
                ? (await canvases.groupBoards(creator, creator.workspaceId, group.id)).length
                : 0),
            upcomingCount: schedule.filter((item) => item.scheduledFor.getTime() >= Date.now())
              .length,
          };
        }),
      );
      const organizationViews = await Promise.all(
        (await organizationGroups.list(creator.userId)).map((access) =>
          organizationView(creator, access),
        ),
      );
      return {
        groups: [...groupViews, ...organizationViews].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
        context: {
          ...(await organizationGroups.context(creator.userId, creator.workspaceId)),
          canCreateWorkspaceGroup: canEdit(creator),
        },
      };
    });

    app.post("/v1/groups", async (request, reply) => {
      const creator = await auth.requireCreator(request, reply);
      if (!creator) return;
      if ((await requireGroupsWorkspace(creator, reply, request.id)) !== true) return;
      const input = CreateGroupSchema.parse(request.body);
      if (input.scope === "organization") {
        const context = await organizationGroups.context(creator.userId, creator.workspaceId);
        const organizationId = input.organizationId ?? context.organizationId;
        if (!organizationId)
          return apiError(
            reply,
            403,
            "FORBIDDEN",
            "Choose an active organization workspace",
            request.id,
          );
        const access = await organizationGroups.create(creator.userId, organizationId, input);
        await createPlatformRepository(repository).appendAuditEvent({
          organizationId,
          actorId: creator.userId,
          action: "group.create",
          targetId: access.group.id,
          requestId: request.id,
          reason: "Created organization group",
          before: null,
          after: { scope: "organization" },
        });
        return reply.code(201).send({ group: await organizationView(creator, access) });
      }
      if (input.organizationId)
        return apiError(
          reply,
          422,
          "VALIDATION_ERROR",
          "Choose an organization only for an organization group",
          request.id,
        );
      if (!canEdit(creator)) {
        return apiError(
          reply,
          403,
          "UNAUTHORIZED",
          "Your workspace role does not allow group creation",
          request.id,
        );
      }
      const now = new Date();
      const id = randomUUID();
      const group = await groups.createGroup(
        {
          id,
          workspaceId: creator.workspaceId,
          name: input.name,
          description: input.description,
          purpose: input.purpose,
          status: "active",
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
      return reply.code(201).send({
        group: {
          ...group,
          scope: "workspace",
          organizationId: null,
          scopeName:
            (await repository.listWorkspaces(creator.userId)).find(
              (workspace) => workspace.id === creator.workspaceId,
            )?.name ?? "Workspace",
          role: "owner",
          capabilities: workspaceCapabilities(group, creator, "owner"),
        },
      });
    });

    app.get("/v1/groups/:id", async (request, reply) => {
      const creator = await auth.requireCreator(request, reply);
      if (!creator) return;
      if ((await requireGroupsWorkspace(creator, reply, request.id)) !== true) return;
      const workspacePresentationsEnabled = await presentationsEnabled(creator.workspaceId);
      const workspaceIdeasEnabled = await ideaBoardsEnabled(creator.workspaceId);
      const workspaceCanvasEnabled = await canvasEnabled(creator.workspaceId);
      const { id } = GroupParamsSchema.parse(request.params);
      const organization = await organizationAccess(creator, id);
      if (organization) return { group: await organizationView(creator, organization, true) };
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
        (artifact) =>
          artifact.artifactType === "round" ||
          (artifact.artifactType === "presentation" && workspacePresentationsEnabled) ||
          (artifact.artifactType === "idea_board" && workspaceIdeasEnabled),
      );
      const visibleSchedule = schedule.filter(
        (item) => item.artifactType === "round" || workspacePresentationsEnabled,
      );
      const artifactViews = (
        await Promise.all(
          visibleArtifactRecords.map((artifact) =>
            artifactView(repository, presentations, boards, creator.workspaceId, artifact),
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
          scope: "workspace",
          organizationId: null,
          scopeName:
            (await repository.listWorkspaces(creator.userId)).find(
              (workspace) => workspace.id === creator.workspaceId,
            )?.name ?? "Workspace",
          purpose: access.group.purpose ?? "team",
          status: access.group.status ?? "active",
          capabilities: workspaceCapabilities(access.group, creator, access.membership.role),
          sharedLibrary: [],
          role: access.membership.role,
          members: access.members.map((member) => ({
            ...member,
            email: byUserId.get(member.userId)?.email ?? "Former workspace member",
            workspaceRole: byUserId.get(member.userId)?.role ?? null,
          })),
          availableMembers: workspaceCapabilities(access.group, creator, access.membership.role)
            .manageMembers
            ? workspaceMembers.filter(
                (member) => !access.members.some((joined) => joined.userId === member.userId),
              )
            : [],
          artifacts: artifactViews,
          canvasBoards: workspaceCanvasEnabled
            ? await canvases.groupBoards(creator, creator.workspaceId, id)
            : [],
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
      const input = AddMemberSchema.parse(request.body);
      if (await organizationAccess(creator, id))
        return reply
          .code(201)
          .send({ member: await organizationGroups.addMember(creator.userId, id, input.userId) });
      const access = await requireMembership(creator, id, reply, request.id);
      if (!access) return;
      if (access.group.status === "archived") return archived(reply, request.id);
      if (!workspaceCapabilities(access.group, creator, access.membership.role).manageMembers) {
        return apiError(
          reply,
          403,
          "UNAUTHORIZED",
          "Only group owners can add members",
          request.id,
        );
      }
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
      if (access.group.status === "archived") return archived(reply, request.id);
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
      if (access.group.status === "archived") return archived(reply, request.id);
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
      const input = AddMessageSchema.parse(request.body);
      if (await organizationAccess(creator, id))
        return reply.code(201).send({
          message: {
            ...(await organizationGroups.message(creator.userId, id, input.body)),
            authorEmail: creator.email,
          },
        });
      const access = await requireMembership(creator, id, reply, request.id);
      if (!access) return;
      if (access.group.status === "archived") return archived(reply, request.id);
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
      if (access.group.status === "archived") return archived(reply, request.id);
      if (!canEdit(creator)) {
        return apiError(reply, 403, "UNAUTHORIZED", "Editing access is required", request.id);
      }
      const input = AddScheduleSchema.parse(request.body);
      const artifact = await requireArtifact(creator, input, reply, request.id);
      if (!artifact) return;
      if (!("currentVersionId" in artifact) || !artifact.currentVersionId) {
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
            artifact.artifactType === input.artifactType &&
            artifact.artifactId === input.artifactId,
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

    app.patch("/v1/groups/:id", async (request, reply) => {
      const creator = await auth.requireCreator(request, reply);
      if (!creator || (await requireGroupsWorkspace(creator, reply, request.id)) !== true) return;
      const { id } = GroupParamsSchema.parse(request.params);
      const input = CollaborationGroupUpdateSchema.parse(request.body);
      if (await organizationAccess(creator, id)) {
        await organizationGroups.update(creator.userId, id, input);
        return {
          group: await organizationView(
            creator,
            await organizationGroups.detail(creator.userId, id),
            true,
          ),
        };
      }
      const access = await requireMembership(creator, id, reply, request.id);
      if (!access) return;
      if (!workspaceCapabilities(access.group, creator, access.membership.role).manageGroup)
        return apiError(
          reply,
          403,
          "FORBIDDEN",
          "Only group owners with workspace editing access can manage this group",
          request.id,
        );
      if (
        access.group.status === "archived" &&
        !(input.status === "active" && Object.keys(input).length === 1)
      )
        return archived(reply, request.id);
      const group = await groups.updateGroup(creator.workspaceId, id, input);
      return {
        group: {
          ...group,
          scope: "workspace",
          organizationId: null,
          role: access.membership.role,
          capabilities: workspaceCapabilities(group!, creator, access.membership.role),
        },
      };
    });

    for (const method of ["PATCH", "DELETE"] as const)
      app.route({
        method,
        url: "/v1/groups/:id/members/:userId",
        handler: async (request, reply) => {
          const creator = await auth.requireCreator(request, reply);
          if (!creator || (await requireGroupsWorkspace(creator, reply, request.id)) !== true)
            return;
          const { id, userId } = GroupMemberParamsSchema.parse(request.params);
          const role =
            method === "DELETE"
              ? null
              : z
                  .object({ role: z.enum(["owner", "member"]) })
                  .strict()
                  .parse(request.body).role;
          if (await organizationAccess(creator, id)) {
            const member = await organizationGroups.changeMember(creator.userId, id, userId, role);
            return method === "DELETE" ? reply.code(204).send() : { member };
          }
          const access = await requireMembership(creator, id, reply, request.id);
          if (!access) return;
          if (access.group.status === "archived") return archived(reply, request.id);
          if (!workspaceCapabilities(access.group, creator, access.membership.role).manageMembers)
            return apiError(
              reply,
              403,
              "FORBIDDEN",
              "Only group owners with workspace editing access can manage members",
              request.id,
            );
          if (!(await groups.changeMember(creator.workspaceId, id, userId, role)))
            return apiError(reply, 404, "NOT_FOUND", "Group member not found", request.id);
          return method === "DELETE"
            ? reply.code(204).send()
            : { member: (await groups.listMembers(id)).find((member) => member.userId === userId) };
        },
      });

    app.post("/v1/groups/:id/library-shares", async (request, reply) => {
      const creator = await auth.requireCreator(request, reply);
      if (!creator || (await requireGroupsWorkspace(creator, reply, request.id)) !== true) return;
      const { id } = GroupParamsSchema.parse(request.params);
      const { shareId } = z.object({ shareId: z.string().uuid() }).strict().parse(request.body);
      const access = await organizationGroups.detail(creator.userId, id);
      const share = await libraryShares.read({ actorId: creator.userId, id: shareId });
      if (
        !share ||
        share.audience !== "organization" ||
        share.organizationId !== access.group.organizationId
      )
        return apiError(reply, 404, "NOT_FOUND", "Organization publication not found", request.id);
      await organizationGroups.link(creator.userId, id, shareId, true);
      return reply.code(201).send({ share: await summarizeLibraryShare(share, creator) });
    });
    app.delete("/v1/groups/:id/library-shares/:shareId", async (request, reply) => {
      const creator = await auth.requireCreator(request, reply);
      if (!creator || (await requireGroupsWorkspace(creator, reply, request.id)) !== true) return;
      const { id, shareId } = GroupShareParamsSchema.parse(request.params);
      await organizationGroups.link(creator.userId, id, shareId, false);
      return reply.code(204).send();
    });
    app.get("/v1/groups/:id/available-members", async (request, reply) => {
      const creator = await auth.requireCreator(request, reply);
      if (!creator || (await requireGroupsWorkspace(creator, reply, request.id)) !== true) return;
      const { id } = GroupParamsSchema.parse(request.params);
      const { search } = z
        .object({ search: z.string().trim().max(200).default("") })
        .strict()
        .parse(request.query);
      const organization = await organizationAccess(creator, id);
      let candidates: Array<{ userId: string; email: string }>;
      if (organization) {
        if (!organizationCapabilities(organization.group, creator).manageMembers)
          return apiError(
            reply,
            403,
            "FORBIDDEN",
            "Only active group owners can choose members",
            request.id,
          );
        candidates = organization.context.directory.filter(
          (member) => !organization.group.members.some((joined) => joined.userId === member.userId),
        );
      } else {
        const access = await requireMembership(creator, id, reply, request.id);
        if (!access) return;
        if (!workspaceCapabilities(access.group, creator, access.membership.role).manageMembers)
          return apiError(
            reply,
            403,
            "FORBIDDEN",
            "Only active group owners can choose members",
            request.id,
          );
        candidates = (await repository.listWorkspaceMembers(creator.workspaceId)).filter(
          (member) => !access.members.some((joined) => joined.userId === member.userId),
        );
      }
      const matches = candidates.filter((member) =>
        member.email.toLowerCase().includes(search.toLowerCase()),
      );
      return {
        members: matches.slice(0, 100).map(({ userId, email }) => ({ userId, email })),
        hasMore: matches.length > 100,
      };
    });
  });
}
