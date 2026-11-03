import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  canvasAction,
  closeInspector,
  fits,
  newTeamCanvas,
  openInsert,
  openInspector,
  openPresentation,
  organization,
  saveText,
  snapshot,
} from "./support";

async function singleBar(page: Page) {
  const bar = page.getByTestId("canvas-topbar");
  await expect(bar).toBeVisible();
  const bounds = (await bar.boundingBox())!;
  expect(bounds.height).toBeLessThanOrEqual(68);
  expect(bounds.y).toBe(0);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual((await page.viewportSize())!.width);
  await fits(page);
}
async function theme(page: Page, mode: "light" | "dark") {
  await page.emulateMedia({ colorScheme: mode });
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
  await expect.poll(async () => (await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

async function assetDialogFocus(page: Page, id: string) {
  const insert = page.getByRole("button", { name: "Insert", exact: true });
  for (const [action, title] of [
    ["Image", "Add image"],
    ["Link", "Add link"],
    ["Add SVG image", "Add SVG image"],
  ] as const) {
    await openInsert(page, action);
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog.locator("input").first()).toBeFocused();
    if (action === "Add SVG image") await page.keyboard.press("Escape");
    else await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(insert).toBeFocused();
  }
  await openInsert(page, "Link");
  const dialog = page.getByRole("dialog", { name: "Add link", exact: true });
  await dialog
    .getByRole("textbox", { name: "Link URL", exact: true })
    .fill("https://example.test/focus");
  await dialog.getByRole("textbox", { name: "Link label", exact: true }).fill("Review focus link");
  await dialog.getByRole("button", { name: "Add link", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(insert).toBeFocused();
  await expect.poll(async () => (await snapshot(page, id)).objects.length).toBe(1);
}

test("asset dialogs restore the visible Insert opener after cancel and success", async ({
  page,
}, testInfo) => {
  await organization(page, testInfo);
  const id = await newTeamCanvas(page);
  await assetDialogFocus(page, id);
});

test("@mobile selection inspector hands off and restores keyboard focus during its slide", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await organization(page, testInfo);
  const id = await newTeamCanvas(page);
  await assetDialogFocus(page, id);
  const drawer = page.getByTestId("canvas-inspector");
  const more = page
    .getByRole("toolbar", { name: "Selection formatting", exact: true })
    .getByRole("button", { name: "More actions", exact: true });
  async function openFromSelection(tab: "Properties" | "Arrange") {
    await more.focus();
    await more.press("Enter");
    await expect(drawer).toHaveAttribute("data-open", "true");
    await expect(drawer.getByRole("tab", { name: tab, exact: true })).toBeFocused();
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[inert]")))).toBe(
      false,
    );
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveAttribute("data-open", "false");
    await expect(more).toBeFocused();
  }
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await openFromSelection("Properties");
  }
  await page
    .getByRole("group", { name: "Canvas tools", exact: true })
    .getByRole("button", { name: "Sticky note", exact: true })
    .click();
  await expect.poll(async () => (await snapshot(page, id)).objects.length).toBe(2);
  await openInspector(page, "Objects");
  await drawer.getByRole("checkbox", { name: "Select Review focus link", exact: true }).check();
  await closeInspector(page);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await openFromSelection("Arrange");
  }
});

test("compact chrome preserves inspector drafts, layout actions and canvas keyboard boundaries", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await organization(page, testInfo);
  const id = await newTeamCanvas(page);
  const drawer = page.getByRole("complementary", { name: "Inspector", exact: true });
  await expect(drawer).toHaveCount(0);
  await singleBar(page);
  const fullCanvas = (await page.getByTestId("canvas-surface").boundingBox())!;
  expect(fullCanvas.height).toBeGreaterThan(850);
  await openInspector(page, "Objects");
  await expect(drawer.getByRole("tab", { name: "Objects", exact: true })).toBeFocused();
  expect(
    fullCanvas.width - (await page.getByTestId("canvas-surface").boundingBox())!.width,
  ).toBeGreaterThan(300);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Object outline", exact: true })).toBeFocused();

  await page
    .getByRole("group", { name: "Canvas tools", exact: true })
    .getByRole("button", { name: "Sticky note", exact: true })
    .click();
  await openInspector(page);
  const text = drawer.getByRole("textbox", { name: "Text", exact: true });
  await text.fill("Retain this local draft");
  await drawer.getByRole("tab", { name: "Objects", exact: true }).click();
  await drawer.getByRole("tab", { name: "Properties", exact: true }).click();
  await expect(text).toHaveValue("Retain this local draft");
  await closeInspector(page);
  await expect(page.getByRole("status").filter({ hasText: /^Unsaved changes$/ })).toBeVisible();
  await openInspector(page);
  await expect(text).toHaveValue("Retain this local draft");
  await saveText(page, "First item");
  await closeInspector(page);
  await page
    .getByRole("group", { name: "Canvas tools", exact: true })
    .getByRole("button", { name: "Sticky note", exact: true })
    .click();
  await saveText(page, "Second item");
  await openInspector(page, "Objects");
  await drawer.getByRole("checkbox", { name: "Select First item", exact: true }).check();
  await openInspector(page, "Arrange");
  await drawer.getByRole("button", { name: "Group selection", exact: true }).click();
  await expect
    .poll(async () => {
      const objects = (await snapshot(page, id)).objects;
      return (
        objects.length === 2 &&
        Boolean(objects[0]!.geometricGroupId) &&
        objects[0]!.geometricGroupId === objects[1]!.geometricGroupId
      );
    })
    .toBe(true);
  const before = await snapshot(page, id);
  const panel = drawer.getByRole("tabpanel", { name: "Arrange", exact: true });
  await panel.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+z");
  expect((await snapshot(page, id)).objects).toEqual(before.objects);
  expect((await snapshot(page, id)).canvasSeq).toBe(before.canvasSeq);
  await page.getByRole("heading", { name: "Shared planning canvas", exact: true }).click();
  for (const mode of ["light", "dark"] as const) {
    await theme(page, mode);
    await singleBar(page);
    await page.screenshot({ path: testInfo.outputPath(`compact-arrange-${mode}.png`) });
  }
  await closeInspector(page);
  await page.getByTestId("canvas-surface").focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await snapshot(page, id)).canvasSeq)
    .toBeGreaterThan(before.canvasSeq);
  const after = await snapshot(page, id);
  for (const old of before.objects)
    expect(after.objects.find((object) => object.id === old.id)?.x).toBe(old.x + 1);

  await openPresentation(page);
  await page.getByRole("button", { name: "Present my view", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^You are presenting$/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Presentation", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await openPresentation(page);
  await expect(page.getByRole("status").filter({ hasText: /^You are presenting$/ })).toBeVisible();
  await page.getByRole("button", { name: "Stop presenting", exact: true }).click();
  await expect(page.getByRole("button", { name: "Present my view", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await singleBar(page);
});

test("desktop drawer keeps a new selection visible during normal motion", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await organization(page, testInfo);
  const id = await newTeamCanvas(page);
  await page
    .getByRole("group", { name: "Canvas tools", exact: true })
    .getByRole("button", { name: "Sticky note", exact: true })
    .click();
  await expect(page.getByTestId("canvas-inspector")).toHaveAttribute("data-open", "true");
  await expect.poll(async () => (await snapshot(page, id)).objects.length).toBe(1);
  const object = (await snapshot(page, id)).objects[0]!;
  await expect(page.getByTestId(`canvas-object-${object.id}`)).toBeInViewport({ ratio: 1 });
  await singleBar(page);
  const reduced = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  expect(reduced).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("compact-normal-motion.png") });
});

test("@mobile single-bar menus and sliding inspector fit small screens", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await organization(page, testInfo);
  await newTeamCanvas(page);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const mode of ["light", "dark"] as const) {
      await closeInspector(page);
      await singleBar(page);
      await theme(page, mode);
      const insert = page.getByRole("button", { name: "Insert", exact: true });
      await insert.click();
      await expect(
        page.getByRole("group", { name: "Insert", exact: true }).locator("button:enabled").first(),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(insert).toBeFocused();
      const drawer = await openInspector(page, "Objects");
      await expect(drawer.getByRole("tab", { name: "Objects", exact: true })).toBeFocused();
      expect(
        await page
          .getByTestId("canvas-surface")
          .evaluate((element) => Boolean(element.closest("[inert]"))),
      ).toBe(true);
      await expect(page.getByRole("group", { name: "Canvas tools", exact: true })).toHaveCount(0);
      const box = (await drawer.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await theme(page, mode);
      await page.screenshot({ path: testInfo.outputPath(`compact-mobile-${width}-${mode}.png`) });
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "More board actions", exact: true }),
      ).toBeFocused();
      await openInsert(page, "Link");
      const dialog = page.getByRole("dialog", { name: "Add link", exact: true });
      await expect(dialog.getByRole("textbox", { name: "Link URL", exact: true })).toBeFocused();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await (await canvasAction(page, "Board details")).click();
      // This inspector is nonmodal: keep a visible opener focused and allow
      // native keyboard navigation into the panel without asynchronous focus jumps.
      await expect(
        page.getByRole("button", { name: "More board actions", exact: true }),
      ).toBeFocused();
      const boardTab = page.getByRole("tab", { name: "Board", exact: true });
      // Follow the native tab order through optional header controls without
      // entering the covered canvas.
      for (let step = 0; step < 4; step++) {
        await page.keyboard.press("Tab");
        expect(
          await page.evaluate(() =>
            Boolean(document.activeElement?.closest("[inert],[hidden],[aria-hidden=true]")),
          ),
        ).toBe(false);
        if (await boardTab.evaluate((element) => element === document.activeElement)) break;
      }
      try {
        await expect(page.getByRole("tab", { name: "Board", exact: true })).toBeFocused();
      } catch (error) {
        const focus = await page.evaluate(() => {
          const active = document.activeElement;
          const drawer = document.querySelector('[data-testid="canvas-inspector"]')!;
          const target = drawer.querySelector('[role="tab"][aria-selected="true"]')!;
          return {
            active: {
              tag: active?.tagName,
              name: active?.getAttribute("aria-label"),
              id: active?.id,
              rects: active?.getClientRects().length,
            },
            drawer: {
              open: drawer.getAttribute("data-open"),
              inert: drawer.hasAttribute("inert"),
              visibility: getComputedStyle(drawer).visibility,
            },
            target: {
              id: target.id,
              rects: target.getClientRects().length,
              visibility: getComputedStyle(target).visibility,
            },
          };
        });
        await testInfo.attach("drawer-focus.json", {
          body: JSON.stringify(focus, null, 2),
          contentType: "application/json",
        });
        throw error;
      }
      await closeInspector(page);
      await singleBar(page);
    }
  }
});
