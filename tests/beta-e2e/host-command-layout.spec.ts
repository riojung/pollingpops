import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { currentRoundClientCapabilities } from "../../packages/contracts/src/round-protocol";
import { signInBeta } from "./sign-in";

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

async function expectContainedAndReadable(host: Page, bar: Locator, width: number) {
  await host.setViewportSize({ width, height: 900 });
  await bar.scrollIntoViewIfNeeded();
  const geometry = await bar.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const confidenceLabel = element.querySelector<HTMLLabelElement>(
      ".host-confidence-control label",
    )!;
    const label = confidenceLabel.getBoundingClientRect();
    const text = confidenceLabel.querySelector<HTMLElement>("span:not(.sr-only)")!;
    const textBounds = text.getBoundingClientRect();
    const controls = [...element.querySelectorAll<HTMLElement>("button, input[type=checkbox]")]
      .filter((control) => control.getClientRects().length > 0)
      .map((control) => {
        const rect = control.getBoundingClientRect();
        return {
          name: control.getAttribute("aria-label") ?? control.textContent?.trim() ?? control.id,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      });
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      barOverflow: element.scrollWidth - element.clientWidth,
      bar: {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        height: bounds.height,
      },
      label: { width: label.width, height: label.height },
      text: { value: text.textContent?.trim(), width: textBounds.width, height: textBounds.height },
      controls,
    };
  });
  expect(geometry.pageOverflow, `${width}px document overflow`).toBeLessThanOrEqual(1);
  expect(geometry.barOverflow, `${width}px command bar overflow`).toBeLessThanOrEqual(1);
  expect(geometry.bar.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.bar.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.bar.top).toBeGreaterThanOrEqual(-1);
  expect(geometry.bar.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.label.width, `${width}px readable confidence label`).toBeGreaterThanOrEqual(100);
  expect(geometry.label.height, `${width}px confidence label height`).toBeLessThanOrEqual(80);
  expect(geometry.text.value, `${width}px translated compact confidence label`).toBe("Confidence");
  expect(geometry.text.width, `${width}px confidence text width`).toBeGreaterThanOrEqual(60);
  expect(geometry.text.height, `${width}px confidence text height`).toBeLessThanOrEqual(56);
  if (width >= 1024)
    expect(geometry.bar.height, `${width}px compact desktop bar`).toBeLessThanOrEqual(140);
  else if (width >= 821)
    expect(geometry.bar.height, `${width}px wrapped desktop bar`).toBeLessThanOrEqual(190);
  expect(geometry.controls.length).toBe(7);
  for (const control of geometry.controls) {
    expect(control.left, `${width}px ${control.name} left`).toBeGreaterThanOrEqual(
      geometry.bar.left - 1,
    );
    expect(control.right, `${width}px ${control.name} right`).toBeLessThanOrEqual(
      geometry.bar.right + 1,
    );
    expect(control.top, `${width}px ${control.name} top`).toBeGreaterThanOrEqual(
      geometry.bar.top - 1,
    );
    expect(control.bottom, `${width}px ${control.name} bottom`).toBeLessThanOrEqual(
      geometry.bar.bottom + 1,
    );
  }
  for (const control of await bar.locator("button, input[type=checkbox]").all()) {
    if (await control.isVisible()) {
      await expect(control).toBeEnabled();
      await control.click({ trial: true });
    }
  }
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
  if (width === 1214)
    await host.screenshot({
      path: testInfo.outputPath("host-question-reveal-1214.png"),
      fullPage: true,
    });
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
  });
}
