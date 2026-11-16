import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { PresentationScene } from "../../packages/contracts/src/index.ts";
import { createE01Deck, e01ApiUrl, e01Slide, readE01Record } from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 15_000 });

async function setLocale(page: Page, locale: "en-CA" | "ko-KR") {
  expect(
    (
      await page.request.put(`${e01ApiUrl}/v1/account/locale`, {
        data: { locale },
        timeout: 20_000,
      })
    ).status(),
  ).toBe(200);
  await page
    .context()
    .addCookies([
      { name: "openround-locale", value: locale, url: new URL(page.url()).origin, sameSite: "Lax" },
    ]);
}

async function panels(page: Page, openLayout = false) {
  for (const id of ["presentation-slide-navigator", "presentation-object-inspector"]) {
    const toggle = page.locator(`button[aria-controls="${id}"]`);
    const expanded = (await toggle.getAttribute("aria-expanded")) === "true";
    const wanted = id === "presentation-object-inspector" && openLayout;
    if (expanded !== wanted) await toggle.click();
  }
  if (openLayout) await page.locator("#inspector-tab-layout").click();
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
  test(`Option B Korean native controls preserve geometry, authored labels and read-only inspection ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const slide = e01Slide("Original English slide title");
    const body = slide.scene!.nodes[1]!;
    if (body.type !== "text") throw new Error("Expected a text node");
    body.id = "evidence";
    body.text = "Evidence";
    body.frame = { x: 12, y: 35, width: 36, height: 28 };
    slide.scene!.readingOrder[1] = body.id;
    slide.scene!.schemaVersion = 4;
    slide.scene!.design = { theme: "paper", font: "sans", spacing: "relaxed" };
    slide.scene!.nodes.push({
      id: "original-shape",
      type: "shape",
      shape: "rounded_rectangle",
      label: "Original decision",
      color: "blue",
      frame: { x: 65, y: 40, width: 20, height: 20 },
    });
    slide.scene!.readingOrder.push("original-shape");
    const record = await createE01Deck(page, [slide], 8);
    const savedScene = async (): Promise<PresentationScene> => {
      const block = (await readE01Record(page, record.id)).draft.blocks[0];
      if (block?.kind !== "content" || !block.scene) throw new Error("Expected native content");
      return block.scene;
    };
    const frame = async () => {
      const node = (await savedScene()).nodes.find((node) => node.id === "evidence");
      if (node?.type !== "text") throw new Error("Expected original text node");
      return node.frame;
    };
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
      await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
      await panels(page);
      const controls = page.getByRole("group", { name: "선택한 개체 컨트롤", exact: true });
      const picker = controls.getByRole("combobox", { name: "캔버스 개체", exact: true });
      await expect(picker).toBeVisible();
      await picker.selectOption("evidence");
      await expect(picker.locator('option[value="evidence"]')).toHaveAttribute("lang", "");
      expect(await savedScene()).toEqual(slide.scene);
      expect(writes).toHaveLength(0);
      const move = controls.getByRole("button", {
        name: "Evidence 이동. 화살표 키로 미세 조정하세요.",
        exact: true,
      });
      const resize = controls.getByRole("button", {
        name: "Evidence 크기 조절. 화살표 키로 크기를 변경하세요.",
        exact: true,
      });
      await move.press("ArrowRight");
      await expect.poll(frame).toMatchObject({ x: 13, width: 36 });
      await expect(move).toBeFocused();
      await resize.press("Shift+ArrowRight");
      await expect.poll(frame).toMatchObject({ x: 13, width: 41 });
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect.poll(frame).toMatchObject({ x: 13, width: 36 });
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect.poll(savedScene).toEqual(slide.scene);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const controls = document.querySelector("[data-native-selection-controls]");
            const canvas = document.querySelector("[data-native-scene]");
            return Boolean(
              controls &&
              canvas &&
              controls.getBoundingClientRect().bottom <= canvas.getBoundingClientRect().top + 1,
            );
          }),
        )
        .toBe(true);
      await qualify(page);
      await controls.screenshot({ path: info.outputPath("korean-object-controls.png") });
      await panels(page, true);
      const font = page.getByRole("combobox", { name: "슬라이드 글꼴", exact: true });
      await font.selectOption("serif");
      const spacing = page.getByRole("combobox", { name: "슬라이드 간격", exact: true });
      await spacing.selectOption("compact");
      await expect
        .poll(async () => (await savedScene()).design)
        .toEqual({ theme: "paper", font: "serif", spacing: "compact" });
      expect((await savedScene()).nodes).toEqual(slide.scene!.nodes);
      expect((await savedScene()).readingOrder).toEqual(slide.scene!.readingOrder);
      await qualify(page);
      await page.locator("#presentation-object-inspector").screenshot({
        path: info.outputPath("korean-native-design.png"),
      });
      const saved = await readE01Record(page, record.id);
      await page.route(`${e01ApiUrl}/v1/auth/me`, async (route) => {
        const response = await route.fetch();
        const account = await response.json();
        account.creator.role = "viewer";
        await route.fulfill({ response, json: account });
      });
      await page.reload();
      await panels(page);
      await expect(picker).toBeEnabled();
      await expect(controls).toContainText(
        "읽기 전용입니다. 개체를 선택하고 슬라이드를 미리 볼 수 있습니다.",
      );
      const beforeInspection = writes.length;
      await picker.selectOption("original-shape");
      await expect(picker.locator("option:checked")).toContainText("Original decision");
      for (const button of await controls.getByRole("button").all())
        await expect(button).toBeDisabled();
      await panels(page, true);
      await expect(font).toBeDisabled();
      await expect(spacing).toBeDisabled();
      await qualify(page);
      expect((await readE01Record(page, record.id)).draft).toEqual(saved.draft);
      expect(writes.length).toBe(beforeInspection);
    } finally {
      await page.unroute(`${e01ApiUrl}/v1/auth/me`);
      await setLocale(page, "en-CA");
    }
  });
}
