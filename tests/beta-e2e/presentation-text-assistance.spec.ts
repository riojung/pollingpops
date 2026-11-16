import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  PresentationTextAssistanceJobSchema,
  type CreatePresentationTextAssistanceJob,
  type ApplyPresentationTextAssistance,
} from "../../packages/contracts/src/index.ts";
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
const providerPort = Number(
  process.env.BETA_E2E_AUTHORING_PORT ?? Number(process.env.BETA_E2E_API_PORT ?? 4200) + 2,
);
const sourceText =
  "Choose one clear action for the team and review the launch plan together before sharing.";
const rewritten =
  "Choose the team's next action and review the launch plan together before sharing.";
const shortened = "Choose the next action and review the launch plan.";
const privateMarker = "PRIVATE_TEXT_ASSISTANCE_NEVER_IN_PROMPT";
const otherObject = "OTHER_OBJECT_TEXT_NEVER_IN_PROMPT";
let provider: Server | undefined;
const calls: Array<{
  text: string;
  role: string;
  operation: string;
  maxTokens: number;
  raw: string;
}> = [];
test.skip(!enabled, "Text assistance requires the owned loopback authoring fixture.");
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
        const input = JSON.parse(body.messages.find((entry) => entry.role === "user")!.content) as {
          text: string;
          role: string;
          operation: string;
        };
        calls.push({ ...input, maxTokens: body.max_tokens, raw });
        response.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    text: input.operation === "shorten" ? shortened : rewritten,
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
function body(record: E01Record) {
  const block = record.draft.blocks[0];
  if (block?.kind !== "content") throw new Error("Expected the original native slide");
  const node = block.scene?.nodes.find((entry) => entry.id === "Body:ExactCase");
  if (node?.type !== "text") throw new Error("Expected the exact original body object");
  return { block, node };
}
async function fixture(page: Page) {
  const slide = e01Slide(otherObject);
  slide.id = slide.id.toUpperCase();
  slide.speakerNotes = privateMarker;
  slide.citations = [
    { locator: "PRIVATE earlier locator", excerpt: "PRIVATE earlier exact evidence" },
  ];
  slide.sourceDisclosure = {
    sourceName: "Original imported source",
    sourceDigest: "c".repeat(64),
    provider: "Original provider",
    model: "visual-import-v1",
    conversionNotes: ["Preserve this original import note"],
  };
  const node = slide.scene!.nodes[1]!;
  node.id = "Body:ExactCase";
  if (node.type !== "text") throw new Error("Expected body");
  node.text = sourceText;
  slide.scene!.readingOrder[1] = node.id;
  return createE01Deck(page, [slide], 14);
}
async function openText(page: Page, operation: "rewrite" | "shorten", recovering = false) {
  const dialog = page.getByRole("dialog", {
    name: operation === "rewrite" ? "Rewrite text" : "Shorten text",
    exact: true,
  });
  const resume = page.getByRole("button", { name: "Resume text assistance", exact: true });
  if (recovering) {
    await closeDrawers(page);
    await expect(resume).toBeVisible();
    await resume.click();
  } else {
    await closeDrawers(page);
    await selectE01Body(page);
    await page
      .getByRole("button", {
        name: operation === "rewrite" ? "Rewrite text" : "Shorten text",
        exact: true,
      })
      .click();
  }
  await expect(dialog).toBeVisible();
  return dialog;
}
async function closeDrawers(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) > 920) return;
  const inspector = page.getByRole("button", { name: "Hide inspector", exact: true });
  if (await inspector.isVisible()) await inspector.click();
  const map = page.getByRole("button", { name: "Collapse map", exact: true });
  if (await map.isVisible()) await map.click();
}
const confirmation = (page: Page) =>
  page.getByRole("checkbox", {
    name: "I reviewed the complete original and proposed wording, including unsupported claims and existing citations.",
    exact: true,
  });
async function review(page: Page) {
  const region = page.getByRole("region", { name: "Review proposed text", exact: true });
  await expect(region).toBeVisible({ timeout: 60_000 });
  await confirmation(page).check();
}
async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
}
async function readStatus(page: Page, id: string) {
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-text-assistance/status?presentationId=${id}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()).status as { used: number };
}
async function safeRecovery(page: Page) {
  const saved = await page.evaluate(() =>
    Object.entries(sessionStorage)
      .filter(([key]) => key.startsWith("presentation-text-assistance:v1:"))
      .map(([, value]) => value)
      .join("\n"),
  );
  for (const value of [
    sourceText,
    rewritten,
    shortened,
    privateMarker,
    "PRIVATE earlier exact evidence",
  ])
    expect(saved).not.toContain(value);
}

for (const suffix of ["", " @mobile"]) {
  test(`reviewed text edits recover exact acknowledgements and support safe Undo${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const record = await fixture(page),
      baseline = await readStatus(page, record.id);
    const publication = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
      { data: { expectedDraftRevision: record.draftRevision } },
    );
    expect(publication.status()).toBe(200);
    const versionId = (await publication.json()).version.id as string;
    await enterE01Editor(page, record.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    let dialog = await openText(page, "rewrite");
    const createPath = `${e01ApiUrl}/v1/presentation-text-assistance/jobs`;
    const creations: CreatePresentationTextAssistanceJob[] = [];
    let droppedCreate = false;
    await page.route(createPath, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      creations.push(route.request().postDataJSON() as CreatePresentationTextAssistanceJob);
      if (!droppedCreate) {
        droppedCreate = true;
        const response = await route.fetch();
        expect(response.status()).toBe(202);
        await route.abort("failed");
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "Generate rewrite proposal", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Recover or retry saved request", exact: true }),
    ).toBeVisible();
    await expect.poll(() => creations.length).toBe(1);
    await expect(
      dialog.getByRole("button", { name: "Recover or retry saved request", exact: true }),
    ).toBeEnabled();
    expect(creations[0]!.nodeId).toBe("Body:ExactCase");
    await safeRecovery(page);
    await page.reload();
    dialog = await openText(page, "rewrite", true);
    await dialog
      .getByRole("button", { name: "Recover or retry saved request", exact: true })
      .click();
    await expect(
      dialog.getByRole("region", { name: "Review proposed text", exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(dialog).toContainText(sourceText);
    await expect(dialog).toContainText(rewritten);
    expect(creations).toHaveLength(1);
    expect((await readStatus(page, record.id)).used).toBe(baseline.used + 1);
    await page.unroute(createPath);
    await dialog
      .getByRole("button", { name: "Reload exact target and review", exact: true })
      .click();
    await expect(dialog).toContainText("PRIVATE earlier exact evidence");
    await review(page);
    const applyPath = `${e01ApiUrl}/v1/presentations/${record.id}/text-assistance/apply`;
    const applications: ApplyPresentationTextAssistance[] = [];
    let droppedApply = false;
    await page.route(applyPath, async (route) => {
      applications.push(route.request().postDataJSON() as ApplyPresentationTextAssistance);
      if (!droppedApply) {
        droppedApply = true;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "Apply reviewed text", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Retry exact text application", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Retry exact text application", exact: true }),
    ).toBeEnabled();
    await safeRecovery(page);
    const accepted = await readE01Record(page, record.id);
    expect(body(accepted).node).toEqual({ ...body(record).node, text: rewritten });
    expect(body(accepted).block.citations).toEqual(body(record).block.citations);
    expect(body(accepted).block.sourceDisclosure).toEqual(body(record).block.sourceDisclosure);
    expect(body(accepted).block.speakerNotes).toBe(privateMarker);
    expect(accepted.draft.schemaVersion).toBe(15);
    expect(body(accepted).block.textAssistance).toMatchObject({
      nodeId: "Body:ExactCase",
      operation: "rewrite",
    });
    await page.reload();
    dialog = await openText(page, "rewrite", true);
    await dialog.getByRole("button", { name: "Retry exact text application", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(applications).toHaveLength(2);
    expect(applications[1]).toEqual(applications[0]);
    expect((await readE01Record(page, record.id)).draftRevision).toBe(accepted.draftRevision);
    await page.unroute(applyPath);

    dialog = await openText(page, "shorten");
    const queued = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url() === createPath,
    );
    await dialog
      .getByRole("button", { name: "Generate shorter text proposal", exact: true })
      .click();
    const queuedResponse = await queued;
    expect(queuedResponse.status()).toBe(202);
    PresentationTextAssistanceJobSchema.parse((await queuedResponse.json()).job);
    await review(page);
    await page.setViewportSize({ width: 320, height: 760 });
    await noOverflow(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath("e12-text-review-320.png"), fullPage: true });
    const current = await readE01Record(page, record.id);
    const remote = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
      data: {
        schemaVersion: 2,
        draft: { ...current.draft, description: "REMOTE description preserved" },
        expectedRevision: current.draftRevision,
        mutationId: randomUUID(),
      },
    });
    expect(remote.status()).toBe(200);
    const stale = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url() === applyPath,
    );
    await dialog.getByRole("button", { name: "Apply reviewed text", exact: true }).click();
    expect((await stale).status()).toBe(409);
    await dialog
      .getByRole("button", { name: "Reload exact target and review", exact: true })
      .click();
    await expect(confirmation(page)).not.toBeChecked();
    await review(page);
    await dialog.getByRole("button", { name: "Apply reviewed text", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(body(await readE01Record(page, record.id)).node.text).toBe(shortened);
    await closeDrawers(page);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () => body(await readE01Record(page, record.id)).node.text)
      .toBe(rewritten);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect
      .poll(async () => body(await readE01Record(page, record.id)).node.text)
      .toBe(shortened);
    const finished = await readE01Record(page, record.id);
    expect(finished.draft.description).toBe("REMOTE description preserved");
    expect(body(finished).block.sourceDisclosure).toEqual(body(record).block.sourceDisclosure);
    expect(body(finished).block.textAssistance?.operation).toBe("shorten");
    expect((await readStatus(page, record.id)).used).toBe(baseline.used + 2);
    expect(
      (await (await page.request.get(`${e01ApiUrl}/v1/presentations/${record.id}`)).json())
        .presentation.currentVersionId,
    ).toBe(versionId);
    const sent = calls.filter((entry) => entry.text === sourceText || entry.text === rewritten);
    expect(sent).toHaveLength(2);
    for (const entry of sent) {
      expect(entry.maxTokens).toBe(2048);
      for (const secret of [
        privateMarker,
        otherObject,
        "PRIVATE earlier exact evidence",
        "Original provider",
      ])
        expect(entry.raw).not.toContain(secret);
    }
    await noOverflow(page);
  });

  test(`changed exact text cannot be overwritten by an old proposal${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await signInBeta(page);
    const record = await fixture(page);
    await enterE01Editor(page, record.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    const dialog = await openText(page, "rewrite");
    await dialog.getByRole("button", { name: "Generate rewrite proposal", exact: true }).click();
    await review(page);
    const latest = await readE01Record(page, record.id),
      changed = structuredClone(latest.draft);
    const selected = changed.blocks[0];
    if (selected?.kind !== "content") throw new Error("Expected native content");
    const node = selected.scene!.nodes.find((entry) => entry.id === "Body:ExactCase");
    if (node?.type !== "text") throw new Error("Expected exact text");
    node.text = "A separate author changed this exact text.";
    const saved = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
      data: {
        schemaVersion: 2,
        draft: changed,
        expectedRevision: latest.draftRevision,
        mutationId: randomUUID(),
      },
    });
    expect(saved.status()).toBe(200);
    const rejected = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url() === `${e01ApiUrl}/v1/presentations/${record.id}/text-assistance/apply`,
    );
    await dialog.getByRole("button", { name: "Apply reviewed text", exact: true }).click();
    expect((await rejected).status()).toBe(409);
    await dialog
      .getByRole("button", { name: "Reload exact target and review", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(/changed|unavailable|available/i);
    await confirmation(page).check();
    await expect(
      dialog.getByRole("button", { name: "Apply reviewed text", exact: true }),
    ).toBeDisabled();
    expect((await readE01Record(page, record.id)).draft).toEqual(changed);
    await dialog.getByRole("button", { name: "Discard proposal", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect((await readE01Record(page, record.id)).draft).toEqual(changed);
  });

  test(`conclusive generation refusals release editing and remain discardable after reload${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await signInBeta(page);
    for (const mode of ["preflight", "admission"] as const) {
      const record = await fixture(page);
      await enterE01Editor(page, record.id, (info.project.use.viewport?.width ?? 1280) <= 700);
      let dialog = await openText(page, "rewrite");
      const generate = dialog.getByRole("button", {
        name: "Generate rewrite proposal",
        exact: true,
      });
      await expect(generate).toBeEnabled();
      const createPath = `${e01ApiUrl}/v1/presentation-text-assistance/jobs`;
      const statusPath = `${e01ApiUrl}/v1/presentation-text-assistance/status?presentationId=${record.id}`;
      let posts = 0;
      await page.route(createPath, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        posts++;
        if (mode === "admission")
          await route.fulfill({
            status: 429,
            json: {
              error: {
                code: "LIMIT_REACHED",
                message: "The workspace monthly authoring allowance has been used",
              },
            },
          });
        else await route.continue();
      });
      if (mode === "preflight")
        await page.route(statusPath, (route) =>
          route.fulfill({
            json: {
              status: {
                enabled: true,
                monthlyLimit: 100,
                used: 100,
                remaining: 0,
                active: 0,
                maxActiveJobs: 2,
              },
            },
          }),
        );
      await generate.click();
      await expect(dialog.getByRole("alert")).toContainText(
        mode === "preflight" ? "unavailable" : "allowance has been used",
      );
      await expect(
        dialog.getByRole("button", { name: "Discard proposal", exact: true }),
      ).toBeEnabled();
      expect(posts).toBe(mode === "preflight" ? 0 : 1);
      await safeRecovery(page);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toBeHidden();
      await closeDrawers(page);
      await selectE01Body(page);
      const manualText = `${sourceText} Manual edit after ${mode} refusal.`;
      await page.getByRole("textbox", { name: "Node text", exact: true }).fill(manualText);
      await expect
        .poll(async () => body(await readE01Record(page, record.id)).node.text)
        .toBe(manualText);
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Resume text assistance", exact: true }),
      ).toBeVisible();
      await closeDrawers(page);
      dialog = await openText(page, "rewrite", true);
      await expect(
        dialog.getByRole("button", { name: "Discard proposal", exact: true }),
      ).toBeEnabled();
      await dialog.getByRole("button", { name: "Discard proposal", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Resume text assistance", exact: true }),
      ).toBeHidden();
      expect(body(await readE01Record(page, record.id)).node.text).toBe(manualText);
      await page.unroute(createPath);
      if (mode === "preflight") await page.unroute(statusPath);
    }
  });

  test(`invalid text recovery can be cleared after a verified saved-deck reload${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await signInBeta(page);
    const me = await page.request.get(`${e01ApiUrl}/v1/auth/me`);
    expect(me.status()).toBe(200);
    const { creator } = (await me.json()) as {
      creator: { userId: string; workspaceId: string };
    };
    for (const invalid of ["{", JSON.stringify({ schemaVersion: 0, applyBody: "old receipt" })]) {
      const record = await fixture(page);
      await enterE01Editor(page, record.id, (info.project.use.viewport?.width ?? 1280) <= 700);
      const key = `presentation-text-assistance:v1:${creator.userId}:${creator.workspaceId}:${record.id}`;
      const otherKey = `${key}:unrelated`;
      await page.evaluate(
        ({ key, otherKey, invalid }) => {
          sessionStorage.setItem(key, invalid);
          sessionStorage.setItem(otherKey, "Preserve unrelated recovery");
        },
        { key, otherKey, invalid },
      );
      await page.reload();
      let dialog = await openText(page, "rewrite", true);
      const resetName = "Reload saved deck and clear invalid recovery";
      const consentName =
        "I understand the saved request cannot be recovered and a text edit may already have been applied.";
      await expect(dialog.getByRole("button", { name: resetName, exact: true })).toBeDisabled();
      const current = await readE01Record(page, record.id);
      const remoteDraft = structuredClone(current.draft);
      const remoteText = "Committed wording must survive clearing invalid recovery.";
      body({ ...current, draft: remoteDraft }).node.text = remoteText;
      const deckPath = `${e01ApiUrl}/v1/presentations/${record.id}`;
      const committed = await page.request.put(`${deckPath}/draft`, {
        data: {
          schemaVersion: 2,
          draft: remoteDraft,
          expectedRevision: current.draftRevision,
          mutationId: randomUUID(),
        },
      });
      expect(committed.status()).toBe(200);
      const committedRecord = (await committed.json()).presentation as E01Record;
      let refuseReload = true;
      await page.route(deckPath, async (route) => {
        if (route.request().method() === "GET" && refuseReload) {
          refuseReload = false;
          await route.fulfill({
            status: 503,
            json: {
              error: {
                code: "DEPENDENCY_UNAVAILABLE",
                message: "Saved deck is temporarily unavailable",
              },
            },
          });
        } else await route.continue();
      });
      await dialog.getByRole("checkbox", { name: consentName, exact: true }).check();
      const failedRead = page.waitForResponse(
        (response) => response.url() === deckPath && response.status() === 503,
      );
      await dialog.getByRole("button", { name: resetName, exact: true }).click();
      await failedRead;
      await expect(dialog.getByRole("button", { name: resetName, exact: true })).toBeEnabled();
      expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBe(invalid);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByText(
          "A text assistance receipt is outstanding. Recover it before editing this deck.",
          {
            exact: true,
          },
        ),
      ).toBeVisible();
      dialog = await openText(page, "rewrite", true);
      await dialog.getByRole("checkbox", { name: consentName, exact: true }).check();
      await dialog.getByRole("button", { name: resetName, exact: true }).click();
      await expect(dialog).toBeHidden();
      await page.unroute(deckPath);
      expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull();
      expect(await page.evaluate((key) => sessionStorage.getItem(key), otherKey)).toBe(
        "Preserve unrelated recovery",
      );
      expect((await readE01Record(page, record.id)).draftRevision).toBe(
        committedRecord.draftRevision,
      );
      await closeDrawers(page);
      await selectE01Body(page);
      const input = page.getByRole("textbox", { name: "Node text", exact: true });
      await expect(input).toHaveValue(remoteText);
      const manualText = `${remoteText} Manual editing is available.`;
      await input.fill(manualText);
      await expect
        .poll(async () => body(await readE01Record(page, record.id)).node.text)
        .toBe(manualText);
      await page.reload();
      await expect(page.locator('summary[aria-label="More options"]')).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Resume text assistance", exact: true }),
      ).toBeHidden();
      expect(body(await readE01Record(page, record.id)).node.text).toBe(manualText);
    }
  });
}
