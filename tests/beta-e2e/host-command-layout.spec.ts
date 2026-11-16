import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { currentRoundClientCapabilities } from "../../packages/contracts/src/round-protocol";
import { signInBeta } from "./sign-in";
import {
  closeHostControls,
  expectControlLabelCentered,
  expectHostActionRow,
  openHostControls,
} from "./host-controls";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const confidenceName = "Ask for confidence (optional)";

interface SessionFixture {
  sessionId: string;
  code: string;
  hostToken: string;
  snapshot: { settings: { confidenceEnabled: boolean } };
}

async function openCrowdedRecoveryBar(page: Page) {
  const host = page;
  await signInBeta(page);
  const correctChoiceId = randomUUID();
  const created = await host.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title: "Crowded host command layout" },
  });
  expect(created.status()).toBe(201);
  const quizId = (await created.json()).quiz.id as string;
  const updated = await host.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
    data: {
      title: "Crowded host command layout",
      description: "Real revealed-question recovery controls at responsive breakpoints.",
      experiencePreset: { id: "focus", version: 1 },
      questions: [
        {
          id: randomUUID(),
          type: "single_select",
          purpose: "diagnostic",
          confidence: "required",
          prompt: "Which state confirms that a response was saved?",
          choices: [
            { id: correctChoiceId, label: "The server acknowledged the save", isCorrect: true },
            { id: randomUUID(), label: "An answer was highlighted", isCorrect: false },
          ],
          timeLimitSeconds: 30,
          basePoints: 1000,
          explanation: "The server acknowledges the answer after committing it.",
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
        resultVisibility: "leaderboard",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    },
  });
  expect(hosted.status()).toBe(201);
  const session = (await hosted.json()) as SessionFixture;
  expect(session.snapshot.settings.confidenceEnabled).toBe(false);
  const joined = await host.request.post(`${apiUrl}/v1/sessions/join`, {
    data: {
      code: session.code,
      nickname: "Layout Learner",
      clientCapabilities: currentRoundClientCapabilities(),
    },
  });
  expect(joined.status()).toBe(201);
  const { participantToken } = (await joined.json()) as { participantToken: string };
  await host.evaluate(({ sessionId, hostToken }) => {
    sessionStorage.setItem(`openround:host:${sessionId}`, hostToken);
  }, session);
  await host.goto(`/host/${session.sessionId}`);
  await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "lobby");
  await host.getByRole("button", { name: "Start round", exact: true }).click();
  await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "question_open");
  const current = await host.request.get(
    `${apiUrl}/v1/sessions/${session.sessionId}/snapshot?role=participant`,
    { headers: { authorization: `Bearer ${participantToken}` } },
  );
  expect(current.ok()).toBe(true);
  const { snapshot } = await current.json();
  const answered = await host.request.post(`${apiUrl}/v1/sessions/${session.sessionId}/answers`, {
    headers: { authorization: `Bearer ${participantToken}` },
    data: {
      roundId: snapshot.roundId,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
      clientCapabilities: currentRoundClientCapabilities(),
    },
  });
  expect(answered.ok()).toBe(true);
  expect(await answered.json()).toMatchObject({ accepted: true });
  await host.getByRole("button", { name: "Lock answers", exact: true }).click();
  await host.getByRole("button", { name: "Reveal answer", exact: true }).click();
  await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "question_reveal");
  const bar = host.getByTestId("host-command-bar");
  await expect(bar.getByRole("button", { name: "Finish round", exact: true })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Audience", exact: true })).toBeVisible();
  await openHostControls(host);
  for (const name of [
    "Audience",
    "Explain or reinforce",
    "Work an example",
    "Show standings",
    "End",
    "Finish round",
  ]) {
    await expect(bar.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(bar.getByRole("checkbox", { name: confidenceName, exact: true })).not.toBeChecked();
  return { session, bar };
}

async function expectContainedAndReadable(host: Page, bar: Locator, width: number, height = 900) {
  await host.setViewportSize({ width, height });
  await closeHostControls(bar);
  await host.evaluate(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
  );
  const primary = bar.getByRole("button", { name: "Finish round", exact: true });
  await expect(primary).toBeInViewport();
  await expect(primary).toBeEnabled();
  const compact = await bar.evaluate((element) => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    height: element.getBoundingClientRect().height,
    bottom: element.getBoundingClientRect().bottom,
    viewportHeight: window.innerHeight,
    position: getComputedStyle(element).position,
  }));
  expect(compact.overflow, `${width}px document overflow`).toBeLessThanOrEqual(1);
  expect(compact.height, `${width}px compact primary controls`).toBeLessThanOrEqual(150);
  expect(compact.bottom).toBeLessThanOrEqual(compact.viewportHeight + 1);
  expect(compact.position).toBe("sticky");
  await expect(bar.getByRole("button", { name: "Audience", exact: true })).toBeVisible();
  await expectHostActionRow(bar, "Finish round", width >= 1024, true);
  await host.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(() => host.evaluate(() => window.scrollY)).toBe(0);
  await expectControlLabelCentered(host.locator(".experience-preferences > summary"));
  const before = await host.evaluate(() => {
    const top = (testId: string) =>
      document.querySelector(`[data-testid="${testId}"]`)!.getBoundingClientRect().top +
      window.scrollY;
    return { stageTop: top("host-stage"), railTop: top("recovery-rail") };
  });
  await openHostControls(host);
  await expect(bar).toHaveCSS("position", "static");
  const panel = bar.getByTestId("host-command-tools");
  await expect(panel).toBeVisible();
  await expectHostActionRow(bar, "Finish round", width >= 1024, true);
  const geometry = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const bar = element.closest('[data-testid="host-command-bar"]')!;
    const barRect = bar.getBoundingClientRect();
    const stage = document.querySelector('[data-testid="host-stage"]')!.getBoundingClientRect();
    const rail = document.querySelector('[data-testid="recovery-rail"]')!.getBoundingClientRect();
    const label = element
      .querySelector<HTMLLabelElement>(".host-confidence-control label")!
      .getBoundingClientRect();
    const controls = [...element.querySelectorAll<HTMLElement>("button, input[type=checkbox]")]
      .filter((control) => control.getClientRects().length > 0)
      .map((control) => {
        const r = control.getBoundingClientRect();
        return { left: r.left, right: r.right };
      });
    return {
      left: rect.left,
      right: rect.right,
      height: rect.height,
      bottom: rect.bottom + window.scrollY,
      barLeft: barRect.left,
      barRight: barRect.right,
      barBottom: barRect.bottom + window.scrollY,
      stageTop: stage.top + window.scrollY,
      railTop: rail.top + window.scrollY,
      position: getComputedStyle(element).position,
      viewportWidth: window.innerWidth,
      labelWidth: label.width,
      labelHeight: label.height,
      controls,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.position).not.toBe("absolute");
  expect(geometry.position).not.toBe("fixed");
  expect(geometry.left - geometry.barLeft).toBeLessThanOrEqual(28);
  expect(geometry.barRight - geometry.right).toBeLessThanOrEqual(28);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.barBottom + 1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.stageTop);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.railTop);
  expect(geometry.stageTop - before.stageTop).toBeGreaterThanOrEqual(geometry.height - 1);
  expect(geometry.railTop - before.railTop).toBeGreaterThanOrEqual(geometry.height - 1);
  expect(geometry.labelWidth).toBeGreaterThanOrEqual(100);
  expect(geometry.labelHeight).toBeLessThanOrEqual(80);
  expect(geometry.controls.length).toBe(5);
  for (const control of geometry.controls) {
    expect(control.left).toBeGreaterThanOrEqual(geometry.left - 1);
    expect(control.right).toBeLessThanOrEqual(geometry.right + 1);
  }
  for (const control of await panel.locator("button, input[type=checkbox]").all()) {
    await expect(control).toBeEnabled();
    await control.click({ trial: true });
  }
  for (const control of await panel.locator("button, .host-confidence-control label").all()) {
    await expectControlLabelCentered(control);
  }
}

async function expectExpandedToolsFromBottom(host: Page, bar: Locator) {
  await closeHostControls(bar);
  await host.evaluate(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
  );
  const toggle = bar.getByTestId("host-command-tools-toggle");
  await expect(toggle).toBeInViewport();
  await openHostControls(host);
  const tools = bar.getByTestId("host-command-tools");
  await expect(bar).toHaveCSS("position", "static");
  await expect(toggle).toBeInViewport();
  await expect(tools).toBeInViewport({ ratio: 1 });
  const geometry = await tools.evaluate((element) => ({
    bottom: element.getBoundingClientRect().bottom + window.scrollY,
    stageTop:
      document.querySelector('[data-testid="host-stage"]')!.getBoundingClientRect().top +
      window.scrollY,
    railTop:
      document.querySelector('[data-testid="recovery-rail"]')!.getBoundingClientRect().top +
      window.scrollY,
  }));
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.stageTop);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.railTop);
  await expectHostActionRow(bar, "Finish round", true, true);
}

async function toggleConfidence(
  host: Page,
  bar: Locator,
  session: SessionFixture,
  enabled: boolean,
) {
  const checkbox = bar.getByRole("checkbox", { name: confidenceName, exact: true });
  await checkbox.setChecked(enabled);
  if (enabled) await expect(checkbox).toBeChecked();
  else await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeEnabled();
  const state = await host.request.get(
    `${apiUrl}/v1/sessions/${session.sessionId}/snapshot?role=host`,
    { headers: { authorization: `Bearer ${session.hostToken}` } },
  );
  expect(state.ok()).toBe(true);
  expect((await state.json()).snapshot).toMatchObject({
    phase: "question_reveal",
    settings: { confidenceEnabled: enabled },
  });
}

async function captureBar(host: Page, bar: Locator, width: number, testInfo: TestInfo) {
  const path = testInfo.outputPath(`host-command-reveal-${width}.png`);
  await bar.screenshot({ path });
  await testInfo.attach(`crowded recovery command bar ${width}px`, {
    path,
    contentType: "image/png",
  });
  if (width === 1214) {
    await host.screenshot({
      path: testInfo.outputPath("host-question-reveal-1214.png"),
      fullPage: true,
    });
    await closeHostControls(bar);
    await host.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await host.screenshot({
      path: testInfo.outputPath("host-question-reveal-closed-1214.png"),
      fullPage: true,
    });
    await openHostControls(host);
  }
}

async function expectLongLocaleOnPhone(host: Page, bar: Locator, testInfo: TestInfo) {
  const locale = async (value: "de-DE" | "en-CA") => {
    const response = await host.request.put(`${apiUrl}/v1/account/locale`, {
      data: { locale: value },
    });
    expect(response.status()).toBe(200);
    await host
      .context()
      .addCookies([
        { name: "openround-locale", value, url: new URL(host.url()).origin, sameSite: "Lax" },
      ]);
  };
  try {
    await locale("de-DE");
    await host.setViewportSize({ width: 320, height: 900 });
    await host.reload();
    await expect(host.locator("html")).toHaveAttribute("lang", "de-DE");
    await closeHostControls(bar);
    const primaryName = await bar.locator(".host-command-primary button").innerText();
    await expectHostActionRow(bar, primaryName, false);
    await expectControlLabelCentered(host.locator(".experience-preferences > summary"));
    expect(
      await bar.evaluate((element) => element.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(150);
    await openHostControls(host);
    for (const control of await bar
      .getByTestId("host-command-tools")
      .locator("button, label")
      .all()) {
      await expectControlLabelCentered(control);
    }
    expect(
      await host.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    const path = testInfo.outputPath("host-command-german-320.png");
    await bar.screenshot({ path });
    await testInfo.attach("German host controls at 320px", { path, contentType: "image/png" });
  } finally {
    await locale("en-CA");
  }
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`crowded revealed-question commands keep confidence readable across breakpoints ${suffix}`, async ({
    page: host,
  }, testInfo) => {
    test.setTimeout(90_000);
    await host.setViewportSize({ width: 1214, height: 900 });
    const { session, bar } = await openCrowdedRecoveryBar(host);
    const widths =
      suffix === "desktop" ? [1366, 1280, 1214, 1024, 821, 820, 768] : [821, 820, 768, 390, 320];
    for (const width of widths) {
      await expectContainedAndReadable(host, bar, width);
      if (width === 1214 || width === 320) {
        await captureBar(host, bar, width, testInfo);
        await toggleConfidence(host, bar, session, true);
        await expectContainedAndReadable(host, bar, width);
        await toggleConfidence(host, bar, session, false);
      }
    }
    if (suffix === "desktop") {
      await expectContainedAndReadable(host, bar, 1214, 640);
      await expectExpandedToolsFromBottom(host, bar);
    } else await expectLongLocaleOnPhone(host, bar, testInfo);
  });
}
