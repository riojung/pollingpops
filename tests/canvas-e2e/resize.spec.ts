import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { api, newTeamCanvas, organization, snapshot } from "./support";

test("rotated drag resizing preserves model position and survives undo and reload", async ({
  page,
}, testInfo) => {
  await organization(page, testInfo);
  const boardId = await newTeamCanvas(page);
  const id = randomUUID();
  const geometry = { x: 100, y: 100, width: 180, height: 100, rotation: 45 };
  const created = await page.request.post(`${api}/v1/canvas-boards/${boardId}/commands`, {
    data: {
      schemaVersion: 2,
      operationId: randomUUID(),
      command: {
        type: "batch",
        operations: [
          { type: "create", object: { id, type: "rect", text: "Rotated shape", ...geometry } },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Rotated shape", exact: true }).click();
  const handle = page.getByTestId(`canvas-object-${id}`).locator("[data-canvas-resize]");
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  const output = await page
    .getByRole("group", { name: "Canvas zoom", exact: true })
    .locator("output")
    .textContent();
  const zoom = Number(output!.replace("%", "")) / 100;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40 * zoom, start.y + 20 * zoom, { steps: 3 });
  await page.mouse.up();
  const current = async () =>
    (await snapshot(page, boardId)).objects.find((object) => object.id === id);
  const resized = { ...geometry, width: expect.closeTo(220, 6), height: expect.closeTo(120, 6) };
  await expect.poll(current).toMatchObject(resized);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(current).toMatchObject(geometry);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(current).toMatchObject(resized);
  await page.reload();
  await expect.poll(current).toMatchObject(resized);
});
