import { createServer, type Server } from "node:http";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING } from "../../packages/contracts/src/index.ts";
import type { QuestionSuggestionsRecovery } from "../../apps/web/lib/presentation-question-suggestions-client";
import { questionSuggestionsCopy } from "../../apps/web/components/presentation/question-suggestions-copy";
import { sourceWorkflowsCopy } from "../../apps/web/components/presentation/source-workflows-copy";
import { createE01Deck, e01ApiUrl, e01Slide, readE01Record } from "./presentation-e01-support";
import {
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
const title = "Préparer le lancement";
const points = ["Clarifier le périmètre", "Choisir une équipe", "Fixer une date"];
const discussion = "How could clarifying scope help your launch team?";
const reflection = "What would you consider when choosing a launch team?";
const privateMarker = "PRIVATE_LOCALIZED_DISCUSSION_CONTEXT";
const closedMarker = "CLOSED_LOCALIZED_DISCUSSION_DETAIL";
let provider: Server | undefined;
const providerCalls: Array<{ raw: string; input: unknown; maxTokens: number }> = [];

test.skip(
  !enabled,
  "Localized discussion suggestions require the owned loopback authoring fixture.",
);
test.use({ actionTimeout: 25_000 });
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
        const body = JSON.parse(raw) as {
          max_tokens: number;
          messages: Array<{ role: string; content: string }>;
        };
        const input: unknown = JSON.parse(
          body.messages.find((entry) => entry.role === "user")!.content,
        );
        providerCalls.push({ raw, input, maxTokens: body.max_tokens });
        response.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    suggestions: [
                      {
                        kind: "discussion",
                        prompt: discussion,
                        citations: [{ locator: "body 1 paragraph 1", excerpt: points[0] }],
                      },
                      {
                        kind: "reflection",
                        prompt: reflection,
                        citations: [{ locator: "body 1 paragraph 2", excerpt: points[1] }],
                      },
                    ],
                  }),
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

async function fixture(page: Page) {
  const slide = e01Slide(title, true);
  slide.id = slide.id.toUpperCase();
  slide.speakerNotes = privateMarker;
  slide.citations = [{ locator: "Earlier private import", excerpt: privateMarker }];
  slide.sourceDisclosure = {
    sourceName: privateMarker,
    sourceDigest: "a".repeat(64),
    provider: "Earlier private provider",
    model: "earlier-import",
  };
  const scene = slide.scene!;
  scene.schemaVersion = 7;
  const heading = scene.nodes[0]!,
    body = scene.nodes[1]!;
  if (heading.type !== "text" || body.type !== "text")
    throw new Error("Expected native source text");
  heading.lang = "fr";
  body.id = "Body:LocalizedExactDiscussionSource";
  body.lang = "fr";
  body.text = points.join("\n");
  body.richText = {
    paragraphs: points.map((text) => ({ kind: "bullet" as const, runs: [{ text, bold: true }] })),
  };
  scene.readingOrder[1] = body.id;
  scene.nodes.push({
    id: "localized-closed-detail",
    type: "dialog",
    scope: "local",
    label: "More detail",
    detailTitle: "Private context",
    body: closedMarker,
    frame: { x: 8, y: 80, width: 84, height: 12 },
  });
  scene.readingOrder.push("localized-closed-detail");
  return createE01Deck(page, [slide], 16);
}

async function openSuggestions(page: Page, locale: "ko-KR" | "de-DE", resume = false) {
  const copy = questionSuggestionsCopy(locale);
  await closeSpecialistInspector(page);
  const map = page.locator('button[aria-controls="presentation-slide-navigator"]');
  if ((await map.getAttribute("aria-expanded")) === "true") await map.click();
  if (!resume) {
    const summary = page
      .locator("summary")
      .filter({ hasText: sourceWorkflowsCopy(locale)("Slide ideas & audience activities") });
    await expect(summary).toBeVisible();
    if ((await summary.locator("xpath=ancestor::details[1]").getAttribute("open")) === null)
      await summary.click();
  }
  await page
    .getByRole("button", {
      name: copy(resume ? "Resume discussion suggestions" : "Suggest discussion questions"),
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: copy("Review discussion suggestions"),
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("lang", locale);
  return dialog;
}

async function recovery(page: Page, presentationId: string) {
  const rows = await page.evaluate(
    (id) =>
      Object.entries(sessionStorage)
        .filter(
          ([key]) => key.startsWith("presentation-question-suggestions:") && key.endsWith(`:${id}`),
        )
        .map(([key, raw]) => ({ key, raw })),
    presentationId,
  );
  expect(rows).toHaveLength(1);
  const row = rows[0]!;
  for (const text of [title, ...points, discussion, reflection, privateMarker, closedMarker])
    expect(row.raw).not.toContain(text);
  return { ...row, value: JSON.parse(row.raw) as QuestionSuggestionsRecovery };
}

async function allowanceUsed(page: Page, presentationId: string) {
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-question-suggestions/status?presentationId=${presentationId}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()).status.used as number;
}

async function nativeDialogTabs(dialog: Locator, key: "Tab" | "Shift+Tab") {
  const observed: Array<{ tag: string | null; insideDialog: boolean }> = [];
  for (let step = 0; step < 4; step++) {
    await dialog.page().keyboard.press(key);
    const focus = await dialog.evaluate((modal) => {
      const active = modal.ownerDocument.activeElement;
      return {
        tag: active?.tagName ?? null,
        insideDialog: active !== null && modal.contains(active),
      };
    });
    observed.push(focus);
    // Native dialogs may visit browser chrome between their first and last controls.
    // Root sentinels are allowed; any background control still fails this assertion.
    expect(
      focus.insideDialog || focus.tag === "BODY" || focus.tag === "HTML",
      `${key} left the native dialog: ${JSON.stringify(observed)}`,
    ).toBe(true);
  }
  expect(
    observed.some((focus) => focus.insideDialog),
    `${key} never reached the native dialog: ${JSON.stringify(observed)}`,
  ).toBe(true);
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean discussion review preserves authored source and exact insertion recovery in German ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const record = await fixture(page);
    const baseline = await allowanceUsed(page, record.id);
    const callsBefore = providerCalls.length;
    const copy = questionSuggestionsCopy("ko-KR");
    const german = questionSuggestionsCopy("de-DE");
    const createBodies: string[] = [];
    const insertBodies: string[] = [];
    const createPath = "**/v1/presentation-question-suggestions/jobs";
    const insertPath = `**/v1/presentations/${record.id}/question-suggestions/insert`;
    let dropped = false;
    await page.route(createPath, async (route) => {
      if (route.request().method() === "POST") createBodies.push(route.request().postData()!);
      await route.continue();
    });
    await page.route(insertPath, async (route) => {
      insertBodies.push(route.request().postData()!);
      const result = await route.fetch();
      expect(result.status()).toBe(200);
      if (!dropped) {
        dropped = true;
        await route.abort("failed");
      } else await route.fulfill({ response: result });
    });
    try {
      await specialistLocale(page, "ko-KR");
      await page.goto(`/presentation/${record.id}`);
      let dialog = await openSuggestions(page, "ko-KR");
      await expect(
        dialog.getByRole("heading", { name: "토론 제안 검토", exact: true }),
      ).toBeVisible();
      await expect(dialog).toContainText(
        copy("One generation uses one AI job. Review and insertion use no additional job."),
      );
      const source = dialog.getByRole("region", {
        name: copy("Private source context"),
        exact: true,
      });
      await expect(source.getByText(title, { exact: true })).toHaveAttribute("lang", "fr");
      await expect(source).toContainText(points.join("\n"));
      await expect(dialog).not.toContainText(privateMarker);
      await expect(dialog).not.toContainText(closedMarker);
      expect(createBodies).toHaveLength(0);
      expect(insertBodies).toHaveLength(0);
      expect(providerCalls.slice(callsBefore)).toHaveLength(0);
      await dialog
        .getByRole("button", { name: copy("Generate discussion suggestions"), exact: true })
        .click();
      let review = dialog.getByRole("region", {
        name: copy("Review both suggested questions"),
        exact: true,
      });
      await expect(review).toBeVisible({ timeout: 60_000 });
      await expect(review).toHaveAttribute("lang", "ko-KR");
      await expect(review).toContainText(copy(PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING));
      for (const prompt of [discussion, reflection]) {
        const text = review.getByText(prompt, { exact: true });
        await expect(text).toBeVisible();
        await specialistLanguage(text, "en");
      }
      await expect(review.locator("blockquote")).toHaveText([points[0]!, points[1]!]);
      for (const quote of await review.locator("blockquote").all())
        await specialistLanguage(quote, "fr");
      await expect(review.getByText("body 1 paragraph 1", { exact: true })).toHaveAttribute(
        "lang",
        "en-CA",
      );
      await expect(review).toContainText(
        copy(
          "Both questions: Opinion · 0 points · confidence off · no correct answer · no linked recheck · 20-second response time. Participants write an open-text response.",
        ),
      );
      expect((await readE01Record(page, record.id)).draft).toEqual(record.draft);
      expect(insertBodies).toHaveLength(0);
      const insert = dialog.getByRole("button", {
        name: copy("Insert reviewed question"),
        exact: true,
      });
      await expect(insert).toBeDisabled();
      await review.getByRole("radio", { name: copy("Reflection question"), exact: true }).check();
      await expect(insert).toBeDisabled();
      const retained = await recovery(page, record.id);
      expect(retained.value.createBody).toBe(createBodies[0]);
      expect(JSON.parse(createBodies[0]!)).toMatchObject({
        outputLanguage: "en",
        sourceDigest: retained.value.sourceDigest,
      });
      expect(createBodies[0]).not.toContain("locale");
      const jobResponse = await page.request.get(
        `${e01ApiUrl}/v1/presentation-question-suggestions/jobs/${retained.value.jobId}?presentationId=${record.id}`,
      );
      expect(jobResponse.status()).toBe(200);
      const job = (await jobResponse.json()).job;
      await expect(
        review.getByText("beta-fixture / synthetic-source-fixture", { exact: true }),
      ).toHaveAttribute("lang", "");
      await expect(review.locator("time")).toHaveText(job.proposal.generatedAt);
      await expect(review.locator("time")).toHaveAttribute("datetime", job.proposal.generatedAt);
      const calls = providerCalls.slice(callsBefore);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.maxTokens).toBe(2048);
      expect(calls[0]!.input).toEqual({
        title,
        sections: points.map((text, index) => ({ locator: `body 1 paragraph ${index + 1}`, text })),
        outputLanguage: "en",
      });
      expect(calls[0]!.raw).not.toMatch(
        /PRIVATE_LOCALIZED_DISCUSSION_CONTEXT|CLOSED_LOCALIZED_DISCUSSION_DETAIL|Body:LocalizedExactDiscussionSource|sourceDigest|speakerNotes|Earlier private provider|earlier-import/,
      );
      expect(await allowanceUsed(page, record.id)).toBe(baseline + 1);
      await page.setViewportSize({ width: 320, height: 844 });
      expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
      const close = dialog.getByRole("button", { name: copy("Close"), exact: true });
      await close.focus();
      await expect(close).toBeFocused();
      await page
        .locator("[data-question-suggestions-trigger]")
        .evaluate((element) => (element as HTMLElement).focus());
      await expect(close).toBeFocused();
      await nativeDialogTabs(dialog, "Tab");
      await nativeDialogTabs(dialog, "Shift+Tab");
      expect(
        await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await specialistQuality(page);
      await page.screenshot({
        path: info.outputPath("korean-discussion-review-320.png"),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(page.locator("[data-question-suggestions-trigger]")).toBeFocused();
      expect((await recovery(page, record.id)).raw).toBe(retained.raw);
      dialog = await openSuggestions(page, "ko-KR", true);
      const keyboardClose = dialog.getByRole("button", { name: copy("Close"), exact: true });
      await keyboardClose.focus();
      await expect(keyboardClose).toBeFocused();
      await keyboardClose.press("Enter");
      await expect(dialog).toBeHidden();
      await expect(page.locator("[data-question-suggestions-resume]")).toBeFocused();
      expect((await recovery(page, record.id)).raw).toBe(retained.raw);
      expect(insertBodies).toHaveLength(0);
      dialog = await openSuggestions(page, "ko-KR", true);
      review = dialog.getByRole("region", {
        name: copy("Review both suggested questions"),
        exact: true,
      });
      await review
        .getByRole("checkbox", {
          name: copy(
            "I reviewed both complete questions, their settings and exact source excerpts, including unsupported framing or claims.",
          ),
          exact: true,
        })
        .check();
      await expect(
        dialog.getByRole("button", { name: copy("Insert reviewed question"), exact: true }),
      ).toBeEnabled();
      expect(insertBodies).toHaveLength(0);
      await dialog
        .getByRole("button", { name: copy("Insert reviewed question"), exact: true })
        .click();
      await expect(
        dialog.getByRole("button", { name: copy("Retry exact insertion"), exact: true }),
      ).toBeEnabled();
      expect(insertBodies).toHaveLength(1);
      const uncertain = await recovery(page, record.id);
      expect(uncertain.value.insertBody).toBe(insertBodies[0]);
      const accepted = await readE01Record(page, record.id);
      expect(accepted.draft.blocks).toHaveLength(2);
      expect(accepted.draft.blocks[0]).toEqual(record.draft.blocks[0]);
      const inserted = accepted.draft.blocks[1];
      if (inserted?.kind !== "question") throw new Error("Expected reviewed question insertion");
      expect(inserted.question).toMatchObject({
        prompt: reflection,
        type: "open_text",
        purpose: "opinion",
        confidence: "off",
        basePoints: 0,
        linkedRecheckQuestionId: null,
        timeLimitSeconds: 20,
      });
      expect(inserted.citations).toEqual([{ locator: "body 1 paragraph 2", excerpt: points[1] }]);
      expect(inserted.sourceDisclosure).toMatchObject({
        sourceName: title,
        provider: "beta-fixture",
        model: "synthetic-source-fixture",
      });
      expect(inserted.sourceDisclosure?.conversionNotes?.[0]).toBe(
        `${PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING} Source slide ${retained.value.blockId}.`,
      );
      await specialistLocale(page, "de-DE");
      await page.reload();
      await expect(
        page.getByText(
          german(
            "A discussion question insertion receipt is outstanding. Recover it before editing this deck.",
          ),
          { exact: true },
        ),
      ).toBeVisible();
      expect((await recovery(page, record.id)).raw).toBe(uncertain.raw);
      dialog = await openSuggestions(page, "de-DE", true);
      await expect(
        dialog.getByRole("heading", { name: "Diskussionsvorschläge prüfen", exact: true }),
      ).toBeVisible();
      const exactRetry = dialog.getByRole("button", {
        name: german("Retry exact insertion"),
        exact: true,
      });
      await expect(exactRetry).toBeEnabled();
      await specialistQuality(page);
      await page.screenshot({
        path: info.outputPath("german-discussion-receipt-320.png"),
        fullPage: true,
      });
      await exactRetry.click();
      await expect(dialog).toBeHidden();
      expect(insertBodies).toHaveLength(2);
      expect(insertBodies[1]).toBe(insertBodies[0]);
      expect((await readE01Record(page, record.id)).draft).toEqual(accepted.draft);
      expect((await readE01Record(page, record.id)).draftRevision).toBe(record.draftRevision + 1);
      expect(createBodies).toHaveLength(1);
      expect(providerCalls.slice(callsBefore)).toHaveLength(1);
      expect(await allowanceUsed(page, record.id)).toBe(baseline + 1);
      expect(await page.evaluate((key) => sessionStorage.getItem(key), uncertain.key)).toBeNull();
      await specialistQuality(page);
    } finally {
      await page.unroute(createPath);
      await page.unroute(insertPath);
      await specialistLocale(page, "en-CA");
    }
  });
}
