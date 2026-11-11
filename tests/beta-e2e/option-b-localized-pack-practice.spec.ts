import { packPracticeTitle } from "../../apps/web/lib/i18n/creation-content";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import type { RecoveryPackContent } from "../../packages/contracts/src/index";
import type { CreatedPractice } from "../../apps/web/lib/practice-assignment";
import type { PublishedPracticePack } from "../../apps/web/lib/recovery-pack-practice";
import { packPracticeCopy } from "../../apps/web/lib/i18n/pack-practice-copy";
import { packPracticeSetupCopy } from "../../apps/web/lib/i18n/pack-practice-setup-copy";
import { packPracticeDetailCopy } from "../../apps/web/lib/i18n/pack-practice-detail-copy";
import { specialistLocale } from "./option-b-specialist-support";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const personalLabels = ['=Group A, "first"', "Lernende B – 原文"];
const assignmentTitle = "Original private practice title";
type Locale = "en-CA" | "ko-KR" | "de-DE";

test.use({ actionTimeout: 15_000 });

async function publishedPack(page: Page) {
  const title = `Original frozen evidence ${randomUUID().slice(0, 8)}`;
  const recheckId = randomUUID();
  const checkpoint = (prompt: string, id = randomUUID()) => ({
    id,
    type: "numeric" as const,
    prompt,
    purpose: "diagnostic" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    linkedRecheckQuestionId: null as string | null,
    conceptKeys: ["halves"],
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: "PRIVATE_SOURCE_EXPLANATION: divide the original evidence into equal groups.",
    mediaId: null,
    mediaAlt: null,
    correctValue: "4",
    tolerance: "0",
    unit: null,
  });
  const content: RecoveryPackContent = {
    schemaVersion: 1,
    title,
    description: "Original source remains unchanged when workspace chrome changes language.",
    diagnostic: {
      ...checkpoint("Original diagnostic: half of eight?"),
      linkedRecheckQuestionId: recheckId,
    },
    recheck: {
      ...checkpoint("Original recheck: half of twelve?", recheckId),
      correctValue: "6",
      delivery: "recheck",
    },
    delayedProbe: { ...checkpoint("Original delayed probe: half of sixteen?"), correctValue: "8" },
    interventions: [
      {
        id: randomUUID(),
        title: "Original facilitator card",
        body: "Original <strong>plain-text</strong> guidance. " + "LongOriginalEvidence".repeat(12),
        citations: [
          {
            sourceName: "Original field notes",
            sourceDigest: "a".repeat(64),
            locator: "p. 2",
            excerpt: "Evidencia original: compare equal groups.",
          },
        ],
      },
    ],
    conceptKeys: ["halves"],
    misconceptionKeys: [],
    citations: [],
  };
  const created = await page.request.post(`${api}/v1/recovery-packs`, { data: { draft: content } });
  expect(created.status()).toBe(201);
  const pack = (await created.json()).pack as { id: string; draftRevision: number };
  const published = await page.request.post(`${api}/v1/recovery-packs/${pack.id}/publish`, {
    data: { expectedDraftRevision: pack.draftRevision },
  });
  expect(published.status()).toBe(200);
  const version = (await published.json()).version as PublishedPracticePack & {
    contentHash: string;
  };
  const baseline = (await (await page.request.get(`${api}/v1/recovery-packs/${pack.id}`)).json())
    .pack;
  return { pack, version, content, baseline };
}

async function liveLocale(page: Page, locale: Locale) {
  const current = await page.locator("html").getAttribute("lang");
  if (current === locale) return;
  const code = current === "ko-KR" ? "KO" : current === "de-DE" ? "DE" : "EN";
  await page.locator(`summary[role="button"][aria-label^="${code}:"]`).first().click();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === "/v1/account/locale",
  );
  await page.locator(`button[role="radio"][lang="${locale}"]`).click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

async function qualify(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
}

async function bytes(download: Download) {
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function capture(page: Page, path: string) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path, fullPage: true, animations: "disabled", scale: "css" });
}

async function expectedForm(page: Page, dates: { opens: string; closes: string }, locked = false) {
  await expect(page.locator("#pack-practice-mode")).toHaveValue("full_sequence");
  await expect(page.locator("#pack-practice-title")).toHaveValue(assignmentTitle);
  await expect(page.locator("#pack-practice-labels")).toHaveValue(personalLabels.join("\n"));
  await expect(page.locator("#pack-practice-opens")).toHaveValue(dates.opens);
  await expect(page.locator("#pack-practice-closes")).toHaveValue(dates.closes);
  await expect(page.locator('input[name="pack-practice-time"]').nth(1)).toBeChecked();
  await expect(page.locator('input[name="pack-practice-open"]').nth(1)).toBeChecked();
  for (const id of ["mode", "title", "labels", "opens", "closes"]) {
    if (locked) await expect(page.locator(`#pack-practice-${id}`)).toBeDisabled();
    else await expect(page.locator(`#pack-practice-${id}`)).toBeEnabled();
  }
}

async function unavailableGuards(page: Page, packId: string, locale: Locale) {
  let guard: "viewer" | "paused" | null = null;
  await page.route(`${api}/v1/auth/me`, async (route) => {
    const response = await route.fetch();
    const account = await response.json();
    if (guard === "viewer") account.creator.role = "viewer";
    if (guard === "paused") account.productFeatures.practiceAssignments = false;
    await route.fulfill({ response, json: account });
  });
  try {
    for (const state of ["viewer", "paused"] as const) {
      guard = state;
      await page.evaluate(() => window.dispatchEvent(new Event("polling-pops:workspace-updated")));
      await expect(
        page.getByText(
          packPracticeCopy(locale)(
            state === "viewer"
              ? "An owner or editor must create the practice assignment."
              : "New Pack practice assignments are paused for this workspace. Existing practice remains readable.",
          ),
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.locator("#pack-practice-title")).toHaveCount(0);
      guard = null;
      await page.evaluate(() => window.dispatchEvent(new Event("polling-pops:workspace-updated")));
      await expect(page.locator("#pack-practice-title")).toBeVisible();
    }
    expect(new URL(page.url()).pathname).toBe(`/recovery-packs/${packId}/assign`);
  } finally {
    await page.unroute(`${api}/v1/auth/me`);
  }
}

for (const suffix of ["desktop", "phone @mobile"]) {
  test(`Option B Pack practice preserves populated setup and exact private recovery across UI locales on ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: suffix === "desktop" ? 1366 : 320, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      const target = window as typeof window & { packPracticeClipboard?: string[] };
      target.packPracticeClipboard = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            target.packPracticeClipboard!.push(value);
          },
        },
      });
    });
    await signInBeta(page);
    const { pack, version, content, baseline } = await publishedPack(page);
    const creationPath = `/v1/recovery-packs/${pack.id}/practice-assignments`;
    const requests: string[] = [];
    const writes: string[] = [];
    const shares: unknown[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === "POST" && path === creationPath) requests.push(request.postData()!);
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
        /^\/v1\/(?:recovery-packs|followups|authoring\/jobs)(?:\/|$)/.test(path)
      )
        writes.push(`${request.method()} ${path}`);
      if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/product-events") {
        const body = request.postDataJSON() as { events?: { name: string; dimensions: unknown }[] };
        shares.push(
          ...(body.events ?? []).filter((event) => event.name === "practice_assignment_shared"),
        );
      }
    });
    let receipt: CreatedPractice | undefined;
    let loseAcknowledgement = true;
    try {
      await specialistLocale(page, "ko-KR");
      await page.goto(`/recovery-packs/${pack.id}/assign?version=${randomUUID()}`);
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        packPracticeSetupCopy("ko-KR")(
          "The published Pack changed. Refresh the published source and review the selected practice content before creating practice.",
        ),
      );
      await expect(page.locator("#pack-practice-title")).toHaveCount(0);
      await page
        .getByRole("button", {
          name: packPracticeSetupCopy("ko-KR")("Refresh published Pack"),
          exact: true,
        })
        .click();
      await expect(page.locator("#pack-practice-title")).toHaveValue(
        packPracticeTitle("ko-KR", false, content.title),
      );
      await unavailableGuards(page, pack.id, "ko-KR");
      await expect(page.getByText(content.delayedProbe!.prompt, { exact: true })).toHaveAttribute(
        "lang",
        "",
      );
      await expect(page.getByText(content.diagnostic.prompt, { exact: true })).toHaveCount(0);
      await page.locator("#pack-practice-mode").selectOption("full_sequence");
      await expect(page.locator("#pack-practice-title")).toHaveValue(
        packPracticeTitle("ko-KR", true, content.title),
      );
      await liveLocale(page, "de-DE");
      await expect(page.locator("#pack-practice-title")).toHaveValue(
        packPracticeTitle("ko-KR", true, content.title),
      );
      await page.locator("#pack-practice-mode").selectOption("delayed_probe");
      await expect(page.locator("#pack-practice-title")).toHaveValue(
        packPracticeTitle("de-DE", false, content.title),
      );
      await page.locator("#pack-practice-mode").selectOption("full_sequence");
      await page.locator("#pack-practice-title").fill(assignmentTitle);
      await page.locator('input[name="pack-practice-time"]').nth(1).check();
      await page.locator('input[name="pack-practice-open"]').nth(1).check();
      const dates = await page.evaluate(() => {
        const local = (date: Date) =>
          new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
        const opens = local(new Date(Date.now() + 2 * 60 * 60_000));
        const closes = local(new Date(Date.now() + 2 * 24 * 60 * 60_000));
        return {
          opens,
          closes,
          opensIso: new Date(opens).toISOString(),
          closesIso: new Date(closes).toISOString(),
        };
      });
      await page.locator("#pack-practice-opens").fill(dates.opens);
      await page.locator("#pack-practice-closes").fill(dates.closes);
      await page
        .locator("details")
        .filter({ has: page.locator("#pack-practice-labels") })
        .locator("summary")
        .click();
      await page.locator("#pack-practice-labels").fill(personalLabels.join("\n"));
      for (const locale of ["ko-KR", "de-DE", "en-CA"] as const) {
        await liveLocale(page, locale);
        await expectedForm(page, dates);
        await expect(
          page.getByRole("heading", {
            name: packPracticeCopy(locale)("Assign full-sequence practice"),
            level: 1,
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByLabel(packPracticeSetupCopy(locale)("Practice title"), { exact: true }),
        ).toHaveValue(assignmentTitle);
        await expect(
          page.getByRole("region", {
            name: packPracticeDetailCopy(locale)("Frozen full-sequence preview"),
            exact: true,
          }),
        ).toBeVisible();
        for (const text of [
          content.title,
          content.diagnostic.prompt,
          content.recheck.prompt,
          content.interventions[0]!.title,
          content.interventions[0]!.body,
        ])
          await expect(page.getByText(text, { exact: true })).toHaveAttribute("lang", "");
        await expect(page.getByText(content.delayedProbe!.prompt, { exact: true })).toHaveCount(0);
        await qualify(page);
        if (locale === "ko-KR")
          await capture(page, info.outputPath("localized-pack-practice-setup.png"));
      }
      expect(
        (await (await page.request.get(`${api}/v1/recovery-packs/${pack.id}`)).json()).pack,
      ).toEqual(baseline);
      expect(requests).toEqual([]);
      expect(writes).toEqual([]);
      expect(shares).toEqual([]);
      await page.route(`**${creationPath}`, async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        receipt = (await response.json()) as CreatedPractice;
        if (loseAcknowledgement) {
          loseAcknowledgement = false;
          await route.abort("failed");
        } else await route.fulfill({ response });
      });
      await liveLocale(page, "ko-KR");
      await page
        .getByRole("button", {
          name: packPracticeSetupCopy("ko-KR")("Create full-sequence practice"),
          exact: true,
        })
        .click();
      const pending =
        "Creation was not acknowledged. Keep this page open and retry the same private request to recover its result. Settings stay locked; no new assignment is created by changing settings.";
      await expect(
        page.getByText(packPracticeSetupCopy("ko-KR")(pending), { exact: true }),
      ).toBeVisible();
      await expectedForm(page, dates, true);
      await expect(page.locator("#pack-practice-receipt-heading")).toHaveCount(0);
      expect(requests).toHaveLength(1);
      const accepted = receipt!;
      const detailResponse = await page.request.get(`${api}/v1/followups/${accepted.followup.id}`);
      expect(detailResponse.ok()).toBe(true);
      const frozenAssignment = await detailResponse.json();
      await liveLocale(page, "de-DE");
      await expectedForm(page, dates, true);
      await expect(
        page.getByText(packPracticeSetupCopy("de-DE")(pending), { exact: true }),
      ).toBeVisible();
      expect(requests).toHaveLength(1);
      await page
        .getByRole("button", {
          name: packPracticeSetupCopy("de-DE")("Retry assignment acknowledgement"),
          exact: true,
        })
        .click();
      await expect(page.locator("#pack-practice-receipt-heading")).toHaveText(
        packPracticeDetailCopy("de-DE")("Save your private links"),
      );
      expect(requests).toHaveLength(2);
      expect(
        requests[0] === requests[1],
        "Locale changes preserve the private serialized retry bytes",
      ).toBe(true);
      const privateRequest = JSON.parse(requests[0]!) as {
        mutationId: string;
        accessSeed: string;
        sourcePackVersionId: string;
        mode: string;
        title: string;
        timeMode: string;
        opensAt: string;
        closesAt: string;
        personalLabels: string[];
      };
      expect(/^[A-Za-z0-9_-]{43}$/.test(privateRequest.accessSeed)).toBe(true);
      expect(privateRequest).toMatchObject({
        mode: "full_sequence",
        sourcePackVersionId: version.id,
        title: assignmentTitle,
        timeMode: "timed",
        opensAt: dates.opensIso,
        closesAt: dates.closesIso,
        personalLabels,
      });
      expect(Object.keys(privateRequest)).not.toContain("locale");
      expect(await page.locator("body").innerText()).not.toContain(privateRequest.accessSeed);
      expect(
        await page.evaluate(() =>
          JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
        ),
      ).not.toContain(privateRequest.accessSeed);
      expect(receipt?.followup.id).toBe(accepted.followup.id);
      expect(receipt?.genericUrl === accepted.genericUrl).toBe(true);
      expect(receipt?.personalAccess.map((access) => access.url)).toEqual(
        accepted.personalAccess.map((access) => access.url),
      );
      expect(accepted.followup).toMatchObject({
        title: assignmentTitle,
        checkpointCount: 2,
        timeMode: "timed",
        opensAt: dates.opensIso,
        closesAt: dates.closesIso,
        recoveryPackSource: {
          packId: pack.id,
          packVersionId: version.id,
          packVersion: 1,
          packTitle: content.title,
          sourceItemId: version.content.diagnostic.id,
          contentHash: version.contentHash,
          role: "full_sequence",
        },
      });
      const historyResponse = await page.request.get(
        `${api}/v1/followups?purpose=assignment&limit=50`,
      );
      expect(historyResponse.ok()).toBe(true);
      const history = (await historyResponse.json()) as {
        items: { id: string; recoveryPackSource?: { packId: string } }[];
      };
      expect(
        history.items
          .filter((item) => item.recoveryPackSource?.packId === pack.id)
          .map((item) => item.id),
      ).toEqual([accepted.followup.id]);
      const receiptSection = page.locator(
        'section[aria-labelledby="pack-practice-receipt-heading"]',
      );
      const receiptStatus = receiptSection.getByRole("status");
      const sharedAction = async (action: () => Promise<void>) => {
        const before = shares.length;
        const shared = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === "/v1/product-events" &&
            response.request().postDataJSON().events?.[0]?.name === "practice_assignment_shared",
        );
        await action();
        expect((await shared).status()).toBe(202);
        expect(shares).toHaveLength(before + 1);
      };
      const clipboard: string[] = [];
      let csvBaseline: Buffer | undefined;
      for (const locale of ["ko-KR", "de-DE", "en-CA"] as const) {
        const beforeLocale = shares.length;
        await liveLocale(page, locale);
        const copy = packPracticeDetailCopy(locale);
        await expect(receiptSection).toHaveAttribute("lang", locale);
        await expect(page.locator("#pack-practice-receipt-heading")).toHaveText(
          copy("Save your private links"),
        );
        if (csvBaseline)
          await expect(receiptStatus).toHaveText(copy("Private practice links downloaded."));
        await expect(page.locator("#pack-practice-generic-link")).toHaveValue(accepted.genericUrl);
        await expect(page.locator("#pack-practice-generic-link")).toHaveAttribute("lang", "");
        for (const access of accepted.personalAccess) {
          await expect(page.locator(`#pack-practice-link-${access.id}`)).toHaveValue(access.url!);
          await expect(receiptSection.getByText(access.label, { exact: true })).toHaveAttribute(
            "lang",
            "",
          );
        }
        await qualify(page);
        expect(shares).toHaveLength(beforeLocale);
        await sharedAction(() =>
          receiptSection
            .getByRole("button", { name: copy("Copy"), exact: true })
            .first()
            .click(),
        );
        clipboard.push(accepted.genericUrl);
        await expect(receiptStatus).toHaveText(copy("Generic link copied."));
        await sharedAction(() =>
          receiptSection
            .getByRole("button", { name: copy("Copy"), exact: true })
            .nth(1)
            .click(),
        );
        clipboard.push(accepted.personalAccess[0]!.url!);
        await expect(receiptStatus).toHaveText(
          copy("{label} copied.", { label: personalLabels[0]! }),
        );
        await expect(receiptStatus.getByText(personalLabels[0]!, { exact: true })).toHaveAttribute(
          "lang",
          "",
        );
        const downloaded = page.waitForEvent("download");
        await sharedAction(() =>
          receiptSection
            .getByRole("button", { name: copy("Download links CSV"), exact: true })
            .click(),
        );
        const download = await downloaded;
        expect(download.suggestedFilename()).toBe(
          `polling-pops-practice-${accepted.followup.id}-links.csv`,
        );
        const downloadedBytes = await bytes(download);
        const expectedCsv = [
          '"access","participant","link"',
          `"generic","Anonymous","${accepted.genericUrl}"`,
          `"personal","'=Group A, ""first""","${accepted.personalAccess[0]!.url}"`,
          `"personal","${personalLabels[1]}","${accepted.personalAccess[1]!.url}"`,
        ].join("\r\n");
        expect(
          downloadedBytes.equals(Buffer.from(expectedCsv, "utf8")),
          "CSV bytes retain raw labels, formula protection and exact private URLs",
        ).toBe(true);
        if (csvBaseline) expect(downloadedBytes.equals(csvBaseline)).toBe(true);
        else csvBaseline = downloadedBytes;
        await expect(receiptStatus).toHaveText(copy("Private practice links downloaded."));
        await capture(page, info.outputPath(`localized-pack-practice-receipt-${locale}.png`));
      }
      expect(
        await page.evaluate(
          () =>
            (window as typeof window & { packPracticeClipboard?: string[] }).packPracticeClipboard,
        ),
      ).toEqual(clipboard);
      expect(shares).toHaveLength(9);
      for (const share of shares)
        expect(share).toMatchObject({ name: "practice_assignment_shared", dimensions: {} });
      expect(writes).toEqual([`POST ${creationPath}`, `POST ${creationPath}`]);
      expect(
        (await (await page.request.get(`${api}/v1/recovery-packs/${pack.id}`)).json()).pack,
      ).toEqual(baseline);
      expect(
        (await (await page.request.get(`${api}/v1/recovery-packs/versions/${version.id}`)).json())
          .version,
      ).toEqual(version);
      expect(
        await (await page.request.get(`${api}/v1/followups/${accepted.followup.id}`)).json(),
      ).toEqual(frozenAssignment);
      expect((await page.request.delete(`${api}/v1/recovery-packs/${pack.id}`)).status()).toBe(204);
      expect(
        await (await page.request.get(`${api}/v1/followups/${accepted.followup.id}`)).json(),
      ).toEqual(frozenAssignment);
      for (const path of ["/assignments", "/results?view=practice"]) {
        await page.goto(path);
        for (const locale of ["ko-KR", "de-DE", "en-CA"] as const) {
          await liveLocale(page, locale);
          const copy = packPracticeDetailCopy(locale);
          const card = page
            .locator("article")
            .filter({ has: page.getByRole("heading", { name: assignmentTitle, exact: true }) })
            .filter({ has: page.getByText(content.title, { exact: true }) });
          await expect(card).toHaveCount(1);
          const attribution = card.locator("p").filter({
            has: page.getByRole("link", {
              name: copy("Open Recovery Pack library"),
              exact: true,
            }),
          });
          await expect(attribution).toHaveAttribute("lang", locale);
          await expect(attribution).toContainText(copy("Recovery Pack full sequence"));
          await expect(attribution).toContainText(`${copy("published version")} 1`);
          await expect(attribution.getByText(content.title, { exact: true })).toHaveAttribute(
            "lang",
            "",
          );
          const visible = await page.locator("body").innerText();
          const inputValues = await page
            .locator("input")
            .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
          for (const hidden of [
            content.diagnostic.prompt,
            content.recheck.prompt,
            content.delayedProbe!.prompt,
            content.interventions[0]!.body,
            personalLabels[0]!,
            accepted.genericUrl,
            ...accepted.personalAccess.map((access) => access.url!),
            privateRequest.accessSeed,
          ]) {
            expect(visible.includes(hidden)).toBe(false);
            expect(inputValues).not.toContain(hidden);
          }
          await qualify(page);
        }
      }
      expect(shares).toHaveLength(9);
      expect(requests).toHaveLength(2);
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      await specialistLocale(page, "en-CA");
    }
  });
}
