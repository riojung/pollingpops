import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Response,
  type Download,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  CreatedSummaryShareSchema,
  SharedSessionSummarySchema,
  type SummarySource,
} from "../../packages/contracts/src/session-summaries";
import { signInBeta } from "./sign-in";
import { joinBetaParticipant } from "./round-join";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

const summaryNetwork = new WeakMap<Page, string[]>();
function observeSummaryNetwork(page: Page) {
  const history: string[] = [];
  summaryNetwork.set(page, history);
  const summaryPath = (url: string) => {
    const path = new URL(url).pathname;
    return /^\/v1\/(?:session-summaries|shared-session-summaries)(?:\/|$)/.test(path) ? path : null;
  };
  page.on("response", (response) => {
    const path = summaryPath(response.url());
    if (path) history.push(`${response.request().method()} ${path}: ${response.status()}`);
  });
  page.on("requestfailed", (request) => {
    const path = summaryPath(request.url());
    if (path) history.push(`${request.method()} ${path}: network request failed`);
  });
}
function networkDiagnostics(page: Page) {
  return summaryNetwork.get(page)?.slice(-6).join("; ") || "No summary request was observed";
}
function waitForSummaryResponse(page: Page, method: string, path: string): Promise<Response> {
  return page
    .waitForResponse(
      (response) =>
        response.request().method() === method && new URL(response.url()).pathname === path,
      { timeout: 30_000 },
    )
    .catch(() => {
      throw new Error(
        `Timed out waiting for ${method} ${path}. Recent summary requests: ${networkDiagnostics(page)}`,
      );
    });
}

interface SummaryFixture {
  source: SummarySource;
  title: string;
  pagePath: string;
  privateAliases: string[];
  privateIds: string[];
}

async function post(
  request: APIRequestContext,
  path: string,
  data: unknown,
  status: number,
  headers?: Record<string, string>,
) {
  const response = await request.post(`${api}${path}`, { data, headers });
  expect(response.status(), `POST ${path}`).toBe(status);
  return response;
}

async function createFinishedRound(page: Page, guests: APIRequestContext): Promise<SummaryFixture> {
  const title = `Synthetic shared Round ${randomUUID().slice(0, 8)}`;
  const quiz = (await (await post(page.request, "/v1/quizzes", { title }, 201)).json()).quiz;
  const choiceId = randomUUID();
  const saved = await postQuizDraft();
  expect(saved.ok()).toBe(true);
  await post(page.request, `/v1/quizzes/${quiz.id}/publish`, {}, 200);
  const session = await (
    await post(
      page.request,
      "/v1/sessions",
      {
        quizId: quiz.id,
        settings: {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "custom",
        },
      },
      201,
    )
  ).json();
  const aliases: string[] = [];
  const ids: string[] = [session.sessionId, quiz.id];
  const tokens: string[] = [];
  for (let index = 0; index < 5; index++) {
    const nickname = `SyntheticPrivateAlias${index}`;
    const joined = await joinBetaParticipant(guests, api, { code: session.code, nickname });
    expect(joined.status()).toBe(201);
    const guest = await joined.json();
    aliases.push(nickname);
    ids.push(guest.participantId);
    tokens.push(guest.participantToken);
  }
  const headers = { authorization: `Bearer ${session.hostToken}` };
  async function command(action: "start" | "lock" | "reveal" | "next") {
    const current = await guests.get(`${api}/v1/sessions/${session.sessionId}/snapshot?role=host`, {
      headers,
    });
    expect(current.status()).toBe(200);
    const snapshot = (await current.json()).snapshot;
    return (
      await (
        await post(
          guests,
          `/v1/sessions/${session.sessionId}/commands`,
          {
            action,
            commandId: randomUUID(),
            expectedVersion: snapshot.version,
          },
          200,
          headers,
        )
      ).json()
    ).snapshot;
  }
  const opened = await command("start");
  for (const participantToken of tokens) {
    const answer = await post(
      guests,
      `/v1/sessions/${session.sessionId}/answers`,
      {
        roundId: opened.roundId,
        choiceId,
        idempotencyKey: randomUUID(),
      },
      200,
      { authorization: `Bearer ${participantToken}` },
    );
    expect((await answer.json()).accepted).toBe(true);
  }
  await command("lock");
  await command("reveal");
  expect((await command("next")).phase).toBe("finished");
  let reportId = "";
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${api}/v1/sessions/${session.sessionId}/report`);
        if (response.status() === 404) return "not_created";
        expect(response.status()).toBe(200);
        const { report } = await response.json();
        reportId = report.id;
        return report.status;
      },
      { timeout: 30_000 },
    )
    .toBe("ready");
  ids.push(reportId);
  return {
    source: { kind: "round", id: session.sessionId },
    title,
    pagePath: `/report/${reportId}`,
    privateAliases: aliases,
    privateIds: ids,
  };

  function postQuizDraft() {
    return page.request.patch(`${api}/v1/quizzes/${quiz.id}`, {
      data: {
        title,
        description: "Synthetic sharing fixture",
        questions: [
          {
            id: randomUUID(),
            type: "true_false",
            prompt: "Synthetic saved answers can be summarized.",
            choices: [
              { id: choiceId, label: "True", isCorrect: true },
              { id: randomUUID(), label: "False", isCorrect: false },
            ],
            timeLimitSeconds: 300,
            basePoints: 100,
            explanation: "Synthetic private explanation.",
            mediaId: null,
            mediaAlt: null,
          },
        ],
      },
    });
  }
}

async function createFinishedPresentation(
  page: Page,
  guests: APIRequestContext,
): Promise<SummaryFixture> {
  const title = `Synthetic shared Presentation ${randomUUID().slice(0, 8)}`;
  const presentation = (
    await (
      await post(
        page.request,
        "/v1/presentations",
        { title, description: "Synthetic sharing fixture" },
        201,
      )
    ).json()
  ).presentation;
  const blockId = randomUUID();
  const questionId = randomUUID();
  const choiceId = randomUUID();
  const savedResponse = await page.request.put(`${api}/v1/presentations/${presentation.id}/draft`, {
    data: {
      expectedRevision: presentation.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
      draft: {
        ...presentation.draft,
        blocks: [
          {
            id: blockId,
            kind: "question",
            question: {
              id: questionId,
              type: "single_select",
              prompt: "Synthetic Presentation evidence can be shared.",
              purpose: "diagnostic",
              confidence: "off",
              delivery: "main",
              conceptKeys: [],
              linkedRecheckQuestionId: null,
              timeLimitSeconds: 300,
              basePoints: 100,
              explanation: "Synthetic private explanation.",
              mediaId: null,
              mediaAlt: null,
              choices: [
                { id: choiceId, label: "Option one", isCorrect: true },
                { id: randomUUID(), label: "Option two", isCorrect: false },
              ],
            },
          },
        ],
      },
    },
  });
  expect(savedResponse.status()).toBe(200);
  const saved = await savedResponse.json();
  await post(
    page.request,
    `/v1/presentations/${presentation.id}/publish`,
    { expectedDraftRevision: saved.presentation.draftRevision },
    200,
  );
  const created = await (
    await post(page.request, "/v1/presentation-sessions", { presentationId: presentation.id }, 201)
  ).json();
  const sessionId = created.snapshot.sessionId;
  const aliases: string[] = [];
  const ids: string[] = [sessionId, presentation.id, blockId, questionId];
  const tokens: string[] = [];
  for (let index = 0; index < 5; index++) {
    const nickname = `SyntheticPrivatePresenter${index}`;
    const guest = await (
      await post(
        guests,
        "/v1/presentation-sessions/join",
        { code: created.snapshot.code, nickname },
        201,
      )
    ).json();
    aliases.push(nickname);
    ids.push(guest.snapshot.participantId);
    tokens.push(guest.participantToken);
  }
  async function advance() {
    const current = await page.request.get(`${api}/v1/presentation-sessions/${sessionId}`);
    expect(current.status()).toBe(200);
    return (
      await (
        await post(
          page.request,
          `/v1/presentation-sessions/${sessionId}/advance`,
          {
            expectedRevision: (await current.json()).snapshot.revision,
          },
          200,
        )
      ).json()
    ).snapshot;
  }
  const opened = await advance();
  expect(opened.phase).toBe("question_open");
  for (const participantToken of tokens) {
    await post(
      guests,
      `/v1/presentation-sessions/${sessionId}/responses`,
      {
        participantToken,
        blockId,
        expectedRevision: opened.revision,
        idempotencyKey: randomUUID(),
        response: { choiceIds: [choiceId] },
      },
      202,
    );
  }
  await advance();
  expect((await advance()).phase).toBe("finished");
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${api}/v1/presentation-sessions/${sessionId}/report`,
        );
        expect([200, 202]).toContain(response.status());
        return (await response.json()).reportStatus;
      },
      { timeout: 30_000 },
    )
    .toBe("ready");
  return {
    source: { kind: "presentation", id: sessionId },
    title,
    pagePath: `/presentation-session/${sessionId}/report`,
    privateAliases: aliases,
    privateIds: ids,
  };
}

async function createClosedSurvey(page: Page, guests: APIRequestContext): Promise<SummaryFixture> {
  const title = `Synthetic shared Survey ${randomUUID().slice(0, 8)}`;
  const survey = (
    await (
      await post(
        page.request,
        "/v1/surveys",
        { title, templateId: "training-feedback", idempotencyKey: randomUUID() },
        201,
      )
    ).json()
  ).survey;
  const saved = await page.request.put(`${api}/v1/surveys/${survey.id}`, {
    data: {
      draft: { ...survey.draft, title },
      expectedRevision: survey.revision,
      idempotencyKey: randomUUID(),
    },
  });
  expect(saved.status()).toBe(200);
  const updatedSurvey = (await saved.json()).survey;
  const published = await (
    await post(
      page.request,
      `/v1/surveys/${survey.id}/publish`,
      { expectedRevision: updatedSurvey.revision, idempotencyKey: randomUUID() },
      200,
    )
  ).json();
  const room = (
    await (
      await post(
        page.request,
        `/v1/surveys/${survey.id}/rooms`,
        {
          expectedRevision: published.survey.revision,
          idempotencyKey: randomUUID(),
          windowDays: 7,
        },
        201,
      )
    ).json()
  ).room;
  for (let index = 0; index < 5; index++) {
    const headers = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
    const attempt = (
      await (await post(guests, "/v1/survey-rooms/join", { code: room.code }, 200, headers)).json()
    ).attempt;
    const responses = Object.fromEntries(
      attempt.content.items.map(
        ({
          question,
        }: {
          question: { id: string; type: string; min?: number; choices?: Array<{ id: string }> };
        }) => [
          question.id,
          question.type === "poll"
            ? { kind: "poll", choiceIds: [question.choices![0]!.id] }
            : { kind: "rating", value: question.min ?? 1 },
        ],
      ),
    );
    await post(
      guests,
      `/v1/survey-rooms/${room.id}/submit`,
      { idempotencyKey: randomUUID(), expectedRevision: 0, responses },
      200,
      headers,
    );
  }
  // Admission and submission stay open until the real organizer control closes them.
  await page.goto(`/surveys/rooms/${room.id}`);
  await expect(page.getByRole("button", { name: "Share summary", exact: true })).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.getByRole("button", { name: "Close admissions and submissions", exact: true }).click();
  await expect(page.getByRole("table")).toHaveCount(survey.draft.items.length);
  return {
    source: { kind: "survey", id: room.id },
    title,
    pagePath: `/surveys/rooms/${room.id}`,
    privateAliases: [],
    privateIds: [room.id, survey.id],
  };
}

async function downloadBytes(
  page: Page,
  scope: Locator,
  name: string,
  extension: "pdf" | "png" | "xlsx",
) {
  let download: Download;
  try {
    [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 35_000 }),
      scope.getByRole("button", { name, exact: true }).click({ timeout: 15_000 }),
    ]);
  } catch {
    throw new Error(
      `${name} did not produce a download. Recent summary requests: ${networkDiagnostics(page)}`,
    );
  }
  expect(download.suggestedFilename()).toBe(`polling-pops-session-summary.${extension}`);
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  expect(bytes.length).toBeGreaterThan(100);
  if (extension === "pdf") expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  if (extension === "png") expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  if (extension === "xlsx") expect(bytes.subarray(0, 2).toString()).toBe("PK");
  return bytes;
}

async function accessibleAt320px(page: Page, dialog?: Locator) {
  await page.setViewportSize({ width: 320, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  if (dialog) {
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await dialog.getByRole("button", { name: "Close", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  const computedColors = () =>
    page.evaluate(() => ({
      mode: document.documentElement.dataset.colorMode,
      readyState: document.readyState,
      animations: document.getAnimations().filter((animation) => animation.playState === "running")
        .length,
      nodes: ["html", "body", "main", "article", "h1", "dt", "dd", "caption", "label"].map(
        (selector) => {
          const element = document.querySelector(selector);
          const style = element ? getComputedStyle(element) : null;
          return {
            selector,
            color: style?.color,
            textFillColor: style?.getPropertyValue("-webkit-text-fill-color"),
            textToken: style?.getPropertyValue("--ui-text"),
          };
        },
      ),
    }));
  const { violations } = await new AxeBuilder({ page }).analyze();
  if (violations.length) {
    const diagnostic = await computedColors();
    await test.info().attach("summary-accessibility-computed-colors", {
      body: JSON.stringify(diagnostic, null, 2),
      contentType: "application/json",
    });
  }
  expect(violations).toEqual([]);
}

for (const mobile of [false, true]) {
  test(`${mobile ? "@mobile " : ""}session summaries publish real Round, Presentation and closed Survey evidence with private capabilities`, async ({
    page,
    browser,
    request,
  }) => {
    test.skip(
      process.env.BETA_E2E_SESSION_SUMMARIES !== "true",
      "Opt-in session summary writer journey",
    );
    test.setTimeout(240_000);
    page.setDefaultTimeout(15_000);
    observeSummaryNetwork(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await signInBeta(page);
    await page.waitForLoadState("networkidle");
    const { isMobile, hasTouch, userAgent, deviceScaleFactor } = test.info().project.use;
    const publicContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: page.viewportSize()!,
      colorScheme: "dark",
      reducedMotion: "reduce",
      acceptDownloads: true,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
    });
    // Even a browser holding an unrelated creator cookie must omit it on capability reads.
    await publicContext.addCookies([
      { name: "openround_creator", value: "synthetic-unrelated-cookie", url: api },
    ]);
    const visitor = await publicContext.newPage();
    visitor.setDefaultTimeout(15_000);
    observeSummaryNetwork(visitor);
    const observed: Array<
      Promise<{
        path: string;
        method: string;
        query: string;
        hasCookie: boolean;
        hasBearer: boolean;
        hasReferrer: boolean;
      }>
    > = [];
    visitor.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.origin !== api ||
        !url.pathname.startsWith("/v1/shared-session-summaries/") ||
        !["GET", "POST"].includes(request.method())
      )
        return;
      observed.push(
        request.allHeaders().then((headers) => ({
          path: url.pathname,
          method: request.method(),
          query: url.search,
          hasCookie: Boolean(headers.cookie),
          hasBearer: /^Bearer /.test(headers.authorization ?? ""),
          hasReferrer: Boolean(headers.referer),
        })),
      );
    });
    let primaryFailure: unknown = null;
    try {
      for (const create of [createFinishedRound, createFinishedPresentation, createClosedSurvey]) {
        const fixture = await create(page, request);
        await test.step(`${fixture.source.kind} summary publication and anonymous reading`, async () => {
          await page.goto(fixture.pagePath);
          const open = page.getByRole("button", { name: "Share summary", exact: true });
          await expect(open).toBeVisible();
          await open.click();
          const dialog = page.getByRole("dialog", { name: "Share summary", exact: true });
          await expect(dialog).toBeVisible();
          await expect(
            dialog.getByRole("heading", { name: fixture.title, exact: true }),
          ).toBeVisible();
          await accessibleAt320px(page, dialog);
          await page.keyboard.press("Escape");
          await expect(dialog).not.toBeVisible();
          await expect(open).toBeFocused();
          await open.click();
          await expect(
            dialog.getByRole("heading", { name: fixture.title, exact: true }),
          ).toBeVisible();
          const nextSteps = `Synthetic ${fixture.source.kind} next steps: review aggregate evidence. ${"LongUnbrokenEvidence".repeat(10)}`;
          await dialog.getByLabel("Next steps", { exact: true }).fill(nextSteps);
          await dialog.getByLabel("Link lifetime in days (1–30)", { exact: true }).fill("1");
          await page.screenshot({
            path: test.info().outputPath(`summary-${fixture.source.kind}-dialog-dark-320.png`),
            fullPage: true,
          });
          await expect(
            dialog.getByLabel("Allow recipients to download this summary", { exact: true }),
          ).toBeChecked();
          const [response] = await Promise.all([
            waitForSummaryResponse(
              page,
              "POST",
              `/v1/session-summaries/${fixture.source.kind}/${fixture.source.id}/shares`,
            ),
            dialog.getByRole("button", { name: "Create share link", exact: true }).click(),
          ]);
          expect(response.status()).toBe(201);
          const created = CreatedSummaryShareSchema.parse(await response.json());
          expect(created.replayed).toBe(false);
          expect(created.url).not.toBeNull();
          await expect(dialog.getByLabel("Share link", { exact: true })).toHaveValue(created.url!);
          expect(new URL(created.url!).search).toBe("");
          expect(new URL(created.url!).hash.startsWith("#token=")).toBe(true);
          await page.evaluate(() =>
            Object.defineProperty(navigator, "clipboard", {
              configurable: true,
              value: {
                writeText: async () => {
                  throw new DOMException("Synthetic clipboard denial", "NotAllowedError");
                },
              },
            }),
          );
          await dialog.getByRole("button", { name: "Copy link", exact: true }).click();
          await expect(dialog.getByRole("alert")).toContainText(
            "Copy was blocked. Select and copy the link instead.",
          );
          const wholeImage = await downloadBytes(page, dialog, "Download image", "png");
          await downloadBytes(page, dialog, "Download PDF", "pdf");
          await downloadBytes(page, dialog, "Download spreadsheet", "xlsx");
          await expect(
            dialog.getByRole("button", { name: "Revoke link", exact: true }),
          ).toBeEnabled();
          const [publicResponse, documentResponse] = await Promise.all([
            waitForSummaryResponse(
              visitor,
              "GET",
              `/v1/shared-session-summaries/${created.share.id}`,
            ),
            visitor.goto(created.url!),
          ]);
          expect(documentResponse?.headers()["referrer-policy"]).toBe("no-referrer");
          expect(documentResponse?.headers()["x-robots-tag"]).toContain("noindex");
          expect(publicResponse.status()).toBe(200);
          const shared = SharedSessionSummarySchema.parse(await publicResponse.json());
          expect(shared.summary.title).toBe(fixture.title);
          expect(shared.summary.nextSteps).toBe(nextSteps);
          expect(shared.summary.participantCount).toBe(5);
          for (const excluded of [...fixture.privateAliases, ...fixture.privateIds]) {
            expect(typeof excluded).toBe("string");
            expect(excluded.length).toBeGreaterThan(0);
            expect(JSON.stringify(shared)).not.toContain(excluded);
          }
          await expect(
            visitor.getByRole("heading", { level: 1, name: fixture.title, exact: true }),
          ).toBeVisible();
          await expect(visitor.getByText(nextSteps, { exact: true })).toBeVisible();
          await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute(
            "content",
            /noindex/,
          );
          await accessibleAt320px(visitor);
          if (fixture.source.kind === "survey")
            await expect(visitor.getByRole("table")).toHaveCount(shared.summary.questions.length);
          await visitor
            .getByLabel("Image content", { exact: true })
            .selectOption(String(shared.summary.questions[0]!.index));
          const [exported, selectedImage] = await Promise.all([
            waitForSummaryResponse(
              visitor,
              "POST",
              `/v1/shared-session-summaries/${created.share.id}/export`,
            ),
            downloadBytes(visitor, visitor.getByRole("main"), "Download image", "png"),
          ]);
          expect(exported.request().postDataJSON()).toEqual({
            format: "png",
            locale: "en-CA",
            questionIndex: shared.summary.questions[0]!.index,
          });
          expect(selectedImage.equals(wholeImage)).toBe(false);
          await downloadBytes(visitor, visitor.getByRole("main"), "Download PDF", "pdf");
          await visitor.screenshot({
            path: test.info().outputPath(`summary-${fixture.source.kind}-public-dark-320.png`),
            fullPage: true,
          });
          const [revokedResponse] = await Promise.all([
            waitForSummaryResponse(
              page,
              "DELETE",
              `/v1/session-summaries/${fixture.source.kind}/${fixture.source.id}/shares/${created.share.id}`,
            ),
            dialog.getByRole("button", { name: "Revoke link", exact: true }).click(),
          ]);
          expect(revokedResponse.status()).toBe(204);
          await expect(
            dialog.getByRole("status").filter({ hasText: "Share link revoked." }),
          ).toBeVisible();
          await expect(dialog.getByLabel("Share link", { exact: true })).toHaveCount(0);
          let downloadsAfterRevocation = 0;
          visitor.on("download", () => {
            downloadsAfterRevocation += 1;
          });
          const [rejectedResponse] = await Promise.all([
            waitForSummaryResponse(
              visitor,
              "POST",
              `/v1/shared-session-summaries/${created.share.id}/export`,
            ),
            visitor.getByRole("button", { name: "Download PDF", exact: true }).click(),
          ]);
          expect(rejectedResponse.status()).toBe(404);
          await expect(visitor.getByRole("main").getByRole("alert")).toContainText(
            "The download could not finish.",
          );
          expect(downloadsAfterRevocation).toBe(0);
          await visitor.reload();
          await expect(visitor.getByRole("main").getByRole("alert")).toContainText(
            "This summary is unavailable.",
          );
          await expect(
            visitor.getByRole("heading", { name: fixture.title, exact: true }),
          ).toHaveCount(0);
          await expect(
            visitor.getByRole("button", { name: "Download PDF", exact: true }),
          ).toHaveCount(0);
          await page.keyboard.press("Escape");
          await expect(open).toBeFocused();
          if (fixture.source.kind === "round") {
            // The same real retained report exposes summary sharing in the classic UI too.
            await page.route(`${api}/v1/auth/me`, async (route) => {
              const accountResponse = await route.fetch();
              const account = await accountResponse.json();
              await route.fulfill({
                response: accountResponse,
                json: {
                  ...account,
                  productFeatures: { ...account.productFeatures, uxBeta: false },
                },
              });
            });
            await page.reload();
            await expect(
              page.getByRole("button", { name: "Share summary", exact: true }),
            ).toBeVisible();
            await expect(
              page.getByRole("link", { name: "Download CSV", exact: true }),
            ).toBeVisible();
            await page.unroute(`${api}/v1/auth/me`);
          }
        });
      }
      const requests = await Promise.all(observed);
      expect(requests.length).toBeGreaterThanOrEqual(15);
      for (const request of requests)
        expect(request).toMatchObject({
          query: "",
          hasCookie: false,
          hasBearer: true,
          hasReferrer: false,
        });
    } catch (error) {
      primaryFailure = error;
    }
    try {
      await publicContext.close();
    } catch (cleanupError) {
      // Preserve the original assertion/action failure when Playwright has already ended the test.
      if (primaryFailure === null) primaryFailure = cleanupError;
    }
    if (primaryFailure !== null) throw primaryFailure;
  });
}
