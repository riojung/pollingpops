import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ContentSlideDraft, PresentationScene } from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import {
  closeE01Overlays,
  createE01Deck,
  e01ApiUrl,
  e01Body,
  e01Slide,
  enterE01Editor,
  openE01Inspector,
  openE01Navigator,
  readE01Record,
  type E01Record,
} from "./presentation-e01-support";

test.use({ actionTimeout: 30_000 });

function currentSlide(record: E01Record) {
  const block = record.draft.blocks[0];
  if (block?.kind !== "content" || !block.scene) throw new Error("Expected a native slide");
  return block as ContentSlideDraft & { scene: PresentationScene };
}

async function workspaceDeck(page: Page) {
  const slide = e01Slide("A clear plan for the next release");
  slide.scene!.schemaVersion = 3;
  slide.scene!.design = { theme: "paper", font: "sans", spacing: "relaxed" };
  slide.speakerNotes = "PRIVATE workspace fixture cue";
  slide.citations = [{ locator: "Original planning source", excerpt: "Keep the agreed scope." }];
  return createE01Deck(page, [slide], 7);
}

async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
}

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

function popup(page: Page, name: string) {
  return page.locator(`[role="group"][aria-label="${name}"]`);
}

async function withinViewport(page: Page, surface: Locator) {
  await expect(surface).toBeVisible();
  await expect
    .poll(async () => {
      const bounds = await surface.boundingBox();
      const viewport = page.viewportSize();
      return Boolean(
        bounds &&
        viewport &&
        bounds.x >= -1 &&
        bounds.y >= -1 &&
        bounds.x + bounds.width <= viewport.width + 1 &&
        bounds.y + bounds.height <= viewport.height + 1,
      );
    })
    .toBe(true);
}

async function expectIcon(control: Locator) {
  await expect(control.locator('svg[aria-hidden="true"]')).toHaveCount(1);
}

async function openNativePicker(page: Page, name: "Insert more" | "Interactions") {
  await closeE01Overlays(page);
  const trigger = page.locator(`summary[aria-label="${name}"]`);
  await trigger.focus();
  await trigger.press("Enter");
  const menu = popup(page, name);
  await withinViewport(page, menu);
  return { trigger, menu };
}

for (const suffix of ["", " @mobile"]) {
  test(`grouped Content and visual Layout controls preserve editable slide history${suffix}`, async ({
    page,
  }, info) => {
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    const viewport = narrow ? { width: 390, height: 844 } : { width: 1280, height: 720 };
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const record = await workspaceDeck(page);
    const original = currentSlide(record);
    const body = original.scene.nodes[1]!;
    await enterE01Editor(page, record.id, narrow);
    const inspector = await openE01Inspector(page, "Content");
    const selected = inspector.getByRole("combobox", { name: "Selected object", exact: true });
    await selected.selectOption(body.id);
    const content = inspector.getByRole("group", { name: "Selected object", exact: true });
    const input = content.getByRole("textbox", { name: "Node text", exact: true });
    const assistance = content.getByRole("region", { name: "Writing assistance", exact: true });
    await expect(input).toHaveValue("Choose one action");
    await expect(assistance).toBeVisible();
    const [inputBounds, assistanceBounds] = await Promise.all([
      input.boundingBox(),
      assistance.boundingBox(),
    ]);
    expect(inputBounds!.y + inputBounds!.height).toBeLessThanOrEqual(assistanceBounds!.y);
    for (const name of ["Rewrite text", "Shorten text", "Translate text", "Delete object"])
      await expectIcon(content.getByRole("button", { name, exact: true }));
    await expect(content.getByRole("button", { name: "Delete object", exact: true })).toBeEnabled();
    await accessible(page);
    await page.screenshot({ scale: "css", path: info.outputPath("content-inspector-cards.png") });

    const revised = "Agree on one owner and a release date.";
    await input.fill(revised);
    await expect
      .poll(async () => e01Body((await readE01Record(page, record.id)).draft))
      .toBe(revised);
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("Choose one action");
    await expect
      .poll(async () => e01Body((await readE01Record(page, record.id)).draft))
      .toBe("Choose one action");
    await input.press("ControlOrMeta+Shift+z");
    await expect(input).toHaveValue(revised);
    await expect
      .poll(async () => e01Body((await readE01Record(page, record.id)).draft))
      .toBe(revised);

    await openE01Inspector(page, "Layout");
    const design = inspector.getByRole("group", { name: "Design", exact: true });
    await design
      .getByRole("combobox", { name: "Slide theme", exact: true })
      .selectOption("midnight");
    await expect(
      design.getByRole("button", { name: "Use Midnight theme", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const layouts = inspector.getByRole("group", { name: "Native layouts", exact: true });
    const layout = layouts.getByRole("button", { name: "Title and body", exact: true });
    await expectIcon(layout);
    const schematic = await layout.locator('svg[aria-hidden="true"]').boundingBox();
    expect(schematic).not.toBeNull();
    expect(schematic!.width).toBeGreaterThanOrEqual(60);
    expect(schematic!.height).toBeGreaterThanOrEqual(35);
    await layout.click();
    await expect
      .poll(async () => currentSlide(await readE01Record(page, record.id)).scene.nodes[0])
      .toMatchObject({ frame: { x: 7, y: 7, width: 86, height: 20 } });
    const arranged = currentSlide(await readE01Record(page, record.id));
    expect(arranged.scene.design).toEqual({ theme: "midnight", font: "sans", spacing: "relaxed" });
    expect(arranged.scene.readingOrder).toEqual(original.scene.readingOrder);
    expect(arranged.scene.nodes.map(({ id, type }) => ({ id, type }))).toEqual(
      original.scene.nodes.map(({ id, type }) => ({ id, type })),
    );
    expect(
      arranged.scene.nodes.filter((node) => node.type === "text").map((node) => node.text),
    ).toEqual(["A clear plan for the next release", revised]);
    expect(arranged.speakerNotes).toBe(original.speakerNotes);
    expect(arranged.citations).toEqual(original.citations);
    await accessible(page);
    await noOverflow(page);
    await page.screenshot({
      scale: "css",
      path: info.outputPath("layout-palette-and-presets.png"),
    });

    await openE01Inspector(page, "Media");
    await inspector
      .getByRole("textbox", { name: "New image description", exact: true })
      .fill("A release timeline");
    await page.screenshot({ scale: "css", path: info.outputPath("media-inspector-cards.png") });
    await openE01Inspector(page, "Access");
    await expect(
      inspector.getByRole("group", { name: "Slide objects · reading order", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      scale: "css",
      path: info.outputPath("access-reading-order-cards.png"),
    });
    await openE01Inspector(page, "Content");
    await expect(selected).toHaveValue(body.id);
    await expect(input).toHaveValue(revised);
    await page.setViewportSize({ width: 320, height: 844 });
    if (!narrow) await expect(inspector).toBeHidden();
    await openE01Inspector(page, "Content");
    await noOverflow(page);
    await accessible(page);
    await page.screenshot({ scale: "css", path: info.outputPath("content-inspector-320px.png") });
    await closeE01Overlays(page);
    await page.setViewportSize(viewport);
    if (!narrow) await expect(inspector).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    if (!narrow) await expect(inspector).toBeHidden();
    try {
      await openE01Inspector(page, "Content");
      await input.scrollIntoViewIfNeeded();
      await input.fill(revised);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(revised);
      await noOverflow(page);
      await page.screenshot({
        scale: "css",
        path: info.outputPath("content-inspector-200-percent.png"),
      });
    } finally {
      await page.evaluate(() => {
        document.documentElement.style.zoom = "";
      });
    }
    expect(currentSlide(await readE01Record(page, record.id))).toEqual(arranged);
  });

  test(`icon insertion menus and navigator popovers stay reachable with keyboard and dialogs${suffix}`, async ({
    page,
    browserName,
  }, info) => {
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    const viewport = narrow ? { width: 390, height: 844 } : { width: 1280, height: 720 };
    // macOS WebKit uses Option-Tab to include ordinary buttons in native focus order.
    const nextControlKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const record = await workspaceDeck(page);
    await enterE01Editor(page, record.id, narrow);
    for (const [action, field, label] of [
      ["Add native text", "Node text", "A newly inserted point"],
      ["Add native shape", "Shape label", "Decision"],
      ["Add native connector", "Connector label", "Next step"],
    ]) {
      await closeE01Overlays(page);
      const button = page.getByRole("button", { name: action, exact: true });
      await expectIcon(button);
      await button.click();
      const inspector = page.locator("#presentation-object-inspector");
      await expect(inspector).toBeVisible();
      await expect(inspector.getByRole("tab", { name: "Content", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await inspector.getByRole("textbox", { name: field, exact: true }).fill(label);
    }
    const more = await openNativePicker(page, "Insert more");
    for (const name of ["Add table", "Add bar chart", "Add line chart", "Add pie chart"])
      await expectIcon(more.menu.getByRole("button", { name, exact: true }));
    await more.trigger.press(nextControlKey);
    await expect(more.menu.getByRole("button", { name: "Add table", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(more.menu).toBeHidden();
    await expect(more.trigger).toBeFocused();
    await more.trigger.press("Enter");
    await more.menu.getByRole("button", { name: "Add table", exact: true }).click();
    await expect(more.menu).toBeHidden();
    await expect(page.getByRole("group", { name: "Table data editor", exact: true })).toBeVisible();
    const interactions = await openNativePicker(page, "Interactions");
    for (const name of [
      "Add reveal panel",
      "Add detail dialog",
      "Add image hotspot",
      "Add link",
      "Add slide link",
    ])
      await expectIcon(interactions.menu.getByRole("button", { name, exact: true }));
    await interactions.trigger.press(nextControlKey);
    await expect(
      interactions.menu.getByRole("button", { name: "Add reveal panel", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(interactions.menu).toBeHidden();
    await expect(interactions.trigger).toBeFocused();
    await interactions.trigger.press("Enter");
    await interactions.menu.getByRole("button", { name: "Add reveal panel", exact: true }).click();
    await expect(interactions.menu).toBeHidden();
    await expect(
      page.getByRole("textbox", { name: "Revealed audience content", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => currentSlide(await readE01Record(page, record.id)).scene.nodes.length)
      .toBe(7);
    const beforeMenus = (await readE01Record(page, record.id)).draft;
    expect(currentSlide({ ...record, draft: beforeMenus }).scene.nodes.slice(0, 2)).toEqual(
      currentSlide(record).scene.nodes,
    );
    await closeE01Overlays(page);
    const navigator = await openE01Navigator(page);
    const trigger = navigator.locator('summary[aria-label="Insert & import"]');
    await trigger.focus();
    await trigger.press("Enter");
    const menu = popup(page, "Insert & import");
    await withinViewport(page, menu);
    for (const name of [
      "Blank slide Empty canvas · matches this deck",
      "Content slide Title and body · matches this deck",
      "Add question",
      "Outline to slides",
      "From published Round",
      "From trusted source",
      "Import visual slides",
      "From Recovery Pack",
    ])
      await expectIcon(menu.getByRole("button", { name, exact: true }));
    await expect(menu.getByRole("menuitem")).toHaveCount(0);
    const [anchorBounds, menuBounds] = await Promise.all([
      trigger.boundingBox(),
      menu.boundingBox(),
    ]);
    expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(anchorBounds!.y + 1);
    expect(Math.abs(menuBounds!.x - anchorBounds!.x)).toBeLessThanOrEqual(1);
    await accessible(page);
    await noOverflow(page);
    await page.screenshot({
      scale: "css",
      path: info.outputPath("navigator-insert-menu-above.png"),
    });
    await trigger.press(nextControlKey);
    await expect(
      menu.getByRole("button", {
        name: "Blank slide Empty canvas · matches this deck",
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    const outline = menu.getByRole("button", { name: "Outline to slides", exact: true });
    await outline.click();
    const dialog = page.getByRole("dialog", { name: "Outline to slides", exact: true });
    await expect(dialog).toBeVisible();
    const availability = await page.request.get(
      `${e01ApiUrl}/v1/presentation-assistance/status?presentationId=${record.id}`,
    );
    expect(availability.status()).toBe(200);
    const { status } = await availability.json();
    expect(status.enabled).toBe(process.env.BETA_E2E_AUTHORING === "true");
    const outlineName = dialog.getByRole("textbox", { name: "Outline name", exact: true });
    if (status.enabled) await expect(outlineName).toBeEnabled();
    else await expect(outlineName).toBeDisabled();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    const sourceAction = menu.getByRole("button", { name: "From trusted source", exact: true });
    await sourceAction.click();
    const sourceDialog = page.getByRole("dialog", {
      name: "Insert from a trusted source",
      exact: true,
    });
    await expect(sourceDialog).toBeVisible();
    await expect(menu).toBeVisible();
    const sourceBounds = await sourceAction.boundingBox();
    expect(sourceBounds).not.toBeNull();
    const actionCenter = {
      x: sourceBounds!.x + sourceBounds!.width / 2,
      y: sourceBounds!.y + sourceBounds!.height / 2,
    };
    await expect
      .poll(() =>
        sourceDialog.evaluate((backdrop, point) => {
          const hit = document.elementFromPoint(point.x, point.y);
          return Boolean(hit && backdrop.contains(hit));
        }, actionCenter),
      )
      .toBe(true);
    await page.screenshot({
      scale: "css",
      path: info.outputPath("trusted-source-dialog-above-menu.png"),
    });
    await page.keyboard.press("Escape");
    await expect(sourceDialog).toBeHidden();
    await expect(menu).toBeVisible();
    await expect(navigator).toBeVisible();
    await expect(sourceAction).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.setViewportSize({ width: 320, height: 844 });
    if (!narrow) await expect(navigator).toBeHidden();
    await openE01Navigator(page);
    await trigger.focus();
    await trigger.press("Enter");
    await withinViewport(page, menu);
    await noOverflow(page);
    await page.screenshot({
      scale: "css",
      path: info.outputPath("navigator-insert-menu-320px.png"),
    });
    await page.keyboard.press("Escape");
    await closeE01Overlays(page);
    await page.setViewportSize(viewport);
    if (!narrow) await expect(navigator).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    if (!narrow) await expect(navigator).toBeHidden();
    try {
      await openE01Navigator(page);
      await trigger.focus();
      await trigger.press("Enter");
      await withinViewport(page, menu);
      await noOverflow(page);
      await page.screenshot({
        scale: "css",
        path: info.outputPath("navigator-insert-menu-200-percent.png"),
      });
    } finally {
      await page.evaluate(() => {
        document.documentElement.style.zoom = "";
      });
    }
    expect((await readE01Record(page, record.id)).draft).toEqual(beforeMenus);
  });
}
