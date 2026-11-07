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
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

const enabled = process.env.BETA_E2E_AUTHORING === "true";
const providerPort = Number(process.env.BETA_E2E_AUTHORING_PORT ?? 4202);
const title = "Préparer le lancement";
const points = ["Clarifier le périmètre", "Choisir une équipe", "Fixer une date"];
const discussion = `What should the team consider before “${points[0]}”?`;
const reflection = `How would “${points[2]}” affect the way you plan the launch?`;
const privateMarker = "PRIVATE_DISCUSSION_CONTEXT";
const closedMarker = "CLOSED_DISCUSSION_DETAIL";
const sectionId = "10000000-0000-4000-8000-000000000011";
let provider: Server | undefined;
let invalid = false;
const calls: Array<{ raw: string; input: unknown; maxTokens: number }> = [];
test.skip(!enabled, "Question suggestions require the owned loopback authoring fixture.");
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
        calls.push({ raw, input, maxTokens: body.max_tokens });
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
                        citations: [
                          {
                            locator: "body 1 paragraph 1",
                            excerpt: invalid ? "UNSUPPORTED_EXCERPT" : points[0],
                          },
                        ],
                      },
                      {
                        kind: "reflection",
                        prompt: reflection,
                        citations: [{ locator: "body 1 paragraph 3", excerpt: points[2] }],
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
test.beforeEach(() => {
  invalid = false;
  calls.length = 0;
});

async function fixture(page: Page) {
  const block = e01Slide(title, true);
  block.id = block.id.toUpperCase();
  block.speakerNotes = privateMarker;
  block.citations = [{ locator: "Earlier private import", excerpt: privateMarker }];
  block.sourceDisclosure = {
    sourceName: privateMarker,
    sourceDigest: "a".repeat(64),
    provider: "Earlier private provider",
    model: "earlier-import",
  };
  const scene = block.scene!;
  scene.schemaVersion = 7;
  const heading = scene.nodes[0]!,
    body = scene.nodes[1]!;
  if (heading.type !== "text" || body.type !== "text")
    throw new Error("Expected native source text");
  heading.lang = "fr";
  body.id = "Body:ExactDiscussionSource";
  body.lang = "fr";
  body.text = points.join("\n");
  body.richText = {
    paragraphs: points.map((text) => ({ kind: "bullet" as const, runs: [{ text, bold: true }] })),
  };
  scene.readingOrder[1] = body.id;
  scene.nodes.push({
    id: "closed-detail",
    type: "dialog",
    scope: "local",
    label: "More detail",
    detailTitle: "Private context",
    body: closedMarker,
    frame: { x: 8, y: 80, width: 84, height: 12 },
  });
  scene.readingOrder.push("closed-detail");
  const created = await createE01Deck(page, [block], 16);
  const saved = await page.request.put(`${e01ApiUrl}/v1/presentations/${created.id}/draft`, {
    data: {
      schemaVersion: 2,
      expectedRevision: created.draftRevision,
      mutationId: randomUUID(),
      draft: {
        ...created.draft,
        sections: [{ id: sectionId, title: "Launch decision", blockIds: [block.id] }],
        spatial: {
          schemaVersion: 1,
          frames: [{ blockId: block.id, x: 100, y: 80, width: 1280, height: 720 }],
        },
      },
    },
  });
  expect(saved.status()).toBe(200);
  return readE01Record(page, created.id);
}
async function closeDrawers(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) > 920) return;
  await expect(page.getByRole("button", { name: "Arrange space", exact: true })).toBeVisible();
  for (const name of ["Hide inspector", "Collapse map"]) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
}
async function openSuggestions(page: Page, resume = false) {
  if (!resume) await closeDrawers(page);
  await page
    .getByRole("button", {
      name: resume ? "Resume discussion suggestions" : "Suggest discussion questions",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "Review discussion suggestions", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
const confirmation = (page: Page) =>
  page.getByRole("checkbox", {
    name: "I reviewed both complete questions, their settings and exact source excerpts, including unsupported framing or claims.",
    exact: true,
  });
async function review(page: Page) {
  await expect(
    page.getByRole("region", { name: "Review both suggested questions", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await confirmation(page).check();
}
async function status(page: Page, id: string) {
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-question-suggestions/status?presentationId=${id}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()).status as { used: number; enabled: boolean };
}
async function recovery(page: Page) {
  const values = await page.evaluate(() =>
    Object.entries(sessionStorage)
      .filter(([key]) => key.startsWith("presentation-question-suggestions:"))
      .map(([, value]) => value),
  );
  for (const value of values) {
    for (const text of [title, ...points, discussion, reflection, privateMarker, closedMarker])
      expect(value).not.toContain(text);
  }
  return values;
}

for (const suffix of ["", " @mobile"]) {
  test(`AI discussion suggestions require review, preserve the source and insert one undoable opinion${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const original = await fixture(page);
    const baseline = await status(page, original.id);
    const published = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${original.id}/publish`,
      { data: { expectedDraftRevision: original.draftRevision } },
    );
    expect(published.status()).toBe(200);
    const originalVersion = (await published.json()).version.id;
    await enterE01Editor(page, original.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    let dialog = await openSuggestions(page);
    await expect(dialog).toContainText("One generation uses one AI job");
    const context = dialog.getByRole("region", { name: "Private source context", exact: true });
    await expect(context).toContainText(points[0]!);
    await expect(context.getByText(title, { exact: true })).toHaveAttribute("lang", "fr");
    await expect(dialog).not.toContainText(privateMarker);
    await expect(dialog).not.toContainText(closedMarker);
    expect(calls).toEqual([]);
    await dialog.getByRole("button", { name: "Close review", exact: true }).last().click();
    await expect(dialog).toBeHidden();
    expect((await readE01Record(page, original.id)).draftRevision).toBe(original.draftRevision);
    dialog = await openSuggestions(page);
    await dialog
      .getByRole("button", { name: "Generate discussion suggestions", exact: true })
      .click();
    await review(page);
    expect((await readE01Record(page, original.id)).draft).toEqual(original.draft);
    expect((await status(page, original.id)).used).toBe(baseline.used + 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.maxTokens).toBe(2048);
    expect(calls[0]!.input).toEqual({
      title,
      sections: points.map((text, index) => ({ locator: `body 1 paragraph ${index + 1}`, text })),
      outputLanguage: "en",
    });
    expect(calls[0]!.raw).not.toMatch(
      /PRIVATE_DISCUSSION_CONTEXT|CLOSED_DISCUSSION_DETAIL|Body:ExactDiscussionSource|sourceDigest|speakerNotes/,
    );
    await expect(dialog.getByRole("radio")).toHaveCount(2);
    await dialog.getByRole("radio", { name: "Reflection question", exact: true }).check();
    await confirmation(page).check();
    await expect(dialog).toContainText("Opinion · 0 points · confidence off · no correct answer");
    await expect(dialog.getByText(reflection, { exact: true })).toHaveAttribute("lang", "en");
    expect((await recovery(page)).length).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath("discussion-review.png"), fullPage: true });
    await page.setViewportSize({ width: 320, height: 760 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath("discussion-review-320.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Insert reviewed question", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("textbox", { name: "Question prompt", exact: true })).toBeFocused();
    await expect
      .poll(async () => (await readE01Record(page, original.id)).draft.blocks.length)
      .toBe(2);
    const inserted = await readE01Record(page, original.id);
    expect(inserted.draft.blocks[0]).toEqual(original.draft.blocks[0]);
    const block = inserted.draft.blocks[1];
    if (block?.kind !== "question") throw new Error("Expected inserted question");
    expect(block.question).toMatchObject({
      type: "open_text",
      prompt: reflection,
      purpose: "opinion",
      confidence: "off",
      basePoints: 0,
      linkedRecheckQuestionId: null,
    });
    expect(block.sourceDisclosure).toMatchObject({
      provider: "beta-fixture",
      model: "synthetic-source-fixture",
    });
    expect(inserted.draft.sections![0]!.blockIds).toEqual([original.draft.blocks[0]!.id, block.id]);
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
    expect((await status(page, original.id)).used).toBe(baseline.used + 1);
    const record = await page.request.get(`${e01ApiUrl}/v1/presentations/${original.id}`);
    expect((await record.json()).presentation.currentVersionId).toBe(originalVersion);
    const ready = await readE01Record(page, original.id);
    expect(
      (
        await page.request.post(`${e01ApiUrl}/v1/presentations/${original.id}/publish`, {
          data: { expectedDraftRevision: ready.draftRevision },
        })
      ).status(),
    ).toBe(200);
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
      await guest.getByLabel("Nickname", { exact: true }).fill("Discussion attendee");
      await guest.getByRole("button", { name: "Join a Presentation", exact: true }).click();
      await page.goto(`/presentation-session/${snapshot.sessionId}/host`);
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(guest.getByText(reflection, { exact: true })).toBeVisible();
      expect(await guest.locator("body").innerText()).not.toMatch(
        /PRIVATE_DISCUSSION_CONTEXT|beta-fixture|sourceDigest|body 1 paragraph/,
      );
      await guest
        .getByLabel("Your response", { exact: true })
        .fill("I would clarify responsibilities before setting the date.");
      await guest.getByRole("button", { name: "Submit response", exact: true }).click();
      await expect(
        guest.getByText("Response saved and waiting for facilitator review.", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
      const reported = await page.request.get(
        `${e01ApiUrl}/v1/presentation-sessions/${snapshot.sessionId}/report?includeSessionContext=true&includeQuickChecks=true&includeOpinionResults=true&includeTextResults=true&includeNavigation=true&includeInteractions=true`,
      );
      expect(reported.status()).toBe(200);
      const evidence = (await reported.json()).report.evidence.find(
        (entry: { kind: string; blockId: string }) =>
          entry.kind === "question" && entry.blockId === block.id,
      );
      expect(evidence).toMatchObject({ correct: null, accuracyPercent: null, totalScore: 0 });
    } finally {
      await guestContext.close();
    }
  });

  test(`discussion requests recover lost creation and insertion replies without duplicating questions${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await signInBeta(page);
    const original = await fixture(page);
    const baseline = await status(page, original.id);
    await enterE01Editor(page, original.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    let lostCreate = false;
    const createBodies: string[] = [];
    await page.route("**/v1/presentation-question-suggestions/jobs", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      createBodies.push(route.request().postData()!);
      const result = await route.fetch();
      if (!lostCreate) {
        lostCreate = true;
        await route.abort();
      } else await route.fulfill({ response: result });
    });
    let dialog = await openSuggestions(page);
    await dialog
      .getByRole("button", { name: "Generate discussion suggestions", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Recover saved request", exact: true }),
    ).toBeEnabled();
    await page.reload();
    dialog = await openSuggestions(page, true);
    await dialog.getByRole("button", { name: "Recover saved request", exact: true }).click();
    await expect(
      dialog.getByRole("region", { name: "Review both suggested questions", exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await dialog.getByRole("button", { name: "Reload exact source", exact: true }).click();
    await dialog.getByRole("radio", { name: "Discussion question", exact: true }).check();
    await confirmation(page).check();
    expect(calls).toHaveLength(1);
    expect((await status(page, original.id)).used).toBe(baseline.used + 1);
    expect(createBodies).toHaveLength(1);
    const insertBodies: string[] = [];
    let lostInsert = false;
    await page.route(
      `**/v1/presentations/${original.id}/question-suggestions/insert`,
      async (route) => {
        insertBodies.push(route.request().postData()!);
        const result = await route.fetch();
        if (!lostInsert) {
          lostInsert = true;
          await route.abort();
        } else await route.fulfill({ response: result });
      },
    );
    await dialog.getByRole("button", { name: "Insert reviewed question", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Retry exact insertion", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(async () => (await readE01Record(page, original.id)).draft.blocks.length)
      .toBe(2);
    await recovery(page);
    await page.reload();
    dialog = await openSuggestions(page, true);
    await dialog.getByRole("button", { name: "Retry exact insertion", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(insertBodies).toHaveLength(2);
    expect(insertBodies[1]).toBe(insertBodies[0]);
    const final = await readE01Record(page, original.id);
    expect(final.draft.blocks).toHaveLength(2);
    expect(final.draftRevision).toBe(original.draftRevision + 1);
    expect(final.draft.blocks[0]).toEqual(original.draft.blocks[0]);
    expect(calls).toHaveLength(1);
    expect(await recovery(page)).toEqual([]);
  });

  test(`invalid cited output leaves the deck intact and manual authoring available${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    invalid = true;
    await signInBeta(page);
    const original = await fixture(page);
    await enterE01Editor(page, original.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    const dialog = await openSuggestions(page);
    await dialog
      .getByRole("button", { name: "Generate discussion suggestions", exact: true })
      .click();
    await expect(dialog).toContainText("The generated questions could not be validated", {
      timeout: 60_000,
    });
    expect(calls).toHaveLength(1);
    expect((await readE01Record(page, original.id)).draft).toEqual(original.draft);
    await dialog.getByRole("button", { name: "Discard proposal", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Question starters", exact: true }).click();
    const local = page.getByRole("dialog", { name: "Review question starters", exact: true });
    await expect(local).toBeVisible();
    await local.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(calls).toHaveLength(1);
    expect((await readE01Record(page, original.id)).draftRevision).toBe(original.draftRevision);
  });

  test(`resuming a proposal saves intervening manual edits and rejects the changed source${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await signInBeta(page);
    const original = await fixture(page);
    await enterE01Editor(page, original.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    let dialog = await openSuggestions(page);
    await dialog
      .getByRole("button", { name: "Generate discussion suggestions", exact: true })
      .click();
    await review(page);
    await dialog.getByRole("button", { name: "Close review", exact: true }).last().click();
    await expect(dialog).toBeHidden();
    const saves: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/v1/presentations/${original.id}/draft`, async (route) => {
      saves.push(route.request().postData()!);
      await gate;
      const result = await route.fetch();
      await route.fulfill({ response: result });
    });
    try {
      await page
        .getByLabel("Native slide title", { exact: true })
        .fill("A manually revised launch plan");
      await page
        .getByRole("button", { name: "Resume discussion suggestions", exact: true })
        .click();
      await expect.poll(() => saves.length).toBe(1);
      await expect(dialog).toBeHidden();
      release();
      dialog = page.getByRole("dialog", { name: "Review discussion suggestions", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("The source changed. Discard this proposal");
      await expect(
        dialog.getByRole("button", { name: "Insert reviewed question", exact: true }),
      ).toBeDisabled();
      const current = await readE01Record(page, original.id);
      expect(current.draftRevision).toBe(original.draftRevision + 1);
      expect(current.draft.blocks).toHaveLength(1);
      const block = current.draft.blocks[0];
      if (block?.kind !== "content") throw new Error("Expected preserved source");
      expect(block.scene?.nodes[0]).toMatchObject({
        text: "A manually revised launch plan",
        lang: "fr",
      });
      expect(calls).toHaveLength(1);
      await dialog.getByRole("button", { name: "Discard proposal", exact: true }).click();
      await expect(dialog).toBeHidden();
    } finally {
      release();
    }
  });
}
