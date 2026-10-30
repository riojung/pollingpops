import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fits, organization, snapshot } from "./support";

async function fitsHorizontally(page: Page, container: Locator) {
  await fits(page);
  const bounds = await container.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewport: window.innerWidth,
      content: element.scrollWidth,
      available: element.clientWidth,
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1);
  expect(bounds.content).toBeLessThanOrEqual(bounds.available + 1);
}

test("@mobile starters, outline grouping and link controls fit narrow screens", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await organization(page, testInfo);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/boards");
  await page.getByRole("button", { name: "New board", exact: true }).tap();
  const creation = page.getByRole("dialog", { name: "New board", exact: true });
  await creation.getByRole("button", { name: "Team canvas", exact: true }).tap();
  const starter = creation.getByRole("button", { name: /Possibility map/ });
  await starter.tap();
  await expect(starter).toHaveAttribute("aria-pressed", "true");
  const preview = creation.getByRole("region", { name: "Starter preview", exact: true });
  await expect(preview).toBeVisible();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await fitsHorizontally(page, creation);
    await fitsHorizontally(page, preview);
    await page.screenshot({
      path: testInfo.outputPath(`mobile-starter-${width}.png`),
    });
  }
  await creation
    .getByRole("textbox", { name: "Board title", exact: true })
    .fill("Mobile possibility map");
  await creation.getByRole("button", { name: "Create board", exact: true }).tap();
  await expect(page).toHaveURL(/\/canvas\/[0-9a-f-]+$/);
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const original = await snapshot(page, id);
  const firstFrame = original.objects.find((object) => object.type === "frame")!;
  const notes = original.objects
    .filter((object) => object.type === "sticky" && object.parentId === firstFrame.id)
    .slice(0, 2);
  expect(notes).toHaveLength(2);

  await page.setViewportSize({ width: 320, height: 844 });
  const outline = page.getByRole("button", { name: "Object outline", exact: true });
  await expect(outline).toHaveAttribute("aria-expanded", "false");
  await outline.tap();
  for (const note of notes) {
    const checkbox = page.getByRole("checkbox", {
      name: `Select ${note.text.trim().slice(0, 80)}`,
      exact: true,
    });
    await checkbox.tap();
    await expect(checkbox).toBeChecked();
  }
  const selection = page.getByRole("region", { name: "2 selected", exact: true });
  await expect(selection).toBeVisible();
  await fitsHorizontally(page, selection);
  await selection.getByRole("button", { name: "Group selection", exact: true }).tap();
  await expect
    .poll(async () => {
      const objects = (await snapshot(page, id)).objects.filter((object) =>
        notes.some((note) => note.id === object.id),
      );
      return Boolean(
        objects[0]?.geometricGroupId &&
        objects[0].geometricGroupId === objects[1]?.geometricGroupId,
      );
    })
    .toBe(true);
  for (const [width, colorScheme] of [
    [320, "light"],
    [390, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
    await fitsHorizontally(page, selection);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await selection.getByRole("button", { name: "Frame selection", exact: true }).tap();
  await expect
    .poll(async () => {
      const objects = (await snapshot(page, id)).objects;
      const newFrame = objects.find(
        (object) =>
          object.type === "frame" &&
          !original.objects.some((previous) => previous.id === object.id),
      );
      return Boolean(
        newFrame &&
        objects
          .filter((object) => notes.some((note) => note.id === object.id))
          .every((object) => object.parentId === newFrame.id),
      );
    })
    .toBe(true);

  await page.getByRole("button", { name: "Link", exact: true }).tap();
  const link = page.getByRole("dialog", { name: "Add link", exact: true });
  const url = link.getByRole("textbox", { name: "Link URL", exact: true });
  const label = link.getByRole("textbox", { name: "Link label", exact: true });
  await expect(url).toBeFocused();
  await url.fill("https://docs.example.test/mobile-planning");
  await label.fill("Mobile planning guide");
  await expect(link.getByRole("button", { name: "Add link", exact: true })).toBeEnabled();
  await expect(link.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  for (const [width, colorScheme] of [
    [320, "light"],
    [390, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
    await fitsHorizontally(page, link);
    await expect(url).toBeVisible();
    await expect(label).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`mobile-link-${width}-${colorScheme}.png`),
    });
  }
  await link.getByRole("button", { name: "Add link", exact: true }).tap();
  await expect(link).toHaveCount(0);
  await expect
    .poll(async () =>
      (await snapshot(page, id)).objects.some(
        (object) =>
          object.type === "link" &&
          object.text === "Mobile planning guide" &&
          object.url === "https://docs.example.test/mobile-planning",
      ),
    )
    .toBe(true);
  await fits(page);
});
