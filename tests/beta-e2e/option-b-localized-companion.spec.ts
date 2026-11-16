import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { translate } from "../../apps/web/lib/i18n/catalog";
import koreanLiveMessages from "../../apps/web/lib/i18n/domains/live-delivery/ko-KR";
import { companionMessages } from "../../apps/web/lib/i18n/domains/live-delivery/companion-translations";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
test.use({ actionTimeout: 15_000 });

async function setLocale(page: Page, locale: "en-CA" | "ko-KR") {
  expect((await page.request.put(`${apiUrl}/v1/account/locale`, { data: { locale } })).ok()).toBe(
    true,
  );
  await page
    .context()
    .addCookies([
      { name: "openround-locale", value: locale, url: new URL(page.url()).origin, sameSite: "Lax" },
    ]);
}

async function createSession(page: Page) {
  const created = await page.request.post(`${apiUrl}/v1/presentations`, {
    data: { title: "Original English Companion deck", description: "" },
  });
  expect(created.status()).toBe(201);
  const presentation = (await created.json()).presentation;
  const question = {
    id: randomUUID(),
    type: "single_select",
    prompt: "Which original English approach is safest?",
    choices: [
      { id: randomUUID(), label: "Original safe choice", isCorrect: true },
      { id: randomUUID(), label: "Original alternative", isCorrect: false },
    ],
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["original-concept"],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 120,
    basePoints: 100,
    explanation: "PRIVATE original English explanation",
    sourceCitations: [
      {
        sourceName: "PRIVATE original citation",
        sourceDigest: "a".repeat(64),
        locator: "Original source 1",
        excerpt: "PRIVATE original source excerpt",
      },
    ],
    mediaId: null,
    mediaAlt: null,
  };
  const saved = await page.request.put(`${apiUrl}/v1/presentations/${presentation.id}/draft`, {
    data: {
      draft: { ...presentation.draft, blocks: [{ id: randomUUID(), kind: "question", question }] },
      expectedRevision: presentation.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(saved.status()).toBe(200);
  expect(
    (
      await page.request.post(`${apiUrl}/v1/presentations/${presentation.id}/publish`, {
        data: { expectedDraftRevision: (await saved.json()).presentation.draftRevision },
      })
    ).status(),
  ).toBe(200);
  const createdRoom = await page.request.post(`${apiUrl}/v1/presentation-sessions`, {
    data: { presentationId: presentation.id },
  });
  expect(createdRoom.status()).toBe(201);
  const { snapshot, controlToken } = await createdRoom.json();
  const sessionId = snapshot.sessionId as string;
  await page.evaluate(
    ({ sessionId, controlToken }) =>
      sessionStorage.setItem(`openround:presentation-host:${sessionId}`, controlToken),
    { sessionId, controlToken },
  );
  return {
    sessionId,
    code: snapshot.code as string,
    controlToken: controlToken as string,
    question,
  };
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean Companion keeps scoped retries, private overlays and host authority ${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(120_000);
    await signInBeta(page);
    let guestContext: BrowserContext | undefined;
    let companion: Page | undefined;
    const messages = { ...koreanLiveMessages, ...companionMessages("ko-KR") };
    const t = (key: Parameters<typeof translate>[1]) => translate(messages, key);
    // Literal language checks complement catalog selectors: an English fallback must fail.
    expect(t("live.companion.launch")).toBe("Companion 실행");
    expect(t("live.companion.title")).toBe("프레젠테이션 Companion");
    expect(t("live.companion.retryAck")).toBe("진행 확인 응답 재시도");
    expect(t("live.companion.returnToDeck")).toBe("프레젠테이션으로 돌아가기");
    try {
      await setLocale(page, "ko-KR");
      const room = await createSession(page);
      await page.goto(`/presentation-session/${room.sessionId}/host`);
      await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
      const popup = page.waitForEvent("popup");
      await page.getByRole("button", { name: t("live.companion.launch"), exact: true }).click();
      companion = await popup;
      await companion.setViewportSize({
        width: suffix === "@mobile" ? 320 : 420,
        height: 844,
      });
      const requests: Array<Promise<{ url: string; cookie?: string }>> = [];
      companion.on("request", (request) => {
        if (
          /^\/v1\/presentation-sessions\/[^/]+\/companion(?:-command)?$/.test(
            new URL(request.url()).pathname,
          )
        )
          requests.push(
            request
              .allHeaders()
              .then((headers) => ({ url: request.url(), cookie: headers.cookie })),
          );
      });
      const frames: string[] = [];
      companion.on("websocket", (socket) =>
        socket.on("framereceived", ({ payload }) => frames.push(payload.toString())),
      );
      await expect(
        companion.getByRole("heading", { name: "프레젠테이션 Companion", exact: true }),
      ).toBeVisible();
      await expect(companion).toHaveURL(`/presentation-session/${room.sessionId}/companion`);
      await expect(companion.locator("html")).toHaveAttribute("lang", "ko-KR");
      expect(await companion.evaluate(() => window.opener === null)).toBe(true);
      const pass = await companion.evaluate(
        (id) => sessionStorage.getItem(`openround:presentation-companion:${id}`),
        room.sessionId,
      );
      expect(pass).toBeTruthy();
      expect(pass).not.toBe(room.controlToken);
      expect(
        await companion.evaluate(() =>
          Object.keys(sessionStorage).filter((key) =>
            key.startsWith("openround:presentation-host:"),
          ),
        ),
      ).toEqual([]);
      expect(new URL(companion.url()).hash).toBe("");
      expect(new URL(companion.url()).search).toBe("");
      const join = companion.getByRole("button", {
        name: t("live.companion.showJoin"),
        exact: true,
      });
      await expect(join).toBeEnabled();
      const sidecar = companion.getByRole("region", {
        name: "프레젠테이션 Companion",
        exact: true,
      });
      // No horizontal overflow can still conceal two unreadably narrow columns.
      await expect
        .poll(() =>
          sidecar.evaluate((element) => {
            const card = element.getBoundingClientRect();
            const qna = element.nextElementSibling?.getBoundingClientRect();
            return {
              readable: card.width >= Math.min(400, innerWidth - 32) - 1,
              stacked: Boolean(qna && qna.top >= card.bottom - 1),
            };
          }),
        )
        .toEqual({ readable: true, stacked: true });
      await join.focus();
      await join.press("Enter");
      const joinDialog = companion.getByRole("dialog", {
        name: t("live.companion.joinTitle"),
        exact: true,
      });
      await expect(joinDialog).toContainText(room.code);
      expect((await new AxeBuilder({ page: companion }).analyze()).violations).toEqual([]);
      await expect
        .poll(() =>
          companion!.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        )
        .toBe(true);
      await companion.screenshot({
        path: info.outputPath("companion-korean-join.png"),
        fullPage: true,
      });
      await companion.keyboard.press("Escape");
      await expect(joinDialog).not.toBeVisible();
      await expect(join).toBeFocused();

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
      const privateAlias = "Original private guest alias";
      await guest.goto(`/join?code=${room.code}`);
      await guest.getByLabel("표시 이름", { exact: true }).fill(privateAlias);
      const admission = guest.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/v1/presentation-sessions/join",
      );
      await guest.getByRole("button", { name: "프레젠테이션 참여", exact: true }).click();
      expect((await admission).status()).toBe(201);
      await expect(guest).toHaveURL(`/presentation-session/${room.sessionId}/play`);

      const commands: string[] = [];
      let firstAck: string | null = null;
      let dropped = false;
      await companion.routeWebSocket(/\/socket\.io\//, (socket) => {
        const server = socket.connectToServer();
        socket.onMessage((message) => {
          const match = message.toString().match(/^42(\d+)(\[.*)$/);
          if (match) {
            const [event, command] = JSON.parse(match[2]!);
            if (event === "presentation.command") {
              commands.push(JSON.stringify(command));
              firstAck ??= match[1]!;
            }
          }
          server.send(message);
        });
        server.onMessage((message) => {
          if (!dropped && firstAck !== null && message.toString().startsWith(`43${firstAck}[`)) {
            dropped = true;
            return;
          }
          socket.send(message);
        });
      });
      await companion.reload();
      await expect(
        companion
          .getByRole("status")
          .filter({ hasText: new RegExp(`^${t("live.companion.connected")}$`) }),
      ).toBeVisible();
      await expect(
        companion.getByRole("button", { name: t("live.companion.showResults"), exact: true }),
      ).toHaveCount(0);
      await companion
        .getByRole("button", { name: t("live.presentationSession.advance.start"), exact: true })
        .click();
      await expect(
        guest.getByRole("heading", { name: room.question.prompt, exact: true }),
      ).toBeVisible();
      const retry = companion.getByRole("button", { name: "진행 확인 응답 재시도", exact: true });
      await expect(retry).toBeEnabled();
      expect(dropped).toBe(true);
      expect(commands).toHaveLength(1);
      await retry.click();
      await expect(retry).toHaveCount(0);
      expect(commands).toHaveLength(2);
      expect(commands[1]).toBe(commands[0]);
      await guest.getByRole("button", { name: "Original alternative", exact: true }).click();
      await guest
        .getByRole("button", { name: t("live.presentationPlay.submit"), exact: true })
        .click();
      await expect(
        guest.getByText(t("live.presentationPlay.responseSaved"), { exact: true }),
      ).toBeVisible();
      const operationalRead = await companion.request.get(
        `${apiUrl}/v1/presentation-sessions/${room.sessionId}/companion`,
        { headers: { authorization: `Bearer ${pass}` } },
      );
      expect(operationalRead.status()).toBe(200);
      const operational = (await operationalRead.json()).snapshot;
      expect(operational.roomStatus).toMatchObject({ joinedCount: 1, responseCount: 1 });
      expect(operational.resultSummary).toBeNull();
      await expect(
        companion.getByRole("button", { name: t("live.companion.showResults"), exact: true }),
      ).toHaveCount(0);
      await companion
        .getByRole("button", { name: t("live.presentationSession.advance.reveal"), exact: true })
        .click();
      const results = companion.getByRole("button", {
        name: t("live.companion.showResults"),
        exact: true,
      });
      await results.focus();
      await results.press("Enter");
      const resultDialog = companion.getByRole("dialog", {
        name: t("live.companion.resultTitle"),
        exact: true,
      });
      await expect(resultDialog).toContainText("Original alternative");
      for (const secret of [
        privateAlias,
        room.question.explanation,
        room.question.sourceCitations[0]!.sourceName,
      ])
        await expect(resultDialog).not.toContainText(secret);
      expect((await new AxeBuilder({ page: companion }).analyze()).violations).toEqual([]);
      await expect
        .poll(() =>
          companion!.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        )
        .toBe(true);
      await companion.screenshot({
        path: info.outputPath("companion-korean-results.png"),
        fullPage: true,
      });
      await companion
        .getByRole("button", { name: "프레젠테이션으로 돌아가기", exact: true })
        .click();
      await expect(resultDialog).not.toBeVisible();
      await expect(results).toBeFocused();
      for (const forbidden of [
        '"controlToken":',
        '"participants":',
        '"nickname":',
        '"isCorrect":',
        '"correctChoiceIds":',
        privateAlias,
        room.question.explanation,
        room.question.sourceCitations[0]!.sourceName,
      ])
        expect(frames.some((frame) => frame.includes(forbidden))).toBe(false);
      const scoped = await Promise.all(requests);
      expect(scoped.length).toBeGreaterThan(0);
      expect(scoped.every((request) => !request.cookie && !request.url.includes(pass!))).toBe(true);
      await page.getByRole("button", { name: t("live.companion.revoke"), exact: true }).click();
      await expect(
        companion.getByText(t("live.companion.passRejected"), { exact: true }),
      ).toBeVisible({ timeout: 20_000 });
      expect(
        await companion.evaluate(
          (id) => sessionStorage.getItem(`openround:presentation-companion:${id}`),
          room.sessionId,
        ),
      ).toBeNull();
      await expect(companion.getByRole("button")).toHaveCount(0);
      expect(
        (
          await companion.request.get(
            `${apiUrl}/v1/presentation-sessions/${room.sessionId}/companion`,
            { headers: { authorization: `Bearer ${pass}` } },
          )
        ).status(),
      ).toBe(401);
      expect((await new AxeBuilder({ page: companion }).analyze()).violations).toEqual([]);
      const finish = page.getByRole("button", {
        name: t("live.presentationSession.advance.finish"),
        exact: true,
      });
      await expect(finish).toBeEnabled();
      await finish.click();
    } finally {
      try {
        await guestContext?.close();
        await companion?.close();
      } finally {
        await setLocale(page, "en-CA");
      }
    }
  });
}
