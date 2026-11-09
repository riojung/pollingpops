import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  PresentationAssistanceJobSchema,
  PRESENTATION_ASSISTANCE_REVIEW_WARNING,
  type CreatePresentationAssistanceJob,
  type InsertPresentationAssistanceProposals,
} from "../../packages/contracts/src/index.ts";
import {
  clickNavigatorAction,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
  selectE01Body,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

const enabled = process.env.BETA_E2E_AUTHORING === "true";
const providerPort = Number(
  process.env.BETA_E2E_AUTHORING_PORT ?? Number(process.env.BETA_E2E_API_PORT ?? 4200) + 2,
);
const privateMarker = "PRIVATE_E12_NOTES_NEVER_IN_PROMPT";
const outlineLines = [
  "Purpose: introduce the team's small presentation launch and the next review milestone.",
  "Plan: draft the slides, review the wording together, and share the approved version.",
  "Next steps: assign an owner to each action and schedule a short follow-up discussion.",
];
const outline = outlineLines.join("\n");
const titles = ["Launch overview", "Review plan", "Next steps"];
let provider: Server | undefined;
const providerCalls: Array<{ sourceName: string; tokenLimit: number; text: string }> = [];

test.skip(!enabled, "Outline assistance requires the owned loopback authoring fixture.");
test.use({ actionTimeout: 30_000 });

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
        const input = JSON.parse(
          body.messages.find((message) => message.role === "user")!.content,
        ) as {
          sourceName: string;
          slideCount: number;
          outline: Array<{ locator: string; text: string }>;
        };
        providerCalls.push({
          sourceName: input.sourceName,
          tokenLimit: body.max_tokens,
          text: raw,
        });
        const slides = Array.from({ length: input.slideCount }, (_, index) => {
          const section = input.outline[index % input.outline.length]!;
          return {
            title: titles[index % titles.length],
            body: section.text,
            citations: [
              {
                locator: input.sourceName.startsWith("Failure ")
                  ? "outline line 999"
                  : section.locator,
                excerpt: section.text,
              },
            ],
          };
        });
        response.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ slides }) } }],
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

async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
}

async function readJob(page: Page, presentationId: string, jobId: string) {
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-assistance/jobs/${jobId}?presentationId=${presentationId}`,
  );
  expect(response.status()).toBe(200);
  return PresentationAssistanceJobSchema.parse((await response.json()).job);
}

async function openAssistance(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Outline to slides", exact: true });
  await expect(
    page.getByRole("textbox", { name: "Presentation title", exact: true }),
  ).toBeVisible();
  if (!(await dialog.isVisible())) {
    const hideInspector = page.getByRole("button", { name: "Hide inspector", exact: true });
    if ((page.viewportSize()?.width ?? 1280) <= 700 && (await hideInspector.isVisible()))
      await hideInspector.click();
    await clickNavigatorAction(page, "Outline to slides");
  }
  await expect(dialog).toBeVisible();
  return dialog;
}

async function queueProposal(page: Page, sourceName: string) {
  const dialog = await openAssistance(page);
  const reset = dialog.getByRole("button", { name: "Start another outline", exact: true });
  if (await reset.isVisible()) await reset.click();
  await dialog.getByLabel("Outline name", { exact: true }).fill(sourceName);
  await dialog.getByRole("textbox", { name: /^Outline text/ }).fill(outline);
  await dialog.getByRole("combobox", { name: /Number of slides/ }).selectOption("3");
  const queued = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url() === `${e01ApiUrl}/v1/presentation-assistance/jobs`,
  );
  await dialog.getByRole("button", { name: "Create slide proposal", exact: true }).click();
  const response = await queued;
  expect(response.status()).toBe(202);
  return { dialog, job: PresentationAssistanceJobSchema.parse((await response.json()).job) };
}

for (const suffix of ["", " @mobile"]) {
  test(`outline review preserves exact creation and insertion across reloads${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const run = randomUUID().slice(0, 8);
    const original = e01Slide(`Existing slide ${run}`);
    original.id = original.id.toUpperCase();
    original.speakerNotes = privateMarker;
    const record = await createE01Deck(page, [original], 14);
    const published = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
      { data: { expectedDraftRevision: record.draftRevision } },
    );
    expect(published.status()).toBe(200);
    const versionId = (await published.json()).version.id as string;
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    // Exercise the existing UUID fallback on insecure local origins as well.
    await page.addInitScript(() =>
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        configurable: true,
        value: undefined,
      }),
    );
    await enterE01Editor(page, record.id, narrow);
    const dialog = await openAssistance(page);
    await dialog.getByLabel("Outline name", { exact: true }).fill(`Launch ${run}`);
    await dialog.getByRole("textbox", { name: /^Outline text/ }).fill(outline);
    await dialog.getByRole("combobox", { name: /Number of slides/ }).selectOption("3");
    const statusPath = `${e01ApiUrl}/v1/presentation-assistance/status?presentationId=${record.id}`;
    const beforeStatus = (await (await page.request.get(statusPath)).json()).status;
    expect(beforeStatus.enabled).toBe(true);
    expect(beforeStatus.remaining).toBeGreaterThan(0);
    const createPath = `${e01ApiUrl}/v1/presentation-assistance/jobs`;
    const creations: CreatePresentationAssistanceJob[] = [];
    let droppedCreate = false;
    await page.route(createPath, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      creations.push(route.request().postDataJSON() as CreatePresentationAssistanceJob);
      if (!droppedCreate) {
        droppedCreate = true;
        const response = await route.fetch();
        expect(response.status()).toBe(202);
        await route.abort("failed");
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "Create slide proposal", exact: true }).click();
    await expect.poll(() => creations.length).toBe(1);
    await expect(
      dialog.getByRole("button", { name: "Recover proposal", exact: true }),
    ).toBeVisible();
    expect((await readE01Record(page, record.id)).draftRevision).toBe(record.draftRevision);
    await page.reload();
    await openAssistance(page);
    const jobId = creations[0]!.requestId;
    await expect
      .poll(async () => (await readJob(page, record.id, jobId)).status, { timeout: 60_000 })
      .toBe("ready");
    const proposal = dialog.getByRole("region", { name: "Review proposed slides", exact: true });
    await expect(proposal).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText(PRESENTATION_ASSISTANCE_REVIEW_WARNING);
    await expect(proposal).toContainText("outline line 1");
    await expect(proposal).toContainText(outlineLines[0]!);
    await expect(
      proposal.locator("blockquote").filter({ hasText: outlineLines[0]! }),
    ).toBeVisible();
    expect(creations).toHaveLength(1);
    const afterStatus = (await (await page.request.get(statusPath)).json()).status;
    expect(afterStatus.used).toBe(beforeStatus.used + 1);
    const requests = providerCalls.filter((call) => call.sourceName === `Launch ${run}`);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.tokenLimit).toBeGreaterThan(0);
    expect(requests[0]!.tokenLimit).toBeLessThanOrEqual(4096);
    expect(requests[0]!.text).not.toContain(privateMarker);
    expect(requests[0]!.text).not.toContain(original.id);
    await page.unroute(createPath);

    await page.setViewportSize({ width: 320, height: 760 });
    await noOverflow(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath("e12-outline-review-320.png"), fullPage: true });
    await proposal
      .getByRole("checkbox", { name: "Include slide 2: Review plan", exact: true })
      .uncheck();
    const confirmation = dialog.getByRole("checkbox", {
      name: "I reviewed the selected slide text and exact excerpts, including any unsupported claims.",
      exact: true,
    });
    const insert = dialog.getByRole("button", { name: "Insert 2 reviewed slides", exact: true });
    await expect(insert).toBeDisabled();
    await confirmation.check();
    const applyPath = `${e01ApiUrl}/v1/presentations/${record.id}/blocks/assistance-proposals`;
    const insertions: InsertPresentationAssistanceProposals[] = [];
    let droppedInsert = false;
    await page.route(applyPath, async (route) => {
      insertions.push(route.request().postDataJSON() as InsertPresentationAssistanceProposals);
      if (!droppedInsert) {
        droppedInsert = true;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await insert.click();
    await expect(
      dialog.getByRole("button", { name: "Retry exact insertion", exact: true }),
    ).toBeVisible();
    const accepted = await readE01Record(page, record.id);
    expect(accepted.draftRevision).toBe(record.draftRevision + 1);
    expect(accepted.draft.blocks).toHaveLength(3);
    await page.reload();
    await expect(dialog).toBeVisible();
    const retry = dialog.getByRole("button", { name: "Retry exact insertion", exact: true });
    await expect(retry).toBeEnabled({ timeout: 30_000 });
    await retry.click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => insertions.length).toBe(2);
    expect(insertions[1]).toEqual(insertions[0]);
    await page.unroute(applyPath);
    const recovered = await readE01Record(page, record.id);
    expect(recovered.draftRevision).toBe(accepted.draftRevision);
    expect(recovered.draft.blocks).toEqual(accepted.draft.blocks);
    expect(recovered.draft.blocks.filter((block) => block.kind === "question")).toHaveLength(0);
    for (const block of recovered.draft.blocks.slice(1)) {
      expect(block.kind).toBe("content");
      if (block.kind === "content") {
        expect(block.scene?.schemaVersion).toBe(6);
        expect(block.scene?.nodes.filter((node) => node.type === "text")).toHaveLength(2);
        expect(block.citations).toHaveLength(1);
      }
    }
    const current = await page.request.get(`${e01ApiUrl}/v1/presentations/${record.id}`);
    expect((await current.json()).presentation.currentVersionId).toBe(versionId);
    await noOverflow(page);

    const failed = await queueProposal(page, `Failure ${run}`);
    await expect
      .poll(async () => (await readJob(page, record.id, failed.job.id)).status, { timeout: 90_000 })
      .toBe("failed");
    const failure = await readJob(page, record.id, failed.job.id);
    expect(failure.proposal).toBeNull();
    // Invalid evidence is terminal immediately; retrying it would waste provider work.
    expect(failure.attempts).toBe(1);
    await expect(failed.dialog).toContainText(failure.error!.message);
    expect(providerCalls.filter((call) => call.sourceName === `Failure ${run}`)).toHaveLength(1);
    expect((await readE01Record(page, record.id)).draft).toEqual(recovered.draft);
    expect((await readE01Record(page, record.id)).draftRevision).toBe(recovered.draftRevision);
    await failed.dialog.getByRole("button", { name: "Close", exact: true }).click();

    // Pin a known insertion anchor, then have a separate editor delete it while
    // this proposal remains open. One reload must refresh both revision and anchor.
    const reopenMap = page.getByRole("button", { name: "Open map", exact: true });
    if (await reopenMap.isVisible()) await reopenMap.click();
    await page
      .getByRole("complementary", { name: "Presentation map", exact: true })
      .getByRole("button", { name: new RegExp(`Existing slide ${run}`) })
      .click();
    const closeMap = page.getByRole("button", { name: "Collapse map", exact: true });
    if (await closeMap.isVisible()) await closeMap.click();
    const stale = await queueProposal(page, `Concurrent ${run}`);
    await expect
      .poll(async () => (await readJob(page, record.id, stale.job.id)).status, { timeout: 60_000 })
      .toBe("ready");
    await expect(
      stale.dialog.getByRole("region", { name: "Review proposed slides", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    const fresh = await readE01Record(page, record.id);
    const remoteDraft = {
      ...fresh.draft,
      title: `A separate editor change ${run}`,
      blocks: fresh.draft.blocks.filter((block) => block.id !== original.id),
    };
    const remote = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
      data: {
        schemaVersion: 2,
        mutationId: randomUUID(),
        expectedRevision: fresh.draftRevision,
        draft: remoteDraft,
      },
    });
    expect(remote.status()).toBe(200);
    const changed = (await remote.json()).presentation;
    await stale.dialog
      .getByRole("checkbox", {
        name: "I reviewed the selected slide text and exact excerpts, including any unsupported claims.",
        exact: true,
      })
      .check();
    const rejected = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url() === applyPath,
    );
    await stale.dialog
      .getByRole("button", { name: "Insert 3 reviewed slides", exact: true })
      .click();
    const staleResponse = await rejected;
    // The old request can fail on either its obsolete revision or its deleted anchor.
    expect([409, 422]).toContain(staleResponse.status());
    expect(
      (staleResponse.request().postDataJSON() as InsertPresentationAssistanceProposals)
        .afterBlockId,
    ).toBe(original.id.toLowerCase());
    await expect(stale.dialog.getByRole("alert")).toBeVisible();
    expect((await readE01Record(page, record.id)).draft).toEqual(changed.draft);
    expect((await readE01Record(page, record.id)).draftRevision).toBe(changed.draftRevision);
    const savedDeckReload = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url() === `${e01ApiUrl}/v1/presentations/${record.id}`,
    );
    await stale.dialog.getByRole("button", { name: "Reload saved deck", exact: true }).click();
    expect((await savedDeckReload).status()).toBe(200);
    await expect(
      page.getByRole("textbox", { name: "Presentation title", exact: true, includeHidden: true }),
    ).toHaveValue(remoteDraft.title);
    const refreshedReview = stale.dialog.getByRole("checkbox", {
      name: "I reviewed the selected slide text and exact excerpts, including any unsupported claims.",
      exact: true,
    });
    await expect(refreshedReview).not.toBeChecked();
    await refreshedReview.check();
    const retriedInsert = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url() === applyPath,
    );
    await stale.dialog
      .getByRole("button", { name: "Insert 3 reviewed slides", exact: true })
      .click();
    const recoveredInsert = await retriedInsert;
    expect(recoveredInsert.status()).toBe(200);
    const freshIntent = recoveredInsert
      .request()
      .postDataJSON() as InsertPresentationAssistanceProposals;
    expect(freshIntent.expectedRevision).toBe(changed.draftRevision);
    expect(
      freshIntent.afterBlockId === null ||
        changed.draft.blocks.some((block: { id: string }) => block.id === freshIntent.afterBlockId),
    ).toBe(true);
    await expect(stale.dialog).toBeHidden();
    const finalRecord = await readE01Record(page, record.id);
    expect(finalRecord.draftRevision).toBe(changed.draftRevision + 1);
    expect(finalRecord.draft.blocks).toHaveLength(changed.draft.blocks.length + 3);
    expect(finalRecord.draft.blocks.some((block) => block.id === original.id)).toBe(false);
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Presentation title", exact: true }),
    ).toHaveValue(remoteDraft.title);
    const hideInspector = page.getByRole("button", { name: "Hide inspector", exact: true });
    if (await hideInspector.isVisible()) await hideInspector.click();
    const mapButton = page.getByRole("button", { name: "Open map", exact: true });
    if (await mapButton.isVisible()) await mapButton.click();
    await page
      .getByRole("complementary", { name: "Presentation map", exact: true })
      .getByRole("button", { name: new RegExp(titles[0]!) })
      .first()
      .click();
    const collapse = page.getByRole("button", { name: "Collapse map", exact: true });
    if (await collapse.isVisible()) await collapse.click();
    await selectE01Body(page);
    const edited = `Editable native body ${run}`;
    await page.getByRole("textbox", { name: "Node text", exact: true }).fill(edited);
    const nativeId = recovered.draft.blocks[1]!.id;
    await expect
      .poll(async () => {
        const saved = await readE01Record(page, record.id);
        const block = saved.draft.blocks.find((entry) => entry.id === nativeId);
        const body =
          block?.kind === "content"
            ? block.scene?.nodes.find((node) => node.type === "text" && node.role === "body")
            : null;
        return body?.type === "text" ? body.text : "";
      })
      .toBe(edited);
    await page.reload();
    expect((await readE01Record(page, record.id)).draft.title).toBe(remoteDraft.title);
    await noOverflow(page);
  });

  test(`outline-first creation recovers one saved draft before reviewed generation${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const title = `Outline first ${randomUUID().slice(0, 8)}`;
    const presentationsPath = `${e01ApiUrl}/v1/presentations`;
    const createPath = `${presentationsPath}/outline-drafts`;
    const requests: string[] = [];
    let presentationId = "";
    let dropped = false;
    let jobsCreated = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url() === `${e01ApiUrl}/v1/presentation-assistance/jobs`
      )
        jobsCreated += 1;
    });
    await page.route(createPath, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      requests.push(route.request().postData()!);
      if (!dropped) {
        dropped = true;
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        presentationId = (await response.json()).presentation.id as string;
        await route.abort("failed");
      } else await route.continue();
    });

    await page.goto("/create/presentation");
    await page.locator('a[href="/create/presentation?start=outline"]').click();
    const input = page.getByRole("textbox", { name: "Presentation title", exact: true });
    await input.fill(title);
    await page.setViewportSize({ width: 320, height: 760 });
    await noOverflow(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath("e12-outline-start-320.png"), fullPage: true });
    await page.getByRole("button", { name: "Create draft and continue", exact: true }).click();
    const retry = page.getByRole("button", { name: "Retry draft creation", exact: true });
    await expect(retry).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(presentationId).not.toBe("");
    expect(jobsCreated).toBe(0);
    await page.reload();
    await expect(retry).toBeVisible();
    await expect(input).toHaveValue(title);
    await expect(input).toHaveJSProperty("readOnly", true);
    const recovered = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url() === createPath,
    );
    await retry.click();
    expect((await recovered).status()).toBe(200);
    const dialog = page.getByRole("dialog", { name: "Outline to slides", exact: true });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/presentation/${presentationId}$`));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
    expect(jobsCreated).toBe(0);
    await page.unroute(createPath);
    const list = await page.request.get(presentationsPath);
    expect(list.status()).toBe(200);
    expect(
      ((await list.json()).presentations as Array<{ id: string; title: string }>).filter(
        (entry) => entry.title === title,
      ),
    ).toEqual([expect.objectContaining({ id: presentationId })]);
    const before = await readE01Record(page, presentationId);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Presentation title", exact: true }),
    ).toBeVisible();
    await expect(dialog).toBeHidden();
    expect((await readE01Record(page, presentationId)).draft).toEqual(before.draft);

    // Acknowledged handoff remains recoverable when the creator returns to the launcher.
    await page.goto("/create/presentation?start=outline");
    await page.getByRole("button", { name: "Open saved draft", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/presentation/${presentationId}$`));
    expect(jobsCreated).toBe(0);
    const statusPath = `${e01ApiUrl}/v1/presentation-assistance/status?presentationId=${presentationId}`;
    const usage = (await (await page.request.get(statusPath)).json()).status.used as number;
    const queued = await queueProposal(page, title);
    await expect(
      queued.dialog.getByRole("region", { name: "Review proposed slides", exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    expect(jobsCreated).toBe(1);
    expect((await (await page.request.get(statusPath)).json()).status.used).toBe(usage + 1);
    expect((await readE01Record(page, presentationId)).draft).toEqual(before.draft);
    await queued.dialog
      .getByRole("checkbox", {
        name: "I reviewed the selected slide text and exact excerpts, including any unsupported claims.",
        exact: true,
      })
      .check();
    await queued.dialog
      .getByRole("button", { name: "Insert 3 reviewed slides", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    const applied = await readE01Record(page, presentationId);
    expect(applied.draft.title).toBe(title);
    expect(applied.draft.blocks).toHaveLength(3);
    expect(applied.draft.blocks.every((block) => block.kind === "content" && !!block.scene)).toBe(
      true,
    );
    const current = await page.request.get(`${presentationsPath}/${presentationId}`);
    expect((await current.json()).presentation.currentVersionId).toBeNull();
    await noOverflow(page);
  });
}
