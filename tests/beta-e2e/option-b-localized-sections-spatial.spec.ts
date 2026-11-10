import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { authoringWorkflowCopy } from "../../apps/web/components/editor/authoring-workflow-copy";
import {
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  openE01Navigator,
  readE01Record,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 15_000 });
const hiddenTitle = "PRIVATE original planning slide";
const sectionTitle = "Original planning section";

async function setLocale(page: Page, locale: "en-CA" | "ko-KR") {
  const response = await page.request.put(`${e01ApiUrl}/v1/account/locale`, {
    data: { locale },
    timeout: 20_000,
  });
  expect(response.status()).toBe(200);
  await page
    .context()
    .addCookies([
      { name: "openround-locale", value: locale, url: new URL(page.url()).origin, sameSite: "Lax" },
    ]);
}

async function closePanels(page: Page) {
  for (const id of ["presentation-slide-navigator", "presentation-object-inspector"]) {
    const toggle = page.locator(`button[aria-controls="${id}"]`);
    if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
  }
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

async function arrange(page: Page) {
  const more = page.locator(`summary[aria-label="${authoringWorkflowCopy("ko-KR").moreOptions}"]`);
  const disclosure = more.locator("..");
  if ((await disclosure.getAttribute("open")) === null) await more.click();
  await page.getByRole("button", { name: "공간 배치", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "공간 배치", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean Sections and spatial editing preserve authored order and viewer grants ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await signInBeta(page);
    const mobile = suffix === "@mobile";
    if (mobile) await page.setViewportSize({ width: 320, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const opening = e01Slide("Original opening slide");
    const closing = e01Slide("Original closing slide");
    const hidden = { ...e01Slide(hiddenTitle), hidden: true as const };
    const record = await createE01Deck(page, [opening, hidden, closing], 7);
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
      await openE01Navigator(page);
      const sections = page.getByRole("region", { name: "섹션 및 탐색", exact: true });
      await expect(sections).toBeVisible();
      expect((await readE01Record(page, record.id)).draft).toEqual(record.draft);
      expect(writes).toHaveLength(0);
      await sections.getByRole("button", { name: "섹션 및 탐색 활성화", exact: true }).click();
      await sections.getByRole("button", { name: "섹션 추가", exact: true }).click();
      const name = sections.getByRole("textbox", { name: "섹션 1 이름", exact: true });
      await expect(name).toHaveValue("새 섹션");
      await name.fill(sectionTitle);
      await sections.getByRole("button", { name: "이름 바꾸기", exact: true }).click();
      await expect
        .poll(async () => (await readE01Record(page, record.id)).draft.sections?.[0]?.title)
        .toBe(sectionTitle);
      const sectionId = (await readE01Record(page, record.id)).draft.sections![0]!.id;
      await sections
        .getByRole("combobox", { name: "선택한 블록의 섹션", exact: true })
        .selectOption(sectionId);
      await expect
        .poll(async () => (await readE01Record(page, record.id)).draft.sections?.[0]?.blockIds)
        .toEqual([opening.id]);
      await qualify(page);
      if (mobile) await closePanels(page);
      const dialog = await arrange(page);
      await dialog.getByRole("button", { name: "공간 레이아웃 활성화", exact: true }).click();
      await expect
        .poll(async () => (await readE01Record(page, record.id)).draft.spatial?.frames.length)
        .toBe(3);
      await dialog
        .getByRole("combobox", { name: "선택한 프레임", exact: true })
        .selectOption(closing.id);
      const originalFrame = (await readE01Record(page, record.id)).draft.spatial!.frames.find(
        (frame) => frame.blockId === closing.id,
      )!;
      const x = dialog.getByRole("spinbutton", { name: "프레임 X", exact: true });
      await x.fill("640");
      await x.press("Tab");
      const width = dialog.getByRole("spinbutton", { name: "프레임 너비", exact: true });
      await width.fill("1600");
      await width.press("Tab");
      const frame = async () =>
        (await readE01Record(page, record.id)).draft.spatial!.frames.find(
          (item) => item.blockId === closing.id,
        );
      await expect.poll(frame).toMatchObject({ x: 640, width: 1600, height: 900 });
      await qualify(page);
      await dialog.screenshot({ path: info.outputPath("korean-arrange-space.png") });
      await dialog.getByRole("button", { name: "공간 배치 닫기", exact: true }).click();
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect.poll(frame).toMatchObject({ x: 640, width: originalFrame.width });
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect.poll(frame).toEqual(originalFrame);
      await page.getByRole("button", { name: "다시 실행", exact: true }).click();
      await page.getByRole("button", { name: "다시 실행", exact: true }).click();
      await expect.poll(frame).toMatchObject({ x: 640, width: 1600 });
      const previewArrange = await arrange(page);
      await previewArrange.getByRole("button", { name: "경로 미리보기", exact: true }).click();
      const preview = page.getByRole("dialog", {
        name: authoringWorkflowCopy("ko-KR").preview,
        exact: true,
      });
      await expect(preview).toBeVisible();
      await expect(preview.locator("[data-spatial-page]")).toHaveCount(2);
      await expect(preview).not.toContainText(hiddenTitle);
      await expect(preview).not.toContainText("PRIVATE E01 speaker cue");
      await qualify(page);
      await preview.screenshot({ path: info.outputPath("korean-spatial-preview.png") });
      await preview
        .getByRole("button", { name: authoringWorkflowCopy("ko-KR").closePreview, exact: true })
        .click();
      const saved = await readE01Record(page, record.id);
      expect(saved.draft.blocks).toEqual(record.draft.blocks);
      expect(saved.draft.sections![0]).toMatchObject({
        title: sectionTitle,
        blockIds: [opening.id],
      });
      const beforeLanguageChange = writes.length;
      await setLocale(page, "en-CA");
      await page.reload();
      await openE01Navigator(page);
      await expect(
        page.getByRole("region", { name: "Sections and navigation", exact: true }),
      ).toBeVisible();
      expect((await readE01Record(page, record.id)).draft).toEqual(saved.draft);
      expect(writes.length).toBe(beforeLanguageChange);
      await setLocale(page, "ko-KR");
      await page.route(`${e01ApiUrl}/v1/auth/me`, async (route) => {
        const response = await route.fetch();
        const account = await response.json();
        account.creator.role = "viewer";
        await route.fulfill({ response, json: account });
      });
      await page.reload();
      await openE01Navigator(page);
      await expect(sections).toBeVisible();
      await expect(name).toHaveValue(sectionTitle);
      const readOnlyWrites = writes.length;
      for (const button of await sections.getByRole("button").all())
        await expect(button).toBeDisabled();
      await expect(name).toBeDisabled();
      await expect(sections.getByRole("combobox")).toBeDisabled();
      await qualify(page);
      expect((await readE01Record(page, record.id)).draft).toEqual(saved.draft);
      expect(writes.length).toBe(readOnlyWrites);
    } finally {
      await page.unroute(`${e01ApiUrl}/v1/auth/me`);
      await setLocale(page, "en-CA");
    }
  });
}
