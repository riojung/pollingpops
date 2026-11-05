import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.skip(
  process.env.BETA_E2E_VISUAL_IMPORTS !== "true",
  "Static image export uses the opt-in synthetic scanner and loopback object store.",
);
test.use({ actionTimeout: 30_000 });

for (const suffix of ["", " @mobile"]) {
  test(`static downloads pin publication, flatten slides and provide complete readable HTML${suffix}`, async ({
    page,
    context,
  }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const opening = e01Slide(`Export evidence ${randomUUID().slice(0, 8)}`, true);
    const heading = opening.scene!.nodes[0]!;
    opening.scene = {
      ...opening.scene!,
      schemaVersion: 6,
      design: { theme: "midnight", font: "sans", spacing: "relaxed" },
      nodes: [
        heading,
        {
          id: randomUUID(),
          type: "text",
          role: "body",
          text: "Readable evidence <script>must stay text</script>",
          richText: {
            paragraphs: [
              {
                kind: "bullet",
                runs: [{ text: "Readable evidence <script>must stay text</script>", bold: true }],
              },
            ],
          },
          frame: { x: 8, y: 30, width: 45, height: 30 },
        },
        {
          id: randomUUID(),
          type: "dialog",
          scope: "local",
          label: "Supporting detail",
          detailTitle: "Complete supporting detail",
          body: "Public detail body stays readable in HTML.",
          frame: { x: 8, y: 72, width: 45, height: 18 },
        },
      ],
      readingOrder: [],
    };
    opening.scene.readingOrder = opening.scene.nodes.map((node) => node.id);
    opening.speakerNotes = "PRIVATE export presenter cue";
    const information = e01Slide("Published data evidence");
    const informationTitle = information.scene!.nodes[0]!;
    information.scene = {
      schemaVersion: 4,
      aspectRatio: "16:9",
      design: { theme: "paper", font: "sans", spacing: "compact" },
      nodes: [
        informationTitle,
        {
          id: randomUUID(),
          type: "table",
          caption: "Regional attendance",
          headers: ["Region", "Count"],
          rows: [
            ["East", "10"],
            ["West", "20"],
          ],
          frame: { x: 7, y: 30, width: 38, height: 60 },
        },
        {
          id: randomUUID(),
          type: "chart",
          chartType: "bar",
          title: "Attendance by region",
          summary: "West recorded twice the attendance of East.",
          categories: ["East", "West"],
          series: [{ name: "Attendees", values: [10, 20] }],
          frame: { x: 50, y: 30, width: 43, height: 60 },
        },
      ],
      readingOrder: [],
    };
    information.scene.readingOrder = information.scene.nodes.map((node) => node.id);
    const question = {
      id: randomUUID(),
      kind: "question" as const,
      question: {
        id: randomUUID(),
        type: "single_select" as const,
        prompt: "Published review question",
        choices: [
          { id: randomUUID(), label: "Public option A", isCorrect: true },
          { id: randomUUID(), label: "Public option B", isCorrect: false },
        ],
        purpose: "diagnostic" as const,
        confidence: "off" as const,
        delivery: "main" as const,
        linkedRecheckQuestionId: null,
        timeLimitSeconds: 30,
        basePoints: 100,
        explanation: "PRIVATE export answer explanation",
        mediaId: null,
        mediaAlt: null,
      },
    };
    const hidden = { ...e01Slide("HIDDEN export planning"), hidden: true };
    const record = await createE01Deck(page, [opening, information, question, hidden], 13);
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    const exportButton = page.getByRole("button", { name: "Export presentation", exact: true });
    await expect(exportButton).toBeDisabled();

    const imageBytes = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 120;
      canvas.height = 80;
      const drawing = canvas.getContext("2d")!;
      drawing.fillStyle = "#0b6270";
      drawing.fillRect(0, 0, 120, 80);
      drawing.fillStyle = "#fcd35d";
      drawing.fillRect(40, 10, 40, 60);
      return canvas.toDataURL("image/png").split(",")[1]!;
    });
    await page
      .getByRole("textbox", { name: "New image description", exact: true })
      .fill("Export diagram");
    await page.getByLabel("Add native image", { exact: true }).setInputFiles({
      name: "synthetic-export-diagram.png",
      mimeType: "image/png",
      buffer: Buffer.from(imageBytes, "base64"),
    });
    await expect
      .poll(async () => {
        const first = (await readE01Record(page, record.id)).draft.blocks[0];
        return (
          first?.kind === "content" && first.scene?.nodes.some((node) => node.type === "image")
        );
      })
      .toBe(true);
    const publication = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${record.id}/publish`,
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    expect((await publication).status()).toBe(200);
    await expect(exportButton).toBeEnabled();
    const publishedRecord = await (
      await page.request.get(`${e01ApiUrl}/v1/presentations/${record.id}`)
    ).json();
    const versionId = publishedRecord.presentation.currentVersionId as string;

    // A later draft must never enter a download of the published version.
    const current = await readE01Record(page, record.id);
    const draft = structuredClone(current.draft);
    const first = draft.blocks[0]!;
    if (first.kind !== "content") throw new Error("Expected content");
    const titleNode = first.scene!.nodes.find(
      (node) => node.type === "text" && node.role === "title",
    );
    if (titleNode?.type !== "text") throw new Error("Expected title");
    titleNode.text = "UNPUBLISHED export change";
    const saved = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
      data: {
        draft,
        expectedRevision: current.draftRevision,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(saved.status()).toBe(200);

    await exportButton.click();
    const dialog = page.getByRole("dialog", { name: "Export presentation", exact: true });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    const violations = await new AxeBuilder({ page }).include("dialog[open]").analyze();
    expect(violations.violations).toEqual([]);
    const files = new Map<string, Buffer>();
    for (const format of ["pdf", "png", "html"]) {
      await dialog.getByRole("combobox", { name: "Format", exact: true }).selectOption(format);
      if (format === "png") {
        const pages = dialog.getByRole("combobox", { name: "Published page", exact: true });
        await expect(pages.locator("option")).toHaveCount(3);
        await pages.selectOption(opening.id);
        await expect(pages).not.toContainText(/HIDDEN|UNPUBLISHED/);
      }
      const request = page.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          new URL(request.url()).pathname === `/v1/presentations/${record.id}/exports`,
      );
      const download = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "Download export", exact: true }).click();
      expect((await request).postDataJSON()).toEqual({
        versionId,
        format,
        ...(format === "png" ? { blockId: opening.id } : {}),
      });
      const file = await download;
      expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
      const output = info.outputPath(`presentation.${format}`);
      await file.saveAs(output);
      files.set(format, await readFile(output));
      await expect(
        dialog.getByRole("button", { name: "Download export", exact: true }),
      ).toBeEnabled();
    }
    expect(files.get("pdf")!.subarray(0, 5).toString()).toBe("%PDF-");
    expect(
      files
        .get("pdf")!
        .toString("latin1")
        .match(/\/Type\s*\/Page\b/g),
    ).toHaveLength(3);
    const png = files.get("png")!;
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 720]);
    const html = files.get("html")!.toString("utf8");
    expect(
      html.match(
        /PRIVATE(?: export| E01)|HIDDEN export planning|UNPUBLISHED export change|isCorrect|speakerNotes|<script\b/i,
      ),
    ).toBeNull();
    const readable = await context.newPage();
    const external: string[] = [];
    await readable.route(/^https?:/, (route) => {
      external.push(route.request().url());
      return route.abort();
    });
    await readable.setContent(html);
    await expect(
      readable.getByText("Public detail body stays readable in HTML.", { exact: true }),
    ).toBeVisible();
    await expect(readable.getByRole("table").first()).toBeVisible();
    await expect(
      readable.getByText("West recorded twice the attendance of East.", { exact: true }),
    ).toBeVisible();
    await expect(readable.getByText("Published review question", { exact: true })).toBeVisible();
    expect(await readable.locator("script,iframe,form,input").count()).toBe(0);
    expect(
      await readable
        .locator("img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    ).toBe(true);
    expect((await new AxeBuilder({ page: readable }).analyze()).violations).toEqual([]);
    expect(external).toEqual([]);
    await readable.screenshot({ path: info.outputPath("readable-export.png"), fullPage: true });
    await page.screenshot({ path: info.outputPath("export-dialog.png"), fullPage: true });
    await readable.close();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(exportButton).toBeFocused();

    // Wrapped commands must remain reachable when the viewport narrows after mounting.
    await page.setViewportSize({ width: 320, height: 780 });
    const openInspector = page.getByRole("button", { name: "Open inspector", exact: true });
    if (await openInspector.isVisible()) await openInspector.click();
    await expect
      .poll(async () => {
        const header = await page.getByRole("banner").boundingBox();
        const inspector = await page
          .getByRole("complementary", { name: /inspector/i })
          .boundingBox();
        return Boolean(header && inspector && inspector.y >= header.y + header.height - 1);
      })
      .toBe(true);
    await page.screenshot({ path: info.outputPath("compact-header.png"), fullPage: true });
    await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
  });
}
