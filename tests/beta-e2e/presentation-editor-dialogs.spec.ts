import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { authoringWorkflowCopy } from "../../apps/web/components/editor/authoring-workflow-copy";
import { presentationSpatialEditorCopy } from "../../apps/web/components/presentation/presentation-spatial-editor-copy";
import { sectionsSpatialCopy } from "../../apps/web/lib/i18n/sections-spatial-copy";
import {
  LOCALE_COOKIE_NAME,
  type InteractiveQuestionBlockDraft,
  type SupportedLocale,
} from "../../packages/contracts/src/index.ts";
import {
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  openEditorActions,
  readE01Record,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 30_000 });

async function publishedFixture(page: Page, info: TestInfo) {
  const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
  await page.setViewportSize(narrow ? { width: 320, height: 740 } : { width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await signInBeta(page);
  const run = randomUUID().slice(0, 8);
  const slides = Array.from({ length: 11 }, (_, index) =>
    e01Slide(`Review page ${index + 1} ${run}`),
  );
  const check: InteractiveQuestionBlockDraft = {
    id: randomUUID(),
    kind: "question",
    question: {
      id: randomUUID(),
      type: "single_select",
      prompt: "Which next step has a clear owner?",
      choices: [
        { id: randomUUID(), label: "Name an owner and a date", isCorrect: true },
        { id: randomUUID(), label: "Leave the next step open", isCorrect: false },
      ],
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 30,
      basePoints: 100,
      explanation: "An owner and a date make the next step actionable.",
      mediaId: null,
      mediaAlt: null,
    },
  };
  const blocks = [...slides.slice(0, 5), check, ...slides.slice(5)];
  const record = await createE01Deck(page, blocks, 7);
  const publication = await page.request.post(
    `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
    { data: { expectedDraftRevision: record.draftRevision } },
  );
  expect(publication.status(), await publication.text()).toBe(200);
  const versionId = (await publication.json()).version.id as string;
  await enterE01Editor(page, record.id, narrow);
  await expect(page.getByRole("button", { name: "Share review link", exact: true })).toBeEnabled();
  return { record, versionId, blocks };
}

async function openDialog(page: Page, action: string, name: string) {
  const trigger = page.getByRole("button", { name: action, exact: true, includeHidden: true });
  if (!(await trigger.isVisible())) await openEditorActions(page);
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name, exact: true });
  await expect(dialog).toBeVisible();
  return { trigger, dialog };
}

async function expectBoundedDialog(page: Page, dialog: Locator, title: string) {
  const viewport = page.viewportSize()!;
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.y).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
  await expect(dialog.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const headingSizes = await dialog
    .getByRole("heading")
    .evaluateAll((headings) =>
      headings.map((heading) => parseFloat(getComputedStyle(heading).fontSize)),
    );
  expect(Math.max(...headingSizes)).toBeLessThanOrEqual(32);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  for (const select of await dialog.getByRole("combobox").all()) {
    const bounds = await select.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeGreaterThanOrEqual(40);
  }
}

async function expectBoundedAction(action: Locator, dialog: Locator) {
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport({ ratio: 1 });
  const button = await action.boundingBox();
  const modal = await dialog.boundingBox();
  expect(button).not.toBeNull();
  expect(modal).not.toBeNull();
  expect(button!.height).toBeLessThanOrEqual(72);
  expect(button!.x).toBeGreaterThanOrEqual(modal!.x - 1);
  expect(button!.x + button!.width).toBeLessThanOrEqual(modal!.x + modal!.width + 1);
}

async function expectModalFocus(
  page: Page,
  dialog: Locator,
  trigger: Locator,
  closeName = "Close",
) {
  const containsFocus = () =>
    dialog.evaluate((element) => element.contains(document.activeElement));
  await expect.poll(containsFocus).toBe(true);
  const close = dialog.getByRole("button", { name: closeName, exact: true });
  await close.focus();
  if (await dialog.evaluate((element) => element instanceof HTMLDialogElement)) {
    // Native tab stops include browser chrome and, in Firefox, scrolling regions.
    // A focused background control is always a failure, regardless of tab order.
    const nativeFocusAllowed = () =>
      dialog.evaluate((element) => {
        const active = document.activeElement;
        return (
          element.contains(active) ||
          active === document.body ||
          active === document.documentElement
        );
      });
    await page.keyboard.press("Tab");
    await expect.poll(nativeFocusAllowed).toBe(true);
    await page.keyboard.press("Shift+Tab");
    await expect.poll(nativeFocusAllowed).toBe(true);
    await close.focus();
    await trigger.evaluate((element) => {
      if (element instanceof HTMLElement) element.focus();
    });
    await expect(close).toBeFocused();
    await expect.poll(containsFocus).toBe(true);
    return;
  }
  await page.keyboard.press("Shift+Tab");
  await expect.poll(containsFocus).toBe(true);
  await page.keyboard.press("Tab");
  await expect.poll(containsFocus).toBe(true);
  await close.focus();
  await trigger.evaluate((element) => {
    if (element instanceof HTMLElement) element.focus();
  });
  await expect(close).toBeFocused();
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .include('dialog[open], [role="dialog"][aria-modal="true"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(violations).toEqual([]);
}

async function escapeToTrigger(page: Page, dialog: Locator, trigger: Locator) {
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

async function setEditorLocale(page: Page, locale: SupportedLocale) {
  const response = await page.request.put(`${e01ApiUrl}/v1/account/locale`, { data: { locale } });
  expect(response.status()).toBe(200);
  await page.context().addCookies([
    {
      name: LOCALE_COOKIE_NAME,
      value: locale,
      url: new URL(page.url()).origin,
      sameSite: "Lax",
    },
  ]);
}

const deliveries = [
  {
    action: "Share review link",
    title: "Share a private review link",
    endpoint: "shares",
    deadline: "Link expires in",
    create: "Create link",
    link: "Your private link",
    copy: "Copy link",
    open: "Open review",
    revoke: "Revoke link",
    inspect: "Review feedback",
    empty: "No review links yet.",
    screenshot: "share-review",
  },
  {
    action: "Assign reading",
    title: "Assign a reading assignment",
    endpoint: "assignments",
    deadline: "Reading deadline",
    create: "Create assignment",
    link: "Your assignment link",
    copy: "Copy assignment link",
    open: "Open assignment",
    revoke: "Revoke assignment",
    inspect: "Reading insights",
    empty: "No reading assignments yet.",
    screenshot: "assign-reading",
  },
  {
    action: "Assign practice",
    title: "Assign self-paced practice",
    endpoint: "practice-assignments",
    deadline: "Practice deadline",
    create: "Create assignment",
    link: "Your assignment link",
    copy: "Copy assignment link",
    open: "Open assignment",
    revoke: "Revoke assignment",
    inspect: "Practice insights",
    empty: "No practice assignments yet.",
    screenshot: "assign-practice",
  },
] as const;

for (const suffix of ["", " @mobile"]) {
  test(`editor delivery dialogs keep creation, populated lists and export reachable${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const { record, versionId } = await publishedFixture(page, info);
    for (const delivery of deliveries) {
      const endpoint = `${e01ApiUrl}/v1/presentations/${record.id}/${delivery.endpoint}`;
      const empty = await openDialog(page, delivery.action, delivery.title);
      await expect(empty.dialog.getByText(delivery.empty, { exact: true })).toBeVisible();
      await expectBoundedDialog(page, empty.dialog, delivery.title);
      await page.screenshot({
        scale: "css",
        path: info.outputPath(`${delivery.screenshot}-empty.png`),
      });
      await escapeToTrigger(page, empty.dialog, empty.trigger);
      // Four browser projects share this actor's creation budget; three rows still require scrolling.
      const seededCount = 2;
      for (let index = 0; index < seededCount; index++) {
        const seeded = await page.request.post(endpoint, {
          data: {
            requestId: randomUUID(),
            versionId,
            token: randomBytes(32).toString("base64url"),
            expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          },
        });
        expect(seeded.status(), await seeded.text()).toBe(201);
      }
      const { trigger, dialog } = await openDialog(page, delivery.action, delivery.title);
      const deadline = dialog.getByRole("combobox", { name: delivery.deadline, exact: true });
      await expect(deadline).toBeEnabled();
      await deadline.selectOption("30");
      await expect(dialog.getByRole("button", { name: delivery.revoke, exact: true })).toHaveCount(
        seededCount,
      );
      await expectBoundedDialog(page, dialog, delivery.title);
      await expectModalFocus(page, dialog, trigger);
      const creation = page.waitForResponse(
        (response) => response.url() === endpoint && response.request().method() === "POST",
      );
      const create = dialog.getByRole("button", { name: delivery.create, exact: true });
      await expectBoundedAction(create, dialog);
      await create.click();
      const created = await creation;
      expect(created.status(), await created.text()).toBe(201);
      const url = (await created.json()).url as string;
      const link = dialog.getByRole("textbox", { name: delivery.link, exact: true });
      await expect(link).toHaveValue(url);
      await expect(dialog.getByRole("link", { name: delivery.open, exact: true })).toHaveAttribute(
        "href",
        url,
      );
      await expectBoundedAction(
        dialog.getByRole("button", { name: delivery.copy, exact: true }),
        dialog,
      );
      await expect(dialog.getByRole("button", { name: delivery.revoke, exact: true })).toHaveCount(
        seededCount + 1,
      );
      await expectBoundedDialog(page, dialog, delivery.title);
      await expectAccessible(page);
      await page.screenshot({
        scale: "css",
        path: info.outputPath(`${delivery.screenshot}-created.png`),
        mask: [link],
      });

      const lastRevoke = dialog.getByRole("button", { name: delivery.revoke, exact: true }).last();
      await expectBoundedAction(
        dialog.getByRole("button", { name: delivery.inspect, exact: true }).last(),
        dialog,
      );
      await expectBoundedAction(lastRevoke, dialog);
      await page.screenshot({
        scale: "css",
        path: info.outputPath(`${delivery.screenshot}-populated-list.png`),
        mask: [link],
      });
      await lastRevoke.click();
      await expect(lastRevoke).toBeDisabled();
      await expectBoundedDialog(page, dialog, delivery.title);
      await escapeToTrigger(page, dialog, trigger);
    }

    const { trigger, dialog } = await openDialog(
      page,
      "Export presentation",
      "Export presentation",
    );
    await expectModalFocus(page, dialog, trigger);
    const format = dialog.getByRole("combobox", { name: "Format", exact: true });
    await format.selectOption("offline_html");
    await expectBoundedDialog(page, dialog, "Export presentation");
    const download = dialog.getByRole("button", { name: "Download export", exact: true });
    await expect(download).toBeEnabled();
    await expectBoundedAction(download, dialog);
    await expectAccessible(page);
    await page.screenshot({ scale: "css", path: info.outputPath("export-presentation.png") });
    const downloaded = page.waitForEvent("download");
    await download.click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toMatch(/\.html$/);
    const output = info.outputPath("editor-published-presentation.html");
    await file.saveAs(output);
    const html = await readFile(output, "utf8");
    expect(html).toContain("Which next step has a clear owner?");
    expect(html).not.toContain("PRIVATE E01 speaker cue");
    await expect(download).toBeEnabled();
    await escapeToTrigger(page, dialog, trigger);
  });

  test(`Arrange space keeps its playback filmstrip bounded while numeric edits preserve order${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const { record, blocks } = await publishedFixture(page, info);
    const { trigger, dialog } = await openDialog(page, "Arrange space", "Arrange space");
    await expectModalFocus(page, dialog, trigger, "Close arrange space");
    await dialog.getByRole("button", { name: "Enable spatial layout", exact: true }).click();
    const filmstrip = dialog.getByRole("list", {
      name: "Spatial frames in playback order",
      exact: true,
    });
    await expect(filmstrip.getByRole("button")).toHaveCount(blocks.length);
    const order = await filmstrip.getByRole("button").allTextContents();
    const geometry = await filmstrip.evaluate((list) => {
      const buttons = Array.from(list.querySelectorAll("button"));
      const tops = buttons.map((button) => button.getBoundingClientRect().top);
      return {
        rowSpread: Math.max(...tops) - Math.min(...tops),
        height: list.getBoundingClientRect().height,
        overflows: list.scrollWidth > list.clientWidth,
        clipsHorizontally: ["auto", "scroll"].includes(getComputedStyle(list).overflowX),
      };
    });
    expect(geometry.rowSpread).toBeLessThanOrEqual(1);
    expect(geometry.height).toBeLessThanOrEqual(170);
    expect(geometry.overflows).toBe(true);
    expect(geometry.clipsHorizontally).toBe(true);
    await expectBoundedDialog(page, dialog, "Arrange space");

    const last = blocks.at(-1)!;
    await dialog
      .getByRole("combobox", { name: "Selected frame", exact: true })
      .selectOption(last.id);
    const lastPage = filmstrip.getByRole("button").last();
    await expect(lastPage).toHaveAttribute("aria-current", "step");
    await expect(lastPage).toBeInViewport({ ratio: 1 });
    const x = dialog.getByRole("spinbutton", { name: "Frame X", exact: true });
    await x.fill("640");
    await x.press("Enter");
    const savedFrame = async () =>
      (await readE01Record(page, record.id)).draft.spatial?.frames.find(
        (frame) => frame.blockId === last.id,
      );
    await expect.poll(savedFrame).toMatchObject({ x: 640 });
    await x.fill("960");
    await x.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(x).toHaveValue("640");
    await x.press("Tab");
    expect(await savedFrame()).toMatchObject({ x: 640 });
    const width = dialog.getByRole("spinbutton", { name: "Frame width", exact: true });
    await width.fill("960");
    await width.press("Tab");
    await expect.poll(savedFrame).toMatchObject({ x: 640, width: 960, height: 540 });
    expect((await readE01Record(page, record.id)).draft.blocks.map((block) => block.id)).toEqual(
      blocks.map((block) => block.id),
    );
    expect(await filmstrip.getByRole("button").allTextContents()).toEqual(order);
    await expectBoundedAction(
      dialog.getByRole("button", { name: "Reset selected frame", exact: true }),
      dialog,
    );
    await expectBoundedDialog(page, dialog, "Arrange space");
    await expectAccessible(page);
    await page.screenshot({ scale: "css", path: info.outputPath("arrange-space-last-frame.png") });
    if (!suffix) {
      await page.setViewportSize({ width: 1280, height: 500 });
      await expectBoundedDialog(page, dialog, "Arrange space");
      await expect(filmstrip).toBeInViewport({ ratio: 1 });
      await expect(lastPage).toBeInViewport({ ratio: 1 });
      await expectBoundedAction(
        dialog.getByRole("button", { name: "Reset selected frame", exact: true }),
        dialog,
      );
      await page.screenshot({ scale: "css", path: info.outputPath("arrange-space-short.png") });
    }
    await escapeToTrigger(page, dialog, trigger);
    if (suffix) {
      const originalDraft = (await readE01Record(page, record.id)).draft;
      try {
        for (const locale of ["fr-FR", "de-DE", "pt-PT"] as const) {
          await setEditorLocale(page, locale);
          await page.reload();
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          const copy = sectionsSpatialCopy(locale);
          const workflowCopy = authoringWorkflowCopy(locale);
          const more = page.locator(`summary[aria-label="${workflowCopy.moreOptions}"]`);
          const moreMenu = more.locator("..");
          if ((await moreMenu.getAttribute("open")) === null) await more.click();
          const localized = await openDialog(
            page,
            workflowCopy.arrangeSpace,
            copy("Arrange space"),
          );
          await expect(localized.dialog).toHaveAttribute("lang", locale);
          const settings = localized.dialog.locator(
            `summary[aria-label="${presentationSpatialEditorCopy(locale).settings}"]`,
          );
          await settings.click();
          const popup = settings.locator("..").locator(":scope > div");
          await expect(popup).toBeInViewport({ ratio: 1 });
          const bounds = await popup.boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.y).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
          expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
          const disable = localized.dialog.getByRole("button", {
            name: copy("Disable spatial layout"),
            exact: true,
          });
          await expect(disable).toBeEnabled();
          await expect(disable).toBeInViewport({ ratio: 1 });
          await expectBoundedDialog(page, localized.dialog, copy("Arrange space"));
          await page.screenshot({
            scale: "css",
            path: info.outputPath(`arrange-space-settings-${locale}.png`),
          });
          await disable.click();
          await expect(
            localized.dialog.getByRole("button", {
              name: copy("Enable spatial layout"),
              exact: true,
            }),
          ).toBeVisible();
          await expect
            .poll(async () => (await readE01Record(page, record.id)).draft.spatial)
            .toBeUndefined();
          await escapeToTrigger(page, localized.dialog, localized.trigger);
          if ((await moreMenu.getAttribute("open")) !== null) await more.click();
          // Undo re-enables the layout with the authored positions and sizes intact.
          await page.locator("[data-editor-history]").getByRole("button").first().click();
          await expect
            .poll(async () => (await readE01Record(page, record.id)).draft)
            .toEqual(originalDraft);
        }
      } finally {
        await setEditorLocale(page, "en-CA");
      }
    }
  });
}
