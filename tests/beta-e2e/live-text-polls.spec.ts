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
const capabilitiesQuery = encodeURIComponent(JSON.stringify(clientCapabilities));

for (const suffix of ["desktop", "@mobile"]) {
  test(`moderated text and word clouds protect pending responses and refresh approved results ${suffix}`, async ({
    page,
    browser,
  }) => {
    test.skip(process.env.BETA_E2E_ROUND_PROTOCOL !== "true", "Opt-in text writer test");
    test.setTimeout(120_000);
    await signInBeta(page);
    const created = await page.request.post(`${apiUrl}/v1/quizzes`, {
      data: { title: "Moderated reflections" },
    });
    expect(created.status()).toBe(201);
    const quizId = (await created.json()).quiz.id;
    const questions = (["open_text", "word_cloud"] as const).map((type) => ({
      id: randomUUID(),
      type,
      prompt: type === "open_text" ? "Explain your priority" : "Share a word",
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      timeLimitSeconds: 300,
      basePoints: 0,
      explanation: "Reviewed before sharing.",
      mediaId: null,
      mediaAlt: null,
    }));
    expect(
      (
        await page.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
          data: { title: "Moderated reflections", description: "", questions },
        })
      ).ok(),
    ).toBeTruthy();
    await page.goto(`/quiz/${quizId}`);
    const save = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === `/v1/quizzes/${quizId}/draft` &&
        response.request().postDataJSON().draft.questions[0].prompt === "Explain one priority",
    );
    await page.getByLabel("Question prompt", { exact: true }).fill("Explain one priority");
    expect((await save).request().postDataJSON().schemaVersion).toBe(4);
    await expect(page.getByText("Saved", { exact: true }).first()).toBeAttached();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.waitForURL(`**/quiz/${quizId}/preview`, { waitUntil: "load" });
    await expect(page.getByLabel("Your response", { exact: true })).toBeDisabled();
    await page.goto(`/quiz/${quizId}`);
    const publication = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/quizzes/${quizId}/publish`,
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    expect((await publication).ok()).toBeTruthy();
    await page.goto(`/host/setup/${quizId}`);
    await expect(
      page.getByText("Rounds with text or word-cloud polls support up to 250 participants.", {
        exact: true,
      }),
    ).toBeVisible();
    const creation = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/sessions",
    );
    await page.getByRole("button", { name: "Create live session", exact: true }).click();
    const session = await (await creation).json();
    expect(session.snapshot.roundProtocol.requiredCapabilities).toEqual([
      "response.open_text",
      "response.word_cloud",
    ]);
    const context = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: page.viewportSize()!,
      reducedMotion: "reduce",
    });
    try {
      const guest = await context.newPage();
      await guest.goto(`/join?code=${session.code}`);
      const guestAdmission = await joinBetaRound(guest);
      const firstToken = (await guestAdmission.json()).participantToken;
      await expect(guest).toHaveURL(/\/play\//);
      const tokens = [firstToken];
      for (let index = 1; index < 7; index++) {
        const joined = await joinBetaParticipant(context.request, apiUrl, {
          code: session.code,
          nickname: `Text guest ${index}`,
          clientCapabilities,
        });
        expect(joined.status()).toBe(201);
        tokens.push((await joined.json()).participantToken);
      }
      const popup = page.waitForEvent("popup");
      await page.getByRole("button", { name: "Presenter view", exact: true }).click();
      const presenter = await popup;
      const privateText = "PRIVATE_PENDING_BODY — <script>plain text</script>";
      let snapshotLeaked = false;
      for (const target of [page, guest, presenter])
        target.on("websocket", (socket) =>
          socket.on("framereceived", ({ payload }) => {
            if (String(payload).includes(privateText)) snapshotLeaked = true;
          }),
        );
      await page.getByRole("button", { name: "Start round", exact: true }).click();
      const input = guest.getByLabel("Your response", { exact: true });
      await input.fill("   ");
      await guest.getByRole("button", { name: "Submit response", exact: true }).click();
      await expect(
        guest.getByText("Enter a response before submitting.", { exact: true }),
      ).toBeVisible();
      await input.fill("a".repeat(1001));
      await guest.getByRole("button", { name: "Submit response", exact: true }).click();
      await expect(guest.getByText("Use up to 1000 characters.", { exact: true })).toBeVisible();
      await input.fill("valid\u0001control");
      await guest.getByRole("button", { name: "Submit response", exact: true }).click();
      await expect(
        guest.getByText("Remove unsupported control characters from your response.", {
          exact: true,
        }),
      ).toBeVisible();
      await input.fill(privateText);
      expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
      await guest.getByRole("button", { name: "Submit response", exact: true }).focus();
      await guest.getByRole("button", { name: "Submit response", exact: true }).press("Enter");
      await expect(
        guest.getByText("Response saved and waiting for facilitator review.", { exact: true }),
      ).toBeVisible();
      await expect(input).toHaveCount(0);
      expect(
        await guest.evaluate(
          (body) =>
            JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(
              body,
            ),
          privateText,
        ),
      ).toBe(false);
      await guest.reload();
      await expect(
        guest.getByText("Response saved and waiting for facilitator review.", { exact: true }),
      ).toBeVisible();
      await expect(guest.getByText(privateText, { exact: true })).toHaveCount(0);
      await guest.screenshot({
        path: `/tmp/pollingpops-text-participant-${test.info().project.name}.png`,
        fullPage: true,
      });
      const snapshot = async (token: string) => {
        const response = await context.request.get(
          `${apiUrl}/v1/sessions/${session.sessionId}/snapshot?clientCapabilities=${capabilitiesQuery}`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        expect(response.ok()).toBeTruthy();
        const payload = await response.json();
        expect(JSON.stringify(payload)).not.toContain(privateText);
        return payload.snapshot;
      };
      expect(await snapshot(firstToken)).toMatchObject({
        myResponse: null,
        myResponseAccepted: true,
        myResponseModerationStatus: "pending",
      });
      const submit = async (token: string, value: string) => {
        const current = await snapshot(token);
        const response = await context.request.post(
          `${apiUrl}/v1/sessions/${session.sessionId}/answers`,
          {
            headers: { authorization: `Bearer ${token}` },
            data: {
              roundId: current.roundId,
              response: { kind: "text", value },
              idempotencyKey: randomUUID(),
              clientCapabilities,
            },
          },
        );
        expect(response.ok()).toBeTruthy();
      };
      const bodies = [
        privateText,
        "Examples help",
        "Practice helps",
        "Clear pacing",
        "Discussion helps",
        "Another approved idea",
        "UNAPPROVED_SECRET",
      ];
      for (let index = 1; index < tokens.length; index++)
        await submit(tokens[index]!, bodies[index]!);
      const moderation = page.getByRole("region", {
        name: "Text response moderation",
        exact: true,
      });
      await expect(moderation.getByText(privateText, { exact: true })).toBeVisible();
      await moderation
        .locator("li")
        .first()
        .evaluate((element) =>
          window.scrollBy({ top: element.getBoundingClientRect().top - 180, behavior: "instant" }),
        );
      await moderation
        .locator("li")
        .first()
        .getByRole("button", { name: "Approve response", exact: true })
        .click({ trial: true });
      await moderation
        .locator("li")
        .first()
        .screenshot({ path: `/tmp/pollingpops-text-moderation-${test.info().project.name}.png` });
      await expect
        .poll(() =>
          moderation.evaluate((element) => {
            const stage = element.closest('[data-testid="host-stage"]');
            if (!(stage instanceof HTMLElement)) return false;
            const style = getComputedStyle(stage);
            const available =
              stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            return element.getBoundingClientRect().width >= available * 0.95;
          }),
        )
        .toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .include('section[aria-label="Text response moderation"]')
            .analyze()
        ).violations,
      ).toEqual([]);
      for (let index = 7; index < 13; index++) {
        const joined = await joinBetaParticipant(context.request, apiUrl, {
          code: session.code,
          nickname: `Queue guest ${index}`,
          clientCapabilities,
        });
        expect(joined.status()).toBe(201);
        await submit((await joined.json()).participantToken, `Queued idea ${index}`);
      }
      await expect(moderation.locator("li")).toHaveCount(10);
      await moderation.getByRole("button", { name: "Next page", exact: true }).click();
      await expect(moderation.locator("li")).toHaveCount(3);
      await expect(moderation.getByText(privateText, { exact: true })).toHaveCount(0);
      await moderation.getByRole("button", { name: "Previous page", exact: true }).click();
      await expect(moderation.locator("li")).toHaveCount(10);
      const moderate = async (body: string, responseStatus: "approved" | "removed") => {
        const queue = await context.request.get(
          `${apiUrl}/v1/sessions/${session.sessionId}/response-moderation?status=${responseStatus === "removed" ? "approved" : "pending"}&clientCapabilities=${capabilitiesQuery}`,
          { headers: { authorization: `Bearer ${session.hostToken}` } },
        );
        expect(queue.ok()).toBeTruthy();
        const data = await queue.json();
        const item = data.items.find((candidate: { body: string }) => candidate.body === body);
        expect(item).toBeTruthy();
        const response = await context.request.post(
          `${apiUrl}/v1/sessions/${session.sessionId}/commands`,
          {
            headers: { authorization: `Bearer ${session.hostToken}` },
            data: {
              action: "response.moderate",
              answerId: item.answerId,
              responseStatus,
              expectedVersion: data.version,
              commandId: randomUUID(),
              clientCapabilities,
            },
          },
        );
        expect(response.ok()).toBeTruthy();
      };
      // First approval exercises the real host intent command; other respondents use independent API clients.
      await moderation
        .locator("li")
        .filter({ hasText: privateText })
        .getByRole("button", { name: "Approve response", exact: true })
        .click();
      await expect(guest.getByText("Response saved and approved.", { exact: true })).toBeVisible();
      for (let index = 1; index < 4; index++) await moderate(bodies[index]!, "approved");
      await page.getByRole("button", { name: "Lock answers", exact: true }).click();
      await page.getByRole("button", { name: "Reveal answer", exact: true }).click();
      const publicGuest = guest.getByRole("region", { name: "Approved responses", exact: true });
      const publicPresenter = presenter.getByRole("region", {
        name: "Approved responses",
        exact: true,
      });
      await expect(publicGuest).toContainText("at least five approved respondents");
      await expect(publicGuest.getByText(privateText, { exact: true })).toHaveCount(0);
      await moderate(bodies[4]!, "approved");
      await expect(publicGuest.getByText(privateText, { exact: true })).toBeVisible();
      await expect(publicPresenter.getByText(privateText, { exact: true })).toBeVisible();
      await expect(publicGuest.locator("script")).toHaveCount(0);
      await context.setOffline(true);
      await expect(publicGuest.getByText(privateText, { exact: true })).toHaveCount(0);
      await expect(publicGuest).toContainText("Reconnect to refresh responses.");
      await context.setOffline(false);
      await expect(publicGuest.getByText(privateText, { exact: true })).toBeVisible();
      const resultsRoute = new RegExp(`/v1/sessions/${session.sessionId}/response-results\\?`);
      await guest.route(resultsRoute, (route) =>
        route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            error: { message: "Response access expired.", code: "UNAUTHORIZED" },
          }),
        }),
      );
      await moderate(privateText, "removed");
      await expect(publicGuest.getByText(privateText, { exact: true })).toHaveCount(0);
      await expect(publicPresenter.getByText(privateText, { exact: true })).toHaveCount(0);
      await expect(publicGuest).toContainText("Response access expired.");
      await guest.unroute(resultsRoute);
      await publicGuest.getByRole("button", { name: "Refresh responses", exact: true }).click();
      await expect(publicGuest).toContainText("at least five approved respondents");
      await expect(
        guest.getByText("Response saved. The facilitator removed it from public results.", {
          exact: true,
        }),
      ).toBeVisible();
      await moderation.getByRole("button", { name: "Removed", exact: true }).click();
      await expect(moderation.getByText("Removed response", { exact: true })).toBeVisible();
      await expect(moderation.getByText(privateText, { exact: true })).toHaveCount(0);
      await expect(
        moderation.getByRole("button", { name: "Approve response", exact: true }),
      ).toHaveCount(0);
      await moderate(bodies[5]!, "approved");
      await expect(publicGuest.getByText("Another approved idea", { exact: true })).toBeVisible();
      expect(snapshotLeaked).toBe(false);
      const hostCommands = page.getByTestId("host-command-bar");
      await hostCommands.getByRole("button", { name: "Explain or reinforce", exact: true }).click();
      await hostCommands.getByRole("button", { name: "Finish intervention", exact: true }).click();
      const nextQuestion = hostCommands
        .locator(".host-command-primary")
        .getByRole("button", { name: "Next question", exact: true });
      await expect(nextQuestion).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Recheck by revote", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Open linked recheck", exact: true }),
      ).toHaveCount(0);
      await nextQuestion.click();
      await moderation.getByRole("button", { name: "Pending", exact: true }).click();
      await moderation.getByRole("button", { name: "All questions", exact: true }).click();
      await expect(moderation.getByText("UNAPPROVED_SECRET", { exact: true })).toBeVisible();
      await expect(moderation).toContainText("Earlier question");
      await expect(moderation).toContainText("Explain one priority");
      await moderation.getByRole("button", { name: "Current question", exact: true }).click();
      await expect(moderation.getByText("UNAPPROVED_SECRET", { exact: true })).toHaveCount(0);
      const phrase = guest.getByLabel("A word or short phrase", { exact: true });
      await phrase.fill("CAFE\u0301");
      await guest.getByRole("button", { name: "Submit response", exact: true }).press("Enter");
      await expect(
        guest.getByText("Response saved and waiting for facilitator review.", { exact: true }),
      ).toBeVisible();
      const words = [
        "CAFÉ",
        "café",
        " café ",
        "Café",
        "Practice",
        " practice ",
        "CLOUD_PENDING_SECRET",
      ];
      for (let index = 1; index < tokens.length; index++)
        await submit(tokens[index]!, words[index]!);
      for (let index = 0; index < 5; index++)
        await moderate(words[index]!.normalize("NFC").trim(), "approved");
      await page.getByRole("button", { name: "Lock answers", exact: true }).click();
      await page.getByRole("button", { name: "Reveal answer", exact: true }).click();
      await expect(
        publicGuest
          .getByRole("row")
          .filter({ has: guest.getByRole("rowheader", { name: "café", exact: true }) }),
      ).toContainText("4");
      await expect(
        publicPresenter.getByRole("rowheader", { name: "practice", exact: true }),
      ).toBeVisible();
      await guest
        .getByRole("region", { name: "Word-cloud counts", exact: true })
        .screenshot({ path: `/tmp/pollingpops-word-cloud-${test.info().project.name}.png` });
      expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
      await moderate("CAFÉ", "removed");
      await expect(publicGuest.getByRole("table")).toHaveCount(0);
      await expect(publicPresenter.getByRole("table")).toHaveCount(0);
      await moderate("practice", "approved");
      await expect(
        publicGuest
          .getByRole("row")
          .filter({ has: guest.getByRole("rowheader", { name: "café", exact: true }) }),
      ).toContainText("3");
      await expect(
        publicGuest
          .getByRole("row")
          .filter({ has: guest.getByRole("rowheader", { name: "practice", exact: true }) }),
      ).toContainText("2");
      await guest.reload();
      await expect(
        guest.getByText("Response saved. The facilitator removed it from public results.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(guest.getByLabel("A word or short phrase", { exact: true })).toHaveCount(0);
      await hostCommands.getByRole("button", { name: "Work an example", exact: true }).click();
      await hostCommands.getByRole("button", { name: "Finish intervention", exact: true }).click();
      const finishRound = hostCommands
        .locator(".host-command-primary")
        .getByRole("button", { name: "Finish round", exact: true });
      await expect(finishRound).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Recheck by revote", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Open linked recheck", exact: true }),
      ).toHaveCount(0);
      await finishRound.click();
      await expect(moderation).toContainText("Text responses can no longer be moderated");
      await expect(
        moderation.getByRole("button", { name: "Remove response", exact: true }),
      ).toHaveCount(0);
      await page
        .getByTestId("host-command-bar")
        .getByRole("link", { name: "Open report", exact: true })
        .click();
      await page.getByRole("tab", { name: "Questions", exact: true }).click();
      const textRow = page.getByRole("row").filter({ hasText: "Explain one priority" });
      await textRow.locator("summary").filter({ hasText: "5 approved respondents" }).click();
      await expect(textRow).toContainText("Another approved idea");
      await expect(textRow).not.toContainText("PRIVATE_PENDING_BODY");
      await expect(textRow).not.toContainText("UNAPPROVED_SECRET");
      const cloudRow = page.getByRole("row").filter({ hasText: "Share a word" });
      await cloudRow.locator("summary").filter({ hasText: "5 approved respondents" }).click();
      await expect(
        cloudRow
          .getByRole("row")
          .filter({ has: page.getByRole("rowheader", { name: "café", exact: true }) }),
      ).toContainText("3");
      await expect(cloudRow).not.toContainText("CLOUD_PENDING_SECRET");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await presenter.close();
    } finally {
      await context.close();
    }
  });
}
