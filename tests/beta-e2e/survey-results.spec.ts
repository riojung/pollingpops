import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { SurveyDraftSchema, type SurveyResponses } from "../../packages/contracts/src/surveys";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

async function closeRun(page: Page, id: string) {
  const closed = await page.request.post(`${api}/v1/survey-rooms/${id}/close`, {
    data: { idempotencyKey: randomUUID() },
  });
  expect(closed.status()).toBe(204);
}

async function createSurveyRuns(page: Page, guests: APIRequestContext) {
  const title = `Synthetic Survey outcomes ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post(`${api}/v1/surveys`, {
    data: { title, templateId: "training-feedback", idempotencyKey: randomUUID() },
  });
  expect(created.status()).toBe(201);
  const survey = (await created.json()).survey;
  const draft = SurveyDraftSchema.parse({ ...survey.draft, title });
  const poll = draft.items[0]?.question;
  const rating = draft.items[1]?.question;
  if (poll?.type !== "poll" || rating?.type !== "rating")
    throw new Error("Expected the training feedback template to begin with a poll and rating");
  poll.prompt = "Which support would make the next session useful?";
  poll.maxSelections = 2;
  const firstChoice = poll.choices[0]!;
  const secondChoice = poll.choices[1]!;
  firstChoice.label = "FollowupSupport".repeat(8);
  const suppressed = { ...rating, id: randomUUID(), prompt: "How useful was the optional demo?" };
  draft.items = [
    { required: false, question: poll },
    { required: false, question: suppressed },
    { required: true, question: rating },
  ];
  const saved = await page.request.put(`${api}/v1/surveys/${survey.id}`, {
    data: {
      draft,
      expectedRevision: survey.revision,
      idempotencyKey: randomUUID(),
    },
  });
  expect(saved.status()).toBe(200);
  const published = await page.request.post(`${api}/v1/surveys/${survey.id}/publish`, {
    data: {
      expectedRevision: (await saved.json()).survey.revision,
      idempotencyKey: randomUUID(),
    },
  });
  expect(published.status()).toBe(200);
  const revision = (await published.json()).survey.revision;
  const ratings = [1, 2, 2, 3, 3, 4];
  const pollSelections = [
    [firstChoice.id],
    [firstChoice.id, secondChoice.id],
    [firstChoice.id, secondChoice.id],
    [secondChoice.id],
    [secondChoice.id],
    [],
  ];

  const run = async (submissions: number) => {
    const createdRoom = await page.request.post(`${api}/v1/surveys/${survey.id}/rooms`, {
      data: { expectedRevision: revision, idempotencyKey: randomUUID(), windowDays: 7 },
    });
    expect(createdRoom.status()).toBe(201);
    const room = (await createdRoom.json()).room as { id: string; code: string };
    for (const [index, value] of ratings.slice(0, submissions).entries()) {
      const headers = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
      const admitted = await guests.post(`${api}/v1/survey-rooms/join`, {
        headers,
        data: { code: room.code },
      });
      expect(admitted.status()).toBe(200);
      const responses: SurveyResponses = { [rating.id]: { kind: "rating", value } };
      const choiceIds = pollSelections[index]!;
      if (choiceIds.length) responses[poll.id] = { kind: "poll", choiceIds };
      if (index < 4) responses[suppressed.id] = { kind: "rating", value };
      const submitted = await guests.post(`${api}/v1/survey-rooms/${room.id}/submit`, {
        headers,
        data: { idempotencyKey: randomUUID(), expectedRevision: 0, responses },
      });
      expect(submitted.status()).toBe(200);
    }
    return room;
  };

  const ready = await run(ratings.length);
  const small = await run(1);
  await closeRun(page, small.id);
  const collecting = await run(0);
  return {
    title,
    surveyId: survey.id as string,
    ready,
    small,
    collecting,
    poll,
    rating,
    suppressed,
  };
}

for (const mobile of [false, true]) {
  test(`${mobile ? "@mobile " : ""}Survey outcomes open directly in Results with privacy and run management kept separate`, async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(15_000);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await signInBeta(page);
    await page.waitForLoadState("networkidle");
    const fixture = await createSurveyRuns(page, request);
    const sessionVisits: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && new URL(frame.url()).pathname === "/sessions")
        sessionVisits.push(frame.url());
    });
    const analytics = page.getByRole("region", { name: "Survey analytics", exact: true });
    const submissions = page.getByText(
      "6 finalized submissions. Only finalized responses are counted.",
      { exact: true },
    );

    await page.goto(`/results/surveys/${fixture.ready.id}`);
    await expect(
      page.getByRole("heading", { name: "Collecting responses", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Distributions stay hidden while this Survey is open\./),
    ).toBeVisible();
    await expect(submissions).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(analytics).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Share summary", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Manage Survey run", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/surveys/rooms/${fixture.ready.id}$`));
    await expect(
      page.getByRole("button", { name: "Close admissions and submissions", exact: true }),
    ).toBeVisible();
    await closeRun(page, fixture.ready.id);

    await page.goto(`/results?view=surveys&q=${encodeURIComponent(fixture.title)}`);
    const tabs = page.getByRole("navigation", { name: "Evidence views" });
    await expect(tabs.getByRole("link", { name: "Surveys", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("searchbox", { name: "Search Survey results" })).toHaveValue(
      fixture.title,
    );
    await expect(
      page.getByRole("link", { name: "Back to Survey library", exact: true }),
    ).toHaveAttribute("href", "/library?type=surveys");
    const results = page.getByRole("region", { name: "Survey results", exact: true });
    await expect(results.getByRole("article")).toHaveCount(2);
    await expect(
      results.locator(`a[href="/results/surveys/${fixture.collecting.id}"]`),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "List view", exact: true }).click();
    await expect(results).toHaveAttribute("data-view", "list");
    await page.reload();
    await expect(results).toHaveAttribute("data-view", "list");
    await expect(results.getByRole("article")).toHaveCount(2);
    await page
      .getByRole("combobox", { name: "Survey", exact: true })
      .selectOption(fixture.surveyId);
    await expect(results.getByRole("article")).toHaveCount(2);
    await page.getByRole("searchbox", { name: "Search Survey results" }).fill(fixture.ready.code);
    await expect(results.getByRole("article")).toHaveCount(1);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search Survey results" }).fill(fixture.title);
    await expect(results.getByRole("article")).toHaveCount(2);

    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 320, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath("survey-results-list-dark-320.png"),
      fullPage: true,
    });
    await page.setViewportSize(viewport);
    await results.locator(`a[href="/results/surveys/${fixture.ready.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/results/surveys/${fixture.ready.id}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: fixture.title, exact: true }),
    ).toBeVisible();
    await expect(submissions).toBeVisible();
    await expect(analytics).toBeVisible();
    for (const [label, value] of [
      ["Finalized submissions", "6"],
      ["Questions with results", "2 of 3"],
    ] as const) {
      const term = analytics.getByText(label, { exact: true });
      await expect(term).toBeVisible();
      await expect(term.locator("..").getByRole("definition")).toHaveText(value);
    }
    const coverage = analytics.getByRole("heading", { name: "Question coverage", exact: true });
    await expect(coverage).toBeVisible();
    await expect(
      analytics.getByText("Share of finalized submissions that answered each question.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(analytics.getByRole("link")).toHaveCount(2);
    const pollHeading = page.getByRole("heading", { name: fixture.poll.prompt, exact: true });
    const ratingHeading = page.getByRole("heading", { name: fixture.rating.prompt, exact: true });
    const pollLinkName = `Question 1 · ${fixture.poll.prompt}`;
    const ratingLinkName = `Question 3 · ${fixture.rating.prompt}`;
    await expect(analytics.getByRole("listitem")).toHaveCount(2);
    for (const [linkName, heading, question, count, share] of [
      [pollLinkName, pollHeading, fixture.poll, "5 of 6 finalized submissions", "83.3%"],
      [ratingLinkName, ratingHeading, fixture.rating, "6 of 6 finalized submissions", "100%"],
    ] as const) {
      const row = analytics.getByRole("listitem").filter({
        has: page.getByRole("link", { name: linkName, exact: true }),
      });
      await expect(row.getByRole("link", { name: linkName, exact: true })).toHaveAttribute(
        "href",
        `#survey-question-${question.id}`,
      );
      await expect(heading).toHaveAttribute("id", `survey-question-${question.id}`);
      await expect(row.getByText(count, { exact: true })).toBeVisible();
      await expect(row.getByText(share, { exact: true })).toBeVisible();
    }
    await expect(analytics.getByText(fixture.suppressed.prompt)).toHaveCount(0);
    const suppressedHeading = page.getByRole("heading", {
      name: fixture.suppressed.prompt,
      exact: true,
    });
    await expect(suppressedHeading).toBeVisible();
    const suppressedQuestion = suppressedHeading.locator("..");
    await expect(
      suppressedQuestion.getByText(
        "Distributions are hidden because this question has fewer than five responses.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(suppressedQuestion.getByRole("table")).toHaveCount(0);
    await expect(suppressedQuestion.getByText("4 responses", { exact: true })).toHaveCount(0);
    await expect(suppressedQuestion.getByText("Average rating", { exact: true })).toHaveCount(0);

    await expect(page.getByRole("table")).toHaveCount(2);
    const pollResults = page.getByRole("region", {
      name: `Question 1 results: ${fixture.poll.prompt}`,
      exact: true,
    });
    const ratingResults = page.getByRole("region", {
      name: `Question 3 results: ${fixture.rating.prompt}`,
      exact: true,
    });
    for (const distribution of [pollResults, ratingResults]) {
      await expect(distribution).toBeVisible();
      await expect(distribution.getByRole("table")).toHaveAccessibleName("Response counts");
      await expect(
        distribution.getByRole("columnheader", { name: "Count", exact: true }),
      ).toBeVisible();
      await expect(
        distribution.getByRole("columnheader", {
          name: "Share of question respondents",
          exact: true,
        }),
      ).toBeVisible();
    }
    for (const [choice, count, share] of [
      [fixture.poll.choices[0]!, "3", "60%"],
      [fixture.poll.choices[1]!, "4", "80%"],
    ] as const) {
      const row = pollResults.getByRole("row").filter({
        has: page.getByRole("rowheader", { name: choice.label, exact: true }),
      });
      await expect(row.getByRole("cell")).toHaveText([count, share]);
    }
    await expect(pollHeading.locator("..").getByText("5 responses", { exact: true })).toBeVisible();
    await expect(
      pollHeading.locator("..").getByText(/Multiple selections allowed\./),
    ).toBeVisible();
    const ratingQuestion = ratingHeading.locator("..");
    await expect(ratingQuestion.getByText("6 responses", { exact: true })).toBeVisible();
    const average = ratingQuestion.getByText("Average rating", { exact: true });
    await expect(average).toBeVisible();
    await expect(average.locator("..").getByRole("definition")).toHaveText("2.5");
    const smallestRating = ratingResults.getByRole("row").filter({
      has: page.getByRole("rowheader", { name: "1", exact: true }),
    });
    await expect(smallestRating.getByRole("cell")).toHaveText(["1", "16.7%"]);
    await expect(
      page.getByRole("button", { name: "Close admissions and submissions", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete survey run", exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole("img", { name: /QR code/ })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Manage Survey run", exact: true }),
    ).toHaveAttribute("href", `/surveys/rooms/${fixture.ready.id}`);
    await expect(
      page.getByRole("link", { name: "Back to Survey results", exact: true }),
    ).toHaveAttribute("href", "/results?view=surveys");
    expect(sessionVisits).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath(`survey-analytics-report-dark-${viewport.width}.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await expect(coverage).toBeVisible();
    await expect(average).toBeVisible();
    await expect(
      pollResults.getByRole("columnheader", { name: "Share of question respondents", exact: true }),
    ).toBeVisible();
    await expect(
      pollResults.getByRole("rowheader", { name: fixture.poll.choices[0]!.label, exact: true }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath("survey-results-report-dark-320.png"),
      fullPage: true,
    });
    await analytics.getByRole("link", { name: pollLinkName, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#survey-question-${fixture.poll.id}$`));
    if (process.env.BETA_E2E_SESSION_SUMMARIES === "true") {
      await page.getByRole("button", { name: "Share summary", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Share summary", exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
    }

    await page.goto(`/results/surveys/${fixture.small.id}`);
    await expect(
      page.getByText("Distributions are hidden because fewer than five respondents submitted.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(analytics).toHaveCount(0);
  });
}
