import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import germanDelivery from "../../apps/web/lib/i18n/domains/live-delivery/de-DE";
import koreanDelivery from "../../apps/web/lib/i18n/domains/live-delivery/ko-KR";
import { presentationWorkspaceCopy } from "../../apps/web/lib/i18n/presentation-workspace-copy";
import { createE01Deck, e01ApiUrl, e01Slide, readE01Record } from "./presentation-e01-support";
import { specialistLocale } from "./option-b-specialist-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 20_000 });

for (const locale of ["de-DE", "ko-KR"] as const) {
  for (const suffix of ["", " @mobile"]) {
    test(`private presenter language changes preserve the live session in ${locale}${suffix}`, async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      if (suffix) await page.setViewportSize({ width: 320, height: 760 });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
      await signInBeta(page);
      await specialistLocale(page, "en-CA");
      await page.addInitScript(() => {
        // Exercise the existing blocked-popup recovery without opening a real display.
        window.open = () => null;
      });
      const first = e01Slide("Private speaker notes");
      first.speakerNotes = "PRIVATE authored cue: Next slide preview / $& / {connected}";
      const second = e01Slide("Presentation timer");
      second.speakerNotes = "PRIVATE next-slide cue";
      const record = await createE01Deck(page, [first, second]);
      const published = await page.request.post(
        `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
        { data: { expectedDraftRevision: record.draftRevision } },
      );
      expect(published.status()).toBe(200);
      const created = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
        data: { presentationId: record.id },
      });
      expect(created.status()).toBe(201);
      const { snapshot: lobby, controlToken } = await created.json();
      const sessionId = lobby.sessionId as string;
      await page.evaluate(
        ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
        { id: sessionId, token: controlToken },
      );
      let commandWrites = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new RegExp(`/presentation-sessions/${sessionId}/(?:command|advance)$`).test(
            new URL(request.url()).pathname,
          )
        )
          commandWrites++;
      });
      page.on("websocket", (socket) => {
        socket.on("framesent", (frame) => {
          if (String(frame.payload).includes('"presentation.command"')) commandWrites++;
        });
      });
      await page.goto(`/presentation-session/${sessionId}/host`);
      await expect(
        page.getByRole("region", { name: "Facilitation controls", exact: true }),
      ).toBeVisible();
      const timerKey = `openround:presentation-presenter-timer:v1:${sessionId}`;
      const englishTimer = page.getByRole("region", { name: "Presentation timer", exact: true });
      await englishTimer.getByRole("button", { name: "Start", exact: true }).click();
      await expect(englishTimer.getByRole("timer")).not.toHaveText("00:00");
      const runningState = await page.evaluate((key) => sessionStorage.getItem(key), timerKey);
      const before = await page.request.get(`${e01ApiUrl}/v1/presentation-sessions/${sessionId}`);
      const initialSnapshot = (await before.json()).snapshot;

      // Use the product's language control while the timer and realtime session stay mounted.
      let releaseSave = () => {};
      const heldSave = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      let saveStarted = () => {};
      const saving = new Promise<void>((resolve) => {
        saveStarted = resolve;
      });
      await page.route("**/v1/account/locale", async (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        saveStarted();
        await heldSave;
        await route.continue();
      });
      await page.locator("header details > summary").click();
      await page.getByRole("radio", { name: /English/ }).press("ArrowDown");
      await saving;
      try {
        // A disabled radio may lose focus during persistence; this must never advance a slide.
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Space");
        expect(commandWrites).toBe(0);
      } finally {
        releaseSave();
      }
      await expect(page.locator("html")).toHaveAttribute("lang", "fr-FR");
      await expect(page.getByRole("radio", { name: /Français/ })).toBeEnabled();
      await page.unroute("**/v1/account/locale");
      // Arrow-key selection keeps the menu open; choose the target language explicitly.
      await page.getByRole("radio", { name: locale === "de-DE" ? /Deutsch/ : /한국어/ }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("header details")).not.toHaveAttribute("open", "");
      const copy = presentationWorkspaceCopy(locale);
      const messages = locale === "de-DE" ? germanDelivery : koreanDelivery;
      const timer = page.getByRole("region", { name: copy("Presentation timer"), exact: true });
      await expect(timer).toHaveAttribute("lang", locale);
      await expect(timer.getByRole("status")).toHaveText(copy("Running"));
      expect(await page.evaluate((key) => sessionStorage.getItem(key), timerKey)).toBe(
        runningState,
      );
      await timer.getByRole("button", { name: copy("Pause"), exact: true }).click();
      const pausedTime = await timer.getByRole("timer").innerText();
      const pausedState = await page.evaluate((key) => sessionStorage.getItem(key), timerKey);
      const after = await page.request.get(`${e01ApiUrl}/v1/presentation-sessions/${sessionId}`);
      expect((await after.json()).snapshot).toMatchObject({
        revision: initialSnapshot.revision,
        phase: "lobby",
        currentBlockIndex: -1,
      });
      expect(commandWrites).toBe(0);
      await expect(
        page.getByText(
          copy("Private presenter workspace. Share the audience stage window with your audience."),
          { exact: true },
        ),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: messages["live.presentationSession.advance.start"],
          exact: true,
        })
        .click();
      const current = page.getByRole("region", { name: copy("Current slide"), exact: true });
      await expect(
        current.getByRole("heading", { name: "Private speaker notes", exact: true }),
      ).toBeVisible();
      const notes = page.getByRole("region", { name: copy("Private speaker notes"), exact: true });
      await expect(notes.getByText(first.speakerNotes, { exact: true })).toHaveAttribute(
        "lang",
        "",
      );
      const next = page.getByRole("region", { name: copy("Next slide preview"), exact: true });
      await expect(
        next.getByRole("heading", { name: "Presentation timer", exact: true }),
      ).toBeVisible();
      expect(await next.innerText()).not.toContain(second.speakerNotes);

      const stage = page.getByRole("region", {
        name: copy("Audience stage controls"),
        exact: true,
      });
      await expect(stage).toHaveAttribute("lang", locale);
      await stage.getByRole("button", { name: copy("Open audience stage"), exact: true }).click();
      const fallback = stage.getByRole("link", {
        name: copy("Open audience stage in a new tab"),
        exact: true,
      });
      await expect(fallback).toBeVisible();
      const address = await fallback.getAttribute("href");
      expect(Boolean(address && new URL(address).hash.startsWith("#pass="))).toBe(true);
      await expect(stage.getByRole("status")).toHaveText(
        copy(
          "Your browser blocked the stage window. Open it using this link, then share that tab.",
        ),
      );
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
        .toBeLessThanOrEqual(1);
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      // Reset scrolling so a sticky command bar does not obscure content in the full-page capture.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: info.outputPath(`presenter-${locale}.png`), fullPage: true });

      await page.locator("header details > summary").click();
      await page.getByRole("radio", { name: /English/ }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "en-CA");
      await expect(englishTimer.getByRole("status")).toHaveText("Paused");
      await expect(englishTimer.getByRole("timer")).toHaveText(pausedTime);
      expect(await page.evaluate((key) => sessionStorage.getItem(key), timerKey)).toBe(pausedState);
      const englishStage = page.getByRole("region", {
        name: "Audience stage controls",
        exact: true,
      });
      expect(
        (await englishStage
          .getByRole("link", {
            name: "Open audience stage in a new tab",
            exact: true,
          })
          .getAttribute("href")) === address,
      ).toBe(true);
      await englishStage
        .getByRole("button", { name: "Revoke audience stage access", exact: true })
        .click();
      await expect(englishStage.getByRole("link")).toHaveCount(0);
      expect(commandWrites).toBe(1);
      expect((await readE01Record(page, record.id)).draft).toEqual(record.draft);
      await page.reload();
      await expect(englishTimer.getByRole("timer")).toHaveText(pausedTime);
      await expect(page.getByRole("region", { name: "Current slide", exact: true })).toContainText(
        "Private speaker notes",
      );
      expect(commandWrites).toBe(1);
    });
  }
}
