import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { signInBeta } from "./sign-in";
import { openLibraryFilters } from "./library-controls";
import {
  clickNavigatorAction,
  closeE01Overlays,
  openE01Navigator,
} from "./presentation-e01-support";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

async function openPresentationReferences(page: Page) {
  const related = page.locator('summary[aria-label="Related content"]');
  await expect(related).toBeVisible();
  await closeE01Overlays(page);
  if ((await related.locator("xpath=ancestor::details[1]").getAttribute("open")) === null)
    await related.click();
  const references = page.getByRole("region", {
    name: "Recovery Pack facilitator references",
    exact: true,
  });
  await expect(references).toBeVisible();
  const details = references.locator("details").first();
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").first().click();
  return references;
}

async function recoveryPackWorkflow(page: Page) {
  test.setTimeout(120_000);
  await signInBeta(page);
  await expect(page.getByRole("heading", { name: "Rounds", exact: true })).toBeVisible();

  const sourceTitle = `Pack source ${randomUUID().slice(0, 8)}`;
  const diagnosticId = randomUUID();
  const recheckId = randomUUID();
  const diagnostic = {
    id: diagnosticId,
    type: "numeric",
    prompt: "A ratio compares 2 parts with 4 parts. What is the ratio?",
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["ratios"],
    linkedRecheckQuestionId: recheckId,
    timeLimitSeconds: 30,
    basePoints: 1_000,
    explanation: "Divide the compared part by the reference part.",
    mediaId: null,
    mediaAlt: null,
    correctValue: "0.5",
    tolerance: "0",
    unit: null,
  };
  const created = await page.request.post(`${apiUrl}/v1/quizzes`, { data: { title: sourceTitle } });
  expect(created.status()).toBe(201);
  const source = (await created.json()).quiz as { id: string; draftRevision: number };
  const saved = await page.request.patch(`${apiUrl}/v1/quizzes/${source.id}`, {
    data: {
      expectedDraftRevision: source.draftRevision,
      draft: {
        title: sourceTitle,
        description: "Published source",
        questions: [
          diagnostic,
          {
            ...diagnostic,
            id: recheckId,
            delivery: "recheck",
            linkedRecheckQuestionId: null,
            prompt: "A new diagram compares 3 parts with 12 parts. What is the ratio?",
            correctValue: "0.25",
          },
        ],
      },
    },
  });
  expect(saved.ok()).toBeTruthy();
  const publishedSource = await page.request.post(`${apiUrl}/v1/quizzes/${source.id}/publish`, {
    data: {},
  });
  expect(publishedSource.ok()).toBeTruthy();
  const targetTitle = `Pack destination ${randomUUID().slice(0, 8)}`;
  const targetResponse = await page.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title: targetTitle },
  });
  expect(targetResponse.status()).toBe(201);
  const target = (await targetResponse.json()).quiz as { id: string };

  await page.goto("/library");
  await openLibraryFilters(page);
  await page.getByRole("link", { name: "Recovery Packs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recovery Packs", exact: true })).toBeVisible();
  await page.getByLabel("Source Round").selectOption(source.id, { timeout: 10_000 });
  await page.getByLabel("Diagnostic and linked recheck").selectOption(diagnosticId);
  await page.getByRole("button", { name: "Create Pack draft" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(sourceTitle);
  const title = `Ratios recovery ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Title", { exact: true }).fill(title);
  const guidance = "Draw two contrasting ratios and explain which quantity is the reference.";
  await page.getByLabel("Card 1 facilitator guidance").fill(guidance);
  const saveMutationIds: string[] = [];
  let loseSaveAcknowledgement = true;
  await page.route("**/v1/recovery-packs/*/draft", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    saveMutationIds.push(route.request().postDataJSON().mutationId as string);
    if (loseSaveAcknowledgement) {
      loseSaveAcknowledgement = false;
      const accepted = await route.fetch();
      expect(accepted.ok()).toBeTruthy();
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator("p.error[role=alert]")).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved." })).toBeVisible();
  expect(saveMutationIds).toHaveLength(2);
  expect(saveMutationIds[0]).toBe(saveMutationIds[1]);
  await expect(page.getByRole("button", { name: "Publish saved draft" })).toBeEnabled();
  await page.getByRole("button", { name: "Publish saved draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Pack published" })).toBeVisible();
  const destination = page.getByLabel("Destination Round draft");
  const unsafeId = '<img src=x onerror="alert(1)">';
  await destination.evaluate((select, value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = "Invalid destination";
    select.append(option);
  }, unsafeId);
  await destination.selectOption(unsafeId);
  await expect(page.getByRole("link", { name: "Open destination Round builder" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Insert into Round draft" })).toBeDisabled();
  await page.getByLabel("Destination Round draft").selectOption(target.id);
  await expect(page.getByRole("link", { name: "Open destination Round builder" })).toHaveAttribute(
    "href",
    `/quiz/${target.id}`,
  );
  await page.getByRole("button", { name: "Insert into Round draft" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Published Pack inserted" }),
  ).toBeVisible();
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Polling Pops JSON" }).click();
  expect((await exported).suggestedFilename()).toContain("Ratios-recovery");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("link", { name: "Open destination Round builder" }).click();
  const references = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Recovery Pack facilitator references:" }) });
  await expect(references).toBeVisible();
  await references.locator("summary").click();
  await expect(references).toContainText(guidance);
  await expect(references).toContainText(
    "playback is available in eligible new Round sessions when enabled for the workspace.",
  );
  await expect(references).toContainText(
    "The facilitator explicitly selects a card after revealing the Pack diagnostic.",
  );

  // Simulate the UI flag being disabled while preserving real authenticated resource reads.
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const account = await response.json();
    await route.fulfill({
      response,
      json: {
        ...account,
        productFeatures: {
          ...account.productFeatures,
          recoveryPacks: false,
          workspaceShell: false,
          uxBeta: false,
        },
      },
    });
  });
  await page.goto("/recovery-packs");
  await expect(
    page.getByText("Pack authoring is not enabled for this workspace.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.getByLabel("Card 1 facilitator guidance")).toHaveValue(guidance);
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Create Pack draft" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export Polling Pops JSON" })).toBeEnabled();
  const disabledExport = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Polling Pops JSON" }).click();
  await disabledExport;
  await expect(page.getByRole("button", { name: "Reload saved draft" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Delete Pack permanently" })).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Pack permanently" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Pack deleted." })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(title) })).toHaveCount(0);
  const preservedTarget = await page.request.get(`${apiUrl}/v1/quizzes/${target.id}`);
  expect(preservedTarget.ok()).toBeTruthy();
  const { quiz } = await preservedTarget.json();
  expect(quiz.draft.questions).toHaveLength(2);
  expect(quiz.draft.recoveryPackInsertions[0].originalContent.interventions[0].body).toBe(guidance);
}

test("Recovery Pack published-source authoring, insertion, and disabled-rollout readability", async ({
  page,
}) => {
  await recoveryPackWorkflow(page);
});

test("Recovery Pack authoring and disabled-rollout readability @mobile", async ({ page }) => {
  await recoveryPackWorkflow(page);
});

async function presentationPackWorkflow(page: Page, browser: Browser, testInfo: TestInfo) {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  await signInBeta(page);
  await expect(page.getByRole("heading", { name: "Rounds", exact: true })).toBeVisible();
  const title = `Presentation Pack ${randomUUID().slice(0, 8)}`;
  const recheckId = randomUUID();
  const diagnostic = {
    id: randomUUID(),
    type: "numeric",
    prompt: "Diagnostic: what is half of eight?",
    correctValue: "4",
    tolerance: "0",
    unit: null,
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["halves"],
    linkedRecheckQuestionId: recheckId,
    timeLimitSeconds: 30,
    basePoints: 1_000,
    explanation: "Private diagnostic explanation: divide into two equal groups.",
    mediaId: null,
    mediaAlt: null,
  };
  const recheckPrompt = `Private future recheck ${randomUUID().slice(0, 8)}`;
  const cardBody = `Facilitator-only contrast guidance ${randomUUID().slice(0, 8)}`;
  const citationName = `Facilitator citation ${randomUUID().slice(0, 8)}`;
  const packCreated = await page.request.post(`${apiUrl}/v1/recovery-packs`, {
    data: {
      draft: {
        schemaVersion: 1,
        title,
        description: "Two linked checkpoints with frozen cards.",
        diagnostic,
        recheck: {
          ...diagnostic,
          id: recheckId,
          delivery: "recheck",
          linkedRecheckQuestionId: null,
          prompt: recheckPrompt,
          correctValue: "6",
        },
        interventions: [
          {
            id: randomUUID(),
            title: "Compare two equal groups",
            body: cardBody,
            citations: [
              {
                sourceName: citationName,
                sourceDigest: "a".repeat(64),
                locator: "p. 3",
                excerpt: "Two groups",
              },
            ],
          },
        ],
        delayedProbe: null,
        conceptKeys: ["halves"],
        misconceptionKeys: [],
        citations: [],
      },
    },
  });
  expect(packCreated.status()).toBe(201);
  const pack = (await packCreated.json()).pack;
  const packPublished = await page.request.post(`${apiUrl}/v1/recovery-packs/${pack.id}/publish`, {
    data: { expectedDraftRevision: pack.draftRevision },
  });
  expect(packPublished.status()).toBe(200);
  const sourceVersion = (await packPublished.json()).version;
  const created = await page.request.post(`${apiUrl}/v1/presentations`, {
    data: { title: `Destination ${title}`, description: "" },
  });
  expect(created.status()).toBe(201);
  const presentation = (await created.json()).presentation;
  await page.goto(`/presentation/${presentation.id}`);
  const presentationTitle = `Saved local edit ${title}`;
  await page.getByLabel("Presentation title", { exact: true }).fill(presentationTitle);
  await closeE01Overlays(page);
  await page
    .locator("#presentation-canvas")
    .getByLabel("Slide title", { exact: true })
    .fill("Context for linked recovery");
  await clickNavigatorAction(page, "From Recovery Pack");
  const picker = page.getByRole("dialog", { name: "Insert a published Recovery Pack" });
  await expect(picker).toBeVisible();
  await picker.getByLabel("Published Recovery Pack").selectOption(pack.id);
  await expect(picker.getByRole("region", { name: "Published Pack preview" })).toContainText(title);
  await expect(picker.getByRole("button", { name: "Insert Pack checkpoints" })).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const insertionBodies: string[] = [];
  let loseAcknowledgement = true;
  await page.route(
    `**/v1/presentations/${presentation.id}/recovery-packs/insert`,
    async (route) => {
      insertionBodies.push(route.request().postData()!);
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        const accepted = await route.fetch();
        expect(accepted.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await picker.getByRole("button", { name: "Insert Pack checkpoints" }).click();
  await expect(picker.getByRole("button", { name: "Retry Pack insertion" })).toBeEnabled();
  await expect(page.locator("header")).toHaveAttribute("inert", "");
  await expect(picker.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await picker.getByRole("button", { name: "Retry Pack insertion" }).click();
  await expect(picker).toHaveCount(0);
  expect(insertionBodies).toHaveLength(2);
  expect(insertionBodies[1]).toBe(insertionBodies[0]);
  const insertedResponse = await page.request.get(`${apiUrl}/v1/presentations/${presentation.id}`);
  expect(insertedResponse.status()).toBe(200);
  const inserted = (await insertedResponse.json()).presentation;
  expect(inserted.draft.title).toBe(presentationTitle);
  expect(inserted.draftRevision).toBe(presentation.draftRevision + 2);
  expect(inserted.draft.schemaVersion).toBe(3);
  expect(inserted.draft.blocks).toHaveLength(presentation.draft.blocks.length + 2);
  expect(inserted.draft.recoveryPackInsertions).toHaveLength(1);
  expect(inserted.draft.recoveryPackInsertions[0].packVersionId).toBe(sourceVersion.id);
  const baseline = inserted.draft.recoveryPackInsertions;
  const references = await openPresentationReferences(page);
  await expect(references).toContainText(cardBody);
  await expect(references).toContainText(citationName);
  await expect(references).toContainText(
    "playback is available in eligible new Presentation sessions when enabled for the workspace.",
  );
  await expect(references).toContainText(
    "The facilitator explicitly selects a card after revealing the Pack diagnostic.",
  );
  await closeE01Overlays(page);
  const editedPrompt = `Edited diagnostic ${randomUUID().slice(0, 8)}`;
  const savedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === `/v1/presentations/${presentation.id}/draft`,
  );
  await page.getByLabel("Question prompt", { exact: true }).fill(editedPrompt);
  const saved = await savedResponse;
  expect(saved.status()).toBe(200);
  expect(saved.request().postDataJSON()).toMatchObject({
    schemaVersion: 2,
    draft: { schemaVersion: 3 },
  });
  expect((await saved.json()).presentation.draft.recoveryPackInsertions).toEqual(baseline);
  await expect(page.locator('header [role="status"]')).toHaveText("Saved");
  const publishResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/v1/presentations/${presentation.id}/publish`,
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const published = await publishResponse;
  expect(published.status()).toBe(200);
  expect((await published.json()).version.content.recoveryPackInsertions).toEqual(baseline);
  const removed = await page.request.delete(`${apiUrl}/v1/recovery-packs/${pack.id}`);
  expect(removed.status()).toBe(204);
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const account = await response.json();
    await route.fulfill({
      response,
      json: { ...account, productFeatures: { ...account.productFeatures, recoveryPacks: false } },
    });
  });
  await page.reload();
  const navigator = await openE01Navigator(page);
  await navigator.locator('summary[aria-label="Insert & import"]').click();
  await expect(
    navigator.getByRole("button", {
      name: "From Recovery Pack",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveCount(0);
  await openPresentationReferences(page);
  await expect(references).toBeVisible();
  await expect(references).toContainText(cardBody);
  await expect(references).toContainText(citationName);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
  const participantContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  });
  try {
    await page.goto(`/presentation/${presentation.id}/host`);
    await page.getByRole("button", { name: "Start live session", exact: true }).click();
    await expect(page).toHaveURL(/\/presentation-session\/[^/]+\/host$/);
    const sessionId = new URL(page.url()).pathname.split("/")[2]!;
    const sessionResponse = await page.request.get(
      `${apiUrl}/v1/presentation-sessions/${sessionId}`,
    );
    const { snapshot } = await sessionResponse.json();
    const participant = await participantContext.newPage();
    let leakedReference = false;
    participant.on("websocket", (socket) =>
      socket.on("framereceived", ({ payload }) => {
        const text = payload.toString();
        if (
          [cardBody, citationName, recheckPrompt, diagnostic.explanation].some((secret) =>
            text.includes(secret),
          )
        )
          leakedReference = true;
      }),
    );
    await participant.goto(`/join?code=${snapshot.code}`);
    await participant.getByLabel("Nickname", { exact: true }).fill("Pack participant");
    await participant.getByRole("button", { name: "Join presentation", exact: true }).click();
    await expect(participant).toHaveURL(`/presentation-session/${sessionId}/play`);
    await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
    await page.getByRole("button", { name: "Next block", exact: true }).click();
    await expect(
      participant.getByRole("heading", { name: editedPrompt, exact: true }),
    ).toBeVisible();
    await expect(
      participant.getByRole("region", { name: "Recovery Pack facilitator references" }),
    ).toHaveCount(0);
    for (const secret of [cardBody, citationName, recheckPrompt, diagnostic.explanation])
      await expect(participant.getByText(secret, { exact: true })).toHaveCount(0);
    expect(leakedReference).toBe(false);
  } finally {
    await participantContext.close();
  }
}

test("Presentation Pack insertion drains edits, recovers lost ACK, and retains private frozen references", async ({
  page,
  browser,
}, testInfo) => {
  await presentationPackWorkflow(page, browser, testInfo);
});

test("Presentation Pack insertion and frozen references @mobile", async ({
  page,
  browser,
}, testInfo) => {
  await presentationPackWorkflow(page, browser, testInfo);
});

test("Presentation workspace retry and deferred import preparation preserve one active dialog", async ({
  page,
}) => {
  await signInBeta(page);
  await expect(page.getByRole("heading", { name: "Rounds", exact: true })).toBeVisible();
  const title = `Import barrier ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post(`${apiUrl}/v1/presentations`, {
    data: { title, description: "" },
  });
  expect(created.status()).toBe(201);
  const presentation = (await created.json()).presentation;
  let failWorkspace = true;
  await page.route("**/v1/auth/me", async (route) => {
    if (failWorkspace) {
      failWorkspace = false;
      await route.fulfill({
        status: 503,
        json: {
          error: { code: "UNAVAILABLE", message: "Workspace lookup temporarily unavailable" },
        },
      });
    } else await route.continue();
  });
  await page.goto(`/presentation/${presentation.id}`);
  await expect(
    page.getByRole("alert").filter({ hasText: "Workspace lookup temporarily unavailable" }),
  ).toHaveText("Workspace lookup temporarily unavailable");
  await page.getByRole("button", { name: "Retry workspace", exact: true }).click();
  await expect(page.getByLabel("Presentation title", { exact: true })).toHaveValue(title);
  let releaseSave!: () => void;
  let noteSaveStarted!: () => void;
  const saveStarted = new Promise<void>((resolve) => {
    noteSaveStarted = resolve;
  });
  const acknowledgement = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route(`**/v1/presentations/${presentation.id}/draft`, async (route) => {
    const response = await route.fetch();
    noteSaveStarted();
    await acknowledgement;
    await route.fulfill({ response });
  });
  try {
    await page.getByLabel("Presentation title", { exact: true }).fill(`${title} — pending edit`);
    await clickNavigatorAction(page, "From trusted source");
    await saveStarted;
    await expect(
      page.getByRole("button", { name: "From Recovery Pack", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "From published Round", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("dialog", { name: "Insert a published Recovery Pack" }),
    ).toHaveCount(0);
    releaseSave();
    const source = page.getByRole("dialog", { name: "Insert from a trusted source" });
    await expect(source).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await source.getByRole("button", { name: "Close", exact: true }).click();
    await expect(source).toHaveCount(0);
    await clickNavigatorAction(page, "From Recovery Pack");
    const pack = page.getByRole("dialog", { name: "Insert a published Recovery Pack" });
    await expect(pack).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await pack.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    releaseSave();
  }
});

async function presentationPackUpdateWorkflow(page: Page) {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  await signInBeta(page);
  await expect(page.getByRole("heading", { name: "Rounds", exact: true })).toBeVisible();
  const title = `Presentation update ${randomUUID().slice(0, 8)}`;
  const recheckId = randomUUID();
  const diagnostic = {
    id: randomUUID(),
    type: "numeric",
    prompt: "Original diagnostic situation",
    correctValue: "2",
    tolerance: "0",
    unit: null,
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["ratios"],
    linkedRecheckQuestionId: recheckId,
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: "Compare two ratios.",
    mediaId: null,
    mediaAlt: null,
  };
  const content = {
    schemaVersion: 1,
    title,
    description: "Original accepted context",
    diagnostic,
    recheck: {
      ...diagnostic,
      id: recheckId,
      prompt: "Original transfer situation",
      delivery: "recheck",
      linkedRecheckQuestionId: null,
    },
    interventions: [
      { id: randomUUID(), title: "Original card", body: "Original frozen facilitator guidance" },
    ],
    conceptKeys: ["ratios"],
    misconceptionKeys: [],
    citations: [],
    delayedProbe: null,
  };
  const createdPack = await page.request.post(`${apiUrl}/v1/recovery-packs`, {
    data: { draft: content },
  });
  expect(createdPack.status()).toBe(201);
  let pack = (await createdPack.json()).pack;
  const firstPublished = await page.request.post(`${apiUrl}/v1/recovery-packs/${pack.id}/publish`, {
    data: { expectedDraftRevision: pack.draftRevision },
  });
  expect(firstPublished.status()).toBe(200);
  const firstVersion = (await firstPublished.json()).version;
  const createdPresentation = await page.request.post(`${apiUrl}/v1/presentations`, {
    data: { title, description: "" },
  });
  expect(createdPresentation.status()).toBe(201);
  const target = (await createdPresentation.json()).presentation;
  const emptySaved = await page.request.put(`${apiUrl}/v1/presentations/${target.id}/draft`, {
    data: {
      draft: { ...target.draft, blocks: [] },
      expectedRevision: target.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(emptySaved.status()).toBe(200);
  const empty = (await emptySaved.json()).presentation;
  const insertedResponse = await page.request.post(
    `${apiUrl}/v1/presentations/${target.id}/recovery-packs/insert`,
    {
      data: {
        packVersionId: firstVersion.id,
        afterBlockId: null,
        expectedRevision: empty.draftRevision,
        mutationId: randomUUID(),
      },
    },
  );
  expect(insertedResponse.status()).toBe(200);
  const inserted = (await insertedResponse.json()).presentation;
  const insertion = inserted.draft.recoveryPackInsertions[0];
  const originallyPublished = await page.request.post(
    `${apiUrl}/v1/presentations/${target.id}/publish`,
    {
      data: { expectedDraftRevision: inserted.draftRevision },
    },
  );
  expect(originallyPublished.status()).toBe(200);
  const originalPresentationVersion = (await originallyPublished.json()).version;
  // Model normal local deletion: unlink the diagnostic before deleting its paired recheck.
  const localSaved = await page.request.put(`${apiUrl}/v1/presentations/${target.id}/draft`, {
    data: {
      draft: {
        ...inserted.draft,
        blocks: inserted.draft.blocks
          .filter(
            (block: { question: { id: string } }) =>
              block.question.id !== insertion.recheckQuestionId,
          )
          .map((block: { question: { id: string } }) => ({
            ...block,
            question: { ...block.question, linkedRecheckQuestionId: null },
          })),
      },
      expectedRevision: inserted.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(localSaved.status()).toBe(200);
  const sourceSaved = await page.request.put(`${apiUrl}/v1/recovery-packs/${pack.id}/draft`, {
    data: {
      draft: {
        ...pack.draft,
        diagnostic: { ...pack.draft.diagnostic, prompt: "Reviewed V2 diagnostic" },
        recheck: { ...pack.draft.recheck, prompt: "Reviewed V2 transfer" },
        interventions: [
          { ...pack.draft.interventions[0], body: "Reviewed V2 facilitator guidance" },
        ],
      },
      expectedRevision: pack.draftRevision,
      mutationId: randomUUID(),
    },
  });
  expect(sourceSaved.status()).toBe(200);
  pack = (await sourceSaved.json()).pack;
  const secondPublished = await page.request.post(
    `${apiUrl}/v1/recovery-packs/${pack.id}/publish`,
    {
      data: { expectedDraftRevision: pack.draftRevision },
    },
  );
  expect(secondPublished.status()).toBe(200);
  const secondVersion = (await secondPublished.json()).version;
  await page.goto(`/presentation/${target.id}`);
  const reviews = page.getByRole("region", {
    name: "Presentation Recovery Pack updates",
    exact: true,
  });
  await expect(reviews).toBeVisible();
  await closeE01Overlays(page);
  const panel = reviews
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: `Review Pack updates · ${title}` }) })
    .first();
  await panel.locator("summary").first().click();
  let releaseReview!: () => void;
  const reviewGate = new Promise<void>((resolve) => {
    releaseReview = resolve;
  });
  let reviewStarted = false;
  await page.route(
    `**/v1/presentations/${target.id}/recovery-packs/update-review`,
    async (route) => {
      reviewStarted = true;
      await reviewGate;
      await route.continue();
    },
  );
  try {
    const pendingTitle = `${title} — pending local edit`;
    await page.getByLabel("Presentation title", { exact: true }).fill(pendingTitle);
    await panel.getByRole("button", { name: "Review latest Pack version" }).click();
    await expect.poll(() => reviewStarted).toBe(true);
    await expect(page.locator("header")).toHaveAttribute("inert", "");
    const savedBeforeReview = await page.request.get(`${apiUrl}/v1/presentations/${target.id}`);
    expect((await savedBeforeReview.json()).presentation.draft.title).toBe(pendingTitle);
    releaseReview();
    await expect(panel.getByLabel("Diagnostic update choice")).toHaveValue("");
    await expect(panel.getByLabel("Recheck update choice")).toHaveValue("");
  } finally {
    releaseReview();
  }
  await page.unroute(`**/v1/presentations/${target.id}/recovery-packs/update-review`);
  const currentTitle = `${title} — newer local edit`;
  await page.getByLabel("Presentation title", { exact: true }).fill(currentTitle);
  await expect(panel.getByRole("button", { name: "Apply reviewed Pack update" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Review latest Pack version" }).click();
  await expect(panel.getByLabel("Diagnostic update choice")).toHaveValue("");
  await panel.getByLabel("Diagnostic update choice").selectOption("keep_local");
  await panel.getByLabel("Recheck update choice").selectOption("use_latest");
  await expect(panel.getByRole("alert", { name: "Linked checkpoint choices" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Apply reviewed Pack update" })).toBeDisabled();
  await panel.getByLabel("Diagnostic update choice").selectOption("use_latest");
  await expect(panel.getByRole("alert", { name: "Linked checkpoint choices" })).toHaveCount(0);
  const comparison = panel
    .locator("details")
    .filter({
      has: page.locator("summary", { hasText: "Pack context comparison: baseline and latest" }),
    })
    .first();
  await comparison.locator("summary").first().click();
  await expect(comparison).toContainText("Original frozen facilitator guidance");
  await expect(comparison).toContainText("Reviewed V2 facilitator guidance");
  const references = await openPresentationReferences(page);
  await expect(references).toContainText("Original frozen facilitator guidance");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // Publish V3 after reviewing V2: apply must remain pinned to the exact reviewed version.
  const thirdSaved = await page.request.put(`${apiUrl}/v1/recovery-packs/${pack.id}/draft`, {
    data: {
      draft: {
        ...pack.draft,
        diagnostic: { ...pack.draft.diagnostic, prompt: "Later V3 diagnostic" },
        interventions: [{ ...pack.draft.interventions[0], body: "Later V3 facilitator guidance" }],
      },
      expectedRevision: pack.draftRevision,
      mutationId: randomUUID(),
    },
  });
  expect(thirdSaved.status()).toBe(200);
  const thirdPublished = await page.request.post(`${apiUrl}/v1/recovery-packs/${pack.id}/publish`, {
    data: { expectedDraftRevision: (await thirdSaved.json()).pack.draftRevision },
  });
  expect(thirdPublished.status()).toBe(200);
  const thirdVersion = (await thirdPublished.json()).version;
  const updateBodies: string[] = [];
  let loseUpdate = true;
  await page.route(`**/v1/presentations/${target.id}/recovery-packs/update`, async (route) => {
    updateBodies.push(route.request().postData()!);
    if (loseUpdate) {
      loseUpdate = false;
      expect((await route.fetch()).status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await panel.getByRole("button", { name: "Apply reviewed Pack update" }).click();
  await expect(
    panel.getByRole("button", { name: "Retry Pack update acknowledgement" }),
  ).toBeEnabled();
  await expect(page.locator("header")).toHaveAttribute("inert", "");
  await panel.getByRole("button", { name: "Retry Pack update acknowledgement" }).click();
  await expect(panel.getByRole("button", { name: "Undo this Pack update" })).toBeEnabled();
  expect(updateBodies).toHaveLength(2);
  expect(updateBodies[0]).toBe(updateBodies[1]);
  expect(JSON.parse(updateBodies[0]!).packVersionId).toBe(secondVersion.id);
  await openPresentationReferences(page);
  await expect(references).toContainText("Reviewed V2 facilitator guidance");
  const afterApply = (
    await (await page.request.get(`${apiUrl}/v1/presentations/${target.id}`)).json()
  ).presentation;
  expect(afterApply.draftRevision).toBe(JSON.parse(updateBodies[0]!).expectedRevision + 1);
  expect(afterApply.draft.blocks).toHaveLength(2);
  expect(afterApply.draft.blocks[0].id).toBe(inserted.draft.blocks[0].id);
  expect(afterApply.draft.blocks[0].question.prompt).toBe("Reviewed V2 diagnostic");
  expect(afterApply.draft.blocks[0].question.linkedRecheckQuestionId).toBe(
    insertion.recheckQuestionId,
  );
  expect(afterApply.draft.blocks[1].question.delivery).toBe("recheck");
  expect(afterApply.draft.recoveryPackInsertions[0].originalContent).toEqual(
    insertion.originalContent,
  );
  expect(afterApply.draft.recoveryPackInsertions[0].updateBaseline.packVersionId).toBe(
    secondVersion.id,
  );
  const publishedBeforeUndo = await page.request.get(`${apiUrl}/v1/presentations/${target.id}`);
  const publishedIdentity = (await publishedBeforeUndo.json()).presentation;
  expect(publishedIdentity.currentVersionId).toBe(originalPresentationVersion.id);
  expect(publishedIdentity.hasUnpublishedChanges).toBe(true);
  const undoBodies: string[] = [];
  let loseUndo = true;
  await page.route(`**/v1/presentations/${target.id}/history/*/restore`, async (route) => {
    undoBodies.push(route.request().postData()!);
    if (loseUndo) {
      loseUndo = false;
      expect((await route.fetch()).status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await panel.getByRole("button", { name: "Undo this Pack update" }).click();
  await expect(panel.getByRole("button", { name: "Retry undo acknowledgement" })).toBeEnabled();
  await panel.getByRole("button", { name: "Retry undo acknowledgement" }).click();
  await expect(panel.getByRole("status")).toContainText("Pack update undone");
  expect(undoBodies).toHaveLength(2);
  expect(undoBodies[0]).toBe(undoBodies[1]);
  await openPresentationReferences(page);
  await expect(references).toContainText("Original frozen facilitator guidance");
  const afterUndo = (
    await (await page.request.get(`${apiUrl}/v1/presentations/${target.id}`)).json()
  ).presentation;
  expect(afterUndo.draftRevision).toBe(afterApply.draftRevision + 1);
  expect(afterUndo.draft.title).toBe(currentTitle);
  expect(afterUndo.draft.blocks).toHaveLength(1);
  expect(afterUndo.draft.recoveryPackInsertions[0].updateBaseline).toBeUndefined();
  await panel.getByRole("button", { name: "Review latest Pack version" }).click();
  await expect(panel.getByLabel("Diagnostic update choice")).toHaveValue("");
  await panel.getByLabel("Diagnostic update choice").selectOption("use_latest");
  await panel.getByLabel("Recheck update choice").selectOption("use_latest");
  await panel.getByRole("button", { name: "Apply reviewed Pack update" }).click();
  await expect(panel.getByRole("button", { name: "Undo this Pack update" })).toBeEnabled();
  await openPresentationReferences(page);
  await expect(references).toContainText("Later V3 facilitator guidance");
  await page.getByLabel("Presentation title", { exact: true }).fill(`${title} — later work`);
  await expect(panel.getByRole("button", { name: "Undo this Pack update" })).toBeDisabled();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${apiUrl}/v1/presentations/${target.id}`)).json())
          .presentation.draft.title,
    )
    .toBe(`${title} — later work`);
  await expect(panel.getByRole("button", { name: "Undo this Pack update" })).toBeDisabled();
  const finalDraft = (
    await (await page.request.get(`${apiUrl}/v1/presentations/${target.id}`)).json()
  ).presentation;
  expect(finalDraft.draft.recoveryPackInsertions[0].updateBaseline.packVersionId).toBe(
    thirdVersion.id,
  );
  const published = await page.request.post(`${apiUrl}/v1/presentations/${target.id}/publish`, {
    data: { expectedDraftRevision: finalDraft.draftRevision },
  });
  expect(published.status()).toBe(200);
  expect(
    (await published.json()).version.content.recoveryPackInsertions[0].updateBaseline.packVersionId,
  ).toBe(thirdVersion.id);
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const account = await response.json();
    await route.fulfill({
      response,
      json: {
        ...account,
        productFeatures: { ...account.productFeatures, recoveryPacks: false, presentations: false },
      },
    });
  });
  await page.reload();
  await expect(reviews).toBeVisible();
  await closeE01Overlays(page);
  await panel.locator("summary").first().click();
  await expect(panel).toContainText("Pack update authoring is disabled");
  await panel.getByRole("button", { name: "Review latest Pack version" }).click();
  await expect(panel).toContainText("already up to date");
  await expect(panel.getByRole("button", { name: "Apply reviewed Pack update" })).toBeDisabled();
  await openPresentationReferences(page);
  await expect(references).toContainText("Later V3 facilitator guidance");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

test("Presentation Pack updates fence drafts, pin review intent, and recover apply/undo ACKs", async ({
  page,
}) => {
  await presentationPackUpdateWorkflow(page);
});

test("Presentation Pack update review and fenced undo @mobile", async ({ page }) => {
  await presentationPackUpdateWorkflow(page);
});
