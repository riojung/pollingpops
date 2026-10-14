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
  test(`live multiple-selection poll supports authoring, keyboard submission and saved sets ${suffix}`, async ({
    page,
    browser,
  }) => {
    test.skip(process.env.BETA_E2E_ROUND_PROTOCOL !== "true", "Opt-in live poll writer test");
    test.setTimeout(90_000);
    await signInBeta(page);
    const created = await page.request.post(`${apiUrl}/v1/quizzes`, {
      data: { title: "Live priorities" },
    });
    expect(created.status()).toBe(201);
    const quizId = (await created.json()).quiz.id;
    const choices = ["Examples", "Practice", "Discussion"].map((label) => ({
      id: randomUUID(),
      label,
      isCorrect: false,
    }));
    expect(
      (
        await page.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
          data: {
            title: "Live priorities",
            description: "",
            questions: [
              {
                id: randomUUID(),
                type: "poll",
                prompt: "Which support would help?",
                choices,
                purpose: "opinion",
                confidence: "off",
                timeLimitSeconds: 300,
                basePoints: 0,
                explanation: "Discuss the priorities together.",
                mediaId: null,
                mediaAlt: null,
              },
            ],
          },
        })
      ).ok(),
    ).toBeTruthy();
    await page.goto(`/quiz/${quizId}`);
    await page.getByRole("combobox", { name: "Maximum selections", exact: true }).selectOption("3");
    await page
      .locator(".choice-row")
      .nth(2)
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Maximum selections", exact: true }),
    ).toHaveValue("2");
    await page.getByRole("button", { name: "Add answer", exact: true }).click();
    await page.getByLabel("Answer 3", { exact: true }).fill("Discussion");
    await expect(page.getByText("Saved", { exact: true }).first()).toBeAttached();
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Maximum selections", exact: true }),
    ).toHaveValue("2");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Examples", exact: true })).toBeDisabled();
    await expect(
      page.getByText("Select up to 2 options. 0 selected.", { exact: true }),
    ).toBeVisible();
    await page.goto(`/quiz/${quizId}`);
    const publication = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/quizzes/${quizId}/publish`,
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    expect((await publication).ok()).toBeTruthy();
    await page.goto(`/host/setup/${quizId}`);
    const sessionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/sessions",
    );
    await page.getByRole("button", { name: "Create live session", exact: true }).click();
    const session = await (await sessionResponse).json();
    expect(session.snapshot.roundProtocol).toMatchObject({
      minimumClientVersion: 3,
      requiredCapabilities: ["poll.multiselect"],
    });
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
      const first = guest.getByRole("checkbox", { name: "Examples", exact: true });
      const second = guest.getByRole("checkbox", { name: "Practice", exact: true });
      const third = guest.getByRole("checkbox", { name: "Discussion", exact: true });
      await first.focus();
      await first.press("Space");
      await second.focus();
      await second.press("Space");
      await expect(first).toBeChecked();
      await expect(second).toBeChecked();
      await expect(third).toBeDisabled();
      await expect(guest.getByText("Answer received and saved.", { exact: true })).toHaveCount(0);
      await first.press("Space");
      await expect(third).toBeEnabled();
      await first.press("Space");
      expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
      await guest.getByRole("button", { name: "Submit response", exact: true }).focus();
      await guest.getByRole("button", { name: "Submit response", exact: true }).press("Enter");
      await expect(guest.getByText("Answer received and saved.", { exact: true })).toBeVisible();
      await guest.reload();
      await expect(guest.getByText("Answer received and saved.", { exact: true })).toBeVisible();
      await expect(first).toBeChecked();
      await expect(second).toBeChecked();
      await expect(first).toBeDisabled();
      await expect(second).toBeDisabled();
      const published = (await (await page.request.get(`${apiUrl}/v1/quizzes/${quizId}`)).json())
        .quiz;
      const liveChoices = published.draft.questions[0].choices;
      for (let index = 0; index < 4; index++) {
        const join = await joinBetaParticipant(context.request, apiUrl, {
          code: session.code,
          nickname: `Poll guest ${index}`,
          clientCapabilities,
        });
        expect(join.status()).toBe(201);
        const admitted = await join.json();
        const answer = await context.request.post(
          `${apiUrl}/v1/sessions/${session.sessionId}/answers`,
          {
            headers: { authorization: `Bearer ${admitted.participantToken}` },
            data: {
              roundId: admitted.snapshot.roundId,
              response: {
                kind: "poll",
                choiceIds: liveChoices.slice(0, 2).map((choice: { id: string }) => choice.id),
              },
              idempotencyKey: randomUUID(),
              clientCapabilities,
            },
          },
        );
        expect(answer.ok()).toBeTruthy();
      }
      await page.getByRole("button", { name: "Lock answers", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "Post-lock response distribution", exact: true }),
      ).toContainText("5 respondents");
      await expect(
        presenter.getByRole("region", { name: "Post-lock response distribution", exact: true }),
      ).toContainText("percent of respondents");
      await page.getByRole("button", { name: "Reveal answer", exact: true }).click();
      await expect(guest.getByText("Correct", { exact: true })).toHaveCount(0);
      await expect(guest.getByText("Incorrect", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Finish round", exact: true }).click();
      await page
        .getByTestId("host-command-bar")
        .getByRole("link", { name: "Open report", exact: true })
        .click();
      await page.getByRole("tab", { name: "Questions", exact: true }).click();
      await expect(
        page.getByRole("row").filter({ hasText: "Which support would help?" }),
      ).toContainText("Not scored");
      await page.getByText("5 respondents", { exact: true }).click();
      await expect(page.getByText(/100% of respondents/).first()).toBeVisible();
      await presenter.close();
    } finally {
      await context.close();
    }
  });
}
