import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const storageKey = "pollingpops:scene-lab:workspace:v1";

test("edits, keyboard movement and all task decks survive save/reload without production writes", async ({
  page,
}) => {
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (/\/v1\//.test(request.url()) && !["GET", "HEAD", "OPTIONS"].includes(request.method()))
      mutations.push(request.url());
  });
  await page.goto("/dev/presentation-scene");
  await expect(page.getByRole("status")).toContainText("Fixture ready");
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("A pitch worth sharing");
  await page.getByRole("textbox", { name: "Speaker notes" }).fill("Notes restored with the deck.");
  const imageHandle = page.getByRole("button", { name: /^Select and move Image\./ });
  await imageHandle.focus();
  await imageHandle.press("ArrowRight");
  await expect(page.getByRole("spinbutton", { name: "Left", exact: true })).toHaveValue("64");
  await page.getByRole("textbox", { name: "Image description" }).fill("A clear handoff workflow.");
  await page.getByRole("button", { name: "rounded rectangle shape", exact: true }).click();
  await page.getByRole("combobox", { name: "Shape", exact: true }).selectOption("diamond");
  await page.getByRole("combobox", { name: "Color", exact: true }).selectOption("blue");
  await page.getByRole("button", { name: "Read later", exact: true }).click();
  await page.getByRole("combobox", { name: "Task deck" }).selectOption("product-demo");
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("A useful product tour");
  await page.getByRole("button", { name: "Save locally", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved on this browser");
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Restored local work");
  await expect(page.getByRole("combobox", { name: "Task deck" })).toHaveValue("product-demo");
  await expect(page.getByRole("textbox", { name: "Text", exact: true })).toHaveValue(
    "A useful product tour",
  );
  await page.getByRole("combobox", { name: "Task deck" }).selectOption("business-pitch");
  await expect(page.getByRole("textbox", { name: "Text", exact: true })).toHaveValue(
    "A pitch worth sharing",
  );
  await expect(page.getByRole("textbox", { name: "Speaker notes" })).toHaveValue(
    "Notes restored with the deck.",
  );
  await page.getByRole("button", { name: "Image", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Left", exact: true })).toHaveValue("64");
  await expect(page.getByRole("textbox", { name: "Image description" })).toHaveValue(
    "A clear handoff workflow.",
  );
  await page.getByRole("button", { name: "diamond shape", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Color", exact: true })).toHaveValue("blue");
  const readingIds = await page
    .locator("article[data-scene-id] > [data-node-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-node-id")));
  expect(readingIds.at(-1)).toContain("shape");
  expect(mutations).toEqual([]);
});

test("the semantic reading view is accessible and stays readable on a narrow screen", async ({
  page,
}) => {
  await page.goto("/dev/presentation-scene");
  await expect(page.getByRole("status")).toContainText("Fixture ready");
  await page.getByRole("button", { name: "Reading view", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reading view", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "A calmer project handoff", exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await page.locator("article[data-scene-id]").evaluate((article) => {
    const bounds = article.getBoundingClientRect();
    const nodes = [...article.querySelectorAll("[data-node-id]")].map((node) => {
      const frame = node.getBoundingClientRect();
      const text = node.querySelector("h2, p") ?? node;
      return {
        y: frame.y,
        bottom: frame.bottom,
        within: frame.x >= bounds.x && frame.right <= bounds.right + 1,
        fontSize: parseFloat(getComputedStyle(text).fontSize),
      };
    });
    return { nodes, fits: document.documentElement.scrollWidth <= window.innerWidth + 1 };
  });
  expect(geometry.fits).toBe(true);
  for (const [index, node] of geometry.nodes.entries()) {
    expect(node.within).toBe(true);
    expect(node.fontSize).toBeGreaterThanOrEqual(14);
    if (index) expect(node.y).toBeGreaterThanOrEqual(geometry.nodes[index - 1]!.bottom);
  }
});

test("malformed saved data stays intact until an explicit successful save", async ({ page }) => {
  await page.goto("/dev/presentation-scene");
  await page.evaluate((key) => localStorage.setItem(key, "{corrupt"), storageKey);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Stored data was left unchanged");
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe("{corrupt");
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Recovered working title");
  await page.getByRole("button", { name: "Reload saved", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Text", exact: true })).toHaveValue(
    "Recovered working title",
  );
  await page.getByRole("button", { name: "Save locally", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved on this browser");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Text", exact: true })).toHaveValue(
    "Recovered working title",
  );
});

test("blocked browser storage leaves editing available and reports save failure", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage disabled", "SecurityError");
      },
    });
  });
  await page.goto("/dev/presentation-scene");
  await expect(page.getByRole("status")).toContainText("could not be restored");
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Still editable");
  await page.getByRole("button", { name: "Save locally", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Could not save locally");
  await expect(page.getByRole("textbox", { name: "Text", exact: true })).toHaveValue(
    "Still editable",
  );
});

test("edge controls remain usable and reading order never changes visual stacking", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dev/presentation-scene");
  await expect(page.getByRole("status")).toContainText("Fixture ready");
  await page.getByRole("spinbutton", { name: "Top", exact: true }).fill("0");
  await page.getByRole("spinbutton", { name: "Left", exact: true }).fill("0");
  await page.getByRole("spinbutton", { name: "Width", exact: true }).fill("100");
  const titleHandle = page.getByRole("button", { name: /^Select and move Title\./ });
  await titleHandle.focus();
  // Inspector focus can leave document smooth scrolling in progress.
  await titleHandle.hover();
  const stage = (await page.locator("article[data-scene-id]").boundingBox())!;
  const handle = (await titleHandle.boundingBox())!;
  expect(handle.x).toBeGreaterThanOrEqual(stage.x);
  expect(handle.y).toBeGreaterThanOrEqual(stage.y);
  expect(handle.x + handle.width).toBeLessThanOrEqual(stage.x + stage.width);
  expect(handle.y + handle.height).toBeLessThanOrEqual(stage.y + stage.height);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 24, {
    steps: 3,
  });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(await page.getByRole("spinbutton", { name: "Top", exact: true }).inputValue()),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "rounded rectangle shape", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Left", exact: true }).fill("63");
  await page.getByRole("spinbutton", { name: "Top", exact: true }).fill("30");
  await page.getByRole("spinbutton", { name: "Width", exact: true }).fill("30");
  await page.getByRole("spinbutton", { name: "Height", exact: true }).fill("31");
  const shape = page.locator('article [data-node-id$="-shape"]');
  const layer = await shape.evaluate((node) => getComputedStyle(node).zIndex);
  await page.getByRole("button", { name: "Read earlier", exact: true }).click();
  await page.getByRole("button", { name: "Read earlier", exact: true }).click();
  expect(await shape.evaluate((node) => getComputedStyle(node).zIndex)).toBe(layer);
  const coveringNode = await shape.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return document
      .elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      ?.closest("[data-node-id]")
      ?.getAttribute("data-node-id");
  });
  expect(coveringNode).toContain("-shape");
});

test("selected overlapping move handles drag the intended element regardless of reading order", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dev/presentation-scene");
  await expect(page.getByRole("status")).toContainText("Fixture ready");

  const image = page.locator('article [data-node-id$="-image"]');
  const shape = page.locator('article [data-node-id$="-shape"]');
  const imageHandle = page.getByRole("button", { name: /^Select and move Image\./ });
  const shapeHandle = page.getByRole("button", {
    name: /^Select and move rounded rectangle shape\./,
  });
  const left = page.getByRole("spinbutton", { name: "Left", exact: true });
  const top = page.getByRole("spinbutton", { name: "Top", exact: true });

  await page.getByRole("button", { name: "rounded rectangle shape", exact: true }).click();
  await left.fill("63");
  await top.fill("30");
  await page.getByRole("button", { name: "Image", exact: true }).click();
  await imageHandle.scrollIntoViewIfNeeded();
  const imageBounds = (await imageHandle.boundingBox())!;
  const shapeBounds = (await shapeHandle.boundingBox())!;
  expect(imageBounds.x).toBeCloseTo(shapeBounds.x, 1);
  expect(imageBounds.y).toBeCloseTo(shapeBounds.y, 1);

  const originalImageFrame = (await image.getAttribute("data-frame"))!;
  const originalShapeFrame = (await shape.getAttribute("data-frame"))!;
  await page.mouse.move(
    imageBounds.x + imageBounds.width / 2,
    imageBounds.y + imageBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    imageBounds.x + imageBounds.width / 2 + 24,
    imageBounds.y + imageBounds.height / 2 + 12,
    { steps: 3 },
  );
  await page.mouse.up();
  await expect(image).not.toHaveAttribute("data-frame", originalImageFrame);
  await expect(shape).toHaveAttribute("data-frame", originalShapeFrame);
  await expect(imageHandle).toHaveAttribute("aria-pressed", "true");

  await left.fill("63");
  await top.fill("30");
  await page.getByRole("button", { name: "rounded rectangle shape", exact: true }).click();
  await page.getByRole("button", { name: "Read earlier", exact: true }).click();
  const readingIds = await page
    .locator("article[data-scene-id] > [data-node-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-node-id")!));
  expect(readingIds.findIndex((id) => id.endsWith("-shape"))).toBeLessThan(
    readingIds.findIndex((id) => id.endsWith("-image")),
  );
  await expect(image).toHaveAttribute("data-frame", originalImageFrame);
  await shapeHandle.scrollIntoViewIfNeeded();
  const reorderedShapeBounds = (await shapeHandle.boundingBox())!;
  const reorderedImageBounds = (await imageHandle.boundingBox())!;
  expect(reorderedShapeBounds.x).toBeCloseTo(reorderedImageBounds.x, 1);
  expect(reorderedShapeBounds.y).toBeCloseTo(reorderedImageBounds.y, 1);

  await page.mouse.move(
    reorderedShapeBounds.x + reorderedShapeBounds.width / 2,
    reorderedShapeBounds.y + reorderedShapeBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    reorderedShapeBounds.x + reorderedShapeBounds.width / 2 + 24,
    reorderedShapeBounds.y + reorderedShapeBounds.height / 2 + 12,
    { steps: 3 },
  );
  await page.mouse.up();
  await expect(shape).not.toHaveAttribute("data-frame", originalShapeFrame);
  await expect(image).toHaveAttribute("data-frame", originalImageFrame);
  await expect(shapeHandle).toHaveAttribute("aria-pressed", "true");
});
