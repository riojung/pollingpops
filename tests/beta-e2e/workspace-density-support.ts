import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import {
  FollowupSummarySchema,
  PresentationBlockDraftSchema,
  QuizDraftSchema,
  ReportSummarySchema,
  SessionSummarySchema,
  StarterSummarySchema,
  type StarterSummary,
} from "../../packages/contracts/src/index.ts";
import { SurveyDraftSchema } from "../../packages/contracts/src/surveys.ts";
import type {
  PresentationSessionSummary,
  SurveySessionSummary,
} from "../../apps/web/lib/session-controls";

export const densityApi = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
export const densityLongTitle =
  "Abteilungsübergreifende Zusammenarbeit mit langfristiger Wissenssicherung und klaren nächsten Schritten · 함께 배우고 다음 행동을 결정하는 팀";
const longFolder =
  "Langfristige Zusammenarbeit und abteilungsübergreifender Wissenstransfer · 팀 전체의 공동 학습 계획";
const createdAt = "2026-10-01T12:00:00.000Z";
const expiresAt = "2099-10-01T12:00:00.000Z";
const title = (kind: string, index: number) =>
  index === 7 ? densityLongTitle : `${kind} ${String(index + 1).padStart(2, "0")}`;
const description = (index: number) =>
  index === 7
    ? "Gemeinsam prüfen wir die nächsten Schritte und dokumentieren die langfristige Zusammenarbeit. 모든 참여자가 충분한 맥락을 읽고 팀의 다음 행동을 함께 결정할 수 있도록 자세한 내용을 보존합니다."
    : "Review the next step together.";

/** All synthetic records stay in this browser's GET responses. Mutations always reach the API. */
export async function installDensityFixtures(page: Page) {
  const accountResponse = await page.request.get(`${densityApi}/v1/auth/me`);
  expect(accountResponse.ok()).toBe(true);
  const { creator } = (await accountResponse.json()) as { creator: { workspaceId: string } };
  const sourceResponse = await page.request.get(
    `${densityApi}/v1/starters/new-hire-knowledge-check?locale=en-CA`,
  );
  expect(sourceResponse.ok()).toBe(true);
  const source = QuizDraftSchema.parse((await sourceResponse.json()).draft);
  const firstQuestion = source.questions[0];
  if (!firstQuestion) throw new Error("The real starter must contain a preview question");
  const previewBlock = PresentationBlockDraftSchema.parse({
    id: randomUUID(),
    kind: "question",
    question: firstQuestion,
  });
  const catalogs = new Map<string, StarterSummary[]>();
  for (const locale of ["en-CA", "de-DE", "ko-KR"]) {
    const response = await page.request.get(`${densityApi}/v1/starters?locale=${locale}`);
    expect(response.ok()).toBe(true);
    const catalog = (await response.json()).starters as unknown[];
    expect(catalog.length).toBeGreaterThanOrEqual(8);
    catalogs.set(
      locale,
      catalog.slice(0, 8).map((entry, index) => {
        const starter = StarterSummarySchema.parse(entry);
        return index === 7 ? { ...starter, title: densityLongTitle } : starter;
      }),
    );
  }
  const folders = Object.fromEntries(
    ["round", "presentation", "survey"].map((artifactType) => [
      artifactType,
      [
        {
          id: randomUUID(),
          name: "Training",
          artifactType,
          parentId: null,
          position: 0,
          workspaceId: creator.workspaceId,
        },
        {
          id: randomUUID(),
          name: longFolder,
          artifactType,
          parentId: null,
          position: 1,
          workspaceId: creator.workspaceId,
        },
      ],
    ]),
  );
  const rounds = Array.from({ length: 8 }, (_, index) => ({
    id: randomUUID(),
    workspaceId: creator.workspaceId,
    title: title("Knowledge check", index),
    description: description(index),
    status: "published" as const,
    draft: QuizDraftSchema.parse({
      ...source,
      title: title("Knowledge check", index),
      description: description(index),
    }),
    draftRevision: 1,
    publishedDraftRevision: 1,
    currentVersionId: randomUUID(),
    folderId: folders.round![index === 7 ? 1 : 0]!.id,
    tags: [],
    createdAt,
    updatedAt: createdAt,
    lastHostedAt: null,
  }));
  const presentations = Array.from({ length: 8 }, (_, index) => ({
    id: randomUUID(),
    workspaceId: creator.workspaceId,
    title: title("Team briefing", index),
    description: description(index),
    status: "published" as const,
    blockCount: 4,
    currentVersionId: randomUUID(),
    folderId: folders.presentation![index === 7 ? 1 : 0]!.id,
    hasUnpublishedChanges: index === 7,
    createdAt,
    updatedAt: createdAt,
    previewBlock,
  }));
  const surveys = Array.from({ length: 8 }, (_, index) => ({
    id: randomUUID(),
    workspaceId: creator.workspaceId,
    status: "published" as const,
    revision: 1,
    versionId: randomUUID(),
    folderId: folders.survey![index === 7 ? 1 : 0]!.id,
    createdAt,
    updatedAt: createdAt,
    draft: SurveyDraftSchema.parse({
      schemaVersion: 2,
      title: title("Team check-in", index),
      description: description(index),
      items: [
        {
          required: true,
          question: {
            id: randomUUID(),
            type: "poll",
            prompt: "How clear is the next step?",
            purpose: "opinion",
            confidence: "off",
            delivery: "main",
            conceptKeys: [],
            linkedRecheckQuestionId: null,
            timeLimitSeconds: 30,
            basePoints: 0,
            explanation: "",
            mediaId: null,
            mediaAlt: null,
            choices: ["Clear", "Discuss together"].map((label) => ({
              id: randomUUID(),
              label,
              isCorrect: false,
            })),
          },
        },
      ],
    }),
  }));
  const reports = rounds.map((round, index) =>
    ReportSummarySchema.parse({
      id: randomUUID(),
      sessionId: randomUUID(),
      quizId: round.id,
      trustMode: "learning",
      title: title("Workshop evidence", index),
      status: "ready",
      participantCount: 12,
      initialAccuracyPercent: 60,
      recovery: { recovered: 3, eligible: 4, percent: 75 },
      unresolvedConceptCount: 1,
      interventionCount: 2,
      followupId: null,
      followupStatus: null,
      generatedAt: createdAt,
      createdAt,
      expiresAt,
    }),
  );
  const sessions = rounds.map((round, index) =>
    SessionSummarySchema.parse({
      id: reports[index]!.sessionId,
      quizId: round.id,
      title: title("Workshop session", index),
      status: "finished",
      phase: "finished",
      code: String(1234560 + index),
      participantCount: 12,
      answerCount: 24,
      questionCount: source.questions.length,
      questionPosition: source.questions.length,
      createdAt,
      updatedAt: createdAt,
      expiresAt,
      reportId: reports[index]!.id,
    }),
  );
  const presentationSessions: PresentationSessionSummary[] = presentations.map((item, index) => ({
    id: randomUUID(),
    presentationId: item.id,
    title: title("Briefing session", index),
    code: String(2345670 + index),
    status: "finished",
    phase: "finished",
    currentBlockIndex: 3,
    blockCount: 4,
    participantCount: 12,
    responseCount: 24,
    createdAt,
    finishedAt: createdAt,
    liveExpiresAt: expiresAt,
  }));
  const rooms: SurveySessionSummary[] = surveys.map((survey, index) => ({
    id: randomUUID(),
    surveyId: survey.id,
    title: title("Check-in run", index),
    code: String(3456780 + index),
    closed: true,
    closesAt: createdAt,
    expiresAt,
  }));
  const followups = rounds.map((round, index) =>
    FollowupSummarySchema.parse({
      id: randomUUID(),
      purpose: "assignment",
      sourceSessionId: null,
      sourceReportId: null,
      sourceQuizVersionId: round.currentVersionId,
      quizId: round.id,
      recoveryPackSource: null,
      trustMode: "learning",
      title: title("Workshop practice", index),
      status: "open",
      conceptKeys: [],
      checkpointCount: 2,
      attemptCount: 12,
      completedAttemptCount: 9,
      opensAt: createdAt,
      closesAt: "2099-09-01T12:00:00.000Z",
      expiresAt,
      createdAt,
    }),
  );
  const mutations: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin === densityApi &&
      /^(POST|PUT|PATCH|DELETE)$/.test(request.method()) &&
      /^\/v1\/(quizzes|presentations|surveys|sessions|presentation-sessions|survey-rooms|followups|library|groups|starters)(\/|$)/.test(
        url.pathname,
      )
    )
      mutations.push(`${request.method()} ${url.pathname}`);
  });
  await page.route(`${densityApi}/v1/**`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const url = new URL(route.request().url());
    const payloads: Record<string, unknown> = {
      "/v1/quizzes": { quizzes: rounds },
      "/v1/presentations": { presentations },
      "/v1/surveys": { surveys, nextCursor: null },
      "/v1/library/favorites": { favorites: [] },
      "/v1/sessions/counts": { counts: { rounds: 8, presentations: 8, surveys: 8 } },
      "/v1/sessions": { items: sessions, nextCursor: null },
      "/v1/presentation-sessions": { sessions: presentationSessions },
      "/v1/survey-rooms": { rooms, nextCursor: null },
      "/v1/reports": { items: reports, nextCursor: null },
      "/v1/followups": { items: followups, nextCursor: null },
      "/v1/folders": { folders: folders[url.searchParams.get("artifactType") ?? "round"] ?? [] },
      "/v1/starters": { starters: catalogs.get(url.searchParams.get("locale") ?? "en-CA") },
    };
    if (!(url.pathname in payloads)) return route.fallback();
    return route.fulfill({ json: payloads[url.pathname] });
  });
  return {
    rounds,
    presentations,
    surveys,
    reports,
    followups,
    sessions,
    presentationSessions,
    rooms,
    mutations,
  };
}

export type DensityMetric = {
  key: string;
  viewport: { width: number; height: number } | null;
  ordinaryHeights: number[];
  qualifiedHeights: number[];
  longHeight: number;
  firstRowColumns: number;
};

export async function measureDensity(
  page: Page,
  collection: Locator,
  options: { key: string; phone: boolean; list?: boolean; maxHeight?: number; count?: number },
): Promise<DensityMetric> {
  const cards = collection.getByRole("article");
  await expect(cards).toHaveCount(options.count ?? 8);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
  const rows = await cards.evaluateAll((elements) =>
    elements.map((element) => {
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
      const heading = Array.from(element.querySelectorAll("h2, h3")).find(
        (candidate) => !candidate.closest('[aria-hidden="true"], [inert]'),
      )!;
      return {
        left,
        right,
        top,
        bottom,
        width,
        height,
        title: heading.textContent,
        titleFits:
          heading.scrollWidth <= heading.clientWidth + 1 &&
          heading.scrollHeight <= heading.clientHeight + 1,
        controls: Array.from(
          element.querySelectorAll("a, button, summary, label:has(input[type=checkbox])"),
        )
          .filter((control) => {
            if (control.closest('[aria-hidden="true"], [inert]')) return false;
            const collapsed = control.closest("details:not([open])");
            return !collapsed || Boolean(collapsed.querySelector("summary")?.contains(control));
          })
          .map((control) => {
            const box = control.getBoundingClientRect();
            return {
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
              height: box.height,
              width: box.width,
              text: control.textContent,
              fontSize: Number.parseFloat(getComputedStyle(control).fontSize),
              fits:
                control.scrollWidth <= control.clientWidth + 1 &&
                control.scrollHeight <= control.clientHeight + 1,
            };
          })
          .filter((control) => control.width > 0 && control.height > 0),
      };
    }),
  );
  const viewport = page.viewportSize()!;
  for (const row of rows) {
    expect(row.left, options.key).toBeGreaterThanOrEqual(-1);
    expect(row.right, options.key).toBeLessThanOrEqual(viewport.width + 1);
    expect(row.titleFits, `${options.key}: complete title wraps`).toBe(true);
    expect(row.controls.length, `${options.key}: usable actions remain available`).toBeGreaterThan(
      0,
    );
    for (const control of row.controls) {
      const detail = `${options.key}: ${control.text}`;
      expect(control.left, detail).toBeGreaterThanOrEqual(row.left - 1);
      expect(control.right, detail).toBeLessThanOrEqual(row.right + 1);
      expect(control.top, detail).toBeGreaterThanOrEqual(row.top - 1);
      expect(control.bottom, detail).toBeLessThanOrEqual(row.bottom + 1);
      expect(control.fits, detail).toBe(true);
      expect(control.fontSize, detail).toBeGreaterThanOrEqual(12);
      expect(control.height, detail).toBeGreaterThanOrEqual(options.phone ? 44 : 36);
    }
  }
  if (options.list || options.phone) {
    for (const [index, row] of rows.entries()) {
      expect(Math.abs(row.left - rows[0]!.left), options.key).toBeLessThan(1);
      if (index) expect(row.top, options.key).toBeGreaterThanOrEqual(rows[index - 1]!.bottom - 1);
    }
  }
  const long = rows.find((row) => row.title === densityLongTitle);
  expect(long, `${options.key}: long authored title remains complete`).toBeDefined();
  const ordinary = rows.filter((row) => row !== long);
  // Grid tracks grow with their tallest item. Do not classify ordinary cards sharing
  // the deliberately long item's adaptive row as independent density regressions.
  const qualified = ordinary.filter((row) => options.list || Math.abs(row.top - long!.top) > 1);
  expect(qualified.length).toBeGreaterThan(0);
  const firstRowColumns = rows.filter((row) => Math.abs(row.top - rows[0]!.top) < 1).length;
  if (!options.phone && !options.list)
    expect(firstRowColumns, options.key).toBeGreaterThanOrEqual(3);
  if (!options.phone && options.maxHeight) {
    for (const row of qualified)
      // Fractional font line boxes can put a card just beyond its whole-pixel budget.
      expect(row.height, options.key).toBeLessThanOrEqual(options.maxHeight + 1);
  }
  return {
    key: options.key,
    viewport,
    ordinaryHeights: ordinary.map((row) => Math.round(row.height * 100) / 100),
    qualifiedHeights: qualified.map((row) => Math.round(row.height * 100) / 100),
    longHeight: Math.round(long!.height * 100) / 100,
    firstRowColumns,
  };
}

export async function densityAxe(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

export async function densityScreenshots(
  page: Page,
  collection: Locator,
  info: TestInfo,
  key: string,
  { longItem = false }: { longItem?: boolean } = {},
) {
  await mkdir("artifacts/workspace-density", { recursive: true });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: `artifacts/workspace-density/${info.project.name}-${key}-header.png`,
  });
  await collection.evaluate((element) =>
    scrollTo(0, element.getBoundingClientRect().top + scrollY - 96),
  );
  await page.screenshot({
    path: `artifacts/workspace-density/${info.project.name}-${key}-collection.png`,
  });
  if (longItem) {
    await collection
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: densityLongTitle, exact: true }) })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/workspace-density/${info.project.name}-${key}-long-item.png`,
    });
  }
}

export async function saveDensityMetrics(info: TestInfo, group: string, metrics: DensityMetric[]) {
  await mkdir("artifacts/workspace-density", { recursive: true });
  const path = `artifacts/workspace-density/${info.project.name}-metrics.json`;
  let previous: Record<string, unknown> = {};
  try {
    previous = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(path, `${JSON.stringify({ ...previous, [group]: metrics }, null, 2)}\n`);
  await info.attach(`${group}-metrics`, {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
}
