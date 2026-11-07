import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
  selectE01Body,
  type E01Record,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

const enabled = process.env.BETA_E2E_AUTHORING === "true";
const providerPort = Number(process.env.BETA_E2E_AUTHORING_PORT ?? 4202);
const original = "Choose one action and review the plan together.";
const french = "Choisissez une action et examinez le plan ensemble.";
const privateMarker = "PRIVATE_TRANSLATION_NOT_IN_PROMPT";
const otherObject = "OTHER_OBJECT_NOT_IN_TRANSLATION";
let provider: Server | undefined;
const calls: Array<{ input: Record<string, string>; maxTokens: number; raw: string }> = [];
test.skip(!enabled, "Translation requires the owned loopback authoring fixture.");
test.use({ actionTimeout: 30_000 });
test.beforeAll(async () => {
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
        const body = JSON.parse(raw) as {
          max_tokens: number;
          messages: Array<{ role: string; content: string }>;
        };
        const input = JSON.parse(body.messages.find((entry) => entry.role === "user")!.content);
        calls.push({ input, maxTokens: body.max_tokens, raw });
        response.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ text: input.text === original ? french : input.text }),
                },
              },
            ],
          }),
        );
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
function body(record: E01Record) {
  const block = record.draft.blocks[0];
  if (block?.kind !== "content") throw new Error("Expected native content");
  const node = block.scene?.nodes.find((node) => node.id === "Body:Translation");
  if (node?.type !== "text") throw new Error("Expected exact translation target");
  return { block, node };
}
async function fixture(page: Page, marked = false) {
  const slide = e01Slide(otherObject);
  slide.speakerNotes = privateMarker;
  slide.citations = [{ locator: "Earlier source", excerpt: "PRIVATE earlier translation context" }];
  slide.sourceDisclosure = {
    sourceName: "Original import",
    sourceDigest: "c".repeat(64),
    provider: "Original provider",
    model: "original-visual-import",
  };
  const node = slide.scene!.nodes[1]!;
  if (node.type !== "text") throw new Error("Expected body");
  node.id = "Body:Translation";
  node.text = marked ? "Polling Pops" : original;
  if (marked) {
    node.lang = "fr";
    slide.scene!.schemaVersion = 7;
    const title = slide.scene!.nodes[0]!;
    if (title.type === "text") title.lang = "es";
  }
  slide.scene!.readingOrder[1] = node.id;
  return createE01Deck(page, [slide], marked ? 16 : 14);
}
async function closeDrawers(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) > 920) return;
  await expect(page.getByRole("button", { name: "Arrange space", exact: true })).toBeVisible();
  for (const name of ["Hide inspector", "Collapse map"]) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
}
async function openTranslation(page: Page, recover = false) {
  if (recover)
    await page.getByRole("button", { name: "Resume text assistance", exact: true }).click();
  else {
    await closeDrawers(page);
    await selectE01Body(page);
    await page.getByRole("button", { name: "Translate text", exact: true }).click();
  }
  const dialog = page.getByRole("dialog", { name: "Translate text", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function reviewTranslation(page: Page) {
  const region = page.getByRole("region", { name: "Review proposed text", exact: true });
  await expect(region).toBeVisible({ timeout: 60_000 });
  await page
    .getByRole("checkbox", {
      name: "I reviewed the complete original and translated wording, including meaning, terminology, unsupported claims and existing citations.",
      exact: true,
    })
    .check();
}
const translationConfirmation = (page: Page) =>
  page.getByRole("checkbox", {
    name: "I reviewed the complete original and translated wording, including meaning, terminology, unsupported claims and existing citations.",
    exact: true,
  });
async function used(page: Page, id: string) {
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-text-assistance/status?presentationId=${id}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()).status.used as number;
}
async function safeRecovery(page: Page) {
  const value = await page.evaluate(() =>
    Object.entries(sessionStorage)
      .filter(([key]) => key.startsWith("presentation-text-assistance:v1:"))
      .map(([, value]) => value)
      .join("\n"),
  );
  for (const text of [original, french, "Polling Pops", privateMarker, otherObject])
    expect(value).not.toContain(text);
  expect(value).toContain('"targetLanguage"');
  expect(value).toContain('"sourceLanguage"');
}
for (const suffix of ["", " @mobile"]) {
  test(`translation changes one reviewed object and retains its language through Undo and reload${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const record = await fixture(page);
    const baseline = await used(page, record.id);
    const publication = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
      { data: { expectedDraftRevision: record.draftRevision } },
    );
    expect(publication.status()).toBe(200);
    const versionId = (await publication.json()).version.id;
    await enterE01Editor(page, record.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    const dialog = await openTranslation(page);
    const generate = dialog.getByRole("button", {
      name: "Generate translation proposal",
      exact: true,
    });
    await expect(generate).toBeDisabled();
    expect(await used(page, record.id)).toBe(baseline);
    await dialog.getByRole("combobox", { name: "Target language", exact: true }).selectOption("fr");
    await generate.click();
    await reviewTranslation(page);
    await expect(dialog).toContainText(original);
    await expect(dialog.getByText(french, { exact: true })).toHaveAttribute("lang", "fr");
    await expect(dialog).toContainText("PRIVATE earlier translation context");
    expect((await readE01Record(page, record.id)).draft).toEqual(record.draft);
    await safeRecovery(page);
    await page.setViewportSize({ width: 320, height: 760 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath("translation-review-320.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Apply reviewed translation", exact: true }).click();
    await expect(dialog).toBeHidden();
    const applied = await readE01Record(page, record.id);
    expect(body(applied).node).toEqual({ ...body(record).node, text: french, lang: "fr" });
    expect(applied.draft.schemaVersion).toBe(16);
    expect(body(applied).block.scene!.schemaVersion).toBe(7);
    expect(body(applied).block.scene!.nodes[0]).toEqual(body(record).block.scene!.nodes[0]);
    expect(body(applied).block.citations).toEqual(body(record).block.citations);
    expect(body(applied).block.sourceDisclosure).toEqual(body(record).block.sourceDisclosure);
    expect(body(applied).block.speakerNotes).toBe(privateMarker);
    expect(body(applied).block.textAssistance).toMatchObject({
      operation: "translate",
      targetLanguage: "fr",
      sourceLanguage: null,
    });
    await closeDrawers(page);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, record.id)).draft)
      .toEqual({ ...record.draft, schemaVersion: 16, sections: record.draft.sections ?? [] });
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, record.id)).draft)
      .toEqual(applied.draft);
    await page.reload();
    await closeDrawers(page);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
    await expect(preview.getByText(french, { exact: true })).toHaveAttribute("lang", "fr");
    expect(await used(page, record.id)).toBe(baseline + 1);
    const latest = await page.request.get(`${e01ApiUrl}/v1/presentations/${record.id}`);
    expect((await latest.json()).presentation.currentVersionId).toBe(versionId);
    const sent = calls.filter((call) => call.input.text === original);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.input).toEqual({
      text: original,
      role: "body",
      operation: "translate",
      targetLanguage: "fr",
    });
    expect(sent[0]!.maxTokens).toBe(2048);
    for (const text of [
      privateMarker,
      otherObject,
      "PRIVATE earlier translation context",
      "Original provider",
      "sourceLanguage",
    ])
      expect(sent[0]!.raw).not.toContain(text);
  });

  test(`translation retries retain exact language intent and reject changed source annotations${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await signInBeta(page);
    const record = await fixture(page, true);
    const baseline = await used(page, record.id);
    await enterE01Editor(page, record.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    if ((page.viewportSize()?.width ?? 1280) <= 920)
      await page.getByRole("button", { name: "Open map", exact: true }).click();
    await expect(
      page
        .getByRole("complementary", { name: "Presentation map", exact: true })
        .getByText(otherObject, { exact: true }),
    ).toHaveAttribute("lang", "es");
    await closeDrawers(page);
    let dialog = await openTranslation(page);
    await expect(dialog.getByRole("option", { name: "French", exact: true })).toHaveAttribute(
      "disabled",
      "",
    );
    await dialog.getByRole("combobox", { name: "Target language", exact: true }).selectOption("en");
    const createPath = `${e01ApiUrl}/v1/presentation-text-assistance/jobs`;
    let droppedCreate = false;
    const creations: string[] = [];
    await page.route(createPath, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      creations.push(route.request().postData()!);
      if (!droppedCreate) {
        droppedCreate = true;
        expect((await route.fetch()).status()).toBe(202);
        await route.abort("failed");
      } else await route.continue();
    });
    await dialog
      .getByRole("button", { name: "Generate translation proposal", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Recover or retry saved request", exact: true }),
    ).toBeEnabled();
    await safeRecovery(page);
    await page.reload();
    dialog = await openTranslation(page, true);
    await dialog
      .getByRole("button", { name: "Recover or retry saved request", exact: true })
      .click();
    await reviewTranslation(page);
    expect(creations).toHaveLength(1);
    await page.unroute(createPath);
    await dialog
      .getByRole("button", { name: "Reload exact target and review", exact: true })
      .click();
    await expect(translationConfirmation(page)).not.toBeChecked();
    await reviewTranslation(page);
    const applyPath = `${e01ApiUrl}/v1/presentations/${record.id}/text-assistance/apply`;
    const applications: string[] = [];
    await page.route(applyPath, async (route) => {
      applications.push(route.request().postData()!);
      if (applications.length === 1) {
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "Apply reviewed translation", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Retry exact text application", exact: true }),
    ).toBeEnabled();
    const accepted = await readE01Record(page, record.id);
    expect(body(accepted).node.text).toBe("Polling Pops");
    expect(body(accepted).node.lang).toBe("en");
    await page.reload();
    dialog = await openTranslation(page, true);
    await dialog.getByRole("button", { name: "Retry exact text application", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(applications).toHaveLength(2);
    expect(applications[1]).toBe(applications[0]);
    expect((await readE01Record(page, record.id)).draftRevision).toBe(accepted.draftRevision);
    expect(await used(page, record.id)).toBe(baseline + 1);
    await page.unroute(applyPath);
    dialog = await openTranslation(page);
    await dialog.getByRole("combobox", { name: "Target language", exact: true }).selectOption("fr");
    await dialog
      .getByRole("button", { name: "Generate translation proposal", exact: true })
      .click();
    await reviewTranslation(page);
    const current = await readE01Record(page, record.id);
    const changed = structuredClone(current.draft);
    const target = body({ ...current, draft: changed }).node;
    target.lang = "de";
    const update = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
      data: {
        schemaVersion: 2,
        draft: changed,
        expectedRevision: current.draftRevision,
        mutationId: randomUUID(),
      },
    });
    expect(update.status()).toBe(200);
    const stale = page.waitForResponse(
      (response) => response.url() === applyPath && response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Apply reviewed translation", exact: true }).click();
    expect((await stale).status()).toBe(409);
    await dialog
      .getByRole("button", { name: "Reload exact target and review", exact: true })
      .click();
    await expect(dialog).toContainText("language was changed or deleted");
    expect(body(await readE01Record(page, record.id)).node.lang).toBe("de");
    await dialog.getByRole("button", { name: "Discard proposal", exact: true }).click();
    await page.reload();
    expect(await used(page, record.id)).toBe(baseline + 2);
    expect(body(await readE01Record(page, record.id)).node.lang).toBe("de");
  });
}
