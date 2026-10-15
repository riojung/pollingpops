import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { FollowupSummary, ReportSummary } from "@openround/contracts";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const web = `http://127.0.0.1:${Number(process.env.BETA_E2E_WEB_PORT ?? 3200)}`;

function canceledReadKey(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.origin === api && url.pathname.startsWith("/v1/")) return url.href;
  if (url.origin === web && url.searchParams.has("_rsc")) {
    return `${url.origin}${url.pathname}?_rsc=${url.searchParams.get("_rsc")}`;
  }
  return null;
}

async function mockHistory(page: Page) {
  const quizId = randomUUID();
  const otherQuizId = randomUUID();
  const versionId = randomUUID();
  const createdAt = "2026-10-01T12:00:00.000Z";
  const expiresAt = "2099-10-01T12:00:00.000Z";
  const reports: ReportSummary[] = Array.from({ length: 28 }, (_, index) => ({
    id: randomUUID(),
    sessionId: randomUUID(),
    quizId: index < 26 ? quizId : otherQuizId,
    trustMode: "learning",
    title:
      index === 26
        ? "Synthetic processing evidence"
        : index === 27
          ? "Synthetic failed evidence"
          : `Synthetic Round evidence ${index + 1}`,
    status: index === 26 ? "pending" : index === 27 ? "failed" : "ready",
    participantCount: 12,
    initialAccuracyPercent: 60,
    recovery: { recovered: 3, eligible: 4, percent: 75 },
    unresolvedConceptCount: 1,
    interventionCount: 2,
    followupId: index === 0 ? randomUUID() : null,
    followupStatus: index === 0 ? "open" : null,
    generatedAt: index < 26 ? createdAt : null,
    createdAt,
    expiresAt,
  }));
  const followups: FollowupSummary[] = Array.from({ length: 26 }, (_, index) => {
    const common = {
      id: randomUUID(),
      sourceQuizVersionId: versionId,
      quizId,
      recoveryPackSource: null,
      trustMode: "learning" as const,
      title: index === 0 ? "Synthetic recovery practice" : `Synthetic assignment practice ${index}`,
      status: index === 25 ? ("closed" as const) : ("open" as const),
      checkpointCount: 2,
      attemptCount: 12,
      completedAttemptCount: 9,
      opensAt: createdAt,
      closesAt: "2099-09-01T12:00:00.000Z",
      expiresAt,
      createdAt,
    };
    return index === 0
      ? {
          ...common,
          purpose: "recovery",
          sourceSessionId: reports[0]!.sessionId,
          sourceReportId: reports[0]!.id,
          conceptKeys: ["handover"],
        }
      : {
          ...common,
          purpose: "assignment",
          sourceSessionId: null,
          sourceReportId: null,
          conceptKeys: [],
        };
  });
  const presentations = ["finished", "active"].map((status) => ({
    id: randomUUID(),
    presentationId: randomUUID(),
    title: `Synthetic ${status} Presentation`,
    status,
    phase: status === "finished" ? "finished" : "revealed",
    participantCount: 12,
    responseCount: 24,
    blockCount: 4,
    createdAt,
    finishedAt: status === "finished" ? createdAt : null,
  }));
  const reads: Array<{ path: string; query: URLSearchParams }> = [];
  let presentationReads = 0;
  await page.route(`${api}/v1/quizzes?*`, (route) =>
    route.fulfill({
      json: {
        quizzes: [
          { id: quizId, title: "Synthetic source Round" },
          { id: otherQuizId, title: "Synthetic other Round" },
        ],
      },
    }),
  );
  for (const [path, items] of [
    ["/v1/reports", reports],
    ["/v1/followups", followups],
  ] as const) {
    await page.route(`${api}${path}?*`, (route) => {
      const query = new URL(route.request().url()).searchParams;
      reads.push({ path, query });
      const search = (query.get("search") ?? "").toLocaleLowerCase();
      const status = query.get("status");
      const source = query.get("quizId");
      const from = query.get("from");
      const to = query.get("to");
      const filtered = items.filter(
        (item) =>
          (!search || item.title.toLocaleLowerCase().includes(search)) &&
          (!status || item.status === status) &&
          (!source || item.quizId === source) &&
          (!from || new Date(item.createdAt) >= new Date(from)) &&
          (!to || new Date(item.createdAt) <= new Date(to)),
      );
      const start = Number(query.get("cursor") ?? 0);
      const limit = Number(query.get("limit") ?? 25);
      return route.fulfill({
        json: {
          items: filtered.slice(start, start + limit),
          nextCursor: filtered.length > start + limit ? String(start + limit) : null,
        },
      });
    });
  }
  await page.route(`${api}/v1/presentation-sessions`, (route) => {
    presentationReads += 1;
    return route.fulfill({ json: { sessions: presentations } });
  });
  return {
    quizId,
    reports,
    followups,
    presentations,
    reads,
    presentationReadCount: () => presentationReads,
  };
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

for (const mobile of [false, true]) {
  test(`${mobile ? "@mobile " : ""}Results matches workspace history controls and preserves evidence workflows`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const pageErrors: Array<{ message: string; at: number }> = [];
    const canceledReads = new Map<string, number[]>();
    page.on("requestfailed", (request) => {
      if (
        test.info().project.name.startsWith("webkit") &&
        request.method() === "GET" &&
        request.failure()?.errorText.toLowerCase() === "cancelled"
      ) {
        const key = canceledReadKey(request.url());
        if (key) canceledReads.set(key, [...(canceledReads.get(key) ?? []), Date.now()]);
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push({ message: error.message, at: Date.now() });
    });
    await signInBeta(page);
    // Let the auth landing page finish its reads and Next prefetches before
    // replacing the document; WebKit otherwise reports aborted reads as errors.
    await page.waitForLoadState("networkidle");
    const fixture = await mockHistory(page);
    await page.goto("/results");
    await expect(page.getByRole("heading", { name: "Results", level: 1 })).toBeVisible();
    const views = page.getByRole("navigation", { name: "Evidence views" });
    await expect(views.getByRole("link", { name: "Rounds", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(views.getByRole("link", { name: "Presentations", exact: true })).toBeVisible();
    await expect(views.getByRole("link", { name: "Practice", exact: true })).toBeVisible();
    await expect(views.getByRole("link", { name: "Surveys", exact: true })).toHaveAttribute(
      "href",
      "/results?view=surveys",
    );
    await expect(
      page.getByRole("link", { name: "Survey runs and results", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Back to Round library", exact: true }),
    ).toHaveAttribute("href", "/library?type=rounds");
    const collection = page.getByRole("region", { name: "Results", exact: true });
    await expect(collection.getByRole("article")).toHaveCount(25);
    await expect(
      page.getByText("25 results shown · More available", { exact: true }),
    ).toBeVisible();
    await expect(collection).toHaveAttribute("data-view", "grid");
    await page.screenshot({
      path: `/tmp/pollingpops-results-${test.info().project.name}.png`,
    });
    await page.getByRole("button", { name: "Load More", exact: true }).click();
    await expect(collection.getByRole("article")).toHaveCount(28);
    await expect(page.getByText("28 results shown", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Load More", exact: true })).toHaveCount(0);
    const ready = collection.getByRole("article").filter({
      has: page.getByRole("heading", { name: fixture.reports[0]!.title, exact: true }),
    });
    await expect(
      ready.getByRole("link", { name: "Open Recovery Story", exact: true }),
    ).toHaveAttribute("href", `/report/${fixture.reports[0]!.id}`);
    await expect(ready.getByRole("link", { name: "View Followup", exact: true })).toHaveAttribute(
      "href",
      "/results?view=practice",
    );
    const resultStatus = page.getByRole("combobox", { name: "Result Status", exact: true });
    await expect(resultStatus.locator("option")).toHaveText([
      "All results",
      "Ready",
      "Processing",
      "Needs attention",
    ]);
    await resultStatus.selectOption("pending");
    await expect(collection.getByRole("article")).toHaveCount(1);
    await expect(
      collection.getByRole("heading", { name: "Synthetic processing evidence" }),
    ).toBeVisible();
    await expect(
      collection.getByRole("link", { name: "View Status", exact: true }),
    ).toHaveAttribute("href", `/report/${fixture.reports[26]!.id}`);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(resultStatus).toHaveValue("all");
    const search = page.getByRole("searchbox", { name: "Search Round results", exact: true });
    await search.fill("Round evidence 26");
    await expect(collection.getByRole("article")).toHaveCount(1);
    await expect(
      collection.getByRole("heading", { name: "Synthetic Round evidence 26" }),
    ).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("Round evidence 26");
    expect(fixture.reads.at(-1)?.query.get("search")).toBe("Round evidence 26");
    await page.getByRole("combobox", { name: "Round", exact: true }).selectOption(fixture.quizId);
    await page.getByLabel("From", { exact: true }).fill("2026-09-01");
    await page.getByLabel("To", { exact: true }).fill("2026-10-31");
    await expect(collection.getByRole("article")).toHaveCount(1);
    await expect.poll(() => fixture.reads.at(-1)?.query.get("quizId")).toBe(fixture.quizId);
    const dateBoundaries = await page.evaluate(() => ({
      from: new Date("2026-09-01T00:00:00").toISOString(),
      to: new Date("2026-10-31T23:59:59.999").toISOString(),
    }));
    await expect.poll(() => fixture.reads.at(-1)?.query.get("from")).toBe(dateBoundaries.from);
    await expect.poll(() => fixture.reads.at(-1)?.query.get("to")).toBe(dateBoundaries.to);
    await page.getByRole("button", { name: "List view", exact: true }).click();
    await expect(collection).toHaveAttribute("data-view", "list");
    await page.reload();
    await expect(search).toHaveValue("Round evidence 26");
    await expect(collection).toHaveAttribute("data-view", "list");
    await expect(collection.getByRole("article")).toHaveCount(1);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBeNull();
    await expect(page.getByRole("combobox", { name: "Round", exact: true })).toHaveValue("all");
    await expect(page.getByLabel("From", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("");

    await views.getByRole("link", { name: "Practice", exact: true }).click();
    await expect(page).toHaveURL(/\/results\?view=practice$/);
    const practice = page.getByRole("region", {
      name: "Practice assignments and follow-ups",
      exact: true,
    });
    await expect(practice.getByRole("article")).toHaveCount(25);
    await expect(practice).toHaveAttribute("data-view", "list");
    await expect(
      page.getByText("25 practice items shown · More available", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Load More Practice", exact: true }).click();
    await expect(practice.getByRole("article")).toHaveCount(26);
    await expect(page.getByText("26 practice items shown", { exact: true })).toBeVisible();
    const recovery = practice.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Synthetic recovery practice", exact: true }),
    });
    await expect(
      recovery.getByRole("link", { name: "Manage Practice", exact: true }),
    ).toHaveAttribute("href", `/practice/${fixture.followups[0]!.id}`);
    await expect(
      recovery.getByRole("link", { name: "View Source Result", exact: true }),
    ).toHaveAttribute("href", `/report/${fixture.reports[0]!.id}`);
    const practiceStatus = page.getByRole("combobox", { name: "Practice Status", exact: true });
    await expect(practiceStatus.locator("option")).toHaveText([
      "All practice",
      "Scheduled",
      "Open",
      "Closed",
      "Expired",
    ]);
    await practiceStatus.selectOption("closed");
    await expect(practice.getByRole("article")).toHaveCount(1);
    await expect(
      practice.getByRole("heading", { name: "Synthetic assignment practice 25" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search practice", exact: true }).fill("recovery");
    await expect(practice.getByRole("article")).toHaveCount(1);
    await expect(recovery).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();

    await views.getByRole("link", { name: "Presentations", exact: true }).click();
    await expect(page).toHaveURL(/\/results\?view=presentations$/);
    const presentations = page.getByRole("region", { name: "Presentation Results", exact: true });
    await expect(presentations.getByRole("article")).toHaveCount(2);
    await expect(
      page.getByRole("link", { name: "Back to Presentation library", exact: true }),
    ).toHaveAttribute("href", "/library?type=presentations");
    const presentation = presentations.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Synthetic finished Presentation", exact: true }),
    });
    await expect(
      presentation.getByRole("link", { name: "Open Report", exact: true }),
    ).toHaveAttribute("href", `/presentation-session/${fixture.presentations[0]!.id}/report`);
    await expect(
      presentation.getByRole("link", { name: "View Presentation", exact: true }),
    ).toHaveAttribute("href", `/presentation/${fixture.presentations[0]!.presentationId}`);
    const presentationReads = fixture.presentationReadCount();
    await page
      .getByRole("searchbox", { name: "Search Presentation results", exact: true })
      .fill("finished");
    await expect(presentations.getByRole("article")).toHaveCount(1);
    await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("active");
    await expect(page.getByText("No results match these filters.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(presentations.getByRole("article")).toHaveCount(2);
    expect(fixture.presentationReadCount()).toBe(presentationReads);
    await page
      .getByRole("combobox", { name: "Presentation", exact: true })
      .selectOption(fixture.presentations[0]!.presentationId);
    await expect(presentation).toBeVisible();
    await expect(presentations.getByRole("article")).toHaveCount(1);
    await page.getByRole("button", { name: "Grid view", exact: true }).click();
    await expect(presentations).toHaveAttribute("data-view", "grid");
    if (mobile) await page.setViewportSize({ width: 320, height: 844 });
    try {
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
    } catch (error) {
      const overflow = await page.evaluate(() => ({
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        elements: Array.from(document.querySelectorAll("body *"))
          .filter((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            let ancestor: Element | null = element;
            while (ancestor) {
              if (getComputedStyle(ancestor).opacity === "0") return false;
              ancestor = ancestor.parentElement;
            }
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.width > 0 &&
              rect.right > window.innerWidth + 1
            );
          })
          .slice(0, 40)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const parent = element.parentElement;
            return {
              tag: element.tagName,
              className: element.className,
              text: element.textContent?.slice(0, 100),
              left: rect.left,
              right: rect.right,
              width: rect.width,
              minWidth: style.minWidth,
              overflowX: style.overflowX,
              parent: parent
                ? {
                    tag: parent.tagName,
                    className: parent.className,
                    clientWidth: parent.clientWidth,
                    scrollWidth: parent.scrollWidth,
                    overflowX: getComputedStyle(parent).overflowX,
                  }
                : null,
            };
          }),
      }));
      const path = `/tmp/pollingpops-results-overflow-${test.info().project.name}`;
      await writeFile(`${path}.json`, JSON.stringify(overflow, null, 2));
      await page.screenshot({ path: `${path}.png`, fullPage: true });
      throw error;
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `/tmp/pollingpops-results-presentation-${test.info().project.name}.png`,
      fullPage: true,
    });

    // Existing deep links must fall back to Round results when the workspace
    // disables Presentations, without losing access to practice or Survey runs.
    await page.route(`${api}/v1/auth/me`, async (route) => {
      const response = await route.fetch();
      const account = await response.json();
      await route.fulfill({
        response,
        json: { ...account, productFeatures: { ...account.productFeatures, presentations: false } },
      });
    });
    await page.goto("/results?view=presentations");
    await expect(views.getByRole("link", { name: "Presentations", exact: true })).toHaveCount(0);
    await expect(views.getByRole("link", { name: "Rounds", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(collection.getByRole("article")).toHaveCount(25);
    await expect(
      page.getByRole("searchbox", { name: "Search Round results", exact: true }),
    ).toBeVisible();
    await expect(views.getByRole("link", { name: "Practice", exact: true })).toBeVisible();
    await expect(views.getByRole("link", { name: "Surveys", exact: true })).toHaveAttribute(
      "href",
      "/results?view=surveys",
    );
    expect(
      pageErrors.filter(({ message, at }) => {
        const match = message.match(/^\/([^\s]+) due to access control checks\.$/);
        if (!match) return true;
        const key = canceledReadKey(`http://${match[1]}`);
        const times = key ? canceledReads.get(key) : undefined;
        const index = times?.findIndex((time) => Math.abs(time - at) < 1_000) ?? -1;
        if (index < 0) return true;
        // WebKit reports some navigation-canceled fetches as access-control
        // errors. Only consume a matching, confirmed canceled read; genuine
        // CORS and application errors still fail this assertion.
        times!.splice(index, 1);
        return false;
      }),
    ).toEqual([]);
  });
}
