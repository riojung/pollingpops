import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { QuizDraft } from "@openround/contracts";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

function content(type: "poll" | "ranking" | "open_text" | "word_cloud"): QuizDraft {
  const header = {
    title: "Funding capacity regression",
    description: "Synthetic client capacity fixture",
  };
  const common = {
    id: randomUUID(),
    prompt: "Which priority matters?",
    purpose: "opinion" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: [],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 60,
    basePoints: 0,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
  if (type === "poll" || type === "ranking") {
    const choices = ["Practice", "Examples"].map((label) => ({
      id: randomUUID(),
      label,
      isCorrect: false,
    }));
    return {
      ...header,
      questions: [
        type === "poll"
          ? { ...common, type, choices, maxSelections: 2 }
          : { ...common, type, choices, rankCount: 2 },
      ],
    };
  }
  return { ...header, questions: [{ ...common, type }] };
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Round setup preserves funded capacity and the text ceiling ${suffix}`, async ({ page }) => {
    test.setTimeout(90_000);
    await signInBeta(page);
    const response = await page.request.get(`${api}/v1/auth/me`);
    expect(response.ok()).toBeTruthy();
    const account = await response.json();
    let uxBeta = true;
    let planLimit = 20;
    let type: "poll" | "ranking" | "open_text" | "word_cloud" = "poll";
    const quizId = randomUUID();
    await page.route(`${api}/v1/auth/me`, (route) =>
      route.fulfill({
        json: {
          ...account,
          entitlements: {
            ...account.entitlements,
            plan: planLimit === 20 ? "free" : "pro",
            maxParticipants: planLimit,
          },
          productFeatures: { ...account.productFeatures, uxBeta },
        },
      }),
    );
    await page.route(`${api}/v1/quizzes/${quizId}`, (route) => {
      const draft = content(type);
      return route.fulfill({
        json: {
          quiz: { id: quizId, title: draft.title, draft, currentVersionId: "synthetic-published" },
          currentVersion: { content: draft },
        },
      });
    });
    await page.route(`${api}/v1/workspaces/current/room-funding`, (route) =>
      route.fulfill({
        json: {
          enabled: true,
          coveredBySubscription: false,
          availableCredits: 1,
          eventEntitlements: { ...account.entitlements, maxParticipants: 100 },
        },
      }),
    );
    const submissions: Array<{ useEventCredit: boolean; settings: { audienceLimit: number } }> = [];
    // Observe native form submission without reserving an actual Event credit.
    await page.route(`${api}/v1/sessions`, async (route) => {
      submissions.push(route.request().postDataJSON());
      await route.fulfill({
        status: 409,
        json: { error: { code: "CONFLICT", message: "Synthetic capacity submission received." } },
      });
    });
    for (uxBeta of [true, false]) {
      for (type of ["poll", "ranking", "open_text", "word_cloud"]) {
        planLimit = 20;
        await page.goto(`/host/setup/${quizId}`);
        if (uxBeta) await page.getByText("Review settings", { exact: true }).click();
        const audience = page.getByRole("spinbutton", { name: /^Maximum participants/ });
        await expect(audience).toHaveAttribute("max", "20");
        const credit = page.getByRole("checkbox", { name: /Use one credit for this room/ });
        await credit.check();
        await expect(audience).toHaveAttribute("max", "100");
        await audience.fill("100");
        if (uxBeta) {
          await page.locator('button[data-recipe="recovery"]').click();
          await expect(audience).toHaveValue("100");
        }
        expect(await audience.evaluate((element: HTMLInputElement) => element.validity.valid)).toBe(
          true,
        );
        const previous = submissions.length;
        await page.getByRole("button", { name: "Create live session", exact: true }).click();
        await expect.poll(() => submissions.length).toBe(previous + 1);
        expect(submissions.at(-1)).toMatchObject({
          useEventCredit: true,
          settings: { audienceLimit: 100 },
        });
        await expect(
          page.getByText("Synthetic capacity submission received.", { exact: true }),
        ).toBeVisible();
        await credit.uncheck();
        await expect(audience).toHaveValue("20");
        await expect(audience).toHaveAttribute("max", "20");
      }
      planLimit = 1_000;
      type = "open_text";
      await page.goto(`/host/setup/${quizId}`);
      if (uxBeta) await page.getByText("Review settings", { exact: true }).click();
      const audience = page.getByRole("spinbutton", { name: /^Maximum participants/ });
      await expect(audience).toHaveAttribute("max", "250");
      await audience.fill("251");
      expect(
        await audience.evaluate((element: HTMLInputElement) => element.validity.rangeOverflow),
      ).toBe(true);
      const previous = submissions.length;
      await page.getByRole("button", { name: "Create live session", exact: true }).click();
      expect(submissions).toHaveLength(previous);
    }
  });
}
