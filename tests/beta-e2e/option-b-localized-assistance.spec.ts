import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { assistanceCopy } from "../../apps/web/components/presentation/assistance-copy";
import { textAssistanceCopy } from "../../apps/web/components/presentation/text-assistance-copy";
import { nativeEditorCopy } from "../../apps/web/components/presentation/native-editor-copy";
import { presentationCommandCopy } from "../../apps/web/components/presentation/presentation-command-copy";
import {
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  readE01Record,
  type E01Record,
} from "./presentation-e01-support";
import {
  specialistInspector,
  closeSpecialistInspector,
  specialistLanguage,
  specialistLocale,
  specialistQuality,
} from "./option-b-specialist-support";
import { signInBeta } from "./sign-in";

const enabled = process.env.BETA_E2E_AUTHORING === "true";
const providerPort = Number(
  process.env.BETA_E2E_AUTHORING_PORT ?? Number(process.env.BETA_E2E_API_PORT ?? 4200) + 2,
);
const original = "Revise el plan original y elija una acción para el equipo antes de compartirlo.";
const translated =
  "Examinez le plan original et choisissez une action pour l’équipe avant de le partager.";
const privateMarker = "PRIVATE_LOCALIZED_ASSISTANCE_NOT_SENT";
const outline = [
  "Review proposed slides is the authored name of this example, not an interface command.",
  "The original plan assigns an owner to every action before the team shares the draft.",
  "The team reviews exact evidence and decides together when the next update is ready.",
].join("\n");
let provider: Server | undefined;
const providerCalls: { input: Record<string, unknown>; raw: string }[] = [];

test.skip(!enabled, "Localized assistance requires the owned loopback provider.");
test.use({ actionTimeout: 20_000 });
test.beforeAll(async () => {
  if (!enabled) return;
  provider = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const body = JSON.parse(raw) as { messages: { role: string; content: string }[] };
        const input = JSON.parse(
          body.messages.find((entry) => entry.role === "user")!.content,
        ) as Record<string, unknown>;
        providerCalls.push({ input, raw });
        const source = input.outline as { locator: string; text: string }[] | undefined;
        const result = source
          ? {
              slides: Array.from({ length: Number(input.slideCount) }, (_, index) => ({
                title:
                  index === 0 ? "Review proposed slides" : `Original generated slide ${index + 1}`,
                body: source[index % source.length]!.text,
                citations: [
                  {
                    locator: source[index % source.length]!.locator,
                    excerpt: source[index % source.length]!.text,
                  },
                ],
              })),
            }
          : { text: input.operation === "translate" ? translated : String(input.text) };
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
      } catch {
        response.writeHead(400).end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    provider!.once("error", reject);
    provider!.listen(providerPort, "127.0.0.1", resolve);
  });
});
test.afterAll(async () => {
  provider?.closeIdleConnections();
  if (provider)
    await new Promise<void>((resolve, reject) =>
      provider!.close((error) => (error ? reject(error) : resolve())),
    );
  provider = undefined;
});

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean translation review keeps explicit language intent and exact recovery in German ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const copy = textAssistanceCopy("ko-KR");
    const slide = e01Slide("OTHER_OBJECT_NOT_SENT");
    slide.id = slide.id.toUpperCase();
    slide.speakerNotes = privateMarker;
    slide.citations = [
      { locator: "Original earlier source", excerpt: "PRIVATE_EARLIER_CITATION_NOT_SENT" },
    ];
    const node = slide.scene!.nodes[1]!;
    if (node.type !== "text") throw new Error("Expected body text");
    node.id = "Body:LocaleIntent";
    node.lang = "es";
    node.text = original;
    slide.scene!.schemaVersion = 7;
    slide.scene!.readingOrder[1] = node.id;
    const record = await createE01Deck(page, [slide], 16);
    const creations: Record<string, unknown>[] = [],
      applications: unknown[] = [];
    const createPath = `${e01ApiUrl}/v1/presentation-text-assistance/jobs`;
    const applyPath = `${e01ApiUrl}/v1/presentations/${record.id}/text-assistance/apply`;
    const callsBefore = providerCalls.length;
    let dropped = false;
    try {
      await specialistLocale(page, "ko-KR");
      await page.goto(`/presentation/${record.id}`);
      const inspector = await specialistInspector(page);
      await inspector
        .getByRole("combobox", { name: nativeEditorCopy("ko-KR")("Selected object"), exact: true })
        .selectOption(node.id);
      await inspector
        .getByRole("button", { name: nativeEditorCopy("ko-KR")("Translate text"), exact: true })
        .click();
      let dialog = page.getByRole("dialog", { name: copy("Translate text"), exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("lang", "ko-KR");
      await specialistLanguage(dialog.getByText(original, { exact: true }), "es");
      const language = dialog.getByRole("combobox", { name: copy("Target language"), exact: true });
      await language.selectOption("fr");
      await expect(language).toHaveValue("fr");
      await expect(language.locator('option[value="es"]')).toHaveJSProperty("disabled", true);
      await page.route(createPath, async (route) => {
        if (route.request().method() === "POST") creations.push(route.request().postDataJSON());
        await route.continue();
      });
      await dialog
        .getByRole("button", { name: copy("Generate translation proposal"), exact: true })
        .click();
      const proposal = dialog.getByRole("region", {
        name: copy("Review proposed text"),
        exact: true,
      });
      await expect(proposal).toBeVisible({ timeout: 60_000 });
      await expect(proposal.getByText(original, { exact: true })).toBeVisible();
      await specialistLanguage(proposal.getByText(original, { exact: true }), "es");
      await specialistLanguage(proposal.getByText(translated, { exact: true }), "fr");
      await expect(proposal).toContainText("PRIVATE_EARLIER_CITATION_NOT_SENT");
      await specialistLanguage(proposal.locator("blockquote").first(), "");
      expect(creations).toHaveLength(1);
      expect(creations[0]).toMatchObject({
        operation: "translate",
        nodeId: node.id,
        sourceLanguage: "es",
        targetLanguage: "fr",
      });
      const calls = providerCalls.slice(callsBefore);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.input).toMatchObject({
        operation: "translate",
        text: original,
        targetLanguage: "fr",
      });
      for (const marker of [
        privateMarker,
        "OTHER_OBJECT_NOT_SENT",
        "PRIVATE_EARLIER_CITATION_NOT_SENT",
      ])
        expect(calls[0]!.raw).not.toContain(marker);
      expect((await readE01Record(page, record.id)).draft).toEqual(record.draft);
      const apply = dialog.getByRole("button", {
        name: copy("Apply reviewed translation"),
        exact: true,
      });
      await expect(apply).toBeDisabled();
      await proposal.getByRole("checkbox").check();
      await expect(apply).toBeEnabled();
      await specialistQuality(page);
      await dialog.screenshot({ path: info.outputPath("korean-translation-review.png") });
      await page.route(applyPath, async (route) => {
        applications.push(route.request().postDataJSON());
        if (!dropped) {
          dropped = true;
          expect((await route.fetch()).status()).toBe(200);
          await route.abort("failed");
        } else await route.continue();
      });
      await apply.click();
      await expect(
        dialog.getByRole("button", { name: copy("Retry exact text application"), exact: true }),
      ).toBeEnabled();
      const accepted = await readE01Record(page, record.id);
      expect(target(accepted).node).toEqual({
        ...target(record).node,
        text: translated,
        lang: "fr",
      });
      expect(target(accepted).block.citations).toEqual(slide.citations);
      expect(target(accepted).block.speakerNotes).toBe(privateMarker);
      expect(target(accepted).block.textAssistance).toMatchObject({
        nodeId: node.id,
        operation: "translate",
        sourceLanguage: "es",
        targetLanguage: "fr",
      });
      await dialog.getByRole("button", { name: copy("Close"), exact: true }).click();
      await expect(
        page.getByRole("button", { name: copy("Resume text assistance"), exact: true }),
      ).toBeVisible();
      await specialistLocale(page, "de-DE");
      await page.reload();
      const german = textAssistanceCopy("de-DE");
      await page
        .getByRole("button", { name: german("Resume text assistance"), exact: true })
        .click();
      dialog = page.getByRole("dialog", { name: german("Translate text"), exact: true });
      await expect(dialog).toHaveAttribute("lang", "de-DE");
      await dialog
        .getByRole("button", { name: german("Retry exact text application"), exact: true })
        .click();
      await expect(dialog).toBeHidden();
      expect(applications).toHaveLength(2);
      expect(applications[1]).toEqual(applications[0]);
      const recovered = await readE01Record(page, record.id);
      expect(recovered.draftRevision).toBe(accepted.draftRevision);
      expect(recovered.draft).toEqual(accepted.draft);
      expect(providerCalls.slice(callsBefore)).toHaveLength(1);
      expect(creations).toHaveLength(1);
      const ideas = page.locator('summary[aria-label="Slide ideas & audience activities"]');
      if ((await ideas.locator("..").getAttribute("open")) === null) await ideas.click();
      await expect(
        page.getByRole("complementary", { name: german("Latest AI text edit"), exact: true }),
      ).toHaveAttribute("lang", "de-DE");
      await specialistQuality(page);
    } finally {
      await page.unroute(createPath);
      await page.unroute(applyPath);
      await specialistLocale(page, "en-CA");
    }
  });
}

async function openOutline(page: Page, locale: "ko-KR" | "de-DE", recover = false) {
  const copy = assistanceCopy(locale);
  const dialog = page.getByRole("dialog", { name: copy("Outline to slides"), exact: true });
  if (recover) {
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toHaveAttribute("lang", locale);
    return dialog;
  }
  if (!(await dialog.isVisible())) {
    if (!(await dialog.isVisible())) {
      await closeSpecialistInspector(page);
      const navigator = page.locator('button[aria-controls="presentation-slide-navigator"]');
      if ((await navigator.getAttribute("aria-expanded")) === "false") await navigator.click();
      const panel = page.locator("#presentation-slide-navigator");
      const commands = presentationCommandCopy(locale);
      const action = panel.getByRole("button", { name: commands.outlineToSlides, exact: true });
      if (!(await action.isVisible()))
        await panel.getByTitle(commands.insertImport, { exact: true }).click();
      await action.click();
    }
  }
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("lang", locale);
  return dialog;
}

function target(record: E01Record) {
  const block = record.draft.blocks[0];
  if (block?.kind !== "content" || !block.scene) throw new Error("Expected original slide");
  const node = block.scene.nodes.find((node) => node.id === "Body:LocaleIntent");
  if (node?.type !== "text") throw new Error("Expected exact text object");
  return { block, node };
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean outline review retains authored source and exact insertion recovery in German ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const copy = assistanceCopy("ko-KR");
    const slide = e01Slide("Original saved opening");
    slide.speakerNotes = privateMarker;
    slide.id = slide.id.toUpperCase();
    const record = await createE01Deck(page, [slide], 14);
    const callsBefore = providerCalls.length;
    const inserts: unknown[] = [];
    const insertPath = `${e01ApiUrl}/v1/presentations/${record.id}/blocks/assistance-proposals`;
    let dropped = false;
    try {
      await specialistLocale(page, "ko-KR");
      await page.goto(`/presentation/${record.id}`);
      let dialog = await openOutline(page, "ko-KR");
      const name = dialog.getByRole("textbox", { name: copy("Outline name"), exact: true });
      await name.fill("Original outline {source}");
      await specialistLanguage(name, "");
      await dialog.getByRole("textbox", { name: copy("Outline text"), exact: true }).fill(outline);
      await dialog
        .getByRole("combobox", { name: copy("Number of slides"), exact: true })
        .selectOption("3");
      expect((await readE01Record(page, record.id)).draft).toEqual(record.draft);
      await dialog
        .getByRole("button", { name: copy("Create slide proposal"), exact: true })
        .click();
      const proposal = dialog.getByRole("region", {
        name: copy("Review proposed slides"),
        exact: true,
      });
      await expect(proposal).toBeVisible({ timeout: 60_000 });
      await expect(
        proposal.getByRole("heading", { name: "Review proposed slides", exact: true }),
      ).toBeVisible();
      await specialistLanguage(
        proposal.getByRole("heading", { name: "Review proposed slides", exact: true }),
        "",
      );
      await expect(proposal.locator("blockquote").first()).toHaveText(outline.split("\n")[0]!);
      await specialistLanguage(proposal.locator("blockquote").first(), "");
      expect((await readE01Record(page, record.id)).draft).toEqual(record.draft);
      const calls = providerCalls.slice(callsBefore);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.input).toMatchObject({
        sourceName: "Original outline {source}",
        slideCount: 3,
      });
      expect(calls[0]!.raw).not.toContain(privateMarker);
      expect(calls[0]!.raw).not.toContain(slide.id);
      const boxes = proposal.getByRole("checkbox");
      await expect(boxes).toHaveCount(4);
      await boxes.nth(1).uncheck();
      await boxes.nth(2).uncheck();
      const insert = dialog.getByRole("button", {
        name: copy("Insert {count} reviewed slides", { count: 1 }),
        exact: true,
      });
      await expect(insert).toBeDisabled();
      await boxes.last().check();
      await expect(insert).toBeEnabled();
      await specialistQuality(page);
      await dialog.screenshot({ path: info.outputPath("korean-outline-review.png") });
      await page.route(insertPath, async (route) => {
        inserts.push(route.request().postDataJSON());
        if (!dropped) {
          dropped = true;
          expect((await route.fetch()).status()).toBe(200);
          await route.abort("failed");
        } else await route.continue();
      });
      await insert.click();
      await expect(
        dialog.getByRole("button", { name: copy("Retry exact insertion"), exact: true }),
      ).toBeEnabled();
      const accepted = await readE01Record(page, record.id);
      expect(accepted.draft.blocks).toHaveLength(2);
      expect(accepted.draft.blocks[0]).toEqual(record.draft.blocks[0]);
      await specialistLocale(page, "de-DE");
      await page.reload();
      dialog = await openOutline(page, "de-DE", true);
      await dialog
        .getByRole("button", {
          name: assistanceCopy("de-DE")("Retry exact insertion"),
          exact: true,
        })
        .click();
      await expect(dialog).toBeHidden();
      expect(inserts).toHaveLength(2);
      expect(inserts[1]).toEqual(inserts[0]);
      const recovered = await readE01Record(page, record.id);
      expect(recovered.draftRevision).toBe(accepted.draftRevision);
      expect(recovered.draft).toEqual(accepted.draft);
      expect(providerCalls.slice(callsBefore)).toHaveLength(1);
      await specialistQuality(page);
    } finally {
      await page.unroute(insertPath);
      await specialistLocale(page, "en-CA");
    }
  });
}
