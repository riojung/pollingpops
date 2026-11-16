import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  request as apiRequest,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { signInBeta } from "./sign-in";
import { joinBetaParticipant } from "./round-join";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
test.use({ actionTimeout: 15_000 });

async function exchange<T>(
  context: APIRequestContext,
  method: string,
  path: string,
  data?: unknown,
  headers?: Record<string, string>,
  expected = 200,
): Promise<T> {
  const response = await context.fetch(`${api}${path}`, { method, data, headers, timeout: 20_000 });
  expect(response.status(), `${method} ${path}`).toBe(expected);
  return response.json() as Promise<T>;
}

async function setLocale(page: Page, locale: "en-CA" | "ko-KR") {
  await exchange(page.request, "PUT", "/v1/account/locale", { locale });
  await page
    .context()
    .addCookies([
      { name: "openround-locale", value: locale, url: new URL(page.url()).origin, sameSite: "Lax" },
    ]);
}

interface SeededRoom {
  sessionId: string;
  code: string;
  hostToken: string;
  wrongChoice: string;
}
interface RoomSnapshot {
  version: number;
  phase: string;
  roundId: string | null;
}

async function createRoom(page: Page): Promise<SeededRoom> {
  const title = "Original follow-up source";
  const created = await exchange<{ quiz: { id: string } }>(
    page.request,
    "POST",
    "/v1/quizzes",
    { title },
    undefined,
    201,
  );
  const quizId = created.quiz.id;
  const wrongChoice = randomUUID();
  await exchange(page.request, "PATCH", `/v1/quizzes/${quizId}`, {
    title,
    description: "Synthetic secondary-flow qualification.",
    questions: [
      {
        id: randomUUID(),
        type: "single_select",
        prompt: "Which option is supported by the evidence?",
        purpose: "diagnostic",
        confidence: "off",
        conceptKeys: ["secondary-ux"],
        timeLimitSeconds: 300,
        basePoints: 1000,
        explanation: "Review the original evidence.",
        mediaId: null,
        mediaAlt: null,
        choices: [
          { id: randomUUID(), label: "Use the original evidence", isCorrect: true },
          { id: wrongChoice, label: "Use an unsupported claim", isCorrect: false },
        ],
      },
    ],
  });
  await exchange(page.request, "POST", `/v1/quizzes/${quizId}/publish`, {});
  const room = await exchange<Omit<SeededRoom, "wrongChoice">>(
    page.request,
    "POST",
    "/v1/sessions",
    {
      quizId,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
        confidenceEnabled: false,
      },
    },
    undefined,
    201,
  );
  return { ...room, wrongChoice };
}

async function command(
  context: APIRequestContext,
  room: SeededRoom,
  action: "start" | "lock" | "reveal" | "next" | "end",
) {
  const headers = { authorization: `Bearer ${room.hostToken}` };
  const { snapshot } = await exchange<{ snapshot: RoomSnapshot }>(
    context,
    "GET",
    `/v1/sessions/${room.sessionId}/snapshot?role=host`,
    undefined,
    headers,
  );
  return (
    await exchange<{ snapshot: RoomSnapshot }>(
      context,
      "POST",
      `/v1/sessions/${room.sessionId}/commands`,
      { action, commandId: randomUUID(), expectedVersion: snapshot.version },
      headers,
    )
  ).snapshot;
}

async function createReport(page: Page, context: APIRequestContext, room: SeededRoom) {
  const joined = await joinBetaParticipant(context, api, {
    code: room.code,
    nickname: "Private learner alias",
    avatarId: "comet",
  });
  expect(joined.status()).toBe(201);
  const participant = (await joined.json()) as { participantToken: string };
  const opened = await command(context, room, "start");
  const answer = await exchange<{ accepted: boolean }>(
    context,
    "POST",
    `/v1/sessions/${room.sessionId}/answers`,
    { roundId: opened.roundId, choiceId: room.wrongChoice, idempotencyKey: randomUUID() },
    { authorization: `Bearer ${participant.participantToken}` },
  );
  expect(answer.accepted).toBe(true);
  await command(context, room, "lock");
  await command(context, room, "reveal");
  expect((await command(context, room, "next")).phase).toBe("finished");
  let reportId = "";
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${api}/v1/sessions/${room.sessionId}/report`);
        if (response.status() === 404) return "not_created";
        expect(response.status()).toBe(200);
        const { report } = await response.json();
        reportId = report.id;
        return report.status;
      },
      { timeout: 30_000 },
    )
    .toBe("ready");
  return reportId;
}

async function qualifyLayout(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean staff links retain grants, fragments and revoke behaviour ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    await signInBeta(page);
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const anonymous = await apiRequest.newContext();
    const room = await createRoom(page);
    try {
      await setLocale(page, "ko-KR");
      await page.evaluate(
        ({ sessionId, hostToken }) =>
          sessionStorage.setItem(`openround:host:${sessionId}`, hostToken),
        room,
      );
      await page.goto(`/host/${room.sessionId}`);
      const staff = page.locator("details.staff-management");
      await expect(staff.locator("summary")).toHaveText("Round 스태프");
      await staff.locator("summary").click();
      await staff.getByLabel("공동 호스트 이름", { exact: true }).fill("Original assistant label");
      const createdResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/v1/sessions/${room.sessionId}/staff`,
      );
      await staff.getByRole("button", { name: "공동 호스트 링크 만들기", exact: true }).click();
      const created = await createdResponse;
      expect(created.status()).toBe(201);
      expect(created.request().postDataJSON()).toMatchObject({
        role: "cohost",
        label: "Original assistant label",
        expiresInMinutes: 240,
      });
      const credential = (await created.json()) as { credential: { id: string }; token: string };
      const link = staff.locator('a[href*="#cohost="]');
      await expect(link).toBeVisible();
      const url = new URL((await link.getAttribute("href"))!);
      expect(url.search).toBe("");
      expect(new URLSearchParams(url.hash.slice(1)).get("cohost")).toBe(credential.token);
      await page.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: () => Promise.reject(new Error("Synthetic clipboard denial")) },
        }),
      );
      await staff.getByRole("button", { name: "공동 호스트 링크 복사", exact: true }).click();
      await expect(
        staff.getByText("복사가 차단되었습니다. 표시된 링크를 선택하여 복사하세요.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(link).toHaveAttribute("href", url.toString());
      await qualifyLayout(page);
      await staff.getByRole("button", { name: "보안 삽입 링크 만들기", exact: true }).click();
      await expect(staff.locator("#staff-embed-error")).toContainText("HTTPS");
      await expect(staff.locator('a[href*="/embed/present/"]')).toHaveCount(0);
      const row = staff.getByRole("listitem").filter({ hasText: "Original assistant label" });
      const revokedResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "DELETE" &&
          new URL(response.url()).pathname ===
            `/v1/sessions/${room.sessionId}/staff/${credential.credential.id}`,
      );
      await row.getByRole("button").click();
      expect((await revokedResponse).status()).toBe(204);
      await expect(row.getByRole("button")).toHaveCount(0);
      const denied = await anonymous.get(
        `${api}/v1/sessions/${room.sessionId}/snapshot?role=host`,
        { headers: { authorization: `Bearer ${credential.token}` } },
      );
      expect([401, 403, 404]).toContain(denied.status());
      await page.reload();
      await page.locator("details.staff-management > summary").click();
      await expect(page.locator('a[href*="#cohost="]')).toHaveCount(0);
      await expect(page.getByText("Original assistant label", { exact: true })).toBeVisible();
      await qualifyLayout(page);
      await page.screenshot({
        path: info.outputPath("secondary-staff-korean.png"),
        fullPage: true,
      });
      await page.route(`${api}/v1/sessions/${room.sessionId}/staff`, (route) =>
        route.request().method() === "GET"
          ? route.fulfill({
              status: 403,
              json: { error: { code: "FORBIDDEN", message: "Synthetic read-only role" } },
            })
          : route.continue(),
      );
      await page.reload();
      await expect(page.locator("details.staff-management")).toHaveCount(0);
      await expect(page.getByTestId("host-session")).toBeVisible();
    } finally {
      await command(anonymous, room, "end");
      await anonymous.dispose();
      await setLocale(page, "en-CA");
    }
  });

  test(`Option B Korean follow-up access keeps one-time links and read-only roles ${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(120_000);
    await signInBeta(page);
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const anonymous = await apiRequest.newContext();
    const room = await createRoom(page);
    let guestContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    try {
      const reportId = await createReport(page, anonymous, room);
      await setLocale(page, "ko-KR");
      await page.goto(`/report/${reportId}`);
      const management = page.locator("section").filter({ has: page.locator("#followup-heading") });
      const create = management.getByRole("button", {
        name: "후속 학습 및 링크 만들기",
        exact: true,
      });
      await expect(create).toBeVisible();
      await management.getByRole("combobox").selectOption("timed");
      const createResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/v1/reports/${reportId}/followups`,
      );
      await create.click();
      const created = await createResponse;
      expect(created.status()).toBe(201);
      const followup = (await created.json()) as { followup: { id: string }; genericUrl: string };
      await expect(
        management.getByRole("textbox", { name: "일반 익명 링크", exact: true }),
      ).toHaveValue(followup.genericUrl);
      await management
        .getByLabel("편의 지원 패스 이름", { exact: true })
        .fill("Original accommodation label");
      await management.getByRole("combobox", { name: "허용 시간", exact: true }).selectOption("2");
      const passResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/v1/followups/${followup.followup.id}/accommodation-passes`,
      );
      await management.getByRole("button", { name: "비공개 패스 만들기", exact: true }).click();
      const passResult = await passResponse;
      expect(passResult.status()).toBe(201);
      expect(passResult.request().postDataJSON()).toEqual({
        label: "Original accommodation label",
        timeMultiplier: 2,
      });
      const { access } = (await passResult.json()) as { access: { id: string; url: string } };
      const pass = management.getByRole("textbox", {
        name: "비공개 후속 학습 패스 링크",
        exact: true,
      });
      await expect(pass).toHaveValue(access.url);
      await page.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: () => Promise.reject(new Error("Synthetic clipboard denial")) },
        }),
      );
      await pass.locator("..").getByRole("button", { name: "복사", exact: true }).click();
      await expect(management.getByRole("alert")).toContainText("복사가 차단되었습니다.");
      await expect(pass).toHaveValue(access.url);
      await qualifyLayout(page);
      const { isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
      guestContext = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: suffix === "@mobile" ? { width: 320, height: 844 } : page.viewportSize()!,
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
      await guest.goto(access.url);
      await expect(
        guest.getByRole("heading", {
          name: "Which option is supported by the evidence?",
          exact: true,
        }),
      ).toBeVisible();
      await expect(guest.locator("html")).toHaveAttribute("lang", "ko-KR");
      await expect(guest.getByRole("button", { name: "응답 제출", exact: true })).toBeVisible();
      expect(new URL(guest.url()).searchParams.has("token")).toBe(false);
      await qualifyLayout(guest);
      const revokeRow = management
        .getByRole("row")
        .filter({ hasText: "Original accommodation label" });
      const dialog = page.waitForEvent("dialog");
      const revokeResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "DELETE" &&
          new URL(response.url()).pathname ===
            `/v1/followups/${followup.followup.id}/access/${access.id}`,
      );
      const clickRevoke = revokeRow.getByRole("button", { name: "취소", exact: true }).click();
      const confirmation = await dialog;
      expect(confirmation.message()).toContain("취소");
      await confirmation.accept();
      await clickRevoke;
      expect((await revokeResponse).status()).toBe(204);
      await expect(revokeRow.getByRole("button")).toHaveCount(0);
      await guest.reload();
      await expect(guest.locator("#main").getByRole("alert")).toBeVisible();
      await expect(
        guest.getByRole("heading", {
          name: "Which option is supported by the evidence?",
          exact: true,
        }),
      ).toHaveCount(0);
      await qualifyLayout(guest);
      await page.reload();
      await expect(
        management.getByRole("button", { name: "비공개 패스 만들기", exact: true }),
      ).toBeVisible();
      const shownValues = await management
        .locator("input")
        .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
      expect(shownValues).not.toContain(followup.genericUrl);
      expect(shownValues).not.toContain(access.url);
      await qualifyLayout(page);
      await page.screenshot({
        path: info.outputPath("secondary-followup-korean.png"),
        fullPage: true,
      });
      await page.route(`${api}/v1/auth/me`, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.creator.role = "viewer";
        await route.fulfill({ response, json: body });
      });
      await page.reload();
      await expect(
        management.getByText(
          "후속 학습 접근을 만들거나 관리하려면 소유자 또는 편집자 권한이 필요합니다.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        management.getByRole("button", { name: "비공개 패스 만들기", exact: true }),
      ).toHaveCount(0);
      await expect(
        management.getByRole("button", { name: "모든 참가자의 후속 학습 마감", exact: true }),
      ).toHaveCount(0);
      await expect(
        management.getByText("Original accommodation label", { exact: true }),
      ).toBeVisible();
      await page.unroute(`${api}/v1/auth/me`);
      await page.reload();
      const closeDialog = page.waitForEvent("dialog");
      const closeResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/v1/followups/${followup.followup.id}/close`,
      );
      const close = management
        .getByRole("button", { name: "모든 참가자의 후속 학습 마감", exact: true })
        .click();
      const closeConfirmation = await closeDialog;
      expect(closeConfirmation.message()).toContain("마감");
      await closeConfirmation.accept();
      await close;
      expect((await closeResponse).status()).toBe(204);
      await expect(
        management.getByRole("button", { name: "비공개 패스 만들기", exact: true }),
      ).toHaveCount(0);
    } finally {
      await guestContext?.close();
      await anonymous.dispose();
      await setLocale(page, "en-CA");
    }
  });
}
