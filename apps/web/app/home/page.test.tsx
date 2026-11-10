import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import type { HomeSummary, HomeWork } from "./home-model";
import { hasHomeWork, homeMilestones, homeWorkAction, recentHomeWork } from "./home-model";

const mocked = vi.hoisted(() => ({
  summary: null as HomeSummary | null,
  contextKeys: [] as Array<string | null>,
  creator: {
    userId: "user-a",
    workspaceId: "workspace-a",
    email: "new.user@example.com",
    role: "owner",
    plan: "free",
    segment: "workplace",
  },
  workspace: { id: "account-a", organization: { id: "organization-a" } },
  productFeatures: {
    workspaceShell: true,
    uxBeta: false,
    builderV2: false,
    presentations: false,
    surveys: false,
    ideaBoards: false,
    canvasBoards: false,
    groups: false,
  },
  accountLoading: false,
  canEdit: true,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    creator: mocked.creator,
    workspace: mocked.workspace,
    productFeatures: mocked.productFeatures,
    loading: mocked.accountLoading,
    error: "",
    canEdit: mocked.canEdit,
    signOut: vi.fn(),
    startUpgrade: vi.fn(),
    refreshAccount: vi.fn(),
  }),
}));
vi.mock("./home-summary", () => ({
  useHomeSummary: (contextKey: string | null) => {
    mocked.contextKeys.push(contextKey);
    return { summary: mocked.summary, loading: false, error: "", refresh: vi.fn() };
  },
}));

import HomePage from "./page";

function emptySummary(): HomeSummary {
  return {
    generatedAt: "2026-11-03T12:00:00Z",
    recentArtifacts: [],
    recentSurveys: [],
    recentBoards: [],
    sessions: [],
    assignments: [],
    resultHighlights: [],
    groupSchedule: [],
    totals: {
      artifacts: 0,
      surveys: 0,
      boards: 0,
      activeSessions: 0,
      activeAssignments: 0,
      upcomingGroupItems: 0,
    },
  };
}
function mixedSummary(): HomeSummary {
  const summary = emptySummary();
  summary.totals = { ...summary.totals, artifacts: 5, surveys: 1, boards: 2 };
  summary.recentArtifacts = [
    {
      id: "shared-id",
      artifactType: "round",
      title: "A published Round",
      description: "Team reflection",
      status: "published",
      itemCount: 2,
      updatedAt: "2026-11-01T10:00:00Z",
      editHref: "/quiz/shared-id",
      actionHref: "/host/setup/shared-id",
      actionLabel: "Host Round",
    },
    {
      id: "shared-id",
      artifactType: "presentation",
      title: "A working Presentation",
      description: "",
      status: "draft",
      itemCount: 3,
      updatedAt: "2026-11-01T11:00:00Z",
      editHref: "/presentation/shared-id",
      actionHref: "/presentation/shared-id",
      actionLabel: "Continue editing",
    },
  ];
  summary.recentSurveys = [
    {
      id: "shared-id",
      artifactType: "survey",
      title: "A useful Survey",
      description: "A short check-in",
      status: "published",
      itemCount: 1,
      updatedAt: "2026-11-02T12:00:00Z",
      editHref: "/surveys/shared-id",
      actionHref: "/surveys/shared-id",
      actionLabel: "Open Survey",
    },
  ];
  summary.recentBoards = [
    {
      id: "shared-id",
      artifactType: "idea_board",
      boardType: "workshop",
      title: "A shared idea board",
      description: "Collect practical ideas",
      status: "collecting",
      itemCount: 1,
      updatedAt: "2026-11-02T13:00:00Z",
      editHref: "/boards/shared-id",
      actionHref: "/boards/shared-id",
      actionLabel: "Open Board",
      canEdit: true,
    },
    {
      id: "shared-id",
      artifactType: "canvas",
      boardType: "team",
      title: "A planning canvas",
      description: "",
      status: "active",
      itemCount: null,
      updatedAt: "2026-11-03T11:00:00Z",
      editHref: "/canvas/shared-id",
      actionHref: "/canvas/shared-id",
      actionLabel: "Open Board",
      canEdit: true,
      role: "owner",
    },
  ];
  return summary;
}
function renderHome() {
  return renderToStaticMarkup(withEnglishLocale(<HomePage />));
}
beforeEach(() => {
  mocked.summary = null;
  mocked.creator.userId = "user-a";
  mocked.creator.workspaceId = "workspace-a";
  mocked.creator.role = "owner";
  mocked.workspace.id = "account-a";
  mocked.accountLoading = false;
  mocked.canEdit = true;
  mocked.contextKeys.length = 0;
  Object.assign(mocked.productFeatures, {
    builderV2: false,
    presentations: false,
    surveys: false,
    ideaBoards: false,
    canvasBoards: false,
    groups: false,
  });
});

describe("workspace Home", () => {
  it("keeps first-session guidance after a draft and completes it only on delivery evidence", () => {
    const summary = emptySummary();
    summary.totals.artifacts = 1;
    summary.recentArtifacts = [{ ...mixedSummary().recentArtifacts[1]!, id: "first-draft" }];
    mocked.summary = summary;
    expect(homeMilestones(summary)).toEqual({ created: true, published: false, delivered: false });
    expect(renderHome()).toContain("Finish your first session");
    summary.resultHighlights = [
      {
        id: "first-result",
        artifactType: "round",
        title: "First result",
        status: "ready",
        participantCount: 2,
        accuracyPercent: null,
        recoveryPercent: null,
        createdAt: summary.generatedAt,
        href: "/report/first-result",
      },
    ];
    expect(homeMilestones(summary).delivered).toBe(true);
    expect(renderHome()).not.toContain("Finish your first session");
  });

  it("puts an active room before recent work and keeps its canonical secure resume destination", () => {
    mocked.summary = mixedSummary();
    mocked.summary.sessions = [
      {
        id: "live-room",
        artifactType: "round",
        artifactId: "source",
        title: "Audience waiting",
        status: "active",
        phase: "lobby",
        code: "1234567",
        participantCount: 4,
        progressLabel: "Lobby",
        createdAt: mocked.summary.generatedAt,
        href: "/sessions",
      },
    ];
    const markup = renderHome();
    expect(markup.indexOf("Audience waiting")).toBeLessThan(markup.indexOf("Recent work"));
    expect(markup).toContain('href="/sessions">Open Sessions');
    expect(homeMilestones(mocked.summary)).toEqual({
      created: true,
      published: true,
      delivered: false,
    });
  });
  it("routes Home creation to the universal hub without requiring advanced builder features", () => {
    const markup = renderHome();
    expect(markup).toContain(">Home</h1>");
    expect(markup).toContain('class="brand" href="/home"');
    expect(markup).toContain('href="/create"');
    expect(markup).toContain("Welcome back, new user");
    expect(markup).not.toContain("Everything you are working on, together.");
    expect(markup).not.toContain("Create a Round or Presentation");
    expect(markup).not.toContain("Your checkpoint sets");
    expect(markup).not.toContain("Loading your workspace");
  });

  it("shows all accessible formats, accurate counts and their canonical destinations", () => {
    mocked.summary = mixedSummary();
    Object.assign(mocked.productFeatures, {
      surveys: true,
      ideaBoards: true,
      canvasBoards: true,
      presentations: true,
    });
    const markup = renderHome();
    for (const artifact of recentHomeWork(mocked.summary)) {
      expect(markup).toContain(artifact.title);
      expect(markup).toContain(`data-type="${artifact.artifactType}"`);
      expect(markup).toContain(`href="${artifact.actionHref}"`);
    }
    expect(markup).toContain("1 question");
    expect(markup).toContain("1 idea");
    expect(markup).toContain("2 questions");
    expect(markup).toContain("3 blocks");
    expect(markup).not.toContain("0 objects");
    expect(markup).toContain("Collecting");
    expect(markup).toContain("Active");
    expect(markup).toContain("Open Survey");
    expect(markup).toContain("Open Idea Board");
    expect(markup).toContain("Open Canvas");
    expect(markup).toContain("Host Round");
    expect(markup).toContain('data-layout="compact"');
    expect(markup).not.toContain("From a trusted source to useful evidence");
    expect(markup.indexOf("A planning canvas")).toBeLessThan(markup.indexOf("A useful Survey"));
  });

  it("treats board-only and survey-only workspaces as existing work", () => {
    const allWork = mixedSummary();
    for (const kind of ["survey", "idea_board", "canvas"] as const) {
      mocked.summary = emptySummary();
      mocked.summary.totals.artifacts = 1;
      if (kind === "survey") mocked.summary.recentSurveys = allWork.recentSurveys;
      else
        mocked.summary.recentBoards = allWork.recentBoards!.filter(
          (item) => item.artifactType === kind,
        );
      const markup = renderHome();
      expect(markup).not.toContain("From a trusted source to useful evidence");
      expect(markup).not.toContain("No activities or boards in this workspace yet.");
    }
  });

  it("keeps boards and legacy Surveys discoverable when newer Rounds fill recent work", () => {
    const sample = mixedSummary();
    mocked.summary = emptySummary();
    mocked.summary.totals = { ...mocked.summary.totals, artifacts: 9, surveys: 1, boards: 2 };
    mocked.summary.recentArtifacts = Array.from({ length: 6 }, (_, index) => ({
      ...sample.recentArtifacts[0]!,
      id: `round-${index}`,
      title: `Recent Round ${index}`,
      updatedAt: `2026-11-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
      editHref: `/quiz/round-${index}`,
      actionHref: `/host/setup/round-${index}`,
    }));
    mocked.summary.recentBoards = [
      {
        ...sample.recentBoards![1]!,
        id: "owned-canvas",
        title: "Owned planning canvas",
        updatedAt: null,
        editHref: "/canvas/owned-canvas",
        actionHref: "/canvas/owned-canvas",
      },
      {
        ...sample.recentBoards![1]!,
        id: "shared-canvas",
        title: "Shared planning canvas",
        updatedAt: null,
        role: "viewer",
        canEdit: false,
        editHref: "/canvas/shared-canvas",
        actionHref: "/canvas/shared-canvas",
      },
    ];
    mocked.summary.recentSurveys = [
      {
        ...sample.recentSurveys![0]!,
        id: "legacy-survey",
        title: "Legacy check-in Survey",
        updatedAt: null,
        editHref: "/surveys/legacy-survey",
        actionHref: "/surveys/legacy-survey",
      },
    ];
    expect(recentHomeWork(mocked.summary).every((item) => item.artifactType === "round")).toBe(
      true,
    );
    const markup = renderHome();
    const boards = markup.match(
      /<section[^>]*aria-labelledby="home-boards-title"[\s\S]*?<\/section>/,
    )?.[0];
    const surveys = markup.match(
      /<section[^>]*aria-labelledby="home-surveys-title"[\s\S]*?<\/section>/,
    )?.[0];
    expect(boards).toContain("Owned planning canvas");
    expect(boards).toContain("Shared planning canvas");
    expect(boards).toContain('href="/canvas/owned-canvas"');
    expect(boards).toContain('href="/canvas/shared-canvas"');
    expect(boards).toContain('href="/boards"');
    expect(boards).toContain(">2</span>");
    expect(boards).not.toContain("datetime=");
    expect(boards).not.toContain("0 objects");
    expect(surveys).toContain("Legacy check-in Survey");
    expect(surveys).toContain('href="/surveys/legacy-survey"');
    expect(surveys).toContain('href="/library?type=surveys"');
    expect(surveys).toContain(">1</span>");
    expect(surveys).toContain("1 question");
    expect(surveys).not.toContain("datetime=");
  });

  it("offers the creation hub for a truly empty workspace", () => {
    mocked.summary = emptySummary();
    mocked.productFeatures.surveys = true;
    const markup = renderHome();
    expect(markup).toContain("No activities or boards in this workspace yet.");
    expect(markup).toContain("Finish your first session");
    expect(markup).toContain("Create your first artifact");
    expect(markup).toContain('href="/create"');
  });

  it("preserves live activity, outcomes and group schedules alongside every work format", () => {
    mocked.summary = mixedSummary();
    mocked.productFeatures.groups = true;
    mocked.summary.sessions = [
      {
        id: "session-a",
        artifactType: "round",
        artifactId: "shared-id",
        title: "Live reflection room",
        status: "active",
        phase: "lobby",
        code: "ROOM1",
        participantCount: 3,
        progressLabel: "Lobby",
        createdAt: "2026-11-03T12:00:00Z",
        href: "/session/session-a/host",
      },
    ];
    mocked.summary.resultHighlights = [
      {
        id: "report-a",
        artifactType: "round",
        title: "Reflection outcomes",
        status: "ready",
        participantCount: 3,
        accuracyPercent: 80,
        recoveryPercent: 90,
        createdAt: "2026-11-03T12:00:00Z",
        href: "/report/report-a",
      },
    ];
    mocked.summary.groupSchedule = [
      {
        id: "schedule-a",
        groupId: "group-a",
        groupName: "Planning group",
        artifactType: "round",
        artifactId: "shared-id",
        artifactTitle: "Upcoming reflection",
        kind: "live_session",
        scheduledFor: "2026-11-04T12:00:00Z",
        note: "",
        href: "/groups?group=group-a",
      },
    ];
    const markup = renderHome();
    for (const label of [
      "Live reflection room",
      "Reflection outcomes",
      "Planning group",
      "Upcoming reflection",
    ])
      expect(markup).toContain(label);
    expect(markup).toContain('href="/session/session-a/host"');
    expect(markup).toContain('href="/report/report-a"');
    expect(markup).toContain('href="/groups?group=group-a"');
  });

  it("keeps viewer actions read-only and hides every Home creation entry", () => {
    mocked.summary = mixedSummary();
    mocked.canEdit = false;
    mocked.creator.role = "viewer";
    const markup = renderHome();
    expect(markup).not.toContain('href="/create"');
    expect(markup).not.toContain('href="/host/setup/shared-id"');
    expect(markup).not.toContain("Host Round");
    expect(markup).toContain('href="/quiz/shared-id"');
    expect(markup).toContain('href="/surveys/shared-id"');
    expect(markup).toContain('href="/canvas/shared-id"');
    expect(markup).toContain("View →");
  });

  it("labels linked workshop canvases correctly and omits unavailable timestamps/counts", () => {
    mocked.summary = emptySummary();
    mocked.summary.totals.artifacts = 2;
    mocked.summary.recentBoards = [{ ...mixedSummary().recentBoards![1]!, boardType: "workshop" }];
    mocked.summary.recentSurveys = [{ ...mixedSummary().recentSurveys![0]!, updatedAt: null }];
    const markup = renderHome();
    expect(markup).toContain("Guided workshop");
    expect(markup).not.toContain("Invalid Date");
    expect(markup).not.toContain("0 objects");
  });

  it("invalidates the summary after a Groups grant change with the same account and workspace", () => {
    renderHome();
    const disabledScope = mocked.contextKeys.at(-1);
    mocked.productFeatures.groups = true;
    renderHome();
    const enabledScope = mocked.contextKeys.at(-1);
    expect(enabledScope).not.toBeNull();
    expect(enabledScope).not.toBe(disabledScope);
    mocked.productFeatures.groups = false;
    renderHome();
    expect(mocked.contextKeys.at(-1)).toBe(disabledScope);
  });

  it("changes the summary scope for user, workspace and account changes and blocks loading contexts", () => {
    renderHome();
    const initial = mocked.contextKeys.at(-1);
    mocked.creator.workspaceId = "workspace-b";
    renderHome();
    expect(mocked.contextKeys.at(-1)).not.toBe(initial);
    mocked.creator.workspaceId = "workspace-a";
    mocked.creator.userId = "user-b";
    renderHome();
    expect(mocked.contextKeys.at(-1)).not.toBe(initial);
    mocked.creator.userId = "user-a";
    mocked.workspace.id = "account-b";
    renderHome();
    expect(mocked.contextKeys.at(-1)).not.toBe(initial);
    mocked.accountLoading = true;
    renderHome();
    expect(mocked.contextKeys.at(-1)).toBeNull();
  });
});

describe("Home recent-work model", () => {
  it("merges kinds without ID collisions and preserves existing totals", () => {
    const summary = mixedSummary();
    const work = recentHomeWork(summary);
    expect(new Set(work.map((item) => `${item.artifactType}:${item.id}`)).size).toBe(5);
    expect(summary.totals.artifacts).toBe(5);
    expect(hasHomeWork({ ...summary, totals: { ...summary.totals, artifacts: 0 } })).toBe(true);
    expect(hasHomeWork(emptySummary())).toBe(false);
  });

  it("uses the canonical action and board permission rather than status alone", () => {
    const round = mixedSummary().recentArtifacts[0]!;
    expect(homeWorkAction({ ...round, status: "draft" }, true)).toEqual({
      href: "/host/setup/shared-id",
      label: "hostRound",
    });
    expect(homeWorkAction(round, false)).toEqual({ href: "/quiz/shared-id", label: "view" });
    const board = mixedSummary().recentBoards![1]!;
    expect(homeWorkAction({ ...board, canEdit: false, role: "viewer" }, true)).toEqual({
      href: "/canvas/shared-id",
      label: "view",
    });
  });

  it("places unknown update times last and limits the combined list", () => {
    const summary = mixedSummary();
    const survey = summary.recentSurveys![0]!;
    summary.recentSurveys = [
      { ...survey, id: "legacy", updatedAt: null },
      ...Array.from({ length: 7 }, (_, index) => ({
        ...survey,
        id: `survey-${index}`,
        updatedAt: `2026-11-${String(index + 4).padStart(2, "0")}T12:00:00Z`,
      })),
    ];
    const work: HomeWork[] = recentHomeWork(summary);
    expect(work).toHaveLength(6);
    expect(work[0]!.id).toBe("survey-6");
    expect(work.some((item) => item.id === "legacy")).toBe(false);
  });
});
