import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { ContentSlideDraft } from "../../packages/contracts/src/index.ts";
import nativeContent from "../../apps/web/lib/presentation-native-template-content.json";
import { signInBeta } from "./sign-in";
import {
  clickEditorAction,
  closeE01Overlays,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  openE01Inspector,
  openEditorActions,
  readE01Record,
  selectE01Body,
  type E01Record,
} from "./presentation-e01-support";

test.use({ actionTimeout: 30_000 });

const privateMarker = "PRIVATE UX facilitator decision notes";

function firstSlide(record: E01Record): ContentSlideDraft {
  const slide = record.draft.blocks[0];
  if (slide?.kind !== "content" || !slide.scene) throw new Error("Expected a native slide");
  return slide;
}

function bodyText(record: E01Record) {
  const body = firstSlide(record).scene!.nodes.find(
    (node) => node.type === "text" && node.role === "body",
  );
  if (body?.type !== "text") throw new Error("Expected an editable body object");
  return body.text;
}

async function professionalDeck(page: Page) {
  // Reuse original fictional professional copy in a small native fixture; the gallery journey
  // exercises full template instantiation. No remote media or authoring provider is involved.
  const source = nativeContent.find((template) => template.id === "native-project-update")!;
  const blocks = source.slides.map((copy) => {
    const slide = e01Slide(copy.title);
    const body = slide.scene!.nodes[1];
    if (body?.type !== "text") throw new Error("Expected a body object");
    body.text = copy.body;
    slide.scene!.schemaVersion = 3;
    slide.scene!.design = { theme: "ocean", font: "sans", spacing: "relaxed" };
    slide.speakerNotes = copy.notes;
    return slide;
  });
  blocks[0]!.speakerNotes = `${privateMarker}. Confirm the next owner privately.`;
  const created = await page.request.post(`${e01ApiUrl}/v1/presentations`, {
    data: { title: source.title, description: source.description },
  });
  expect(created.status()).toBe(201);
  const record = (await created.json()).presentation as E01Record;
  const saved = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
    data: {
      draft: { ...record.draft, schemaVersion: 7, blocks },
      expectedRevision: record.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(saved.status(), await saved.text()).toBe(200);
  return (await saved.json()).presentation as E01Record;
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(violations).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
}

for (const suffix of ["", " @mobile"]) {
  test(`creation filters recover from no matches and open a private professional workspace${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    await page.setViewportSize(narrow ? { width: 390, height: 844 } : { width: 1280, height: 720 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page, undefined, { returnTo: "/create/presentation" });
    await expect(page.getByRole("button", { name: /^Start blank/ })).toBeVisible();
    await expectAccessible(page);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ scale: "css", path: info.outputPath("creation-start.png") });

    const search = page.getByRole("searchbox", {
      name: "Search presentation templates",
      exact: true,
    });
    const filters = page.getByRole("group", { name: "Filter templates by use case", exact: true });
    const results = page.locator("#presentation-template-results");
    const allCards = await results.getByRole("article").count();
    expect(allCards).toBeGreaterThan(2);
    await filters.getByRole("button", { name: "Pitch & propose", exact: true }).click();
    await expect(
      filters.getByRole("button", { name: "Pitch & propose", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(results.getByRole("article")).toHaveCount(2);
    await search.fill("no-workspace-template-matches-this-phrase");
    await expect(results.getByRole("article")).toHaveCount(0);
    await expect(
      page.getByText("Try another search or clear the filters to see every template.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(
      filters.getByRole("button", { name: "All templates", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(results.getByRole("article")).toHaveCount(allCards);
    await search.fill("startup pitch");
    await expect(results.getByRole("article")).toHaveCount(1);
    await search.scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      scale: "css",
      path: info.outputPath("creation-filtered-template.png"),
    });

    const card = results.locator('[data-template-id="native-startup-pitch"]');
    const previewButton = card.getByRole("button", { name: "Preview structure", exact: true });
    await previewButton.click();
    const preview = page.getByRole("dialog", {
      name: "Presentation template preview",
      exact: true,
    });
    await expect(
      preview.getByRole("heading", {
        name: "A repair request should become an owned next step",
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(previewButton).toBeFocused();

    const saving = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        /\/v1\/presentations\/[^/]+\/draft$/.test(new URL(response.url()).pathname),
    );
    await card.getByRole("button", { name: "Use presentation template", exact: true }).click();
    const saved = await saving;
    expect(saved.status(), await saved.text()).toBe(200);
    const record = (await saved.json()).presentation as E01Record & {
      currentVersionId: string | null;
    };
    await expect(page).toHaveURL(`/presentation/${record.id}`);
    expect(record.currentVersionId).toBeNull();
    expect(
      record.draft.blocks.every((block) => block.kind === "content" && Boolean(block.scene)),
    ).toBe(true);
    await expect(page.locator("[data-native-scene]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Present", exact: true })).toBeDisabled();
    if (narrow) {
      await expect(page.locator("#presentation-slide-navigator")).toBeHidden();
      await expect(page.locator("#presentation-object-inspector")).toBeHidden();
    } else {
      await expect(page.locator("#presentation-slide-navigator")).toBeVisible();
      await expect(page.locator("#presentation-object-inspector")).toBeVisible();
    }
    await expectAccessible(page);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      scale: "css",
      path: info.outputPath("professional-workspace-created.png"),
    });
  });

  test(`contextual inspector preserves selection, pending media text and private-note history${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    await page.setViewportSize(narrow ? { width: 390, height: 844 } : { width: 1280, height: 720 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const record = await professionalDeck(page);
    const original = firstSlide(record);
    const body = original.scene!.nodes.find((node) => node.type === "text" && node.role === "body");
    if (body?.type !== "text") throw new Error("Expected a body object");
    await enterE01Editor(page, record.id, narrow);
    await selectE01Body(page);
    const inspector = page.locator("#presentation-object-inspector");
    const selected = inspector.getByRole("combobox", { name: "Selected object", exact: true });
    const revised =
      "Synthetic delivery review: agree the next owner, date and evidence before moving on.";
    await inspector.getByRole("textbox", { name: "Node text", exact: true }).fill(revised);
    await expect.poll(async () => bodyText(await readE01Record(page, record.id))).toBe(revised);
    await openE01Inspector(page, "Layout");
    await expect(selected).toHaveValue(body.id);
    await inspector
      .getByRole("combobox", { name: "Base color theme", exact: true })
      .selectOption("midnight");
    await expect
      .poll(async () => firstSlide(await readE01Record(page, record.id)).scene!.design?.theme)
      .toBe("midnight");
    await expectAccessible(page);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      scale: "css",
      path: info.outputPath("contextual-layout-inspector.png"),
    });

    await openE01Inspector(page, "Media");
    const mediaDescription = "Unsubmitted synthetic release checklist image";
    await inspector
      .getByRole("textbox", { name: "New image description", exact: true })
      .fill(mediaDescription);
    await openE01Inspector(page, "Notes");
    const revisedNotes = `${privateMarker}. Ask the sponsor about the unresolved dependency.`;
    await inspector.getByRole("textbox", { name: "Speaker notes", exact: true }).fill(revisedNotes);
    await expect
      .poll(async () => firstSlide(await readE01Record(page, record.id)).speakerNotes)
      .toBe(revisedNotes);
    await inspector.getByRole("tab", { name: /^Ready/ }).click();
    await openE01Inspector(page, "Media");
    await expect(
      inspector.getByRole("textbox", { name: "New image description", exact: true }),
    ).toHaveValue(mediaDescription);
    await expect(selected).toHaveValue(body.id);
    await openE01Inspector(page, "Content");
    await expect(inspector.getByRole("textbox", { name: "Node text", exact: true })).toHaveValue(
      revised,
    );

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(inspector).toBeVisible();
    await expect
      .poll(async () => firstSlide(await readE01Record(page, record.id)).speakerNotes)
      .toBe(original.speakerNotes);
    expect(bodyText(await readE01Record(page, record.id))).toBe(revised);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(inspector).toBeVisible();
    await expect
      .poll(async () => firstSlide(await readE01Record(page, record.id)).speakerNotes)
      .toBe(revisedNotes);
    await openE01Inspector(page, "Content");
    await expect(selected).toHaveValue(body.id);
    if (narrow) await closeE01Overlays(page);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
    await expect(preview.getByText(revised, { exact: true })).toBeVisible();
    await expect(preview).not.toContainText(privateMarker);
    await expect(preview).not.toContainText(mediaDescription);
    await page.screenshot({
      scale: "css",
      path: info.outputPath("audience-preview-without-private-notes.png"),
    });
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    const latest = await page.request.get(`${e01ApiUrl}/v1/presentations/${record.id}`);
    expect(latest.status()).toBe(200);
    expect((await latest.json()).presentation.currentVersionId).toBeNull();
  });
}

test("phone workspace keeps the canvas first and restores focus through drawers and More @mobile", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInBeta(page);
  const record = await professionalDeck(page);
  const published = await page.request.post(`${e01ApiUrl}/v1/presentations/${record.id}/publish`, {
    data: { expectedDraftRevision: record.draftRevision },
  });
  expect(published.status(), await published.text()).toBe(200);
  await page.goto(`/presentation/${record.id}`);
  const map = page.locator("#presentation-slide-navigator");
  const inspector = page.locator("#presentation-object-inspector");
  const mapTrigger = page.getByRole("button", { name: "Open map", exact: true });
  const inspectorTrigger = page.getByRole("button", { name: "Open inspector", exact: true });
  await expect(page.locator("[data-native-scene]")).toBeVisible();
  await expect(map).toBeHidden();
  await expect(inspector).toBeHidden();
  await expect(mapTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(inspectorTrigger).toHaveAttribute("aria-expanded", "false");
  const header = await page.getByRole("banner").boundingBox();
  expect(header).not.toBeNull();
  expect(header!.height).toBeLessThanOrEqual(128);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ scale: "css", path: info.outputPath("phone-canvas-first.png") });

  await mapTrigger.focus();
  await mapTrigger.press("Enter");
  await expect(map).toBeVisible();
  await expect(inspector).toBeHidden();
  await expect(map.getByRole("button", { name: "New slide", exact: true })).toBeVisible();
  await page.screenshot({ scale: "css", path: info.outputPath("phone-slide-navigator.png") });
  await page.keyboard.press("Escape");
  await expect(map).toBeHidden();
  await expect(mapTrigger).toBeFocused();

  await inspectorTrigger.focus();
  await inspectorTrigger.press("Enter");
  await expect(inspector).toBeVisible();
  await expect(map).toBeHidden();
  await selectE01Body(page);
  await expect(inspector.getByRole("textbox", { name: "Node text", exact: true })).toHaveValue(
    bodyText(record),
  );
  await expectAccessible(page);
  await page.screenshot({ scale: "css", path: info.outputPath("phone-content-inspector.png") });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  try {
    await expect
      .poll(async () => {
        const [bar, drawer] = await Promise.all([
          page.getByRole("banner").boundingBox(),
          inspector.boundingBox(),
        ]);
        return bar && drawer ? Math.abs(drawer.y - (bar.y + bar.height)) : Infinity;
      })
      .toBeLessThanOrEqual(2);
  } finally {
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });
  }
  await page.keyboard.press("Escape");
  await expect(inspector).toBeHidden();
  await expect(inspectorTrigger).toBeFocused();

  await inspectorTrigger.press("Enter");
  await expect(inspector).toBeVisible();
  const more = page.locator('summary[aria-label="More options"]');
  await more.click();
  await expect(inspector).toBeHidden();
  await expect(map).toBeHidden();
  await openEditorActions(page);
  for (const name of ["Assign reading", "Assign practice", "Export presentation", "Arrange space"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ scale: "css", path: info.outputPath("phone-more-options.png") });
  await clickEditorAction(page, "Assign reading");
  const assignment = page.getByRole("dialog", { name: "Assign a reading assignment", exact: true });
  await expect(assignment).toBeVisible();
  await expect(
    assignment.getByRole("combobox", { name: "Reading deadline", exact: true }),
  ).toBeEnabled();
  await assignment.getByRole("button", { name: "Close", exact: true }).click();
  await expect(assignment).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Assign reading", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more.locator("xpath=ancestor::details[1]")).not.toHaveAttribute("open", "");
  await expect(more).toBeFocused();
  await expect(page.locator("[data-native-scene]")).not.toContainText(privateMarker);
  await expectNoHorizontalOverflow(page);
});
