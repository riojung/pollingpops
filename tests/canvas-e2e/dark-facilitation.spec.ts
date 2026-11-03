import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  CANVAS_SCHEMA_VERSION,
  CanvasColorSchema,
} from "../../packages/contracts/src/canvas-boards";
import {
  api,
  canvasAction,
  closeInspector,
  fits,
  newTeamCanvas,
  openInspector,
  organization,
  saveText,
  snapshot,
} from "./support";

test("canvas line families and frame boundaries remain visible in both themes without rewriting content", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await organization(page, testInfo);
  const id = await newTeamCanvas(page);
  const targets: Array<{ id: string; selector: string }> = [];
  const objects: Record<string, unknown>[] = [];
  for (const [index, color] of CanvasColorSchema.options.entries()) {
    const y = 100 + index * 52;
    const penId = randomUUID(),
      connectorId = randomUUID();
    objects.push({
      id: penId,
      type: "pen",
      x: 100,
      y,
      width: 180,
      height: 20,
      color,
      strokeWidth: 4,
      points: [
        [100, y + 20],
        [190, y],
        [280, y + 20],
      ],
    });
    objects.push({
      id: connectorId,
      type: "connector",
      x: 360,
      y,
      width: 180,
      height: 20,
      lineColor: color,
      from: { objectId: null, x: 360, y },
      to: { objectId: null, x: 540, y: y + 20 },
    });
    targets.push(
      { id: penId, selector: "polyline" },
      { id: connectorId, selector: 'path[stroke]:not([stroke="transparent"])' },
    );
  }
  for (const [index, color] of ["white", "black"].entries()) {
    const frameId = randomUUID();
    objects.push({
      id: frameId,
      type: "frame",
      color,
      x: 650,
      y: 100 + index * 300,
      width: 440,
      height: 260,
      text: `${color} frame boundary`,
    });
    targets.push({ id: frameId, selector: "rect" });
    objects.push({
      id: randomUUID(),
      type: "sticky",
      color: index ? "black" : "blue",
      x: 680,
      y: 175 + index * 300,
      width: 180,
      height: 150,
      text: "Readable note",
    });
  }
  const neutral = randomUUID();
  objects.push({
    id: neutral,
    type: "connector",
    x: 670,
    y: 730,
    width: 300,
    height: 80,
    text: "A readable relationship",
    from: { objectId: null, x: 670, y: 730 },
    to: { objectId: null, x: 970, y: 810 },
  });
  targets.push({ id: neutral, selector: 'path[stroke]:not([stroke="transparent"])' });
  const seeded = await page.request.post(`${api}/v1/canvas-boards/${id}/commands`, {
    data: {
      schemaVersion: CANVAS_SCHEMA_VERSION,
      operationId: randomUUID(),
      command: {
        type: "batch",
        operations: objects.map((object) => ({ type: "create", object: { text: "", ...object } })),
      },
    },
  });
  expect(seeded.status(), await seeded.text()).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: "Fit board", exact: true }).click();
  const before = await snapshot(page, id);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
    await expect
      .poll(async () =>
        page.evaluate((targets) => {
          const canvas = document.querySelector('[data-testid="canvas-surface"]')!;
          const rgb = (color: string) => {
            const channels = color
              .match(/[\d.]+/g)
              ?.slice(0, 3)
              .map(Number);
            if (!channels || channels.length !== 3) throw new Error("Expected opaque display ink");
            const [r, g, b] = channels.map((value) => {
              const s = value / 255;
              return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
          };
          const background = rgb(getComputedStyle(canvas).backgroundColor);
          return Math.min(
            ...targets.map((target) => {
              const node = document.querySelector(
                `[data-testid="canvas-object-${target.id}"] ${target.selector}`,
              )!;
              const ink = rgb(getComputedStyle(node).stroke);
              return (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05);
            }),
          );
        }, targets),
      )
      .toBeGreaterThanOrEqual(3);
    await expect
      .poll(async () => (await new AxeBuilder({ page }).analyze()).violations)
      .toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`canvas-lines-${colorScheme}.png`) });
    expect((await snapshot(page, id)).objects).toEqual(before.objects);
    expect((await snapshot(page, id)).canvasSeq).toBe(before.canvasSeq);
  }
});

for (const prefix of ["", "@mobile "]) {
  test(`${prefix}floating timer keeps compact controls, original retry and discussion drafts`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await organization(page, testInfo);
    const id = await newTeamCanvas(page);
    await page
      .getByRole("group", { name: "Canvas tools", exact: true })
      .getByRole("button", { name: "Sticky note", exact: true })
      .click();
    await saveText(page, "A synthetic workshop question");
    await openInspector(page, "Facilitation");
    const panel = page.getByRole("region", { name: "Facilitation", exact: true });
    await panel.getByRole("button", { name: "Comment on selected object", exact: true }).click();
    await panel
      .getByRole("textbox", { name: "Your draft", exact: true })
      .fill("Retain this discussion draft");
    await panel.getByRole("button", { name: "Timer", exact: true }).click();
    await panel.getByRole("button", { name: "Float timer", exact: true }).click();
    const popup = page.getByRole("region", { name: "Quick timer", exact: true });
    await expect(popup).toBeVisible();
    await expect(page.getByTestId("canvas-inspector")).toHaveAttribute("data-open", "false");
    const minutes = popup.getByRole("spinbutton", { name: "Minutes", exact: true });
    await expect(minutes).toHaveValue("5");
    await popup.getByRole("button", { name: "Decrease duration", exact: true }).click();
    await expect(minutes).toHaveValue("4");
    await popup.getByRole("button", { name: "Increase duration", exact: true }).click();
    await popup.getByRole("button", { name: "5 min", exact: true }).click();
    const writes: string[] = [];
    await page.route(`${api}/v1/canvas-boards/${id}/facilitation/commands`, async (route) => {
      writes.push(route.request().postData()!);
      const response = await route.fetch();
      expect(response.status(), await response.text()).toBe(200);
      if (writes.length === 1) await route.abort("connectionreset");
      else await route.fulfill({ response });
    });
    await popup.getByRole("button", { name: "Start timer", exact: true }).click();
    await expect(popup.getByRole("button", { name: "Retry saving", exact: true })).toBeEnabled();
    await popup.getByRole("button", { name: "Retry saving", exact: true }).click();
    await expect(popup.getByRole("button", { name: "Pause timer", exact: true })).toBeEnabled();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toBe(writes[0]);
    await popup.getByRole("button", { name: "Pause timer", exact: true }).click();
    await expect(popup.getByRole("status").filter({ hasText: /^Paused$/ })).toBeVisible();
    await popup.getByRole("button", { name: "Resume timer", exact: true }).click();
    await expect(popup.getByRole("button", { name: "Pause timer", exact: true })).toBeVisible();
    await popup.getByRole("button", { name: "Reset timer", exact: true }).click();
    await expect(popup.getByRole("button", { name: "Start timer", exact: true })).toBeEnabled();
    for (const width of prefix ? [320, 390] : [1440]) {
      await page.setViewportSize({ width, height: prefix ? 844 : 1000 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
        await fits(page);
        const box = (await popup.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
        await expect(page.getByRole("timer", { name: "Workshop timer", exact: true })).toHaveCount(
          1,
        );
        await expect
          .poll(async () => (await new AxeBuilder({ page }).analyze()).violations)
          .toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(`quick-timer-${width}-${colorScheme}.png`),
        });
      }
    }
    await popup.getByRole("button", { name: "Close timer", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    expect(
      await page.evaluate(() => {
        const active = document.activeElement;
        return (
          active instanceof HTMLElement &&
          active !== document.body &&
          active.getClientRects().length > 0 &&
          !active.closest("[inert],[hidden]")
        );
      }),
    ).toBe(true);
    await openInspector(page, "Facilitation");
    await panel.getByRole("button", { name: "Comments", exact: true }).click();
    await expect(panel.getByRole("textbox", { name: "Your draft", exact: true })).toHaveValue(
      "Retain this discussion draft",
    );
    await panel.getByRole("button", { name: "Discard draft", exact: true }).click();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
      await expect
        .poll(async () => (await new AxeBuilder({ page }).analyze()).violations)
        .toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(
          `facilitation-panel-${prefix ? "mobile" : "desktop"}-${colorScheme}.png`,
        ),
      });
    }
    await closeInspector(page);
    await (await canvasAction(page, "Quick timer")).click();
    await expect(popup).toBeVisible();
    await popup.getByRole("button", { name: "Close timer", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: prefix ? "More board actions" : "Quick timer",
        exact: true,
      }),
    ).toBeFocused();
  });
}
