import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { RecoveryPackContent } from "../../packages/contracts/src/index.ts";
import { packUpdateCopy } from "../../apps/web/lib/i18n/pack-update-copy";
import { packInsertionCopy } from "../../apps/web/lib/i18n/pack-insertion-copy";
import { presentationCommandCopy } from "../../apps/web/components/presentation/presentation-command-copy";
import {
  specialistLanguage,
  specialistLocale,
  specialistQuality,
} from "./option-b-specialist-support";
import { createE01Deck, e01ApiUrl as apiUrl } from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 30_000 });

// Same real source/accepted-baseline/local-conflict setup as recovery-pack-updates.spec.ts
// and the Presentation workflow in recovery-packs.spec.ts; no synthetic update responses.
async function packFixture(page: Page) {
  const recheckId = randomUUID();
  const diagnostic: RecoveryPackContent["diagnostic"] = {
    id: randomUUID(),
    type: "numeric",
    prompt: "Initial diagnostic situation — 原文",
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["original.ratios"],
    linkedRecheckQuestionId: recheckId,
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: "Original explanation — conserver exactement",
    mediaId: null,
    mediaAlt: null,
    correctValue: "2",
    tolerance: "0",
    unit: "unités originales",
  };
  const citation = {
    sourceName: "Original source — Review latest Pack version",
    sourceDigest: "a".repeat(64),
    locator: "p. 7 原文",
    excerpt: "Original citation — PRIVATE_REFERENCE_TEXT",
  };
  const content: RecoveryPackContent = {
    schemaVersion: 1,
    title: `Original Pack — ${randomUUID().slice(0, 8)}`,
    description: "Accepted baseline context — 原文",
    diagnostic,
    recheck: {
      ...diagnostic,
      id: recheckId,
      delivery: "recheck",
      linkedRecheckQuestionId: null,
      prompt: "Initial transfer situation — 原文",
    },
    interventions: [
      {
        id: randomUUID(),
        title: "Original facilitator card",
        body: "Original frozen facilitator guidance — PRIVATE_CARD_TEXT",
        citations: [citation],
      },
    ],
    conceptKeys: ["original.ratios"],
    misconceptionKeys: ["original.misconception"],
    citations: [citation],
    delayedProbe: null,
  };
  const created = await page.request.post(`${apiUrl}/v1/recovery-packs`, {
    data: { draft: content },
  });
  expect(created.status(), await created.text()).toBe(201);
  const pack = (await created.json()).pack;
  const published = await page.request.post(`${apiUrl}/v1/recovery-packs/${pack.id}/publish`, {
    data: { expectedDraftRevision: pack.draftRevision },
  });
  expect(published.ok(), await published.text()).toBeTruthy();
  const firstVersion = (await published.json()).version;
  const frozenResponse = await page.request.get(
    `${apiUrl}/v1/recovery-packs/versions/${firstVersion.id}`,
  );
  const frozen = await frozenResponse.json();
  return { pack, content, firstVersion, frozen, citation };
}

async function publishUpdate(page: Page, source: Awaited<ReturnType<typeof packFixture>>) {
  const latest = {
    ...source.pack.draft,
    diagnostic: {
      ...source.pack.draft.diagnostic,
      prompt: "New published diagnostic situation — 原文",
    },
    recheck: { ...source.pack.draft.recheck, prompt: "New published transfer situation — 原文" },
    interventions: source.pack.draft.interventions.map(
      (card: RecoveryPackContent["interventions"][number]) => ({
        ...card,
        body: "Updated facilitator guidance — PRIVATE_CARD_TEXT",
      }),
    ),
  };
  const saved = await page.request.put(`${apiUrl}/v1/recovery-packs/${source.pack.id}/draft`, {
    data: { draft: latest, expectedRevision: source.pack.draftRevision, mutationId: randomUUID() },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const published = await page.request.post(
    `${apiUrl}/v1/recovery-packs/${source.pack.id}/publish`,
    { data: { expectedDraftRevision: (await saved.json()).pack.draftRevision } },
  );
  expect(published.ok(), await published.text()).toBeTruthy();
  return (await published.json()).version;
}

async function liveLocale(page: Page, locale: "ko-KR" | "de-DE") {
  await specialistLocale(page, locale);
  await page.evaluate(() => window.dispatchEvent(new Event("polling-pops:workspace-updated")));
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

async function openPanel(page: Page, title: string, _locale: "ko-KR" | "de-DE") {
  const panel = page
    .locator("details")
    .filter({
      has: page.locator('summary > span[lang=""]', { hasText: title }),
    })
    .first();
  await expect(panel).toBeVisible();
  if ((await panel.getAttribute("open")) === null) await panel.locator("summary").first().click();
  return panel;
}
async function details(container: Locator, label: string) {
  const section = container
    .locator("details")
    .filter({ has: container.page().locator("summary", { hasText: label }) })
    .first();
  if ((await section.getAttribute("open")) === null)
    await section.locator("summary").first().click();
  return section;
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  await specialistQuality(page);
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: "image/png" });
}
async function closePresentationSidebars(page: Page) {
  for (const id of ["presentation-object-inspector", "presentation-slide-navigator"]) {
    const toggle = page.locator(`button[aria-controls="${id}"]`);
    if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "true")
      await toggle.click();
  }
}
async function presentationReferences(page: Page, locale: "ko-KR" | "de-DE") {
  await closePresentationSidebars(page);
  const related = page.locator('summary[aria-label="Related content"]');
  if ((await related.locator("xpath=ancestor::details[1]").getAttribute("open")) === null)
    await related.click();
  const region = page.getByRole("region", {
    name: packInsertionCopy(locale)("Recovery Pack facilitator references"),
    exact: true,
  });
  const reference = region.locator("details").first();
  if ((await reference.getAttribute("open")) === null)
    await reference.locator("summary").first().click();
  return region;
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean Pack update choices preserve canonical Round history ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    try {
      const source = await packFixture(page);
      const created = await page.request.post(`${apiUrl}/v1/quizzes`, {
        data: { title: "Original Round destination — 原文" },
      });
      expect(created.ok()).toBeTruthy();
      const target = (await created.json()).quiz;
      const insertionResponse = await page.request.post(`${apiUrl}/v1/recovery-packs/insert`, {
        data: {
          quizId: target.id,
          packVersionId: source.firstVersion.id,
          expectedRevision: target.draftRevision,
          mutationId: randomUUID(),
        },
      });
      expect(insertionResponse.ok(), await insertionResponse.text()).toBeTruthy();
      const inserted = (await insertionResponse.json()).quiz;
      const insertion = inserted.draft.recoveryPackInsertions[0];
      const localSaved = await page.request.put(`${apiUrl}/v1/quizzes/${target.id}/draft`, {
        data: {
          draft: {
            ...inserted.draft,
            questions: inserted.draft.questions.map((question: { id: string }) =>
              question.id === insertion.recheckQuestionId
                ? { ...question, prompt: "Locally tailored transfer — 原文" }
                : question,
            ),
          },
          expectedRevision: inserted.draftRevision,
          mutationId: randomUUID(),
          schemaVersion: 1,
        },
      });
      expect(localSaved.ok(), await localSaved.text()).toBeTruthy();
      const local = (await localSaved.json()).quiz;
      const latest = await publishUpdate(page, source);
      await specialistLocale(page, "ko-KR");
      await page.goto(`/quiz/${target.id}`);
      const copy = packUpdateCopy("ko-KR"),
        panel = await openPanel(page, source.content.title, "ko-KR");
      await panel
        .getByRole("button", { name: copy("Review latest Pack version"), exact: true })
        .click();
      const diagnostic = panel.getByLabel(
        copy("{role} update choice", { role: copy("Diagnostic") }),
      );
      const recheck = panel.getByLabel(copy("{role} update choice", { role: copy("Recheck") }));
      await expect(diagnostic).toHaveValue("use_latest");
      await expect(recheck).toHaveValue("");
      await expect(
        panel.getByRole("button", { name: copy("Apply reviewed Pack update") }),
      ).toBeDisabled();
      await recheck.selectOption("keep_local");
      const context = await details(panel, copy("Pack context comparison: baseline and latest"));
      await expect(
        context.getByText("Original frozen facilitator guidance — PRIVATE_CARD_TEXT", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        context.getByText("Updated facilitator guidance — PRIVATE_CARD_TEXT", { exact: true }),
      ).toBeVisible();
      await specialistLanguage(
        context.getByText(source.content.title, { exact: true }).first(),
        "",
      );
      const snapshot = context.locator("pre").first();
      await snapshot.locator("xpath=ancestor::details[1]/summary").click();
      await expect(snapshot).toHaveAttribute("lang", "en-CA");
      const snapshotData = JSON.parse((await snapshot.textContent())!);
      expect(snapshotData.conceptKeys).toEqual(["original.ratios"]);
      expect(snapshotData.citations[0]).toEqual(source.citation);
      await expect(snapshot).not.toHaveAttribute("contenteditable", "true");
      await screenshot(page, info, "korean-round-pack-review");
      await panel.getByRole("button", { name: copy("Apply reviewed Pack update") }).click();
      await expect(
        panel.getByRole("button", { name: copy("Undo this Pack update") }),
      ).toBeEnabled();
      const after = (await (await page.request.get(`${apiUrl}/v1/quizzes/${target.id}`)).json())
        .quiz;
      expect(after.draftRevision).toBe(local.draftRevision + 1);
      expect(
        after.draft.questions.find(
          (question: { id: string }) => question.id === insertion.recheckQuestionId,
        ).prompt,
      ).toBe("Locally tailored transfer — 原文");
      expect(after.draft.recoveryPackInsertions[0].updateBaseline.packVersionId).toBe(latest.id);
      expect(after.draft.recoveryPackInsertions[0].originalContent).toEqual(
        insertion.originalContent,
      );
      const history = await page.request.get(`${apiUrl}/v1/quizzes/${target.id}/history`);
      expect(history.ok()).toBeTruthy();
      expect(
        (await history.json()).history.map((entry: { revision: number }) => entry.revision),
      ).toContain(local.draftRevision);
      // Ordinary history restoration remains a new revision and restores the exact authored snapshot.
      const restoredResponse = await page.request.post(
        `${apiUrl}/v1/quizzes/${target.id}/history/${local.draftRevision}/restore`,
        { data: { expectedRevision: after.draftRevision, mutationId: randomUUID() } },
      );
      expect(restoredResponse.ok(), await restoredResponse.text()).toBeTruthy();
      const restored = (await restoredResponse.json()).quiz;
      expect(restored.draftRevision).toBe(after.draftRevision + 1);
      expect(restored.draft).toEqual(local.draft);
      const frozen = await page.request.get(
        `${apiUrl}/v1/recovery-packs/versions/${source.firstVersion.id}`,
      );
      expect(await frozen.json()).toEqual(source.frozen);
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      await specialistLocale(page, "en-CA");
    }
  });

  test(`Option B Korean Presentation Pack picker and German exact receipt recovery keep state private ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    try {
      const source = await packFixture(page),
        target = await createE01Deck(page, []);
      await specialistLocale(page, "ko-KR");
      await page.goto(`/presentation/${target.id}`);
      await closePresentationSidebars(page);
      const commands = presentationCommandCopy("ko-KR"),
        copy = packUpdateCopy("ko-KR"),
        pickerCopy = packInsertionCopy("ko-KR");
      const mapToggle = page.locator('button[aria-controls="presentation-slide-navigator"]');
      if ((await mapToggle.getAttribute("aria-expanded")) === "false") await mapToggle.click();
      await page.locator(`summary[aria-label="${commands.insertImport}"]`).click();
      const opener = page.getByRole("button", { name: commands.fromPack, exact: true });
      await opener.click();
      const picker = page.locator(
        '[role="dialog"][aria-labelledby="pack-presentation-insert-title"]',
      );
      await expect(picker).toHaveAccessibleName(pickerCopy("Insert a published Recovery Pack"));
      await expect(picker).toHaveAttribute("lang", "ko-KR");
      await picker
        .getByRole("combobox", { name: pickerCopy("Published Recovery Pack"), exact: true })
        .selectOption(source.pack.id);
      await expect(
        picker.getByRole("region", { name: pickerCopy("Published Pack preview") }),
      ).toContainText(source.content.diagnostic.prompt);
      await specialistLanguage(
        picker.getByText(source.content.diagnostic.prompt, { exact: true }),
        "",
      );
      // Both keyboard directions stay in the modal, including the native-select/browser focus sentinel.
      for (const key of ["Tab", "Shift+Tab"] as const) {
        for (let index = 0; index < 5; index += 1) {
          await page.keyboard.press(key);
          expect(
            await picker.evaluate(
              (dialog) =>
                dialog.contains(document.activeElement) ||
                document.activeElement === document.body ||
                document.activeElement === document.documentElement ||
                Boolean(document.activeElement?.closest(":modal")),
            ),
          ).toBe(true);
        }
      }
      await screenshot(page, info, "korean-published-pack-picker");
      await picker
        .getByRole("button", { name: pickerCopy("Insert Pack checkpoints"), exact: true })
        .click();
      await expect(picker).toHaveCount(0);
      const inserted = (
        await (await page.request.get(`${apiUrl}/v1/presentations/${target.id}`)).json()
      ).presentation;
      const insertion = inserted.draft.recoveryPackInsertions[0];
      const originalPublishedResponse = await page.request.post(
        `${apiUrl}/v1/presentations/${target.id}/publish`,
        { data: { expectedDraftRevision: inserted.draftRevision } },
      );
      expect(originalPublishedResponse.ok()).toBeTruthy();
      const originalPublication = (await originalPublishedResponse.json()).version;
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
      expect(localSaved.ok(), await localSaved.text()).toBeTruthy();
      const local = (await localSaved.json()).presentation,
        latest = await publishUpdate(page, source);
      await page.reload();
      await closePresentationSidebars(page);
      const panel = await openPanel(page, source.content.title, "ko-KR");
      await panel.getByRole("button", { name: copy("Review latest Pack version") }).click();
      const diagnostic = panel.getByLabel(
          copy("{role} update choice", { role: copy("Diagnostic") }),
        ),
        recheck = panel.getByLabel(copy("{role} update choice", { role: copy("Recheck") }));
      await expect(diagnostic).toHaveValue("");
      await expect(recheck).toHaveValue("");
      await diagnostic.selectOption("keep_local");
      await recheck.selectOption("use_latest");
      await expect(
        panel.getByRole("alert", { name: copy("Linked checkpoint choices") }),
      ).toHaveAttribute("lang", "ko-KR");
      await expect(
        panel.getByRole("button", { name: copy("Apply reviewed Pack update") }),
      ).toBeDisabled();
      await diagnostic.selectOption("use_latest");
      const references = await presentationReferences(page, "ko-KR");
      await expect(references).toContainText(
        "Original frozen facilitator guidance — PRIVATE_CARD_TEXT",
      );
      await specialistLanguage(
        references.getByText("Original frozen facilitator guidance — PRIVATE_CARD_TEXT", {
          exact: true,
        }),
        "",
      );
      await screenshot(page, info, "korean-presentation-pack-review");
      const applyBodies: string[] = [],
        undoBodies: string[] = [];
      await page.route(`**/v1/presentations/${target.id}/recovery-packs/update`, async (route) => {
        applyBodies.push(route.request().postData()!);
        if (applyBodies.length === 1) {
          expect((await route.fetch()).ok()).toBeTruthy();
          await route.abort("failed");
        } else await route.continue();
      });
      await panel.getByRole("button", { name: copy("Apply reviewed Pack update") }).click();
      await expect(
        panel.getByRole("button", { name: copy("Retry Pack update acknowledgement") }),
      ).toBeEnabled();
      await liveLocale(page, "de-DE");
      const german = packUpdateCopy("de-DE");
      await expect(
        panel.getByLabel(german("{role} update choice", { role: german("Diagnostic") })),
      ).toHaveValue("use_latest");
      await expect(
        panel.getByLabel(german("{role} update choice", { role: german("Recheck") })),
      ).toHaveValue("use_latest");
      await panel
        .getByRole("button", { name: german("Retry Pack update acknowledgement") })
        .click();
      await expect(
        panel.getByRole("button", { name: german("Undo this Pack update") }),
      ).toBeEnabled();
      expect(applyBodies).toHaveLength(2);
      expect(applyBodies[0]).toBe(applyBodies[1]);
      expect(JSON.parse(applyBodies[0]!)).toEqual({
        insertionId: insertion.id,
        packVersionId: latest.id,
        expectedRevision: local.draftRevision,
        mutationId: expect.any(String),
        choices: [
          { role: "diagnostic", action: "use_latest" },
          { role: "recheck", action: "use_latest" },
        ],
      });
      const accepted = (
        await (await page.request.get(`${apiUrl}/v1/presentations/${target.id}`)).json()
      ).presentation;
      expect(accepted.draftRevision).toBe(local.draftRevision + 1);
      expect(accepted.currentVersionId).toBe(originalPublication.id);
      expect(accepted.draft.recoveryPackInsertions[0].originalContent).toEqual(
        insertion.originalContent,
      );
      expect(accepted.draft.recoveryPackInsertions[0].updateBaseline.packVersionId).toBe(latest.id);
      const acceptedRefs = await presentationReferences(page, "de-DE");
      await expect(acceptedRefs).toContainText("Updated facilitator guidance — PRIVATE_CARD_TEXT");
      await screenshot(page, info, "german-presentation-pack-accepted");
      await page.route(`**/v1/presentations/${target.id}/history/*/restore`, async (route) => {
        undoBodies.push(route.request().postData()!);
        if (undoBodies.length === 1) {
          expect((await route.fetch()).ok()).toBeTruthy();
          await route.abort("failed");
        } else await route.continue();
      });
      await panel.getByRole("button", { name: german("Undo this Pack update") }).click();
      await expect(
        panel.getByRole("button", { name: german("Retry undo acknowledgement") }),
      ).toBeEnabled();
      await liveLocale(page, "ko-KR");
      await liveLocale(page, "de-DE");
      await panel.getByRole("button", { name: german("Retry undo acknowledgement") }).click();
      await expect(panel.getByRole("status")).toHaveText(
        german("Pack update undone as a new draft revision."),
      );
      expect(undoBodies).toHaveLength(2);
      expect(undoBodies[0]).toBe(undoBodies[1]);
      const undone = (
        await (await page.request.get(`${apiUrl}/v1/presentations/${target.id}`)).json()
      ).presentation;
      expect(undone.draftRevision).toBe(accepted.draftRevision + 1);
      expect(undone.draft).toEqual(local.draft);
      for (const body of [...applyBodies, ...undoBodies])
        expect(body).not.toMatch(
          /locale|PRIVATE_CARD_TEXT|PRIVATE_REFERENCE_TEXT|최신|Präsentation/,
        );
      const storage = await page.evaluate(() =>
        Object.entries(localStorage).map(([key, value]) => [key, value]),
      );
      expect(JSON.stringify(storage)).not.toContain(german("Retry Pack update acknowledgement"));
      const frozen = await page.request.get(
        `${apiUrl}/v1/recovery-packs/versions/${source.firstVersion.id}`,
      );
      expect(await frozen.json()).toEqual(source.frozen);
      await page.route("**/v1/auth/me", async (route) => {
        const response = await route.fetch(),
          account = await response.json();
        await route.fulfill({
          response,
          json: {
            ...account,
            creator: { ...account.creator, role: "viewer" },
            productFeatures: { ...account.productFeatures, recoveryPacks: false },
          },
        });
      });
      await page.reload();
      await closePresentationSidebars(page);
      const readonly = await openPanel(page, source.content.title, "de-DE");
      await readonly.getByRole("button", { name: german("Review latest Pack version") }).click();
      await expect(
        readonly.getByLabel(german("{role} update choice", { role: german("Diagnostic") })),
      ).toBeDisabled();
      await expect(
        readonly.getByRole("button", { name: german("Apply reviewed Pack update") }),
      ).toBeDisabled();
      await screenshot(page, info, "german-readonly-pack-review");
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      await specialistLocale(page, "en-CA");
    }
  });
}
