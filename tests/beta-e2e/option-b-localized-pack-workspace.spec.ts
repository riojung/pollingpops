import { randomUUID } from "node:crypto";
import { expect, test, type Download, type Page } from "@playwright/test";
import type { RecoveryPackContent } from "../../packages/contracts/src/index.ts";
import { packWorkspaceCopy } from "../../apps/web/lib/i18n/pack-workspace-copy";
import { packExportCopy } from "../../apps/web/lib/i18n/pack-export-copy";
import {
  specialistLanguage,
  specialistLocale,
  specialistQuality,
} from "./option-b-specialist-support";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

async function bytes(download: Download) {
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function liveLocale(page: Page, from: "KO" | "DE", locale: "ko-KR" | "de-DE") {
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/v1/account/locale" &&
      response.request().method() === "PUT",
  );
  await page.locator(`summary[role="button"][aria-label^="${from}:"]`).click();
  await page.locator(`button[role="radio"][lang="${locale}"]`).click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

// The fixture follows recovery-packs and portability: real, published numeric checkpoints,
// exact citation spans, no fabricated object-store media, and a separately mutable draft.
async function fixture(page: Page) {
  const title = `Save draft — texte original ${randomUUID().slice(0, 8)}`;
  const citation = {
    sourceName: "Review export losses — authored source name",
    sourceDigest: "a".repeat(64),
    locator: "p. 7, 原文",
    excerpt: `https://private.example/${"UnbrokenOriginalCitation".repeat(18)}`,
  };
  const question = (prompt: string) => ({
    id: randomUUID(),
    type: "numeric" as const,
    prompt,
    purpose: "diagnostic" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: ["original.concept"],
    linkedRecheckQuestionId: null as string | null,
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: "Explication originale — ne pas traduire {label}",
    mediaId: null,
    mediaAlt: null,
    correctValue: "4",
    tolerance: "0",
    unit: "unités originales",
  });
  const recheck = {
    ...question("Recheck original: quelle est la moitié de douze ?"),
    correctValue: "6",
    delivery: "recheck" as const,
  };
  const draft: RecoveryPackContent = {
    schemaVersion: 1,
    title,
    description: "Description originale — Save draft n’est pas une commande ici.",
    diagnostic: {
      ...question("Diagnostic original: quelle est la moitié de huit ?"),
      linkedRecheckQuestionId: recheck.id,
      sourceCitations: [citation],
    },
    recheck,
    delayedProbe: question("Sonde originale différée — garder exactement ce texte."),
    interventions: [
      {
        id: randomUUID(),
        title: "Original card — Add intervention card",
        body: "Conseil original <script>plaintext</script> — garder les citations.",
        citations: [citation],
      },
    ],
    conceptKeys: ["original.concept"],
    misconceptionKeys: ["original.misconception"],
    citations: [citation],
  };
  const created = await page.request.post(`${apiUrl}/v1/recovery-packs`, { data: { draft } });
  expect(created.status(), await created.text()).toBe(201);
  const pack = (await created.json()).pack as { id: string; draftRevision: number };
  const published = await page.request.post(`${apiUrl}/v1/recovery-packs/${pack.id}/publish`, {
    data: { expectedDraftRevision: pack.draftRevision },
  });
  expect(published.status(), await published.text()).toBe(200);
  const version = (await published.json()).version as { id: string };
  const frozen = await page.request.get(`${apiUrl}/v1/recovery-packs/versions/${version.id}`);
  expect(frozen.ok()).toBeTruthy();
  return { pack, version, draft, citation, frozen: await frozen.json() };
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Pack workspace preserves raw content, review and exact save receipts across Korean and German ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const original = await fixture(page);
    const ko = packWorkspaceCopy("ko-KR");
    const de = packWorkspaceCopy("de-DE");
    const koExport = packExportCopy("ko-KR");
    const deExport = packExportCopy("de-DE");
    const domainRequests: string[] = [];
    const saveBodies: string[] = [];
    const path = `/v1/recovery-packs/${original.pack.id}/draft`;
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (/^\/v1\/(?:recovery-packs|quizzes)(?:\/|$)/.test(pathname))
        domainRequests.push(`${request.method()} ${pathname}`);
    });
    let loseSaveAcknowledgement = true;
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      saveBodies.push(route.request().postData()!);
      if (loseSaveAcknowledgement) {
        loseSaveAcknowledgement = false;
        const accepted = await route.fetch();
        expect(accepted.ok()).toBeTruthy();
        await route.abort("failed");
      } else await route.continue();
    });
    try {
      await specialistLocale(page, "ko-KR");
      await page.goto("/recovery-packs");
      await page.getByRole("button").filter({ hasText: original.draft.title }).click();
      const title = page.getByRole("textbox", { name: ko("Title"), exact: true });
      await expect(title).toHaveValue(original.draft.title);
      await specialistLanguage(title, "");
      const prompt = page.getByRole("textbox", {
        name: ko("{label} prompt", { label: ko("Diagnostic") }),
        exact: true,
      });
      await expect(prompt).toHaveValue(original.draft.diagnostic.prompt);
      await specialistLanguage(prompt, "");
      await expect(
        page.getByRole("textbox", {
          name: ko("Shared concept keys (comma-separated)"),
          exact: true,
        }),
      ).toHaveValue("original.concept");
      await expect(
        page.getByRole("textbox", {
          name: ko("Misconception keys (comma-separated)"),
          exact: true,
        }),
      ).toHaveValue("original.misconception");
      const citations = page.locator("details").filter({
        has: page.locator("summary", { hasText: ko("Source citations ({count})", { count: 1 }) }),
      });
      await citations.locator("summary").click();
      await expect(citations).toContainText(original.citation.excerpt);
      await specialistLanguage(
        citations.getByText(original.citation.sourceName, { exact: true }),
        "",
      );
      const panel = page.getByRole("region", {
        name: koExport("Checkpoint portability"),
        exact: true,
      });
      await expect(
        panel.getByRole("button", { name: koExport("Download CSV checkpoints"), exact: true }),
      ).toBeDisabled();
      await panel
        .getByRole("button", { name: koExport("Review export losses"), exact: true })
        .click();
      await expect(
        panel.getByRole("heading", {
          name: koExport("Reviewed {format} export", { format: "CSV" }),
          exact: true,
        }),
      ).toBeFocused();
      await expect(panel).toContainText(original.draft.title);
      await expect(
        panel.getByRole("button", { name: koExport("Download CSV checkpoints"), exact: true }),
      ).toBeEnabled();

      const editedTitle = `Unsaved authored title — ${original.pack.id}`;
      await title.fill(editedTitle);
      const guidance = page.getByRole("textbox", {
        name: ko("Card {number} facilitator guidance", { number: 1 }),
        exact: true,
      });
      const editedGuidance = "Conseil modifié original — {number}, 한국어, <b>texte brut</b>";
      await guidance.fill(editedGuidance);
      const beforeGerman = [...domainRequests];
      await liveLocale(page, "KO", "de-DE");
      expect(domainRequests).toEqual(beforeGerman);
      await expect(page.getByRole("textbox", { name: de("Title"), exact: true })).toHaveValue(
        editedTitle,
      );
      await expect(
        page.getByRole("textbox", {
          name: de("Card {number} facilitator guidance", { number: 1 }),
          exact: true,
        }),
      ).toHaveValue(editedGuidance);
      const germanPanel = page.getByRole("region", {
        name: deExport("Checkpoint portability"),
        exact: true,
      });
      await expect(
        germanPanel.getByRole("heading", {
          name: deExport("Reviewed {format} export", { format: "CSV" }),
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        germanPanel.getByRole("button", {
          name: deExport("Download CSV checkpoints"),
          exact: true,
        }),
      ).toBeEnabled();
      const downloaded = page.waitForEvent("download");
      await germanPanel
        .getByRole("button", { name: deExport("Download CSV checkpoints"), exact: true })
        .click();
      const artifact = await downloaded;
      const csv = await bytes(artifact);
      const canonicalCsv = await page.request.get(
        `${apiUrl}/v1/recovery-packs/versions/${original.version.id}/export.csv`,
      );
      expect(canonicalCsv.ok()).toBeTruthy();
      expect(csv).toEqual(await canonicalCsv.body());
      expect(csv.toString("utf8")).toContain(original.draft.diagnostic.prompt);
      expect(csv.toString("utf8")).not.toContain(editedTitle);
      expect(csv.toString("utf8")).not.toContain(editedGuidance);
      await specialistQuality(page);
      await page.screenshot({
        path: info.outputPath("pack-workspace-german-reviewed.png"),
        fullPage: true,
      });

      await page.getByRole("button", { name: de("Save draft"), exact: true }).click();
      const saveError = page.locator("p.error[role=alert]").first();
      await expect(saveError).toBeFocused();
      expect(saveBodies).toHaveLength(1);
      const beforeKorean = [...domainRequests];
      await liveLocale(page, "DE", "ko-KR");
      expect(domainRequests).toEqual(beforeKorean);
      await expect(page.getByRole("textbox", { name: ko("Title"), exact: true })).toHaveValue(
        editedTitle,
      );
      await page.getByRole("button", { name: ko("Save draft"), exact: true }).click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: ko("Draft saved. Published versions are unchanged.") }),
      ).toBeVisible();
      expect(saveBodies).toHaveLength(2);
      expect(saveBodies[1]).toBe(saveBodies[0]);
      expect(JSON.parse(saveBodies[0]!)).toMatchObject({
        expectedRevision: original.pack.draftRevision,
        draft: { title: editedTitle, interventions: [{ body: editedGuidance }] },
      });
      expect(JSON.parse(saveBodies[0]!).mutationId).toBeTruthy();

      await page.getByRole("button", { name: ko("Load draft history"), exact: true }).click();
      const revision = page.getByRole("combobox", {
        name: ko("Previous saved revision"),
        exact: true,
      });
      await expect(revision).toBeVisible();
      const originalRevision = revision.locator(`option[value="${original.pack.draftRevision}"]`);
      await expect(originalRevision).toContainText(original.draft.title);
      await revision.selectOption(String(original.pack.draftRevision));
      await page
        .getByRole("button", { name: ko("Restore as new draft revision"), exact: true })
        .click();
      await expect(page.getByRole("textbox", { name: ko("Title"), exact: true })).toHaveValue(
        original.draft.title,
      );
      await expect(
        page.getByRole("textbox", {
          name: ko("Card {number} facilitator guidance", { number: 1 }),
          exact: true,
        }),
      ).toHaveValue(original.draft.interventions[0]!.body);
      const frozen = await page.request.get(
        `${apiUrl}/v1/recovery-packs/versions/${original.version.id}`,
      );
      expect(await frozen.json()).toEqual(original.frozen);

      await page.route(`${apiUrl}/v1/auth/me`, async (route) => {
        const response = await route.fetch();
        const account = await response.json();
        account.creator.role = "viewer";
        await route.fulfill({ response, json: account });
      });
      await page.evaluate(() => window.dispatchEvent(new Event("polling-pops:workspace-updated")));
      await expect(
        page.getByText(ko("Your workspace role can view Packs but cannot modify them."), {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole("textbox", { name: ko("Title"), exact: true })).toBeDisabled();
      await expect(page.getByRole("textbox", { name: ko("Title"), exact: true })).toHaveValue(
        original.draft.title,
      );
      await expect(
        page.getByRole("button", { name: ko("Save draft"), exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: ko("Publish saved draft"), exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: ko("Create Pack draft"), exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: ko("Export Polling Pops JSON"), exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: ko("Reload saved draft"), exact: true }),
      ).toBeEnabled();
      const beforeViewerLocale = [...domainRequests];
      await liveLocale(page, "KO", "de-DE");
      expect(domainRequests).toEqual(beforeViewerLocale);
      await expect(
        page.getByText(de("Your workspace role can view Packs but cannot modify them."), {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: de("Save draft"), exact: true }),
      ).toBeDisabled();
      expect(saveBodies).toHaveLength(2);
      await specialistQuality(page);
      await page.screenshot({
        path: info.outputPath("pack-workspace-german-viewer.png"),
        fullPage: true,
      });
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      await specialistLocale(page, "en-CA");
    }
  });
}
