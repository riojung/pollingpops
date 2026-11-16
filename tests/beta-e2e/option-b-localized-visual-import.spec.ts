import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import type { Readable } from "node:stream";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { PresentationVisualImportJob } from "../../packages/contracts/src/index.ts";
import { visualImportCopy } from "../../apps/web/components/presentation/visual-import-copy";
import { presentationCommandCopy } from "../../apps/web/components/presentation/presentation-command-copy";
import { createE01Deck, e01ApiUrl, e01Slide, readE01Record } from "./presentation-e01-support";
import {
  closeSpecialistInspector,
  specialistLanguage,
  specialistLocale,
} from "./option-b-specialist-support";
import { signInBeta } from "./sign-in";

test.skip(
  process.env.BETA_E2E_VISUAL_IMPORTS !== "true",
  "Visual import requires the opt-in synthetic scanner/loopback S3 fixture (BETA_E2E_VISUAL_IMPORTS=true).",
);
test.use({ actionTimeout: 30_000 });

// Same installed PDF facility and bounded synthetic fixture as presentation-visual-import.spec.ts.
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

async function quality(page: Page, dialog: Locator) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
  await expect
    .poll(() => dialog.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1);
  expect(
    (
      await new AxeBuilder({ page })
        .include('[role="dialog"][aria-labelledby="visual-import-title"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

async function openVisualImport(page: Page) {
  await closeSpecialistInspector(page);
  const toggle = page.locator('button[aria-controls="presentation-slide-navigator"]');
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  const map = page.locator("#presentation-slide-navigator");
  const action = map.getByRole("button", {
    name: visualImportCopy("ko-KR")("Import visual slides"),
    exact: true,
  });
  if (!(await action.isVisible()))
    await map.getByTitle(presentationCommandCopy("ko-KR").insertImport, { exact: true }).click();
  await action.click();
  return page.getByRole("dialog", {
    name: visualImportCopy("ko-KR")("Import visual slides"),
    exact: true,
  });
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean visual PDF review keeps original text and exact insertion recovery in German ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const marker = `Original ${randomUUID().slice(0, 8)}`;
    const original = e01Slide("Texte original de la présentation");
    const record = await createE01Deck(page, [original], 14);
    const copy = visualImportCopy("ko-KR");
    const german = visualImportCopy("de-DE");
    const fileName = "Review before insertion.pdf";
    const source = await twoPagePdf(marker);
    const uploadPath = `/v1/presentations/${record.id}/visual-imports`;
    const uploads: string[] = [];
    const insertBodies: string[] = [];
    let insertPath = "";
    let loseAcknowledgement = true;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === uploadPath)
        uploads.push(request.postData()!);
    });
    try {
      await specialistLocale(page, "ko-KR");
      await page.goto(`/presentation/${record.id}`);
      let dialog = await openVisualImport(page);
      await expect(dialog).toBeVisible();
      await expect(dialog).toBeFocused();
      await expect(dialog).toHaveAttribute("lang", "ko-KR");
      await expect(dialog).toContainText(
        copy("2 slides: a visual and an editable reading version"),
      );
      await expect(dialog).toContainText(
        copy(
          "This visual conversion is separate from trusted-source proposals. Animations, transitions, audio, video and interactive content are not preserved. Links and reading order may be lost. There is no OCR guarantee.",
        ),
      );
      await dialog
        .getByLabel(copy("PDF or images"), { exact: true })
        .setInputFiles({ name: fileName, mimeType: "application/pdf", buffer: source });
      await specialistLanguage(dialog.getByText(fileName, { exact: true }), "");
      const queuedResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" && new URL(response.url()).pathname === uploadPath,
      );
      await dialog.getByRole("button", { name: copy("Convert for review"), exact: true }).click();
      const queued = await queuedResponse;
      expect(queued.status()).toBe(202);
      const jobId = ((await queued.json()).job as PresentationVisualImportJob).id;
      const jobPath = `${e01ApiUrl}${uploadPath}/${jobId}`;
      await expect
        .poll(
          async () => {
            const response = await page.request.get(jobPath);
            expect(response.status()).toBe(200);
            return (await response.json()).job.status;
          },
          { timeout: 60_000 },
        )
        .toBe("ready");
      const job = (await (await page.request.get(jobPath)).json())
        .job as PresentationVisualImportJob;
      expect(job.pages).toHaveLength(2);
      expect(job.pages.map((item) => item.extractedText)).toEqual([
        expect.stringContaining(`${marker} page 1`),
        expect.stringContaining(`${marker} page 2`),
      ]);
      await expect(dialog.getByRole("article")).toHaveCount(2);
      await expect(dialog.getByRole("heading", { name: fileName, exact: true })).toBeVisible();
      await specialistLanguage(dialog.getByRole("heading", { name: fileName, exact: true }), "");
      await expect(
        dialog.getByRole("region", { name: copy("Conversion loss report"), exact: true }),
      ).toContainText(
        copy(
          "Visual pages are raster images, not editable source objects. Animation, audio, video and active links are not preserved.",
        ),
      );
      for (const number of [1, 2]) {
        const article = dialog.getByRole("article", {
          name: copy("Review page {page}", { page: number }),
          exact: true,
        });
        const text = article.getByRole("textbox", { name: copy("Accessible text"), exact: true });
        await expect(text).toHaveValue(job.pages[number - 1]!.extractedText);
        await specialistLanguage(text, "");
        await expect(
          article.getByRole("textbox", { name: copy("Slide title"), exact: true }),
        ).toHaveValue(`Page ${number}`);
        const image = article.getByRole("img", {
          name: copy("Visual conversion preview of page {page}. Review its meaning below.", {
            page: number,
          }),
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
      expect(uploads).toHaveLength(1);
      const upload = JSON.parse(uploads[0]!);
      expect(upload).toMatchObject({
        retainOriginal: false,
        files: [{ name: fileName, mimeType: "application/pdf" }],
      });
      expect(Buffer.from(upload.files[0].base64, "base64")).toEqual(source);
      expect(upload).not.toHaveProperty("locale");
      expect((await readE01Record(page, record.id)).draft).toEqual(record.draft);

      await dialog.getByLabel(copy("Page {page}", { page: 2 }), { exact: true }).uncheck();
      await expect(dialog.getByRole("article")).toHaveCount(1);
      await dialog.getByLabel(copy("Page {page}", { page: 2 }), { exact: true }).check();
      await dialog
        .getByRole("button", { name: copy("Move up page {page}", { page: 2 }), exact: true })
        .click();
      await expect(dialog.getByRole("article").first()).toHaveAccessibleName(
        copy("Review page {page}", { page: 2 }),
      );
      const titles = { 1: "Image description", 2: "Original second title" };
      const descriptions = {
        1: "Description française originale",
        2: "Original second description",
      };
      const reading = {
        1: "Le premier graphique montre une valeur et deux fois cette valeur.",
        2: "The second original reading compares one unit with two units.",
      };
      for (const number of [1, 2] as const) {
        const article = dialog.getByRole("article", {
          name: copy("Review page {page}", { page: number }),
          exact: true,
        });
        for (const [label, value] of [
          ["Slide title", titles[number]],
          ["Image description", descriptions[number]],
          ["Accessible text", reading[number]],
        ] as const) {
          const field = article.getByRole("textbox", { name: copy(label), exact: true });
          await field.fill(value);
          await specialistLanguage(field, "");
        }
        await article
          .getByRole("checkbox", {
            name: copy("I reviewed the reading order and meaning of this page."),
            exact: true,
          })
          .check();
      }
      const insert = dialog.getByRole("button", {
        name: copy("Insert {count} reviewed slides", { count: 4 }),
        exact: true,
      });
      await expect(insert).toBeDisabled();
      await dialog
        .getByRole("checkbox", {
          name: copy(
            "I accept the conversion losses and understand that visual images are not editable source objects.",
          ),
          exact: true,
        })
        .check();
      await expect(insert).toBeEnabled();
      const first = dialog.getByRole("article", {
        name: copy("Review page {page}", { page: 1 }),
        exact: true,
      });
      const meaning = first.getByRole("checkbox", {
        name: copy("I reviewed the reading order and meaning of this page."),
        exact: true,
      });
      await first
        .getByRole("textbox", { name: copy("Image description"), exact: true })
        .fill(`${descriptions[1]} corrigée`);
      descriptions[1] += " corrigée";
      await expect(meaning).not.toBeChecked();
      await expect(insert).toBeDisabled();
      await meaning.check();
      await expect(insert).toBeEnabled();
      await quality(page, dialog);
      await page.screenshot({
        path: info.outputPath("visual-import-korean-review.png"),
        fullPage: true,
      });
      insertPath = `${jobPath}/insert`;
      await page.route(insertPath, async (route) => {
        insertBodies.push(route.request().postData()!);
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        if (loseAcknowledgement) {
          loseAcknowledgement = false;
          await route.abort("failed");
        } else await route.fulfill({ response });
      });
      await insert.click();
      await expect(
        dialog.getByRole("button", { name: copy("Retry same insertion"), exact: true }),
      ).toBeEnabled();
      await expect(
        dialog.getByRole("button", { name: copy("Close visual import"), exact: true }),
      ).toBeDisabled();
      const accepted = await readE01Record(page, record.id);
      expect(accepted.draft.blocks).toHaveLength(5);
      expect(accepted.draft.blocks[0]).toEqual(original);
      await specialistLocale(page, "de-DE");
      await page.reload();
      dialog = page.getByRole("dialog", { name: german("Import visual slides"), exact: true });
      await expect(dialog).toHaveAttribute("lang", "de-DE");
      await expect(
        dialog.getByRole("button", { name: german("Retry same insertion"), exact: true }),
      ).toBeEnabled();
      await expect(
        dialog.getByRole("button", { name: german("Close visual import"), exact: true }),
      ).toBeDisabled();
      await expect(dialog.getByRole("article").first()).toHaveAccessibleName(
        german("Review page {page}", { page: 2 }),
      );
      for (const number of [1, 2] as const) {
        const article = dialog.getByRole("article", {
          name: german("Review page {page}", { page: number }),
          exact: true,
        });
        for (const [label, value] of [
          ["Slide title", titles[number]],
          ["Image description", descriptions[number]],
          ["Accessible text", reading[number]],
        ] as const) {
          const field = article.getByRole("textbox", { name: german(label), exact: true });
          await expect(field).toHaveValue(value);
          await expect(field).toBeDisabled();
          await specialistLanguage(field, "");
        }
      }
      await quality(page, dialog);
      await page.screenshot({
        path: info.outputPath("visual-import-german-recovery.png"),
        fullPage: true,
      });
      await dialog
        .getByRole("button", { name: german("Retry same insertion"), exact: true })
        .click();
      await expect(dialog).toBeHidden();
      expect(insertBodies).toHaveLength(2);
      expect(insertBodies[1]).toBe(insertBodies[0]);
      expect(JSON.parse(insertBodies[0]!)).toMatchObject({
        expectedRevision: record.draftRevision,
        afterBlockId: original.id,
        fidelityAccepted: true,
        pages: [2, 1].map((number) => ({
          pageNumber: number,
          title: titles[number as 1 | 2],
          alternativeText: descriptions[number as 1 | 2],
          accessibleText: reading[number as 1 | 2],
          readingOrderReviewed: true,
        })),
      });
      expect(JSON.parse(insertBodies[0]!)).not.toHaveProperty("locale");
      const recovered = await readE01Record(page, record.id);
      expect(recovered.draftRevision).toBe(accepted.draftRevision);
      expect(recovered.draft).toEqual(accepted.draft);
      expect(uploads).toHaveLength(1);
      expect(
        (await (await page.request.get(`${e01ApiUrl}${uploadPath}`)).json()).jobs,
      ).toHaveLength(1);
    } finally {
      if (insertPath) await page.unroute(insertPath);
      await specialistLocale(page, "en-CA");
    }
  });
}
