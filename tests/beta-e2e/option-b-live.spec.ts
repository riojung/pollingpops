import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { signInBeta } from "./sign-in";
import { joinBetaRound } from "./round-join";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B default join and unscored completion ${suffix}`, async ({ page, browser }) => {
    await signInBeta(page);
    const host = page;
    const created = await host.request.post(`${apiUrl}/v1/quizzes`, {
      data: { title: "Team priorities" },
    });
    expect(created.status()).toBe(201);
    const quizId = (await created.json()).quiz.id as string;
    const updated = await host.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
      data: {
        title: "Team priorities",
        description: "An unscored opinion poll.",
        questions: [
          {
            id: randomUUID(),
            type: "poll",
            prompt: "What should we focus on?",
            choices: [
              { id: randomUUID(), label: "Clarity", isCorrect: false },
              { id: randomUUID(), label: "Speed", isCorrect: false },
            ],
            purpose: "opinion",
            confidence: "off",
            timeLimitSeconds: 300,
            basePoints: 0,
            explanation: "Both opinions help the discussion.",
            mediaId: null,
            mediaAlt: null,
          },
        ],
      },
    });
    expect(updated.ok()).toBe(true);
    expect(
      (await host.request.post(`${apiUrl}/v1/quizzes/${quizId}/publish`, { data: {} })).ok(),
    ).toBe(true);
    const hosted = await host.request.post(`${apiUrl}/v1/sessions`, {
      data: {
        quizId,
        settings: {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "friendly_only",
        },
      },
    });
    expect(hosted.status()).toBe(201);
    const session = (await hosted.json()) as { sessionId: string; code: string; hostToken: string };
    await host.evaluate(
      ({ sessionId, hostToken }) =>
        sessionStorage.setItem(`openround:host:${sessionId}`, hostToken),
      session,
    );
    await host.goto(`/host/${session.sessionId}`);
    const context = await browser.newContext({
      baseURL: new URL(host.url()).origin,
      viewport: suffix === "@mobile" ? { width: 320, height: 844 } : host.viewportSize()!,
      reducedMotion: "reduce",
    });
    try {
      const guest = await context.newPage();
      await guest.goto(`/join?code=${session.code}`);
      await expect(guest.getByRole("button", { name: "Join Round", exact: true })).toBeEnabled();
      const avatarDisclosure = guest
        .locator("details")
        .filter({ has: guest.locator('summary[aria-label="Change avatar"]') });
      await expect(avatarDisclosure).not.toHaveAttribute("open", "");
      await expect(guest.getByRole("group", { name: "Choose your avatar" })).not.toBeVisible();
      const joined = await joinBetaRound(guest);
      expect(joined.request().postDataJSON().avatarId).toBe("comet");
      await expect(guest).toHaveURL(/\/play\//);
      await host.getByRole("button", { name: "Start round", exact: true }).click();
      await expect(
        guest
          .getByText("Choose your response, then submit it to save it.", { exact: true })
          .first(),
      ).toBeVisible();
      await guest.getByRole("button", { name: "Clarity", exact: true }).click();
      await expect(guest.getByText("Answer received and saved.", { exact: true })).toHaveCount(0);
      await guest.getByRole("button", { name: "Submit response", exact: true }).click();
      await expect(guest.getByText("Answer received and saved.", { exact: true })).toBeVisible();
      const primary = host
        .getByTestId("host-command-bar")
        .getByRole("button", { name: "Lock answers", exact: true });
      await host.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(primary).toBeInViewport();
      await primary.click();
      await host.getByRole("button", { name: "Reveal answer", exact: true }).click();
      await host.getByRole("button", { name: "Finish round", exact: true }).click();
      await expect(
        guest.getByText("Thanks for taking part. Your accepted responses were recorded.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(guest.getByText(/Your final score/)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}
