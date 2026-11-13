import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import type {
  ContentSlideDraft,
  PresentationDraft,
  PresentationDraftMutation,
  PresentationScene,
} from "../../packages/contracts/src/index.ts";
import type {
  DesignLayoutId,
  PresentationDesignId,
} from "../../apps/web/lib/presentation-designs.ts";
import {
  presentationDesignCopy,
  presentationDesignDraftCopy,
} from "../../apps/web/lib/i18n/presentation-design-copy.ts";
import { nativeEditorCopy } from "../../apps/web/components/presentation/native-editor-copy.ts";
import {
  closeE01Overlays,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  openE01Inspector,
  readE01Record,
  selectE01Block,
  type E01Record,
} from "./presentation-e01-support";
import { specialistLocale } from "./option-b-specialist-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 20_000 });

// Independent public expectations keep Playwright's CommonJS collection away from the
// app factory's import-only contracts dependency and catch accidental catalog changes.
const DESIGN_LAYOUTS = [
  "cover",
  "section",
  "body",
  "split",
  "image_left",
  "image_right",
  "data",
  "closing",
] as const satisfies readonly DesignLayoutId[];
const designFamilies = {
  studio: { name: "Studio", theme: "paper" },
  editorial: { name: "Editorial", theme: "paper" },
  midnight: { name: "Midnight", theme: "midnight" },
  blueprint: { name: "Blueprint", theme: "ocean" },
  terracotta: { name: "Terracotta", theme: "sunset" },
  signal: { name: "Signal", theme: "sunset" },
  monograph: { name: "Monograph", theme: "midnight" },
  canvas: { name: "Canvas", theme: "ocean" },
} as const satisfies Record<PresentationDesignId, { name: string; theme: string }>;

function scene(block: PresentationDraft["blocks"][number]): PresentationScene {
  if (block.kind !== "content" || !block.scene) throw new Error("Expected a native content slide");
  return block.scene;
}

function headline(block: PresentationDraft["blocks"][number]) {
  const title = scene(block).nodes.find((node) => node.type === "text" && node.role === "title");
  return title?.type === "text" ? title.text : "";
}

/** Autosave polling can observe the valid pre-conversion snapshot before the new one lands. */
function pollScene(block: PresentationDraft["blocks"][number] | undefined) {
  return block?.kind === "content" ? block.scene : undefined;
}

function pollHeadline(block: PresentationDraft["blocks"][number] | undefined) {
  const title = pollScene(block)?.nodes.find(
    (node) => node.type === "text" && node.role === "title",
  );
  return title?.type === "text" ? title.text : undefined;
}

async function quality(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
}

async function capture(surface: Locator, name: string) {
  await mkdir("artifacts/presentation-designed-collections", { recursive: true });
  await surface.screenshot({
    path: `artifacts/presentation-designed-collections/${name}.png`,
    // A tall element capture can otherwise stitch the sticky workspace header across its middle.
    style: "header[class*='topHeader'] { visibility: hidden !important; }",
  });
}

/** The server accepts the first creation; only its browser acknowledgement is lost. */
async function startDesignAfterLostAcknowledgement(
  page: Page,
  trigger: Locator,
  errorRegion: Locator,
): Promise<E01Record> {
  const endpoint = `${e01ApiUrl}/v1/presentations`;
  const attempts: Array<{ creationRequestId: string; creationContext: unknown }> = [];
  let firstPresentationId = "";
  const intercept = async (route: Route) => {
    if (route.request().method() !== "POST") return route.continue();
    const input = route.request().postDataJSON();
    attempts.push({
      creationRequestId: input.creationRequestId,
      creationContext: input.creationContext,
    });
    if (attempts.length !== 1) return route.continue();
    const accepted = await route.fetch();
    expect(accepted.status(), await accepted.text()).toBe(201);
    firstPresentationId = (await accepted.json()).presentation.id;
    await route.abort("failed");
  };
  await page.route(endpoint, intercept);
  try {
    await trigger.click();
    await expect(errorRegion.getByRole("alert")).toBeVisible();
    expect(attempts).toHaveLength(1);
    expect(firstPresentationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(attempts[0]!.creationRequestId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(attempts[0]!.creationContext).toMatchObject({
      actorId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      workspaceId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    const saving = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === `/v1/presentations/${firstPresentationId}/draft`,
    );
    await trigger.click();
    const saved = await saving;
    expect(saved.status(), await saved.text()).toBe(200);
    const record = (await saved.json()).presentation as E01Record;
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(record.id).toBe(firstPresentationId);
    return record;
  } finally {
    await page.unroute(endpoint, intercept);
  }
}

async function expectArtwork(stage: Locator, theme: string) {
  const artwork = stage.locator("[data-thumbnail-scene]");
  await expect(artwork).toHaveCount(1);
  await expect(artwork).toHaveAttribute("data-native-theme", theme);
  await expect
    .poll(async () => {
      const bounds = await artwork.boundingBox();
      return bounds ? bounds.width / bounds.height : 0;
    })
    .toBeCloseTo(16 / 9, 2);
  expect(await artwork.locator("[data-node-id]").count()).toBeGreaterThan(1);
}

async function openDesign(page: Page, id: PresentationDesignId) {
  const copy = presentationDesignCopy("en-CA");
  await closeE01Overlays(page);
  const trigger = page.locator("[data-presentation-designs]");
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  const panel = page.locator("#presentation-design-library");
  await expect(panel).toBeVisible();
  const family = designFamilies[id];
  await panel
    .locator(`[data-design-card="${id}"]`)
    .getByRole("button", { name: `${copy.preview}: ${family.name}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: `${copy.preview}: ${family.name}`, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

function mixedBlocks(): PresentationDraft["blocks"] {
  const moving = e01Slide("Original moving headline", true);
  moving.scene!.schemaVersion = 8;
  moving.scene!.design = {
    theme: "paper",
    font: "sans",
    spacing: "relaxed",
    motionBackground: "waves",
  };
  for (const node of moving.scene!.nodes) if (node.type === "text") node.lang = "en";
  moving.citations = [{ locator: "Original source", excerpt: "Keep the source excerpt" }];
  const borrowing = e01Slide("Unstyled reading slide");
  borrowing.sourceDisclosure = {
    sourceName: "Original.pdf",
    sourceDigest: "a".repeat(64),
    provider: "Polling Pops",
    model: "visual-import-v1",
  };
  const ordinary: ContentSlideDraft = {
    id: randomUUID(),
    kind: "content",
    layout: "title_body",
    textElements: [
      {
        id: randomUUID(),
        role: "title",
        text: "Ordinary exact title",
        region: "top_center",
        order: 0,
        frame: { x: 9, y: 7, width: 80, height: 21 },
      },
      {
        id: randomUUID(),
        role: "body",
        text: "Keep every word of this ordinary slide.",
        region: "middle_center",
        order: 1,
        frame: { x: 13, y: 36, width: 72, height: 46 },
      },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "PRIVATE ordinary presenter cue",
  };
  return [
    moving,
    borrowing,
    ordinary,
    {
      id: randomUUID(),
      kind: "question",
      question: {
        id: randomUUID(),
        type: "poll",
        prompt: "Which original option should we keep?",
        choices: ["Original option A", "Original option B"].map((label) => ({
          id: randomUUID(),
          label,
          isCorrect: false,
        })),
        purpose: "opinion",
        confidence: "off",
        delivery: "main",
        conceptKeys: [],
        linkedRecheckQuestionId: null,
        timeLimitSeconds: 20,
        basePoints: 0,
        explanation: "",
        maxSelections: 1,
        mediaId: null,
        mediaAlt: null,
      },
    },
  ];
}

for (const suffix of ["", " @mobile"]) {
  test(`designs stay separate from content templates and create editable coordinated decks${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page, undefined, { returnTo: "/templates" });
    await specialistLocale(page, "en-CA");
    await page.goto("/templates");
    const copy = presentationDesignCopy("en-CA");
    const panel = page.locator("#template-panel-designs");
    const tab = page.getByRole("tab", { name: copy.designs, exact: true });
    await expect(page.locator("#template-tab-rounds")).toHaveAttribute("aria-selected", "true");
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(panel.locator("[data-design-card]")).toHaveCount(8);
    expect(
      await panel
        .locator("[data-design-card]")
        .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-design-card"))),
    ).toEqual([
      "studio",
      "editorial",
      "midnight",
      "blueprint",
      "terracotta",
      "signal",
      "monograph",
      "canvas",
    ]);
    await expect(panel.locator("[data-template-id]")).toHaveCount(0);
    await capture(panel, `${info.project.name}-design-catalog-light`);

    await page.locator("#template-tab-presentations").click();
    await expect(
      page.locator('#template-panel-presentations [data-template-id="native-startup-pitch"]'),
    ).toBeVisible();
    await expect(page.locator("[data-design-card]")).toHaveCount(0);
    await tab.click();
    await panel.getByLabel(copy.search, { exact: true }).fill("midnight");
    await expect(panel.locator("[data-design-card]")).toHaveCount(1);
    await expect(panel.locator('[data-design-card="midnight"]')).toBeVisible();
    await panel.getByRole("button", { name: copy.clearFilters, exact: true }).click();
    await panel.getByRole("button", { name: copy.technical, exact: true }).click();
    await expect(panel.locator("[data-design-card]")).toHaveCount(2);
    await expect(panel.locator('[data-design-card="blueprint"]')).toBeVisible();
    await expect(panel.locator('[data-design-card="monograph"]')).toBeVisible();
    await panel.getByRole("button", { name: copy.clearFilters, exact: true }).click();

    const studioButton = panel
      .locator('[data-design-card="studio"]')
      .getByRole("button", { name: `${copy.preview}: Studio`, exact: true });
    await studioButton.press("Enter");
    const dialog = page.getByRole("dialog", { name: `${copy.preview}: Studio`, exact: true });
    await expect(dialog.locator("[data-design-layout]")).toHaveCount(8);
    for (const layout of DESIGN_LAYOUTS) {
      await dialog.locator(`[data-design-layout="${layout}"]`).click();
      const stage = dialog.locator(`[data-design-preview-layout="${layout}"]`);
      await expectArtwork(stage, "paper");
      await expect(stage.locator("h1").first()).toHaveText(
        presentationDesignDraftCopy("studio", "en-CA").slides[layout].title,
      );
      if (layout === "data") await expect(stage.locator('[data-node-type="table"]')).toHaveCount(1);
      if (["cover", "body", "data"].includes(layout))
        await capture(stage, `${info.project.name}-studio-${layout}`);
    }
    await dialog.getByRole("button", { name: copy.close, exact: true }).focus();
    await page.keyboard.press("End");
    await expect(dialog.locator("[data-design-preview]")).toHaveAttribute(
      "data-design-preview-layout",
      "closing",
    );
    await page.keyboard.press("Home");
    await expect(dialog.locator("[data-design-preview]")).toHaveAttribute(
      "data-design-preview-layout",
      "cover",
    );
    await page.keyboard.press("ArrowRight");
    await expect(dialog.locator("[data-design-preview]")).toHaveAttribute(
      "data-design-preview-layout",
      "section",
    );
    // This dialog steps focus explicitly; Alt+Tab deliberately remains a browser/OS shortcut.
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.locator('[data-design-create="studio"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(studioButton).toBeFocused();

    await panel
      .locator('[data-design-card="midnight"]')
      .getByRole("button", { name: `${copy.preview}: Midnight`, exact: true })
      .click();
    const dark = page.getByRole("dialog", { name: `${copy.preview}: Midnight`, exact: true });
    await expectArtwork(dark.locator("[data-design-preview]"), "midnight");
    await quality(page);
    await capture(dark.locator("[data-design-preview]"), `${info.project.name}-midnight-cover`);
    await page.keyboard.press("Escape");

    const locale = suffix ? "ko-KR" : "de-DE";
    await specialistLocale(page, locale);
    await page.goto("/templates");
    const localized = presentationDesignCopy(locale);
    const localizedTab = page.getByRole("tab", { name: localized.designs, exact: true });
    await expect(localizedTab).toBeVisible();
    await localizedTab.click();
    const localizedPreview = page
      .locator('[data-design-card="editorial"]')
      .getByRole("button", { name: `${localized.preview}: Editorial`, exact: true });
    await localizedPreview.click();
    const translated = page.getByRole("dialog", {
      name: `${localized.preview}: Editorial`,
      exact: true,
    });
    await expect(translated).toHaveAttribute("lang", locale);
    await translated.locator('[data-design-layout="body"]').click();
    const translatedStage = translated.locator("[data-design-preview]");
    await expect(translatedStage.locator("h1").first()).toHaveText(
      presentationDesignDraftCopy("editorial", locale).slides.body.title,
    );
    await expect(translatedStage).not.toContainText(
      presentationDesignDraftCopy("editorial", "en-CA").slides.body.title,
    );
    await expectArtwork(translatedStage, "paper");
    await quality(page);
    await capture(translatedStage, `${info.project.name}-${locale}-editorial-body`);
    await page.keyboard.press("Escape");
    await expect(localizedPreview).toBeFocused();

    const record = await startDesignAfterLostAcknowledgement(
      page,
      page.locator('[data-design-card="blueprint"] [data-design-create="blueprint"]'),
      page.locator("#template-panel-designs"),
    );
    await expect(page).toHaveURL(`/presentation/${record.id}`);
    const created = (await readE01Record(page, record.id)).draft;
    expect(created.schemaVersion).toBe(18);
    expect(created.blocks).toHaveLength(8);
    expect(created.blocks.map((block) => scene(block).design)).toEqual(
      Array.from({ length: 8 }, () => ({
        theme: "ocean",
        font: "sans",
        spacing: "compact",
        palette: "cobalt",
      })),
    );
    expect(new Set(created.blocks.map((block) => block.id)).size).toBe(8);
    expect(created.blocks.map(headline)).toEqual(
      DESIGN_LAYOUTS.map(
        (layout) => presentationDesignDraftCopy("blueprint", locale).slides[layout].title,
      ),
    );
    const inspector = page.locator('button[aria-controls="presentation-object-inspector"]');
    if ((await inspector.getAttribute("aria-expanded")) !== "true") await inspector.click();
    await page.locator("#inspector-tab-content").click();
    const editedTitle = `Edited ${locale} design headline`;
    await page
      .getByLabel(nativeEditorCopy(locale)("Native slide title"), { exact: true })
      .fill(editedTitle);
    await expect
      .poll(async () => pollHeadline((await readE01Record(page, record.id)).draft.blocks[0]))
      .toBe(editedTitle);
    await page.reload();
    const persisted = (await readE01Record(page, record.id)).draft;
    expect(persisted.schemaVersion).toBe(18);
    expect(persisted.blocks).toHaveLength(8);
    expect(
      scene(persisted.blocks[0]!).nodes.find(
        (node) => node.type === "text" && node.role === "title",
      ),
    ).toMatchObject({ type: "text", text: editedTitle });
  });

  test(`design style previews preserve mixed decks, undo atomically and insert only a chosen layout${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    await specialistLocale(page, "en-CA");
    const copy = presentationDesignCopy("en-CA");
    const fixture = mixedBlocks();
    const record = await createE01Deck(page, fixture, 17);
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    const initial = record.draft;
    const saved = async () => (await readE01Record(page, record.id)).draft;
    await enterE01Editor(page, record.id, narrow);

    const preview = await openDesign(page, "blueprint");
    await expect(preview.getByRole("combobox", { name: copy.scope, exact: true })).toHaveValue(
      "deck",
    );
    await expectArtwork(preview.locator('[data-design-preview="content"]'), "ocean");
    await expect(preview.locator('[data-node-type="text"]').first()).toHaveText(
      "Original moving headline",
    );
    expect((await readE01Record(page, record.id)).draftRevision).toBe(record.draftRevision);
    expect(await saved()).toEqual(initial);
    await quality(page);
    await capture(
      preview.locator("[data-design-preview]"),
      `${info.project.name}-mixed-content-preview`,
    );
    await preview.locator('[data-design-apply="blueprint"]').click();
    await expect(preview).toHaveCount(0);
    await expect
      .poll(async () => pollScene((await saved()).blocks[2])?.design?.theme)
      .toBe("ocean");
    const styled = await saved();
    expect(styled.schemaVersion).toBe(18);
    expect(styled.blocks.map((block) => block.id)).toEqual(initial.blocks.map((block) => block.id));
    for (const index of [0, 1]) {
      const original = initial.blocks[index]!;
      const updated = styled.blocks[index]!;
      expect(scene(updated).nodes).toEqual(scene(original).nodes);
      expect(scene(updated).readingOrder).toEqual(scene(original).readingOrder);
      expect({ ...updated, scene: undefined }).toEqual({ ...original, scene: undefined });
    }
    expect(styled.blocks[3]).toEqual(initial.blocks[3]);
    for (const block of styled.blocks.slice(0, 3))
      expect(scene(block).design).toEqual({
        theme: "ocean",
        font: "sans",
        spacing: "compact",
        palette: "cobalt",
        motionBackground: "waves",
      });
    const ordinary = initial.blocks[2] as ContentSlideDraft;
    for (const element of ordinary.textElements)
      expect(scene(styled.blocks[2]!).nodes).toContainEqual({
        id: element.id,
        type: "text",
        role: element.role,
        text: element.text,
        frame: element.frame,
      });
    expect((styled.blocks[2] as ContentSlideDraft).speakerNotes).toBe(ordinary.speakerNotes);
    expect((styled.blocks[2] as ContentSlideDraft).textElements).toEqual([]);

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await saved()).blocks).toEqual(initial.blocks);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(async () => (await saved()).blocks).toEqual(styled.blocks);
    await page.reload();
    if (narrow) await closeE01Overlays(page);
    expect((await saved()).blocks).toEqual(styled.blocks);

    const current = await openDesign(page, "terracotta");
    await current.getByRole("combobox", { name: copy.scope, exact: true }).selectOption("slide");
    await expectArtwork(current.locator("[data-design-preview]"), "sunset");
    await current.locator('[data-design-apply="terracotta"]').click();
    await expect
      .poll(async () => pollScene((await saved()).blocks[0])?.design?.theme)
      .toBe("sunset");
    const isolated = await saved();
    expect(scene(isolated.blocks[0]!).design).toEqual({
      theme: "sunset",
      font: "serif",
      spacing: "relaxed",
      palette: "clay",
      motionBackground: "waves",
    });
    expect(scene(isolated.blocks[0]!).nodes).toEqual(scene(initial.blocks[0]!).nodes);
    expect(isolated.blocks.slice(1)).toEqual(styled.blocks.slice(1));

    const insert = await openDesign(page, "studio");
    await insert.getByRole("button", { name: copy.layoutSamples, exact: true }).click();
    await insert.locator('[data-design-layout="split"]').click();
    await expectArtwork(insert.locator("[data-design-preview]"), "paper");
    await insert.locator('[data-design-insert="split"]').click();
    await expect.poll(async () => (await saved()).blocks.length).toBe(5);
    const expanded = await saved();
    const inserted = expanded.blocks[1]!;
    expect(expanded.schemaVersion).toBe(18);
    expect(expanded.blocks.filter((block) => block.id !== inserted.id)).toEqual(isolated.blocks);
    expect(scene(inserted).design).toEqual({
      theme: "paper",
      font: "sans",
      spacing: "relaxed",
      palette: "cobalt",
    });
    expect(
      scene(inserted).nodes.filter((node) => node.type === "text").length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      scene(inserted).nodes.find((node) => node.type === "text" && node.role === "title"),
    ).toMatchObject({
      type: "text",
      text: presentationDesignDraftCopy("studio", "en-CA").slides.split.title,
    });
    expect(initial.blocks.every((block) => block.id !== inserted.id)).toBe(true);
    await page.reload();
    if (narrow) await closeE01Overlays(page);
    expect((await saved()).blocks).toEqual(expanded.blocks);

    await selectE01Block(page, "Which original option should we keep?", narrow);
    const activity = await openDesign(page, "midnight");
    const currentSlideOption = activity
      .getByRole("combobox", { name: copy.scope, exact: true })
      .locator('option[value="slide"]');
    await expect(currentSlideOption).toHaveAttribute("disabled", "");
    expect(await currentSlideOption.evaluate((option: HTMLOptionElement) => option.disabled)).toBe(
      true,
    );
    await expect(activity.locator('[data-design-apply="midnight"]')).toBeEnabled();
    await page.keyboard.press("Escape");
    expect((await saved()).blocks).toEqual(expanded.blocks);

    await selectE01Block(
      page,
      presentationDesignDraftCopy("studio", "en-CA").slides.split.title,
      narrow,
    );
    const switchCollection = await openDesign(page, "editorial");
    await switchCollection
      .getByRole("combobox", { name: copy.scope, exact: true })
      .selectOption("slide");
    await switchCollection.locator('[data-design-apply="editorial"]').click();
    await expect.poll(async () => pollScene((await saved()).blocks[1])?.design?.font).toBe("serif");
    const restyled = scene((await saved()).blocks[1]!);
    expect(
      restyled.nodes
        .filter((node) => node.type === "text")
        .every((node) => node.typography?.font === undefined),
    ).toBe(true);
    expect(restyled.nodes.map((node) => (node.type === "connector" ? null : node.frame))).toEqual(
      scene(inserted).nodes.map((node) => (node.type === "connector" ? null : node.frame)),
    );
    const title = page.locator('[data-native-scene="true"] h1').first();
    await expect
      .poll(() => title.evaluate((node) => getComputedStyle(node).fontFamily))
      .toContain("Georgia");
  });

  test(`failed design creation can start another while preserving the previously edited target${suffix}`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page, undefined, { returnTo: "/templates" });
    await specialistLocale(page, "en-CA");
    await page.goto("/templates");
    const copy = presentationDesignCopy("en-CA");
    await page.getByRole("tab", { name: copy.designs, exact: true }).click();
    const panel = page.locator("#template-panel-designs");
    const start = panel.locator('[data-design-create="blueprint"]');
    const restart = panel.locator('[data-design-restart="blueprint"]');
    const creationEndpoint = `${e01ApiUrl}/v1/presentations`;
    const draftEndpoint = `${e01ApiUrl}/v1/presentations/*/draft`;
    const creations: Array<{
      id: string;
      creationRequestId: string;
      creationContext: unknown;
    }> = [];
    const draftAttempts: Array<{ id: string; mutation: PresentationDraftMutation }> = [];
    const acceptCreation = async (route: Route) => {
      if (route.request().method() !== "POST") return route.continue();
      const request = route.request().postDataJSON();
      const accepted = await route.fetch();
      expect(accepted.status(), await accepted.text()).toBe(201);
      const record = (await accepted.json()).presentation as E01Record;
      creations.push({
        id: record.id,
        creationRequestId: request.creationRequestId,
        creationContext: request.creationContext,
      });
      await route.fulfill({ response: accepted });
    };
    const failFirstDraft = async (route: Route) => {
      if (route.request().method() !== "PUT") return route.continue();
      draftAttempts.push({
        id: new URL(route.request().url()).pathname.split("/")[3]!,
        mutation: route.request().postDataJSON() as PresentationDraftMutation,
      });
      // The shell is real, but its initial design has not been written when the browser fails.
      if (draftAttempts.length === 1) await route.abort("failed");
      else await route.continue();
    };
    await page.route(creationEndpoint, acceptCreation);
    await page.route(draftEndpoint, failFirstDraft);
    try {
      await start.click();
      await expect(panel.getByRole("alert")).toBeVisible();
      await expect(restart).toBeVisible();
      expect(creations).toHaveLength(1);
      expect(draftAttempts).toHaveLength(1);
      expect(draftAttempts[0]!.mutation.expectedRevision).toBe(0);
      const originalId = creations[0]!.id;
      expect(draftAttempts[0]!.id).toBe(originalId);
      const original = await readE01Record(page, originalId);
      expect(original.draftRevision).toBe(0);

      // This is a real second editor's save, outside page interception: retry must respect it.
      const replacement = {
        ...original.draft,
        title: "Keep this independently edited draft",
        schemaVersion: 5,
        blocks: [e01Slide("An existing target edited elsewhere", true)],
      };
      const advanced = await page.request.put(`${e01ApiUrl}/v1/presentations/${originalId}/draft`, {
        data: {
          draft: replacement,
          expectedRevision: original.draftRevision,
          mutationId: randomUUID(),
          schemaVersion: 2,
        },
      });
      expect(advanced.status(), await advanced.text()).toBe(200);
      const edited = (await advanced.json()).presentation as E01Record;
      expect(edited.draftRevision).toBe(1);

      const conflicting = page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          new URL(response.url()).pathname === `/v1/presentations/${originalId}/draft`,
      );
      await start.click();
      const conflict = await conflicting;
      expect(conflict.status(), await conflict.text()).toBe(409);
      await expect(panel.getByRole("alert")).toBeVisible();
      expect(creations).toHaveLength(1);
      expect(draftAttempts).toHaveLength(2);
      expect(draftAttempts[1]).toEqual(draftAttempts[0]);
      expect((await readE01Record(page, originalId)).draft).toEqual(edited.draft);

      const freshSave = page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          /\/v1\/presentations\/[^/]+\/draft$/.test(new URL(response.url()).pathname) &&
          new URL(response.url()).pathname !== `/v1/presentations/${originalId}/draft`,
      );
      await restart.click();
      const saved = await freshSave;
      expect(saved.status(), await saved.text()).toBe(200);
      const fresh = (await saved.json()).presentation as E01Record;
      await expect(page).toHaveURL(`/presentation/${fresh.id}`);
      expect(creations).toHaveLength(2);
      expect(creations[1]!.id).toBe(fresh.id);
      expect(fresh.id).not.toBe(originalId);
      expect(creations[1]!.creationRequestId).not.toBe(creations[0]!.creationRequestId);
      expect(creations[1]!.creationContext).toEqual(creations[0]!.creationContext);
      expect(draftAttempts).toHaveLength(3);
      expect(draftAttempts[2]!.id).toBe(fresh.id);
      expect(draftAttempts[2]!.mutation.expectedRevision).toBe(0);
      expect(draftAttempts[2]!.mutation.mutationId).not.toBe(draftAttempts[0]!.mutation.mutationId);
      expect(fresh.draft.schemaVersion).toBe(18);
      expect(fresh.draft.blocks).toHaveLength(8);
      expect(fresh.draft.blocks.map((block) => scene(block).design)).toEqual(
        Array.from({ length: 8 }, () => ({
          theme: "ocean",
          font: "sans",
          spacing: "compact",
          palette: "cobalt",
        })),
      );
      const retained = await readE01Record(page, originalId);
      expect(retained.draftRevision).toBe(edited.draftRevision);
      expect(retained.draft).toEqual(edited.draft);
    } finally {
      await page.unroute(creationEndpoint, acceptCreation);
      await page.unroute(draftEndpoint, failFirstDraft);
    }
  });

  test(`collection object colors and formatted reading colors remain usable${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page, undefined, { returnTo: "/templates" });
    await specialistLocale(page, "en-CA");
    await page.goto("/templates");
    const copy = presentationDesignCopy("en-CA");
    await page.getByRole("tab", { name: copy.designs, exact: true }).click();
    await page.locator('[data-design-card="signal"] [data-design-create="signal"]').click();
    await expect(page).toHaveURL(/\/presentation\/[\da-f-]+$/);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    let record = await readE01Record(page, id);
    const coverTitle = headline(record.draft.blocks[0]!);
    const bodyBlock = record.draft.blocks[2]!;
    const bodyScene = scene(bodyBlock);
    const body = bodyScene.nodes.find(
      (node) => node.type === "text" && node.typography?.color === "accentText",
    );
    const marker = scene(record.draft.blocks[0]!).nodes.find(
      (node) => node.type === "shape" && node.appearance?.fill === "background",
    );
    if (!body || body.type !== "text" || !marker || marker.type !== "shape")
      throw new Error("Expected real Signal collection objects");
    const bodyTitle = headline(bodyBlock);
    const imageBlock = record.draft.blocks[4]!;
    const imageTitle = headline(imageBlock);
    const placeholder = scene(imageBlock).nodes.find(
      (node) => node.type === "shape" && !node.decorative,
    );
    if (!placeholder || placeholder.type !== "shape")
      throw new Error("Expected a labeled placeholder");
    // A real local interaction exposes the reader's accessible-outline switch.
    bodyScene.nodes.push({
      id: "reader-details",
      type: "reveal",
      scope: "local",
      label: "Read supporting detail",
      body: "Public supporting detail",
      frame: { x: 7, y: 91, width: 60, height: 7 },
    });
    bodyScene.readingOrder.push("reader-details");
    const seeded = await page.request.put(`${e01ApiUrl}/v1/presentations/${id}/draft`, {
      data: {
        draft: record.draft,
        expectedRevision: record.draftRevision,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    await page.reload();
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    if (narrow) await closeE01Overlays(page);
    let inspector = await openE01Inspector(page, "Content");
    await inspector
      .getByRole("combobox", { name: "Selected object", exact: true })
      .selectOption(marker.id);
    await inspector
      .getByRole("combobox", { name: "Object color", exact: true })
      .selectOption("orange");
    await expect
      .poll(async () =>
        scene((await readE01Record(page, id)).draft.blocks[0]!).nodes.find(
          (node) => node.id === marker.id,
        ),
      )
      .toMatchObject({ color: "orange", appearance: { stroke: "none", strokeWidth: 0 } });
    const paint = page.locator(`[data-native-scene-canvas] [data-node-id="${marker.id}"] svg path`);
    await expect(paint).toHaveAttribute("fill", "#ffdbb5");
    await selectE01Block(page, imageTitle, narrow);
    inspector = await openE01Inspector(page, "Content");
    await inspector
      .getByRole("combobox", { name: "Selected object", exact: true })
      .selectOption(placeholder.id);
    const objectColor = inspector.getByRole("combobox", { name: "Object color", exact: true });
    await expect(objectColor).toHaveValue("palette");
    await objectColor.selectOption("black");
    const labeledShape = page.locator(
      `[data-native-scene-canvas] [data-node-id="${placeholder.id}"]`,
    );
    await expect(labeledShape.locator("svg path")).toHaveAttribute("fill", "#3b4351");
    await expect(labeledShape.locator('[role="img"] > span')).toHaveCSS(
      "color",
      "rgb(255, 255, 255)",
    );
    await expect
      .poll(async () =>
        scene((await readE01Record(page, id)).draft.blocks[4]!).nodes.find(
          (node) => node.id === placeholder.id,
        ),
      )
      .toMatchObject({ color: "black", appearance: { strokeWidth: 1 } });
    await page.reload();
    if (narrow) await closeE01Overlays(page);
    await selectE01Block(page, coverTitle, narrow);
    await expect(paint).toHaveAttribute("fill", "#ffdbb5");
    await selectE01Block(page, bodyTitle, narrow);
    inspector = await openE01Inspector(page, "Content");
    await inspector
      .getByRole("combobox", { name: "Selected object", exact: true })
      .selectOption(body.id);
    await inspector.getByRole("button", { name: "Format text", exact: true }).click();
    const text = inspector.getByRole("textbox", { name: "Node text", exact: true });
    await text.focus();
    await text.evaluate((node) => (node as HTMLTextAreaElement).setSelectionRange(0, 4));
    await text.press("Shift");
    await inspector.getByRole("button", { name: "Bold", exact: true }).click();
    await inspector.getByRole("button", { name: "Italic", exact: true }).click();
    await expect
      .poll(async () =>
        JSON.stringify(
          scene((await readE01Record(page, id)).draft.blocks[2]!).nodes.find(
            (node) => node.id === body.id,
          ),
        ),
      )
      .toContain('"italic":true');
    const canvasText = page.locator(`[data-native-scene-canvas] [data-node-id="${body.id}"] p`);
    // Narrow editors use the same semantic reading layout as mobile readers.
    const expected = narrow ? "rgb(37, 26, 25)" : "rgb(255, 247, 239)";
    await expect(canvasText).toHaveCSS("color", expected);
    await expect(canvasText.locator("strong")).toHaveCSS("color", expected);
    record = await readE01Record(page, id);
    const published = await page.request.post(`${e01ApiUrl}/v1/presentations/${id}/publish`, {
      data: { expectedDraftRevision: record.draftRevision },
    });
    expect(published.status(), await published.text()).toBe(200);
    const versionId = (await published.json()).version.id;
    const token = randomBytes(32).toString("base64url");
    const shared = await page.request.post(`${e01ApiUrl}/v1/presentations/${id}/shares`, {
      data: {
        token,
        requestId: randomUUID(),
        versionId,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(shared.ok(), await shared.text()).toBe(true);
    const share = await shared.json();
    const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
    const context = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    try {
      const reader = await context.newPage();
      await reader.goto(share.url);
      const current = reader.getByRole("region", {
        name: "Current presentation page",
        exact: true,
      });
      await expect(current.locator(`[data-node-id="${marker.id}"] svg path`)).toHaveAttribute(
        "fill",
        "#ffdbb5",
      );
      await reader
        .getByRole("navigation", { name: "Presentation pages", exact: true })
        .getByRole("button")
        .filter({ hasText: imageTitle })
        .click();
      const readerShape = current.locator(`[data-node-id="${placeholder.id}"]`);
      await expect(readerShape.locator("svg path")).toHaveAttribute("fill", "#3b4351");
      await expect(readerShape.locator('[role="img"] > span')).toHaveCSS(
        "color",
        "rgb(255, 255, 255)",
      );
      await reader
        .getByRole("navigation", { name: "Presentation pages", exact: true })
        .getByRole("button")
        .filter({ hasText: bodyTitle })
        .click();
      const paragraph = current.locator(`[data-node-id="${body.id}"] p`);
      await expect(paragraph).toHaveCSS("color", expected);
      await expect(paragraph.locator("strong")).toHaveCSS("color", expected);
      await expect(paragraph.locator("em")).toHaveCSS("color", expected);
      await current.getByRole("button", { name: "Show accessible outline", exact: true }).click();
      for (const text of [paragraph, paragraph.locator("strong"), paragraph.locator("em")])
        await expect(text).toHaveCSS("color", "rgb(37, 26, 25)");
      await quality(reader);
      await current.getByRole("button", { name: "Show slide layout", exact: true }).click();
      await expect(paragraph).toHaveCSS("color", expected);
    } finally {
      await context.close();
    }
  });

  test(`designed collections render distinct covers and fitted coordinated interiors${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page, undefined, { returnTo: "/templates" });
    await specialistLocale(page, "en-CA");
    await page.goto("/templates");
    const copy = presentationDesignCopy("en-CA");
    await page.getByRole("tab", { name: copy.designs, exact: true }).click();
    const panel = page.locator("#template-panel-designs");
    const signatures = new Set<string>();
    const overflow: unknown[] = [];
    for (const [id, family] of Object.entries(designFamilies)) {
      await panel
        .locator(`[data-design-card="${id}"]`)
        .getByRole("button", { name: `${copy.preview}: ${family.name}`, exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: `${copy.preview}: ${family.name}`,
        exact: true,
      });
      const stage = dialog.locator("[data-design-preview]");
      for (const layout of DESIGN_LAYOUTS) {
        await dialog.locator(`[data-design-layout="${layout}"]`).click();
        await expect(stage).toHaveAttribute("data-design-preview-layout", layout);
        const artwork = stage.locator("[data-thumbnail-scene]");
        await expect(artwork).toHaveAttribute("data-native-palette", /.+/);
        const fit = await artwork.locator("h1,p").evaluateAll((nodes) =>
          nodes
            .map((node) => ({
              text: node.textContent,
              overflowY: node.scrollHeight - node.clientHeight,
              overflowX: node.scrollWidth - node.clientWidth,
              font: getComputedStyle(node).fontSize,
              leading: getComputedStyle(node).lineHeight,
              padding: getComputedStyle(node).padding,
              height: node.clientHeight,
            }))
            .filter((node) => node.overflowY > 2 || node.overflowX > 2),
        );
        if (fit.length) overflow.push({ id, layout, nodes: fit });
        if (layout === "cover") {
          const hero = await artwork.locator("h1").evaluate((node) => {
            const stage = node.closest("[data-thumbnail-scene]")!;
            return {
              size: parseFloat(getComputedStyle(node).fontSize),
              width: (stage as HTMLElement).clientWidth,
            };
          });
          expect((hero.size / hero.width) * 1280, `${id} cover typography`).toBeGreaterThanOrEqual(
            60,
          );
          signatures.add(
            await artwork
              .locator("[data-node-id]")
              .evaluateAll((nodes) =>
                JSON.stringify(nodes.map((node) => node.getAttribute("data-frame"))),
              ),
          );
          await capture(stage, `${info.project.name}-${id}-designed-cover`);
        }
      }
      await quality(page);
      await page.keyboard.press("Escape");
    }
    await mkdir("artifacts/presentation-designed-collections", { recursive: true });
    await writeFile(
      `artifacts/presentation-designed-collections/${info.project.name}-layout-fit.json`,
      JSON.stringify(overflow, null, 2),
    );
    if (info.project.name === "chromium-beta") {
      await page.setViewportSize({ width: 1728, height: 1080 });
      await quality(page);
    }
    await capture(panel, `${info.project.name}-designed-collections-catalog`);
    expect(overflow, "All authored template text must fit its frames").toEqual([]);
    expect(signatures.size).toBe(8);
  });
}
