import { expect, test, type Page } from "@playwright/test";
import { nativeAudienceCopy } from "../../apps/web/components/presentation/native-audience-copy";
import { nativeInteractionCopy } from "../../apps/web/components/presentation/native-interaction-copy";
import { nativeEditorCopy } from "../../apps/web/components/presentation/native-editor-copy";
import { createE01Deck, e01ApiUrl, e01Slide, readE01Record } from "./presentation-e01-support";
import { signInBeta } from "./sign-in";
import {
  specialistInspector,
  specialistLanguage,
  specialistLocale,
  specialistQuality,
} from "./option-b-specialist-support";

function monitorAudienceCommands() {
  const target = window as typeof window & { optionBAudienceCommands?: string[] };
  target.optionBAudienceCommands = [];
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (typeof data === "string" && /presentation\.(?:command|response)/.test(data))
      target.optionBAudienceCommands!.push(data);
    return send.call(this, data);
  };
}

async function commands(page: Page) {
  return page.evaluate(
    () =>
      (window as typeof window & { optionBAudienceCommands?: string[] }).optionBAudienceCommands ??
      [],
  );
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean audience controls preserve local actions, authored content and live authority ${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const copy = nativeAudienceCopy("ko-KR");
    const slide = e01Slide("Contenido original"),
      data = e01Slide("Original evidence chart");
    const heading = slide.scene!.nodes[0]!;
    if (heading.type !== "text") throw new Error("Expected text heading");
    heading.lang = "es";
    slide.scene = {
      schemaVersion: 7,
      aspectRatio: "16:9",
      nodes: [
        heading,
        {
          id: "local",
          type: "reveal",
          scope: "local",
          label: "Show on this screen",
          body: "Original local <strong>plain text</strong>",
          frame: { x: 5, y: 28, width: 43, height: 25 },
        },
        {
          id: "detail",
          type: "dialog",
          scope: "local",
          label: "Open details on this screen",
          detailTitle: "Original detail title",
          body: "Original detail body",
          frame: { x: 52, y: 28, width: 43, height: 25 },
        },
        {
          id: "broadcast",
          type: "reveal",
          scope: "broadcast",
          label: "Original broadcast",
          body: "UNREVEALED audience content",
          frame: { x: 5, y: 58, width: 28, height: 25 },
        },
        {
          id: "navigation",
          type: "navigation",
          label: "Original target action",
          targetBlockId: data.id.toUpperCase(),
          frame: { x: 36, y: 58, width: 28, height: 25 },
        },
        {
          id: "external",
          type: "link",
          label: "Original source link",
          href: "https://example.com/original",
          frame: { x: 67, y: 58, width: 28, height: 25 },
        },
      ],
      readingOrder: [heading.id, "local", "detail", "broadcast", "navigation", "external"],
    };
    data.scene = {
      schemaVersion: 4,
      aspectRatio: "16:9",
      nodes: [
        data.scene!.nodes[0]!,
        {
          id: "chart",
          type: "chart",
          chartType: "bar",
          title: "Chart legend",
          summary: "Original summary",
          categories: ["Category", "Second category"],
          series: [{ name: "blue", values: [12, 20] }],
          frame: { x: 5, y: 27, width: 90, height: 65 },
        },
      ],
      readingOrder: [data.scene!.nodes[0]!.id, "chart"],
    };
    const record = await createE01Deck(page, [slide, data], 16);
    const before = (await readE01Record(page, record.id)).draft;
    const writes: string[] = [],
      external: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        new URL(request.url()).pathname === `/v1/presentations/${record.id}/draft`
      )
        writes.push(request.postData() ?? "");
      if (new URL(request.url()).hostname === "example.com") external.push(request.url());
    });
    await page.route(/^https?:\/\/example\.com\//, (route) => route.abort());
    let stage: Page | undefined;
    const audience = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: suffix === "@mobile" ? { width: 320, height: 844 } : info.project.use.viewport,
      isMobile: info.project.use.isMobile,
      hasTouch: info.project.use.hasTouch,
      userAgent: info.project.use.userAgent,
      deviceScaleFactor: info.project.use.deviceScaleFactor,
      reducedMotion: "reduce",
    });
    try {
      await specialistLocale(page, "ko-KR");
      await page.goto(`/presentation/${record.id}`);
      const inspector = await specialistInspector(page);
      await inspector
        .getByRole("combobox", { name: nativeEditorCopy("ko-KR")("Selected object"), exact: true })
        .selectOption("local");
      await inspector
        .getByRole("button", {
          name: nativeInteractionCopy("ko-KR")("Preview this slide"),
          exact: true,
        })
        .click();
      const preview = page.locator('[data-presentation-preview="true"]');
      const reveal = preview
        .locator('[data-native-interaction="reveal"]')
        .filter({ hasText: "Show on this screen" })
        .getByRole("button");
      await expect(reveal).toContainText(copy("Show on this screen"));
      await expect(reveal.getByText("Show on this screen", { exact: true })).toHaveAttribute(
        "lang",
        "",
      );
      await reveal.click();
      await expect(
        preview.getByText("Original local <strong>plain text</strong>", { exact: true }),
      ).toBeVisible();
      expect(await preview.locator('[data-native-interaction="reveal"] strong').count()).toBe(0);
      const detail = preview.locator('[data-native-interaction="dialog"] button');
      await expect(detail).toContainText(copy("Open details on this screen"));
      await detail.click();
      const detailDialog = page.getByRole("dialog", { name: "Original detail title", exact: true });
      const close = detailDialog.getByRole("button", { name: copy("Close details"), exact: true });
      await expect(close).toBeFocused();
      await specialistLanguage(close, "ko-KR");
      await specialistLanguage(detailDialog.getByText("Original detail body", { exact: true }), "");
      await page.keyboard.press("Escape");
      await expect(detailDialog).toHaveCount(0);
      await expect(detail).toBeFocused();
      await expect(
        preview.getByRole("heading", { name: "Contenido original", exact: true }),
      ).toHaveAttribute("lang", "es");
      await specialistQuality(page);
      await preview.screenshot({ path: info.outputPath("korean-audience-preview.png") });
      await preview.locator('[data-native-interaction="navigation"] button').click();
      const chart = preview.locator('[data-native-data="chart"]');
      await expect(
        chart.getByRole("list", { name: copy("Chart legend"), exact: true }),
      ).toBeVisible();
      await expect(
        chart.getByRole("columnheader", { name: copy("Category"), exact: true }),
      ).toBeVisible();
      await specialistLanguage(chart.getByText("Chart legend", { exact: true }).first(), "");
      await expect(chart.getByRole("columnheader", { name: "blue", exact: true })).toHaveAttribute(
        "lang",
        "",
      );
      await expect(chart.getByRole("table")).toContainText("12");
      await expect(chart).toHaveAttribute("data-chart-type", "bar");
      await specialistQuality(page);
      await preview.screenshot({ path: info.outputPath("korean-audience-chart.png") });
      await page.keyboard.press("Escape");
      expect((await readE01Record(page, record.id)).draft).toEqual(before);
      expect(writes).toHaveLength(0);
      expect(external).toHaveLength(0);

      await specialistLocale(page, "en-CA");
      expect(
        (
          await page.request.post(`${e01ApiUrl}/v1/presentations/${record.id}/publish`, {
            data: { expectedDraftRevision: record.draftRevision },
          })
        ).status(),
      ).toBe(200);
      const created = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
        data: { presentationId: record.id },
      });
      expect(created.status()).toBe(201);
      const { snapshot, controlToken } = await created.json();
      const id = snapshot.sessionId as string;
      await page.evaluate(
        ({ id, controlToken }) =>
          sessionStorage.setItem(`openround:presentation-host:${id}`, controlToken),
        { id, controlToken },
      );
      await page.context().addInitScript(monitorAudienceCommands);
      await page.goto(`/presentation-session/${id}/host`);
      const popup = page.waitForEvent("popup");
      await page.getByRole("button", { name: "Open audience stage", exact: true }).click();
      stage = await popup;
      if (suffix === "@mobile") await stage.setViewportSize({ width: 320, height: 844 });
      await audience.addInitScript(monitorAudienceCommands);
      const guest = await audience.newPage();
      await guest.goto(`/join?code=${snapshot.code}`);
      await guest.getByLabel("Nickname", { exact: true }).fill("Original audience member");
      await guest.getByRole("button", { name: "Join presentation", exact: true }).click();
      await expect(guest).toHaveURL(`/presentation-session/${id}/play`);
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      await expect(guest.locator("[data-native-scene]")).toBeVisible();
      await specialistLocale(page, "ko-KR");
      await audience.addCookies([
        {
          name: "openround-locale",
          value: "ko-KR",
          url: new URL(page.url()).origin,
          sameSite: "Lax",
        },
      ]);
      await guest.reload();
      await stage.reload();
      const serverSnapshot = async () =>
        (await (await page.request.get(`${e01ApiUrl}/v1/presentation-sessions/${id}`)).json())
          .snapshot;
      const prior = await serverSnapshot();
      const audienceWrites: string[] = [];
      for (const surface of [guest, stage]) {
        surface.on("request", (request) => {
          if (new URL(request.url()).hostname === "example.com") external.push(request.url());
          if (
            request.method() !== "GET" &&
            /\/v1\/presentation-sessions(?:\/|$)/.test(new URL(request.url()).pathname)
          )
            audienceWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
        });
        await expect(surface.locator("[data-native-scene]")).toBeVisible();
        const local = surface
          .locator('[data-native-interaction="reveal"]')
          .filter({ hasText: "Show on this screen" })
          .getByRole("button");
        await expect(local).toContainText(copy("Show on this screen"));
        await local.click();
        await expect(local).toHaveAttribute("aria-expanded", "true");
        const broadcast = surface
          .locator('[data-native-interaction="reveal"]')
          .filter({ hasText: "Original broadcast" })
          .getByRole("button");
        await expect(broadcast).toBeDisabled();
        expect(await surface.content()).not.toContain("UNREVEALED audience content");
        expect(await surface.content()).not.toContain("PRIVATE E01");
        await expect(
          surface.locator('[data-native-interaction="navigation"] button'),
        ).toBeDisabled();
        await expect(surface.locator('[data-native-interaction="navigation"]')).toContainText(
          copy("Facilitator navigation"),
        );
        const link = surface.getByRole("link", {
          name: `Original source link ${copy("Opens in a new tab")}`,
          exact: true,
        });
        await expect(link).toHaveAttribute("href", "https://example.com/original");
        await expect(link).toHaveAttribute("rel", "noopener noreferrer");
        await surface
          .getByRole("button", { name: copy("Show accessible outline"), exact: true })
          .click();
        await expect(local).toHaveAttribute("aria-expanded", "true");
        await specialistQuality(surface);
      }
      expect(await commands(guest)).toEqual([]);
      expect(await commands(stage)).toEqual([]);
      expect(audienceWrites).toEqual([]);
      const after = await serverSnapshot();
      expect({
        revision: after.revision,
        seq: after.seq,
        block: after.currentBlock?.id,
        responses: after.responseCount,
      }).toEqual({
        revision: prior.revision,
        seq: prior.seq,
        block: prior.currentBlock?.id,
        responses: prior.responseCount,
      });
      expect((await readE01Record(page, record.id)).draft).toEqual(before);
      expect(writes).toHaveLength(0);
      expect(external).toHaveLength(0);
      await guest.screenshot({ path: info.outputPath("korean-live-audience.png"), fullPage: true });
    } finally {
      await audience.close();
      await stage?.close();
      await specialistLocale(page, "en-CA");
    }
  });
}
