import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
async function createSession(page: Page) {
  await signInBeta(page);
  const created = await page.request.post(`${apiUrl}/v1/presentations`, {
    data: { title: `Q&A fixture ${randomUUID().slice(0, 8)}`, description: "" },
  });
  expect(created.status()).toBe(201);
  const presentation = (await created.json()).presentation;
  const question = {
    id: randomUUID(),
    type: "single_select",
    prompt: "Synthetic checkpoint",
    choices: [
      { id: randomUUID(), label: "First option", isCorrect: true },
      { id: randomUUID(), label: "Second option", isCorrect: false },
    ],
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: [],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 120,
    basePoints: 100,
    explanation: "Private explanation",
    sourceCitations: [],
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
  const published = await page.request.post(
    `${apiUrl}/v1/presentations/${presentation.id}/publish`,
    {
      data: { expectedDraftRevision: (await saved.json()).presentation.draftRevision },
    },
  );
  expect(published.status()).toBe(200);
  const createdSession = await page.request.post(`${apiUrl}/v1/presentation-sessions`, {
    data: { presentationId: presentation.id },
  });
  expect(createdSession.status()).toBe(201);
  const { snapshot, controlToken } = await createdSession.json();
  await page.evaluate(
    ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
    { id: snapshot.sessionId, token: controlToken },
  );
  return { id: snapshot.sessionId as string, code: snapshot.code as string };
}

async function workflow(page: Page, browser: Browser, testInfo: TestInfo) {
  test.setTimeout(150_000);
  const room = await createSession(page);
  await page.goto(`/presentation-session/${room.id}/host`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Launch companion", exact: true }).click();
  const companion = await popup;
  await expect(companion.getByRole("heading", { name: "Presentation Companion" })).toBeVisible();
  const nativeRequests: Array<Promise<{ cookie?: string; url: string }>> = [];
  companion.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/v1/audience-scopes")) {
      nativeRequests.push(
        request.allHeaders().then((headers) => ({ cookie: headers.cookie, url: request.url() })),
      );
    }
  });
  const frames: string[] = [];
  companion.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => frames.push(payload.toString())),
  );
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
  const guestContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    reducedMotion: "reduce",
  });
  const peerContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const guest = await guestContext.newPage();
  const peer = await peerContext.newPage();
  const summary = (surface: Page) =>
    surface.locator("summary").filter({ hasText: "Questions and answers" });
  try {
    for (const [surface, alias] of [
      [guest, "Private learner alias"],
      [peer, "Other learner alias"],
    ] as const) {
      await surface.goto(`/join?code=${room.code}`);
      await surface.getByLabel("Nickname", { exact: true }).fill(alias);
      await surface.getByRole("button", { name: "Join a Presentation", exact: true }).click();
      await expect(surface).toHaveURL(`/presentation-session/${room.id}/play`);
    }
    await expect(
      guest.getByText("Audience Q&A will appear when the facilitator activates it."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Activate audience Q&A", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Enable Q&A", exact: true })).toBeChecked();
    for (const surface of [guest, peer, companion]) {
      await summary(surface).focus();
      await summary(surface).press("Enter");
    }
    await expect(
      companion.getByText("Companion Q&A is read-only. Use the host window to moderate questions."),
    ).toBeVisible();
    await expect(companion.getByLabel("Ask the facilitator", { exact: true })).toHaveCount(0);
    await expect(companion.getByRole("checkbox", { name: "Enable Q&A", exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("checkbox", { name: "Allow participant replies", exact: true }),
    ).toHaveCount(0);
    await expect(
      guest.getByText(
        "The facilitator can see your session alias. Anonymous public display hides it from the room, not from the facilitator.",
      ),
    ).toBeVisible();

    const body = "Could you give a synthetic example?";
    const commands: unknown[] = [];
    let dropped = false;
    await guest.route(`**/v1/audience-scopes/${room.id}/qna/commands`, async (route) => {
      const command = route.request().postDataJSON().command;
      if (command.type === "question.create") {
        commands.push(command);
        if (!dropped) {
          dropped = true;
          const committed = await route.fetch();
          expect(committed.status()).toBe(200);
          await route.abort("failed");
          return;
        }
      }
      await route.continue();
    });
    await guest.getByLabel("Ask the facilitator", { exact: true }).fill(body);
    await guest.getByRole("button", { name: "Ask question", exact: true }).click();
    await expect(
      guest.getByRole("button", { name: "Retry the same Q&A action", exact: true }),
    ).toBeVisible();
    await summary(guest).click();
    await summary(guest).click();
    await guest.getByRole("button", { name: "Retry the same Q&A action", exact: true }).click();
    await expect(
      guest.getByRole("button", { name: "Retry the same Q&A action", exact: true }),
    ).toHaveCount(0);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual(commands[1]);
    await expect(page.locator(".qna-question").filter({ hasText: body })).toHaveCount(1);
    await expect(page.locator(".qna-question")).toContainText("Private learner alias");
    await expect(peer.locator(".qna-question-body")).toHaveCount(0);
    await expect(companion.locator(".qna-question-body")).toHaveCount(0);
    expect(frames.join("\n")).not.toContain(body);
    expect(frames.join("\n")).not.toContain("Private learner alias");

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(peer.locator(".qna-question")).toContainText(body);
    await expect(peer.locator(".qna-question-meta")).toContainText("Anonymous");
    await expect(companion.locator(".qna-question")).toContainText(body);
    await expect(companion.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);
    await peer.getByRole("button", { name: "I have this question", exact: true }).click();
    await expect(page.locator(".qna-question-meta")).toContainText("1 vote");
    await guest.reload();
    await summary(guest).click();
    await expect(guest.locator(".qna-question")).toHaveCount(1);
    for (const surface of [page, guest, companion]) {
      expect(
        (await new AxeBuilder({ page: surface }).include("[data-presentation-qna]").analyze())
          .violations,
      ).toEqual([]);
      expect(
        await surface.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    const captured = await Promise.all(nativeRequests);
    expect(captured.length).toBeGreaterThan(0);
    expect(
      captured.every(
        (request) => !request.cookie && !/[?#].*(token|credential|pass)=/.test(request.url),
      ),
    ).toBe(true);
    // Fail the only invalidation read for removal while the audience socket stays connected.
    // No later mutation/manual refresh may be required to restore authorized current state.
    let recoveryReads = 0;
    await peer.route(`**/v1/audience-scopes/${room.id}/qna/questions?**`, async (route) => {
      recoveryReads += 1;
      if (recoveryReads === 1) {
        await route.fulfill({
          status: 503,
          json: {
            error: { code: "TEMPORARY_UNAVAILABLE", message: "Temporary audience read failure" },
          },
        });
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect.poll(() => recoveryReads).toBeGreaterThanOrEqual(2);
    await expect(peer.locator(".qna-panel .error")).toHaveCount(0);
    await expect(peer.locator(".qna-question-body")).toHaveCount(0);
    await expect(companion.locator(".qna-question-body")).toHaveCount(0);
    await peer.reload();
    await summary(peer).click();
    await expect(peer.locator(".qna-question-body")).toHaveCount(0);
    await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
    await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
    await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
    await expect(
      guest.getByText("This Presentation has ended. Q&A is now read-only."),
    ).toBeVisible();
    await expect(guest.getByLabel("Ask the facilitator", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Enable Q&A", exact: true })).toBeDisabled();
  } finally {
    await guestContext.close();
    await peerContext.close();
    await companion.close();
  }
}

test("Presentation Q&A activation, moderation, private projections, exact retry and closed state", async ({
  page,
  browser,
}, testInfo) => workflow(page, browser, testInfo));
test("Presentation Q&A keyboard, resume and read-only Companion @mobile", async ({
  page,
  browser,
}, testInfo) => workflow(page, browser, testInfo));

test("Slow Presentation Q&A reads make progress under overlapping refreshes", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const room = await createSession(page);
  await page.goto(`/presentation-session/${room.id}/host`);
  await page.getByRole("button", { name: "Activate audience Q&A", exact: true }).click();
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const guest = await context.newPage();
  let releaseFirst!: () => void;
  let releaseTrailing!: () => void;
  let firstStarted!: () => void;
  const firstRead = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const trailingGate = new Promise<void>((resolve) => {
    releaseTrailing = resolve;
  });
  let reads = 0;
  try {
    // A temporary discovery failure must recover without a user pressing Refresh.
    let discoveries = 0;
    await guest.route(`**/v1/audience-scopes/${room.id}/availability?**`, async (route) => {
      discoveries += 1;
      if (discoveries === 1)
        await route.fulfill({
          status: 429,
          json: { error: { code: "RATE_LIMITED", message: "Wait and retry discovery" } },
        });
      else await route.continue();
    });
    await guest.goto(`/join?code=${room.code}`);
    await guest.getByLabel("Nickname", { exact: true }).fill("Slow network fixture");
    await guest.getByRole("button", { name: "Join a Presentation", exact: true }).click();
    await expect(
      guest.locator("summary").filter({ hasText: "Questions and answers" }),
    ).toBeVisible();
    expect(discoveries).toBeGreaterThanOrEqual(2);
    await guest.locator("summary").filter({ hasText: "Questions and answers" }).click();
    await expect(guest.getByLabel("Ask the facilitator", { exact: true })).toBeVisible();
    const body = "Slow network question after startup";
    await guest.route(`**/v1/audience-scopes/${room.id}/qna/questions?**`, async (route) => {
      const response = await route.fetch();
      const current = await response.json();
      if (!current.questions.some((question: { body: string }) => question.body === body)) {
        await route.fulfill({ response });
        return;
      }
      const index = ++reads;
      if (index === 1) {
        firstStarted();
        await firstGate;
      } else await trailingGate;
      await route.fulfill({ response });
    });
    await guest.getByLabel("Ask the facilitator", { exact: true }).fill(body);
    await guest.getByRole("button", { name: "Ask question", exact: true }).click();
    await firstRead;
    for (let request = 0; request < 8; request++)
      await guest.locator(".qna-heading button").click();
    expect(reads).toBe(1);
    releaseFirst();
    // The queued refresh must not invalidate the successful active result.
    await expect(guest.locator(".qna-question-body")).toHaveText(body);
    await expect.poll(() => reads).toBe(2);
    releaseTrailing();
  } finally {
    releaseFirst();
    releaseTrailing();
    await context.close();
  }
});
