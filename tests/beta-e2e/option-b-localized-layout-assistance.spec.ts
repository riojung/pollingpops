import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ContentSlideDraft, PresentationScene } from "../../packages/contracts/src/index.ts";
import { layoutAssistanceCopy } from "../../apps/web/components/presentation/layout-assistance-copy";
import {
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  presentationTextAssistanceSourceDigest,
} from "../../packages/contracts/src/index.ts";
import {
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  readE01Record,
  type E01Record,
} from "./presentation-e01-support";
import {
  closeSpecialistInspector,
  specialistLanguage,
  specialistLocale,
  specialistQuality,
} from "./option-b-specialist-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 20_000 });
const authoredTitle = "Wide text";
const authoredBody = "Body text · Exact source wording\nReview 0012.500 {title}";
const privateNote = "PRIVATE_LOCALIZED_LAYOUT_NOT_IN_REVIEW";

function layoutSlide(): ContentSlideDraft {
  const block = e01Slide(authoredTitle);
  block.speakerNotes = privateNote;
  block.citations = [{ locator: "Original source {title}", excerpt: "Exact source wording" }];
  block.sourceDisclosure = {
    sourceName: "Selected layout",
    sourceDigest: "a".repeat(64),
    provider: "original-provider",
    model: "original-model",
  };
  const scene = block.scene!;
  scene.schemaVersion = 7;
  scene.design = { theme: "midnight", font: "serif", spacing: "compact" };
  const title = scene.nodes[0]!;
  const body = scene.nodes[1]!;
  if (title.type !== "text" || body.type !== "text") throw new Error("Expected text");
  title.lang = "fr";
  title.frame = { x: 8, y: 4, width: 84, height: 4 };
  body.id = "Body:ExactCase";
  body.text = authoredBody;
  body.frame = { x: 18, y: 40, width: 48, height: 4 };
  body.richText = {
    paragraphs: [
      {
        kind: "paragraph",
        runs: [
          { text: "Body text · ", bold: true },
          {
            text: "Exact source wording",
            href: "https://example.com/source?loc=ExactCase",
          },
        ],
      },
      { kind: "bullet", runs: [{ text: "Review 0012.500 {title}", italic: true }] },
    ],
  };
  scene.nodes.push({
    id: "Table:ExactCase",
    type: "table",
    caption: "Data table",
    headers: ["Selected layout", "Raw amount"],
    rows: [
      ["Wide text", "0012.500 {title}"],
      ["Body text", "1,234.50%"],
    ],
    frame: { x: 12, y: 50, width: 50, height: 10 },
  });
  scene.readingOrder = [body.id, "Table:ExactCase", title.id];
  block.textAssistance = {
    schemaVersion: 1,
    nodeId: body.id,
    role: "body",
    operation: "rewrite",
    sourceDigest: "b".repeat(64),
    outputDigest: presentationTextAssistanceSourceDigest(authoredBody),
    provider: "earlier-provider",
    model: "earlier-model",
    generatedAt: "2026-11-06T12:00:00.000Z",
    reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  };
  return block;
}

function nativeScene(record: E01Record): PresentationScene {
  const block = record.draft.blocks[0];
  if (block?.kind !== "content" || !block.scene) throw new Error("Expected native content");
  return block.scene;
}

async function previewFrames(dialog: Locator, kind: "current" | "selected") {
  return dialog
    .locator(`[data-layout-preview="${kind}"] [data-node-id][data-frame]`)
    .evaluateAll((elements) =>
      elements.map((element) => {
        const style = (element as HTMLElement).style;
        return {
          id: element.getAttribute("data-node-id")!,
          frame: {
            x: Number.parseFloat(style.left),
            y: Number.parseFloat(style.top),
            width: Number.parseFloat(style.width),
            height: Number.parseFloat(style.height),
          },
        };
      }),
    );
}

async function nativeDialogTabs(dialog: Locator, key: "Tab" | "Shift+Tab", expected?: Locator) {
  const observed: Array<{
    tag: string | null;
    role: string | null;
    hasFocus: boolean;
    insideDialog: boolean;
  }> = [];
  for (let step = 0; step < 4; step++) {
    await dialog.page().keyboard.press(key);
    const focus = await dialog.evaluate((modal) => {
      const document = modal.ownerDocument;
      const active = document.activeElement;
      return {
        tag: active?.tagName ?? null,
        role: active?.getAttribute("role") ?? null,
        hasFocus: document.hasFocus(),
        insideDialog: active !== null && modal.contains(active),
      };
    });
    observed.push(focus);
    // Native dialogs can visit browser chrome between their last and first controls.
    // Only the document root sentinel is allowed there; background controls always fail.
    expect(
      focus.insideDialog || focus.tag === "BODY" || focus.tag === "HTML",
      `${key} left the native dialog: ${JSON.stringify(observed)}`,
    ).toBe(true);
    if (
      expected &&
      (await expected.evaluate((element) => element === element.ownerDocument.activeElement))
    ) {
      await expect(expected).toBeFocused();
      return;
    }
  }
  if (!expected) {
    expect(
      observed.some((focus) => focus.insideDialog),
      `${key} never reached the native dialog: ${JSON.stringify(observed)}`,
    ).toBe(true);
    return;
  }
  throw new Error(
    `${key} did not return to the expected dialog control: ${JSON.stringify(observed)}`,
  );
}

async function inspectLayout(page: Page) {
  const navigator = page.locator('button[aria-controls="presentation-slide-navigator"]');
  if ((await navigator.getAttribute("aria-expanded")) === "true") await navigator.click();
  const inspector = page.locator('button[aria-controls="presentation-object-inspector"]');
  if ((await inspector.getAttribute("aria-expanded")) === "false") await inspector.click();
  await page.locator("#inspector-tab-layout").click();
}

async function openLayouts(page: Page, locale: "ko-KR" | "de-DE") {
  const copy = layoutAssistanceCopy(locale);
  await inspectLayout(page);
  await page.getByRole("button", { name: copy("Suggest layouts"), exact: true }).click();
  const dialog = page.getByRole("dialog", { name: copy("Review layout suggestions"), exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("lang", locale);
  return dialog;
}

async function quotaUsed(page: Page, presentationId: string) {
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-text-assistance/status?presentationId=${presentationId}`,
  );
  expect(response.status()).toBe(200);
  return ((await response.json()).status as { used: number }).used;
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean local layout review preserves exact content, selection and history ${suffix}`, async ({
    page,
    browserName,
  }, info) => {
    test.setTimeout(180_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const block = layoutSlide();
    const hidden = { ...e01Slide("Hidden authored content"), hidden: true as const };
    const created = await createE01Deck(page, [block, hidden], 16);
    // Modern native mutations retain the explicit sections field. Establish that
    // canonical draft before measuring review writes or exact history preservation.
    const seeded = await page.request.put(`${e01ApiUrl}/v1/presentations/${created.id}/draft`, {
      data: {
        draft: { ...created.draft, sections: [] },
        expectedRevision: created.draftRevision,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    const record = (await seeded.json()).presentation as E01Record;
    const originalQuota = await quotaUsed(page, record.id);
    const writes: unknown[] = [];
    const aiRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "PUT" && pathname === `/v1/presentations/${record.id}/draft`)
        writes.push(request.postDataJSON());
      if (
        request.method() === "POST" &&
        /\/v1\/presentation-(?:text-)?assistance\/jobs/.test(pathname)
      )
        aiRequests.push(pathname);
    });
    const copy = layoutAssistanceCopy("ko-KR");
    try {
      await specialistLocale(page, "ko-KR");
      await page.goto(`/presentation/${record.id}`);
      let dialog = await openLayouts(page, "ko-KR");
      const reading = dialog.getByRole("region", {
        name: copy("Complete slide content"),
        exact: true,
      });
      await specialistLanguage(reading, "ko-KR");
      await expect(reading.locator('[data-layout-reading-node="Body:ExactCase"]')).toContainText(
        "Review 0012.500 {title}",
      );
      await specialistLanguage(
        reading.getByRole("link", { name: "Exact source wording", exact: true }),
        "",
      );
      await expect(reading.getByRole("link")).toHaveAttribute(
        "href",
        "https://example.com/source?loc=ExactCase",
      );
      await specialistLanguage(reading.getByText(authoredTitle, { exact: true }).last(), "fr");
      await expect(reading.locator("caption")).toHaveText("Data table");
      await specialistLanguage(reading.locator("caption"), "");
      await expect(reading.locator("td")).toHaveText([
        "Wide text",
        "0012.500 {title}",
        "Body text",
        "1,234.50%",
      ]);
      await specialistLanguage(reading.locator("td").last(), "");
      expect(
        await reading
          .locator("[data-layout-reading-node]")
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("data-layout-reading-node")),
          ),
      ).toEqual(nativeScene(record).readingOrder);
      await expect(dialog).not.toContainText(privateNote);
      await expect(dialog).not.toContainText("Original source {title}");
      const radios = dialog.getByRole("radio");
      await radios.first().focus();
      await radios.first().press("ArrowRight");
      await expect(radios.nth(1)).toBeChecked();
      await radios.last().check();
      await expect(radios.last()).toBeChecked();
      const chosenId = await radios.last().inputValue();
      const reviewedFrames = await previewFrames(dialog, "selected");
      expect(reviewedFrames.map((node) => node.id)).toEqual(nativeScene(record).readingOrder);
      const framesById = new Map(reviewedFrames.map((node) => [node.id, node.frame]));
      const reviewedScene = {
        ...nativeScene(record),
        nodes: nativeScene(record).nodes.map((node) =>
          node.type === "connector" ? node : { ...node, frame: framesById.get(node.id)! },
        ),
      };
      expect(reviewedScene).not.toEqual(nativeScene(record));
      for (const kind of ["current", "selected"]) {
        const preview = dialog.locator(`[data-layout-preview="${kind}"]`);
        await expect(preview.locator("[data-native-scene]")).toHaveAttribute(
          "data-native-fixed-layout",
          "true",
        );
        await expect(preview.locator("[data-layout-plane]")).toHaveJSProperty("clientWidth", 1280);
        expect(await preview.locator("[inert]").getAttribute("aria-hidden")).toBe("true");
        await expect(preview.locator("[data-native-fit-feedback]")).toHaveAttribute(
          "lang",
          "ko-KR",
        );
        await expect(preview.locator("table")).toHaveCSS("display", "table");
      }
      const selectedPreview = dialog.locator('[data-layout-preview="selected"]');
      for (const node of reviewedFrames) {
        await expect(selectedPreview.locator(`[data-node-id="${node.id}"]`)).toHaveAttribute(
          "data-frame",
          JSON.stringify(node.frame),
        );
      }
      const close = dialog.getByRole("button", { name: copy("Close layout review"), exact: true });
      const cancel = dialog.getByRole("button", { name: copy("Cancel"), exact: true });
      await cancel.focus();
      await expect(cancel).toBeFocused();
      await dialog.evaluate((modal) => {
        const outsideTrigger = modal.parentElement?.querySelector(":scope > button");
        if (!(outsideTrigger instanceof HTMLElement)) throw new Error("Missing layout trigger");
        outsideTrigger.focus();
      });
      await expect(cancel).toBeFocused();
      if (browserName === "webkit") {
        // Safari button tab stops follow platform keyboard preferences:
        // https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac
        await nativeDialogTabs(dialog, "Tab");
        await nativeDialogTabs(dialog, "Shift+Tab");
      } else {
        await nativeDialogTabs(dialog, "Tab", close);
        await nativeDialogTabs(dialog, "Shift+Tab", cancel);
      }
      await specialistQuality(page);
      await dialog.screenshot({ path: info.outputPath("korean-local-layout-comparison.png") });
      expect(writes).toEqual([]);
      expect(aiRequests).toEqual([]);
      expect(await quotaUsed(page, record.id)).toBe(originalQuota);
      expect((await readE01Record(page, record.id)).draft).toEqual(record.draft);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("button", { name: copy("Suggest layouts"), exact: true }),
      ).toBeFocused();
      expect(writes).toEqual([]);

      dialog = await openLayouts(page, "ko-KR");
      const keyboardClose = dialog.getByRole("button", {
        name: copy("Close layout review"),
        exact: true,
      });
      await keyboardClose.focus();
      await expect(keyboardClose).toBeFocused();
      await keyboardClose.press("Enter");
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("button", { name: copy("Suggest layouts"), exact: true }),
      ).toBeFocused();
      expect(writes).toEqual([]);

      dialog = await openLayouts(page, "ko-KR");
      await dialog.locator(`input[value="${chosenId}"]`).check();
      expect(await previewFrames(dialog, "selected")).toEqual(reviewedFrames);
      await dialog
        .getByRole("button", { name: copy("Apply reviewed layout"), exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await expect
        .poll(async () => (await readE01Record(page, record.id)).draftRevision)
        .toBe(record.draftRevision + 1);
      const applied = await readE01Record(page, record.id);
      expect(applied.draft).toEqual({
        ...record.draft,
        blocks: record.draft.blocks.map((original, index) =>
          index === 0 ? { ...original, scene: reviewedScene } : original,
        ),
      });
      await closeSpecialistInspector(page);
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect
        .poll(async () => (await readE01Record(page, record.id)).draft)
        .toEqual(record.draft);
      await page.getByRole("button", { name: "다시 실행", exact: true }).click();
      await expect
        .poll(async () => (await readE01Record(page, record.id)).draft)
        .toEqual(applied.draft);
      const beforeGerman = writes.length;
      await specialistLocale(page, "de-DE");
      await page.reload();
      dialog = await openLayouts(page, "de-DE");
      await expect(dialog).toContainText(layoutAssistanceCopy("de-DE")("Choose a layout"));
      await expect(
        dialog.getByRole("region", {
          name: layoutAssistanceCopy("de-DE")("Complete slide content"),
          exact: true,
        }),
      ).toContainText("0012.500 {title}");
      await specialistQuality(page);
      await dialog
        .getByRole("button", { name: layoutAssistanceCopy("de-DE")("Cancel"), exact: true })
        .click();
      expect(writes).toHaveLength(beforeGerman);
      expect((await readE01Record(page, record.id)).draft).toEqual(applied.draft);

      await specialistLocale(page, "ko-KR");
      await page.route(`${e01ApiUrl}/v1/auth/me`, async (route) => {
        const response = await route.fetch();
        const account = await response.json();
        account.creator.role = "viewer";
        await route.fulfill({ response, json: account });
      });
      await page.reload();
      await inspectLayout(page);
      await expect(
        page.getByRole("button", { name: copy("Suggest layouts"), exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("dialog", { name: copy("Review layout suggestions"), exact: true }),
      ).toBeHidden();
      await specialistQuality(page);
      expect((await readE01Record(page, record.id)).draft).toEqual(applied.draft);
      expect(writes).toHaveLength(beforeGerman);
      expect(aiRequests).toEqual([]);
      expect(await quotaUsed(page, record.id)).toBe(originalQuota);
    } finally {
      await page.unroute(`${e01ApiUrl}/v1/auth/me`);
      await specialistLocale(page, "en-CA");
    }
  });
}
