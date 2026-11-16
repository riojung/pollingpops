import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { questionStartersCopy } from "../../apps/web/lib/i18n/question-starters-copy";
import { sourceWorkflowsCopy } from "../../apps/web/components/presentation/source-workflows-copy";
import { createE01Deck, e01ApiUrl, e01Slide, readE01Record } from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 20_000 });
const title = "Préparer le lancement";
const points = ["Clarifier le périmètre", "Choisir une équipe", "Fixer une date"];
const copy = questionStartersCopy("ko-KR");

async function setLocale(page: Page, locale: "en-CA" | "ko-KR") {
  expect(
    (await page.request.put(`${e01ApiUrl}/v1/account/locale`, { data: { locale } })).status(),
  ).toBe(200);
  await page
    .context()
    .addCookies([
      { name: "openround-locale", value: locale, url: new URL(page.url()).origin, sameSite: "Lax" },
    ]);
}

async function closePanels(page: Page) {
  for (const id of ["presentation-object-inspector", "presentation-slide-navigator"]) {
    const toggle = page.locator(`button[aria-controls="${id}"]`);
    if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
  }
}

async function openStarters(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) <= 920) await closePanels(page);
  const summary = page.getByTitle(
    sourceWorkflowsCopy("ko-KR")("Slide ideas & audience activities"),
    { exact: true },
  );
  if ((await summary.locator("xpath=ancestor::details[1]").getAttribute("open")) === null)
    await summary.click();
  await page.getByRole("button", { name: copy("Question starters"), exact: true }).click();
  const dialog = page.getByRole("dialog", { name: copy("Review question starters"), exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function used(page: Page, id: string) {
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-text-assistance/status?presentationId=${id}`,
  );
  expect(response.status()).toBe(200);
  return ((await response.json()).status as { used: number }).used;
}

async function qualify(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean question starters preserve English templates and private French source ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const source = e01Slide(title, true);
    const trailing = e01Slide("Original closing slide");
    source.speakerNotes = "PRIVATE_STARTER_NOTES";
    source.citations = [{ locator: "PRIVATE earlier import", excerpt: "PRIVATE_EARLIER_CITATION" }];
    source.sourceDisclosure = {
      sourceName: "PRIVATE earlier source",
      sourceDigest: "a".repeat(64),
      provider: "PRIVATE previous provider",
      model: "old-import",
    };
    const heading = source.scene!.nodes[0]!;
    const body = source.scene!.nodes[1]!;
    if (heading.type !== "text" || body.type !== "text") throw new Error("Expected source text");
    heading.lang = "fr";
    body.id = "Body:OriginalFrench";
    body.lang = "fr";
    body.text = points.join("\n");
    body.richText = {
      paragraphs: points.map((text) => ({ kind: "bullet" as const, runs: [{ text, bold: true }] })),
    };
    source.scene!.schemaVersion = 7;
    source.scene!.nodes.push({
      id: "private-detail",
      type: "dialog",
      scope: "local",
      label: "PRIVATE_DETAIL_LABEL",
      detailTitle: "PRIVATE_DETAIL_TITLE",
      body: "CLOSED_DETAIL_NOT_A_QUESTION_SOURCE",
      frame: { x: 8, y: 80, width: 84, height: 12 },
    });
    source.scene!.readingOrder = [body.id, heading.id, "private-detail"];
    const created = await createE01Deck(page, [source, trailing], 16);
    const sectionId = randomUUID();
    const draft = {
      ...created.draft,
      sections: [
        { id: sectionId, title: "Original launch section", blockIds: [source.id, trailing.id] },
      ],
      spatial: {
        schemaVersion: 1,
        frames: [
          { blockId: source.id, x: 100, y: 80, width: 1280, height: 720 },
          { blockId: trailing.id, x: 1500, y: 80, width: 1280, height: 720 },
        ],
      },
    };
    expect(
      (
        await page.request.put(`${e01ApiUrl}/v1/presentations/${created.id}/draft`, {
          data: {
            schemaVersion: 2,
            draft,
            expectedRevision: created.draftRevision,
            mutationId: randomUUID(),
          },
        })
      ).status(),
    ).toBe(200);
    const original = await readE01Record(page, created.id);
    const baseline = await used(page, original.id);
    const jobs: string[] = [];
    const writes: string[] = [];
    page.on("request", (request) => {
      if (/\/v1\/(?:presentation-(?:text-)?assistance|authoring)\/jobs/.test(request.url()))
        jobs.push(request.url());
      if (
        request.method() === "PUT" &&
        new URL(request.url()).pathname === `/v1/presentations/${original.id}/draft`
      )
        writes.push(request.postData() ?? "");
    });
    try {
      await setLocale(page, "ko-KR");
      await page.goto(`/presentation/${original.id}`);
      await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
      let dialog = await openStarters(page);
      const entry = page.getByRole("region", {
        name: copy("Local question starters"),
        exact: true,
      });
      await expect(entry).toHaveAttribute("lang", "ko-KR");
      await expect(dialog.getByRole("radio")).toHaveCount(3);
      await expect(
        dialog.getByRole("group", { name: copy("Choose a question starter"), exact: true }),
      ).toBeVisible();
      await expect(dialog).toContainText(
        copy(
          "Created locally. No AI service or allowance is used. Prompts use English scaffolding and your slide’s wording. Other objects, images, tables, charts and closed interaction content are not interpreted.",
        ),
      );
      const privateSource = dialog.getByRole("region", {
        name: copy("Private source context"),
        exact: true,
      });
      await expect(privateSource).toHaveAttribute("lang", "ko-KR");
      await expect(privateSource.locator("article p")).toHaveText([body.text, title]);
      await expect(privateSource.locator("article p").first()).toHaveAttribute("lang", "fr");
      await expect(privateSource.locator("article p").last()).toHaveAttribute("lang", "fr");
      expect(
        await privateSource
          .locator("article")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("data-question-starter-source-node")),
          ),
      ).toEqual([body.id, heading.id]);
      expect(await dialog.innerText()).not.toMatch(/PRIVATE_|CLOSED_DETAIL/);
      await dialog.locator('input[value="clarity"]').check();
      const clarity = dialog.getByRole("region", { name: copy("Question preview"), exact: true });
      await expect(clarity).toContainText(copy("Clarity rating"));
      await expect(clarity.locator("dd")).toHaveText(["1 — Not clear yet", "5 — Very clear"]);
      for (const bound of await clarity.locator("dd").all())
        await expect(bound).toHaveAttribute("lang", "en-CA");
      await expect(clarity.locator('p[lang="en-CA"]')).toHaveText(
        `How clear is “${title}” to you?`,
      );
      await expect(clarity.locator('span[lang="fr"]')).toHaveText(title);
      await qualify(page);
      await page.screenshot({
        path: info.outputPath("question-starters-korean-clarity.png"),
        fullPage: true,
      });
      await dialog.getByRole("button", { name: copy("Cancel"), exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("button", { name: copy("Question starters"), exact: true }),
      ).toBeFocused();
      expect(writes).toHaveLength(0);
      expect((await readE01Record(page, original.id)).draft).toEqual(original.draft);
      dialog = await openStarters(page);
      await dialog.locator('input[value="priority"]').check();
      const preview = dialog.getByRole("region", { name: copy("Question preview"), exact: true });
      await expect(preview).toHaveAttribute("lang", "ko-KR");
      await expect(preview).toContainText(copy("Opinion · 0 points · no correct answer"));
      await expect(preview.locator("ol li")).toHaveText(points);
      for (const option of await preview.locator("ol li").all())
        await expect(option).toHaveAttribute("lang", "fr");
      const prompt = `Which point from “${title}” should we discuss next?`;
      await expect(preview.locator('p[lang="en-CA"]')).toHaveText(prompt);
      await expect(preview.locator('span[lang="fr"]')).toHaveText(title);
      await expect
        .poll(() => dialog.evaluate((node) => node.scrollWidth - node.clientWidth))
        .toBeLessThanOrEqual(1);
      await qualify(page);
      await page.screenshot({
        path: info.outputPath("question-starters-korean-priority.png"),
        fullPage: true,
      });
      await dialog
        .getByRole("button", { name: copy("Insert reviewed question"), exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await expect
        .poll(async () => (await readE01Record(page, original.id)).draftRevision)
        .toBe(original.draftRevision + 1);
      const inserted = await readE01Record(page, original.id);
      expect(inserted.draft.blocks).toHaveLength(3);
      expect(inserted.draft.blocks[0]).toEqual(original.draft.blocks[0]);
      expect(inserted.draft.blocks[2]).toEqual(original.draft.blocks[1]);
      const question = inserted.draft.blocks[1];
      if (question?.kind !== "question" || question.question.type !== "poll")
        throw new Error("Expected reviewed local poll");
      expect(question.question).toMatchObject({
        prompt,
        purpose: "opinion",
        confidence: "off",
        delivery: "main",
        basePoints: 0,
        linkedRecheckQuestionId: null,
      });
      expect(question.question.choices.map((choice) => choice.label)).toEqual(points);
      expect(question.question.choices.every((choice) => !choice.isCorrect)).toBe(true);
      expect(question.sourceDisclosure).toMatchObject({
        provider: "local",
        model: "question-starters-v1",
      });
      expect(question.citations?.map((citation) => citation.excerpt)).toEqual([title, body.text]);
      expect(JSON.stringify(question)).not.toMatch(/PRIVATE_|CLOSED_DETAIL/);
      expect(inserted.draft.sections![0]!.blockIds).toEqual([source.id, question.id, trailing.id]);
      expect(
        inserted.draft.spatial!.frames.filter((frame) => frame.blockId !== question.id),
      ).toEqual(original.draft.spatial!.frames);
      await closePanels(page);
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect
        .poll(async () => (await readE01Record(page, original.id)).draft)
        .toEqual(original.draft);
      await page.getByRole("button", { name: "다시 실행", exact: true }).click();
      await expect
        .poll(async () => (await readE01Record(page, original.id)).draft)
        .toEqual(inserted.draft);
      await page.reload();
      await closePanels(page);
      expect((await readE01Record(page, original.id)).draft).toEqual(inserted.draft);
      expect(await used(page, original.id)).toBe(baseline);
      expect(jobs).toEqual([]);
      await qualify(page);
      await page.screenshot({
        path: info.outputPath("question-starters-korean-inserted.png"),
        fullPage: true,
      });
    } finally {
      await setLocale(page, "en-CA");
    }
  });
}
