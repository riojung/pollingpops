import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  ContentSlideDraft,
  PresentationDraft,
  PresentationScene,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import {
  createE01Deck,
  closeE01Overlays,
  enterE01Editor,
  openE01Inspector,
  readE01Record,
  type E01Record,
} from "./presentation-e01-support";

test.use({ actionTimeout: 30_000 });

const initialDesign = { theme: "paper", font: "sans", spacing: "relaxed" };

function nativeBlock(draft: PresentationDraft, index = 0) {
  const block = draft.blocks[index];
  if (block?.kind !== "content" || !block.scene) throw new Error("Expected a native slide");
  return block as ContentSlideDraft & { scene: PresentationScene };
}

function ordinarySlide(title: string, body: string): ContentSlideDraft {
  return {
    id: randomUUID(),
    kind: "content",
    layout: "title_body",
    textElements: [
      { id: randomUUID(), role: "title", text: title, region: "top_center", order: 0 },
      { id: randomUUID(), role: "body", text: body, region: "middle_center", order: 0 },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "PRIVATE original discovery cue",
    citations: [
      { locator: "Original discovery source", excerpt: "Preserve this source metadata." },
    ],
  };
}

async function expectAbove(control: Locator, canvas: Locator) {
  await expect(control).toBeVisible();
  await expect(canvas).toBeVisible();
  const [controlBounds, canvasBounds] = await Promise.all([
    control.boundingBox(),
    canvas.boundingBox(),
  ]);
  expect(controlBounds).not.toBeNull();
  expect(canvasBounds).not.toBeNull();
  expect(controlBounds!.y + controlBounds!.height).toBeLessThanOrEqual(canvasBounds!.y + 1);
}

async function expectReadyDesign(page: Page, narrow: boolean) {
  const canvas = page.locator("[data-native-scene]");
  const inspector = await openE01Inspector(page, "Layout");
  const panel = inspector.getByRole("group", { name: "Design", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "Base color theme", exact: true })).toHaveValue(
    "paper",
  );
  await expect(panel.getByRole("combobox", { name: "Slide font", exact: true })).toHaveValue(
    "sans",
  );
  await expect(panel.getByRole("combobox", { name: "Slide spacing", exact: true })).toHaveValue(
    "relaxed",
  );
  await expect(page.getByRole("button", { name: "Enable slide design", exact: true })).toHaveCount(
    0,
  );
  await expect(canvas).toHaveAttribute("data-native-theme", "paper");
  if (narrow) await closeE01Overlays(page);
  await expect(canvas).toBeVisible();
  const canvasBounds = await canvas.boundingBox();
  expect(canvasBounds).not.toBeNull();
  if (narrow) {
    expect(canvasBounds!.width).toBeGreaterThan((page.viewportSize()?.width ?? 390) * 0.75);
  } else {
    const inspectorBounds = await inspector.boundingBox();
    expect(inspectorBounds).not.toBeNull();
    expect(canvasBounds!.width).toBeGreaterThan(inspectorBounds!.width);
  }
}

async function expectSlideActionsAbove(page: Page) {
  const toolbar = page.locator('[aria-label="Selected block actions"]');
  const canvas = page.locator("[data-native-scene]");
  for (const name of ["Hide slide", "Duplicate", "Move earlier", "Move later"]) {
    await expectAbove(toolbar.getByRole("button", { name, exact: true }), canvas);
  }
  return toolbar;
}

async function addSlideFromNavigator(page: Page, narrow: boolean) {
  const open = page.getByRole("button", { name: "Open map", exact: true });
  if (await open.isVisible()) await open.click();
  const navigator = page.locator("#presentation-slide-navigator");
  await expect(navigator).toBeVisible();
  await navigator.getByRole("button", { name: "New slide", exact: true }).click();
  if (narrow) await closeE01Overlays(page);
}

for (const suffix of ["", " @mobile"]) {
  test(`blank and existing presentations expose contextual design and navigator slide creation${suffix}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 700;
    await page.goto("/create/presentation");
    const creating = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/presentations",
    );
    await page.getByRole("button", { name: /^Start blank/ }).click();
    const response = await creating;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toMatchObject({ initialSlide: "native" });
    const launched = (await response.json()).presentation as E01Record;
    expect(launched.draft.schemaVersion).toBe(7);
    const first = nativeBlock(launched.draft);
    expect(first.scene.schemaVersion).toBe(3);
    expect(first.scene.design).toEqual(initialDesign);
    expect(
      first.scene.nodes.map((node) =>
        node.type === "text"
          ? { type: node.type, role: node.role, text: node.text }
          : { type: node.type },
      ),
    ).toEqual([
      { type: "text", role: "title", text: "" },
      { type: "text", role: "body", text: "" },
    ]);
    expect(new Set(first.scene.nodes.map((node) => node.id)).size).toBe(2);
    expect(first.scene.readingOrder).toEqual(first.scene.nodes.map((node) => node.id));
    await expect(page).toHaveURL(`/presentation/${launched.id}`);
    if (narrow) await closeE01Overlays(page);
    await expectReadyDesign(page, narrow);
    await expectSlideActionsAbove(page);
    await page.screenshot({
      path: testInfo.outputPath("blank-presentation-native-design-entry.png"),
      fullPage: true,
    });

    const ordinary = ordinarySlide(
      "Existing source slide",
      "Keep the original message and source details.",
    );
    const followUp = ordinarySlide("Existing follow-up", "Keep the second slide ordinary.");
    const legacy = await createE01Deck(page, [ordinary, followUp], 2);
    expect(legacy.draft.schemaVersion).toBe(2);
    const original = legacy.draft.blocks[0] as ContentSlideDraft;
    expect(original.scene).toBeUndefined();
    await enterE01Editor(page, legacy.id, narrow);
    const toolbar = page.locator('[aria-label="Selected block actions"]');
    const conversion = toolbar.getByRole("button", {
      name: "Convert to native slide",
      exact: true,
    });
    await expect(
      page.getByRole("button", { name: "Convert to native slide", exact: true }),
    ).toHaveCount(1);
    await expectAbove(conversion, page.locator("main article[data-layout]"));
    await conversion.click();
    await expect
      .poll(async () => (await readE01Record(page, legacy.id)).draft.schemaVersion)
      .toBe(4);
    const convertedDraft = (await readE01Record(page, legacy.id)).draft;
    const converted = nativeBlock(convertedDraft);
    expect(converted.id).toBe(original.id);
    expect(converted.speakerNotes).toBe(original.speakerNotes);
    expect(converted.citations).toEqual(original.citations);
    expect(converted.layout).toBe(original.layout);
    expect(converted.textElements).toEqual([]);
    expect(converted.scene.schemaVersion).toBe(1);
    expect(converted.scene.design).toBeUndefined();
    expect(converted.scene.readingOrder).toEqual(
      original.textElements.map((element) => element.id),
    );
    expect(
      converted.scene.nodes.map((node) =>
        node.type === "text" ? { id: node.id, role: node.role, text: node.text } : { id: node.id },
      ),
    ).toEqual(original.textElements.map(({ id, role, text }) => ({ id, role, text })));
    expect(convertedDraft.blocks[1]).toEqual(legacy.draft.blocks[1]);
    await expect(
      page.getByRole("button", { name: "Convert to native slide", exact: true }),
    ).toHaveCount(0);
    const inspector = await openE01Inspector(page, "Layout");
    await expect(
      inspector.getByRole("button", { name: "Enable slide design", exact: true }),
    ).toBeVisible();
    if (narrow) await closeE01Overlays(page);
    await expectSlideActionsAbove(page);

    await addSlideFromNavigator(page, narrow);
    await expect
      .poll(async () => (await readE01Record(page, legacy.id)).draft.blocks.length)
      .toBe(3);
    let draft = (await readE01Record(page, legacy.id)).draft;
    expect(draft.schemaVersion).toBe(7);
    const added = nativeBlock(draft, 1);
    expect(added.id).not.toBe(original.id);
    expect(added.scene).toMatchObject({ schemaVersion: 3, design: initialDesign });
    expect(added.scene.nodes).toHaveLength(2);
    expect(added.scene.nodes.map((node) => (node.type === "text" ? node.role : node.type))).toEqual(
      ["title", "body"],
    );
    expect(draft.blocks[0]).toEqual(converted);
    expect(draft.blocks[2]).toEqual(legacy.draft.blocks[1]);
    await expectReadyDesign(page, narrow);
    await expectSlideActionsAbove(page);
    await openE01Inspector(page, "Content");
    await page
      .getByLabel("Native slide title", { exact: true })
      .fill("A discoverable native slide");
    await expect
      .poll(async () => {
        const title = nativeBlock((await readE01Record(page, legacy.id)).draft, 1).scene.nodes.find(
          (node) => node.type === "text" && node.role === "title",
        );
        return title?.type === "text" ? title.text : "";
      })
      .toBe("A discoverable native slide");
    if (narrow) await closeE01Overlays(page);
    await toolbar.getByRole("button", { name: "Hide slide", exact: true }).click();
    await expect
      .poll(async () => nativeBlock((await readE01Record(page, legacy.id)).draft, 1).hidden)
      .toBe(true);
    await expectAbove(
      toolbar.getByRole("button", { name: "Show slide", exact: true }),
      page.locator("[data-native-scene]"),
    );
    await toolbar.getByRole("button", { name: "Duplicate", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, legacy.id)).draft.blocks.length)
      .toBe(4);
    draft = (await readE01Record(page, legacy.id)).draft;
    const duplicate = nativeBlock(draft, 2);
    expect(duplicate.id).not.toBe(added.id);
    expect(duplicate.hidden).toBe(true);
    expect(duplicate.scene.design).toEqual(initialDesign);
    expect(
      duplicate.scene.nodes.every(
        (node) => !added.scene.nodes.some((source) => source.id === node.id),
      ),
    ).toBe(true);
    await toolbar.getByRole("button", { name: "Move earlier", exact: true }).click();
    await expect
      .poll(async () =>
        (await readE01Record(page, legacy.id)).draft.blocks.map((block) => block.id),
      )
      .toEqual([original.id, duplicate.id, added.id, followUp.id]);
    draft = (await readE01Record(page, legacy.id)).draft;
    expect(draft.blocks[0]).toEqual(converted);
    expect(draft.blocks[3]).toEqual(legacy.draft.blocks[1]);
    await expectReadyDesign(page, narrow);
    await expectAbove(
      toolbar.getByRole("button", { name: "Duplicate", exact: true }),
      page.locator("[data-native-scene]"),
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("existing-presentation-visible-native-actions.png"),
      fullPage: true,
    });
  });
}
