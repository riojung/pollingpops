import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInBeta } from "./sign-in";
import { createE01Deck, e01ApiUrl, e01Slide } from "./presentation-e01-support";

async function setAccountLocale(page: Page, locale: "en-CA" | "ko-KR") {
  expect(
    (await page.request.put(`${e01ApiUrl}/v1/account/locale`, { data: { locale } })).ok(),
  ).toBe(true);
  await page
    .context()
    .addCookies([
      { name: "openround-locale", value: locale, url: new URL(page.url()).origin, sameSite: "Lax" },
    ]);
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean Q&A preserves private review and read-only Companion ${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(120_000);
    await signInBeta(page);
    let guestContext: BrowserContext | undefined;
    let companion: Page | undefined;
    try {
      await setAccountLocale(page, "ko-KR");
      const deck = await createE01Deck(page, [e01Slide("Original English slide")]);
      expect(
        (
          await page.request.post(`${e01ApiUrl}/v1/presentations/${deck.id}/publish`, {
            data: { expectedDraftRevision: deck.draftRevision },
          })
        ).status(),
      ).toBe(200);
      const creation = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
        data: { presentationId: deck.id },
      });
      expect(creation.status()).toBe(201);
      const { snapshot, controlToken } = await creation.json();
      const room = { id: snapshot.sessionId as string, code: snapshot.code as string };
      await page.evaluate(
        ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
        { id: room.id, token: controlToken },
      );
      await page.goto(`/presentation-session/${room.id}/host`);
      await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
      const opened = page.waitForEvent("popup");
      // The Companion toolbar is outside this Q&A localization slice.
      await page.getByRole("button", { name: "Launch companion", exact: true }).click();
      companion = await opened;
      await expect(
        companion.getByRole("heading", { name: "Presentation Companion", exact: true }),
      ).toBeVisible();
      const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
      guestContext = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport,
        isMobile,
        hasTouch,
        userAgent,
        deviceScaleFactor,
        reducedMotion: "reduce",
      });
      await guestContext.addCookies([
        {
          name: "openround-locale",
          value: "ko-KR",
          url: new URL(page.url()).origin,
          sameSite: "Lax",
        },
      ]);
      const guest = await guestContext.newPage();
      await guest.goto(`/join?code=${room.code}`);
      await guest.getByLabel("표시 이름", { exact: true }).fill("Original private alias");
      await guest.getByRole("button", { name: "프레젠테이션 참여", exact: true }).click();
      await expect(guest).toHaveURL(`/presentation-session/${room.id}/play`);
      await expect(guest.locator(".brand-name")).toHaveCSS("color", "rgb(255, 255, 255)");
      await expect(
        guest.getByText("진행자가 활성화하면 참여자 질의응답이 표시됩니다.", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "참여자 질의응답 활성화", exact: true }).click();
      for (const surface of [guest, companion]) {
        const summary = surface.locator("summary").filter({ hasText: "질문과 답변" });
        await summary.focus();
        await summary.press("Enter");
      }
      const hostQna = page.locator(".qna-panel");
      const guestQna = guest.locator(".qna-panel");
      const observerQna = companion.locator(".qna-panel");
      await expect(
        companion.getByText(
          "Companion 질의응답은 읽기 전용입니다. 호스트 창에서 질문을 검토하세요.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(observerQna.locator("textarea")).toHaveCount(0);
      await expect(observerQna.locator(".qna-settings, .qna-moderation-actions")).toHaveCount(0);
      await expect(guestQna).toContainText("진행자는 세션 별칭을 볼 수 있습니다.");
      const authored = "Could you explain the original English example?";
      await guestQna.getByLabel("진행자에게 질문", { exact: true }).fill(authored);
      await guestQna.getByRole("button", { name: "질문하기", exact: true }).click();
      await expect(guestQna.getByRole("status")).toHaveText(
        "진행자 검토를 위해 질문을 보냈습니다.",
      );
      await expect(guestQna.locator(".qna-question-meta")).toContainText("검토 대기 중");
      await expect(guestQna.locator(".qna-question-meta strong")).toHaveText("본인");
      await expect(hostQna.locator(".qna-question-body")).toHaveText(authored);
      await expect(hostQna).toContainText("Original private alias");
      await expect(observerQna.locator(".qna-question-body")).toHaveCount(0);
      await expect(observerQna).not.toContainText("Original private alias");
      await hostQna.getByRole("button", { name: "게시", exact: true }).click();
      await expect(observerQna.locator(".qna-question-body")).toHaveText(authored);
      await expect(guestQna.locator(".qna-question-body")).toHaveText(authored);
      await expect(guestQna.locator(".qna-question-meta")).toContainText("공개됨");
      await expect(observerQna).not.toContainText("Original private alias");
      await hostQna.getByRole("button", { name: "답변 완료로 표시", exact: true }).click();
      await expect(guestQna.locator(".qna-question-meta")).toContainText("답변됨");
      for (const surface of [page, guest, companion]) {
        expect(
          (await new AxeBuilder({ page: surface }).include("[data-presentation-qna]").analyze())
            .violations,
        ).toEqual([]);
        await expect
          .poll(() =>
            surface.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          )
          .toBe(true);
      }
      await guest.screenshot({ path: info.outputPath("secondary-korean-qna.png"), fullPage: true });
    } finally {
      try {
        await companion?.close();
        await guestContext?.close();
      } finally {
        await setAccountLocale(page, "en-CA");
      }
    }
  });
}
