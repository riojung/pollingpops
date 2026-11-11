import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";
import { specialistLocale } from "./option-b-specialist-support";
import { createE01Deck, e01Slide, readE01Record } from "./presentation-e01-support";
import {
  expectDocumentReflow,
  expectVisibleKeyboardFocus,
  tabTo,
  tabKey,
} from "./option-b-accessibility-support";

test.beforeEach(({ page }) => page.setDefaultTimeout(15_000));

async function start(page: Page, returnTo = "/templates") {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light", forcedColors: "none" });
  await signInBeta(page, undefined, { returnTo });
  await specialistLocale(page, "en-CA");
  await page.goto(returnTo);
  await expect(page.locator("html")).toHaveAttribute("lang", "en-CA");
}

async function skipIntoMain(page: Page) {
  const skip = page.locator('a[href="#main"],a[href="#presentation-canvas"]').first();
  await expect(skip).toBeAttached();
  await page.keyboard.press(tabKey(page));
  await expect(skip).toBeFocused();
  await expectVisibleKeyboardFocus(skip);
  await page.keyboard.press("Enter");
}

async function notesValue(page: Page, id: string) {
  const block = (await readE01Record(page, id)).draft.blocks[0];
  return block?.kind === "content" ? block.speakerNotes : undefined;
}

async function axe(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

test("Option B template discovery and preview preserve sequential keyboard focus in light, dark and forced colors", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await start(page);
  await skipIntoMain(page);
  const rounds = page.getByRole("tab", { name: "Rounds", exact: true });
  await tabTo(page, rounds);
  await page.keyboard.press("ArrowRight");
  const presentations = page.getByRole("tab", { name: "Presentations", exact: true });
  await expect(presentations).toBeFocused();
  await expect(presentations).toHaveAttribute("aria-selected", "true");
  const card = page.locator('[data-template-id="native-startup-pitch"]');
  const preview = card.getByRole("button", { name: "Preview structure", exact: true });
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
      /\/v1\/presentations(?:\/|$)/.test(new URL(request.url()).pathname)
    )
      mutations.push(request.method());
  });
  for (const mode of ["light", "dark", "forced"] as const) {
    await page.emulateMedia({
      colorScheme: mode === "dark" ? "dark" : "light",
      forcedColors: mode === "forced" ? "active" : "none",
      reducedMotion: "reduce",
    });
    await expect
      .poll(() => page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches))
      .toBe(true);
    await tabTo(page, preview);
    await expectVisibleKeyboardFocus(preview);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Presentation template preview", exact: true });
    await expect(dialog).toBeVisible();
    for (const key of ["Tab", "Tab", "Shift+Tab", "Shift+Tab", "Tab", "Tab"]) {
      await page.keyboard.press(key);
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    }
    await page.keyboard.press("ArrowRight");
    await expect(dialog.locator('[data-template-preview-slide="2"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expectVisibleKeyboardFocus(preview);
    await expectDocumentReflow(page);
    await axe(page);
  }
  expect(mutations).toEqual([]);
  await mkdir("artifacts/option-b-acceptance", { recursive: true });
  await page.screenshot({
    path: `artifacts/option-b-acceptance/${info.project.name}-keyboard-focus.png`,
  });
});

test("Option B native editor supports keyboard notes, history, preview privacy and inspector return", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await start(page);
  const source = e01Slide("Keyboard review source");
  const record = await createE01Deck(page, [source, e01Slide("Keyboard review second slide")]);
  await page.goto(`/presentation/${record.id}`);
  await skipIntoMain(page);
  const inspectorToggle = page
    .locator('button[aria-controls="presentation-object-inspector"]')
    .first();
  // Skip enters the canvas after the header. Firefox does not wrap Tab at document end.
  await tabTo(page, inspectorToggle, true);
  if ((await inspectorToggle.getAttribute("aria-expanded")) === "false")
    await page.keyboard.press("Enter");
  await tabTo(page, page.getByRole("tab", { name: "Content", exact: true }));
  for (let index = 0; index < 3; index++) await page.keyboard.press("ArrowRight");
  const notesTab = page.getByRole("tab", { name: "Notes", exact: true });
  await expect(notesTab).toBeFocused();
  await expectVisibleKeyboardFocus(notesTab);
  await page.keyboard.press("Enter");
  const notes = page.getByRole("textbox", { name: "Speaker notes", exact: true });
  await tabTo(page, notes);
  await expectVisibleKeyboardFocus(notes);
  const cue = "Synthetic private keyboard cue — exact {amount} $&";
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(cue);
  await expect.poll(async () => notesValue(page, record.id)).toBe(cue);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await tabTo(page, undo, true);
  await page.keyboard.press("Enter");
  await expect.poll(async () => notesValue(page, record.id)).toBe(source.speakerNotes);
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  await tabTo(page, redo);
  await page.keyboard.press("Enter");
  await expect.poll(async () => notesValue(page, record.id)).toBe(cue);
  await tabTo(page, inspectorToggle, true);
  await page.keyboard.press("Enter");
  await expect(page.locator("#presentation-object-inspector")).toBeHidden();
  await expectVisibleKeyboardFocus(inspectorToggle);
  await page.keyboard.press("Enter");
  await expect(notes).toHaveValue(cue);
  const preview = page.getByRole("button", { name: "Preview", exact: true });
  await tabTo(page, preview);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText(cue);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expectVisibleKeyboardFocus(preview);
  const saved = await readE01Record(page, record.id);
  const first = saved.draft.blocks[0];
  expect(first?.kind === "content" && first.scene).toEqual(source.scene);
  await axe(page);
});

for (const suffix of ["desktop", "phone @mobile"]) {
  test(`Option B creation and editor reflow retain keyboard access at 200/400-percent-equivalent viewports ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await start(page, "/create?type=quiz");
    for (const width of [640, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const create = page.getByRole("banner").getByRole("button", { name: "Create", exact: true });
      await tabTo(page, create);
      await expectVisibleKeyboardFocus(create);
      await page.keyboard.press("Enter");
      const menu = create.locator("xpath=parent::details");
      await expect(menu).toHaveAttribute("open", "");
      await page.keyboard.press(tabKey(page));
      const entry = menu.getByRole("link").first();
      await expectVisibleKeyboardFocus(entry);
      await page.keyboard.press("Escape");
      await expect(menu).not.toHaveAttribute("open", "");
      await expectVisibleKeyboardFocus(create);
      await expectDocumentReflow(page);
      await axe(page);
    }
    const record = await createE01Deck(page, [e01Slide("Reflow reading order")]);
    await page.goto(`/presentation/${record.id}`);
    for (const width of [640, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const inspector = page
        .locator('button[aria-controls="presentation-object-inspector"]')
        .first();
      await tabTo(page, inspector);
      await expectVisibleKeyboardFocus(inspector);
      await page.keyboard.press("Enter");
      const panel = page.locator("#presentation-object-inspector");
      await expect(panel).toBeVisible();
      const contentTab = panel.getByRole("tab", { name: "Content", exact: true });
      await tabTo(page, contentTab);
      await expectVisibleKeyboardFocus(contentTab);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expectVisibleKeyboardFocus(inspector);
      await expectDocumentReflow(page);
      await axe(page);
    }
    await mkdir("artifacts/option-b-acceptance", { recursive: true });
    await page.screenshot({
      path: `artifacts/option-b-acceptance/${info.project.name}-reflow.png`,
    });
  });
}
