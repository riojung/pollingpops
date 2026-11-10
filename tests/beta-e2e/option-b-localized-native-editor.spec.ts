import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { PresentationScene } from "../../packages/contracts/src/index.ts";
import { nativeEditorCopy } from "../../apps/web/components/presentation/native-editor-copy";
import { createE01Deck, e01ApiUrl, e01Slide, readE01Record } from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 15_000 });

async function setLocale(page: Page, locale: "en-CA" | "ko-KR" | "de-DE") {
  expect(
    (await page.request.put(`${e01ApiUrl}/v1/account/locale`, { data: { locale } })).status(),
  ).toBe(200);
  await page
    .context()
    .addCookies([
      { name: "openround-locale", value: locale, url: new URL(page.url()).origin, sameSite: "Lax" },
    ]);
}

async function inspect(page: Page, section: "content" | "layout" | "media" | "accessibility") {
  const mapToggle = page.locator('button[aria-controls="presentation-slide-navigator"]');
  if ((await mapToggle.getAttribute("aria-expanded")) === "true") await mapToggle.click();
  const toggle = page.locator('button[aria-controls="presentation-object-inspector"]');
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await page.locator(`#inspector-tab-${section}`).click();
  return page.locator("#presentation-object-inspector");
}

async function qualify(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean native editor preserves authored content, language, geometry and viewer inspection ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const copy = nativeEditorCopy("ko-KR");
    expect(copy("Selected object")).toBe("선택한 개체");
    expect(copy("Slide tools")).toBe("슬라이드 도구");
    const slide = e01Slide("Original English title");
    const title = slide.scene!.nodes[0]!;
    const body = slide.scene!.nodes[1]!;
    if (title.type !== "text" || body.type !== "text") throw new Error("Expected text objects");
    title.lang = "en";
    body.id = "original-body";
    body.text = "Texto original en español";
    body.lang = "es";
    body.frame = { x: 8, y: 35, width: 45, height: 35 };
    slide.scene!.schemaVersion = 7;
    slide.scene!.nodes.push(
      {
        id: "original-decision",
        type: "shape",
        shape: "rounded_rectangle",
        color: "blue",
        label: "Original decision",
        frame: { x: 65, y: 40, width: 25, height: 25 },
      },
      {
        id: "original-connection",
        type: "connector",
        from: { nodeId: title.id, anchor: "bottom" },
        to: { nodeId: "original-body", anchor: "top" },
        label: "Original connection",
        color: "blue",
      },
    );
    slide.scene!.readingOrder = slide.scene!.nodes.map((node) => node.id);
    const record = await createE01Deck(page, [slide], 16);
    const saved = async (): Promise<PresentationScene> => {
      const block = (await readE01Record(page, record.id)).draft.blocks[0];
      if (block?.kind !== "content" || !block.scene) throw new Error("Expected a native slide");
      return block.scene;
    };
    const node = async (id: string) => (await saved()).nodes.find((node) => node.id === id);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        new URL(request.url()).pathname === `/v1/presentations/${record.id}/draft`
      )
        writes.push(request.postData() ?? "");
    });
    try {
      await setLocale(page, "ko-KR");
      await page.goto(`/presentation/${record.id}`);
      const inspector = await inspect(page, "content");
      await expect(
        inspector.getByRole("heading", { name: copy("Slide tools"), exact: true }),
      ).toBeVisible();
      await expect(
        inspector.getByRole("button", { name: copy("Close inspector panel"), exact: true }),
      ).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
      const picker = inspector.getByRole("combobox", {
        name: copy("Selected object"),
        exact: true,
      });
      await picker.selectOption("original-body");
      await expect(picker.locator('option[value="original-body"]')).toHaveAttribute("lang", "es");
      const text = inspector.getByRole("textbox", { name: copy("Node text"), exact: true });
      await expect(text).toHaveValue(body.text);
      await expect(text).toHaveAttribute("lang", "es");
      expect(await saved()).toEqual(slide.scene);
      expect(writes).toHaveLength(0);
      await text.fill("Texto original revisado");
      await expect
        .poll(() => node("original-body"))
        .toMatchObject({
          text: "Texto original revisado",
          lang: "es",
        });
      await qualify(page);
      await inspector.screenshot({ path: info.outputPath("korean-native-content.png") });

      await picker.selectOption("original-decision");
      const shapeLabel = inspector.getByRole("textbox", { name: copy("Shape label"), exact: true });
      await expect(shapeLabel).toHaveValue("Original decision");
      await shapeLabel.fill("Original decision revised");
      await inspector
        .getByRole("combobox", { name: copy("Shape"), exact: true })
        .selectOption("diamond");
      await inspector
        .getByRole("combobox", { name: copy("Object color"), exact: true })
        .selectOption("green");
      await expect
        .poll(() => node("original-decision"))
        .toMatchObject({
          label: "Original decision revised",
          shape: "diamond",
          color: "green",
        });
      await picker.selectOption("original-connection");
      await expect(
        inspector.getByRole("textbox", { name: copy("Connector label"), exact: true }),
      ).toHaveValue("Original connection");
      await inspector
        .getByRole("combobox", { name: copy("From anchor"), exact: true })
        .selectOption("right");
      await expect
        .poll(() => node("original-connection"))
        .toMatchObject({
          from: { nodeId: title.id, anchor: "right" },
        });
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect
        .poll(() => node("original-connection"))
        .toMatchObject({
          from: { nodeId: title.id, anchor: "bottom" },
        });
      await picker.selectOption("original-decision");
      await inspect(page, "layout");
      const x = inspector.getByRole("spinbutton", {
        name: copy("Object {field} (%)", { field: copy("x") }),
        exact: true,
      });
      await x.fill("60");
      await x.blur();
      await expect.poll(() => node("original-decision")).toMatchObject({ frame: { x: 60 } });
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect.poll(() => node("original-decision")).toMatchObject({ frame: { x: 65 } });
      await page.getByRole("button", { name: "다시 실행", exact: true }).click();
      await expect.poll(() => node("original-decision")).toMatchObject({ frame: { x: 60 } });
      await qualify(page);

      await inspect(page, "accessibility");
      const originalOrder = (await saved()).readingOrder;
      await inspector
        .getByRole("button", { name: copy("Read object earlier"), exact: true })
        .click();
      const revisedOrder = [title.id, "original-decision", "original-body", "original-connection"];
      await expect.poll(async () => (await saved()).readingOrder).toEqual(revisedOrder);
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect.poll(async () => (await saved()).readingOrder).toEqual(originalOrder);
      await page.getByRole("button", { name: "다시 실행", exact: true }).click();
      await expect.poll(async () => (await saved()).readingOrder).toEqual(revisedOrder);
      await picker.selectOption("original-body");
      const language = inspector.getByRole("combobox", {
        name: copy("Text language"),
        exact: true,
      });
      await expect(language).toHaveValue("es");
      await language.selectOption("fr");
      await expect
        .poll(() => node("original-body"))
        .toMatchObject({ text: "Texto original revisado", lang: "fr" });
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect
        .poll(() => node("original-body"))
        .toMatchObject({ text: "Texto original revisado", lang: "es" });
      await qualify(page);
      await inspector.screenshot({ path: info.outputPath("korean-native-access.png") });

      await inspect(page, "media");
      const beforeDescription = writes.length;
      await inspector
        .getByRole("textbox", { name: copy("New image description"), exact: true })
        .fill("Descripción original sin cargar");
      await expect(inspector.getByLabel(copy("Add native image"), { exact: true })).toBeDisabled();
      await expect(inspector).toContainText(
        copy("Uploads are unavailable until malware scanning is configured."),
      );
      expect(writes.length).toBe(beforeDescription);
      await qualify(page);
      await inspector.screenshot({ path: info.outputPath("korean-native-media.png") });

      // Inspecting insertion choices creates nothing; an explicit insert can be undone exactly.
      await page.locator('button[aria-controls="presentation-object-inspector"]').click();
      const beforeMenu = await saved();
      const beforeMenuWrites = writes.length;
      const toolbar = page.getByRole("group", { name: copy("Insert slide objects"), exact: true });
      const interactions = toolbar.getByText(copy("Interactions"), { exact: true });
      await interactions.click();
      await expect(
        toolbar.getByRole("button", { name: copy("Add reveal panel"), exact: true }),
      ).toBeVisible();
      await interactions.click();
      expect(await saved()).toEqual(beforeMenu);
      expect(writes.length).toBe(beforeMenuWrites);
      const beforeInsert = await saved();
      await toolbar.getByRole("button", { name: copy("Add native text"), exact: true }).click();
      await expect
        .poll(async () => (await saved()).nodes.length)
        .toBe(beforeInsert.nodes.length + 1);
      const added = (await saved()).nodes.at(-1)!;
      expect(added).toMatchObject({ type: "text", role: "body", text: "" });
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect.poll(saved).toEqual(beforeInsert);

      const beforeLanguageSwitch = await saved();
      const beforeLanguageWrites = writes.length;
      await setLocale(page, "de-DE");
      await page.reload();
      await inspect(page, "content");
      const german = nativeEditorCopy("de-DE");
      await expect(
        inspector.getByRole("heading", { name: german("Slide tools"), exact: true }),
      ).toBeVisible();
      await expect(
        inspector.getByRole("combobox", { name: german("Selected object"), exact: true }),
      ).toBeVisible();
      await qualify(page);
      expect(await saved()).toEqual(beforeLanguageSwitch);
      expect(writes.length).toBe(beforeLanguageWrites);

      await setLocale(page, "ko-KR");
      await page.route(`${e01ApiUrl}/v1/auth/me`, async (route) => {
        const response = await route.fetch();
        const account = await response.json();
        account.creator.role = "viewer";
        await route.fulfill({ response, json: account });
      });
      await page.reload();
      await inspect(page, "content");
      const readOnlyWrites = writes.length;
      await expect(picker).toBeEnabled();
      await picker.selectOption("original-body");
      await expect(text).toHaveValue("Texto original revisado");
      await expect(text).toHaveAttribute("lang", "es");
      await expect(text).toBeDisabled();
      await expect(
        inspector.getByRole("button", { name: copy("Delete object"), exact: true }),
      ).toBeDisabled();
      await inspect(page, "layout");
      await expect(x).toBeDisabled();
      await inspect(page, "accessibility");
      await expect(language).toBeDisabled();
      await expect(
        inspector.getByRole("button", { name: copy("Read object later"), exact: true }),
      ).toBeDisabled();
      await inspect(page, "media");
      await expect(
        inspector.getByRole("textbox", { name: copy("New image description"), exact: true }),
      ).toBeDisabled();
      await qualify(page);
      expect(await saved()).toEqual(beforeLanguageSwitch);
      expect(writes.length).toBe(readOnlyWrites);
      expect((await readE01Record(page, record.id)).draft.schemaVersion).toBe(16);
    } finally {
      await page.unroute(`${e01ApiUrl}/v1/auth/me`);
      await setLocale(page, "en-CA");
    }
  });
}
