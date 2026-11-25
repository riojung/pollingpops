import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { presentationInsightsCopy } from "../../apps/web/lib/i18n/presentation-insights-copy";
import { presentationReportCopy } from "../../apps/web/lib/i18n/presentation-report-copy";
import { signInBeta } from "./sign-in";
import { createE01Deck, e01ApiUrl as api, e01Slide } from "./presentation-e01-support";
import { joinBetaParticipant } from "./round-join";
import { specialistLocale } from "./option-b-specialist-support";
import { tabTo, expectVisibleKeyboardFocus } from "./option-b-accessibility-support";

async function quality(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

const assessmentPrompt = "Synthetic assessed statement";
const opinionPrompt = "What should we discuss next?";

async function finishedRound(
  page: Page,
  scenario: "missing evidence" | "measured zero" | "mixed engagement",
) {
  const title = `Synthetic ${scenario} ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post(`${api}/v1/quizzes`, { data: { title } });
  expect(created.status()).toBe(201);
  const quiz = (await created.json()).quiz;
  const correctChoice = randomUUID();
  const wrongChoice = randomUUID();
  const unansweredOpinion = {
    id: randomUUID(),
    type: "poll",
    prompt: opinionPrompt,
    choices: [
      { id: randomUUID(), label: "Examples", isCorrect: false },
      { id: randomUUID(), label: "Practice", isCorrect: false },
    ],
    purpose: "opinion",
    confidence: "off",
    timeLimitSeconds: 300,
    basePoints: 0,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
  expect(
    (
      await page.request.patch(`${api}/v1/quizzes/${quiz.id}`, {
        data: {
          title,
          description: "Synthetic report clarity fixture",
          questions: [
            ...(scenario === "mixed engagement" ? [unansweredOpinion] : []),
            {
              id: randomUUID(),
              type: "true_false",
              prompt: assessmentPrompt,
              choices: [
                { id: correctChoice, label: "True", isCorrect: true },
                { id: wrongChoice, label: "False", isCorrect: false },
              ],
              timeLimitSeconds: 300,
              basePoints: 100,
              explanation: "Synthetic explanation",
              mediaId: null,
              mediaAlt: null,
            },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  expect((await page.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, { data: {} })).ok()).toBe(
    true,
  );
  const hosted = await page.request.post(`${api}/v1/sessions`, {
    data: {
      quizId: quiz.id,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    },
  });
  expect(hosted.status()).toBe(201);
  const room = await hosted.json();
  const headers = { authorization: `Bearer ${room.hostToken}` };
  let participantToken: string | undefined;
  if (scenario !== "missing evidence") {
    const joined = await joinBetaParticipant(page.request, api, {
      code: room.code,
      nickname: "Synthetic evidence participant",
    });
    expect(joined.status()).toBe(201);
    participantToken = (await joined.json()).participantToken;
  }
  if (scenario === "mixed engagement") {
    const observer = await joinBetaParticipant(page.request, api, {
      code: room.code,
      nickname: "Synthetic observer",
    });
    expect(observer.status()).toBe(201);
  }
  async function command(action: "start" | "lock" | "reveal" | "next") {
    const current = await page.request.get(
      `${api}/v1/sessions/${room.sessionId}/snapshot?role=host`,
      { headers },
    );
    expect(current.status()).toBe(200);
    const response = await page.request.post(`${api}/v1/sessions/${room.sessionId}/commands`, {
      headers,
      data: {
        action,
        commandId: randomUUID(),
        expectedVersion: (await current.json()).snapshot.version,
      },
    });
    expect(response.status()).toBe(200);
    return (await response.json()).snapshot;
  }
  let opened = await command("start");
  if (scenario === "mixed engagement") {
    await command("lock");
    await command("reveal");
    opened = await command("next");
  }
  if (participantToken) {
    const accepted = await page.request.post(`${api}/v1/sessions/${room.sessionId}/answers`, {
      headers: { authorization: `Bearer ${participantToken}` },
      data: { roundId: opened.roundId, choiceId: wrongChoice, idempotencyKey: randomUUID() },
    });
    expect(accepted.status()).toBe(200);
    expect((await accepted.json()).accepted).toBe(true);
  }
  await command("lock");
  await command("reveal");
  expect((await command("next")).phase).toBe("finished");
  let reportId = "";
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${api}/v1/sessions/${room.sessionId}/report`);
        if (response.status() === 404) return "pending";
        expect(response.status()).toBe(200);
        const { report } = await response.json();
        reportId = report.id;
        return report.status;
      },
      { timeout: 30_000 },
    )
    .toBe("ready");
  return { reportId, title };
}

async function finishedPresentation(page: Page) {
  const cue = `Synthetic original report ${randomUUID().slice(0, 8)} $& {title}`;
  const question = {
    id: randomUUID(),
    kind: "question" as const,
    question: {
      id: randomUUID(),
      type: "poll" as const,
      prompt: cue,
      choices: [
        { id: randomUUID(), label: "Original first choice", isCorrect: false },
        { id: randomUUID(), label: "Original second choice", isCorrect: false },
      ],
      purpose: "opinion" as const,
      confidence: "off" as const,
      delivery: "main" as const,
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 300,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
      maxSelections: 1,
    },
  };
  const source = await createE01Deck(page, [e01Slide("Synthetic report opening"), question], 13);
  const published = await page.request.post(`${api}/v1/presentations/${source.id}/publish`, {
    data: { expectedDraftRevision: source.draftRevision },
  });
  expect(published.status()).toBe(200);
  const started = await page.request.post(`${api}/v1/presentation-sessions`, {
    data: { presentationId: source.id },
  });
  expect(started.status()).toBe(201);
  const id = (await started.json()).snapshot.sessionId as string;
  for (let index = 0; index < 4; index++) {
    const current = await page.request.get(`${api}/v1/presentation-sessions/${id}`);
    expect(current.status()).toBe(200);
    const snapshot = (await current.json()).snapshot;
    if (snapshot.phase === "finished") break;
    const next = await page.request.post(`${api}/v1/presentation-sessions/${id}/advance`, {
      data: { expectedRevision: snapshot.revision },
    });
    expect(next.status()).toBe(200);
  }
  let envelope:
    { reportStatus: string; report: Record<string, unknown>; sessionContext?: unknown } | undefined;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${api}/v1/presentation-sessions/${id}/report?includeSessionContext=true&includeQuickChecks=true&includeOpinionResults=true&includeTextResults=true&includeNavigation=true&includeInteractions=true`,
        );
        expect([200, 202]).toContain(response.status());
        envelope = await response.json();
        return envelope!.reportStatus;
      },
      { timeout: 30_000 },
    )
    .toBe("ready");
  return {
    id,
    cue,
    envelope: envelope!,
    path: `/presentation-session/${id}/report`,
    reportPattern: `${api}/v1/presentation-sessions/${id}/report**`,
  };
}

async function downloadCsv(page: Page, label: string) {
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: label, exact: true }).click();
  const path = await (await downloaded).path();
  expect(path).not.toBeNull();
  return readFile(path!);
}

for (const suffix of ["desktop", "phone @mobile"]) {
  test(`Option B Home report summaries preserve missing evidence and genuine zero ${suffix}`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: suffix.includes("mobile") ? 320 : 1366, height: 1000 });
    await signInBeta(page, undefined, { returnTo: "/home" });
    await specialistLocale(page, "en-CA");
    const empty = await finishedRound(page, "missing evidence");
    const zero = await finishedRound(page, "measured zero");
    const summaryResponse = await page.request.get(`${api}/v1/home/summary`);
    expect(summaryResponse.status()).toBe(200);
    const rows = (await summaryResponse.json()).resultHighlights as {
      id: string;
      accuracyPercent: number | null;
    }[];
    expect(rows.find((row) => row.id === empty.reportId)?.accuracyPercent).toBeNull();
    expect(rows.find((row) => row.id === zero.reportId)?.accuracyPercent).toBe(0);
    await page.goto("/home");
    const missing = page
      .locator(`a[href="/report/${empty.reportId}"]`)
      .filter({ has: page.getByRole("heading", { name: empty.title, exact: true }) });
    const measured = page
      .locator(`a[href="/report/${zero.reportId}"]`)
      .filter({ has: page.getByRole("heading", { name: zero.title, exact: true }) });
    await expect(missing).toContainText("—");
    await expect(missing).not.toContainText("0%");
    await expect(measured).toContainText("0%");
    await quality(page);
  });

  test(`Round report Analytics shows participation and filters question activity ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: suffix.includes("mobile") ? 320 : 1366, height: 1000 });
    await signInBeta(page);
    await specialistLocale(page, "en-CA");
    const { reportId } = await finishedRound(page, "mixed engagement");
    await page.goto(`/report/${reportId}`);

    const overview = page.getByRole("tab", { name: "Overview", exact: true });
    const analyticsTab = page.getByRole("tab", { name: "Analytics", exact: true });
    const analytics = page.getByRole("tabpanel", { name: "Analytics", exact: true });
    await expect(overview).toHaveAttribute("aria-selected", "true");
    await overview.press("ArrowRight");
    await expect(analyticsTab).toBeFocused();
    await expect(analytics).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(overview).toBeFocused();
    await page.getByRole("button", { name: "View analytics", exact: true }).click();
    await expect(analytics.getByRole("heading", { name: "Session analytics" })).toBeVisible();

    const metric = (label: string) =>
      analytics.getByText(label, { exact: true }).locator("..").locator("dd").first();
    await expect(metric("Joined participants")).toHaveText("2");
    await expect(metric("Participants who answered")).toHaveText("1 of 2");
    await expect(metric("Accepted responses")).toHaveText("1");
    await expect(metric("Questions with responses")).toHaveText("1 of 2");
    await expect(metric("Initial accuracy")).toHaveText("0%");

    const activity = analytics.getByRole("region", { name: "Response activity" });
    const filter = activity.getByRole("combobox", { name: "Show questions" });
    const rows = activity.getByRole("listitem");
    const opinion = rows.filter({ hasText: opinionPrompt });
    const assessment = rows.filter({ hasText: assessmentPrompt });
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText(opinionPrompt);
    await expect(opinion.getByText("0 responses", { exact: true })).toBeVisible();
    await expect(assessment.getByText("1 response", { exact: true })).toBeVisible();
    await activity.getByRole("combobox", { name: "Order", exact: true }).selectOption({
      label: "Most responses",
    });
    await expect(rows.first()).toContainText(assessmentPrompt);
    await filter.selectOption({ label: "Assessments" });
    await expect(opinion).toHaveCount(0);
    await expect(assessment).toBeVisible();
    await filter.selectOption({ label: "Opinion questions" });
    await expect(opinion).toBeVisible();
    await expect(assessment).toHaveCount(0);
    await filter.selectOption({ label: "All questions" });
    await expect(rows).toHaveCount(2);

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
      await quality(page);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: info.outputPath(`round-analytics-${colorScheme}.png`),
        fullPage: true,
      });
    }

    await filter.selectOption({ label: "Opinion questions" });
    await analytics.getByRole("button", { name: "View all questions", exact: true }).click();
    await expect(page.getByRole("tabpanel", { name: "Questions", exact: true })).toBeVisible();
    await analyticsTab.click();
    await expect(filter).toHaveValue("opinion");
    await expect(activity.getByRole("combobox", { name: "Order", exact: true })).toHaveValue(
      "responses",
    );
    await page.goto(`/report/${reportId}?view=analytics`);
    await expect(analyticsTab).toHaveAttribute("aria-selected", "true");
    await expect(analytics.getByRole("heading", { name: "Session analytics" })).toBeVisible();
  });

  test(`Option B Presentation report retries exhausted reads and preserves localized exports ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: suffix.includes("mobile") ? 320 : 1366, height: 1000 });
    await signInBeta(page);
    await specialistLocale(page, "en-CA");
    const fixture = await finishedPresentation(page);
    let ready = false;
    let reads = 0;
    await page.route(fixture.reportPattern, (route) => {
      reads++;
      return ready
        ? route.fulfill({ json: fixture.envelope })
        : route.fulfill({ status: 503, json: { error: "Synthetic transient report outage" } });
    });
    await page.clock.install();
    await page.goto(fixture.path);
    for (let count = 1; count <= 6; count++) {
      await expect.poll(() => reads).toBe(count);
      await page.clock.runFor(150);
      if (count < 6) await page.clock.fastForward(11_000);
    }
    const copy = presentationReportCopy("en-CA");
    const retry = page.getByRole("button", { name: copy("retryReport"), exact: true });
    await expect(retry).toBeEnabled();
    await expect(page.getByText(copy("reportUnavailable"), { exact: true })).toBeVisible();
    await page.clock.fastForward(30_000);
    expect(reads).toBe(6);
    ready = true;
    await tabTo(page, retry);
    await expectVisibleKeyboardFocus(retry);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: fixture.cue, exact: true })).toBeVisible();
    expect(reads).toBe(7);
    const english = await downloadCsv(page, copy("exportEvidenceCsv"));
    expect(english.toString()).toContain(fixture.cue);
    for (const locale of ["de-DE", "ko-KR"] as const) {
      await specialistLocale(page, locale);
      await page.reload();
      const localized = presentationReportCopy(locale);
      const insightsCopy = presentationInsightsCopy(locale);
      await expect(
        page.getByRole("button", { name: localized("exportEvidenceCsv"), exact: true }),
      ).toBeVisible();
      await expect(page.getByText(localized("finishedReport"), { exact: true })).toBeVisible();
      await expect(page.getByText(localized("questionType.poll"), { exact: true })).toBeVisible();
      const sessionInsights = insightsCopy("Session insights");
      const insights = page.getByRole("region", { name: sessionInsights, exact: true });
      const tabs = insights.getByRole("tablist", { name: sessionInsights, exact: true });
      const dashboardTab = (
        key: "Overview" | "Delivery" | "Response coverage" | "Opinion results" | "Q&A",
      ) => tabs.getByRole("tab", { name: insightsCopy(key), exact: true });
      for (const key of ["Export coverage CSV", "Refresh insights"] as const) {
        await expect(
          insights.getByRole("button", { name: insightsCopy(key), exact: true }),
        ).toBeVisible();
      }
      for (const key of [
        "Overview",
        "Delivery",
        "Response coverage",
        "Opinion results",
        "Q&A",
      ] as const)
        await expect(dashboardTab(key)).toBeVisible();
      await expect(dashboardTab("Overview")).toHaveAttribute("aria-selected", "true");
      await dashboardTab("Delivery").click();
      await expect(
        insights
          .getByRole("tabpanel", { name: insightsCopy("Delivery"), exact: true })
          .getByRole("heading", { name: insightsCopy("Section delivery"), exact: true }),
      ).toBeVisible();
      await dashboardTab("Overview").click();
      await expect(
        insights
          .getByRole("tabpanel", { name: insightsCopy("Overview"), exact: true })
          .locator("summary")
          .filter({ hasText: insightsCopy("Published version") }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: fixture.cue, exact: true })).toBeVisible();
      expect(await downloadCsv(page, localized("exportEvidenceCsv"))).toEqual(english);
      await quality(page);
    }
    await mkdir("artifacts/option-b-report-clarity", { recursive: true });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: `artifacts/option-b-report-clarity/${info.project.name}-localized-report.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `artifacts/option-b-report-clarity/${info.project.name}-report-header.png`,
    });
    await page
      .getByRole("heading", {
        name: presentationInsightsCopy("ko-KR")("Session insights"),
        exact: true,
      })
      .evaluate((heading) => heading.scrollIntoView({ block: "start", behavior: "instant" }));
    await page.screenshot({
      path: `artifacts/option-b-report-clarity/${info.project.name}-session-insights.png`,
    });
    await specialistLocale(page, "en-CA");
  });

  test(`Option B Presentation report clears revoked context and rejects a late report ${suffix}`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: suffix.includes("mobile") ? 320 : 1366, height: 1000 });
    await signInBeta(page);
    await specialistLocale(page, "en-CA");
    const fixture = await finishedPresentation(page);
    const accountResponse = await page.request.get(`${api}/v1/auth/me`);
    expect(accountResponse.status()).toBe(200);
    const account = await accountResponse.json();
    let mode: "ready" | "held" | "revoked" = "ready";
    let held = false;
    let release: (() => void) | undefined;
    await page.route(fixture.reportPattern, async (route) => {
      if (mode === "held") {
        held = true;
        await new Promise<void>((done) => {
          release = done;
        });
        return route.fulfill({ json: fixture.envelope });
      }
      return mode === "revoked"
        ? route.fulfill({ status: 403, json: { error: "Synthetic report access revoked" } })
        : route.fulfill({ json: fixture.envelope });
    });
    await page.goto(fixture.path);
    await expect(page.getByRole("heading", { name: fixture.cue, exact: true })).toBeVisible();
    mode = "held";
    await page.evaluate(() => window.dispatchEvent(new Event("pollingpops:auth-change")));
    await expect.poll(() => held).toBe(true);
    const workspaceId = randomUUID();
    const nextUserId = randomUUID();
    await page.route(`${api}/v1/auth/me`, (route) =>
      route.fulfill({
        json: {
          ...account,
          creator: { ...account.creator, userId: nextUserId, workspaceId, role: "viewer" },
          workspace: { ...account.workspace, id: workspaceId },
        },
      }),
    );
    mode = "revoked";
    await page.evaluate(() => window.dispatchEvent(new Event("polling-pops:workspace-updated")));
    await expect(
      page.getByText(presentationReportCopy("en-CA")("reportUnavailable"), { exact: true }),
    ).toBeVisible();
    const late = page.waitForResponse(
      (response) =>
        response.url().startsWith(`${api}/v1/presentation-sessions/${fixture.id}/report`) &&
        response.status() === 200,
    );
    release!();
    await late;
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await expect(page.getByRole("heading", { name: fixture.cue, exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: presentationReportCopy("en-CA")("exportEvidenceCsv"),
        exact: true,
      }),
    ).toHaveCount(0);
    await quality(page);
  });
}
