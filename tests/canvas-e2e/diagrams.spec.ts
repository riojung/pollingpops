import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fits, newTeamCanvas, organization, saveText, snapshot } from "./support";

async function selectObject(page: Page, name: string) {
  const outline = page.getByRole("button", { name: "Object outline", exact: true });
  if ((await outline.getAttribute("aria-expanded")) === "false") await outline.click();
  await page.getByRole("button", { name, exact: true }).click();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
}

test("manual flow diagrams keep styled routes, ports, layer order and exported geometry", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await organization(page, testInfo);
  await page.goto("/boards");
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await page.getByRole("button", { name: "Team canvas", exact: true }).click();
  await page.getByRole("button", { name: /Flow to action/ }).click();
  await expect(page.getByRole("region", { name: "Starter preview", exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Board title", exact: true })
    .fill("Manual decision flow");
  await page.getByRole("button", { name: "Create board", exact: true }).click();
  await expect(page).toHaveURL(/\/canvas\/[0-9a-f-]+$/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  const initial = await snapshot(page, id);
  expect(initial.schemaVersion).toBe(3);
  expect(initial.objects.some((object) => object.type === "diamond")).toBe(true);
  expect(initial.objects.some((object) => object.type === "parallelogram")).toBe(true);
  const connector = initial.objects.find(
    (object) => object.type === "connector" && object.text === "Yes",
  )!;
  await selectObject(page, "Take the next action");
  await page.getByRole("spinbutton", { name: "Vertical position", exact: true }).fill("500");
  await save(page);
  await selectObject(page, "Yes");
  await page.getByRole("textbox", { name: "Connector label", exact: true }).fill("承認 → 次へ");
  await page.getByRole("combobox", { name: "Route", exact: true }).selectOption("elbow");
  await page.getByRole("combobox", { name: "Line style", exact: true }).selectOption("dashed");
  await page.getByRole("combobox", { name: "Line color", exact: true }).selectOption("blue");
  await page.getByRole("combobox", { name: "Start marker", exact: true }).selectOption("arrow");
  await page.getByRole("combobox", { name: "Source port", exact: true }).selectOption("right");
  await page.getByRole("combobox", { name: "Destination port", exact: true }).selectOption("left");
  await save(page);
  await expect
    .poll(async () =>
      (await snapshot(page, id)).objects.find((object) => object.id === connector.id),
    )
    .toMatchObject({
      text: "承認 → 次へ",
      routing: "elbow",
      lineStyle: "dashed",
      lineColor: "blue",
      startMarker: "arrow",
      from: { anchor: "right" },
      to: { anchor: "left" },
    });
  const rendered = page.getByTestId(`canvas-object-${connector.id}`);
  await expect(rendered.locator("text")).toHaveAttribute("aria-label", "承認 → 次へ");
  await expect(rendered.locator("path[stroke-dasharray]")).toHaveAttribute(
    "stroke-dasharray",
    "8 5",
  );
  expect(
    (await rendered.locator("path[stroke-dasharray]").getAttribute("d"))?.match(/L/g),
  ).toHaveLength(3);
  await page.getByRole("combobox", { name: "From object", exact: true }).selectOption("");
  await page
    .getByRole("spinbutton", { name: "Source horizontal position", exact: true })
    .fill("300.5");
  await page
    .getByRole("spinbutton", { name: "Source vertical position", exact: true })
    .fill("120.25");
  await save(page);
  await expect
    .poll(async () =>
      (await snapshot(page, id)).objects.find((object) => object.id === connector.id),
    )
    .toMatchObject({
      x: connector.x,
      y: connector.y,
      from: { objectId: null, x: 300.5, y: 120.25 },
    });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => {
      const object = (await snapshot(page, id)).objects.find((entry) => entry.id === connector.id);
      return object?.type === "connector" ? object.from.objectId : null;
    })
    .not.toBeNull();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await selectObject(page, "Ready to continue?");
  await page.getByRole("spinbutton", { name: "Rotation in degrees", exact: true }).fill("45");
  await save(page);
  await page.getByRole("button", { name: "Bring to front", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page, id)).objects.find((object) => object.type === "diamond")?.rotation,
    )
    .toBe(45);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export board", exact: true });
  await dialog.getByRole("combobox", { name: "File format", exact: true }).selectOption("svg");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download", exact: true }).click();
  const file = testInfo.outputPath("manual-flow.svg");
  await (await download).saveAs(file);
  const svg = await readFile(file, "utf8");
  expect(svg).toContain("承認 → 次へ");
  expect(svg).toContain("marker-start=");
  expect(svg).toContain("M140 0 L280 95 L140 190 L0 95 Z");
  expect(svg).not.toMatch(/<foreignObject|<script|href="https?:/);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await expect(page.getByTestId(`canvas-object-${connector.id}`).locator("text")).toHaveAttribute(
    "aria-label",
    "承認 → 次へ",
  );
  await page.getByRole("button", { name: "Fit board", exact: true }).click();
  for (const mode of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: mode });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
    await fits(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`diagrams-desktop-${mode}.png`),
      fullPage: true,
    });
  }
});

test("@mobile manual diagram controls remain usable through the outline at320px", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await organization(page, testInfo);
  await page.setViewportSize({ width: 320, height: 844 });
  const id = await newTeamCanvas(page);
  await page.getByRole("button", { name: "Diamond", exact: true }).tap();
  await saveText(page, "Decision");
  await page.getByRole("button", { name: "Parallelogram", exact: true }).tap();
  await saveText(page, "Input");
  await page.getByRole("button", { name: "Connector", exact: true }).tap();
  await page.getByRole("button", { name: "Decision", exact: true }).tap();
  await expect(page.getByRole("textbox", { name: "Connector label", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Connector label", exact: true }).fill("Review input");
  await page.getByRole("combobox", { name: "Route", exact: true }).selectOption("elbow");
  await page.getByRole("combobox", { name: "From object", exact: true }).selectOption("");
  await page
    .getByRole("spinbutton", { name: "Source horizontal position", exact: true })
    .fill("10.5");
  await save(page);
  await expect
    .poll(
      async () =>
        (await snapshot(page, id)).objects.filter((object) => object.type === "connector").length,
    )
    .toBe(1);
  for (const [width, mode] of [
    [320, "light"],
    [390, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: mode });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
    await fits(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`diagrams-${width}-${mode}.png`),
      fullPage: true,
    });
  }
});
