import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  ContentSlideDraft,
  PresentationSceneDesign,
  PresentationSceneNode,
} from "../../packages/contracts/src/index.ts";
import templates from "../../apps/web/lib/presentation-native-template-content.json";
import {
  closeE01Overlays,
  createE01Deck,
  e01Slide,
  enterE01Editor,
  openE01Inspector,
  openE01Navigator,
  readE01Record,
  selectE01Block,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

// Use the original template copy and authored frames rather than a short synthetic title.
// This fixture deliberately does not import the client template factory into Playwright.
function templateSlide(templateId: string, title: string): ContentSlideDraft {
  const template = templates.find((entry) => entry.id === templateId)!;
  const copy = template.slides.find((entry) => entry.title === title)!;
  const table = "illustrativeTable" in copy ? copy.illustrativeTable : undefined;
  const chart = "illustrativeChart" in copy ? copy.illustrativeChart : undefined;
  const data = table || chart;
  const nodes: PresentationSceneNode[] = [
    {
      id: randomUUID(),
      type: "text",
      role: "title",
      text: copy.title,
      frame: { x: 7, y: 3, width: 86, height: 24 },
    },
  ];
  if (!chart)
    nodes.push({
      id: randomUUID(),
      type: "text",
      role: "body",
      text: data ? (/^.*?[.!?](?=\s|$)/u.exec(copy.body)?.[0] ?? copy.body) : copy.body,
      frame: data ? { x: 7, y: 29, width: 86, height: 20 } : { x: 7, y: 33, width: 86, height: 61 },
    });
  if (table)
    nodes.push({
      ...structuredClone(table),
      id: randomUUID(),
      type: "table",
      frame: { x: 7, y: 52, width: 86, height: 45 },
    });
  if (chart)
    nodes.push({
      ...structuredClone(chart),
      chartType: chart.chartType as "bar",
      id: randomUUID(),
      type: "chart",
      frame: { x: 7, y: 30, width: 86, height: 67 },
    });
  return {
    ...e01Slide(title),
    speakerNotes: `PRIVATE template adaptation guidance: ${copy.notes}`,
    scene: {
      schemaVersion: 4,
      aspectRatio: "16:9",
      design: {
        theme: template.theme as PresentationSceneDesign["theme"],
        font: template.font as PresentationSceneDesign["font"],
        spacing: data ? "compact" : "relaxed",
      },
      nodes,
      readingOrder: nodes.map((node) => node.id),
    },
  };
}

const longTitle = "A repair request should become an owned next step";
const tableTitle = "A comparison group adds useful context";
const chartTitle = "A small demand model makes the assumptions visible";
const overflowTitle = "Deliberately overflowing reference title";
function slides() {
  const overflow = e01Slide(overflowTitle);
  const title = overflow.scene!.nodes[0]!;
  if (title.type !== "text") throw new Error("Expected text");
  title.frame.height = 1;
  overflow.scene!.schemaVersion = 4;
  overflow.scene!.design = { theme: "paper", font: "sans", spacing: "relaxed" };
  const shape: PresentationSceneNode = {
    id: randomUUID(),
    type: "shape",
    shape: "rectangle",
    color: "blue",
    label: "Owned next step",
    frame: { x: 8, y: 78, width: 84, height: 18 },
  };
  overflow.scene!.nodes.push(shape);
  overflow.scene!.readingOrder.push(shape.id);
  return [
    templateSlide("native-startup-pitch", longTitle),
    templateSlide("native-lesson-explainer", tableTitle),
    templateSlide("native-startup-pitch", chartTitle),
    overflow,
  ];
}

async function overflowState(stage: Locator) {
  return stage
    .locator('[data-node-type="text"], [data-node-type="table"], [data-node-type="chart"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const content = node.firstElementChild as HTMLElement;
        return {
          id: (node as HTMLElement).dataset.nodeId,
          type: (node as HTMLElement).dataset.nodeType,
          text: content.textContent,
          overflow:
            content.scrollHeight > content.clientHeight + 1 ||
            content.scrollWidth > content.clientWidth + 1,
        };
      }),
    );
}

async function shapeLabelFits(stage: Locator) {
  return stage.locator('[data-node-type="shape"] span').evaluate((label) => {
    const frame = label.closest('[data-node-type="shape"]')!.getBoundingClientRect();
    const bounds = label.getBoundingClientRect();
    return (
      bounds.left >= frame.left - 1 &&
      bounds.top >= frame.top - 1 &&
      bounds.right <= frame.right + 1 &&
      bounds.bottom <= frame.bottom + 1
    );
  });
}

async function settleWorkspace(page: Page, expanded: boolean) {
  for (const panel of ["presentation-slide-navigator", "presentation-object-inspector"])
    await expect(page.locator(`button[aria-controls="${panel}"]`)).toHaveAttribute(
      "aria-expanded",
      String(expanded),
    );
  // The grid animates between rail states. Sample authored fit only after that real
  // transition completes; an intermediate width cannot be the broad reference plane.
  await page.locator("#presentation-canvas").evaluate(async (canvas) => {
    const workspace = canvas.parentElement!;
    void getComputedStyle(workspace).gridTemplateColumns;
    await Promise.all(workspace.getAnimations().map((animation) => animation.finished));
  });
}

test("native template fit stays consistent between broad and rail-constrained stages", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await signInBeta(page);
  const record = await createE01Deck(page, slides(), 8);
  await enterE01Editor(page, record.id, false);
  const canvas = page.locator('[data-native-scene-canvas="true"]');
  const stage = canvas.locator('[data-native-scene="true"]');
  for (const [index, title] of [longTitle, tableTitle, chartTitle, overflowTitle].entries()) {
    await selectE01Block(page, title, false);
    await closeE01Overlays(page);
    await settleWorkspace(page, false);
    await expect(stage).toHaveAttribute("aria-label", `${title} native slide`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const broad = await overflowState(stage);
    const titleState = broad.find((node) => node.type === "text")!;
    expect(titleState.overflow).toBe(title === overflowTitle);
    if (title === tableTitle)
      expect(broad.find((node) => node.type === "table")!.overflow).toBe(false);
    const broadWidth = (await stage.boundingBox())!.width;
    if (title === overflowTitle) expect(await shapeLabelFits(stage)).toBe(true);
    if (index === 0)
      await page.screenshot({
        path: testInfo.outputPath("template-broad-1280.png"),
        fullPage: false,
      });

    await openE01Navigator(page);
    await openE01Inspector(page, "Layout");
    await settleWorkspace(page, true);
    await expect
      .poll(async () => (await stage.boundingBox())!.width)
      .toBeLessThan(broadWidth * 0.8);
    await expect.poll(() => overflowState(stage)).toEqual(broad);
    if (title === overflowTitle) {
      await expect(stage.locator('[data-node-type="text"]').first().locator("h1")).toHaveAttribute(
        "tabindex",
        "0",
      );
      await expect(canvas.locator('[data-native-fit-feedback="true"]')).toContainText(
        "exceeds its frame",
      );
      expect(await shapeLabelFits(stage)).toBe(true);
    }
    if (title === chartTitle) {
      const chart = stage.locator('[data-native-data="chart"]');
      await expect(chart).toHaveAttribute("data-chart-layout", "split");
      const plot = await chart.locator("svg").boundingBox();
      const table = await chart.getByRole("table").boundingBox();
      expect(plot!.x + plot!.width).toBeLessThanOrEqual(table!.x);
    }
    if (index === 0)
      await page.screenshot({
        path: testInfo.outputPath("template-constrained-1280.png"),
        fullPage: false,
      });
  }
  const after = await readE01Record(page, record.id);
  expect(after.draft).toEqual(record.draft);
  expect(after.draftRevision).toBe(record.draftRevision);
});

test("native phone reading preserves complete template text and semantic data @mobile", async ({
  page,
}, testInfo) => {
  await signInBeta(page);
  const blocks = slides();
  const record = await createE01Deck(page, blocks, 8);
  await enterE01Editor(page, record.id, true);
  const canvas = page.locator('[data-native-scene-canvas="true"]');
  const stage = canvas.locator('[data-native-scene="true"]');
  for (const block of blocks) {
    const title = block.scene!.nodes[0]!;
    if (title.type !== "text") throw new Error("Expected title");
    await selectE01Block(page, title.text, true);
    await expect(stage).toHaveAttribute("aria-label", `${title.text} native slide`);
    await expect(stage).not.toHaveAttribute("data-native-fixed-layout", "true");
    await expect(stage.locator("h1")).toHaveCSS("font-size", "30px");
    await expect(stage.locator("h1")).toHaveText(title.text);
    await expect(canvas.locator('[data-native-fit-feedback="true"]')).toContainText(
      "Wide slide fit cannot be checked",
    );
    const ids = await stage
      .locator("[data-node-id]")
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.nodeId));
    expect(ids).toEqual(block.scene!.readingOrder);
    for (const node of block.scene!.nodes) {
      const rendered = stage.locator(`[data-node-id="${node.id}"]`);
      await expect(rendered).toHaveCSS("position", "relative");
      if (node.type === "text" && node.role === "body") {
        await expect(rendered.locator("p")).toHaveCSS("font-size", "18px");
        await expect(rendered.locator("p")).toHaveText(node.text);
      }
      if (node.type === "table") {
        await expect(rendered.locator('[data-native-data="table"]')).toHaveCSS("font-size", "16px");
        await expect(rendered.getByRole("cell")).toHaveText(node.rows.flat());
      }
      if (node.type === "shape")
        await expect(rendered.locator("span")).toHaveCSS("font-size", "18px");
    }
    expect((await overflowState(stage)).every((node) => !node.overflow)).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
  }
  await selectE01Block(page, longTitle, true);
  await page.screenshot({ path: testInfo.outputPath("template-reading-390.png"), fullPage: false });
  const after = await readE01Record(page, record.id);
  expect(after.draft).toEqual(record.draft);
  expect(after.draftRevision).toBe(record.draftRevision);
});
