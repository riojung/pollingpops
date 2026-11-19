import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIResponse, type Locator, type Page } from "@playwright/test";
import type { QuizDraft, SupportedLocale } from "@openround/contracts";
import { starterCopyCopy } from "../../apps/web/lib/i18n/starter-copy-copy";
import { starterPreviewCopy } from "../../apps/web/lib/i18n/starter-preview-copy";
import { api, fits, organization, web } from "./support";

const starterId = "meeting-priorities";
const catalogPath = "/templates?type=rounds&collection=team-meetings";
const usePath = `/v1/starters/${starterId}/use`;
const storagePrefix = "starter-copy-intents:v1:";
const useLabels = { "en-CA": "Use this starter", "ko-KR": "이 템플릿 사용" } as const;
type Quiz = { id: string; title: string; draft: QuizDraft; draftRevision: number; status: string };
type CopyResult = { status: number; quiz: Quiz; replayed: boolean };

async function json<T>(pending: Promise<APIResponse>, status = 200): Promise<T> {
  const response = await pending;
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

async function inventory(page: Page) {
  const { quizzes } = await json<{ quizzes: Quiz[] }>(page.request.get(`${api}/v1/quizzes`));
  return quizzes.map((quiz) => quiz.id).sort();
}

function copyPosts(page: Page) {
  const paths: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && /^\/v1\/starters\/[^/]+\/use$/.test(path)) paths.push(path);
  });
  return paths;
}

async function selectStarter(page: Page, mobile = false, locale: SupportedLocale = "en-CA") {
  if (mobile)
    await page
      .getByRole("combobox", { name: starterPreviewCopy(locale).choose, exact: true })
      .selectOption(starterId);
  else {
    const card = page.locator(`[data-template-id="${starterId}"]`);
    await expect(card).toBeVisible();
    const button = card.getByRole("button", { name: "Preview questions", exact: true });
    if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  }
  const preview = page.locator(`#starter-preview-${starterId}`);
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("aria-busy", "false");
  return preview;
}

async function loseFirstAcknowledgement(page: Page) {
  const bodies: string[] = [];
  const results: CopyResult[] = [];
  await page.route(`${api}${usePath}`, async (route) => {
    bodies.push(route.request().postData()!);
    const response = await route.fetch();
    results.push({ status: response.status(), ...(await response.json()) });
    if (bodies.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  return { bodies, results };
}

async function savedIntents(page: Page) {
  return page.evaluate(
    (prefix) => Object.entries(sessionStorage).filter(([key]) => key.startsWith(prefix)),
    storagePrefix,
  );
}

function nextControlKey(page: Page) {
  return page.context().browser()?.browserType().name() === "webkit" ? "Alt+Tab" : "Tab";
}

async function useWithKeyboard(page: Page, preview: Locator, label: string) {
  await preview.locator(`#starter-preview-title-${starterId}`).focus();
  await page.keyboard.press(nextControlKey(page));
  const action = preview.getByRole("button", { name: label, exact: true });
  await expect(action).toBeFocused();
  await page.keyboard.press("Enter");
}

async function waitForPalette(page: Page, preview: Locator, locale: SupportedLocale) {
  const expected = await page.evaluate(() => {
    const resolve = (token: string) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${token})`;
      document.documentElement.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    return resolve("--ui-text-subtle");
  });
  await expect(
    preview.getByText(starterCopyCopy(locale).pendingCopy, { exact: true }).first(),
  ).toHaveCSS("color", expected);
  await expect(
    preview.getByRole("status").filter({ hasText: starterCopyCopy(locale).pendingCopy }),
  ).toHaveCSS("color", expected);
}

async function chooseKorean(page: Page) {
  const changed = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === "/v1/account/locale" &&
      response.request().postDataJSON().locale === "ko-KR",
  );
  await page.getByRole("button", { name: "EN: Language: English (Canada)", exact: true }).click();
  await page.getByRole("radio", { name: /한국어/ }).click();
  expect((await changed).status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

test("durable Round starter copy reloads an uncertain request and opens the original later-edited draft", async ({
  page,
}, info) => {
  const { owner } = await organization(page, info);
  const before = await inventory(page);
  const posts = copyPosts(page);
  const { bodies, results } = await loseFirstAcknowledgement(page);
  await page.goto(catalogPath);
  const preview = await selectStarter(page);
  const submittedAt = Date.now();
  await preview.getByRole("button", { name: useLabels["en-CA"], exact: true }).click();
  await expect(
    preview.getByRole("button", { name: starterCopyCopy().retryCopy, exact: true }),
  ).toBeEnabled();
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ status: 201, replayed: false });
  const created = results[0]!.quiz;
  expect(await inventory(page)).toEqual([...before, created.id].sort());
  const firstBody = JSON.parse(bodies[0]!);
  expect(Object.keys(firstBody).sort()).toEqual([
    "contentVersion",
    "creationContext",
    "expiresAt",
    "idempotencyKey",
    "locale",
  ]);
  expect(firstBody).toMatchObject({
    locale: "en-CA",
    contentVersion: expect.any(String),
    creationContext: { actorId: owner.creator.userId, workspaceId: owner.creator.workspaceId },
    idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/),
  });
  expect(firstBody.contentVersion).not.toBe("");
  expect(Date.parse(firstBody.expiresAt)).toBeGreaterThan(submittedAt);
  expect(Date.parse(firstBody.expiresAt)).toBeLessThanOrEqual(
    submittedAt + 24 * 60 * 60 * 1000 + 10_000,
  );

  const stored = await savedIntents(page);
  expect(stored).toHaveLength(1);
  const envelope = JSON.parse(stored[0]![1]);
  expect(Object.keys(envelope).sort()).toEqual(["intents", "version"]);
  expect(envelope.version).toBe(1);
  expect(envelope.intents).toEqual([{ starterId, body: bodies[0], previousBodies: [] }]);
  for (const fragment of [
    created.draft.title,
    created.draft.questions[0]!.prompt,
    '"questions"',
    '"choices"',
    '"explanation"',
  ])
    expect(stored[0]![1]).not.toContain(fragment);

  const current = await json<{ quiz: Quiz }>(page.request.get(`${api}/v1/quizzes/${created.id}`));
  const editedTitle = "Edited after the uncertain starter copy";
  const editedPrompt = "This question was edited after the original copy committed.";
  const edited = await json<{ quiz: Quiz }>(
    page.request.patch(`${api}/v1/quizzes/${created.id}`, {
      data: {
        expectedDraftRevision: current.quiz.draftRevision,
        draft: {
          ...current.quiz.draft,
          title: editedTitle,
          questions: current.quiz.draft.questions.map((question, index) =>
            index === 0 ? { ...question, prompt: editedPrompt } : question,
          ),
        },
      },
    }),
  );

  await page.reload();
  const restored = await selectStarter(page);
  await expect(
    restored.getByRole("button", { name: starterCopyCopy().retryCopy, exact: true }),
  ).toBeEnabled();
  await expect(
    restored.getByText(starterCopyCopy().pendingCopy, { exact: true }).first(),
  ).toBeVisible();
  await expect(restored.getByRole("button", { name: useLabels["en-CA"], exact: true })).toHaveCount(
    0,
  );
  await expect(
    restored.getByText(starterPreviewCopy("en-CA").previewOnly, { exact: true }),
  ).toHaveCount(0);
  expect(await savedIntents(page)).toEqual(stored);
  await restored.getByRole("button", { name: starterCopyCopy().retryCopy, exact: true }).click();
  await expect(page).toHaveURL(`${web}/quiz/${created.id}`);
  await expect(
    page.getByRole("textbox", { name: "Round title (optional for now)", exact: true }),
  ).toHaveValue(editedTitle);
  await expect(page.getByRole("textbox", { name: "Question prompt", exact: true })).toHaveValue(
    editedPrompt,
  );
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(results[1]).toMatchObject({
    status: 200,
    replayed: true,
    quiz: { id: created.id, title: editedTitle },
  });
  expect(results[1]!.quiz.draft).toEqual(edited.quiz.draft);
  expect(results[1]!.quiz.draftRevision).toBe(edited.quiz.draftRevision);
  const final = await json<{ quiz: Quiz }>(page.request.get(`${api}/v1/quizzes/${created.id}`));
  expect(final.quiz.draft).toEqual(edited.quiz.draft);
  expect(await inventory(page)).toEqual([...before, created.id].sort());
  expect(await savedIntents(page)).toEqual([]);
  expect(posts).toEqual([usePath, usePath]);
});

test("Round starter copy renews a real expired pending request only after explicit Create another copy", async ({
  page,
}, info) => {
  const { owner } = await organization(page, info);
  const before = await inventory(page);
  const catalog = await json<{ contentVersion: string }>(
    page.request.get(`${api}/v1/starters?locale=en-CA`),
  );
  expect(catalog.contentVersion).toEqual(expect.any(String));
  const expired = {
    locale: "en-CA",
    idempotencyKey: randomUUID(),
    creationContext: { actorId: owner.creator.userId, workspaceId: owner.creator.workspaceId },
    contentVersion: catalog.contentVersion,
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  };
  const originalBody = JSON.stringify(expired);
  const key = `${storagePrefix}${owner.creator.userId}:${owner.creator.workspaceId}`;
  await page.addInitScript(
    ({ key, starterId, body }) => {
      if (location.pathname === "/templates")
        sessionStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            intents: [{ starterId, body, previousBodies: [] }],
          }),
        );
    },
    { key, starterId, body: originalBody },
  );
  const bodies: string[] = [];
  const responses: Array<{ status: number; error?: { code: string }; quiz?: Quiz }> = [];
  const storedBeforeRequest: string[] = [];
  await page.route(`${api}${usePath}`, async (route) => {
    bodies.push(route.request().postData()!);
    storedBeforeRequest.push((await page.evaluate((key) => sessionStorage.getItem(key), key))!);
    const response = await route.fetch();
    responses.push({ status: response.status(), ...(await response.json()) });
    await route.fulfill({ response });
  });
  await page.goto(catalogPath);
  const preview = await selectStarter(page);
  await preview.getByRole("button", { name: starterCopyCopy().retryCopy, exact: true }).click();
  const createAnother = preview.getByRole("button", {
    name: starterCopyCopy().createAnother,
    exact: true,
  });
  await expect(createAnother).toBeEnabled();
  expect(responses).toHaveLength(1);
  expect(responses[0]).toMatchObject({ status: 410, error: { code: "STARTER_COPY_EXPIRED" } });
  expect(bodies).toEqual([originalBody]);
  expect(await inventory(page)).toEqual(before);
  await expect(preview.getByText(starterCopyCopy().restartNotice, { exact: true })).toBeVisible();
  await createAnother.click();
  await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]+$/);
  expect(bodies).toHaveLength(2);
  expect(responses[1]!.status).toBe(201);
  const renewed = JSON.parse(bodies[1]!);
  expect(renewed).toMatchObject({
    locale: expired.locale,
    idempotencyKey: expired.idempotencyKey,
    creationContext: expired.creationContext,
    contentVersion: expired.contentVersion,
  });
  expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.now() - 10_000);
  expect(JSON.parse(storedBeforeRequest[1]!).intents).toEqual([
    {
      starterId,
      body: bodies[1],
      previousBodies: [originalBody],
    },
  ]);
  const created = responses[1]!.quiz!;
  await expect(page).toHaveURL(`${web}/quiz/${created.id}`);
  expect(await inventory(page)).toEqual([...before, created.id].sort());
  expect(await savedIntents(page)).toEqual([]);
});

for (const failure of ["blocked", "corrupt"] as const) {
  test(`Round starter copy refuses writes when tab recovery storage is ${failure}`, async ({
    page,
  }, info) => {
    const { owner } = await organization(page, info);
    const before = await inventory(page);
    const posts = copyPosts(page);
    if (failure === "blocked")
      await page.addInitScript((prefix) => {
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key: string) {
          if (key.startsWith(prefix))
            throw new DOMException("Blocked synthetic tab storage", "SecurityError");
          return original.call(this, key);
        };
      }, storagePrefix);
    else {
      const key = `${storagePrefix}${owner.creator.userId}:${owner.creator.workspaceId}`;
      await page.addInitScript(({ key }) => sessionStorage.setItem(key, "not valid JSON"), { key });
    }
    await page.goto(catalogPath);
    const preview = await selectStarter(page);
    const storage = page.locator("[data-starter-copy-storage]");
    await expect(storage.getByText(starterCopyCopy().recoveryError, { exact: true })).toBeVisible();
    await expect(
      preview.getByRole("button", { name: useLabels["en-CA"], exact: true }),
    ).toBeDisabled();
    await storage
      .getByRole("button", { name: starterCopyCopy().retryRecovery, exact: true })
      .click();
    await expect(storage.getByText(starterCopyCopy().recoveryError, { exact: true })).toBeVisible();
    expect(posts).toEqual([]);
    expect(await inventory(page)).toEqual(before);
    if (failure === "corrupt") expect((await savedIntents(page))[0]![1]).toBe("not valid JSON");
  });
}

for (const locale of ["en-CA", "ko-KR"] as const) {
  test(`Round starter copy recovery stays usable at320px with keyboard and accessible light/dark copy in ${locale} @mobile`, async ({
    page,
  }, info) => {
    await organization(page, info);
    const before = await inventory(page);
    const { bodies, results } = await loseFirstAcknowledgement(page);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(catalogPath);
    await selectStarter(page, true);
    if (locale === "ko-KR") await chooseKorean(page);
    const preview = await selectStarter(page, true, locale);
    await useWithKeyboard(page, preview, useLabels[locale]);
    const copy = starterCopyCopy(locale);
    await expect(preview.getByRole("button", { name: copy.retryCopy, exact: true })).toBeEnabled();
    expect(results[0]).toMatchObject({ status: 201, replayed: false });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await waitForPalette(page, preview, locale);
      await fits(page);
      expect(
        (
          await new AxeBuilder({ page })
            .include("main")
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.screenshot({
        path: info.outputPath(`starter-copy-${locale}-${colorScheme}.png`),
        fullPage: true,
        scale: "css",
      });
    }
    const createdId = results[0]!.quiz.id;
    await useWithKeyboard(page, preview, copy.retryCopy);
    await expect(page).toHaveURL(`${web}/quiz/${createdId}`);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[0]!).locale).toBe(locale);
    expect(results[1]).toMatchObject({ status: 200, replayed: true, quiz: { id: createdId } });
    expect(await inventory(page)).toEqual([...before, createdId].sort());
  });
}
