import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  openSlideIdeas,
  e01Slide,
  createE01Deck,
  e01ApiUrl,
  enterE01Editor,
  readE01Record,
  selectE01Block,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 30_000 });
const title = "Préparer le lancement";
const points = ["Clarifier le périmètre", "Choisir une équipe", "Fixer une date"];
const privateNotes = "PRIVATE_STARTER_NOTES";
const oldCitation = "PRIVATE_EARLIER_CITATION";
const closedDetail = "CLOSED_DETAIL_NOT_A_QUESTION_SOURCE";
const sectionId = "10000000-0000-4000-8000-000000000011";
function source(many = false) {
  const block = e01Slide(title, true);
  block.id = block.id.toUpperCase();
  block.speakerNotes = privateNotes;
  block.citations = [{ locator: "Earlier import", excerpt: oldCitation }];
  block.sourceDisclosure = {
    sourceName: "PRIVATE earlier source",
    sourceDigest: "a".repeat(64),
    provider: "PRIVATE previous provider",
    model: "old-import",
  };
  const scene = block.scene!;
  scene.schemaVersion = 7;
  const heading = scene.nodes[0]!;
  const body = scene.nodes[1]!;
  if (heading.type !== "text" || body.type !== "text") throw new Error("Expected source text");
  heading.lang = "fr";
  body.id = "Body:ExactSource";
  body.lang = "fr";
  const lines = many
    ? Array.from({ length: 7 }, (_, index) => `Point complet ${index + 1}`)
    : points;
  body.text = lines.join("\n");
  body.richText = {
    paragraphs: lines.map((text) => ({ kind: "bullet" as const, runs: [{ text, bold: true }] })),
  };
  scene.readingOrder[1] = body.id;
  scene.nodes.push({
    id: "unread-detail",
    type: "dialog",
    scope: "local",
    label: "More detail",
    detailTitle: "Other content",
    body: closedDetail,
    frame: { x: 8, y: 80, width: 84, height: 12 },
  });
  scene.readingOrder.push("unread-detail");
  return block;
}
async function fixture(page: Page, many = false) {
  const block = source(many);
  const created = await createE01Deck(page, [block], 16);
  const draft = {
    ...created.draft,
    sections: [{ id: sectionId, title: "Launch decision", blockIds: [block.id] }],
    spatial: {
      schemaVersion: 1,
      frames: [{ blockId: block.id, x: 100, y: 80, width: 1280, height: 720 }],
    },
  };
  const saved = await page.request.put(`${e01ApiUrl}/v1/presentations/${created.id}/draft`, {
    data: {
      schemaVersion: 2,
      draft,
      expectedRevision: created.draftRevision,
      mutationId: randomUUID(),
    },
  });
  expect(saved.status()).toBe(200);
  return readE01Record(page, created.id);
}
async function closeDrawers(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) > 920) return;
  await expect(page.locator('summary[aria-label="More options"]')).toBeVisible();
  for (const name of ["Hide inspector", "Collapse map"]) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
}
async function openStarters(page: Page) {
  await openSlideIdeas(page);
  await page.getByRole("button", { name: "Question starters", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review question starters", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio").first()).toHaveCSS("width", "20px");
  return dialog;
}
async function used(page: Page, id: string) {
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-text-assistance/status?presentationId=${id}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()).status as { used: number; enabled: boolean };
}
async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
}
for (const suffix of ["", " @mobile"]) {
  test(`local poll starters preserve the slide and deliver an unscored opinion after review${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const original = await fixture(page);
    const baseline = await used(page, original.id);
    const published = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${original.id}/publish`,
      { data: { expectedDraftRevision: original.draftRevision } },
    );
    expect(published.status()).toBe(200);
    const originalVersion = (await published.json()).version.id;
    const jobs: string[] = [];
    page.on("request", (request) => {
      if (/\/v1\/(?:presentation-(?:text-)?assistance|authoring)\/jobs/.test(request.url()))
        jobs.push(request.url());
    });
    await enterE01Editor(page, original.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    let dialog = await openStarters(page);
    await expect(dialog).toContainText("No AI service or allowance is used");
    const privateSource = dialog.getByRole("region", {
      name: "Private source context",
      exact: true,
    });
    await expect(privateSource).toContainText(points[0]!);
    await expect(privateSource.getByText(title, { exact: true })).toHaveAttribute("lang", "fr");
    await expect(dialog).not.toContainText(privateNotes);
    await expect(dialog).not.toContainText(oldCitation);
    await expect(dialog).not.toContainText(closedDetail);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Question starters", exact: true }),
    ).toBeFocused();
    expect((await readE01Record(page, original.id)).draftRevision).toBe(original.draftRevision);
    dialog = await openStarters(page);
    await dialog.getByRole("radio", { name: /Priority poll/ }).check();
    const preview = dialog.getByRole("region", { name: "Question preview", exact: true });
    await expect(preview).toContainText("Opinion · 0 points · no correct answer");
    await expect(preview.locator("ol li")).toHaveText(points);
    await page.screenshot({
      path: info.outputPath("question-starter-review.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 760 });
    await noOverflow(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: info.outputPath("question-starter-review-320.png"),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Insert reviewed question", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("textbox", { name: "Question prompt", exact: true })).toBeFocused();
    await expect
      .poll(async () => (await readE01Record(page, original.id)).draftRevision)
      .toBe(original.draftRevision + 1);
    const inserted = await readE01Record(page, original.id);
    expect(inserted.draft.blocks[0]).toEqual(original.draft.blocks[0]);
    expect(inserted.draft.blocks).toHaveLength(2);
    const question = inserted.draft.blocks[1];
    if (question?.kind !== "question" || question.question.type !== "poll")
      throw new Error("Expected local opinion poll");
    expect(question.question).toMatchObject({
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
    expect(JSON.stringify(question)).not.toMatch(/PRIVATE_|CLOSED_DETAIL/);
    expect(inserted.draft.sections![0]!.blockIds).toEqual([
      original.draft.blocks[0]!.id,
      question.id,
    ]);
    expect(inserted.draft.spatial!.frames[0]).toEqual(original.draft.spatial!.frames[0]);
    expect(inserted.draft.spatial!.frames).toHaveLength(2);
    await closeDrawers(page);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, original.id)).draft)
      .toEqual(original.draft);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, original.id)).draft)
      .toEqual(inserted.draft);
    await page.reload();
    await closeDrawers(page);
    expect((await readE01Record(page, original.id)).draft).toEqual(inserted.draft);
    expect((await used(page, original.id)).used).toBe(baseline.used);
    expect(jobs).toEqual([]);
    const record = await page.request.get(`${e01ApiUrl}/v1/presentations/${original.id}`);
    expect((await record.json()).presentation.currentVersionId).toBe(originalVersion);
    const ready = await readE01Record(page, original.id);
    const publish = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${original.id}/publish`,
      { data: { expectedDraftRevision: ready.draftRevision } },
    );
    expect(publish.status()).toBe(200);
    const created = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
      data: { presentationId: original.id, timeMode: "flex" },
    });
    expect(created.status()).toBe(201);
    const { snapshot, controlToken } = await created.json();
    await page.evaluate(
      ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
      { id: snapshot.sessionId, token: controlToken },
    );
    const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
    const guestContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
    });
    try {
      const guest = await guestContext.newPage();
      await guest.goto(`/join?code=${snapshot.code}`);
      await guest.getByLabel("Nickname", { exact: true }).fill("Starter audience");
      await guest.getByRole("button", { name: "Join presentation", exact: true }).click();
      await page.goto(`/presentation-session/${snapshot.sessionId}/host`);
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(guest.getByText(question.question.prompt, { exact: true })).toBeVisible();
      await expect(guest.getByText("Confidence", { exact: true })).toHaveCount(0);
      await guest.getByRole("button", { name: points[0]!, exact: true }).click();
      await guest.getByRole("button", { name: "Submit response", exact: true }).click();
      await expect(
        guest.getByText("Response saved. You can stay here while the facilitator continues.", {
          exact: true,
        }),
      ).toBeVisible();
      expect(await guest.locator("body").innerText()).not.toMatch(
        /PRIVATE_|question-starters-v1|sourceDigest/,
      );
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
      const reported = await page.request.get(
        `${e01ApiUrl}/v1/presentation-sessions/${snapshot.sessionId}/report?includeSessionContext=true&includeQuickChecks=true&includeOpinionResults=true&includeTextResults=true&includeNavigation=true&includeInteractions=true`,
      );
      expect(reported.status()).toBe(200);
      const evidence = (await reported.json()).report.evidence.find(
        (entry: { kind: string; blockId: string }) =>
          entry.kind === "question" && entry.blockId === question.id,
      );
      expect(evidence).toMatchObject({
        correct: null,
        accuracyPercent: null,
        totalScore: 0,
        respondents: 1,
      });
    } finally {
      await guestContext.close();
    }
  });

  test(`discussion and clarity starters remain editable without truncating oversized priority lists${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await signInBeta(page);
    const original = await fixture(page, true);
    await enterE01Editor(page, original.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    let dialog = await openStarters(page);
    await expect(dialog.getByRole("radio")).toHaveCount(2);
    await expect(
      dialog.getByRole("region", { name: "Private source context", exact: true }),
    ).toContainText("Point complet 7");
    await dialog.getByRole("radio", { name: /Discussion/ }).check();
    await dialog.getByRole("button", { name: "Insert reviewed question", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, original.id)).draft.blocks.length)
      .toBe(2);
    const first = await readE01Record(page, original.id);
    expect(first.draft.blocks[1]).toMatchObject({
      kind: "question",
      question: { type: "open_text", purpose: "opinion", basePoints: 0 },
    });
    await closeDrawers(page);
    await selectE01Block(
      page,
      `^1 Content slide ${title}`,
      (page.viewportSize()?.width ?? 1280) <= 920,
    );
    dialog = await openStarters(page);
    await dialog.getByRole("radio", { name: /Clarity rating/ }).check();
    await expect(
      dialog.getByRole("region", { name: "Question preview", exact: true }),
    ).toContainText("Not clear yet");
    await dialog.getByRole("button", { name: "Insert reviewed question", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, original.id)).draft.blocks.length)
      .toBe(3);
    const input = page.getByRole("textbox", { name: "Question prompt", exact: true });
    await input.fill("Edited clarity question");
    await expect
      .poll(async () => {
        const latest = await readE01Record(page, original.id);
        const block = latest.draft.blocks[1];
        return block?.kind === "question" ? block.question.prompt : "";
      })
      .toBe("Edited clarity question");
    const latest = await readE01Record(page, original.id);
    expect(latest.draft.blocks[1]).toMatchObject({
      kind: "question",
      question: { type: "rating", min: 1, max: 5, basePoints: 0 },
    });
    expect(latest.draft.blocks[0]).toEqual(original.draft.blocks[0]);
    const hidden = structuredClone(latest.draft);
    const block = hidden.blocks[0];
    if (block?.kind !== "content") throw new Error("Expected source");
    block.hidden = true;
    expect(
      (
        await page.request.put(`${e01ApiUrl}/v1/presentations/${original.id}/draft`, {
          data: {
            schemaVersion: 2,
            draft: hidden,
            expectedRevision: latest.draftRevision,
            mutationId: randomUUID(),
          },
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    await openSlideIdeas(page);
    await expect(
      page.getByRole("button", { name: "Question starters", exact: true }),
    ).toBeDisabled();
    expect((await readE01Record(page, original.id)).draft.blocks).toHaveLength(3);
  });
}
