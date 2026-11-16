import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { currentRoundClientCapabilities } from "../../packages/contracts/src/round-protocol";
import { joinBetaRound } from "./round-join";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const nickname = "Private nested learner";
const chatBody = "Could we see a practical example before the next question?";
const chatReply = "We will work through one example together.";
const questionBody = "Why does a server acknowledgement confirm that a response was saved?";
const staffReply = "The acknowledgement follows a committed response on the server.";
type Appearance = "light" | "dark" | "app-high" | "system-high";
type Room = { sessionId: string; code: string; hostToken: string };

test.use({ actionTimeout: 15_000 });

async function createRoom(page: Page): Promise<Room> {
  await signInBeta(page);
  const created = await page.request.post(`${api}/v1/quizzes`, {
    data: { title: "Populated Round conversation surfaces" },
  });
  expect(created.status()).toBe(201);
  const quizId = (await created.json()).quiz.id as string;
  expect(
    (
      await page.request.patch(`${api}/v1/quizzes/${quizId}`, {
        data: {
          title: "Populated Round conversation surfaces",
          description: "Real nested conversation and staff controls.",
          experiencePreset: { id: "spark", version: 1 },
          questions: [
            {
              id: randomUUID(),
              type: "single_select",
              purpose: "diagnostic",
              confidence: "off",
              prompt: "Which event confirms a response was saved?",
              choices: [
                { id: randomUUID(), label: "A server acknowledgement", isCorrect: true },
                { id: randomUUID(), label: "A highlighted draft", isCorrect: false },
              ],
              timeLimitSeconds: 300,
              basePoints: 1000,
              explanation: "The server confirms a committed response.",
              mediaId: null,
              mediaAlt: null,
            },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  expect((await page.request.post(`${api}/v1/quizzes/${quizId}/publish`, { data: {} })).ok()).toBe(
    true,
  );
  const hosted = await page.request.post(`${api}/v1/sessions`, {
    data: {
      quizId,
      clientCapabilities: currentRoundClientCapabilities(),
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    },
  });
  expect(hosted.status()).toBe(201);
  const session = await hosted.json();
  expect(session.snapshot.experienceTheme.preset.id).toBe("spark");
  await page.evaluate(
    ({ sessionId, hostToken }) => sessionStorage.setItem(`openround:host:${sessionId}`, hostToken),
    session,
  );
  await page.goto(`/host/${session.sessionId}`);
  await expect(page.getByTestId("host-session")).toHaveAttribute("data-phase", "lobby");
  return session;
}

async function appearance(page: Page, mode: Appearance) {
  const color = mode === "light" ? "light" : "dark";
  await page.emulateMedia({
    colorScheme: color,
    reducedMotion: "reduce",
    contrast: mode === "system-high" ? "more" : "no-preference",
  });
  expect(await page.evaluate(() => matchMedia("(prefers-contrast: more)").matches)).toBe(
    mode === "system-high",
  );
  await page.evaluate((value) => {
    localStorage.setItem("openround:color-mode", value);
    window.dispatchEvent(new Event("openround:color-mode-change"));
  }, color);
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", color);
  const preferences = page.locator("details.experience-preferences");
  await preferences.locator("summary").click();
  await preferences
    .getByRole("checkbox", { name: "High contrast", exact: true })
    .setChecked(mode === "app-high");
  await expect(page.locator("html")).toHaveAttribute(
    "data-openround-contrast",
    mode === "app-high" ? "high" : "theme",
  );
  await preferences.locator("summary").click();
}

async function palette(
  target: Locator,
  background?: string,
  color = "--round-text",
  border?: string,
) {
  await expect(target).toBeVisible();
  const values = await target.evaluate(
    (element, tokens) => {
      const style = getComputedStyle(element);
      const normalize = (token: string) => {
        const value = style.getPropertyValue(token).trim();
        const sample = document.createElement("span");
        sample.style.color = value;
        if (!sample.style.color)
          throw new Error(`Expected a resolved Round color for ${token}: ${value}`);
        return sample.style.color;
      };
      return {
        background: style.backgroundColor,
        color: style.color,
        border: style.borderBottomColor,
        expectedBackground: tokens.background ? normalize(tokens.background) : null,
        expectedColor: normalize(tokens.color),
        expectedBorder: tokens.border ? normalize(tokens.border) : null,
      };
    },
    { background, color, border },
  );
  expect(values.color).toBe(values.expectedColor);
  if (background) expect(values.background).toBe(values.expectedBackground);
  if (border) expect(values.border).toBe(values.expectedBorder);
}

async function palettes(
  scope: Locator,
  selector: string,
  background: string,
  color = "--round-text",
) {
  const targets = scope.locator(selector);
  expect(await targets.count(), selector).toBeGreaterThan(0);
  for (const target of await targets.all())
    if (await target.isVisible()) await palette(target, background, color);
}

async function quality(page: Page, selector: string) {
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
}

async function capture(scope: Locator, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await scope.screenshot({ path, animations: "disabled", scale: "css" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function openDrawer(host: Page) {
  const drawer = host.getByTestId("audience-drawer");
  if (!(await drawer.isVisible()))
    await host
      .getByTestId("host-command-bar")
      .getByRole("button", { name: "Audience", exact: true })
      .click();
  await expect(drawer).toBeVisible();
  return drawer;
}

async function closeDrawer(host: Page) {
  const drawer = host.getByTestId("audience-drawer");
  if (await drawer.isVisible())
    await drawer.getByRole("button", { name: "Close audience tools", exact: true }).click();
  await expect(drawer).toBeHidden();
}

async function populate(host: Page, room: Room, participantToken: string) {
  const mutate = async <T = unknown>(
    token: string,
    method: string,
    path: string,
    data: unknown,
    expected = 200,
  ): Promise<T> => {
    const response = await host.request.fetch(`${api}/v1/sessions/${room.sessionId}/${path}`, {
      method,
      data,
      headers: { authorization: `Bearer ${token}`, "x-idempotency-key": randomUUID() },
    });
    expect(response.status(), `${method} ${path}`).toBe(expected);
    return expected === 204 ? (undefined as T) : (response.json() as Promise<T>);
  };
  await mutate(room.hostToken, "PATCH", "interactions/settings", {
    chatEnabled: true,
    chatIdentityMode: "alias_private",
    signalsEnabled: true,
    slowModeSeconds: 0,
  });
  const message = await mutate<{ id: string }>(
    participantToken,
    "POST",
    "chat/messages",
    { body: chatBody, replyToMessageId: null, idempotencyKey: randomUUID() },
    201,
  );
  await mutate(
    room.hostToken,
    "POST",
    "chat/messages",
    { body: chatReply, replyToMessageId: message.id, idempotencyKey: randomUUID() },
    201,
  );
  await mutate(participantToken, "PUT", `chat/messages/${message.id}/reaction`, {
    reaction: "like",
  });
  await mutate(participantToken, "PUT", "signals/current", {
    signal: "got_it",
    idempotencyKey: randomUUID(),
  });
  await mutate(room.hostToken, "PATCH", "qna/settings", {
    enabled: true,
    displayMode: "anonymous_public",
    moderationMode: "pre",
    participantReplies: true,
  });
  const question = await mutate<{ id: string }>(
    participantToken,
    "POST",
    "qna/questions",
    { body: questionBody },
    201,
  );
  await mutate(room.hostToken, "PATCH", `qna/questions/${question.id}`, { status: "published" });
  const reply = await mutate<{ status: string }>(
    room.hostToken,
    "POST",
    `qna/questions/${question.id}/replies`,
    { body: staffReply },
    201,
  );
  expect(reply.status).toBe("published");
  const credentials: string[] = [];
  for (const label of ["Active nested assistant", "Revoked nested assistant"]) {
    const response = await host.request.post(`${api}/v1/sessions/${room.sessionId}/staff`, {
      data: { role: "cohost", label, expiresInMinutes: 240 },
    });
    expect(response.status()).toBe(201);
    credentials.push((await response.json()).credential.id as string);
  }
  expect(
    (
      await host.request.delete(`${api}/v1/sessions/${room.sessionId}/staff/${credentials[1]}`)
    ).status(),
  ).toBe(204);
  return credentials[0]!;
}

for (const suffix of ["desktop", "phone @mobile"]) {
  test(`Round populated nested surfaces preserve readable conversation and staff controls on ${suffix}`, async ({
    page: host,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const viewport = { width: suffix === "desktop" ? 1366 : 320, height: 900 };
    await host.setViewportSize(viewport);
    await host.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    const room = await createRoom(host);
    const context = await browser.newContext({
      baseURL: new URL(host.url()).origin,
      viewport,
      reducedMotion: "reduce",
    });
    let activeCredentialId: string | undefined;
    try {
      const participant = await context.newPage();
      await participant.goto(`/join?code=${room.code}`);
      await participant.getByRole("textbox", { name: /^Nickname/ }).fill(nickname);
      const joined = await joinBetaRound(participant);
      const { participantToken } = (await joined.json()) as { participantToken: string };
      await expect(participant).toHaveURL(new RegExp(`/play/${room.sessionId}$`));
      activeCredentialId = await populate(host, room, participantToken);
      await host.reload();
      await participant.reload();
      await host.locator("details.staff-management > summary").click();
      await expect(host.locator(".staff-list li")).toHaveCount(2);
      await expect(
        host.locator(".staff-list li").filter({ hasText: "Revoked nested assistant" }),
      ).toContainText("revoked");
      // API setup leaves no one-time secret share URL in the rendered page or artifacts.
      await expect(host.locator('a[href*="#cohost="]')).toHaveCount(0);
      await participant.getByTestId("audience-tray").locator("summary").first().click();
      const drawer = await openDrawer(host);
      await drawer.locator("#audience-tab-chat").click();
      const hostMessage = drawer.locator(".chat-message").filter({ hasText: chatBody });
      await expect(hostMessage.locator(".chat-message-meta")).toContainText(nickname);
      await expect(drawer.locator(".chat-message").filter({ hasText: chatReply })).toBeVisible();
      await hostMessage.getByRole("button", { name: "Reply", exact: true }).click();
      await expect(drawer.locator(".chat-replying")).toBeVisible();
      const participantMessage = participant.locator(".chat-message").filter({ hasText: chatBody });
      await participantMessage.getByRole("button", { name: "Reply", exact: true }).click();
      await expect(participant.locator(".chat-replying")).toBeVisible();
      await expect(participantMessage.getByRole("button", { name: /^Like:/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(participant.locator(".qna-replies li")).toContainText(staffReply);
      await expect(
        participant.getByRole("button", { name: "Got it", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");

      const modes: Appearance[] =
        suffix === "desktop" ? ["light", "dark", "app-high", "system-high"] : ["light", "dark"];
      for (const mode of modes) {
        await closeDrawer(host);
        await appearance(host, mode);
        await appearance(participant, mode);
        await palettes(host.locator("details.staff-management"), ".staff-list li", "--round-soft");
        await palettes(host.locator("details.staff-management"), "input", "--round-surface");
        await quality(host, "details.staff-management");
        if (mode === "dark")
          await capture(
            host.locator("details.staff-management"),
            testInfo,
            `nested-staff-dark-${viewport.width}`,
          );
        await openDrawer(host);
        await palette(drawer, "--round-surface");
        await palette(drawer.locator(".audience-drawer-heading h2"));
        for (const tab of ["participants", "pulse", "qna", "chat"]) {
          await drawer.locator(`#audience-tab-${tab}`).click();
          await host.mouse.move(0, 0);
          await expect(drawer.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
          await expect(drawer.locator('[role="tab"][aria-selected="false"]')).toHaveCount(3);
          for (const item of await drawer.getByRole("tab").all()) {
            const selected = (await item.getAttribute("aria-selected")) === "true";
            await palette(
              item,
              undefined,
              selected ? "--round-accent-ink" : "--round-muted",
              selected ? "--round-accent" : undefined,
            );
          }
          if (tab === "participants")
            await palettes(drawer, ".participant-activity-table tbody tr", "--round-soft");
          if (tab === "pulse") await palettes(drawer, ".pulse-stat", "--round-soft");
          if (tab === "qna") {
            await palettes(drawer, ".qna-question", "--round-soft");
            await palettes(drawer, ".qna-replies li", "--round-surface-raised");
            await palettes(drawer, "textarea, select", "--round-surface");
          }
          if (tab === "chat") {
            await palettes(drawer, ".chat-message, .chat-replying", "--round-soft");
            await palettes(drawer, ".reaction-count", "--round-surface-raised");
            await palettes(drawer, "input:not([type=checkbox]), select", "--round-surface");
            await palette(drawer.locator(".chat-replying button"), undefined, "--round-accent-ink");
          }
          await quality(host, '[data-testid="audience-drawer"]');
          if (mode === "dark" && ["qna", "chat"].includes(tab))
            await capture(drawer, testInfo, `nested-drawer-${tab}-dark-${viewport.width}`);
        }
        if (suffix === "desktop") {
          await drawer.locator("#audience-tab-pulse").hover();
          await palette(drawer.locator("#audience-tab-pulse"), "--round-hover");
          await host.mouse.move(0, 0);
        }
        const tray = participant.getByTestId("audience-tray");
        await palettes(
          tray,
          ".chat-message, .chat-replying, .qna-question, .pulse-stat",
          "--round-soft",
        );
        await palettes(tray, ".qna-replies li", "--round-surface-raised");
        await palettes(tray, "input:not([type=checkbox]), textarea", "--round-surface");
        for (const reaction of await tray.locator(".reaction-button").all())
          await palette(
            reaction,
            (await reaction.getAttribute("aria-pressed")) === "true"
              ? "--round-accent-soft"
              : "--round-surface-raised",
          );
        for (const pulse of await tray.locator(".pulse-button").all())
          await palette(
            pulse,
            (await pulse.getAttribute("aria-pressed")) === "true"
              ? "--round-accent-soft"
              : "--round-soft",
          );
        await quality(participant, '[data-testid="audience-tray"]');
        if (mode === "dark")
          await capture(tray, testInfo, `nested-participant-dark-${viewport.width}`);
      }
      await closeDrawer(host);
      for (const surface of [host, participant]) await appearance(surface, "light");
      await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "lobby");
      await expect(
        host
          .locator(".staff-list li")
          .filter({ hasText: "Active nested assistant" })
          .getByRole("button"),
      ).toBeVisible();
      await expect(
        host
          .locator(".staff-list li")
          .filter({ hasText: "Revoked nested assistant" })
          .getByRole("button"),
      ).toHaveCount(0);
    } finally {
      if (activeCredentialId)
        await host.request.delete(
          `${api}/v1/sessions/${room.sessionId}/staff/${activeCredentialId}`,
        );
      await context.close();
    }
  });
}
