import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, test, type Download, type Page } from "@playwright/test";
import type { RecoveryPackExportReport } from "../../packages/contracts/src/index.ts";
import koreanAssistantMessages from "../../apps/web/lib/i18n/domains/delivery-authoring/ko-KR";
import { packSourceCopy } from "../../apps/web/lib/i18n/pack-source-copy";
import { packExportCopy } from "../../apps/web/lib/i18n/pack-export-copy";
import { packWorkspaceCopy } from "../../apps/web/lib/i18n/pack-workspace-copy";
import {
  specialistLanguage,
  specialistLocale,
  specialistQuality,
} from "./option-b-specialist-support";
import { signInBeta } from "./sign-in";

// Same owned loopback provider and grounded halves profile as recovery-pack-source-authoring.
// The published source Pack also exercises the real portability report/artifact profile.
const enabled = process.env.BETA_E2E_AUTHORING === "true";
const apiPort = Number(process.env.BETA_E2E_API_PORT ?? 4200);
const apiUrl = `http://127.0.0.1:${apiPort}`;
test.use({ actionTimeout: 30_000 });

const providerPort = Number(process.env.BETA_E2E_AUTHORING_PORT ?? apiPort + 2);
const excerpt = "Divide a whole into two equal groups to find half.";
const sourceText = `${excerpt} Half of eight is four. Half of six is three.`;
const rawTitle = "Private English source-assisted halves";
let providerTitle = rawTitle;
let provider: Server | undefined;
let providerCalls = 0;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function liveLocale(page: Page, locale: "ko-KR" | "de-DE") {
  const current = await page.locator("html").getAttribute("lang");
  const code = current === "ko-KR" ? "KO" : current === "de-DE" ? "DE" : "EN";
  const trigger = page.locator(`summary[role="button"][aria-label^="${code}:"]`).first();
  await trigger.click();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === "/v1/account/locale",
  );
  await page.locator(`button[role="radio"][lang="${locale}"]`).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}
async function authoringSnapshot(page: Page) {
  const [jobs, allowance] = await Promise.all([
    page.request.get(`${apiUrl}/v1/authoring/jobs`),
    page.request.get(`${apiUrl}/v1/authoring/status`),
  ]);
  expect(jobs.ok()).toBe(true);
  expect(allowance.ok()).toBe(true);
  return { jobs: (await jobs.json()).jobs, used: (await allowance.json()).status.used };
}

test.skip(!enabled, "Localized source Pack fixture requires BETA_E2E_AUTHORING=true.");
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
    title: rawTitle,
    description: "Private English grounded content must retain its original words.",
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
    request.on("end", () => {
      providerCalls += 1;
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ ...output, title: providerTitle }) } }],
        }),
      );
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
  test(`Option B localized source review and portability retain frozen content and exact retries ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const title = `${rawTitle} ${randomUUID().slice(0, 8)}`;
    providerTitle = title;
    await signInBeta(page);
    await page.goto("/recovery-packs");
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const releases: Array<ReturnType<typeof deferred>> = [];
    try {
      await specialistLocale(page, "ko-KR");
      await page.reload();
      const ko = packSourceCopy("ko-KR"),
        de = packSourceCopy("de-DE");
      const workspaceKo = packWorkspaceCopy("ko-KR");
      const assistant = page.locator("details.authoring-assistant");
      await assistant.locator("summary").click();
      await expect(assistant).toContainText(ko("Draft a Recovery Pack from a trusted source"));
      const sourceName = `Private English source ${randomUUID().slice(0, 8)}`;
      await assistant
        .getByLabel(koreanAssistantMessages["delivery.assistant.sourceName"], { exact: true })
        .fill(sourceName);
      await assistant
        .getByLabel(koreanAssistantMessages["delivery.assistant.trustedText"])
        .fill(sourceText);
      const before = await authoringSnapshot(page);
      const callsBefore = providerCalls;
      const queued = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/v1/authoring/jobs",
      );
      await assistant
        .getByRole("button", {
          name: koreanAssistantMessages["delivery.assistant.createProposal"],
          exact: true,
        })
        .click();
      const accepted = await queued;
      expect(accepted.status()).toBe(202);
      const jobId = (await accepted.json()).job.id as string;
      const article = assistant.getByRole("article").filter({ hasText: sourceName });
      const reviewProposal = article.getByRole("button", {
        name: ko("Review Pack source proposal"),
        exact: true,
      });
      await expect(reviewProposal).toBeEnabled({ timeout: 45_000 });
      const readySnapshot = await authoringSnapshot(page);
      expect(readySnapshot.jobs).toHaveLength(before.jobs.length + 1);
      expect(readySnapshot.used).toBe(before.used + 1);
      expect(providerCalls).toBe(callsBefore + 1);

      const proposalRelease = deferred();
      releases.push(proposalRelease);
      await page.route(`**/v1/authoring/jobs/${jobId}/recovery-pack-proposal`, async (route) => {
        const response = await route.fetch();
        await proposalRelease.promise;
        await route.fulfill({ response });
      });
      await reviewProposal.click();
      await expect(article.getByRole("status")).toHaveText(ko("Loading the source Pack proposal…"));
      await liveLocale(page, "de-DE");
      await expect(article.getByRole("status")).toHaveText(de("Loading the source Pack proposal…"));
      proposalRelease.resolve();
      await expect(
        article.getByRole("heading", { name: de("Source Pack proposal"), exact: true }),
      ).toBeFocused();
      await expect(article).toContainText("What is half of eight?");
      await expect(article).toContainText("What is half of six?");
      await specialistLanguage(article.getByText(title, { exact: true }), "");
      await specialistLanguage(article.getByText(excerpt, { exact: true }).first(), "");
      const sourceProposal = (
        await (
          await page.request.get(`${apiUrl}/v1/authoring/jobs/${jobId}/recovery-pack-proposal`)
        ).json()
      ).proposal;
      expect(await authoringSnapshot(page)).toEqual(readySnapshot);
      expect(providerCalls).toBe(callsBefore + 1);

      const creationBodies: string[] = [];
      const creationRelease = deferred();
      releases.push(creationRelease);
      let createdPackId = "";
      await page.route(`**/v1/authoring/jobs/${jobId}/apply-recovery-pack`, async (route) => {
        creationBodies.push(route.request().postData()!);
        if (creationBodies.length === 1) {
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          createdPackId = (await response.json()).pack.id;
          await creationRelease.promise;
          await route.abort("failed");
        } else await route.continue();
      });
      await article
        .getByRole("button", { name: de("Create source Pack draft"), exact: true })
        .evaluate((button: HTMLButtonElement) => {
          button.click();
          button.click();
        });
      await expect.poll(() => createdPackId).not.toBe("");
      await liveLocale(page, "ko-KR");
      await expect(article.getByRole("status")).toHaveText(
        ko("Creating an unpublished Pack draft…"),
      );
      expect(creationBodies).toHaveLength(1);
      creationRelease.resolve();
      await expect(article.getByRole("alert")).toBeFocused();
      await specialistLanguage(article.getByRole("alert"), "en-CA");
      await article
        .getByRole("button", { name: ko("Retry creating source Pack draft"), exact: true })
        .click();
      await expect(page.getByLabel(workspaceKo("Title"), { exact: true })).toHaveValue(title);
      expect(creationBodies).toHaveLength(2);
      expect(creationBodies[0]).toBe(creationBodies[1]);
      expect(JSON.parse(creationBodies[0]!).draft).toEqual(sourceProposal.draft);
      expect(JSON.parse(creationBodies[0]!)).not.toHaveProperty("locale");
      const saved = async () =>
        (await (await page.request.get(`${apiUrl}/v1/recovery-packs/${createdPackId}`)).json())
          .pack;
      const unapproved = await saved();
      expect(unapproved.sourceReview.approved).toBe(false);
      expect(unapproved.currentVersionId).toBeNull();

      const review = () =>
        page.getByRole("region", {
          name: packSourceCopy(pageLocale)("Source content and citation review"),
          exact: true,
        });
      let pageLocale: "ko-KR" | "de-DE" = "ko-KR";
      const content = () =>
        review().getByLabel(
          packSourceCopy(pageLocale)(
            "I reviewed the full saved content, answer keys, and facilitator guidance.",
          ),
        );
      const citations = () =>
        review().getByLabel(
          packSourceCopy(pageLocale)("I verified every citation and excerpt against the source."),
        );
      const approve = () =>
        review().getByRole("button", {
          name: packSourceCopy(pageLocale)("Approve saved content and citations"),
          exact: true,
        });
      const publish = () =>
        page.getByRole("button", {
          name: packWorkspaceCopy(pageLocale)("Publish saved draft"),
          exact: true,
        });
      await expect(content()).not.toBeChecked();
      await expect(citations()).not.toBeChecked();
      await expect(approve()).toBeDisabled();
      await expect(publish()).toBeDisabled();
      await review().locator("summary").click();
      await expect(review()).toContainText(excerpt);
      await content().check();
      await citations().check();
      await liveLocale(page, "de-DE");
      pageLocale = "de-DE";
      await expect(content()).toBeChecked();
      await expect(citations()).toBeChecked();
      await expect(publish()).toBeDisabled();
      expect(await saved()).toEqual(unapproved);

      const approvalBodies: string[] = [];
      const approvalRelease = deferred();
      releases.push(approvalRelease);
      let approvalAccepted = false;
      await page.route(`**/v1/recovery-packs/${createdPackId}/source-review`, async (route) => {
        approvalBodies.push(route.request().postData()!);
        if (approvalBodies.length === 1) {
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          approvalAccepted = true;
          await approvalRelease.promise;
          await route.abort("failed");
        } else await route.continue();
      });
      await approve().evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
      await expect.poll(() => approvalAccepted).toBe(true);
      await liveLocale(page, "ko-KR");
      pageLocale = "ko-KR";
      await expect(content()).toBeChecked();
      await expect(citations()).toBeChecked();
      approvalRelease.resolve();
      await expect(page.locator("p.error[role=alert]")).toBeFocused();
      await expect(publish()).toBeDisabled();
      await approve().click();
      await expect(review().getByRole("status")).toHaveText(
        ko(
          "Saved revision {revision} has content and citation approval. Publishing is a separate action.",
          { revision: unapproved.draftRevision },
        ),
      );
      expect(approvalBodies).toHaveLength(2);
      expect(approvalBodies[0]).toBe(approvalBodies[1]);
      expect(JSON.parse(approvalBodies[0]!)).not.toHaveProperty("locale");
      expect((await saved()).currentVersionId).toBeNull();
      await expect(publish()).toBeEnabled();
      await publish().click();
      await expect.poll(async () => (await saved()).currentVersionId).not.toBeNull();
      const published = await saved();
      const versionId = published.currentVersionId as string;
      const exportKo = packExportCopy("ko-KR"),
        exportDe = packExportCopy("de-DE");
      const panel = () =>
        page.getByRole("region", {
          name: packExportCopy(pageLocale)("Checkpoint portability"),
          exact: true,
        });
      await expect(panel()).toBeVisible();
      await expect(
        panel().getByRole("button", { name: exportKo("Download CSV checkpoints"), exact: true }),
      ).toBeDisabled();
      const reportUrl = `${apiUrl}/v1/recovery-packs/versions/${versionId}/export-report?format=csv`;
      const canonical = (await (await page.request.get(reportUrl)).json())
        .report as RecoveryPackExportReport;
      let reports = 0;
      await page.route(
        `**/v1/recovery-packs/versions/${versionId}/export-report?format=csv`,
        async (route) => {
          reports += 1;
          const response = await route.fetch();
          if (reports === 1)
            await route.fulfill({
              response,
              json: {
                report: {
                  ...canonical,
                  source: { ...canonical.source, contentHash: "b".repeat(64) },
                },
              },
            });
          else await route.fulfill({ response });
        },
      );
      await panel()
        .getByRole("button", { name: exportKo("Review export losses"), exact: true })
        .click();
      await expect(panel().getByRole("alert")).toBeFocused();
      await expect(panel().getByRole("alert")).toHaveText(
        exportKo(
          "The export report does not match this frozen Pack version and format. Review again.",
        ),
      );
      await specialistLanguage(panel().getByRole("alert"), "ko-KR");
      await expect(
        panel().getByRole("button", { name: exportKo("Download export report JSON"), exact: true }),
      ).toBeDisabled();
      await liveLocale(page, "de-DE");
      pageLocale = "de-DE";
      await panel()
        .getByRole("button", { name: exportDe("Review export losses"), exact: true })
        .click();
      await expect(
        panel().getByRole("heading", {
          name: exportDe("Reviewed {format} export", { format: "CSV" }),
          exact: true,
        }),
      ).toBeFocused();
      await specialistLanguage(panel().getByText(title, { exact: true }), "");
      await expect(panel()).toContainText(canonical.source.contentHash);
      await expect(panel()).toContainText("PACK_INTERVENTIONS_OMITTED");
      await expect(panel()).toContainText("interventions");
      await expect(panel()).not.toContainText(sourceProposal.draft.interventions[0].body);
      await specialistQuality(page);
      await page.screenshot({
        path: info.outputPath("pack-source-export-de-DE.png"),
        fullPage: true,
      });

      const artifactBytes = new Map<string, Buffer>();
      const artifactRequests: string[] = [];
      let downloads = 0;
      page.on("download", () => {
        downloads += 1;
      });
      await page.route(`**/v1/recovery-packs/versions/${versionId}/export.*`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        artifactRequests.push(path);
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        if (artifactRequests.length === 1)
          await route.fulfill({
            response,
            headers: { ...response.headers(), "x-openround-export-report": "wrong" },
          });
        else {
          artifactBytes.set(path, await response.body());
          await route.fulfill({ response });
        }
      });
      await panel()
        .getByRole("button", { name: exportDe("Download CSV checkpoints"), exact: true })
        .click();
      await expect(panel().getByRole("alert")).toHaveText(
        exportDe("The download does not match the reviewed export. No file was downloaded."),
      );
      expect(downloads).toBe(0);
      await liveLocale(page, "ko-KR");
      pageLocale = "ko-KR";
      const csvDownload = page.waitForEvent("download");
      await panel()
        .getByRole("button", { name: exportKo("Download CSV checkpoints"), exact: true })
        .click();
      const csv = await csvDownload;
      expect(csv.suggestedFilename()).toBe(`polling-pops-recovery-pack-${versionId}.csv`);
      expect(await downloadBytes(csv)).toEqual(artifactBytes.get(artifactRequests[1]!));
      expect(artifactRequests[0]).toBe(artifactRequests[1]);
      const reportDownload = page.waitForEvent("download");
      await panel()
        .getByRole("button", { name: exportKo("Download export report JSON"), exact: true })
        .click();
      const reportFile = await reportDownload;
      expect(reportFile.suggestedFilename()).toBe(
        `polling-pops-recovery-pack-${versionId}-csv-export-report.json`,
      );
      expect((await downloadBytes(reportFile)).toString()).toBe(JSON.stringify(canonical, null, 2));
      await panel()
        .getByRole("combobox", { name: exportKo("Published Pack export format"), exact: true })
        .selectOption("qti3");
      await expect(
        panel().getByRole("button", { name: exportKo("Download QTI 3 package"), exact: true }),
      ).toBeDisabled();
      await panel()
        .getByRole("button", { name: exportKo("Review export losses"), exact: true })
        .click();
      await expect(
        panel().getByRole("heading", {
          name: exportKo("Reviewed {format} export", { format: "QTI 3" }),
          exact: true,
        }),
      ).toBeFocused();
      const qtiDownload = page.waitForEvent("download");
      await panel()
        .getByRole("button", { name: exportKo("Download QTI 3 package"), exact: true })
        .click();
      const qti = await qtiDownload;
      expect(qti.suggestedFilename()).toBe(`polling-pops-recovery-pack-${versionId}.qti.zip`);
      expect(await downloadBytes(qti)).toEqual(artifactBytes.get(artifactRequests[2]!));
      expect(await authoringSnapshot(page)).toEqual(readySnapshot);
      expect(providerCalls).toBe(callsBefore + 1);
      expect(await saved()).toEqual(published);
      await specialistQuality(page);
      await page.screenshot({
        path: info.outputPath("pack-source-export-ko-KR.png"),
        fullPage: true,
      });

      let permission: "paused" | "viewer" = "paused";
      await page.route("**/v1/auth/me", async (route) => {
        const response = await route.fetch();
        const account = await response.json();
        await route.fulfill({
          response,
          json: {
            ...account,
            creator: {
              ...account.creator,
              role: permission === "viewer" ? "viewer" : account.creator.role,
            },
            productFeatures: { ...account.productFeatures, recoveryPacks: permission !== "paused" },
          },
        });
      });
      for (const mode of ["paused", "viewer"] as const) {
        permission = mode;
        await page.reload();
        await page.getByRole("button").filter({ hasText: title }).click();
        await expect(review()).toBeVisible();
        await expect(content()).toBeDisabled();
        await expect(approve()).toBeDisabled();
        await expect(publish()).toBeDisabled();
        await expect(page.locator("details.authoring-assistant")).toHaveCount(0);
        await review().locator("summary").click();
        await expect(review()).toContainText(excerpt);
        await expect(
          panel().getByRole("button", { name: exportKo("Review export losses"), exact: true }),
        ).toBeEnabled();
        expect(await saved()).toEqual(published);
      }
    } finally {
      for (const release of releases) release.resolve();
      await page.unrouteAll({ behavior: "wait" });
      await specialistLocale(page, "en-CA");
    }
  });
}
