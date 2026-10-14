import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInBeta } from "./sign-in";
import { joinBetaParticipant, joinBetaRound } from "./round-join";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const clientCapabilities = {
  protocolVersion: 3,
  capabilities: [
    "poll.multiselect",
    "response.ranking",
    "response.open_text",
    "response.word_cloud",
  ],
};

for (const suffix of ["desktop", "@mobile"]) {
  test(`ranking polls support top-N and full-order keyboard submission, refresh and reports ${suffix}`, async ({
    page,
    browser,
  }) => {
    test.skip(process.env.BETA_E2E_ROUND_PROTOCOL !== "true", "Opt-in ranking writer test");
    test.setTimeout(90_000);
    await signInBeta(page);
    const created = await page.request.post(`${apiUrl}/v1/quizzes`, {
      data: { title: "Ranking priorities" },
    });
    expect(created.status()).toBe(201);
    const quizId = (await created.json()).quiz.id;
    const questions = ["Choose two priorities", "Rank all priorities"].map((prompt, index) => ({
      id: randomUUID(),
      type: "ranking",
      prompt,
      choices: ["Examples", "Practice", "Discussion"].map((label) => ({
        id: randomUUID(),
        label,
        isCorrect: false,
      })),
      ...(index === 0 ? { rankCount: 2 } : {}),
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      timeLimitSeconds: 300,
      basePoints: 0,
      explanation: "Discuss these priorities together.",
      mediaId: null,
      mediaAlt: null,
    }));
    expect(
      (
        await page.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
          data: { title: "Ranking priorities", description: "", questions },
        })
      ).ok(),
    ).toBeTruthy();
    await page.goto(`/quiz/${quizId}`);
    await page.getByRole("combobox", { name: "Choices to rank", exact: true }).selectOption("3");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page
      .locator(".choice-row")
      .nth(2)
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(page.getByRole("combobox", { name: "Choices to rank", exact: true })).toHaveValue(
      "2",
    );
    await page.getByRole("button", { name: "Add answer", exact: true }).click();
    const save = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === `/v1/quizzes/${quizId}/draft` &&
        response.request().postDataJSON().draft.questions[0].choices[2]?.label === "Discussion",
    );
    await page.getByLabel("Answer 3", { exact: true }).fill("Discussion");
    const saved = await save;
    expect(saved.ok()).toBeTruthy();
    expect(saved.request().postDataJSON().schemaVersion).toBe(3);
    await expect(page.getByText("Saved", { exact: true }).first()).toBeAttached();
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Choices to rank", exact: true })).toHaveValue(
      "2",
    );
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(
      page.getByText("Rank 2 of 3 choices. First is the highest priority.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add Examples to ranking", exact: true }),
    ).toBeDisabled();
    await page.goto(`/quiz/${quizId}`);
    const publication = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/quizzes/${quizId}/publish`,
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    expect((await publication).ok()).toBeTruthy();
    await page.goto(`/host/setup/${quizId}`);
    const creation = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/sessions",
    );
    await page.getByRole("button", { name: "Create live session", exact: true }).click();
    const session = await (await creation).json();
    expect(session.snapshot.roundProtocol).toMatchObject({
      minimumClientVersion: 3,
      requiredCapabilities: ["response.ranking"],
    });
    const published = (await (await page.request.get(`${apiUrl}/v1/quizzes/${quizId}`)).json()).quiz
      .draft.questions;
    const context = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: page.viewportSize()!,
      reducedMotion: "reduce",
    });
    try {
      const guest = await context.newPage();
      await guest.goto(`/join?code=${session.code}`);
      await joinBetaRound(guest);
      await expect(guest).toHaveURL(/\/play\//);
      const popup = page.waitForEvent("popup");
      await page.getByRole("button", { name: "Presenter view", exact: true }).click();
      const presenter = await popup;
      await page.getByRole("button", { name: "Start round", exact: true }).click();
      await expect(guest.getByText("0 of 2 choices ranked.", { exact: true })).toBeVisible();
      const add = async (label: string) => {
        const button = guest.getByRole("button", { name: `Add ${label} to ranking`, exact: true });
        await button.focus();
        await button.press("Enter");
      };
      await add("Examples");
      await add("Practice");
      await expect(
        guest.getByRole("button", { name: "Add Discussion to ranking", exact: true }),
      ).toBeDisabled();
      await guest.getByRole("button", { name: "Move Practice up", exact: true }).focus();
      await guest.getByRole("button", { name: "Move Practice up", exact: true }).press("Enter");
      await expect(guest.locator(".ranking-list li > strong")).toHaveText(["Practice", "Examples"]);
      await expect(guest.getByText("Answer received and saved.", { exact: true })).toHaveCount(0);
      expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
      await guest.getByRole("button", { name: "Submit response", exact: true }).focus();
      await guest.getByRole("button", { name: "Submit response", exact: true }).press("Enter");
      await expect(guest.getByText("Answer received and saved.", { exact: true })).toBeVisible();
      await guest.reload();
      await expect(guest.getByText("Answer received and saved.", { exact: true })).toBeVisible();
      await expect(guest.locator(".ranking-list li > strong")).toHaveText(["Practice", "Examples"]);
      await expect(
        guest.getByRole("button", { name: "Move Examples up", exact: true }),
      ).toBeDisabled();
      await guest.screenshot({
        path: `/tmp/pollingpops-ranking-participant-${test.info().project.name}.png`,
        fullPage: true,
      });
      const participants: string[] = [];
      for (let index = 0; index < 4; index++) {
        const join = await joinBetaParticipant(context.request, apiUrl, {
          code: session.code,
          nickname: `Ranking guest ${index}`,
          clientCapabilities,
        });
        expect(join.status()).toBe(201);
        const admitted = await join.json();
        participants.push(admitted.participantToken);
        const response = await context.request.post(
          `${apiUrl}/v1/sessions/${session.sessionId}/answers`,
          {
            headers: { authorization: `Bearer ${admitted.participantToken}` },
            data: {
              roundId: admitted.snapshot.roundId,
              response: {
                kind: "ranking",
                choiceIds: [published[0].choices[1].id, published[0].choices[0].id],
              },
              idempotencyKey: randomUUID(),
              clientCapabilities,
            },
          },
        );
        expect(response.ok()).toBeTruthy();
      }
      await page.getByRole("button", { name: "Lock answers", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "Post-lock response distribution", exact: true }),
      ).toContainText("5 respondents · each ranked 2 choices.");
      await expect(presenter.getByRole("table")).toContainText("Weighted score");
      await page.screenshot({
        path: `/tmp/pollingpops-ranking-host-results-${test.info().project.name}.png`,
        fullPage: true,
      });
      await page
        .getByRole("region", { name: "Post-lock response distribution", exact: true })
        .screenshot({
          path: `/tmp/pollingpops-ranking-distribution-${test.info().project.name}.png`,
        });
      await page.getByRole("button", { name: "Reveal answer", exact: true }).click();
      await expect(guest.getByText("Correct", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Next question", exact: true }).click();
      await expect(
        guest.getByRole("heading", { name: "Rank all priorities", exact: true }),
      ).toBeVisible();
      await expect(guest.locator(".ranking-list li > strong")).toHaveText([
        "Examples",
        "Practice",
        "Discussion",
      ]);
      await expect(guest.getByText("Answer received and saved.", { exact: true })).toHaveCount(0);
      await guest.getByRole("button", { name: "Move Examples down", exact: true }).focus();
      await guest.getByRole("button", { name: "Move Examples down", exact: true }).press("Enter");
      await expect(guest.locator(".ranking-list li > strong")).toHaveText([
        "Practice",
        "Examples",
        "Discussion",
      ]);
      await guest.getByRole("button", { name: "Submit response", exact: true }).click();
      await expect(guest.getByText("Answer received and saved.", { exact: true })).toBeVisible();
      for (const token of participants) {
        const headers = { authorization: `Bearer ${token}` };
        const snapshot = (
          await (
            await context.request.get(
              `${apiUrl}/v1/sessions/${session.sessionId}/snapshot?clientCapabilities=${encodeURIComponent(JSON.stringify(clientCapabilities))}`,
              { headers },
            )
          ).json()
        ).snapshot;
        const response = await context.request.post(
          `${apiUrl}/v1/sessions/${session.sessionId}/answers`,
          {
            headers,
            data: {
              roundId: snapshot.roundId,
              response: {
                kind: "ranking",
                choiceIds: [
                  published[1].choices[1].id,
                  published[1].choices[0].id,
                  published[1].choices[2].id,
                ],
              },
              idempotencyKey: randomUUID(),
              clientCapabilities,
            },
          },
        );
        expect(response.ok()).toBeTruthy();
      }
      await page.getByRole("button", { name: "Lock answers", exact: true }).click();
      await page.getByRole("button", { name: "Reveal answer", exact: true }).click();
      await page.getByRole("button", { name: "Finish round", exact: true }).click();
      await page
        .getByTestId("host-command-bar")
        .getByRole("link", { name: "Open report", exact: true })
        .click();
      await page.getByRole("tab", { name: "Questions", exact: true }).click();
      const topN = page.getByRole("row").filter({ hasText: "Choose two priorities" });
      await expect(topN).toContainText("Not scored");
      await topN.getByText("5 respondents", { exact: true }).click();
      await expect(topN).toContainText("First place earns 3 points");
      await expect(
        topN
          .getByRole("row")
          .filter({ has: page.getByRole("rowheader", { name: "Practice", exact: true }) }),
      ).toContainText("15");
      await expect(
        topN
          .getByRole("row")
          .filter({ has: page.getByRole("rowheader", { name: "Examples", exact: true }) }),
      ).toContainText("10");
      await expect(
        topN
          .getByRole("row")
          .filter({ has: page.getByRole("rowheader", { name: "Discussion", exact: true }) }),
      ).toContainText("—");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await presenter.close();
    } finally {
      await context.close();
    }
  });
}
