import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { currentRoundClientCapabilities } from "../../packages/contracts/src/round-protocol";
import { api, fits, organization, web } from "./support";

function rgb(hex: string) {
  return `rgb(${[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
}

async function accessible(page: Page) {
  await fits(page);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
}

for (const suffix of ["", " @mobile"]) {
  test(`theme previews stay isolated and workspace modes reach real live screens${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await organization(page, info);
    await page.goto("/account#appearance");
    const personal = page.getByRole("region", { name: "Your interface", exact: true });
    const brand = page.getByRole("region", { name: "Workspace live brand", exact: true });
    await expect(personal).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-interface-theme", "classic");
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", "light");

    for (const name of [
      "Classic",
      "Candy Pop",
      "Ocean",
      "Forest",
      "Violet",
      "Sunset",
      "Slate",
      "Sand",
    ]) {
      await expect(personal.getByRole("button", { name: new RegExp(`^${name}\\b`) })).toBeVisible();
    }
    await personal.getByRole("button", { name: /^Ocean\b/ }).click();
    const inspect = personal.getByRole("group", { name: "Preview — Your interface", exact: true });
    await inspect.getByRole("button", { name: "Dark", exact: true }).click();
    await expect(personal.locator('[data-preview-mode="dark"]')).toHaveCount(1);
    await expect(personal.locator('[data-preview-mode="light"]')).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-interface-theme", "classic");
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", "light");
    expect(await page.evaluate(() => localStorage.getItem("openround:interface-theme"))).toBeNull();
    await inspect.getByRole("button", { name: "Side by side", exact: true }).click();
    await expect(personal.locator("[data-preview-mode]")).toHaveCount(2);
    await accessible(page);
    await personal.screenshot({ path: info.outputPath("theme-gallery-light.png"), scale: "css" });

    await personal
      .getByRole("group", { name: "Interface appearance", exact: true })
      .getByRole("button", { name: "Dark", exact: true })
      .click();
    await personal.getByRole("button", { name: "Apply to my interface", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-interface-theme", "ocean");
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-interface-theme", "ocean");
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
    await personal.getByRole("button", { name: /^Forest\b/ }).click();
    await personal.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(personal.getByRole("button", { name: /^Ocean\b/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("html")).toHaveAttribute("data-interface-theme", "ocean");
    await accessible(page);
    await personal.screenshot({ path: info.outputPath("theme-gallery-dark.png"), scale: "css" });

    await brand.getByRole("button", { name: /^Violet\b/ }).click();
    await brand.getByLabel("Brand display name", { exact: true }).fill("Example team");
    await brand
      .getByRole("group", { name: "Live appearance", exact: true })
      .getByRole("button", { name: "Dark", exact: true })
      .click();
    await expect(brand.locator("[data-preview-mode]")).toHaveCount(2);
    await accessible(page);
    await brand.screenshot({ path: info.outputPath("workspace-brand-previews.png"), scale: "css" });
    const saving = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === "/v1/account/theme",
    );
    await brand.getByRole("button", { name: "Save workspace brand", exact: true }).click();
    const saved = await saving;
    expect(saved.status(), await saved.text()).toBe(200);
    let savedTheme = (await saved.json()).theme;
    expect(savedTheme).toMatchObject({ organizationName: "Example team", colorMode: "dark" });
    if (!suffix) {
      // This valid near-threshold custom color must also work under header overlays.
      const custom = await page.request.put(`${api}/v1/account/theme`, {
        data: { ...savedTheme, primaryColor: "#737373", accentColor: "#737373" },
      });
      expect(custom.status(), await custom.text()).toBe(200);
      savedTheme = (await custom.json()).theme;
      await page.reload();
      await expect(brand.getByLabel("Brand display name", { exact: true })).toHaveValue(
        "Example team",
      );
      await accessible(page);
    }

    const created = await page.request.post(`${api}/v1/starters/new-hire-knowledge-check/use`, {
      data: {},
    });
    expect(created.status(), await created.text()).toBe(201);
    const { quiz } = await created.json();
    const published = await page.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, {
      data: { expectedDraftRevision: quiz.draftRevision },
    });
    expect(published.status(), await published.text()).toBe(200);
    const hosted = await page.request.post(`${api}/v1/sessions`, {
      data: {
        quizId: quiz.id,
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
    expect(hosted.status(), await hosted.text()).toBe(201);
    const room = await hosted.json();
    expect(room.snapshot.brandTheme.colorMode).toBe("dark");
    await page.evaluate(
      ({ sessionId, hostToken }) =>
        sessionStorage.setItem(`openround:host:${sessionId}`, hostToken),
      room,
    );
    await page.goto(`/host/${room.sessionId}`);
    const hostShell = page.locator('.live-shell[data-workspace-color-mode="dark"]');
    await expect(hostShell).toBeVisible();
    await expect(page.getByTestId("host-session")).toHaveAttribute("data-phase", "lobby");
    await expect(hostShell).toHaveCSS(
      "background-color",
      rgb(room.snapshot.experienceTheme.tokens.canvas),
    );
    await expect(hostShell.locator(".live-topbar")).toHaveCSS(
      "background-color",
      rgb(savedTheme.primaryColor),
    );
    await page.evaluate(() => {
      localStorage.setItem("openround:color-mode", "light");
      window.dispatchEvent(new Event("openround:color-mode-change"));
    });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", "light");
    await expect(hostShell).toHaveCSS("color-scheme", "dark");
    await expect(hostShell).toHaveCSS(
      "background-color",
      rgb(room.snapshot.experienceTheme.tokens.canvas),
    );
    await accessible(page);

    const guestContext = await browser.newContext({
      baseURL: web,
      viewport: suffix ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    try {
      const guest = await guestContext.newPage();
      await guest.goto("/join");
      const joined = await guest.request.post(`${api}/v1/sessions/join`, {
        data: {
          code: room.code,
          nickname: "Theme guest",
          clientCapabilities: currentRoundClientCapabilities(),
        },
      });
      expect(joined.status(), await joined.text()).toBe(201);
      const { participantToken } = await joined.json();
      await guest.evaluate(
        ({ sessionId, token }) =>
          sessionStorage.setItem(`openround:participant:${sessionId}`, token),
        { sessionId: room.sessionId, token: participantToken },
      );
      await guest.goto(`/play/${room.sessionId}`);
      const guestShell = guest.locator('.live-shell[data-workspace-color-mode="dark"]');
      await expect(guestShell).toBeVisible();
      await page.getByRole("button", { name: "Start round", exact: true }).click();
      await expect(page.getByTestId("host-session")).toHaveAttribute("data-phase", "question_open");
      await accessible(page);
      await expect(guestShell).toHaveCSS(
        "background-color",
        rgb(room.snapshot.experienceTheme.tokens.canvas),
      );
      await expect(guestShell).toHaveCSS("color-scheme", "dark");
      const choice = guest.locator(".answer-button").first();
      await expect(choice).toBeVisible();
      await choice.click();
      await expect(choice).toHaveAttribute("data-selected", "true");
      await accessible(guest);
      await guest.screenshot({ path: info.outputPath("live-brand-dark.png"), scale: "css" });

      const interactions = await page.request.patch(
        `${api}/v1/sessions/${room.sessionId}/interactions/settings`,
        {
          headers: { authorization: `Bearer ${room.hostToken}`, "x-idempotency-key": randomUUID() },
          data: { chatEnabled: true, presenterFeedMode: "live", slowModeSeconds: 0 },
        },
      );
      expect(interactions.status(), await interactions.text()).toBe(200);
      const chatBody = "Could we see an example before the next question?";
      const message = await guest.request.post(
        `${api}/v1/sessions/${room.sessionId}/chat/messages`,
        {
          headers: { authorization: `Bearer ${participantToken}` },
          data: { body: chatBody, replyToMessageId: null, idempotencyKey: randomUUID() },
        },
      );
      expect(message.status(), await message.text()).toBe(201);
      const issued = await page.request.post(`${api}/v1/sessions/${room.sessionId}/staff`, {
        data: { role: "presenter", label: "Theme test display" },
      });
      expect(issued.status(), await issued.text()).toBe(201);
      const { token: presenterToken } = await issued.json();
      const presenter = await guestContext.newPage();
      try {
        await presenter.goto("/join");
        await presenter.evaluate(
          ({ sessionId, token }) =>
            sessionStorage.setItem(`openround:presenter:${sessionId}`, token),
          { sessionId: room.sessionId, token: presenterToken },
        );
        await presenter.goto(`/present/${room.sessionId}`);
        const presenterShell = presenter.locator('.live-shell[data-workspace-color-mode="dark"]');
        const chat = presenter.locator(".chat-message").filter({ hasText: chatBody });
        await expect(presenterShell).toHaveCSS("color-scheme", "dark");
        await expect(chat).toBeVisible();
        await expect(chat).toHaveCSS("color", rgb(room.snapshot.experienceTheme.tokens.text));
        await expect(chat).toHaveCSS(
          "background-color",
          rgb(room.snapshot.experienceTheme.tokens.surfaceStrong),
        );
        await accessible(presenter);
        await presenter.screenshot({
          path: info.outputPath("presenter-chat-dark.png"),
          scale: "css",
        });
        await presenter.locator("details.experience-preferences summary").click();
        await presenter.getByRole("checkbox", { name: /High contrast/i }).check();
        await expect(presenterShell).toHaveCSS("color-scheme", "light");
        await expect(chat).toHaveCSS("color", "rgb(0, 0, 0)");
        await accessible(presenter);
        await presenter.getByRole("checkbox", { name: /High contrast/i }).uncheck();
      } finally {
        await presenter.close();
      }
      await guest.locator("details.experience-preferences summary").click();
      await guest.getByRole("checkbox", { name: /High contrast/i }).check();
      await expect(guestShell).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(guestShell).toHaveCSS("color", "rgb(0, 0, 0)");
      await expect(guestShell).toHaveCSS("color-scheme", "light");
      await accessible(guest);
    } finally {
      await guestContext.close();
    }
  });
}
