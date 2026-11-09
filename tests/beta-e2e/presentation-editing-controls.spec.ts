import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  PresentationScene,
  PresentationSceneFrame,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import {
  closeE01Overlays,
  createE01Deck,
  e01Slide,
  enterE01Editor,
  readE01Record,
} from "./presentation-e01-support";

function fixture() {
  const slide = e01Slide("Controls outside the slide");
  slide.speakerNotes = "PRIVATE editing-control cue";
  slide.scene = {
    schemaVersion: 4,
    aspectRatio: "16:9",
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "Controls outside the slide",
        frame: { x: 0, y: 0, width: 100, height: 14 },
      },
      {
        id: "edge",
        type: "text",
        role: "body",
        text: "Edge evidence",
        frame: { x: 0, y: 36, width: 29, height: 24 },
      },
      {
        id: "rotated",
        type: "shape",
        shape: "rounded_rectangle",
        label: "Rotated decision",
        color: "blue",
        rotation: 15,
        frame: { x: 78, y: 36, width: 20, height: 22 },
      },
      {
        id: "group-body",
        type: "text",
        role: "body",
        text: "Grouped evidence",
        frame: { x: 30, y: 67, width: 20, height: 18 },
      },
      {
        id: "group-shape",
        type: "shape",
        shape: "rounded_rectangle",
        label: "Grouped decision",
        color: "green",
        frame: { x: 55, y: 67, width: 20, height: 18 },
      },
      {
        id: "connector",
        type: "connector",
        label: "Follow the evidence",
        color: "blue",
        from: { nodeId: "edge", anchor: "right" },
        to: { nodeId: "rotated", anchor: "left" },
      },
    ],
    readingOrder: ["title", "edge", "rotated", "group-body", "group-shape", "connector"],
    groups: [{ id: "stored-group", nodeIds: ["group-body", "group-shape"] }],
  };
  return slide;
}
function scene(draft: Awaited<ReturnType<typeof readE01Record>>["draft"]): PresentationScene {
  const block = draft.blocks[0];
  if (block?.kind !== "content" || !block.scene) throw new Error("Expected native scene");
  return block.scene;
}
function frame(value: PresentationScene, id: string): PresentationSceneFrame {
  const node = value.nodes.find((item) => item.id === id);
  if (!node || node.type === "connector") throw new Error("Expected framed object");
  return node.frame;
}
async function outsideStage(controls: Locator, stage: Locator) {
  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  const toolbar = await controls.boundingBox();
  expect(toolbar).not.toBeNull();
  expect(
    toolbar!.y + toolbar!.height,
    "selected controls stay above the authored stage",
  ).toBeLessThanOrEqual(bounds!.y + 1);
  const content = await stage.locator("[data-frame]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
    }),
  );
  for (const control of await controls.locator("select,button").all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    const overlaps = (other: { x: number; y: number; right: number; bottom: number }) =>
      box!.x < other.right - 0.5 &&
      box!.x + box!.width > other.x + 0.5 &&
      box!.y < other.bottom - 0.5 &&
      box!.y + box!.height > other.y + 0.5;
    expect(
      overlaps({
        x: bounds!.x,
        y: bounds!.y,
        right: bounds!.x + bounds!.width,
        bottom: bounds!.y + bounds!.height,
      }),
      "geometry controls must not cover the slide",
    ).toBe(false);
    expect(
      content.some(overlaps),
      "geometry controls must not cover authored or rotated content",
    ).toBe(false);
  }
  await expect(
    stage.locator('button[aria-label^="Move "],button[aria-label^="Resize "]'),
  ).toHaveCount(0);
}
async function startDrag(page: Page, handle: Locator, dx: number, dy = 0) {
  await handle.scrollIntoViewIfNeeded();
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error("Missing geometry control");
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 5 });
}

for (const suffix of ["", " @mobile"]) {
  test(`selected geometry controls leave authored content clear and preserve editing semantics${suffix}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const original = fixture();
    const record = await createE01Deck(page, [original], 8);
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const stage = page.locator('[data-native-scene="true"]');
    const controls = page.getByRole("group", { name: "Selected object controls", exact: true });
    const selection = controls.getByRole("combobox", { name: "Canvas object", exact: true });
    const savedScene = async () => scene((await readE01Record(page, record.id)).draft);
    await expect(selection).toHaveValue("title");
    if (!narrow) {
      await expect(
        page.locator('button[aria-controls="presentation-slide-navigator"]'),
      ).toHaveAttribute("aria-expanded", "true");
      await expect(
        page.locator('button[aria-controls="presentation-object-inspector"]'),
      ).toHaveAttribute("aria-expanded", "true");
      expect((await stage.boundingBox())!.width).toBeLessThan(900);
    }
    await outsideStage(controls, stage);
    const atBoundary = await readE01Record(page, record.id);
    await controls
      .getByRole("button", { name: "Move Slide title. Use arrow keys to nudge.", exact: true })
      .press("ArrowRight");
    await controls
      .getByRole("button", {
        name: "Resize Slide title. Use arrow keys to change size.",
        exact: true,
      })
      .press("ArrowRight");
    expect((await readE01Record(page, record.id)).draftRevision).toBe(atBoundary.draftRevision);
    expect(await savedScene()).toEqual(original.scene);
    await expect(selection).toHaveValue("title");

    // Native typeahead selects the numbered reading-order option across native pickers.
    await selection.focus();
    await selection.press("2");
    await expect(selection).toHaveValue("edge");
    const edgeMove = controls.getByRole("button", {
      name: "Move Edge evidence. Use arrow keys to nudge.",
      exact: true,
    });
    const edgeResize = controls.getByRole("button", {
      name: "Resize Edge evidence. Use arrow keys to change size.",
      exact: true,
    });
    await edgeMove.press("ArrowRight");
    await expect.poll(async () => frame(await savedScene(), "edge").x).toBe(1);
    await expect(edgeMove).toBeFocused();
    await edgeResize.press("Shift+ArrowRight");
    await expect.poll(async () => frame(await savedScene(), "edge").width).toBe(34);
    await expect(edgeResize).toBeFocused();
    await outsideStage(controls, stage);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => frame(await savedScene(), "edge").width).toBe(29);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(savedScene).toEqual(original.scene);

    await selection.selectOption("group-body");
    const groupMove = controls.getByRole("button", {
      name: "Move Grouped evidence. Use arrow keys to nudge.",
      exact: true,
    });
    const groupResize = controls.getByRole("button", {
      name: "Resize group 1. Use arrow keys to change size.",
      exact: true,
    });
    await expect(groupResize).toBeVisible();
    await groupMove.press("Shift+ArrowRight");
    await expect
      .poll(async () => [
        frame(await savedScene(), "group-body").x,
        frame(await savedScene(), "group-shape").x,
      ])
      .toEqual([35, 60]);
    const groupMoved = await savedScene();
    await groupResize.press("ArrowRight");
    await expect
      .poll(async () => frame(await savedScene(), "group-body").width)
      .toBeGreaterThan(20);
    const groupResized = await savedScene();
    expect(frame(groupResized, "group-shape").width).toBeGreaterThan(20);
    expect(groupResized.groups).toEqual(original.scene!.groups);
    expect(groupResized.readingOrder).toEqual(original.scene!.readingOrder);
    expect(groupResized.nodes.map((node) => node.id)).toEqual(
      original.scene!.nodes.map((node) => node.id),
    );
    expect(frame(groupResized, "edge")).toEqual(frame(original.scene!, "edge"));
    await outsideStage(controls, stage);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(savedScene).toEqual(groupMoved);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(savedScene).toEqual(groupResized);

    await selection.selectOption("rotated");
    const rotated = stage.locator('[data-node-id="rotated"]');
    await expect(rotated).toHaveAttribute("data-rotation", "15");
    if (narrow) await expect(rotated).toHaveCSS("transform", "none");
    else await expect(rotated).not.toHaveCSS("transform", "none");
    await outsideStage(controls, stage);
    if (!narrow) {
      const move = controls.getByRole("button", {
        name: "Move Rotated decision. Use arrow keys to nudge.",
        exact: true,
      });
      const before = await readE01Record(page, record.id);
      let writes = 0;
      page.on("request", (request) => {
        if (
          request.method() === "PUT" &&
          new URL(request.url()).pathname === `/v1/presentations/${record.id}/draft`
        )
          writes++;
      });
      const width = (await stage.boundingBox())!.width;
      await page.keyboard.down("Alt");
      await startDrag(page, move, -width * 0.04);
      expect(JSON.parse((await rotated.getAttribute("data-frame"))!).x).toBeLessThan(78);
      expect((await readE01Record(page, record.id)).draft).toEqual(before.draft);
      expect(writes).toBe(0);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await page.keyboard.up("Alt");
      expect((await readE01Record(page, record.id)).draftRevision).toBe(before.draftRevision);
      expect(JSON.parse((await rotated.getAttribute("data-frame"))!)).toEqual(
        frame(scene(before.draft), "rotated"),
      );
      await expect(selection).toHaveValue("rotated");
      await page.keyboard.down("Alt");
      await startDrag(page, move, -width * 0.04);
      expect((await readE01Record(page, record.id)).draft).toEqual(before.draft);
      await page.mouse.up();
      await page.keyboard.up("Alt");
      await expect.poll(async () => frame(await savedScene(), "rotated").x).toBeLessThan(78);
      expect(writes).toBe(1);
      const committed = await savedScene();
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect.poll(savedScene).toEqual(scene(before.draft));
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await expect.poll(savedScene).toEqual(committed);
      await closeE01Overlays(page);
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
      await outsideStage(controls, stage);
      const viewport = await page.evaluate(() => ({
        width: window.innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(viewport.scroll).toBeLessThanOrEqual(viewport.width + 1);
      for (const control of await controls.locator("select,button").all()) {
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      await page.screenshot({
        path: testInfo.outputPath("editing-controls-200-percent.png"),
        fullPage: true,
      });
      await page.evaluate(() => {
        document.documentElement.style.zoom = "";
      });
    }
    await selection.selectOption("connector");
    await expect(controls.getByRole("button")).toHaveCount(0);
    await expect(selection).toHaveValue("connector");
    await expect(controls).toContainText("Connections follow their objects");
    await selection.selectOption("group-body");
    await outsideStage(controls, stage);
    await page.screenshot({
      path: testInfo.outputPath("editing-controls-clear-content.png"),
      fullPage: true,
    });
    const beforeReload = await readE01Record(page, record.id);
    await page.reload();
    if (narrow) await closeE01Overlays(page);
    expect((await readE01Record(page, record.id)).draft).toEqual(beforeReload.draft);
    expect((beforeReload.draft.blocks[0] as typeof original).speakerNotes).toBe(
      "PRIVATE editing-control cue",
    );
  });
}
