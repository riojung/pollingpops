import type { FastifyInstance } from "fastify";
import type {
  CollaborationGroupRepository,
  PresentationRepository,
  PresentationSessionRepository,
  Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import { professionalFeatureUnavailable } from "./workspace-rollout.js";

const RECENT_ARTIFACT_LIMIT = 6;
const SESSION_LIMIT = 6;
const ASSIGNMENT_LIMIT = 5;
const RESULT_LIMIT = 5;
const SCHEDULE_LIMIT = 5;

function newestFirst(left: { occurredAt: Date }, right: { occurredAt: Date }) {
  return right.occurredAt.getTime() - left.occurredAt.getTime();
}

function activeFirst(
  left: { status: string; occurredAt: Date },
  right: { status: string; occurredAt: Date },
) {
  const leftActive = left.status === "active" ? 1 : 0;
  const rightActive = right.status === "active" ? 1 : 0;
  return rightActive - leftActive || newestFirst(left, right);
}

/**
 * A compact, workspace-scoped read model for the post-login Home page. The endpoint intentionally
 * composes existing repositories so the canonical authoring, delivery, assignment, and reporting
 * boundaries remain unchanged.
 */
export async function registerHomeRoutes(
  app: FastifyInstance,
  dependencies: {
    repository: Repository;
    presentations: PresentationRepository;
    presentationSessions: PresentationSessionRepository;
    groups: CollaborationGroupRepository;
    auth: AuthService;
    workspaceEnabled: (workspaceId: string) => boolean | Promise<boolean>;
    presentationsEnabled: (workspaceId: string) => boolean | Promise<boolean>;
    groupsEnabled: (workspaceId: string) => boolean | Promise<boolean>;
  },
) {
  const {
    repository,
    presentations,
    presentationSessions,
    groups,
    auth,
    workspaceEnabled,
    presentationsEnabled,
    groupsEnabled,
  } = dependencies;

  app.get("/v1/home/summary", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (!(await workspaceEnabled(creator.workspaceId))) {
      return professionalFeatureUnavailable(reply, request.id, "Workspace summary not found");
    }
    const workspacePresentationsEnabled = await presentationsEnabled(creator.workspaceId);
    const workspaceGroupsEnabled = await groupsEnabled(creator.workspaceId);

    const now = new Date();
    const [
      rounds,
      presentationList,
      roundSessionPage,
      roundActiveSessionPage,
      presentationSessionList,
      openAssignmentPage,
      scheduledAssignmentPage,
      reportPage,
      groupList,
    ] = await Promise.all([
      repository.listQuizzes(creator.workspaceId),
      workspacePresentationsEnabled ? presentations.listPresentations(creator.workspaceId) : [],
      repository.listSessionHistory(creator.workspaceId, { limit: 25, now }),
      repository.listSessionHistory(creator.workspaceId, { limit: 250, status: "active", now }),
      workspacePresentationsEnabled
        ? presentationSessions.listSessions(creator.workspaceId, now)
        : [],
      repository.listFollowupHistory(creator.workspaceId, {
        limit: 250,
        purpose: "assignment",
        status: "open",
        now,
      }),
      repository.listFollowupHistory(creator.workspaceId, {
        limit: 250,
        purpose: "assignment",
        status: "scheduled",
        now,
      }),
      repository.listReportHistory(creator.workspaceId, { limit: 20, now }),
      workspaceGroupsEnabled ? groups.listGroups(creator.workspaceId, creator.userId) : [],
    ]);

    const recentArtifacts = [
      ...rounds.map((round) => ({
        id: round.id,
        artifactType: "round" as const,
        title: round.title,
        description: round.description,
        status: round.status,
        itemCount: round.draft.questions.length,
        updatedAt: round.updatedAt,
        occurredAt: round.updatedAt,
        editHref: `/quiz/${round.id}`,
        actionHref: round.currentVersionId ? `/host/setup/${round.id}` : `/quiz/${round.id}`,
        actionLabel: round.currentVersionId ? "Host Round" : "Continue editing",
      })),
      ...presentationList.map((presentation) => ({
        id: presentation.id,
        artifactType: "presentation" as const,
        title: presentation.title,
        description: presentation.description,
        status: presentation.status,
        itemCount: presentation.blockCount,
        updatedAt: presentation.updatedAt,
        occurredAt: presentation.updatedAt,
        editHref: `/presentation/${presentation.id}`,
        actionHref: presentation.currentVersionId
          ? `/presentation/${presentation.id}/host`
          : `/presentation/${presentation.id}`,
        actionLabel: presentation.currentVersionId ? "Host Presentation" : "Continue editing",
      })),
    ]
      .sort(newestFirst)
      .slice(0, RECENT_ARTIFACT_LIMIT)
      .map(({ occurredAt: _occurredAt, ...artifact }) => artifact);

    const presentationSessionMetrics = await Promise.all(
      presentationSessionList.slice(0, 25).map(async (session) => {
        const [participants, responses] = await Promise.all([
          presentationSessions.listParticipants(session.id),
          presentationSessions.listResponses(session.id),
        ]);
        return { session, participants, responses };
      }),
    );

    const sessionCandidates = [
      ...roundSessionPage.items.map((session) => ({
        id: session.id,
        artifactType: "round" as const,
        artifactId: session.quizId,
        title: session.title,
        status: session.status,
        phase: session.phase,
        code: session.code,
        participantCount: session.participantCount,
        progressLabel:
          session.questionPosition === null
            ? session.status === "finished"
              ? "Complete"
              : "Lobby"
            : `Question ${Math.min(session.questionPosition, session.questionCount)} of ${session.questionCount}`,
        occurredAt: session.updatedAt,
        createdAt: session.createdAt,
        href:
          session.status === "active"
            ? "/sessions"
            : session.reportId
              ? `/report/${session.reportId}`
              : "/sessions",
      })),
      ...presentationSessionMetrics.map(({ session, participants }) => ({
        id: session.id,
        artifactType: "presentation" as const,
        artifactId: session.presentationId,
        title: session.title,
        status: session.status,
        phase: session.phase,
        code: session.code,
        participantCount: participants.length,
        progressLabel:
          session.currentBlockIndex < 0
            ? "Lobby"
            : `Block ${Math.min(session.currentBlockIndex + 1, session.content.blocks.length)} of ${session.content.blocks.length}`,
        occurredAt: session.updatedAt,
        createdAt: session.createdAt,
        href:
          session.status === "active"
            ? `/presentation-session/${session.id}/host`
            : `/presentation-session/${session.id}/report`,
      })),
    ];
    const recentSessions = sessionCandidates
      .sort(activeFirst)
      .slice(0, SESSION_LIMIT)
      .map(({ occurredAt: _occurredAt, ...session }) => session);

    const assignmentCandidates = [...openAssignmentPage.items, ...scheduledAssignmentPage.items]
      .filter(
        (followup) =>
          followup.purpose === "assignment" &&
          (followup.status === "scheduled" || followup.status === "open"),
      )
      .sort((left, right) => {
        const leftActive = left.status === "open" ? 1 : 0;
        const rightActive = right.status === "open" ? 1 : 0;
        return rightActive - leftActive || left.opensAt.getTime() - right.opensAt.getTime();
      });
    const assignments = assignmentCandidates.slice(0, ASSIGNMENT_LIMIT).map((assignment) => ({
      id: assignment.id,
      quizId: assignment.quizId,
      title: assignment.title,
      status: assignment.status,
      checkpointCount: assignment.checkpointCount,
      attemptCount: assignment.attemptCount,
      completedAttemptCount: assignment.completedAttemptCount,
      opensAt: assignment.opensAt,
      closesAt: assignment.closesAt,
      href: `/practice/${assignment.id}`,
    }));

    const resultHighlights = [
      ...reportPage.items.map((report) => ({
        id: report.id,
        artifactType: "round" as const,
        title: report.title,
        status: report.status,
        participantCount: report.participantCount,
        accuracyPercent: report.initialAccuracyPercent,
        recoveryPercent: report.recovery.percent,
        occurredAt: report.generatedAt ?? report.createdAt,
        href: `/report/${report.id}`,
      })),
      ...presentationSessionMetrics
        .filter(({ session }) => session.status === "finished")
        .map(({ session, participants, responses }) => {
          const scored = responses.filter((response) => response.correct !== null);
          const correct = scored.filter((response) => response.correct).length;
          return {
            id: session.id,
            artifactType: "presentation" as const,
            title: session.title,
            status: "ready" as const,
            participantCount: participants.length,
            accuracyPercent: scored.length ? Math.round((correct / scored.length) * 100) : null,
            recoveryPercent: null,
            occurredAt: session.finishedAt ?? session.updatedAt,
            href: `/presentation-session/${session.id}/report`,
          };
        }),
    ]
      .sort(newestFirst)
      .slice(0, RESULT_LIMIT)
      .map(({ occurredAt, ...result }) => ({ ...result, createdAt: occurredAt }));

    const groupScheduleCandidates = (
      await Promise.all(
        groupList.map(async (group) => {
          const [schedule, artifacts] = await Promise.all([
            groups.listSchedule(group.id),
            groups.listArtifacts(group.id),
          ]);
          const artifactTitleByKey = new Map<string, string>();
          await Promise.all(
            artifacts
              .filter(
                (artifact) => artifact.artifactType === "round" || workspacePresentationsEnabled,
              )
              .map(async (artifact) => {
                const record =
                  artifact.artifactType === "round"
                    ? await repository.getQuiz(creator.workspaceId, artifact.artifactId)
                    : await presentations.getPresentation(creator.workspaceId, artifact.artifactId);
                if (record) {
                  artifactTitleByKey.set(
                    `${artifact.artifactType}:${artifact.artifactId}`,
                    record.title,
                  );
                }
              }),
          );
          return schedule
            .filter((item) => item.scheduledFor.getTime() >= now.getTime())
            .filter((item) => item.artifactType === "round" || workspacePresentationsEnabled)
            .map((item) => ({
              id: item.id,
              groupId: group.id,
              groupName: group.name,
              artifactType: item.artifactType,
              artifactId: item.artifactId,
              artifactTitle:
                artifactTitleByKey.get(`${item.artifactType}:${item.artifactId}`) ??
                "Unavailable artifact",
              kind: item.kind,
              scheduledFor: item.scheduledFor,
              note: item.note,
              href: `/groups?group=${group.id}`,
            }));
        }),
      )
    )
      .flat()
      .sort((left, right) => left.scheduledFor.getTime() - right.scheduledFor.getTime());
    const groupSchedule = groupScheduleCandidates.slice(0, SCHEDULE_LIMIT);

    return reply
      .header("cache-control", "private, no-store")
      .header("pragma", "no-cache")
      .send({
        generatedAt: now,
        recentArtifacts,
        sessions: recentSessions,
        assignments,
        resultHighlights,
        groupSchedule,
        totals: {
          artifacts: rounds.length + presentationList.length,
          activeSessions:
            roundActiveSessionPage.items.length +
            presentationSessionList.filter((session) => session.status === "active").length,
          activeAssignments: assignmentCandidates.length,
          upcomingGroupItems: groupScheduleCandidates.length,
        },
      });
  });
}
