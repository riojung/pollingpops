import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

test.use({ actionTimeout: 15_000 });

async function background(control: Locator) {
  return control.evaluate((element) => getComputedStyle(element).backgroundColor);
}

async function setAppearance(page: Page, mode: "light" | "dark") {
  await page.evaluate((value) => {
    localStorage.setItem("openround:color-mode", value);
    window.dispatchEvent(new Event("openround:color-mode-change"));
  }, mode);
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`participants choose a nickname and avatar, then visibly select and save an answer ${suffix}`, async ({
    page,
    browser,
  }) => {
    const host = page;
    test.setTimeout(90_000);
    if (suffix === "@mobile") await host.setViewportSize({ width: 320, height: 740 });
    else await host.setViewportSize({ width: 1366, height: 768 });
    await host.addInitScript(() => {
      // Exercise native selection-copy when the secure-context Clipboard API is unavailable.
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      document.addEventListener("copy", () => {
        const field = document.activeElement;
        if (field instanceof HTMLTextAreaElement)
          document.documentElement.dataset.copiedJoinLink = field.value;
      });
    });
    await signInBeta(page);
    const choices = ["Mean", "Median", "Maximum"].map((label) => ({
      id: randomUUID(),
      label,
      isCorrect: label === "Median",
    }));
    const created = await host.request.post(`${apiUrl}/v1/quizzes`, {
      data: { title: "Participant interaction regression" },
    });
    expect(created.status()).toBe(201);
    const quizId = (await created.json()).quiz.id as string;
    const draft = await host.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
      data: {
        title: "Participant interaction regression",
        description: "Synthetic participant interaction checks.",
        experiencePreset: { id: "spark", version: 1 },
        questions: [
          {
            id: randomUUID(),
            type: "single_select",
            prompt: "Which summary is less affected by an extreme value?",
            choices,
            purpose: "diagnostic",
            confidence: "required",
            timeLimitSeconds: 30,
            basePoints: 1000,
            explanation: "The median is less sensitive to outliers.",
            mediaId: null,
            mediaAlt: null,
          },
        ],
      },
    });
    expect(draft.ok()).toBe(true);
    expect(
      (await host.request.post(`${apiUrl}/v1/quizzes/${quizId}/publish`, { data: {} })).ok(),
    ).toBe(true);
    await host.goto(`/host/setup/${quizId}`);
    await expect(host.getByLabel("Participant names")).toBeVisible();
    await expect(host.getByLabel("Participant names")).toHaveValue("custom");
    const setupConfidence = host.getByRole("checkbox", {
      name: "Ask for confidence (optional)",
      exact: true,
    });
    await expect(setupConfidence).toBeVisible();
    await expect(setupConfidence).not.toBeChecked();
    await setupConfidence.check();
    // An older browser preference must not opt the next round in automatically.
    await host.evaluate(() => {
      const key = Object.keys(localStorage).find((item) => item.startsWith("openround:setup:v1:"));
      if (!key) throw new Error("Expected saved setup preferences");
      const saved = JSON.parse(localStorage.getItem(key)!);
      saved.settings.confidenceEnabled = true;
      localStorage.setItem(key, JSON.stringify(saved));
    });
    await host.reload();
    await expect(setupConfidence).not.toBeChecked();
    await setupConfidence.check();
    await expect(setupConfidence).toBeChecked();
    await host.locator('.recipe-card[data-recipe="competition"]').click();
    await expect(setupConfidence).toBeChecked();
    const creation = host.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/sessions",
    );
    await host.getByRole("button", { name: "Create live session", exact: true }).click();
    const hosted = await creation;
    expect(hosted.status()).toBe(201);
    expect(hosted.request().postDataJSON().settings).toMatchObject({
      confidenceEnabled: true,
      scoringMode: "speed",
      resultVisibility: "leaderboard",
    });
    const session = (await hosted.json()) as {
      sessionId: string;
      code: string;
      hostToken: string;
    };
    await expect(host).toHaveURL(new RegExp(`/host/${session.sessionId}$`));
    await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "lobby");
    const hostConfidence = host.getByRole("checkbox", {
      name: "Ask for confidence (optional)",
      exact: true,
    });
    await expect(hostConfidence).toBeVisible();
    await expect(hostConfidence).toBeChecked();
    const expectedJoinUrl = `${new URL(host.url()).origin}/join?code=${session.code}`;
    await expect(host.getByTestId("join-url")).toHaveAttribute("href", expectedJoinUrl);
    await host.getByRole("button", { name: "Copy join link", exact: true }).click();
    await expect(host.getByText("Join link copied.", { exact: true })).toBeVisible();
    await expect(host.locator("html")).toHaveAttribute("data-copied-join-link", expectedJoinUrl);
    await host.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("Clipboard unavailable")) },
      });
    });
    await host.getByRole("button", { name: "Copy join link", exact: true }).click();
    await expect(host.getByText("Join link copied.", { exact: true })).toBeVisible();
    await host.evaluate(() => {
      Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
    });
    await host.getByRole("button", { name: "Copy join link", exact: true }).click();
    await expect(host.getByRole("textbox", { name: "Copy join link", exact: true })).toHaveValue(
      expectedJoinUrl,
    );

    const context = await browser.newContext({
      baseURL: new URL(host.url()).origin,
      viewport: host.viewportSize()!,
      reducedMotion: "reduce",
    });
    try {
      const guest = await context.newPage();
      await guest.goto(`/join?code=${session.code}`);
      const nickname = guest.getByRole("textbox", { name: /^Nickname/ });
      await expect(nickname).toBeVisible();
      await nickname.fill("River Learner");
      await expect(guest.getByRole("radio")).toHaveCount(24);
      await guest
        .getByTestId("avatar-option-hedgehog")
        .getByText("Hedgehog", { exact: true })
        .click();
      await expect(guest.getByRole("radio", { name: "Hedgehog", exact: true })).toBeChecked();
      await guest.getByRole("radio", { name: "Hedgehog", exact: true }).focus();
      await guest.keyboard.press("ArrowLeft");
      await expect(guest.getByRole("radio", { name: "Frog", exact: true })).toBeChecked();
      await guest.keyboard.press("ArrowRight");
      await expect(guest.getByRole("radio", { name: "Hedgehog", exact: true })).toBeChecked();
      for (const mode of ["light", "dark"] as const) {
        await setAppearance(guest, mode);
        expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
      }
      await guest.screenshot({
        path: `artifacts/participant-join-${suffix === "@mobile" ? "320" : "desktop"}.png`,
        fullPage: true,
      });
      const admission = guest.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/v1/sessions/join",
      );
      await guest.getByRole("button", { name: "Join Round", exact: true }).click();
      const joined = await admission;
      expect(joined.status()).toBe(201);
      const { participantToken } = (await joined.json()) as { participantToken: string };
      await expect(guest).toHaveURL(/\/play\//);
      await expect(guest.getByRole("heading", { name: "River Learner" })).toBeVisible();
      await expect(guest.getByRole("img", { name: "Hedgehog avatar", exact: true })).toBeVisible();
      const unsaved = await context.newPage();
      await unsaved.goto(`/join?code=${session.code}`);
      await expect(unsaved.getByRole("radio")).toHaveCount(24);
      await unsaved
        .getByRole("textbox", { name: /^Nickname/ })
        .fill("UnsavedDraftWithLongNickname");
      await unsaved.getByRole("button", { name: "Join Round", exact: true }).click();
      await expect(unsaved).toHaveURL(/\/play\//);
      const confidenceFirst = await context.newPage();
      await confidenceFirst.goto(`/join?code=${session.code}`);
      await confidenceFirst.getByRole("textbox", { name: /^Nickname/ }).fill("Confidence First");
      await confidenceFirst.getByRole("button", { name: "Join Round", exact: true }).click();
      await expect(confidenceFirst).toHaveURL(/\/play\//);
      // Four admissions here plus one in the single-tap case keep all four browser projects
      // within the public join endpoint's twenty-request window, even on a fast production build.
      expect(
        (
          await host.request.post(`${apiUrl}/v1/sessions/join`, {
            data: { code: session.code, nickname: "Oak Example" },
          })
        ).status(),
      ).toBe(201);
      await host.getByRole("button", { name: "Audience", exact: true }).click();
      const drawer = host.getByTestId("audience-drawer");
      await expect(drawer).toBeVisible();
      const table = drawer.locator(".participant-activity-table");
      await expect(table).toContainText("UnsavedDraftWithLongNickname");
      const drawerGeometry = await drawer.evaluate((element) => {
        const header = element.querySelector(".audience-drawer-heading")!.getBoundingClientRect();
        const tabs = element.querySelector(".audience-tabs")!.getBoundingClientRect();
        return {
          overflow: element.scrollWidth - element.clientWidth,
          tabGap: tabs.top - header.bottom,
        };
      });
      expect(drawerGeometry.overflow).toBeLessThanOrEqual(1);
      expect(drawerGeometry.tabGap).toBeLessThanOrEqual(32);
      expect(
        await table.evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
      expect((await new AxeBuilder({ page: host }).analyze()).violations).toEqual([]);
      await host.screenshot({
        path: `artifacts/host-audience-${suffix === "@mobile" ? "320" : "desktop"}.png`,
        fullPage: true,
      });
      await drawer.getByRole("button", { name: "Close audience tools", exact: true }).click();
      const popup = host.waitForEvent("popup");
      await host.getByRole("button", { name: "Presenter view", exact: true }).click();
      const presenter = await popup;
      await presenter.setViewportSize(host.viewportSize()!);
      await host.getByRole("button", { name: "Start round", exact: true }).click();
      await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "question_open");
      const uncertainFirst = confidenceFirst.getByRole("button", { name: "Not sure", exact: true });
      const confidentFirst = confidenceFirst.getByRole("button", {
        name: "Very sure",
        exact: true,
      });
      await uncertainFirst.click();
      await expect(uncertainFirst).toHaveAttribute("aria-pressed", "true");
      await confidentFirst.click();
      await expect(confidentFirst).toHaveAttribute("aria-pressed", "true");
      await expect(uncertainFirst).toHaveAttribute("aria-pressed", "false");
      expect(await background(confidentFirst)).not.toBe(await background(uncertainFirst));
      await expect(
        confidenceFirst.getByText("Answer received and saved.", { exact: true }),
      ).toHaveCount(0);
      await confidenceFirst.getByRole("button", { name: "Median", exact: true }).click();
      await expect(
        confidenceFirst.getByText("Answer received and saved.", { exact: true }),
      ).toBeVisible();
      await unsaved.getByRole("button", { name: "Very sure", exact: true }).click();
      await expect(unsaved.getByText("Answer received and saved.", { exact: true })).toHaveCount(0);
      await hostConfidence.uncheck();
      await expect(hostConfidence).not.toBeChecked();
      for (const participant of [guest, confidenceFirst, unsaved]) {
        await expect(
          participant.getByRole("button", { name: "Very sure", exact: true }),
        ).toHaveCount(0);
      }
      await hostConfidence.check();
      await expect(hostConfidence).toBeChecked();
      const optionalConfidence = guest.getByRole("button", { name: "Very sure", exact: true });
      await expect(optionalConfidence).toBeVisible();
      await expect(guest.getByTestId("optional-confidence")).toContainText(
        "How sure are you? (Optional)",
      );
      await expect(unsaved.getByRole("button", { name: "Very sure", exact: true })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await expect(confidentFirst).toHaveAttribute("aria-pressed", "true");
      const confidenceBounds = await guest.locator(".response-confidence-options").boundingBox();
      const answerBounds = await guest.locator(".answer-grid").first().boundingBox();
      expect(confidenceBounds!.y + confidenceBounds!.height).toBeLessThanOrEqual(answerBounds!.y);
      await unsaved.getByRole("button", { name: "Somewhat sure", exact: true }).click();
      await expect(unsaved.locator('.answer-button[aria-pressed="true"]')).toHaveCount(0);
      const first = guest.getByRole("button", { name: "Mean", exact: true });
      const second = guest.getByRole("button", { name: "Median", exact: true });
      await expect(second).toBeEnabled();
      await expect(optionalConfidence).toHaveAttribute("aria-pressed", "false");
      await second.focus();
      await second.press("Space");
      await expect(guest.getByText("Answer received and saved.", { exact: true })).toBeVisible();
      await expect(second).toHaveAttribute("aria-pressed", "true");
      await expect(first).toHaveAttribute("aria-pressed", "false");
      await expect(second.locator(".answer-selection-check")).toBeVisible();
      expect(await background(first)).not.toBe(await background(second));
      await expect(guest.getByRole("button", { name: "Submit response", exact: true })).toHaveCount(
        0,
      );
      await guest.reload();
      await expect(second).toHaveAttribute("aria-pressed", "true");
      await expect(second).toBeDisabled();
      await expect(optionalConfidence).toHaveAttribute("aria-pressed", "false");
      const ownSnapshot = await guest.request.get(
        `${apiUrl}/v1/sessions/${session.sessionId}/snapshot?role=participant`,
        { headers: { authorization: `Bearer ${participantToken}` } },
      );
      expect(ownSnapshot.ok()).toBe(true);
      expect((await ownSnapshot.json()).snapshot).toMatchObject({
        myResponse: { kind: "choice", choiceIds: [choices[1]!.id] },
        myConfidence: null,
        settings: { confidenceEnabled: true },
      });
      await host.getByRole("button", { name: "Lock answers", exact: true }).click();
      const chosenConfidenceToken = await confidenceFirst.evaluate(
        (sessionId) => sessionStorage.getItem(`openround:participant:${sessionId}`),
        session.sessionId,
      );
      const chosenConfidenceSnapshot = await confidenceFirst.request.get(
        `${apiUrl}/v1/sessions/${session.sessionId}/snapshot?role=participant`,
        { headers: { authorization: `Bearer ${chosenConfidenceToken}` } },
      );
      expect(chosenConfidenceSnapshot.ok()).toBe(true);
      expect((await chosenConfidenceSnapshot.json()).snapshot).toMatchObject({
        myResponse: { kind: "choice", choiceIds: [choices[1]!.id] },
        myConfidence: 3,
      });
      await expect(unsaved.getByTestId("response-not-saved")).toHaveText(
        "No response was saved before this question closed.",
      );
      expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
      await guest.screenshot({
        path: `artifacts/participant-answer-saved-${suffix === "@mobile" ? "320" : "desktop"}.png`,
        fullPage: true,
      });
      await host.getByRole("button", { name: "Reveal answer", exact: true }).click();
      await expect(
        guest.getByTestId("participant-task").getByText("Correct", { exact: true }),
      ).toBeVisible();
      await host.getByRole("button", { name: "Show standings", exact: true }).click();
      const dashboards = [host, presenter];
      const viewports =
        suffix === "desktop"
          ? [
              { width: 1366, height: 768 },
              { width: 1280, height: 800 },
            ]
          : [{ width: 320, height: 740 }];
      for (const viewport of viewports) {
        for (const surface of dashboards) {
          await surface.setViewportSize(viewport);
          await surface.evaluate(() => window.scrollTo(0, 0));
          const scoreboard = surface.getByTestId("competition-dashboard").first();
          await expect(scoreboard.getByTestId("competition-podium")).toBeVisible();
          const box = await scoreboard.boundingBox();
          expect(box!.width).toBeGreaterThan(viewport.width >= 900 ? 950 : 250);
          expect(
            await surface.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
          ).toBeLessThanOrEqual(1);
          if (viewport.width >= 900) {
            expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
            if (surface === host) {
              const commands = await host.getByTestId("host-command-bar").boundingBox();
              expect(box!.y + box!.height).toBeLessThanOrEqual(commands!.y);
              expect(commands!.y + commands!.height).toBeLessThanOrEqual(viewport.height);
            }
          }
          expect((await new AxeBuilder({ page: surface }).analyze()).violations).toEqual([]);
          await surface.screenshot({
            path: `artifacts/${surface === host ? "host" : "presenter"}-standings-${viewport.width}.png`,
            fullPage: true,
          });
        }
      }
      await host.getByRole("button", { name: "Finish round", exact: true }).click();
      const finalResponse = await guest.request.get(
        `${apiUrl}/v1/sessions/${session.sessionId}/snapshot?role=participant`,
        { headers: { authorization: `Bearer ${participantToken}` } },
      );
      const finalSnapshot = (await finalResponse.json()).snapshot;
      const ownEntry = finalSnapshot.competitionStandings.entries.find(
        (entry: { id: string }) => entry.id === finalSnapshot.myParticipantId,
      );
      expect(finalSnapshot.myScoredResponseSummary).toMatchObject({
        answeredScoredQuestions: 1,
        correctScoredQuestions: 1,
        revealedScoredQuestions: 1,
      });
      expect(ownEntry.score).toBeGreaterThanOrEqual(600);
      expect(ownEntry.score).toBeLessThanOrEqual(1000);
      await expect(
        guest.getByText(`Your final score is ${ownEntry.score.toLocaleString("en-CA")}.`, {
          exact: true,
        }),
      ).toBeVisible();
      await expect(unsaved.getByText("Your final score is 0.", { exact: true })).toBeVisible();
      const receipt = guest.getByTestId("scored-response-receipt");
      await expect(receipt).toContainText("Revealed scored questions only.");
      await expect(receipt).toContainText("Saved answers1 / 1");
      await expect(receipt).toContainText("Correct1");
      const confidenceFirstReceipt = confidenceFirst.getByTestId("scored-response-receipt");
      await expect(confidenceFirstReceipt).toContainText("Saved answers1 / 1");
      await expect(confidenceFirstReceipt).toContainText("Correct1");
      const unsavedReceipt = unsaved.getByTestId("scored-response-receipt");
      await expect(unsavedReceipt).toContainText("Saved answers0 / 1");
      await expect(unsavedReceipt).toContainText("Correct0");
      await expect(unsavedReceipt).toContainText(
        "No answer was saved for the revealed scored questions.",
      );
      if (suffix === "desktop") {
        for (const viewport of viewports) {
          for (const surface of dashboards) {
            await surface.setViewportSize(viewport);
            await surface.evaluate(() => window.scrollTo(0, 0));
            const box = await surface.getByTestId("competition-dashboard").boundingBox();
            expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
            if (surface === host) {
              const commands = await host.getByTestId("host-command-bar").boundingBox();
              expect(box!.y + box!.height).toBeLessThanOrEqual(commands!.y);
              expect(commands!.y + commands!.height).toBeLessThanOrEqual(viewport.height);
            }
            expect((await new AxeBuilder({ page: surface }).analyze()).violations).toEqual([]);
            await surface.screenshot({
              path: `artifacts/${surface === host ? "host" : "presenter"}-final-${viewport.width}.png`,
              fullPage: true,
            });
          }
        }
      }
      await guest.reload();
      await expect(
        guest.getByText(`Your final score is ${ownEntry.score.toLocaleString("en-CA")}.`, {
          exact: true,
        }),
      ).toBeVisible();
      await expect(guest.getByTestId("scored-response-receipt")).toContainText(
        "Saved answers1 / 1",
      );
      await presenter.close();
    } finally {
      await context.close();
    }
  });

  test(`competition participants save a confidence-free true or false answer with one tap ${suffix}`, async ({
    page: host,
    browser,
  }) => {
    test.setTimeout(60_000);
    await signInBeta(host);
    const choices = ["True", "False"].map((label) => ({
      id: randomUUID(),
      label,
      isCorrect: label === "True",
    }));
    const created = await host.request.post(`${apiUrl}/v1/quizzes`, {
      data: { title: "Single tap competition regression" },
    });
    expect(created.status()).toBe(201);
    const quizId = (await created.json()).quiz.id as string;
    expect(
      (
        await host.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
          data: {
            title: "Single tap competition regression",
            description: "Live confidence starts off even for questions authored as required.",
            experiencePreset: { id: "spark", version: 1 },
            questions: [
              {
                id: randomUUID(),
                type: "true_false",
                prompt: "A saved correct answer earns the authored points.",
                choices,
                purpose: "diagnostic",
                confidence: "required",
                timeLimitSeconds: 30,
                basePoints: 1000,
                explanation: "The server confirms the saved answer before showing a receipt.",
                mediaId: null,
                mediaAlt: null,
              },
            ],
          },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (await host.request.post(`${apiUrl}/v1/quizzes/${quizId}/publish`, { data: {} })).ok(),
    ).toBe(true);
    const hosted = await host.request.post(`${apiUrl}/v1/sessions`, {
      data: {
        quizId,
        settings: {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "leaderboard",
          allowLateJoin: true,
          nicknamePolicy: "custom",
        },
      },
    });
    expect(hosted.status()).toBe(201);
    const session = (await hosted.json()) as {
      sessionId: string;
      code: string;
      hostToken: string;
      snapshot: { settings: { confidenceEnabled: boolean } };
    };
    expect(session.snapshot.settings.confidenceEnabled).toBe(false);
    await host.evaluate(({ sessionId, hostToken }) => {
      sessionStorage.setItem(`openround:host:${sessionId}`, hostToken);
    }, session);
    await host.goto(`/host/${session.sessionId}`);
    const context = await browser.newContext({
      baseURL: new URL(host.url()).origin,
      viewport: suffix === "@mobile" ? { width: 320, height: 740 } : { width: 1366, height: 768 },
      reducedMotion: "reduce",
    });
    try {
      const guest = await context.newPage();
      let rejectedFirstSave = false;
      if (suffix === "desktop") {
        await guest.routeWebSocket(/\/socket\.io\//, (client) => {
          const server = client.connectToServer();
          client.onMessage((message) => {
            if (!rejectedFirstSave && typeof message === "string" && /^42\d+\[/.test(message)) {
              const start = message.indexOf("[");
              const packet = JSON.parse(message.slice(start));
              if (packet[0] === "answer.submit") {
                // Reject only the first transport attempt; the actual draft remains valid.
                rejectedFirstSave = true;
                packet[1].confidence = 4;
                server.send(message.slice(0, start) + JSON.stringify(packet));
                return;
              }
            }
            server.send(message);
          });
        });
      }
      await guest.goto(`/join?code=${session.code}`);
      await guest.getByRole("textbox", { name: /^Nickname/ }).fill("Single Tap Learner");
      const admission = guest.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/v1/sessions/join",
      );
      await guest.getByRole("button", { name: "Join Round", exact: true }).click();
      const joined = await admission;
      expect(joined.status()).toBe(201);
      const { participantToken } = (await joined.json()) as { participantToken: string };
      await expect(guest).toHaveURL(/\/play\//);
      await host.getByRole("button", { name: "Start round", exact: true }).click();
      const answer = guest.getByRole("button", { name: "True", exact: true });
      await expect(guest.getByTestId("optional-confidence")).toHaveCount(0);
      await answer.click();
      if (suffix === "desktop") {
        await expect(guest.getByTestId("response-status").getByRole("alert")).toBeVisible();
        expect(rejectedFirstSave).toBe(true);
        // Clearing transient error text must not strand this fenced draft.
        await answer.click();
        const retry = guest.getByRole("button", { name: "Retry saving response", exact: true });
        await expect(retry).toBeVisible();
        await retry.click();
      }
      await expect(guest.getByText("Answer received and saved.", { exact: true })).toBeVisible();
      await expect(answer).toHaveAttribute("aria-pressed", "true");
      await expect(answer).toBeDisabled();
      await expect(guest.getByRole("button", { name: "Very sure", exact: true })).toHaveCount(0);
      await expect(guest.getByRole("button", { name: "Submit response", exact: true })).toHaveCount(
        0,
      );
      const snapshot = await guest.request.get(
        `${apiUrl}/v1/sessions/${session.sessionId}/snapshot?role=participant`,
        { headers: { authorization: `Bearer ${participantToken}` } },
      );
      expect(snapshot.ok()).toBe(true);
      expect((await snapshot.json()).snapshot).toMatchObject({
        answerCount: 1,
        myResponse: { kind: "choice", choiceIds: [choices[0]!.id] },
        myConfidence: null,
        settings: { confidenceEnabled: false },
      });
      await guest.reload();
      await expect(guest.getByText("Answer received and saved.", { exact: true })).toBeVisible();
      await expect(answer).toBeDisabled();
      await host.getByRole("button", { name: "Lock answers", exact: true }).click();
      await host.getByRole("button", { name: "Reveal answer", exact: true }).click();
      await host.getByRole("button", { name: "Show standings", exact: true }).click();
      await host.getByRole("button", { name: "Finish round", exact: true }).click();
      await expect(guest.getByText("Your final score is 1,000.", { exact: true })).toBeVisible();
      const receipt = guest.getByTestId("scored-response-receipt");
      await expect(receipt).toContainText("Saved answers1 / 1");
      await expect(receipt).toContainText("Correct1");
    } finally {
      await context.close();
    }
  });
}
