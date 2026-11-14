import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  PresentationDraft,
  PresentationScene,
  PresentationSceneFrame,
} from "../../packages/contracts/src/index.ts";
import {
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  openE01Inspector,
  openE01Navigator,
  readE01Record,
  selectE01Object,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";
import { specialistLocale } from "./option-b-specialist-support";

test.use({ actionTimeout: 20_000 });

async function editorFixture(page: Page, narrow = false) {
  await signInBeta(page);
  await specialistLocale(page, "en-CA");
  const opening = e01Slide("A plan people can use");
  opening.scene = {
    schemaVersion: 9,
    aspectRatio: "16:9",
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "A plan people can use",
        frame: { x: 8, y: 5, width: 84, height: 15 },
      },
      {
        id: "body",
        type: "text",
        role: "body",
        text: "Plan with clarity\nChoose an owner",
        richText: {
          paragraphs: [
            { kind: "paragraph", runs: [{ text: "Plan", bold: true }, { text: " with clarity" }] },
            { kind: "bullet", runs: [{ text: "Choose an owner" }] },
          ],
        },
        frame: { x: 8, y: 28, width: 34, height: 25 },
      },
      {
        id: "shape",
        type: "shape",
        shape: "rounded_rectangle",
        label: "Focus box",
        color: "blue",
        frame: { x: 55, y: 28, width: 25, height: 25 },
      },
      {
        id: "table",
        type: "table",
        caption: "Practical evidence",
        headers: ["Priority", "Evidence", "Owner"],
        rows: [
          [
            "Make the intended outcome clear",
            "A worked example everyone can inspect",
            "Facilitator",
          ],
          ["Agree a small next step", "A named owner and a review date", "Team"],
        ],
        frame: { x: 8, y: 62, width: 74, height: 29 },
      },
    ],
    readingOrder: ["title", "body", "shape", "table"],
  };
  const slides = [
    opening,
    e01Slide("What we know"),
    e01Slide("Try the next step"),
    e01Slide("Agree a review"),
  ];
  const initial = await createE01Deck(page, slides, 18);
  const sections = [
    { id: randomUUID(), title: "Opening", blockIds: slides.slice(0, 2).map((slide) => slide.id) },
    { id: randomUUID(), title: "Workshop", blockIds: slides.slice(2).map((slide) => slide.id) },
  ];
  const response = await page.request.put(`${e01ApiUrl}/v1/presentations/${initial.id}/draft`, {
    data: {
      draft: { ...initial.draft, sections },
      expectedRevision: initial.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(response.status()).toBe(200);
  const record = (await response.json()).presentation as Awaited<ReturnType<typeof readE01Record>>;
  await enterE01Editor(page, record.id, narrow);
  return { record, slides, sections };
}

function firstScene(draft: PresentationDraft): PresentationScene {
  const block = draft.blocks.find(
    (entry) => entry.kind === "content" && entry.scene?.nodes.some((node) => node.id === "shape"),
  );
  if (block?.kind !== "content" || !block.scene) throw new Error("Expected editable fixture scene");
  return block.scene;
}

function frame(scene: PresentationScene, id: string): PresentationSceneFrame {
  const node = scene.nodes.find((entry) => entry.id === id);
  if (!node || node.type === "connector") throw new Error("Expected framed fixture object");
  return node.frame;
}

async function drag(
  page: Page,
  target: Locator,
  dx: number,
  dy: number,
  release = true,
  horizontal = 0.5,
) {
  await target.scrollIntoViewIfNeeded();
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error("Expected visible drag target");
  const x = bounds.x + bounds.width * horizontal;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  if (release) await page.mouse.up();
}

async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
}

test("selected objects drag and resize directly with visible corner and side handles", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { record } = await editorFixture(page);
  const saved = async () => firstScene((await readE01Record(page, record.id)).draft);
  const stage = page.locator("[data-native-scene]");
  const shape = stage.locator('[data-node-id="shape"]');
  const original = await saved();
  await shape.click();
  const handles = stage.locator("[data-native-resize-handle]");
  await expect(handles).toHaveCount(8);
  for (const edge of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
    await expect(stage.locator(`[data-native-resize-handle="${edge}"]`)).toBeVisible();
  }
  const stageBounds = await stage.boundingBox();
  if (!stageBounds) throw new Error("Expected slide bounds");
  await drag(page, shape, stageBounds.width * 0.05, stageBounds.height * 0.03, false);
  expect(await saved()).toEqual(original);
  await page.mouse.up();
  await expect.poll(async () => frame(await saved(), "shape").x).toBeCloseTo(60, 0);
  await expect.poll(async () => frame(await saved(), "shape").y).toBeCloseTo(31, 0);
  const moved = await saved();
  await drag(page, stage.locator('[data-native-resize-handle="w"]'), -stageBounds.width * 0.05, 0);
  await expect.poll(async () => frame(await saved(), "shape").width).toBeCloseTo(30, 0);
  const widened = await saved();
  expect(frame(widened, "shape").x + frame(widened, "shape").width).toBeCloseTo(
    frame(moved, "shape").x + frame(moved, "shape").width,
    2,
  );
  expect(frame(widened, "shape").height).toBe(frame(moved, "shape").height);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(saved).toEqual(moved);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(saved).toEqual(widened);
  await drag(
    page,
    stage.locator('[data-native-resize-handle="nw"]'),
    -stageBounds.width * 0.03,
    -stageBounds.height * 0.03,
    false,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await saved()).toEqual(widened);
  expect((await saved()).readingOrder).toEqual(original.readingOrder);
  await noOverflow(page);
  await stage.screenshot({ path: info.outputPath("direct-selection-handles.png") });
  await page.screenshot({ path: info.outputPath("editor-workspace.png"), fullPage: true });
  await stage.locator('[data-node-id="body"]').click({ modifiers: ["Shift"] });
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^2 objects selected$/ })
      .first(),
  ).toBeVisible();
  const multiple = await saved();
  await drag(
    page,
    stage.locator('[data-native-resize-handle="se"]'),
    stageBounds.width * 0.03,
    stageBounds.height * 0.02,
  );
  await expect
    .poll(async () => frame(await saved(), "body").width)
    .toBeGreaterThan(frame(multiple, "body").width);
  const scaled = await saved();
  const ratio = frame(scaled, "body").width / frame(multiple, "body").width;
  expect(frame(scaled, "body").height / frame(multiple, "body").height).toBeCloseTo(ratio, 6);
  expect(frame(scaled, "shape").width / frame(multiple, "shape").width).toBeCloseTo(ratio, 6);
  expect(frame(scaled, "title")).toEqual(frame(multiple, "title"));
  expect(scaled.readingOrder).toEqual(original.readingOrder);
  // A scrollable data object stays scrollable inside and movable along its border.
  await selectE01Object(page, /^4\./, "Layout");
  await page.getByRole("spinbutton", { name: "Object height (%)", exact: true }).fill("10");
  await expect.poll(async () => frame(await saved(), "table").height).toBe(10);
  await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
  const data = stage.locator('[data-native-data="table"]');
  expect(await data.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const scrollbarHit = await data.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width * 0.25, bounds.bottom - 2);
    return Boolean(hit?.closest("[data-native-move-border]"));
  });
  expect(scrollbarHit).toBe(false);
  const beforeTableMove = await saved();
  const currentBounds = (await stage.boundingBox())!;
  await drag(
    page,
    stage.locator('[data-native-move-border="n"]'),
    currentBounds.width * 0.04,
    -currentBounds.height * 0.03,
    false,
    0.25,
  );
  expect(await saved()).toEqual(beforeTableMove);
  await page.mouse.up();
  await expect.poll(async () => frame(await saved(), "table").x).toBeCloseTo(12, 0);
  const tableMoved = await saved();
  const tableNode = (scene: PresentationScene) => scene.nodes.find((node) => node.id === "table");
  expect(tableNode(tableMoved)).toEqual({
    ...tableNode(beforeTableMove),
    frame: frame(tableMoved, "table"),
  });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(saved).toEqual(beforeTableMove);
});

for (const narrow of [false, true]) {
  test(`section headers keep slide order clear and the navigator adapts${narrow ? " @mobile" : ""}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    if (narrow) await page.setViewportSize({ width: 320, height: 844 });
    const { record, slides, sections } = await editorFixture(page, narrow);
    let navigator = await openE01Navigator(page);
    const saved = async () => (await readE01Record(page, record.id)).draft;
    const original = await saved();
    const separator = page.getByRole("separator", { name: "Resize slide navigator", exact: true });
    if (narrow) {
      await expect(separator).toBeHidden();
    } else {
      const hide = page.getByRole("button", { name: "Hide inspector", exact: true });
      if (await hide.isVisible()) await hide.click();
      const before = Number(await separator.getAttribute("aria-valuenow"));
      await drag(page, separator, 70, 0);
      await expect
        .poll(async () => Number(await separator.getAttribute("aria-valuenow")))
        .toBeGreaterThan(before + 50);
      expect((await navigator.boundingBox())?.width).toBeGreaterThan(before + 50);
      await separator.press("Home");
      await expect(separator).toHaveAttribute("aria-valuenow", "200");
      await separator.press("ArrowRight");
      await expect(separator).toHaveAttribute("aria-valuenow", "216");
      await separator.press("End");
      const maximum = await separator.getAttribute("aria-valuemax");
      await expect(separator).toHaveAttribute("aria-valuenow", maximum!);
      await separator.press("Enter");
      await expect(separator).toHaveAttribute("aria-valuenow", "280");
      await separator.press("ArrowRight");
      await page.reload();
      navigator = await openE01Navigator(page);
      await expect(separator).toHaveAttribute("aria-valuenow", "296");
    }
    const opening = navigator.locator(`[data-section-header="${sections[0]!.id}"]`);
    await opening.getByRole("button", { name: "Collapse section Opening", exact: true }).click();
    await expect(navigator.locator(`[data-slide-id="${slides[0]!.id}"]`)).toBeHidden();
    await opening.getByRole("button", { name: "Expand section Opening", exact: true }).click();
    await expect(navigator.locator(`[data-slide-id="${slides[0]!.id}"]`)).toBeVisible();
    expect(await saved()).toEqual(original);
    const workshop = navigator.locator(`[data-section-header="${sections[1]!.id}"]`);
    await workshop.locator('summary[aria-label="Section actions: Workshop"]').click();
    await workshop.getByRole("button", { name: "Move section up", exact: true }).click();
    await expect
      .poll(async () => (await saved()).blocks.map((block) => block.id))
      .toEqual([slides[2]!.id, slides[3]!.id, slides[0]!.id, slides[1]!.id]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(saved).toEqual(original);
    await navigator
      .locator(`[data-slide-id="${slides[1]!.id}"]`)
      .getByRole("button")
      .first()
      .click();
    const toolbar = navigator.getByRole("region", { name: "Sections and navigation", exact: true });
    await toolbar.getByRole("button", { name: "Add section", exact: true }).click();
    await toolbar
      .getByRole("textbox", { name: "Section name", exact: true })
      .fill("Working discussion");
    await toolbar.getByRole("textbox", { name: "Section name", exact: true }).press("Enter");
    await expect
      .poll(
        async () =>
          (await saved()).sections?.find((section) => section.title === "Working discussion")
            ?.blockIds,
      )
      .toEqual([slides[1]!.id]);
    const created = (await saved()).sections!.find(
      (section) => section.title === "Working discussion",
    )!;
    const header = navigator.locator(`[data-section-header="${created.id}"]`);
    await header.locator('summary[aria-label="Section actions: Working discussion"]').click();
    await header.getByRole("button", { name: "Rename", exact: true }).click();
    await header.getByRole("textbox", { name: "Section name", exact: true }).fill("Discussion");
    await header.getByRole("textbox", { name: "Section name", exact: true }).press("Enter");
    await expect
      .poll(
        async () => (await saved()).sections?.find((section) => section.id === created.id)?.title,
      )
      .toBe("Discussion");
    await header.locator('summary[aria-label="Section actions: Discussion"]').click();
    await header.getByRole("button", { name: "Remove section", exact: true }).click();
    await expect
      .poll(async () => (await saved()).sections?.some((section) => section.id === created.id))
      .toBe(false);
    expect((await saved()).blocks).toEqual(original.blocks);
    await noOverflow(page);
    const accessibility = await new AxeBuilder({ page })
      .include("#presentation-slide-navigator")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await opening.scrollIntoViewIfNeeded();
    await navigator.screenshot({ path: info.outputPath("section-navigator.png") });
    await navigator
      .locator(`[data-slide-id="${slides[0]!.id}"]`)
      .getByRole("button")
      .first()
      .click();
    await toolbar
      .getByRole("combobox", { name: "Selected slide section", exact: true })
      .selectOption("");
    await navigator
      .getByRole("button", { name: "Collapse section Unsectioned", exact: true })
      .click();
    for (const section of sections) {
      const item = navigator.locator(`[data-section-header="${section.id}"]`);
      await item.locator(`summary[aria-label="Section actions: ${section.title}"]`).click();
      await item.getByRole("button", { name: "Remove section", exact: true }).click();
    }
    // A local collapsed run cannot strand all thumbnails after the final heading is removed.
    for (const slide of slides)
      await expect(navigator.locator(`[data-slide-id="${slide.id}"]`)).toBeVisible();
    expect((await saved()).blocks).toEqual(original.blocks);
  });

  test(`formatting and staged tables remain usable in collapsible tools${narrow ? " @mobile" : ""}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    if (narrow) await page.setViewportSize({ width: 320, height: 844 });
    const { record } = await editorFixture(page, narrow);
    const saved = async () => firstScene((await readE01Record(page, record.id)).draft);
    const original = await saved();
    await selectE01Object(page, /^2\./);
    const inspector = page.locator("#presentation-object-inspector");
    const content = inspector.locator('[data-native-inspector-group="content"]');
    await expect(content).toHaveAttribute("open", "");
    const textbox = content.getByRole("textbox", { name: "Node text", exact: true });
    await expect(textbox).toHaveValue("Plan with clarity\nChoose an owner");
    const bounds = await textbox.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(230);
    await content.getByRole("combobox", { name: "Font family", exact: true }).selectOption("serif");
    await content.getByRole("spinbutton", { name: "Font size (px)", exact: true }).fill("34");
    await expect
      .poll(async () => (await saved()).nodes.find((node) => node.id === "body"))
      .toMatchObject({
        typography: { font: "serif", size: 34 },
      });
    const formatted = (await saved()).nodes.find((node) => node.id === "body");
    const before = original.nodes.find((node) => node.id === "body");
    expect(formatted?.type === "text" && formatted.richText).toEqual(
      before?.type === "text" && before.richText,
    );
    expect(formatted?.type === "text" && formatted.text).toBe("Plan with clarity\nChoose an owner");
    await textbox.scrollIntoViewIfNeeded();
    await inspector.screenshot({ path: info.outputPath("text-formatting-tools.png") });
    await content.locator(":scope > summary").click();
    await expect(textbox).toBeHidden();
    await content.locator(":scope > summary").click();
    await expect(textbox).toHaveValue("Plan with clarity\nChoose an owner");
    await openE01Inspector(page, "Layout");
    const design = inspector.locator('[data-native-inspector-group="design"]');
    await expect(design).not.toHaveAttribute("open", "");
    await design.locator(":scope > summary").click();
    await expect(design).toHaveAttribute("open", "");
    await design.locator(":scope > summary").click();
    await expect(inspector.locator('[data-native-inspector-group="position"]')).toHaveAttribute(
      "open",
      "",
    );
    await selectE01Object(page, /^4\./);
    const scroll = inspector.locator('[data-native-data-scroll="true"]');
    const cell = scroll.getByRole("textbox", { name: "Row 1, column 1", exact: true });
    await cell.fill("An outcome that people can recognize");
    expect((await cell.boundingBox())?.width).toBeGreaterThanOrEqual(140);
    expect((await saved()).nodes.find((node) => node.id === "table")).toEqual(
      original.nodes.find((node) => node.id === "table"),
    );
    // Closing a group hides its controls without discarding an uncommitted data edit.
    const tableContent = inspector.locator('[data-native-inspector-group="content"]');
    await tableContent.locator(":scope > summary").click();
    await tableContent.locator(":scope > summary").click();
    await expect(cell).toHaveValue("An outcome that people can recognize");
    await inspector.getByRole("button", { name: "Apply table changes", exact: true }).click();
    await expect
      .poll(async () => {
        const table = (await saved()).nodes.find((node) => node.id === "table");
        return table?.type === "table" ? table.rows[0]?.[0] : null;
      })
      .toBe("An outcome that people can recognize");
    await noOverflow(page);
    const accessibility = await new AxeBuilder({ page })
      .include("#presentation-object-inspector")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await inspector.screenshot({ path: info.outputPath("collapsible-table-tools.png") });
    await page.reload();
    await selectE01Object(page, /^2\./);
    await expect(inspector.getByRole("combobox", { name: "Font family", exact: true })).toHaveValue(
      "serif",
    );
    await expect(
      inspector.getByRole("spinbutton", { name: "Font size (px)", exact: true }),
    ).toHaveValue("34");
    if (!narrow) {
      const renderedText = page.locator('[data-native-scene] [data-node-id="body"] p').first();
      await expect(renderedText).toHaveCSS("font-family", /Georgia/);
      const width = (await page.locator("[data-native-scene]").boundingBox())!.width;
      expect(
        await renderedText.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        ),
      ).toBeCloseTo(((width - 2) * 34) / 1280, 1);
    }
    if (narrow) {
      await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
      const selected = page.locator('[data-native-scene] [data-node-id="body"]');
      await expect(selected).toHaveCSS("outline-style", "solid");
      await expect(selected).toHaveCSS("outline-width", "2px");
      await expect(page.locator('[data-native-resize-handle="se"]')).toBeHidden();
      await noOverflow(page);
    }
  });
}
