import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { SurveyDraftSchema } from "../../packages/contracts/src/surveys";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

interface Question {
  id: string;
  type: "poll" | "rating";
  prompt: string;
  min?: number;
  choices?: Array<{ id: string; label: string }>;
}

async function createSurveyRuns(page: Page, guests: APIRequestContext) {
  const title = `Synthetic Survey outcomes ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post(`${api}/v1/surveys`, {
    data: { title, templateId: "training-feedback", idempotencyKey: randomUUID() },
  });
  expect(created.status()).toBe(201);
  const survey = (await created.json()).survey;
  const draft = SurveyDraftSchema.parse({ ...survey.draft, title });
  for (const { question } of draft.items) {
    question.prompt = "Which support would make the next session useful?";
    if (question.type === "poll") question.choices[0]!.label = "FollowupSupport".repeat(8);
  }
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
  let questions: Question[] = [];

  async function run(submissions: number, closed: boolean) {
    const createdRoom = await page.request.post(`${api}/v1/surveys/${survey.id}/rooms`, {
      data: { expectedRevision: revision, idempotencyKey: randomUUID(), windowDays: 7 },
    });
    expect(createdRoom.status()).toBe(201);
    const room = (await createdRoom.json()).room as { id: string; code: string };
    for (let index = 0; index < submissions; index++) {
      const headers = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
      const admitted = await guests.post(`${api}/v1/survey-rooms/join`, {
        headers,
        data: { code: room.code },
      });
      expect(admitted.status()).toBe(200);
      questions = (await admitted.json()).attempt.content.items.map(
        (item: { question: Question }) => item.question,
      );
      const responses = Object.fromEntries(
        questions.map((question) => [
          question.id,
          question.type === "poll"
            ? { kind: "poll", choiceIds: [question.choices![0]!.id] }
            : { kind: "rating", value: question.min ?? 1 },
        ]),
      );
      const submitted = await guests.post(`${api}/v1/survey-rooms/${room.id}/submit`, {
        headers,
        data: { idempotencyKey: randomUUID(), expectedRevision: 0, responses },
      });
      expect(submitted.status()).toBe(200);
    }
    if (closed)
      expect(
        (
          await page.request.post(`${api}/v1/survey-rooms/${room.id}/close`, {
            data: { idempotencyKey: randomUUID() },
          })
        ).status(),
      ).toBe(204);
    return room;
  }

  const ready = await run(5, true);
  const small = await run(2, true);
  const collecting = await run(0, false);
  return { title, surveyId: survey.id as string, ready, small, collecting, questions };
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

    await page.setViewportSize({ width: 320, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath("survey-results-list-dark-320.png"),
      fullPage: true,
    });
    await results.locator(`a[href="/results/surveys/${fixture.ready.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/results/surveys/${fixture.ready.id}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: fixture.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("5 finalized submissions. Only finalized responses are counted.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(fixture.questions.length);
    for (const [index, question] of fixture.questions.entries())
      await expect(
        page.getByRole("region", {
          name: `Question ${index + 1} results: ${question.prompt}`,
          exact: true,
        }),
      ).toBeVisible();
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
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath("survey-results-report-dark-320.png"),
      fullPage: true,
    });
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
    await page.goto(`/results/surveys/${fixture.collecting.id}`);
    await expect(
      page.getByRole("heading", { name: "Collecting responses", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Distributions stay hidden while this Survey is open\./),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Share summary", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Manage Survey run", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/surveys/rooms/${fixture.collecting.id}$`));
    await expect(
      page.getByRole("button", { name: "Close admissions and submissions", exact: true }),
    ).toBeVisible();
  });
}
