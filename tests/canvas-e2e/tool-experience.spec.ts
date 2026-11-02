import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  CANVAS_SCHEMA_VERSION,
  CanvasColorSchema,
  CanvasShapeVariantSchema,
} from "../../packages/contracts/src/canvas-boards";
import { api, fits, newTeamCanvas, organization, snapshot } from "./support";

const palette = (page: Page) => page.getByRole("group", { name: "Canvas tools", exact: true });
const formatting = (page: Page) =>
  page.getByRole("toolbar", { name: "Selection formatting", exact: true });

async function paletteButton(page: Page, name: string) {
  const button = palette(page).getByRole("button", { name, exact: true });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeEnabled();
  return button;
}
async function hideOutline(page: Page) {
  const button = page.getByRole("button", { name: "Object outline", exact: true });
  if ((await button.getAttribute("aria-expanded")) === "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "false");
}
async function objectSnapshot(page: Page, boardId: string, objectId: string) {
  return (await snapshot(page, boardId)).objects.find((object) => object.id === objectId);
}
async function selectObject(page: Page, objectId: string) {
  await (await paletteButton(page, "Select")).click();
  await page.getByTestId(`canvas-object-${objectId}`).click();
  await hideOutline(page);
  await expect(formatting(page)).toBeVisible();
}
async function chooseShape(page: Page, label: string) {
  await (await paletteButton(page, "Shapes and connectors")).click();
  const dialog = page.getByRole("dialog", { name: "Shapes and connectors", exact: true });
  const search = dialog.getByRole("searchbox", { name: "Search shapes", exact: true });
  await expect(search).toBeFocused();
  await search.fill(label);
  return dialog;
}
async function dragPort(
  page: Page,
  sourceId: string,
  anchor: "right" | "bottom",
  targetId: string,
) {
  const port = page.locator(`[data-canvas-object="${sourceId}"][data-canvas-port="${anchor}"]`);
  await expect(port).toBeVisible();
  await expect(port).toBeInViewport({ ratio: 1 });
  const source = await port.boundingBox();
  const target = await page.getByTestId(`canvas-object-${targetId}`).boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
}
async function fullyFits(page: Page, container: Locator) {
  await fits(page);
  await expect(container).toBeVisible();
  await expect
    .poll(() =>
      container.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left >= -1 &&
          bounds.right <= innerWidth + 1 &&
          bounds.top >= -1 &&
          bounds.bottom <= innerHeight + 1 &&
          element.scrollWidth <= element.clientWidth + 1
        );
      }),
    )
    .toBe(true);
}
async function fullAxe(page: Page) {
  // In WebKit a theme attribute can precede the final paint. Persistent violations still fail.
  await expect.poll(async () => (await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}
async function settleTheme(page: Page, colorScheme: "light" | "dark") {
  await page.emulateMedia({ colorScheme });
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
  const expected = await palette(page).evaluate((element) => {
    const probe = document.createElement("span");
    probe.hidden = true;
    probe.style.backgroundColor = "var(--ui-surface)";
    element.append(probe);
    try {
      return getComputedStyle(probe).backgroundColor;
    } finally {
      probe.remove();
    }
  });
  await expect(palette(page)).toHaveCSS("background-color", expected);
}
async function nativeControlsAreReadable(container: Locator) {
  for (const control of await container
    .locator('input:not([type="range"]),select,textarea')
    .all()) {
    await expect(control).toBeVisible();
    expect(
      await control.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
  }
}

for (const mobile of [false, true]) {
  test(`${mobile ? "@mobile " : ""}canvas text contrast and frame labels remain readable in both themes`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await organization(page, testInfo);
    const boardId = await newTeamCanvas(page);
    const texts = CanvasColorSchema.options.map((color, index) => ({
      id: randomUUID(),
      type: "text",
      color,
      text: `${color} text`,
      x: 40 + (index % 4) * 250,
      y: 40 + Math.floor(index / 4) * 100,
      width: 230,
      height: 80,
    }));
    const frameId = randomUUID();
    const seeded = await page.request.post(`${api}/v1/canvas-boards/${boardId}/commands`, {
      data: {
        schemaVersion: CANVAS_SCHEMA_VERSION,
        operationId: randomUUID(),
        command: {
          type: "batch",
          operations: [
            ...texts,
            {
              id: frameId,
              type: "frame",
              text: "Frame",
              x: 40,
              y: 480,
              width: 900,
              height: 260,
            },
          ].map((object) => ({ type: "create", object })),
        },
      },
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    await page.reload();
    const outline = page.getByRole("button", { name: "Object outline", exact: true });
    if ((await outline.getAttribute("aria-expanded")) === "false") await outline.click();
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "Frame", exact: true })
      .click();
    await hideOutline(page);
    await formatting(page)
      .getByRole("combobox", { name: "Font size", exact: true })
      .selectOption("96");
    await expect.poll(() => objectSnapshot(page, boardId, frameId)).toMatchObject({ fontSize: 96 });
    await page.getByRole("button", { name: "Fit board", exact: true }).click();

    for (const mode of ["light", "dark"] as const) {
      await settleTheme(page, mode);
      await expect
        .poll(async () => {
          return page.evaluate((items) => {
            const luminance = (css: string) => {
              const rgb = css
                .match(/[\d.]+/g)
                ?.slice(0, 3)
                .map(Number);
              if (!rgb || rgb.length !== 3) throw new Error(`Unsupported computed color: ${css}`);
              const linear = rgb.map((value) => {
                const channel = value / 255;
                return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
              });
              return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
            };
            return items.map(({ id, color }) => {
              const object = document.querySelector(`[data-testid="canvas-object-${id}"]`)!;
              const content = object.querySelector('[data-type="text"]')!;
              const background = object.querySelector("rect")!;
              const ink = luminance(getComputedStyle(content).color);
              const fill = luminance(getComputedStyle(background).fill);
              return {
                color,
                readable: (Math.max(ink, fill) + 0.05) / (Math.min(ink, fill) + 0.05) >= 4.5,
              };
            });
          }, texts);
        })
        .toEqual(texts.map(({ color }) => ({ color, readable: true })));
      const frame = page.getByTestId(`canvas-object-${frameId}`);
      const title = frame.locator('[data-type="frame"]');
      await expect(title).toHaveCSS("font-size", "96px");
      const titleBounds = await title.evaluate((element) => ({
        clipped: element.scrollHeight > element.clientHeight + 1,
        height: element.clientHeight,
        lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      }));
      expect(titleBounds.clipped).toBe(false);
      expect(titleBounds.height).toBeGreaterThanOrEqual(titleBounds.lineHeight);
      expect(titleBounds.height).toBeLessThanOrEqual(240);
      await fits(page);
      await page.screenshot({ path: testInfo.outputPath(`canvas-text-and-frame-${mode}.png`) });
    }
    await page.reload();
    await expect(
      page.getByTestId(`canvas-object-${frameId}`).locator('[data-type="frame"]'),
    ).toHaveCSS("font-size", "96px");
  });
}

test("canvas tools persist selection formatting, shape presets, port drags and whole-stroke erasing", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await organization(page, testInfo);
  const id = await newTeamCanvas(page);
  expect((await snapshot(page, id)).objects).toEqual([]);
  await (await paletteButton(page, "Sticky note")).click();
  await expect.poll(async () => (await snapshot(page, id)).objects.length).toBe(1);
  const note = (await snapshot(page, id)).objects[0]!;
  expect(note).toMatchObject({ type: "sticky", color: "yellow" });
  const outlineToggle = page.getByRole("button", { name: "Object outline", exact: true });
  if ((await outlineToggle.getAttribute("aria-expanded")) === "false") await outlineToggle.click();
  await expect(outlineToggle).toHaveAttribute("aria-expanded", "true");
  const outline = page.getByRole("complementary");
  const outlineCheckbox = outline.getByRole("checkbox", {
    name: "Select Sticky note 1",
    exact: true,
  });
  const outlineNote = outline.getByRole("button", { name: "Sticky note 1", exact: true });
  await expect(outlineCheckbox).toBeEnabled();
  await expect(outlineNote).toBeEnabled();
  const toolbar = formatting(page);
  const beforeInlineEditing = await snapshot(page, id);
  await toolbar.getByRole("button", { name: "Edit text", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Edit text", exact: true });
  await expect(editor).toBeFocused();
  await expect(outlineCheckbox).toBeDisabled();
  await expect(outlineNote).toBeDisabled();
  await editor.fill("Tool planning note");
  const save = page.getByRole("button", { name: "Save text", exact: true });
  await save.focus();
  await page.keyboard.press("Delete");
  await expect(editor).toHaveValue("Tool planning note");
  const afterDelete = await snapshot(page, id);
  expect(afterDelete.canvasSeq).toBe(beforeInlineEditing.canvasSeq);
  expect(afterDelete.objects).toEqual(beforeInlineEditing.objects);
  await page.keyboard.press("Control+z");
  const afterNativeUndo = await snapshot(page, id);
  expect(afterNativeUndo.canvasSeq).toBe(beforeInlineEditing.canvasSeq);
  expect(afterNativeUndo.objects).toEqual(beforeInlineEditing.objects);
  // The browser may undo its textarea edit while the board undo command stays blocked.
  await editor.fill("Tool planning note");
  await expect(editor).toHaveValue("Tool planning note");
  await save.click();
  await expect(editor).toHaveCount(0);
  await expect
    .poll(() => objectSnapshot(page, id, note.id))
    .toMatchObject({ text: "Tool planning note" });
  await hideOutline(page);
  await toolbar.getByRole("combobox", { name: "Font family", exact: true }).selectOption("serif");
  await expect.poll(() => objectSnapshot(page, id, note.id)).toMatchObject({ fontFamily: "serif" });
  await toolbar.getByRole("combobox", { name: "Font size", exact: true }).selectOption("28");
  await expect.poll(() => objectSnapshot(page, id, note.id)).toMatchObject({ fontSize: 28 });
  await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
  await expect.poll(() => objectSnapshot(page, id, note.id)).toMatchObject({ fontWeight: "bold" });
  await toolbar.getByRole("button", { name: "Align center", exact: true }).click();
  await expect.poll(() => objectSnapshot(page, id, note.id)).toMatchObject({ textAlign: "center" });
  await toolbar.locator('summary[aria-label="Fill color"]').click();
  const colors = toolbar.getByRole("group", { name: "Fill color", exact: true });
  await expect(colors.getByRole("button")).toHaveCount(16);
  await colors.getByRole("button", { name: "Teal", exact: true }).click();
  await expect.poll(() => objectSnapshot(page, id, note.id)).toMatchObject({ color: "teal" });
  await toolbar.getByRole("combobox", { name: "Convert to", exact: true }).selectOption("ellipse");
  const persistedStyle = {
    type: "ellipse",
    color: "teal",
    text: "Tool planning note",
    fontFamily: "serif",
    fontSize: 28,
    fontWeight: "bold",
    textAlign: "center",
  };
  await expect.poll(() => objectSnapshot(page, id, note.id)).toMatchObject(persistedStyle);
  await toolbar.getByRole("button", { name: "Lock", exact: true }).click();
  await expect
    .poll(() => objectSnapshot(page, id, note.id))
    .toMatchObject({ ...persistedStyle, locked: true });
  await expect(toolbar.getByRole("combobox", { name: "Font size", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("canvas-tools-desktop-formatting.png") });
  await page.reload();
  await expect(page.getByTestId(`canvas-object-${note.id}`)).toContainText("Tool planning note");
  await selectObject(page, note.id);
  await expect(toolbar.getByRole("combobox", { name: "Font family", exact: true })).toHaveValue(
    "serif",
  );
  await expect(toolbar.getByRole("combobox", { name: "Font size", exact: true })).toHaveValue("28");
  await expect(toolbar.getByRole("button", { name: "Bold", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await toolbar.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect
    .poll(() => objectSnapshot(page, id, note.id))
    .toMatchObject({ ...persistedStyle, locked: false });

  const shapeDialog = await chooseShape(page, "Triangle");
  await expect(shapeDialog.getByRole("button", { name: "Triangle", exact: true })).toBeVisible();
  await expect(shapeDialog.getByRole("button", { name: "Star", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("canvas-tools-desktop-shapes.png") });
  await shapeDialog.getByRole("button", { name: "Triangle", exact: true }).click();
  await expect
    .poll(async () =>
      (await snapshot(page, id)).objects.some(
        (object) => object.type === "rect" && object.shapeVariant === "triangle",
      ),
    )
    .toBe(true);
  const triangle = (await snapshot(page, id)).objects.find(
    (object) => object.type === "rect" && object.shapeVariant === "triangle",
  )!;
  await hideOutline(page);
  await page.getByRole("button", { name: "Fit board", exact: true }).click();
  const lineDialog = await chooseShape(page, "Line");
  await lineDialog.getByRole("button", { name: "Line", exact: true }).click();
  await dragPort(page, triangle.id, "right", note.id);
  await expect
    .poll(
      async () =>
        (await snapshot(page, id)).objects.filter((object) => object.type === "connector").length,
    )
    .toBe(1);
  const line = (await snapshot(page, id)).objects.find((object) => object.type === "connector")!;
  expect(line).toMatchObject({
    routing: "straight",
    startMarker: "none",
    endMarker: "none",
    from: { objectId: triangle.id, anchor: "right" },
    to: { objectId: note.id },
  });
  await selectObject(page, triangle.id);
  const elbowDialog = await chooseShape(page, "Elbow connector");
  await elbowDialog.getByRole("button", { name: "Elbow connector", exact: true }).click();
  await dragPort(page, triangle.id, "bottom", note.id);
  await expect
    .poll(
      async () =>
        (await snapshot(page, id)).objects.filter((object) => object.type === "connector").length,
    )
    .toBe(2);
  const elbow = (await snapshot(page, id)).objects.find(
    (object) => object.type === "connector" && object.id !== line.id,
  )!;
  expect(elbow).toMatchObject({
    routing: "elbow",
    endMarker: "arrow",
    from: { objectId: triangle.id, anchor: "bottom" },
    to: { objectId: note.id },
  });

  await (await paletteButton(page, "Drawing settings")).click();
  const drawing = page.getByRole("dialog", { name: "Drawing settings", exact: true });
  await drawing.getByRole("button", { name: "Highlighter", exact: true }).click();
  await drawing.getByRole("button", { name: "Blue", exact: true }).click();
  await expect(drawing.getByRole("slider", { name: /^Stroke width(?:\s*\d+)?$/ })).toHaveValue(
    "12",
  );
  await drawing.getByRole("button", { name: "Close", exact: true }).click();
  const surface = await page.getByTestId("canvas-surface").boundingBox();
  expect(surface).not.toBeNull();
  const start = { x: surface!.x + surface!.width * 0.3, y: surface!.y + surface!.height * 0.75 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y - 25, { steps: 6 });
  await page.mouse.move(start.x + 170, start.y, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await snapshot(page, id)).objects.filter((object) => object.type === "pen").length,
    )
    .toBe(1);
  const stroke = (await snapshot(page, id)).objects.find((object) => object.type === "pen")!;
  expect(stroke).toMatchObject({ color: "blue", strokeWidth: 12, opacity: 0.35 });
  await page.screenshot({ path: testInfo.outputPath("canvas-tools-desktop-highlighter.png") });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export board", exact: true });
  await exportDialog.getByRole("combobox", { name: "Area", exact: true }).selectOption("whole");
  await exportDialog
    .getByRole("combobox", { name: "File format", exact: true })
    .selectOption("svg");
  const svgDownloadPromise = page.waitForEvent("download");
  await exportDialog.getByRole("button", { name: "Download", exact: true }).click();
  const svgDownload = await svgDownloadPromise;
  expect(svgDownload.suggestedFilename()).toBe("idea-board.svg");
  const svgPath = testInfo.outputPath("canvas-tools-styled.svg");
  await svgDownload.saveAs(svgPath);
  const svg = await readFile(svgPath, "utf8");
  expect(svg.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain("Tool planning note");
  for (const attribute of [
    'font-family="Georgia, serif"',
    'font-size="28"',
    'font-weight="bold"',
    'text-anchor="middle"',
    'fill="#bce9e4"',
    'd="M110 0 L220 160 L0 160 Z"',
    'stroke="#175ca5"',
    'stroke-width="12"',
    'opacity="0.35"',
  ])
    expect(svg).toContain(attribute);
  expect(svg).not.toMatch(/<foreignObject|<script|<style|href="https?:/);
  const svgWidth = Number(/<svg\b[^>]*\bwidth="(\d+)"/.exec(svg)?.[1]);
  const svgHeight = Number(/<svg\b[^>]*\bheight="(\d+)"/.exec(svg)?.[1]);
  expect(svgWidth).toBeGreaterThan(0);
  expect(svgHeight).toBeGreaterThan(0);
  await exportDialog
    .getByRole("combobox", { name: "File format", exact: true })
    .selectOption("png");
  const rasterSourcePromise = page.waitForResponse(
    (response) =>
      response.url() === `${api}/v1/canvas-boards/${id}/export` &&
      response.request().method() === "POST" &&
      response.ok(),
  );
  const pngDownloadPromise = page.waitForEvent("download");
  await exportDialog.getByRole("button", { name: "Download", exact: true }).click();
  const [pngDownload, rasterSource] = await Promise.all([pngDownloadPromise, rasterSourcePromise]);
  expect(await rasterSource.text()).toBe(svg);
  expect(pngDownload.suggestedFilename()).toBe("idea-board.png");
  const pngPath = testInfo.outputPath("canvas-tools-styled.png");
  await pngDownload.saveAs(pngPath);
  const png = await readFile(pngPath);
  expect(png.length).toBeGreaterThan(24);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBe(svgWidth);
  expect(png.readUInt32BE(20)).toBe(svgHeight);
  expect(svgWidth).toBeLessThanOrEqual(4096);
  expect(svgHeight).toBeLessThanOrEqual(4096);
  await exportDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(exportDialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId(`canvas-object-${stroke.id}`)).toBeVisible();
  await hideOutline(page);
  await expect
    .poll(() => objectSnapshot(page, id, triangle.id))
    .toMatchObject({ type: "rect", shapeVariant: "triangle" });
  await expect
    .poll(() => objectSnapshot(page, id, line.id))
    .toMatchObject({ routing: "straight", endMarker: "none", from: { anchor: "right" } });
  await expect
    .poll(() => objectSnapshot(page, id, elbow.id))
    .toMatchObject({ routing: "elbow", endMarker: "arrow", from: { anchor: "bottom" } });
  await expect
    .poll(() => objectSnapshot(page, id, stroke.id))
    .toMatchObject({ color: "blue", strokeWidth: 12, opacity: 0.35 });
  await page.getByRole("button", { name: "Fit board", exact: true }).click();
  const beforeErase = await snapshot(page, id);
  await (await paletteButton(page, "Drawing settings")).click();
  await drawing.getByRole("button", { name: "Eraser", exact: true }).click();
  await expect(drawing).toContainText("Erase an entire unlocked pen or highlighter stroke");
  await drawing.getByRole("button", { name: "Close", exact: true }).click();
  const erasePoint = await page
    .getByTestId(`canvas-object-${stroke.id}`)
    .locator("polyline")
    .evaluate((element) => {
      const line = element as SVGPolylineElement;
      const point = line.points.getItem(Math.floor(line.points.numberOfItems / 2));
      const matrix = line.getScreenCTM();
      if (!matrix) throw new Error("Stroke is not painted");
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    });
  await page.mouse.move(erasePoint.x, erasePoint.y);
  await page.mouse.down();
  await page.mouse.move(erasePoint.x + 2, erasePoint.y + 2);
  await page.mouse.up();
  await expect
    .poll(async () => (await snapshot(page, id)).objects.map((object) => object.id).sort())
    .toEqual(
      beforeErase.objects
        .filter((object) => object.id !== stroke.id)
        .map((object) => object.id)
        .sort(),
    );
  await expect
    .poll(() => objectSnapshot(page, id, note.id))
    .toMatchObject({ ...persistedStyle, locked: false });
  await page.reload();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  expect((await snapshot(page, id)).objects.some((object) => object.type === "pen")).toBe(false);
  await fits(page);
});

test("image mutation handoff leaves exact retry accessible after a lost acknowledgement", async ({
  page,
}, testInfo) => {
  await organization(page, testInfo);
  const id = await newTeamCanvas(page);
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 30;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#147d76";
    context.fillRect(0, 0, 40, 30);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  const writes: string[] = [];
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      new URL(request.url()).pathname.startsWith("/__test/canvas/storage/")
    )
      uploads.push(request.url());
  });
  await page.route(`${api}/v1/canvas-boards/${id}/commands`, async (route) => {
    writes.push(route.request().postData()!);
    const response = await route.fetch();
    expect(response.status(), await response.text()).toBe(200);
    if (writes.length === 1) await route.abort("connectionreset");
    else await route.fulfill({ response });
  });
  const addImage = page.getByRole("button", { name: "Image", exact: true });
  await addImage.click();
  const dialog = page.getByRole("dialog", { name: "Add image", exact: true });
  await dialog.getByLabel("Choose an image", { exact: true }).setInputFiles({
    name: "retry-sketch.png",
    mimeType: "image/png",
    buffer: Buffer.from(imageData, "base64"),
  });
  await dialog
    .getByRole("textbox", { name: "Image description", exact: true })
    .fill("Retry sketch");
  await dialog.getByRole("button", { name: "Upload and add", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeEnabled();
  await expect(addImage).toBeDisabled();
  expect(writes).toHaveLength(1);
  expect(uploads).toHaveLength(1);
  const saved = (await snapshot(page, id)).objects;
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ type: "image", altText: "Retry sketch" });
  await page.screenshot({ path: testInfo.outputPath("image-exact-retry-accessible.png") });
  await retry.click();
  await expect(retry).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toBe(writes[0]);
  expect(uploads).toHaveLength(1);
  expect((await snapshot(page, id)).objects).toEqual(saved);
  await addImage.click();
  await expect(dialog.getByLabel("Choose an image", { exact: true })).toHaveValue("");
  await expect(dialog.getByRole("textbox", { name: "Image description", exact: true })).toHaveValue(
    "",
  );
  await expect(dialog.getByRole("button", { name: "Upload and add", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  expect((await snapshot(page, id)).objects).toEqual(saved);
  expect(uploads).toHaveLength(1);
  expect(writes).toHaveLength(2);
});

test("all shape ports and exported connectors meet their rendered outlines", async ({
  page,
}, testInfo) => {
  await organization(page, testInfo);
  const boardId = await newTeamCanvas(page);
  const shapes = CanvasShapeVariantSchema.options.map((shapeVariant, index) => ({
    id: randomUUID(),
    type: "rect",
    shapeVariant,
    text: shapeVariant,
    x: 100 + (index % 4) * 300,
    y: 100 + Math.floor(index / 4) * 240,
    width: 200,
    height: 160,
    rotation: index % 3 === 0 ? 27 : 0,
    zIndex: index,
  }));
  const connectors = shapes.flatMap((shape, index) =>
    (["top", "right", "bottom", "left"] as const).map((anchor, anchorIndex) => ({
      id: randomUUID(),
      type: "connector",
      text: `Port ${index} ${anchor}`,
      x: shape.x,
      y: shape.y,
      width: 200,
      height: 160,
      zIndex: 100 + index * 4 + anchorIndex,
      from: { objectId: shape.id, anchor, x: 0, y: 0 },
      to: {
        objectId: null,
        x: shape.x + 100 + (anchor === "left" ? -320 : anchor === "right" ? 320 : 0),
        y: shape.y + 80 + (anchor === "top" ? -250 : anchor === "bottom" ? 250 : 0),
      },
      endMarker: "none",
    })),
  );
  const objects = [...shapes, ...connectors];
  for (let offset = 0; offset < objects.length; offset += 40) {
    const seeded = await page.request.post(`${api}/v1/canvas-boards/${boardId}/commands`, {
      data: {
        schemaVersion: CANVAS_SCHEMA_VERSION,
        operationId: randomUUID(),
        command: {
          type: "batch",
          operations: objects
            .slice(offset, offset + 40)
            .map((object) => ({ type: "create", object })),
        },
      },
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
  }
  await page.reload();
  await expect(page.getByTestId(`canvas-object-${connectors.at(-1)!.id}`)).toBeAttached();
  const expected = connectors.map((connector) => ({ label: connector.text, attached: true }));
  const live = await page.evaluate(
    ({ connectors }) => {
      return connectors.map((connector) => {
        const shape = document.querySelector(
          `[data-testid="canvas-object-${connector.from.objectId}"] path, [data-testid="canvas-object-${connector.from.objectId}"] rect`,
        ) as SVGGeometryElement;
        const route = document.querySelector(
          `[data-testid="canvas-object-${connector.id}"] path`,
        ) as SVGGeometryElement;
        const screen = route.getPointAtLength(0).matrixTransform(route.getScreenCTM()!);
        const local = screen.matrixTransform(shape.getScreenCTM()!.inverse());
        return { label: connector.text, attached: shape.isPointInStroke(local) };
      });
    },
    { connectors },
  );
  expect(live).toEqual(expected);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export board", exact: true });
  await dialog.getByRole("combobox", { name: "File format", exact: true }).selectOption("svg");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download", exact: true }).click();
  const file = testInfo.outputPath("outline-aware-ports.svg");
  await (await download).saveAs(file);
  const svg = await readFile(file, "utf8");
  const exported = await page.evaluate(
    ({ svg, shapes, connectors }) => {
      const documentSvg = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
      const imported = document.importNode(documentSvg, true) as unknown as SVGSVGElement;
      // Preserve native geometry scale: subpixel-sized SVGs flatten curves too coarsely
      // for the browser's independent stroke hit-testing oracle.
      imported.style.cssText = "position:fixed;left:-10000px;top:0;opacity:0;pointer-events:none";
      document.body.append(imported);
      try {
        return connectors.map((connector) => {
          const node = shapes.find((shape) => shape.id === connector.from.objectId)!;
          const group = [...imported.querySelectorAll("g")].find(
            (g) =>
              g.getAttribute("transform") ===
              `translate(${node.x} ${node.y}) rotate(${node.rotation} 100 80)`,
          )!;
          const shape = group.querySelector("path") as SVGGeometryElement;
          const connectorGroup = [...imported.querySelectorAll("g")].find(
            (g) => g.querySelector(":scope > title")?.textContent === connector.text,
          )!;
          const route = connectorGroup.querySelector("path") as SVGGeometryElement;
          const screen = route.getPointAtLength(0).matrixTransform(route.getScreenCTM()!);
          const local = screen.matrixTransform(shape.getScreenCTM()!.inverse());
          return { label: connector.text, attached: shape.isPointInStroke(local) };
        });
      } finally {
        imported.remove();
      }
    },
    { svg, shapes, connectors },
  );
  expect(exported).toEqual(expected);
});

test("SVG palette imports a real image and rejects external references without changing the board", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await organization(page, testInfo);
  const id = await newTeamCanvas(page);
  const externalRequests: string[] = [];
  const imageUploads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname === "unsafe-svg.example.test") externalRequests.push(request.url());
    if (request.method() === "PUT" && url.pathname.startsWith("/__test/canvas/storage/"))
      imageUploads.push(request.url());
  });
  await (await paletteButton(page, "Add SVG image")).click();
  const dialog = page.getByRole("dialog", { name: "Add SVG image", exact: true });
  await expect(dialog).toContainText("SVG is imported as an image");
  await dialog.getByLabel("Choose an image", { exact: true }).setInputFiles({
    name: "original-tool-symbol.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect x="6" y="6" width="108" height="68" rx="12" fill="#bce9e4"/><path d="M30 42 L49 60 L90 23" fill="none" stroke="#147d76" stroke-width="7"/><text x="10" y="18" font-size="10" fill="#202938">Planning</text></svg>',
    ),
  });
  await dialog
    .getByRole("textbox", { name: "Image description", exact: true })
    .fill("Original planning checkmark drawing");
  const uploadRequest = page.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      new URL(request.url()).pathname.startsWith("/__test/canvas/storage/"),
  );
  await dialog.getByRole("button", { name: "Upload and add", exact: true }).click();
  const uploaded = await uploadRequest;
  expect(uploaded.headers()["content-type"]).toBe("image/png");
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page, id)).objects.length).toBe(1);
  const image = (await snapshot(page, id)).objects[0]!;
  expect(image).toMatchObject({ type: "image", altText: "Original planning checkmark drawing" });
  const renderedImage = page
    .getByRole("img", { name: "Original planning checkmark drawing", exact: true })
    .locator("image");
  await expect(renderedImage).toHaveAttribute("href", /^blob:/);
  // Verify finalized bytes through the same authorized media proxy used by the surface.
  // Browser CSP intentionally excludes fetching blob: URLs as network requests.
  if (image.type !== "image") throw new Error("Expected an uploaded image object");
  const servedImage = await page.request.get(
    `${api}/v1/canvas-boards/${id}/media/${image.mediaId}`,
  );
  expect(servedImage.status()).toBe(200);
  expect(servedImage.headers()["content-type"]?.split(";")[0]?.trim()).toBe("image/png");
  const raster = await servedImage.body();
  expect(raster.length).toBeGreaterThan(8);
  expect(raster.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(imageUploads).toHaveLength(1);
  await hideOutline(page);
  await page.screenshot({ path: testInfo.outputPath("canvas-tools-svg-import.png") });
  await page.reload();
  await expect(page.getByTestId(`canvas-object-${image.id}`)).toBeVisible();
  await expect
    .poll(() => objectSnapshot(page, id, image.id))
    .toMatchObject({ type: "image", altText: "Original planning checkmark drawing" });
  const beforeRejection = await snapshot(page, id);
  await (await paletteButton(page, "Add SVG image")).click();
  await dialog.getByLabel("Choose an image", { exact: true }).setInputFiles({
    name: "external-reference.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="48"><image href="https://unsafe-svg.example.test/remote.png" width="80" height="48"/></svg>',
    ),
  });
  await dialog
    .getByRole("textbox", { name: "Image description", exact: true })
    .fill("Unsupported external reference");
  await dialog.getByRole("button", { name: "Upload and add", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "This item could not be added. Check the details and try again.",
  );
  await expect(dialog.getByRole("button", { name: "Upload and add", exact: true })).toBeEnabled();
  const afterRejection = await snapshot(page, id);
  expect(afterRejection.canvasSeq).toBe(beforeRejection.canvasSeq);
  expect(afterRejection.objects).toEqual(beforeRejection.objects);
  expect(imageUploads).toHaveLength(1);
  expect(externalRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("canvas-tools-svg-rejected.png") });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await expect(page.getByTestId(`canvas-object-${image.id}`)).toBeVisible();
  expect((await snapshot(page, id)).objects).toEqual(beforeRejection.objects);
});

test("@mobile canvas flyouts and selection formatting fit 320 and 390 screens in light and dark themes", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 844 });
  await organization(page, testInfo);
  const id = await newTeamCanvas(page);
  await (await paletteButton(page, "Sticky note")).tap();
  await expect.poll(async () => (await snapshot(page, id)).objects.length).toBe(1);
  const note = (await snapshot(page, id)).objects[0]!;
  await hideOutline(page);
  await formatting(page)
    .getByRole("combobox", { name: "Font size", exact: true })
    .selectOption("24");
  await expect.poll(() => objectSnapshot(page, id, note.id)).toMatchObject({ fontSize: 24 });
  await page.getByRole("button", { name: "Fit board", exact: true }).tap();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const mode of ["light", "dark"] as const) {
      await settleTheme(page, mode);
      for (const [name, screenshot] of [
        ["Sticky note colors", "sticky"],
        ["Shapes and connectors", "shapes"],
        ["Drawing settings", "drawing"],
      ] as const) {
        const trigger = await paletteButton(page, name);
        await trigger.tap();
        const dialog = page.getByRole("dialog", { name, exact: true });
        await fullyFits(page, dialog);
        await expect
          .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
          .toBe(true);
        if (name === "Sticky note colors")
          await expect(
            dialog
              .getByRole("group", { name: "Sticky note color", exact: true })
              .getByRole("button"),
          ).toHaveCount(16);
        if (name === "Shapes and connectors") {
          const search = dialog.getByRole("searchbox", { name: "Search shapes", exact: true });
          await expect(search).toBeFocused();
          await search.fill("Triangle");
          await expect(dialog.getByRole("button", { name: "Triangle", exact: true })).toBeVisible();
        }
        if (name === "Drawing settings") {
          await expect(
            dialog.getByRole("button", { name: "Highlighter", exact: true }),
          ).toBeVisible();
          await expect(dialog.getByRole("button", { name: "Eraser", exact: true })).toBeVisible();
          await expect(
            dialog.getByRole("slider", { name: /^Stroke width(?:\s*\d+)?$/ }),
          ).toBeVisible();
        }
        await nativeControlsAreReadable(dialog);
        await fullAxe(page);
        await page.screenshot({
          path: testInfo.outputPath(`canvas-tools-mobile-${width}-${mode}-${screenshot}.png`),
        });
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }
      const outsideTrigger = await paletteButton(page, "Sticky note colors");
      await outsideTrigger.tap();
      await page.getByRole("heading", { name: "Shared planning canvas", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "Sticky note colors", exact: true }),
      ).toHaveCount(0);
      const toolbar = formatting(page);
      await fullyFits(page, toolbar);
      await nativeControlsAreReadable(toolbar);
      await expect(toolbar.getByRole("combobox", { name: "Font size", exact: true })).toHaveValue(
        "24",
      );
      const bold = toolbar.getByRole("button", { name: "Bold", exact: true });
      await bold.focus();
      await page.keyboard.press("ArrowRight");
      await expect(toolbar.getByRole("button", { name: "Italic", exact: true })).toBeFocused();
      const fill = toolbar.locator('summary[aria-label="Fill color"]');
      await fill.click();
      const colors = toolbar.getByRole("group", { name: "Fill color", exact: true });
      await expect(colors.getByRole("button")).toHaveCount(16);
      await fullyFits(page, colors);
      await fullAxe(page);
      await page.screenshot({
        path: testInfo.outputPath(`canvas-tools-mobile-${width}-${mode}-formatting.png`),
      });
      await page.keyboard.press("Escape");
      await expect(colors).toBeHidden();
      await expect(fill).toBeFocused();
      await page.getByRole("button", { name: "Fit board", exact: true }).tap();
      await fits(page);
    }
  }
  expect((await snapshot(page, id)).objects).toHaveLength(1);
  await page.reload();
  await expect(page.getByTestId(`canvas-object-${note.id}`)).toBeVisible();
  expect(await objectSnapshot(page, id, note.id)).toMatchObject({
    type: "sticky",
    color: "yellow",
    fontSize: 24,
  });
});
