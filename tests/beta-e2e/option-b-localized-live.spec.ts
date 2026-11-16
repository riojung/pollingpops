import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";
import { joinBetaRound } from "./round-join";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

async function setAccountLocale(page: Page, locale: "en-CA" | "ko-KR") {
  expect((await page.request.put(`${apiUrl}/v1/account/locale`, { data: { locale } })).ok()).toBe(
    true,
  );
  await page
    .context()
    .addCookies([
      { name: "openround-locale", value: locale, url: new URL(page.url()).origin, sameSite: "Lax" },
    ]);
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean join response completion and report ${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(90_000);
    const host = page;
    await signInBeta(page);
    let guestContext: BrowserContext | undefined;
    try {
      await setAccountLocale(host, "ko-KR");
      const created = await host.request.post(`${apiUrl}/v1/quizzes`, {
        data: { title: "Original team priorities" },
      });
      expect(created.status()).toBe(201);
      const quizId = (await created.json()).quiz.id as string;
      expect(
        (
          await host.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
            data: {
              title: "Original team priorities",
              description: "Unscored opinion fixture.",
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
          })
        ).ok(),
      ).toBe(true);
      expect(
        (await host.request.post(`${apiUrl}/v1/quizzes/${quizId}/publish`, { data: {} })).ok(),
      ).toBe(true);
      await host.goto(`/host/setup/${quizId}`);
      await expect(host.locator("html")).toHaveAttribute("lang", "ko-KR");
      await expect(
        host.getByRole("heading", { name: "Original team priorities", exact: true }),
      ).toBeVisible();
      await expect(host.getByRole("button", { name: /^회복 중심/ })).toBeVisible();
      const creation = host.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/v1/sessions",
      );
      await host.getByRole("button", { name: "라이브 세션", exact: true }).click();
      const response = await creation;
      expect(response.status()).toBe(201);
      const session = (await response.json()) as { sessionId: string; code: string };
      await expect(host).toHaveURL(new RegExp(`/host/${session.sessionId}$`));
      await expect(host.getByRole("button", { name: "Round 시작", exact: true })).toBeVisible();
      await expect(host.getByRole("button", { name: "발표자 화면", exact: true })).toBeVisible();
      guestContext = await browser.newContext({
        baseURL: new URL(host.url()).origin,
        viewport: suffix === "@mobile" ? { width: 320, height: 844 } : host.viewportSize()!,
        reducedMotion: "reduce",
      });
      await guestContext.addCookies([
        {
          name: "openround-locale",
          value: "ko-KR",
          url: new URL(host.url()).origin,
          sameSite: "Lax",
        },
      ]);
      const guest = await guestContext.newPage();
      await guest.goto(`/join?code=${session.code}`);
      await expect(guest.locator("html")).toHaveAttribute("lang", "ko-KR");
      const avatar = guest.locator('summary[aria-label="아바타 변경"]');
      await expect(avatar).toBeVisible();
      await expect(avatar.locator("..")).not.toHaveAttribute("open", "");
      const joined = await joinBetaRound(guest, "Round 참여");
      expect(joined.status()).toBe(201);
      expect(joined.request().postDataJSON().avatarId).toBe("comet");
      await expect(guest).toHaveURL(/\/play\//);
      await host.getByRole("button", { name: "Round 시작", exact: true }).click();
      await expect(
        guest.getByRole("heading", { name: "What should we focus on?", exact: true }),
      ).toBeVisible();
      await expect(guest.getByText("질문 1/1", { exact: true })).toBeVisible();
      await guest.getByRole("button", { name: "Clarity", exact: true }).click();
      await guest.getByRole("button", { name: "응답 제출", exact: true }).click();
      await expect(
        guest.getByText("답변이 접수되어 저장되었습니다.", { exact: true }),
      ).toBeVisible();
      await expect(guest.getByText("Answer received and saved.", { exact: true })).toHaveCount(0);
      await host.getByRole("button", { name: "응답 잠그기", exact: true }).click();
      await host.getByRole("button", { name: "정답 공개", exact: true }).click();
      await host.getByRole("button", { name: "Round 종료", exact: true }).click();
      await expect(
        guest.getByText("참여해 주셔서 감사합니다. 접수된 답변이 기록되었습니다.", { exact: true }),
      ).toBeVisible();
      await expect(guest.getByText(/최종 점수/)).toHaveCount(0);
      await host
        .getByTestId("host-stage")
        .getByRole("link", { name: "보고서 열기", exact: true })
        .click();
      const questions = host.getByRole("tab", { name: "질문", exact: true });
      await expect(questions).toBeVisible({ timeout: 20_000 });
      await expect(host.getByRole("tab", { name: "데이터 관리", exact: true })).toBeVisible();
      await questions.click();
      await expect(host.getByRole("heading", { name: "질문 분석", exact: true })).toBeVisible();
      await expect(
        host.getByRole("cell", { name: "What should we focus on?", exact: true }),
      ).toBeVisible();
      await expect(host.getByRole("cell", { name: "평가 없음", exact: true })).toHaveCount(2);
      await expect(host.getByRole("tab", { name: "Manage data", exact: true })).toHaveCount(0);
      await host.screenshot({
        path: info.outputPath("option-b-korean-report.png"),
        fullPage: true,
      });
    } finally {
      await guestContext?.close();
      await setAccountLocale(host, "en-CA");
    }
  });
}
