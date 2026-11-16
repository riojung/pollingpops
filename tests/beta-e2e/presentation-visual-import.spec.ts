import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import type { Readable } from "node:stream";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  PresentationContentSchema,
  type PresentationDraft,
  type PresentationVisualImportJob,
} from "../../packages/contracts/src/index.ts";
import {
  clickNavigatorAction,
  closeE01Overlays,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.skip(
  process.env.BETA_E2E_VISUAL_IMPORTS !== "true",
  "Visual import requires the opt-in synthetic scanner/loopback S3 fixture (BETA_E2E_VISUAL_IMPORTS=true).",
);
test.use({ actionTimeout: 30_000 });

interface SyntheticPdf extends Readable {
  fontSize(size: number): SyntheticPdf;
  text(text: string, x: number, y: number): SyntheticPdf;
  rect(x: number, y: number, width: number, height: number): SyntheticPdf;
  fill(colour: string): SyntheticPdf;
  fillColor(colour: string): SyntheticPdf;
  addPage(): SyntheticPdf;
  end(): void;
}
async function twoPagePdf(marker: string) {
  // Resolve the already installed server PDF facility; no new browser/runtime dependency.
  const serverRequire = createRequire(path.resolve(process.cwd(), "apps/server/package.json"));
  const PDFDocument = serverRequire("pdfkit") as new (options: {
    size: [number, number];
    margin: number;
  }) => SyntheticPdf;
  const document = new PDFDocument({ size: [720, 405], margin: 32 });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.once("end", () => resolve(Buffer.concat(chunks)));
    document.once("error", reject);
  });
  for (let page = 1; page <= 2; page++) {
    if (page > 1) document.addPage();
    document.fillColor("#172f4b").fontSize(26).text(`${marker} page ${page}`, 32, 32);
    document
      .fillColor("#172f4b")
      .fontSize(18)
      .text(`Evidence ${page}: the second bar is twice the first.`, 32, 86);
    document.rect(54, 170, 180, 46).fill("#2358a5");
    document.rect(54, 238, 360, 46).fill("#157653");
  }
  document.end();
  return finished;
}

function titleOf(block: PresentationDraft["blocks"][number]) {
  if (block.kind !== "content") return block.question.prompt;
  const title = block.scene?.nodes.find((node) => node.type === "text" && node.role === "title");
  return title?.type === "text" ? title.text : "";
}
async function openMap(page: Page) {
  const open = page.getByRole("button", { name: "Open map", exact: true });
  if (await open.isVisible()) await open.click();
}
async function selectPosition(page: Page, position: number, narrow: boolean) {
  await openMap(page);
  await page
    .getByRole("complementary", { name: "Presentation map", exact: true })
    .locator("ol")
    .getByRole("button")
    .nth(position)
    .click();
  if (narrow) await page.getByRole("button", { name: "Collapse map", exact: true }).click();
}
async function noOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(
    geometry.scroll,
    `Document width ${geometry.scroll} at viewport ${geometry.width}`,
  ).toBeLessThanOrEqual(geometry.width + 1);
}

for (const suffix of ["", " @mobile"]) {
  test(`Presentation visual PDF imports require page review and recover exact pair insertion${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const narrow = Boolean(info.project.use.isMobile);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const marker = `Visual ${randomUUID().slice(0, 8)}`;
    const before = e01Slide(`${marker} before`);
    const after = e01Slide(`${marker} after`);
    const record = await createE01Deck(page, [before, after], 7);
    await enterE01Editor(page, record.id, narrow);
    await page
      .getByRole("textbox", { name: "Presentation title", exact: true })
      .fill(`${marker} reviewed deck`);
    await openMap(page);
    await clickNavigatorAction(page, "Import visual slides");
    let dialog = page.getByRole("dialog", { name: "Import visual slides", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Close visual import", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    await expect(dialog).toContainText("2 slides: a visual and an editable reading version");
    await expect(dialog).toContainText("There is no OCR guarantee");
    await expect(dialog).toContainText("within 24 hours");
    await expect(dialog.getByLabel("PDF or images", { exact: true })).toBeEnabled();
    await dialog.getByLabel("PDF or images", { exact: true }).setInputFiles({
      name: `${marker}.pdf`,
      mimeType: "application/pdf",
      buffer: await twoPagePdf(marker),
    });
    const queueResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${record.id}/visual-imports`,
    );
    await dialog.getByRole("button", { name: "Convert for review", exact: true }).click();
    const queued = await queueResponse;
    expect(queued.status()).toBe(202);
    const queuedJob = (await queued.json()).job as PresentationVisualImportJob;
    expect(queuedJob.retainOriginal).toBe(false);
    const jobPath = `${e01ApiUrl}/v1/presentations/${record.id}/visual-imports/${queuedJob.id}`;
    await expect
      .poll(
        async () => {
          const response = await page.request.get(jobPath);
          expect(response.status()).toBe(200);
          return (await response.json()).job.status;
        },
        { timeout: 60_000, message: "Real isolated PDF conversion reaches a ready review" },
      )
      .toBe("ready");
    const jobResponse = await page.request.get(jobPath);
    const job = (await jobResponse.json()).job as PresentationVisualImportJob;
    expect(job.pages).toHaveLength(2);
    expect(job.pages.map((item) => item.extractedText)).toEqual([
      expect.stringContaining(`${marker} page 1`),
      expect.stringContaining(`${marker} page 2`),
    ]);
    expect(new Set(job.pages.map((item) => item.mediaId)).size).toBe(2);
    await expect(dialog.getByRole("article", { name: "Review page 1", exact: true })).toBeVisible();
    await expect(dialog.getByRole("article", { name: "Review page 2", exact: true })).toBeVisible();
    await expect(
      dialog.getByRole("region", { name: "Conversion loss report", exact: true }),
    ).toContainText("Animation, audio, video");
    for (const number of [1, 2]) {
      const image = dialog.getByRole("img", {
        name: `Visual conversion preview of page ${number}. Review its meaning below.`,
        exact: true,
      });
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate(
            (element: HTMLImageElement) => element.complete && element.naturalWidth > 0,
          ),
        )
        .toBe(true);
    }
    // The job review is private even before the creator chooses which pages to insert.
    const anonymous = await page.context().browser()!.newContext({
      viewport: info.project.use.viewport,
      isMobile: info.project.use.isMobile,
      hasTouch: info.project.use.hasTouch,
      userAgent: info.project.use.userAgent,
      deviceScaleFactor: info.project.use.deviceScaleFactor,
      reducedMotion: "reduce",
    });
    try {
      expect((await anonymous.request.get(jobPath)).status()).toBe(401);
      expect((await anonymous.request.get(`${jobPath}/pages/1`)).status()).toBe(401);
    } finally {
      await anonymous.close();
    }
    expect((await readE01Record(page, record.id)).draft.blocks).toHaveLength(2);
    await dialog.getByLabel("Page 2", { exact: true }).uncheck();
    await expect(dialog).toContainText("1 selected pages · 2 slides");
    await dialog.getByLabel("Page 2", { exact: true }).check();
    await dialog.getByRole("button", { name: "Move up page 2", exact: true }).click();
    await expect(dialog.getByRole("article").first()).toHaveAccessibleName("Review page 2");
    const titles = { 1: `${marker} first evidence`, 2: `${marker} second evidence` };
    const alternatives = {
      1: "Page one: two labelled bars with the second twice as long.",
      2: "Page two: a repeated two-bar comparison.",
    };
    const reading = {
      1: "Page one compares two values. The first is one unit and the second is two units.",
      2: "Page two repeats the comparison: the second value is twice the first.",
    };
    for (const number of [1, 2] as const) {
      const article = dialog.getByRole("article", { name: `Review page ${number}`, exact: true });
      await article.getByRole("textbox", { name: "Slide title", exact: true }).fill(titles[number]);
      await article
        .getByRole("textbox", { name: "Image description", exact: true })
        .fill(alternatives[number]);
      await article
        .getByRole("textbox", { name: "Accessible text", exact: true })
        .fill(reading[number]);
      await article
        .getByRole("checkbox", {
          name: "I reviewed the reading order and meaning of this page.",
          exact: true,
        })
        .check();
    }
    const insert = dialog.getByRole("button", { name: "Insert 4 reviewed slides", exact: true });
    await expect(insert).toBeDisabled();
    await dialog
      .getByRole("checkbox", {
        name: "I accept the conversion losses and understand that visual images are not editable source objects.",
        exact: true,
      })
      .check();
    await expect(insert).toBeEnabled();
    await expect(insert).toHaveCSS("opacity", "1");
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"][aria-labelledby="visual-import-title"]')
          .analyze()
      ).violations,
    ).toEqual([]);
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath(`visual-import-review-${narrow ? "mobile" : "desktop"}.png`),
      fullPage: true,
    });

    const insertBodies: string[] = [];
    let loseAcknowledgement = true;
    let committedIds: string[] = [];
    await page.route(
      `**/v1/presentations/${record.id}/visual-imports/${job.id}/insert`,
      async (route) => {
        insertBodies.push(route.request().postData()!);
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        committedIds = (await response.json()).insertedBlockIds;
        if (loseAcknowledgement) {
          loseAcknowledgement = false;
          await route.abort("failed");
        } else await route.fulfill({ response });
      },
    );
    try {
      await insert.click();
      await expect(
        dialog.getByRole("button", { name: "Retry same insertion", exact: true }),
      ).toBeEnabled();
      await expect(
        dialog.getByRole("button", { name: "Close visual import", exact: true }),
      ).toBeDisabled();
      await expect
        .poll(async () => (await readE01Record(page, record.id)).draft.blocks.length)
        .toBe(6);
      expect(committedIds).toHaveLength(4);
      // Refresh recovers the persisted immutable intent; no new upload or mutation ID is needed.
      await page.reload();
      dialog = page.getByRole("dialog", { name: "Import visual slides", exact: true });
      await expect(
        dialog.getByRole("button", { name: "Retry same insertion", exact: true }),
      ).toBeEnabled();
      const acknowledged = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname.endsWith(`/visual-imports/${job.id}/insert`),
      );
      await dialog.getByRole("button", { name: "Retry same insertion", exact: true }).click();
      expect((await acknowledged).status()).toBe(200);
      await expect(dialog).toHaveCount(0);
      expect(insertBodies).toHaveLength(2);
      expect(insertBodies[1]).toBe(insertBodies[0]);
      expect(JSON.parse(insertBodies[0]!)).toMatchObject({
        afterBlockId: before.id,
        fidelityAccepted: true,
        pages: [
          {
            pageNumber: 2,
            title: titles[2],
            alternativeText: alternatives[2],
            accessibleText: reading[2],
            readingOrderReviewed: true,
          },
          {
            pageNumber: 1,
            title: titles[1],
            alternativeText: alternatives[1],
            accessibleText: reading[1],
            readingOrderReviewed: true,
          },
        ],
      });
    } finally {
      await page.unrouteAll({ behavior: "wait" });
    }

    const inserted = await readE01Record(page, record.id);
    expect(inserted.draft.title).toBe(`${marker} reviewed deck`);
    expect(inserted.draft.schemaVersion).toBe(7);
    expect(inserted.draft.blocks.map((block) => block.id)).toEqual([
      before.id,
      ...committedIds,
      after.id,
    ]);
    expect(new Set(inserted.draft.blocks.map((block) => block.id)).size).toBe(6);
    expect(inserted.draft.blocks.map(titleOf)).toEqual([
      `${marker} before`,
      titles[2],
      titles[2],
      titles[1],
      titles[1],
      `${marker} after`,
    ]);
    for (const [offset, number] of [
      [1, 2],
      [3, 1],
    ] as const) {
      const visual = inserted.draft.blocks[offset]!;
      const readable = inserted.draft.blocks[offset + 1]!;
      expect(visual.kind).toBe("content");
      expect(readable.kind).toBe("content");
      if (visual.kind !== "content" || readable.kind !== "content")
        throw new Error("Expected native visual/reading pair");
      expect(visual.scene?.nodes.find((node) => node.type === "image")).toMatchObject({
        mediaId: job.pages.find((item) => item.pageNumber === number)!.mediaId,
        altText: alternatives[number],
      });
      expect(readable.scene?.nodes.some((node) => node.type === "image")).toBe(false);
      expect(
        readable.scene?.nodes.find((node) => node.type === "text" && node.role === "body"),
      ).toMatchObject({ text: reading[number] });
      expect(visual.sourceDisclosure?.model).toBe("visual-import-v1");
      expect(readable.sourceDisclosure?.model).toBe("visual-import-v1");
    }
    if (narrow) {
      const hideInspector = page.getByRole("button", { name: "Hide inspector", exact: true });
      if (await hideInspector.isVisible()) await hideInspector.click();
      const collapse = page.getByRole("button", { name: "Collapse map", exact: true });
      if (await collapse.isVisible()) await collapse.click();
    }
    await expect(page.getByText("Imported visual slide", { exact: true })).toBeVisible();
    await expect(page.getByText(/Source objects, animation and media are flattened/)).toBeVisible();
    await selectPosition(page, 2, narrow);
    await expect(page.getByText("Imported reading slide", { exact: true })).toBeVisible();
    await expect(
      page.locator('[data-native-scene-canvas="true"]').getByText(reading[2], { exact: true }),
    ).toBeVisible();
    // Existing native slides can be interleaved between the two imported page representations.
    await selectPosition(page, 5, narrow);
    await page.getByRole("button", { name: "Move earlier", exact: true }).click();
    const expectedIds = [
      before.id,
      committedIds[0],
      committedIds[1],
      committedIds[2],
      after.id,
      committedIds[3],
    ];
    await expect
      .poll(async () =>
        (await readE01Record(page, record.id)).draft.blocks.map((block) => block.id),
      )
      .toEqual(expectedIds);
    await page.reload();
    expect((await readE01Record(page, record.id)).draft.blocks.map((block) => block.id)).toEqual(
      expectedIds,
    );
    const publicationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${record.id}/publish`,
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const published = await publicationResponse;
    expect(published.status()).toBe(200);
    const version = (await published.json()).version;
    expect(PresentationContentSchema.safeParse(version.content).success).toBe(true);
    expect(version.content.blocks.map((block: { id: string }) => block.id)).toEqual(expectedIds);
    expect(
      version.content.blocks.filter(
        (block: PresentationDraft["blocks"][number]) =>
          block.kind === "content" && block.scene?.nodes.some((node) => node.type === "image"),
      ),
    ).toHaveLength(2);
    const repeated = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${record.id}/visual-imports/${job.id}/insert`,
      { data: JSON.parse(insertBodies[0]!) },
    );
    expect(repeated.status()).toBe(200);
    expect((await readE01Record(page, record.id)).draft.blocks.map((block) => block.id)).toEqual(
      expectedIds,
    );
    if (narrow) {
      await closeE01Overlays(page);
    }
    await selectPosition(page, 1, narrow);
    await expect(page.getByText("Imported visual slide", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("img", { name: alternatives[2], exact: true }).first(),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath(`visual-import-published-${narrow ? "mobile" : "desktop"}.png`),
      fullPage: true,
    });
  });
}
