import { openE01Inspector, selectE01Object, closeE01Overlays } from "./presentation-e01-support";
import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  PresentationDraft,
  PresentationScene,
  PresentationSceneFrame,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
test.use({ actionTimeout: 30_000 });

async function createDeck(page: Page) {
  await signInBeta(page);
  const scene: PresentationScene = {
    schemaVersion: 1,
    aspectRatio: "16:9",
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "Direct editing",
        frame: { x: 8, y: 5, width: 84, height: 15 },
      },
      {
        id: "body",
        type: "text",
        role: "body",
        text: "Evidence",
        frame: { x: 10, y: 35, width: 25, height: 20 },
      },
      {
        id: "shape",
        type: "shape",
        shape: "rounded_rectangle",
        label: "Decision",
        color: "blue",
        frame: { x: 55, y: 35, width: 25, height: 20 },
      },
      {
        id: "edge",
        type: "connector",
        label: "Next",
        color: "blue",
        from: { nodeId: "body", anchor: "right" },
        to: { nodeId: "shape", anchor: "left" },
      },
    ],
    readingOrder: ["title", "body", "shape", "edge"],
  };
  const created = await page.request.post(`${apiUrl}/v1/presentations`, {
    data: { title: `Direct editing ${randomUUID().slice(0, 8)}` },
  });
  expect(created.status()).toBe(201);
  const record = (await created.json()).presentation;
  const saved = await page.request.put(`${apiUrl}/v1/presentations/${record.id}/draft`, {
    data: {
      draft: {
        ...record.draft,
        schemaVersion: 4,
        blocks: [
          {
            id: randomUUID(),
            kind: "content",
            layout: "title_body",
            textElements: [],
            mediaId: null,
            mediaAlt: null,
            speakerNotes: "Private direct editing cue",
            scene,
          },
        ],
      },
      expectedRevision: record.draftRevision,
      schemaVersion: 2,
      mutationId: randomUUID(),
    },
  });
  expect(saved.status()).toBe(200);
  await page.goto(`/presentation/${record.id}`);
  return { id: record.id as string, scene };
}

async function savedScene(page: Page, id: string) {
  const response = await page.request.get(`${apiUrl}/v1/presentations/${id}`);
  expect(response.status()).toBe(200);
  const draft = (await response.json()).presentation.draft as PresentationDraft;
  const block = draft.blocks[0];
  if (block?.kind !== "content" || !block.scene) throw new Error("Expected native scene");
  return block.scene;
}

function frame(scene: PresentationScene, id: string): PresentationSceneFrame {
  const node = scene.nodes.find((node) => node.id === id);
  if (!node || node.type === "connector") throw new Error("Expected framed node");
  return node.frame;
}

async function renderedFrame(node: Locator): Promise<PresentationSceneFrame> {
  return JSON.parse((await node.getAttribute("data-frame"))!) as PresentationSceneFrame;
}

async function startDrag(page: Page, target: Locator, dx: number, dy: number) {
  await target.scrollIntoViewIfNeeded();
  await target.evaluate((element) => {
    element.addEventListener(
      "pointerdown",
      (event) =>
        element.setAttribute("data-test-pointer-id", String((event as PointerEvent).pointerId)),
      { once: true },
    );
  });
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error("Missing drag target");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  return Number(await target.getAttribute("data-test-pointer-id"));
}

test("native pointer gestures preview, cancel, save and undo as single edits", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { id, scene: original } = await createDeck(page);
  const stage = page.locator("[data-native-scene]");
  const body = stage.locator('[data-node-id="body"]');
  const shape = stage.locator('[data-node-id="shape"]');
  const controls = page.getByRole("group", { name: "Selected object controls", exact: true });
  const selection = controls.getByRole("combobox", { name: "Canvas object", exact: true });
  const move = controls.getByRole("button", {
    name: "Move Evidence. Use arrow keys to nudge.",
    exact: true,
  });
  const resize = controls.getByRole("button", {
    name: "Resize Decision. Use arrow keys to change size.",
    exact: true,
  });
  const stageBounds = await stage.boundingBox();
  if (!stageBounds) throw new Error("Missing native stage");
  let saves = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      new URL(request.url()).pathname === `/v1/presentations/${id}/draft`
    )
      saves += 1;
  });
  await startDrag(page, body, stageBounds.width * 0.1, stageBounds.height * 0.1);
  expect((await renderedFrame(body)).x).toBeCloseTo(20, 0);
  expect((await renderedFrame(body)).y).toBeCloseTo(45, 0);
  expect(await savedScene(page, id)).toEqual(original);
  expect(saves).toBe(0);
  await page.mouse.up();
  await expect.poll(async () => frame(await savedScene(page, id), "body").x).toBeCloseTo(20, 0);
  const moved = await savedScene(page, id);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => savedScene(page, id)).toEqual(original);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(() => savedScene(page, id)).toEqual(moved);

  await selection.selectOption("shape");
  await startDrag(page, resize, stageBounds.width * 0.1, stageBounds.height * 0.1);
  expect((await renderedFrame(shape)).width).toBeCloseTo(35, 0);
  expect((await renderedFrame(shape)).height).toBeCloseTo(30, 0);
  expect(await savedScene(page, id)).toEqual(moved);
  await page.mouse.up();
  await expect
    .poll(async () => frame(await savedScene(page, id), "shape").width)
    .toBeCloseTo(35, 0);
  const resized = await savedScene(page, id);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => savedScene(page, id)).toEqual(moved);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(() => savedScene(page, id)).toEqual(resized);

  await selection.selectOption("body");
  await startDrag(page, move, stageBounds.width * 0.05, 0);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await renderedFrame(body)).toEqual(frame(resized, "body"));
  expect(await savedScene(page, id)).toEqual(resized);

  const pointerId = await startDrag(page, move, stageBounds.width * 0.05, 0);
  await move.dispatchEvent("pointercancel", { pointerId, isPrimary: true });
  await page.mouse.up();
  expect(await renderedFrame(body)).toEqual(frame(resized, "body"));
  expect(await savedScene(page, id)).toEqual(resized);

  await selectE01Object(page, "2. Evidence", "Access");
  await page.getByRole("checkbox", { name: "Include Decision in selection", exact: true }).check();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^2 objects selected$/ })
      .first(),
  ).toBeVisible();
  await openE01Inspector(page, "Content");
  const groupMove = controls.getByRole("button", {
    name: "Move Decision. Use arrow keys to nudge.",
    exact: true,
  });
  // Exceed the group’s remaining travel while keeping the external handle inside the viewport.
  await startDrag(page, groupMove, stageBounds.width * 0.5, 0);
  await page.mouse.up();
  const expectedDx = Math.min(
    ...["body", "shape"].map((nodeId) => {
      const bounds = frame(resized, nodeId);
      return 100 - bounds.x - bounds.width;
    }),
  );
  await expect
    .poll(async () => frame(await savedScene(page, id), "shape").x)
    .toBeCloseTo(frame(resized, "shape").x + expectedDx, 2);
  const grouped = await savedScene(page, id);
  expect(frame(grouped, "body").x - frame(resized, "body").x).toBeCloseTo(expectedDx, 2);
  expect(grouped.readingOrder).toEqual(original.readingOrder);
  expect(grouped.nodes.map((node) => node.id)).toEqual(original.nodes.map((node) => node.id));
  expect(grouped.nodes.find((node) => node.id === "edge")).toEqual(
    original.nodes.find((node) => node.id === "edge"),
  );
  await page.screenshot({
    path: testInfo.outputPath("direct-editing-selection.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => savedScene(page, id)).toEqual(resized);
  // Canceled gestures did not add history entries. The next undo removes the prior resize.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => savedScene(page, id)).toEqual(moved);
  await page.reload();
  expect(await renderedFrame(body)).toEqual(frame(moved, "body"));
});

for (const suffix of ["", " @mobile"]) {
  test(`native multiselection supports keyboard movement and safe deletion${suffix}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const { id, scene: original } = await createDeck(page);
    if ((testInfo.project.use.viewport?.width ?? 1280) <= 700) {
      await closeE01Overlays(page);
    }
    await selectE01Object(page, "2. Evidence", "Access");
    await page
      .getByRole("checkbox", { name: "Include Decision in selection", exact: true })
      .check();
    await closeE01Overlays(page);
    const move = page
      .getByRole("group", { name: "Selected object controls", exact: true })
      .getByRole("button", {
        name: "Move Decision. Use arrow keys to nudge.",
        exact: true,
      });
    await move.press("Shift+ArrowRight");
    await expect.poll(async () => frame(await savedScene(page, id), "body").x).toBe(15);
    const moved = await savedScene(page, id);
    expect(frame(moved, "shape").x).toBe(60);
    expect(frame(moved, "title")).toEqual(frame(original, "title"));
    await openE01Inspector(page, "Layout");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /^2 objects selected$/ })
        .first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Move selection down", exact: true }).click();
    await expect.poll(async () => frame(await savedScene(page, id), "body").y).toBe(36);
    expect(frame(await savedScene(page, id), "shape").y).toBe(36);
    await page.getByRole("button", { name: "Delete selected objects", exact: true }).click();
    await expect
      .poll(async () => (await savedScene(page, id)).nodes.map((node) => node.id))
      .toEqual(["title"]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () => (await savedScene(page, id)).nodes.map((node) => node.id))
      .toEqual(original.nodes.map((node) => node.id));
    expect((await savedScene(page, id)).readingOrder).toEqual(original.readingOrder);
  });
}
