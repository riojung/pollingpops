import { expect, test } from "@playwright/test";
import type { PresentationScene } from "../../packages/contracts/src/index.ts";
import { nativeEditorCopy } from "../../apps/web/components/presentation/native-editor-copy";
import { nativeInteractionCopy } from "../../apps/web/components/presentation/native-interaction-copy";
import { createE01Deck, e01ApiUrl, e01Slide, readE01Record } from "./presentation-e01-support";
import { signInBeta } from "./sign-in";
import {
  closeSpecialistInspector,
  specialistInspector,
  specialistLanguage,
  specialistLocale,
  specialistQuality,
} from "./option-b-specialist-support";

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean interaction authoring preserves targets, unsaved URL barriers, local preview and viewer access ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const copy = nativeInteractionCopy("ko-KR"),
      shell = nativeEditorCopy("ko-KR");
    const slide = e01Slide("Original interactive slide"),
      target = e01Slide("Original target context");
    const hidden = { ...e01Slide("PRIVATE hidden target"), hidden: true as const };
    const title = slide.scene!.nodes[0]!;
    slide.scene = {
      schemaVersion: 6,
      aspectRatio: "16:9",
      nodes: [
        title,
        {
          id: "local",
          type: "reveal",
          scope: "local",
          label: "Original reveal",
          body: "Original audience detail",
          frame: { x: 5, y: 24, width: 28, height: 25 },
        },
        {
          id: "broadcast",
          type: "reveal",
          scope: "broadcast",
          label: "Original broadcast",
          body: "Original broadcast detail",
          frame: { x: 36, y: 24, width: 28, height: 25 },
        },
        {
          id: "detail",
          type: "dialog",
          scope: "local",
          label: "Original detail action",
          detailTitle: "Original detail title",
          body: "Original detail content",
          frame: { x: 67, y: 24, width: 28, height: 25 },
        },
        {
          id: "external",
          type: "link",
          label: "Original external action",
          href: "https://example.com/original",
          frame: { x: 5, y: 56, width: 28, height: 25 },
        },
        {
          id: "navigation",
          type: "navigation",
          label: "Original target action",
          targetBlockId: target.id.toUpperCase(),
          frame: { x: 36, y: 56, width: 28, height: 25 },
        },
        {
          id: "hotspot",
          type: "hotspot",
          scope: "local",
          label: "Original image action",
          detailTitle: "Original image title",
          body: `Original image detail. ${"Detailed audience context remains authored and scrollable. ".repeat(20)}`,
          imageNodeId: null,
          frame: { x: 67, y: 56, width: 20, height: 20 },
        },
      ],
      readingOrder: [title.id, "local", "broadcast", "detail", "external", "navigation", "hotspot"],
    };
    const record = await createE01Deck(page, [slide, target, hidden], 16);
    const saved = async (): Promise<PresentationScene> => {
      const block = (await readE01Record(page, record.id)).draft.blocks[0];
      if (block?.kind !== "content" || !block.scene)
        throw new Error("Expected an interaction scene");
      return block.scene;
    };
    const node = async (id: string) => (await saved()).nodes.find((node) => node.id === id);
    const writes: string[] = [],
      sideEffects: string[] = [],
      external: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === "PUT" && path === `/v1/presentations/${record.id}/draft`)
        writes.push(request.postData() ?? "");
      if (
        request.method() === "POST" &&
        (path.includes("/presentation-sessions") ||
          path.endsWith("/publish") ||
          /\/responses(?:\/|$)/.test(path))
      )
        sideEffects.push(path);
      if (new URL(request.url()).hostname === "example.com") external.push(request.url());
    });
    await page.route(/^https?:\/\/example\.com\//, (route) => route.abort());
    try {
      await specialistLocale(page, "ko-KR");
      await page.goto(`/presentation/${record.id}`);
      const inspector = await specialistInspector(page);
      const picker = inspector.getByRole("combobox", {
        name: shell("Selected object"),
        exact: true,
      });
      const overview = inspector.getByRole("region", {
        name: copy("Interaction overview"),
        exact: true,
      });
      const previewButton = inspector.getByRole("button", {
        name: copy("Preview this slide"),
        exact: true,
      });
      await picker.selectOption("local");
      await expect(overview).toHaveAttribute("lang", "ko-KR");
      await overview.getByText(copy("How this interaction works"), { exact: true }).click();
      await expect(overview).toContainText("Original reveal");
      expect(copy("Interaction overview")).not.toBe("Interaction overview");
      expect(await saved()).toEqual(slide.scene);
      expect(writes).toHaveLength(0);
      const revealBody = inspector.getByRole("textbox", {
        name: copy("Revealed audience content"),
        exact: true,
      });
      await revealBody.fill("Original audience detail revised");
      await expect
        .poll(() => node("local"))
        .toMatchObject({ body: "Original audience detail revised" });
      await inspector
        .getByRole("combobox", { name: copy("Reveal audience"), exact: true })
        .selectOption("broadcast");
      await expect.poll(() => node("local")).toMatchObject({ scope: "broadcast" });
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect.poll(() => node("local")).toMatchObject({ scope: "local" });
      await page.getByRole("button", { name: "다시 실행", exact: true }).click();
      await expect
        .poll(() => node("local"))
        .toMatchObject({ scope: "broadcast", body: "Original audience detail revised" });

      await picker.selectOption("external");
      const url = inspector.getByRole("textbox", { name: copy("Link URL"), exact: true });
      const beforeUnsafe = await saved(),
        beforeUnsafeWrites = writes.length;
      await url.fill("javascript:alert(1)");
      await expect(url).toHaveAttribute("aria-invalid", "true");
      await specialistLanguage(inspector.getByRole("alert"), "ko-KR");
      await expect(inspector.getByRole("alert")).toContainText(/[가-힣]/);
      await expect(previewButton).toBeDisabled();
      await picker.selectOption("local");
      await expect(previewButton).toBeDisabled();
      await expect(overview).toContainText(
        copy("Correct the unsaved link entries on this slide before previewing."),
      );
      await picker.selectOption("external");
      await expect(url).toHaveValue("javascript:alert(1)");
      expect(await saved()).toEqual(beforeUnsafe);
      expect(writes.length).toBe(beforeUnsafeWrites);
      await url.fill("https://example.com/reviewed");
      await expect
        .poll(() => node("external"))
        .toMatchObject({ href: "https://example.com/reviewed", label: "Original external action" });
      await expect(previewButton).toBeEnabled();
      const scrollPreview = page.locator('[data-native-scene] [data-native-interaction="hotspot"]');
      if (suffix === "@mobile") await closeSpecialistInspector(page);
      await expect(scrollPreview).toBeVisible();
      const overflowing = () =>
        scrollPreview.evaluate((element) => element.scrollHeight > element.clientHeight);
      if (suffix === "desktop") await expect.poll(overflowing).toBe(true);
      const beforeScroll = await saved(),
        beforeScrollWrites = writes.length;
      if (await overflowing()) {
        await expect(scrollPreview).toHaveAttribute("tabindex", "0");
        await scrollPreview.focus();
        await expect(scrollPreview).toBeFocused();
        await scrollPreview.press("PageDown");
        await expect
          .poll(() => scrollPreview.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(0);
      } else await expect(scrollPreview).not.toHaveAttribute("tabindex", "0");
      if (suffix === "@mobile") await specialistInspector(page);
      await expect(picker).toHaveValue("external");
      expect(await saved()).toEqual(beforeScroll);
      expect(writes.length).toBe(beforeScrollWrites);
      await specialistQuality(page);
      await inspector.screenshot({ path: info.outputPath("korean-interaction-editor.png") });

      await picker.selectOption("navigation");
      const destinations = inspector.getByRole("combobox", {
        name: copy("Target slide or activity"),
        exact: true,
      });
      await expect(destinations).toHaveValue(target.id);
      await expect(
        destinations.getByRole("option", { name: "PRIVATE hidden target", exact: true }),
      ).toHaveCount(0);
      await expect(destinations.locator("option:checked")).toHaveAttribute("lang", "");
      await expect(overview).toContainText("Original target context");
      await expect
        .poll(() => node("navigation"))
        .toMatchObject({ targetBlockId: target.id.toUpperCase() });
      await picker.selectOption("hotspot");
      await expect(previewButton).toBeDisabled();
      await expect(overview).toContainText(copy("Choose the image for this hotspot."));
      await picker.selectOption("detail");
      const details = inspector.getByRole("textbox", {
        name: copy("Detail audience content"),
        exact: true,
      });
      await expect(details).toHaveAttribute("lang", "");
      await details.fill("Original reviewed detail content");
      await expect
        .poll(() => node("detail"))
        .toMatchObject({
          detailTitle: "Original detail title",
          body: "Original reviewed detail content",
        });

      await picker.selectOption("local");
      const beforePreview = await saved(),
        beforePreviewWrites = writes.length;
      await expect(previewButton).toBeEnabled();
      await previewButton.click();
      const preview = page.getByRole("dialog");
      await expect(preview).toHaveCount(1);
      await expect(preview).toBeVisible();
      await preview.getByRole("button", { name: /^Original reveal\b/ }).click();
      await expect(
        preview.getByText("Original audience detail revised", { exact: true }),
      ).toBeVisible();
      await expect(preview).not.toContainText("PRIVATE E01 speaker cue");
      await specialistQuality(page);
      await page.keyboard.press("Escape");
      await expect(preview).toHaveCount(0);
      await expect(previewButton).toBeFocused();
      expect(await saved()).toEqual(beforePreview);
      expect(writes.length).toBe(beforePreviewWrites);

      const beforeMapWrites = writes.length;
      await closeSpecialistInspector(page);
      const map = page.getByRole("region", { name: copy("Interaction map"), exact: true });
      await expect(map).toHaveAttribute("lang", "ko-KR");
      await map.getByRole("button", { name: copy("Show interaction map"), exact: true }).click();
      const list = map.getByRole("list", { name: copy("Slide interactions"), exact: true });
      const choose = list.getByRole("button").filter({ hasText: "Original reveal" });
      await choose.click();
      await expect(choose).toHaveAttribute("aria-pressed", "true");
      await expect(choose.getByText("Original reveal", { exact: true })).toHaveAttribute(
        "lang",
        "",
      );
      await specialistQuality(page);
      await map.screenshot({ path: info.outputPath("korean-interaction-map.png") });
      await map.getByRole("button", { name: copy("Edit interaction"), exact: true }).click();
      await expect(picker).toBeVisible();
      await expect(picker).toHaveValue("local");
      expect(await saved()).toEqual(beforePreview);
      expect(writes.length).toBe(beforeMapWrites);
      expect(sideEffects).toHaveLength(0);
      expect(external).toHaveLength(0);

      const finalScene = await saved();
      await page.route(`${e01ApiUrl}/v1/auth/me`, async (route) => {
        const response = await route.fetch(),
          account = await response.json();
        account.creator.role = "viewer";
        await route.fulfill({ response, json: account });
      });
      await page.reload();
      await specialistInspector(page);
      const beforeViewer = writes.length;
      await picker.selectOption("local");
      await expect(revealBody).toHaveValue("Original audience detail revised");
      await expect(revealBody).toBeDisabled();
      await expect(previewButton).toBeEnabled();
      await previewButton.click();
      await expect(preview).toBeVisible();
      await page.keyboard.press("Escape");
      await picker.selectOption("external");
      await expect(url).toBeDisabled();
      await expect(url).toHaveValue("https://example.com/reviewed");
      await specialistQuality(page);
      expect(await saved()).toEqual(finalScene);
      expect(writes.length).toBe(beforeViewer);
      expect(sideEffects).toHaveLength(0);
    } finally {
      await page.unroute(`${e01ApiUrl}/v1/auth/me`);
      await specialistLocale(page, "en-CA");
    }
  });
}
