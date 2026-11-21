import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";

const enabled = process.env.BETA_E2E_AUTHORING === "true";
const apiPort = Number(process.env.BETA_E2E_API_PORT ?? 4200);
const apiUrl = `http://127.0.0.1:${apiPort}`;
const providerPort = Number(process.env.BETA_E2E_AUTHORING_PORT ?? apiPort + 2);
const excerpt = "Divide a whole into two equal groups to find half.";
const sourceText = `${excerpt} Half of eight is four. Half of six is three.`;
let provider: Server | undefined;
let providerCalls = 0;
let providerResponseHold: ReturnType<typeof deferred> | null = null;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test.skip(!enabled, "Source authoring fixture requires BETA_E2E_AUTHORING=true.");

test.beforeAll(async () => {
  if (!enabled) return;
  const common = {
    type: "numeric",
    confidence: "off",
    explanation: excerpt,
    timeLimitSeconds: 30,
    citationIndexes: [0],
    tolerance: "0",
    unit: null,
  };
  const output = {
    title: "Source-assisted halves",
    description: "Synthetic grounded source fixture for explicit human review.",
    conceptKey: "halves",
    citations: [{ locator: "paragraph 1", excerpt }],
    main: { ...common, purpose: "diagnostic", prompt: "What is half of eight?", correctValue: "4" },
    recheck: { ...common, purpose: "practice", prompt: "What is half of six?", correctValue: "3" },
  };
  provider = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    request.resume();
    request.on("end", async () => {
      providerCalls += 1;
      await providerResponseHold?.promise;
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
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

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

async function sourcePackWorkflow(page: Page) {
  test.setTimeout(120_000);
  await signInBeta(page);
  // The review regression selects a file locally and submits only pasted text.
  await page.route(`${apiUrl}/v1/authoring/status`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({
      response,
      json: { ...payload, status: { ...payload.status, fileUploadAvailable: true } },
    });
  });
  await page.goto("/recovery-packs");
  const assistant = page.locator("details.authoring-assistant");
  await assistant.locator("summary").click();
  await expect(assistant.getByLabel("Trusted source text")).toBeVisible();
  const sourceName = `Halves source ${randomUUID().slice(0, 8)}`;
  await assistant.getByLabel("Source name").fill(sourceName);
  await assistant.getByLabel("Trusted source text").fill(sourceText);
  const queued = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/authoring/jobs",
  );
  await assistant.getByRole("button", { name: "Create review proposal", exact: true }).click();
  const queueResponse = await queued;
  expect(queueResponse.status()).toBe(202);
  const jobId = (await queueResponse.json()).job.id as string;
  const article = assistant.getByRole("article").filter({ hasText: sourceName });
  await expect(article.getByRole("button", { name: "Review Pack source proposal" })).toBeVisible({
    timeout: 45_000,
  });
  const beforeProviderReview = providerCalls;
  await article.getByRole("button", { name: "Review Pack source proposal" }).click();
  await expect(
    article.getByRole("heading", { name: "Source Pack proposal", exact: true }),
  ).toBeFocused();
  await expect(article).toContainText("What is half of eight?");
  await expect(article).toContainText("What is half of six?");
  await expect(article).toContainText(excerpt);
  await expect(article).toContainText("Global Pack citations");
  const firstProposal = await page.request.get(
    `${apiUrl}/v1/authoring/jobs/${jobId}/recovery-pack-proposal`,
  );
  const secondProposal = await page.request.get(
    `${apiUrl}/v1/authoring/jobs/${jobId}/recovery-pack-proposal`,
  );
  expect(firstProposal.ok()).toBeTruthy();
  expect(await firstProposal.json()).toEqual(await secondProposal.json());
  expect(providerCalls).toBe(beforeProviderReview);

  const beforePacks = (await (await page.request.get(`${apiUrl}/v1/recovery-packs`)).json()).packs
    .length as number;
  const creationBodies: string[] = [];
  let loseCreationAcknowledgement = true;
  await page.route(`**/v1/authoring/jobs/${jobId}/apply-recovery-pack`, async (route) => {
    creationBodies.push(route.request().postData()!);
    if (loseCreationAcknowledgement) {
      loseCreationAcknowledgement = false;
      const accepted = await route.fetch();
      expect(accepted.status()).toBe(201);
      await route.abort("failed");
    } else await route.continue();
  });
  await article
    .getByRole("button", { name: "Create source Pack draft", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(article.getByRole("alert")).toBeVisible();
  expect(creationBodies).toHaveLength(1);
  await article.getByRole("button", { name: "Retry creating source Pack draft" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Source-assisted halves");
  expect(creationBodies).toHaveLength(2);
  expect(creationBodies[0]).toBe(creationBodies[1]);
  const packs = (await (await page.request.get(`${apiUrl}/v1/recovery-packs`)).json()).packs;
  expect(packs).toHaveLength(beforePacks + 1);
  const createdPack = packs.find(
    (pack: { sourceReview?: { authoringJobId: string } }) =>
      pack.sourceReview?.authoringJobId === jobId,
  );
  expect(createdPack.currentVersionId).toBeNull();
  expect(createdPack.sourceReview.approved).toBe(false);

  const review = page.getByRole("region", { name: "Source content and citation review" });
  const contentCheck = review.getByLabel(
    "I reviewed the full saved content, answer keys, and facilitator guidance.",
  );
  const citationCheck = review.getByLabel(
    "I verified every citation and excerpt against the source.",
  );
  const approve = review.getByRole("button", { name: "Approve saved content and citations" });
  const publish = page.getByRole("button", { name: "Publish saved draft" });
  await expect(contentCheck).not.toBeChecked();
  await expect(citationCheck).not.toBeChecked();
  await expect(approve).toBeDisabled();
  await expect(publish).toBeDisabled();
  await review.locator("summary").click();
  await expect(review).toContainText(excerpt);
  await expect(review.getByText("Global Pack citations")).toBeVisible();
  const title = `Reviewed halves ${randomUUID().slice(0, 8)}`;
  await contentCheck.check();
  await citationCheck.check();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await expect(contentCheck).not.toBeChecked();
  await expect(citationCheck).not.toBeChecked();
  await expect(contentCheck).toBeDisabled();
  await expect(approve).toBeDisabled();
  await page.getByRole("button", { name: "Add intervention card" }).click();
  await page.getByLabel("Card 2 title").fill("Equal groups");
  await page
    .getByLabel("Card 2 facilitator guidance")
    .fill("Divide the whole into two equal groups and count one group.");
  await expect(
    page.getByText("New source cards inherit original Pack citations.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved." })).toBeVisible();
  await expect(contentCheck).not.toBeChecked();
  await expect(publish).toBeDisabled();
  await contentCheck.focus();
  await contentCheck.press("Space");
  await citationCheck.focus();
  await citationCheck.press("Space");
  await expect(approve).toBeEnabled();

  async function editUnrelatedSourceForm(approved: boolean) {
    const phase = approved ? "after approval" : "before approval";
    const edits = [
      () => assistant.getByLabel("Source name").fill(`Next source ${phase}`),
      () => assistant.getByLabel("Trusted source text").fill(`${sourceText} Prepared ${phase}.`),
      () => assistant.getByLabel("Upload a private file", { exact: true }).check(),
      () =>
        assistant.getByLabel("Private source file").setInputFiles({
          name: "next-source.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("An unrelated source selected for a future proposal."),
        }),
      () => assistant.getByLabel("Paste text", { exact: true }).check(),
    ];
    for (const edit of edits) {
      await edit();
      await expect(contentCheck).toBeChecked();
      await expect(citationCheck).toBeChecked();
      await expect(approve).toBeEnabled();
      if (approved) await expect(publish).toBeEnabled();
      else await expect(publish).toBeDisabled();
      await expect(page.getByLabel("Title", { exact: true })).toHaveValue(title);
      await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
    }
    // Upload changes still discard the old source preview, independently of the
    // selected saved Pack's checks, content, and approval.
    await expect(
      article.getByRole("heading", { name: "Source Pack proposal", exact: true }),
    ).toHaveCount(0);
    await expect(
      article.getByRole("button", { name: "Create source Pack draft", exact: true }),
    ).toHaveCount(0);
  }
  await editUnrelatedSourceForm(false);
  await article.getByRole("button", { name: "Review Pack source proposal" }).click();
  await expect(
    article.getByRole("heading", { name: "Source Pack proposal", exact: true }),
  ).toBeVisible();

  const approvalBodies: string[] = [];
  let loseApprovalAcknowledgement = true;
  await page.route(`**/v1/recovery-packs/${createdPack.id}/source-review`, async (route) => {
    approvalBodies.push(route.request().postData()!);
    if (loseApprovalAcknowledgement) {
      loseApprovalAcknowledgement = false;
      const accepted = await route.fetch();
      expect(accepted.ok()).toBeTruthy();
      await route.abort("failed");
    } else await route.continue();
  });
  await approve.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.locator("p.error[role=alert]")).toBeFocused();
  await expect(publish).toBeDisabled();
  expect(approvalBodies).toHaveLength(1);
  await approve.click();
  await expect(review.getByRole("status")).toContainText("has content and citation approval");
  expect(approvalBodies).toHaveLength(2);
  expect(approvalBodies[0]).toBe(approvalBodies[1]);
  await expect(publish).toBeEnabled();
  const stillDraft = await page.request.get(`${apiUrl}/v1/recovery-packs/${createdPack.id}`);
  const savedApprovedPack = (await stillDraft.json()).pack;
  expect(savedApprovedPack.currentVersionId).toBeNull();
  await contentCheck.check();
  await citationCheck.check();
  await editUnrelatedSourceForm(true);
  await expect(review.getByRole("status")).toContainText("has content and citation approval");
  const unchangedDraft = await page.request.get(`${apiUrl}/v1/recovery-packs/${createdPack.id}`);
  expect((await unchangedDraft.json()).pack).toEqual(savedApprovedPack);

  // Even reverting an unsaved edit clears the local review checks and approval affordance.
  await page.getByLabel("Title", { exact: true }).fill(`${title} edit`);
  await expect(publish).toBeDisabled();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await expect(publish).toBeDisabled();
  await expect(contentCheck).not.toBeChecked();
  await contentCheck.check();
  await citationCheck.check();
  await approve.click();
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(page.getByRole("status").filter({ hasText: "Pack published" })).toBeVisible();
  const published = (
    await (await page.request.get(`${apiUrl}/v1/recovery-packs/${createdPack.id}`)).json()
  ).pack;
  expect(published.currentVersionId).toBeTruthy();
  expect(providerCalls).toBe(beforeProviderReview);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );

  let viewer = false;
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const account = await response.json();
    await route.fulfill({
      response,
      json: {
        ...account,
        creator: { ...account.creator, role: viewer ? "viewer" : account.creator.role },
        productFeatures: { ...account.productFeatures, recoveryPacks: viewer },
      },
    });
  });
  for (const mode of ["paused", "viewer"]) {
    viewer = mode === "viewer";
    await page.reload();
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(title);
    await expect(page.locator("details.authoring-assistant")).toHaveCount(0);
    await expect(review).toBeVisible();
    await expect(contentCheck).toBeDisabled();
    await expect(approve).toBeDisabled();
    await expect(publish).toBeDisabled();
    await expect(page.getByRole("button", { name: "Reload saved draft" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Export Polling Pops JSON" })).toBeEnabled();
    await review.locator("summary").click();
    await expect(review).toContainText(excerpt);
  }
}

test("Source-assisted Pack uses the real worker, saved review and idempotent retries", async ({
  page,
}) => {
  await sourcePackWorkflow(page);
});

test("Source-assisted Pack review remains readable and bounded @mobile", async ({ page }) => {
  await sourcePackWorkflow(page);
});

for (const packAction of ["Save draft", "Reload saved draft"] as const) {
  test(`Accepted source job is retained and polled while ${packAction} is busy`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInBeta(page);
    const packTitle = `Manual Pack busy ${randomUUID().slice(0, 8)}`;
    const recheckId = randomUUID();
    const diagnostic = {
      id: randomUUID(),
      type: "numeric",
      prompt: "Manual diagnostic: what is half of eight?",
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      conceptKeys: ["halves"],
      linkedRecheckQuestionId: recheckId,
      timeLimitSeconds: 30,
      basePoints: 100,
      explanation: excerpt,
      mediaId: null,
      mediaAlt: null,
      correctValue: "4",
      tolerance: "0",
      unit: null,
    };
    const created = await page.request.post(`${apiUrl}/v1/recovery-packs`, {
      data: {
        draft: {
          schemaVersion: 1,
          title: packTitle,
          description: "Independent manual Pack used to hold a library action busy.",
          diagnostic,
          recheck: {
            ...diagnostic,
            id: recheckId,
            prompt: "Manual recheck: what is half of six?",
            delivery: "recheck",
            linkedRecheckQuestionId: null,
            correctValue: "3",
          },
          interventions: [
            { id: randomUUID(), title: "Equal groups", body: excerpt, citations: [] },
          ],
          delayedProbe: null,
          conceptKeys: ["halves"],
          misconceptionKeys: [],
          citations: [],
        },
      },
    });
    expect(created.status()).toBe(201);
    const manualPack = (await created.json()).pack as { id: string; draftRevision: number };
    const initialJobs = (await (await page.request.get(`${apiUrl}/v1/authoring/jobs`)).json())
      .jobs as Array<{ id: string; status: string; sourceName: string }>;
    expect(initialJobs.some((job) => job.status === "pending" || job.status === "processing")).toBe(
      false,
    );
    const usedBefore = (await (await page.request.get(`${apiUrl}/v1/authoring/status`)).json())
      .status.used as number;
    const providerCallsBefore = providerCalls;
    const releaseSourceResponse = deferred();
    const releasePackAction = deferred();
    const releaseProvider = deferred();
    providerResponseHold = releaseProvider;
    let sourcePosts = 0;
    let jobListReads = 0;
    let queuedJobId = "";
    let packActionAccepted = false;
    try {
      await page.route("**/v1/authoring/jobs", async (route) => {
        if (route.request().method() !== "POST") {
          jobListReads += 1;
          await route.continue();
          return;
        }
        sourcePosts += 1;
        const response = await route.fetch();
        expect(response.status()).toBe(202);
        queuedJobId = (await response.json()).job.id as string;
        await releaseSourceResponse.promise;
        await route.fulfill({ response });
      });
      const packPath = `${apiUrl}/v1/recovery-packs/${manualPack.id}${packAction === "Save draft" ? "/draft" : ""}`;
      await page.route(packPath, async (route) => {
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        packActionAccepted = true;
        await releasePackAction.promise;
        await route.fulfill({ response });
      });
      await page.goto("/recovery-packs");
      await page.getByRole("button", { name: new RegExp(packTitle) }).click();
      const expectedPackTitle = packAction === "Save draft" ? `${packTitle} saved` : packTitle;
      if (packAction === "Save draft")
        await page.getByLabel("Title", { exact: true }).fill(expectedPackTitle);
      const assistant = page.locator("details.authoring-assistant");
      await assistant.locator("summary").click();
      await expect(assistant.getByLabel("Trusted source text")).toBeVisible();
      await expect(assistant.getByText(/Loading authoring availability/)).toHaveCount(0);
      const sourceName = `Source pending during ${packAction} ${randomUUID().slice(0, 8)}`;
      await assistant.getByLabel("Source name").fill(sourceName);
      await assistant.getByLabel("Trusted source text").fill(sourceText);
      await assistant
        .getByRole("button", { name: "Create review proposal", exact: true })
        .evaluate((button: HTMLButtonElement) => {
          button.click();
          button.click();
        });
      await expect.poll(() => queuedJobId).not.toBe("");
      await expect(assistant.getByLabel("Trusted source text")).toHaveValue(sourceText);
      await page.getByRole("button", { name: packAction, exact: true }).click();
      await expect.poll(() => packActionAccepted).toBe(true);
      const busyStatus = page
        .getByRole("status")
        .filter({ hasText: packAction === "Save draft" ? /^Saving draft/ : /^Reloading Pack/ });
      await expect(busyStatus).toBeVisible();
      await expect(page.getByRole("button", { name: packAction, exact: true })).toBeDisabled();

      releaseSourceResponse.resolve();
      const article = assistant.getByRole("article").filter({ hasText: sourceName });
      await expect(article).toBeVisible();
      await expect(assistant.getByLabel("Trusted source text")).toHaveValue("");
      await expect(assistant.getByLabel("Source name")).toHaveValue(sourceName);
      await expect(
        assistant.getByRole("button", { name: "Create review proposal", exact: true }),
      ).toBeDisabled();
      await expect(busyStatus).toBeVisible();
      await expect(page.getByLabel("Title", { exact: true })).toHaveValue(expectedPackTitle);
      expect(sourcePosts).toBe(1);
      await expect.poll(() => providerCalls).toBe(providerCallsBefore + 1);
      const readsAfterAdoption = jobListReads;
      releaseProvider.resolve();
      await expect(
        article.getByRole("button", { name: "Review Pack source proposal" }),
      ).toBeVisible({ timeout: 45_000 });
      await expect(
        article.getByRole("button", { name: "Review Pack source proposal" }),
      ).toBeDisabled();
      await expect(busyStatus).toBeVisible();
      expect(jobListReads).toBeGreaterThan(readsAfterAdoption);
      const jobs = (await (await page.request.get(`${apiUrl}/v1/authoring/jobs`)).json())
        .jobs as Array<{
        id: string;
        status: string;
        sourceName: string;
        appliedQuizId: string | null;
      }>;
      expect(jobs).toHaveLength(initialJobs.length + 1);
      expect(jobs.filter((job) => job.sourceName === sourceName)).toEqual([
        expect.objectContaining({ id: queuedJobId, status: "ready", appliedQuizId: null }),
      ]);
      const usedAfter = (await (await page.request.get(`${apiUrl}/v1/authoring/status`)).json())
        .status.used as number;
      expect(usedAfter).toBe(usedBefore + 1);
      expect(sourcePosts).toBe(1);
      expect(providerCalls).toBe(providerCallsBefore + 1);
      releasePackAction.resolve();
      await expect(
        page.getByRole("status").filter({
          hasText: packAction === "Save draft" ? "Draft saved." : "Latest saved draft loaded.",
        }),
      ).toBeVisible();
      await expect(
        assistant.getByRole("button", { name: "Create review proposal", exact: true }),
      ).toBeEnabled();
      await expect(
        article.getByRole("button", { name: "Review Pack source proposal" }),
      ).toBeEnabled();
      await expect(assistant.getByLabel("Trusted source text")).toHaveValue("");
      const savedManual = (
        await (await page.request.get(`${apiUrl}/v1/recovery-packs/${manualPack.id}`)).json()
      ).pack;
      expect(savedManual.title).toBe(expectedPackTitle);
      expect(savedManual.draftRevision).toBe(
        manualPack.draftRevision + (packAction === "Save draft" ? 1 : 0),
      );
      expect(savedManual).not.toHaveProperty("sourceReview");
    } finally {
      releaseSourceResponse.resolve();
      releasePackAction.resolve();
      releaseProvider.resolve();
      if (providerResponseHold === releaseProvider) providerResponseHold = null;
    }
  });
}
