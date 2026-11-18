import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIResponse, type Locator, type Page } from "@playwright/test";
import type {
  CheckpointSetImportPreviewResponse,
  ImportValidationReport,
  QuizDraft,
  SupportedLocale,
} from "@openround/contracts";
import { importPreviewCopy } from "../../apps/web/lib/i18n/import-preview-copy";
import { api, fits, organization, web } from "./support";

type ImportFormat = ImportValidationReport["format"];
type ImportSource = { format: ImportFormat; data: string; file?: Buffer };
type Quiz = { id: string; title: string; draft: QuizDraft; draftRevision: number; status: string };

const previewPath = "/v1/quizzes/import/preview";
const confirmPath = "/v1/quizzes/import/confirm";
const bulk =
  "Which action protects the next step?\n* Review the complete procedure\n- Skip the safety check\n\nWhich check comes first?\n* Confirm the conditions\n- Guess the conditions";

async function json<T>(pending: Promise<APIResponse>, status = 200): Promise<T> {
  const response = await pending;
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

async function inventory(page: Page) {
  const result = await json<{ quizzes: Quiz[] }>(page.request.get(`${api}/v1/quizzes`));
  return result.quizzes.map((quiz) => quiz.id).sort();
}

async function exportedSources(page: Page) {
  const { quiz } = await json<{ quiz: Quiz }>(
    page.request.post(`${api}/v1/quizzes`, {
      data: { title: "Structured import source", description: "Synthetic browser fixture." },
    }),
    201,
  );
  const common = {
    purpose: "diagnostic" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: [],
    linkedRecheckQuestionId: null,
    mediaId: null,
    mediaAlt: null,
  };
  const draft: QuizDraft = {
    ...quiz.draft,
    title: "Structured import source",
    description: "Synthetic browser fixture.",
    questions: [
      {
        ...common,
        id: randomUUID(),
        type: "single_select",
        prompt: "What protects the next action?",
        choices: [
          { id: randomUUID(), label: "Review the complete procedure", isCorrect: true },
          { id: randomUUID(), label: "Skip the safety check", isCorrect: false },
        ],
        timeLimitSeconds: 20,
        basePoints: 1200,
        explanation: "Review the complete procedure before starting.",
      },
      {
        ...common,
        id: randomUUID(),
        type: "numeric",
        prompt: "How many checks are required?",
        correctValue: "3",
        tolerance: "0.5",
        unit: "checks",
        timeLimitSeconds: 30,
        basePoints: 800,
        explanation: "All three checks are required.",
      },
    ],
  };
  await json(
    page.request.patch(`${api}/v1/quizzes/${quiz.id}`, {
      data: { draft, expectedDraftRevision: quiz.draftRevision },
    }),
  );
  const responses = await Promise.all(
    ["json", "csv", "qti.zip"].map((extension) =>
      page.request.get(`${api}/v1/quizzes/${quiz.id}/export.${extension}`),
    ),
  );
  for (const response of responses) expect(response.status(), await response.text()).toBe(200);
  const exportedJson = await responses[0]!.text();
  const csv = await responses[1]!.text();
  const qti = await responses[2]!.body();
  return {
    draft,
    exportedJson,
    csv,
    sources: [
      { format: "csv", data: csv },
      { format: "openround_json", data: exportedJson },
      { format: "bulk", data: bulk },
      { format: "qti3", data: qti.toString("base64"), file: qti },
    ] satisfies ImportSource[],
  };
}

function requests(page: Page) {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(new URL(request.url()).pathname);
  });
  return posts;
}

async function fillSource(page: Page, source: ImportSource, title: string) {
  const panel = page.locator(".portability-panel");
  await panel.getByRole("combobox").selectOption(source.format);
  await panel.getByRole("textbox").first().fill(title);
  if (source.file)
    await panel.locator('input[type="file"]').setInputFiles({
      name: "structured-import.qti.zip",
      mimeType: "application/zip",
      buffer: source.file,
    });
  else await panel.locator("textarea").fill(source.data);
}

async function preview(page: Page, locale: SupportedLocale = "en-CA", keyboard = false) {
  const button = page.getByRole("button", { name: importPreviewCopy(locale).preview, exact: true });
  if (keyboard) {
    const source = page.locator(".portability-panel textarea");
    await source.focus();
    if (nextControlKey(page) === "Alt+Tab") {
      await page.keyboard.press("Tab");
      await test.info().attach("webkit-native-tab-target.json", {
        body: JSON.stringify(
          await page.evaluate(() => ({
            tag: document.activeElement?.tagName,
            id: document.activeElement?.id,
            role: document.activeElement?.getAttribute("role"),
          })),
        ),
        contentType: "application/json",
      });
      await source.focus();
    }
    await page.keyboard.press(nextControlKey(page));
    await expect(button).toBeFocused();
  }
  const response = page.waitForResponse(
    (value) => value.request().method() === "POST" && new URL(value.url()).pathname === previewPath,
  );
  if (keyboard) await page.keyboard.press("Enter");
  else await button.click();
  const value = await response;
  expect(value.status(), await value.text()).toBe(200);
  return (await value.json()) as CheckpointSetImportPreviewResponse;
}

// WebKit follows Safari's native keyboard navigation preference for form controls.
function nextControlKey(page: Page) {
  return page.context().browser()?.browserType().name() === "webkit" ? "Alt+Tab" : "Tab";
}

async function waitForPalette(page: Page) {
  // Resolve fresh tokens and await inherited text after WebKit applies a media change.
  const expected = await page.evaluate(() => {
    const resolve = (token: string) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${token})`;
      document.documentElement.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    return { text: resolve("--ui-text"), subtle: resolve("--ui-text-subtle") };
  });
  await expect(page.locator("[data-creation-method] dd").first()).toHaveCSS(
    "color",
    expected.subtle,
  );
  await expect(page.locator("[data-import-question-index] > p").nth(1)).toHaveCSS(
    "color",
    expected.text,
  );
}

const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

async function parsedContent(
  panel: Locator,
  result: CheckpointSetImportPreviewResponse,
  locale: SupportedLocale = "en-CA",
) {
  const copy = importPreviewCopy(locale);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  expect(result.draft).not.toBeNull();
  const draft = result.draft!;
  await expect(panel).toBeVisible();
  await expect(panel.getByText(copy.previewOnly, { exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: draft.title, exact: true })).toHaveAttribute(
    "lang",
    "",
  );
  await expect(panel).toContainText(
    fill(copy.questionCount, { count: number(draft.questions.length) }),
  );
  await expect(panel).toContainText(
    fill(copy.warningCount, { count: number(result.validation.warnings.length) }),
  );
  await expect(panel.locator("[data-import-question-index]")).toHaveCount(draft.questions.length);
  for (const [index, question] of draft.questions.entries()) {
    const row = panel.locator(`[data-import-question-index="${index}"]`);
    await expect(row.getByRole("heading", { name: question.prompt, exact: true })).toHaveAttribute(
      "lang",
      "",
    );
    await expect(row).toContainText(fill(copy.points, { count: number(question.basePoints) }));
    await expect(row).toContainText(
      fill(copy.timeLimit, { seconds: number(question.timeLimitSeconds) }),
    );
    if (question.explanation)
      await expect(row.getByText(question.explanation, { exact: true })).toHaveAttribute(
        "lang",
        "",
      );
    else await expect(row.getByText(copy.noExplanation, { exact: true })).toBeVisible();
    if ("choices" in question) {
      for (const choice of question.choices) {
        const label = row.getByText(choice.label, { exact: true });
        await expect(label).toHaveAttribute("lang", "");
        const item = label.locator("..");
        if (choice.isCorrect) await expect(item).toContainText(copy.correctAnswer);
        else await expect(item).not.toContainText(copy.correctAnswer);
      }
    }
    if (question.type === "numeric") {
      await expect(row).toContainText(`${question.correctValue} ${question.unit}`);
      await expect(row).toContainText(fill(copy.numericTolerance, { value: question.tolerance }));
    }
  }
}

function authoredQuestions(draft: QuizDraft) {
  return JSON.parse(
    JSON.stringify(draft.questions, (key, value: unknown) => (key === "id" ? undefined : value)),
  );
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

test("WX05B real CSV, JSON, bulk and QTI imports preview parsed content before one explicit draft write", async ({
  page,
}, info) => {
  await organization(page, info);
  const { draft, sources } = await exportedSources(page);
  const posts = requests(page);
  for (const source of sources) {
    const before = await inventory(page);
    const title = `Confirmed ${source.format} import`;
    await page.goto("/create?type=quiz&start=import");
    await fillSource(page, source, title);
    const result = await preview(page);
    expect(result.validation.importedCheckpoints).toBe(2);
    expect(result.validation.errors).toEqual([]);
    expect(result.draft!.title).toBe(title);
    if (source.format !== "bulk")
      expect(authoredQuestions(result.draft!)).toEqual(authoredQuestions(draft));
    await parsedContent(page.locator("[data-import-preview]"), result);
    expect(await inventory(page)).toEqual(before);
    expect(posts.filter((path) => path === confirmPath)).toHaveLength(sources.indexOf(source));
    const response = page.waitForResponse(
      (value) =>
        value.request().method() === "POST" && new URL(value.url()).pathname === confirmPath,
    );
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    const created = await response;
    expect(created.status(), await created.text()).toBe(201);
    const { quiz } = (await created.json()) as { quiz: Quiz };
    await expect(page).toHaveURL(`${web}/quiz/${quiz.id}`);
    expect(quiz.status).toBe("draft");
    expect(authoredQuestions(quiz.draft)).toEqual(authoredQuestions(result.draft!));
    expect(await inventory(page)).toEqual([...before, quiz.id].sort());
  }
  expect(posts.filter((path) => path === previewPath)).toHaveLength(4);
  expect(posts.filter((path) => path === confirmPath)).toHaveLength(4);
  expect(posts.filter((path) => path === "/v1/quizzes" || path === "/v1/quizzes/import")).toEqual(
    [],
  );
  expect(posts.filter((path) => path === "/v1/authoring/jobs")).toEqual([]);
});

test("WX05B previews preserve warning/error row and field details and input edits invalidate creation", async ({
  page,
}, info) => {
  await organization(page, info);
  const { exportedJson, csv } = await exportedSources(page);
  const before = await inventory(page);
  const posts = requests(page);
  const withMedia = JSON.parse(exportedJson);
  withMedia.checkpointSet.questions[0].mediaId = randomUUID();
  withMedia.checkpointSet.questions[0].mediaAlt = "Private source image";
  await page.goto("/create?type=quiz&start=import");
  await fillSource(
    page,
    { format: "openround_json", data: JSON.stringify(withMedia) },
    "Warning preview",
  );
  const warning = await preview(page);
  expect(warning.validation.warnings).toContainEqual(
    expect.objectContaining({ code: "MEDIA_REFERENCE_REMOVED", row: 1, field: "mediaId" }),
  );
  const warningRow = page.locator(".import-validation li").filter({ hasText: "mediaId" });
  await expect(warningRow).toContainText("row 1");
  await expect(warningRow.locator('[lang="en-CA"]').last()).toHaveText(
    warning.validation.warnings.find((item) => item.code === "MEDIA_REFERENCE_REMOVED")!.message,
  );
  await expect(page.getByRole("button", { name: "Create draft", exact: true })).toBeEnabled();

  await page.locator(".portability-panel").getByRole("textbox").first().fill("Changed title");
  await expect(page.locator("[data-import-preview]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create draft", exact: true })).toHaveCount(0);
  await preview(page);
  await page.locator(".portability-panel textarea").fill(`${JSON.stringify(withMedia)}\n`);
  await expect(page.locator("[data-import-preview]")).toHaveCount(0);
  await preview(page);
  await page.locator(".portability-panel").getByRole("combobox").selectOption("csv");
  await expect(page.locator("[data-import-preview]")).toHaveCount(0);
  await expect(page.locator(".portability-panel textarea")).toHaveValue("");

  const invalidCsv = csv.replace(",20,1200,", ",301,1200,");
  expect(invalidCsv).not.toBe(csv);
  await page.locator(".portability-panel textarea").fill(invalidCsv);
  const invalid = await preview(page);
  expect(invalid.draft).toBeNull();
  expect(invalid.validation.errors).toContainEqual(
    expect.objectContaining({ row: 2, field: "timeLimitSeconds" }),
  );
  const errorRow = page.locator(".import-validation li").filter({ hasText: "timeLimitSeconds" });
  await expect(errorRow).toContainText("row 2");
  await expect(errorRow).toContainText(invalid.validation.errors[0]!.message);
  await expect(page.locator(".portability-panel").getByRole("alert")).toContainText(
    importPreviewCopy().previewInvalid,
  );
  await expect(page.getByRole("button", { name: "Create draft", exact: true })).toHaveCount(0);
  expect(await inventory(page)).toEqual(before);
  expect(posts.filter((path) => path === confirmPath || path === "/v1/authoring/jobs")).toEqual([]);
});

test("WX05B a lost confirmation acknowledgement reloads and replays the exact creation with a private receipt", async ({
  page,
}, info) => {
  await organization(page, info);
  const before = await inventory(page);
  const posts = requests(page);
  const title = "Private import title 7b2f";
  const source: ImportSource = { format: "bulk", data: bulk };
  const bodies: string[] = [];
  const confirmed: Array<{ status: number; quiz: Quiz; replayed: boolean }> = [];
  await page.route(`${api}${confirmPath}`, async (route) => {
    bodies.push(route.request().postData()!);
    const response = await route.fetch();
    confirmed.push({ status: response.status(), ...(await response.json()) });
    if (bodies.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.goto("/create?type=quiz&start=import");
  await fillSource(page, source, title);
  await preview(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry same creation", exact: true }),
  ).toBeEnabled();
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]!.status).toBe(201);
  const createdId = confirmed[0]!.quiz.id;
  expect(await inventory(page)).toEqual([...before, createdId].sort());
  await expect(page.locator(".portability-panel textarea")).toBeDisabled();
  const stored = await page.evaluate(() =>
    Object.entries(sessionStorage).filter(([key]) =>
      key.startsWith("structured-import-intents:v1:"),
    ),
  );
  expect(stored).toHaveLength(1);
  const intent = JSON.parse(stored[0]![1]);
  expect(Object.keys(intent).sort()).toEqual(["intents", "version"]);
  expect(intent.version).toBe(1);
  expect(intent.intents).toHaveLength(1);
  expect(Object.keys(intent.intents[0]).sort()).toEqual([
    "creationContext",
    "idempotencyKey",
    "previewFingerprint",
    "sourceDigest",
  ]);
  expect(intent.intents[0].sourceDigest).toMatch(/^[a-f0-9]{64}$/);
  const firstBody = JSON.parse(bodies[0]!);
  expect(intent.intents[0]).toMatchObject({
    idempotencyKey: firstBody.idempotencyKey,
    previewFingerprint: firstBody.previewFingerprint,
    creationContext: firstBody.creationContext,
  });
  expect(stored[0]![1]).not.toContain(title);
  for (const fragment of [bulk, "Review the complete procedure", "questions", '"data"'])
    expect(stored[0]![1]).not.toContain(fragment);

  await page.reload();
  await expect(page.getByText(importPreviewCopy().pendingRecovery, { exact: true })).toBeVisible();
  await expect(page.locator(".portability-panel textarea")).toHaveValue("");
  await fillSource(page, source, title);
  await preview(page);
  await page.getByRole("button", { name: "Retry same creation", exact: true }).click();
  await expect(page).toHaveURL(`${web}/quiz/${createdId}`);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(firstBody.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(confirmed[1]).toMatchObject({ status: 200, replayed: true, quiz: { id: createdId } });
  expect(await inventory(page)).toEqual([...before, createdId].sort());
  expect(await page.evaluate((key) => sessionStorage.getItem(key), stored[0]![0])).toBeNull();
  expect(posts.filter((path) => path === "/v1/authoring/jobs")).toEqual([]);
});

test("WX05B a committed extended import recovers after reload when the current writer rejects a fresh preview", async ({
  page,
}, info) => {
  await organization(page, info);
  const { exportedJson } = await exportedSources(page);
  const input = JSON.parse(exportedJson);
  input.version = 5;
  input.checkpointSet.questions[0] = {
    ...input.checkpointSet.questions[0],
    type: "poll",
    purpose: "opinion",
    basePoints: 0,
    maxSelections: 2,
    choices: input.checkpointSet.questions[0].choices.map((choice: { label: string }) => ({
      ...choice,
      isCorrect: false,
    })),
  };
  const source: ImportSource = { format: "openround_json", data: JSON.stringify(input) };
  const title = "Recover committed multiple-selection opinion poll";
  const before = await inventory(page);
  const posts = requests(page);
  const bodies: string[] = [];
  const confirmed: Array<{ status: number; quiz: Quiz; replayed: boolean }> = [];
  await page.route(`${api}${confirmPath}`, async (route) => {
    bodies.push(route.request().postData()!);
    const response = await route.fetch();
    confirmed.push({ status: response.status(), ...(await response.json()) });
    if (bodies.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.goto("/create?type=quiz&start=import");
  await fillSource(page, source, title);
  const originalPreview = await preview(page);
  expect(originalPreview.validation.errors).toEqual([]);
  expect(originalPreview.draft).not.toBeNull();
  expect(originalPreview.draft!.questions[0]).toMatchObject({
    type: "poll",
    purpose: "opinion",
    basePoints: 0,
    maxSelections: 2,
  });
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry same creation", exact: true }),
  ).toBeEnabled();
  expect(confirmed[0]).toMatchObject({ status: 201, replayed: false });
  const createdId = confirmed[0]!.quiz.id;
  const afterCommit = [...before, createdId].sort();
  expect(await inventory(page)).toEqual(afterCommit);
  const receipt = await page.evaluate(() =>
    Object.entries(sessionStorage).find(([key]) => key.startsWith("structured-import-intents:v1:")),
  );
  expect(receipt).toBeDefined();
  const originalBody = JSON.parse(bodies[0]!);

  await page.reload();
  await expect(page.getByText(importPreviewCopy().pendingRecovery, { exact: true })).toBeVisible();
  const changedFingerprint =
    (originalPreview.previewFingerprint.startsWith("0") ? "1" : "0") +
    originalPreview.previewFingerprint.slice(1);
  const rollbackMessage = "Extended Round responses are unavailable in this workspace.";
  await page.route(`${api}${previewPath}`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const fresh = (await response.json()) as CheckpointSetImportPreviewResponse;
    expect(fresh.sourceDigest).toBe(originalPreview.sourceDigest);
    expect(fresh.creationContext).toEqual(originalPreview.creationContext);
    // Model the current client's writer-rollback snapshot. Confirmation remains real HTTP
    // and must recover the server's committed receipt using the original request identity.
    await route.fulfill({
      response,
      json: {
        ...fresh,
        draft: null,
        previewFingerprint: changedFingerprint,
        validation: {
          ...fresh.validation,
          errors: [
            { severity: "error", code: "ROUND_RESPONSE_UNAVAILABLE", message: rollbackMessage },
          ],
        },
      },
    });
  });
  await fillSource(page, source, title);
  const rolledBack = await preview(page);
  expect(rolledBack.draft).toBeNull();
  expect(rolledBack.previewFingerprint).not.toBe(originalBody.previewFingerprint);
  await expect(page.locator(".import-validation")).toContainText(rollbackMessage);
  const recovery = page.locator("[data-import-recovery]");
  await expect(recovery).toBeVisible();
  await expect(
    recovery.getByRole("button", { name: "Retry same creation", exact: true }),
  ).toBeEnabled();
  await expect(recovery.getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Create draft", exact: true })).toHaveCount(0);
  await expect(page.getByText(importPreviewCopy().previewOnly, { exact: true })).toHaveCount(0);
  await expect(page.locator("[data-import-preview]")).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), receipt![0])).toBe(receipt![1]);
  expect(await inventory(page)).toEqual(afterCommit);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: info.outputPath("wx05b-rollback-recovery.png"),
    fullPage: true,
    scale: "css",
  });
  await recovery.getByRole("button", { name: "Retry same creation", exact: true }).click();
  await expect(page).toHaveURL(`${web}/quiz/${createdId}`);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(JSON.parse(bodies[1]!)).toMatchObject({
    idempotencyKey: originalBody.idempotencyKey,
    previewFingerprint: originalPreview.previewFingerprint,
    creationContext: originalPreview.creationContext,
  });
  expect(confirmed[1]).toMatchObject({ status: 200, replayed: true, quiz: { id: createdId } });
  expect(await inventory(page)).toEqual(afterCommit);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), receipt![0])).toBeNull();

  // The same invalid fresh preview cannot create or confirm once no matching receipt exists.
  await page.goto("/create?type=quiz&start=import");
  await fillSource(page, source, title);
  await preview(page);
  await expect(page.locator("[data-import-recovery]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create draft", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry same creation", exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator(".portability-panel").getByRole("alert")).toContainText(
    importPreviewCopy().previewInvalid,
  );
  expect(bodies).toHaveLength(2);
  expect(await inventory(page)).toEqual(afterCommit);
  expect(posts.filter((path) => path === "/v1/authoring/jobs")).toEqual([]);
});

for (const locale of ["en-CA", "ko-KR"] as const) {
  test(`WX05B import preview fits 320px with keyboard and accessible light/dark copy in ${locale} @mobile`, async ({
    page,
  }, info) => {
    await organization(page, info);
    const { exportedJson } = await exportedSources(page);
    const before = await inventory(page);
    const posts = requests(page);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/create?type=quiz&start=import");
    await expect(page.getByRole("button", { name: "Preview import", exact: true })).toBeVisible();
    if (locale === "ko-KR") {
      const changed = page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          new URL(response.url()).pathname === "/v1/account/locale" &&
          response.request().postDataJSON().locale === locale,
      );
      await page
        .getByRole("button", { name: "EN: Language: English (Canada)", exact: true })
        .click();
      await page.getByRole("radio", { name: /한국어/ }).click();
      expect((await changed).status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    }
    const input = JSON.parse(exportedJson);
    input.checkpointSet.questions[0].prompt = `${locale === "ko-KR" ? "다음 행동 전에 무엇을 확인해야 하나요? " : "What should you check before continuing? "}${"LongUnbrokenAuthoredText".repeat(6)}`;
    await fillSource(
      page,
      { format: "openround_json", data: JSON.stringify(input) },
      "Authored review / 직접 작성한 검토",
    );
    const result = await preview(page, locale, true);
    const panel = page.locator("[data-import-preview]");
    await parsedContent(panel, result, locale);
    await page.keyboard.press(nextControlKey(page));
    await expect(
      page.getByRole("button", { name: importPreviewCopy(locale).create, exact: true }),
    ).toBeFocused();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await waitForPalette(page);
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
        path: info.outputPath(`wx05b-import-preview-${locale}-${colorScheme}.png`),
        fullPage: true,
        scale: "css",
      });
    }
    expect(await inventory(page)).toEqual(before);
    expect(posts.filter((path) => path === confirmPath || path === "/v1/authoring/jobs")).toEqual(
      [],
    );
  });
}
