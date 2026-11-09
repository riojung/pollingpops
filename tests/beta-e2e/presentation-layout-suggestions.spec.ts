import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  presentationTextAssistanceSourceDigest,
  type ContentSlideDraft,
  type PresentationScene,
} from "../../packages/contracts/src/index.ts";
import {
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  closeE01Overlays,
  openE01Inspector,
  readE01Record,
  selectE01Block,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 30_000 });
const bodyText = "Decide together\nAssign an owner\nReview the brief";
function slide(table = false): ContentSlideDraft {
  const block = e01Slide(table ? "Compare next steps" : "Review the next step", true);
  block.speakerNotes = "PRIVATE layout review speaker cue";
  block.citations = [{ locator: "Original source", excerpt: "Original source wording" }];
  block.sourceDisclosure = {
    sourceName: "Original import",
    sourceDigest: "a".repeat(64),
    provider: "original-provider",
    model: "visual-import-v1",
  };
  const scene = block.scene!;
  scene.schemaVersion = 6;
  scene.design = { theme: "midnight", font: "serif", spacing: "compact" };
  const title = scene.nodes[0]!;
  const body = scene.nodes[1]!;
  if (title.type !== "text" || body.type !== "text") throw new Error("Expected text");
  title.frame = { x: 8, y: 4, width: 84, height: 4 };
  body.text = bodyText;
  body.richText = {
    paragraphs: [
      { kind: "paragraph", runs: [{ text: "Decide", bold: true }, { text: " together" }] },
      { kind: "bullet", runs: [{ text: "Assign an owner", italic: true }] },
      { kind: "numbered", runs: [{ text: "Review the brief", href: "https://example.com/brief" }] },
    ],
  };
  body.frame = { x: 18, y: 40, width: 48, height: 4 };
  block.textAssistance = {
    schemaVersion: 1,
    nodeId: body.id,
    role: "body",
    operation: "rewrite",
    sourceDigest: "b".repeat(64),
    outputDigest: presentationTextAssistanceSourceDigest(bodyText),
    provider: "prior-provider",
    model: "prior-text-edit",
    generatedAt: "2026-11-06T12:00:00.000Z",
    reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  };
  if (table) {
    scene.nodes.push({
      id: "Table:ExactCase",
      type: "table",
      caption: "Illustrative next steps",
      headers: ["Plan", "Scope", "Decision"],
      rows: [
        ["Alpha", "Small pilot", "Review next week"],
        ["Beta", "Broader pilot", "Wait for evidence"],
      ],
      frame: { x: 12, y: 50, width: 50, height: 10 },
    });
    scene.readingOrder.push("Table:ExactCase");
  }
  return block;
}
function scene(record: Awaited<ReturnType<typeof readE01Record>>) {
  const block = record.draft.blocks[0];
  if (block?.kind !== "content" || !block.scene) throw new Error("Expected native slide");
  return block.scene;
}
function withoutFrames(value: PresentationScene) {
  return {
    ...value,
    nodes: value.nodes.map((node) => {
      if (node.type === "connector") return node;
      const { frame, ...content } = node;
      void frame;
      return content;
    }),
  };
}
async function openSuggestions(page: Page) {
  await openE01Inspector(page, "Layout");
  await page.getByRole("button", { name: "Suggest layouts", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review layout suggestions", exact: true });
  await expect(dialog).toBeVisible();
  const radio = dialog.getByRole("radio").first();
  await expect(radio).toBeVisible();
  await expect(radio).toHaveCSS("width", "20px");
  await expect(radio.locator("..")).toHaveCSS("display", "flex");
  return dialog;
}
async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
}
async function availability(page: Page, presentationId: string) {
  const result = await page.request.get(
    `${e01ApiUrl}/v1/presentation-text-assistance/status?presentationId=${presentationId}`,
  );
  expect(result.status()).toBe(200);
  return (await result.json()).status as { enabled: boolean; used: number };
}

for (const suffix of ["", " @mobile"]) {
  test(`layout review preserves authored text and applies one undoable frame edit${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const block = slide();
    const hidden = { ...e01Slide("Hidden planning text"), hidden: true as const };
    const record = await createE01Deck(page, [block, hidden], 15);
    const initialStatus = await availability(page, record.id);
    expect(initialStatus.enabled).toBe(false);
    const publication = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
      {
        data: { expectedDraftRevision: record.draftRevision },
      },
    );
    expect(publication.status()).toBe(200);
    const versionId = (await publication.json()).version.id as string;
    const authoringRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/v1\/presentation-(?:text-)?assistance\/jobs/.test(request.url()))
        authoringRequests.push(request.url());
    });
    await enterE01Editor(page, record.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    let dialog = await openSuggestions(page);
    await dialog.getByRole("radio").first().check();
    await expect(
      dialog.getByRole("region", { name: "Complete slide content", exact: true }),
    ).toContainText("Assign an owner");
    await expect(dialog).not.toContainText("PRIVATE layout review speaker cue");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect((await readE01Record(page, record.id)).draftRevision).toBe(record.draftRevision);
    await expect(page.getByRole("button", { name: "Suggest layouts", exact: true })).toBeFocused();
    dialog = await openSuggestions(page);
    await dialog.getByRole("radio").first().check();
    const selected = dialog.locator('[data-layout-preview="selected"]');
    await expect(selected.locator('[data-native-fixed-layout="true"]').first()).toBeVisible();
    await expect(selected.locator("[data-native-fit-feedback]")).toContainText("Fit check:");
    await page.screenshot({ path: info.outputPath("layout-review.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Apply reviewed layout", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => (await readE01Record(page, record.id)).draftRevision)
      .toBe(record.draftRevision + 1);
    const applied = await readE01Record(page, record.id);
    expect(withoutFrames(scene(applied))).toEqual(withoutFrames(scene(record)));
    expect(scene(applied)).not.toEqual(scene(record));
    const appliedBlock = applied.draft.blocks[0];
    expect({ ...appliedBlock, scene: undefined }).toEqual({ ...block, scene: undefined });
    expect(applied.draft.blocks[1]).toEqual(record.draft.blocks[1]);
    expect(applied.draft.schemaVersion).toBe(15);
    await closeE01Overlays(page);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, record.id)).draft)
      .toEqual(record.draft);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, record.id)).draft)
      .toEqual(applied.draft);
    await page.reload();
    await openE01Inspector(page, "Layout");
    await expect(page.getByRole("button", { name: "Suggest layouts", exact: true })).toBeVisible();
    expect((await readE01Record(page, record.id)).draft).toEqual(applied.draft);
    expect((await availability(page, record.id)).used).toBe(initialStatus.used);
    expect(authoringRequests).toEqual([]);
    const current = await page.request.get(`${e01ApiUrl}/v1/presentations/${record.id}`);
    expect((await current.json()).presentation.currentVersionId).toBe(versionId);
  });

  test(`table layout previews retain wide geometry and readable phone content${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await signInBeta(page);
    const block = slide(true);
    const grouped = e01Slide("Grouped objects");
    grouped.scene!.schemaVersion = 6;
    grouped.scene!.groups = [
      { id: "keep-group", nodeIds: grouped.scene!.nodes.map((node) => node.id) },
    ];
    grouped.scene!.nodes.push({
      id: "ordinary-outline-reveal",
      type: "reveal",
      label: "Read supporting detail",
      body: "Keep the ordinary phone reading layout.",
      scope: "local",
      frame: { x: 8, y: 80, width: 84, height: 12 },
    });
    grouped.scene!.readingOrder.push("ordinary-outline-reveal");
    const record = await createE01Deck(page, [block, grouped], 15);
    await enterE01Editor(page, record.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    const dialog = await openSuggestions(page);
    await dialog.getByRole("radio").first().check();
    await page.setViewportSize({ width: 320, height: 760 });
    await expect(dialog).toBeVisible();
    expect(
      await dialog
        .getByRole("button", { name: "Close layout review", exact: true })
        .evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return range.getClientRects().length;
        }),
    ).toBe(1);
    for (const label of ["current", "selected"]) {
      const preview = dialog.locator(`[data-layout-preview="${label}"]`);
      const stage = preview.locator("[data-native-scene]");
      await expect(stage).toHaveAttribute("data-native-fixed-layout", "true");
      expect(
        await preview.locator("[data-layout-plane]").evaluate((element) => element.clientWidth),
      ).toBe(1280);
      const dimensions = await stage.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          content: element.clientWidth,
          border: parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth),
        };
      });
      expect(dimensions.content + dimensions.border).toBe(1280);
      await expect(preview.locator("table")).toHaveCSS("display", "table");
      await expect(preview.locator("[data-native-fit-feedback]")).toContainText("Fit check:");
    }
    const readable = dialog.getByRole("region", { name: "Complete slide content", exact: true });
    await expect(readable).toContainText(bodyText.split("\n")[0]!);
    await expect(readable.getByRole("table")).toContainText("Wait for evidence");
    await noOverflow(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath("layout-review-320.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Apply reviewed layout", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Suggest layouts", exact: true })).toBeFocused();
    await expect
      .poll(async () => (await readE01Record(page, record.id)).draftRevision)
      .toBe(record.draftRevision + 1);
    const updated = await readE01Record(page, record.id);
    expect(withoutFrames(scene(updated))).toEqual(withoutFrames(scene(record)));
    expect(updated.draft.blocks[1]).toEqual(record.draft.blocks[1]);
    await closeE01Overlays(page);
    await selectE01Block(page, "Grouped objects", true);
    await openE01Inspector(page, "Layout");
    await expect(page.getByRole("button", { name: "Suggest layouts", exact: true })).toBeDisabled();
    expect((await readE01Record(page, record.id)).draftRevision).toBe(updated.draftRevision);
    await noOverflow(page);
    // Fixed review planes must leave the ordinary phone table and accessible outline intact.
    await closeE01Overlays(page);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const delivery = page.getByRole("dialog", { name: "Presentation preview", exact: true });
    await expect(delivery.locator("table")).toHaveCSS("display", "block");
    await delivery.getByRole("button", { name: "Next", exact: true }).click();
    await delivery.getByRole("button", { name: "Show accessible outline", exact: true }).click();
    const outline = delivery.locator('[data-native-outline="true"]');
    await expect(outline).toHaveCSS("display", "grid");
    await expect(outline).toHaveCSS("gap", "16px");
    await expect(outline).toHaveCSS("padding", "16px");
    await expect(outline.getByText("Choose one action", { exact: true })).toHaveCSS(
      "font-size",
      "16px",
    );
    await noOverflow(page);
    await delivery.getByRole("button", { name: "Close preview", exact: true }).click();
  });
}
