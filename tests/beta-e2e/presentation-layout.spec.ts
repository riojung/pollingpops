import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

async function signIn(page: Page) {
  await signInBeta(page);
  await expect(page.getByRole("heading", { name: "Rounds", exact: true })).toBeVisible();
}

async function createPresentation(page: Page) {
  const response = await page.request.post(`${apiUrl}/v1/presentations`, {
    data: { title: "Layout editing acceptance", description: "" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).presentation.id as string;
}

async function renderedArrangement(slide: Locator) {
  return slide.locator("[data-region]").evaluateAll((regions) =>
    regions.flatMap((region) =>
      Array.from(region.children).map((element) => ({
        region: region.getAttribute("data-region"),
        text:
          element.querySelector("textarea")?.value ??
          element.querySelector("h1, p")?.textContent?.trim(),
        frame: element.getAttribute("data-frame"),
      })),
    ),
  );
}

async function expectReadableSlide(slide: Locator, narrow = false) {
  const geometry = await slide.evaluate((article) => {
    const bounds = article.getBoundingClientRect();
    const editorCard = article.closest("#presentation-canvas")
      ? article.parentElement?.getBoundingClientRect()
      : null;
    const elements = Array.from(article.querySelectorAll("[data-region] > div")).map((element) => {
      const rect = element.getBoundingClientRect();
      const content = element.querySelector("textarea, h1, p");
      return {
        x: rect.x,
        y: rect.y,
        right: rect.right,
        bottom: rect.bottom,
        withinSlide:
          rect.x >= bounds.x - 1 &&
          rect.right <= bounds.right + 1 &&
          rect.y >= bounds.y - 1 &&
          rect.bottom <= bounds.bottom + 1 &&
          (!editorCard || rect.bottom <= editorCard.bottom + 1),
        readable:
          content instanceof HTMLElement &&
          content.scrollWidth <= content.clientWidth + 1 &&
          content.scrollHeight <= content.clientHeight + 1 &&
          parseFloat(getComputedStyle(content).fontSize) >= 16,
      };
    });
    return {
      elements,
      withinViewport: bounds.x >= 0 && bounds.right <= window.innerWidth + 1,
      aspectRatio: bounds.width / bounds.height,
    };
  });
  expect(geometry.elements.length).toBeGreaterThan(1);
  for (const [index, element] of geometry.elements.entries()) {
    expect(element.withinSlide, `element ${index} stays within the slide`).toBe(true);
    expect(element.readable, `element ${index} shows all its text`).toBe(true);
    for (const other of geometry.elements.slice(index + 1)) {
      expect(
        element.right <= other.x + 1 ||
          other.right <= element.x + 1 ||
          element.bottom <= other.y + 1 ||
          other.bottom <= element.y + 1,
        "text elements do not overlap",
      ).toBe(true);
    }
    if (narrow && index > 0) {
      expect(element.y).toBeGreaterThanOrEqual(geometry.elements[index - 1]!.bottom - 1);
    }
  }
  if (!narrow) expect(geometry.aspectRatio).toBeCloseTo(16 / 9, 1);
  if (narrow) expect(geometry.withinViewport).toBe(true);
}

async function expectAccessibleSlide(page: Page) {
  expect(
    (await new AxeBuilder({ page }).include("article[data-layout]").analyze()).violations,
  ).toEqual([]);
}

for (const suffix of ["", " @mobile"]) {
  test(`images stay clear of text in every starter layout and after text positioning${suffix}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    // Open the full inspector/preview controls before verifying the narrow layout below.
    if (suffix) await page.setViewportSize({ width: 1280, height: 720 });
    await signIn(page);
    const presentationId = await createPresentation(page);
    const initial = await page.request.get(`${apiUrl}/v1/presentations/${presentationId}`);
    expect(initial.ok()).toBeTruthy();
    let record = (await initial.json()).presentation;
    const mediaId = randomUUID();
    const imageUrl = new URL("/layout-fixture.svg", page.url()).href;
    const uploadUrl = new URL("/layout-fixture-upload", page.url()).href;
    // Exercise the real upload/editor flow with deterministic storage/scanner responses.
    // The beta browser server intentionally has no external object store or malware scanner.
    await page.route(`${apiUrl}/v1/features`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), mediaUploads: true } });
    });
    await page.route(`${apiUrl}/v1/presentations/${presentationId}`, (route) =>
      route.fulfill({ json: { presentation: record } }),
    );
    await page.route(`${apiUrl}/v1/presentations/${presentationId}/draft`, async (route) => {
      const { draft } = route.request().postDataJSON();
      record = { ...record, draft, draftRevision: record.draftRevision + 1 };
      await route.fulfill({ json: { presentation: record } });
    });
    await page.route(`${apiUrl}/v1/media`, (route) =>
      route.fulfill({ json: { mediaId, uploadUrl } }),
    );
    await page.route(uploadUrl, (route) => route.fulfill({ status: 204 }));
    await page.route(`${apiUrl}/v1/media/${mediaId}/complete`, (route) =>
      route.fulfill({
        json: { media: { id: mediaId, scanStatus: "clean" }, downloadUrl: imageUrl },
      }),
    );
    await page.route(`${apiUrl}/v1/media/${mediaId}`, (route) =>
      route.fulfill({ json: { downloadUrl: imageUrl } }),
    );
    await page.route(imageUrl, (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#087f8c"/><circle cx="200" cy="100" r="60" fill="#fff"/></svg>',
      }),
    );
    await page.goto(`/presentation/${presentationId}`);
    const canvas = page.locator("#presentation-canvas");
    const slide = canvas.locator("article[data-layout]");
    await canvas.getByLabel("Slide title", { exact: true }).fill("Evidence diagram");
    await canvas
      .getByLabel("Text box 1", { exact: true })
      .fill(
        "Review the evidence, identify the main signal, and explain how it informs the next decision.",
      );
    await page.getByRole("tab", { name: "Media", exact: true }).click();
    await page.getByLabel("Image alternative text", { exact: true }).fill("Evidence diagram");
    await page.getByLabel("Instructional image", { exact: true }).setInputFiles({
      name: "evidence.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(slide.getByRole("img", { name: "Evidence diagram" })).toBeVisible();

    async function expectImageClear(target: Locator) {
      await expect(target.getByRole("img", { name: "Evidence diagram" })).toBeVisible();
      const clear = await target.evaluate((article) => {
        const img = article.querySelector("img")!;
        const image = img.parentElement!.getBoundingClientRect();
        const actualImage = img.getBoundingClientRect();
        const bounds = article.getBoundingClientRect();
        const contained =
          actualImage.x >= image.x - 1 &&
          actualImage.right <= image.right + 1 &&
          actualImage.y >= image.y - 1 &&
          actualImage.bottom <= image.bottom + 1 &&
          actualImage.bottom <= bounds.bottom + 1;
        return (
          contained &&
          Array.from(article.querySelectorAll("[data-region] > div")).every((element) => {
            const text = element.getBoundingClientRect();
            return (
              text.right <= image.left + 1 ||
              text.left >= image.right - 1 ||
              text.bottom <= image.top + 1 ||
              text.top >= image.bottom - 1
            );
          })
        );
      });
      expect(clear, "text rectangles stay clear of the reserved image area").toBe(true);
    }

    await expectImageClear(slide);
    await page.getByRole("tab", { name: "Layout", exact: true }).click();
    for (const layout of ["title", "title_body", "media", "quote", "section", "callout"]) {
      await page.getByRole("combobox", { name: "Structured layout" }).selectOption(layout);
      await expectImageClear(slide);
      await expect(slide.getByText("Image area", { exact: true })).toBeVisible();
      const arrangement = await renderedArrangement(slide);
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      const preview = page.getByRole("dialog", { name: "Presentation preview" });
      const previewSlide = preview.locator("article[data-layout]");
      await expectImageClear(previewSlide);
      expect(await renderedArrangement(previewSlide)).toEqual(arrangement);
      await page.getByRole("button", { name: "Close preview", exact: true }).click();
    }
    await canvas
      .getByLabel("Selected block actions")
      .getByRole("button", { name: "Add text box", exact: true })
      .click();
    await canvas.getByLabel("Text box 2", { exact: true }).fill("Audience takeaway.");
    await page.getByRole("tab", { name: "Layout", exact: true }).click();
    for (const label of ["Text box 1", "Text box 2"]) {
      await page.getByRole("combobox", { name: "Selected text element" }).selectOption({ label });
      await page.getByRole("combobox", { name: "Position on slide" }).selectOption("bottom_right");
    }
    await expectImageClear(slide);
    const stack = await Promise.all(
      ["Text box 1", "Text box 2"].map((label) =>
        canvas.getByLabel(label, { exact: true }).evaluate((input) => {
          const bounds = input.closest("[data-frame]")!.getBoundingClientRect();
          return { x: bounds.x, y: bounds.y, bottom: bounds.bottom };
        }),
      ),
    );
    expect(stack[0]!.bottom).toBeLessThanOrEqual(stack[1]!.y + 1);
    expect(stack[0]!.x).toBeCloseTo(stack[1]!.x, 1);
    await canvas
      .getByLabel("Selected block actions")
      .getByRole("button", { name: "Delete text box", exact: true })
      .click();
    await page.getByRole("tab", { name: "Layout", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Selected text element" })
      .selectOption({ label: "Text box 1" });
    await page.getByRole("combobox", { name: "Position on slide" }).selectOption("bottom_right");
    await expectImageClear(slide);
    const height = page.getByLabel("Text box height (%)", { exact: true });
    await height.fill("100");
    await expectImageClear(slide);
    const resize = canvas.getByRole("button", { name: /Resize Text box 1/ });
    await resize.focus();
    await page.keyboard.press("Shift+ArrowDown");
    await expectImageClear(slide);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expectImageClear(slide);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expectImageClear(slide);
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
    await page.reload();
    await expectImageClear(slide);

    // Removing a newly attached image restores the wide starter; Undo restores both together.
    await page.getByRole("tab", { name: "Layout", exact: true }).click();
    await page.getByRole("combobox", { name: "Structured layout" }).selectOption("title_body");
    await page.getByRole("tab", { name: "Media", exact: true }).click();
    await page.getByRole("button", { name: "Remove image", exact: true }).click();
    await expect(slide.getByRole("img")).toHaveCount(0);
    expect(
      (await renderedArrangement(slide)).find((element) => element.text?.startsWith("Review"))
        ?.frame,
    ).toBe(JSON.stringify({ x: 8, y: 48, width: 84, height: 40 }));
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expectImageClear(slide);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Hide inspector" }).click();
    await page.getByRole("button", { name: "Collapse map" }).click();
    await expectImageClear(slide);
    await expectReadableSlide(slide, true);
  });
}

test("authors can edit, save, publish, and deliver the same slide arrangement", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  const presentationId = await createPresentation(page);
  await page.evaluate(() => localStorage.setItem("openround:color-mode", "dark"));
  await page.goto(`/presentation/${presentationId}`);

  const canvas = page.locator("#presentation-canvas");
  const title = canvas.getByLabel("Slide title", { exact: true });
  await expect(title).toBeVisible();
  await title.fill("Training and recovery");
  await canvas.getByLabel("Text box 1", { exact: true }).fill("Review the evidence together.");
  await expectAccessibleSlide(page);
  await page.getByRole("tab", { name: "Layout", exact: true }).click();
  for (const layout of ["title", "media", "quote", "section", "callout", "title_body"]) {
    await page.getByRole("combobox", { name: "Structured layout" }).selectOption(layout);
    await expectAccessibleSlide(page);
  }
  await canvas
    .getByLabel("Selected block actions")
    .getByRole("button", { name: "Add text box", exact: true })
    .click();
  await canvas.getByLabel("Text box 2", { exact: true }).fill("Set the context before responding.");

  await page.getByRole("tab", { name: "Layout", exact: true }).click();
  await page.getByRole("combobox", { name: "Structured layout" }).selectOption("section");
  await page.getByRole("combobox", { name: "Selected text element" }).selectOption({
    label: "Text box 2",
  });
  await page.getByRole("combobox", { name: "Position on slide" }).selectOption("top_left");
  await expect(canvas.getByRole("group", { name: "Text box 2, Top left" })).toBeVisible();
  await page.getByRole("combobox", { name: "Selected text element" }).selectOption({
    label: "Text box 1",
  });
  await page.getByRole("combobox", { name: "Position on slide" }).selectOption("top_left");
  await page.getByRole("button", { name: "Move up", exact: true }).click();
  await expect
    .poll(() =>
      canvas
        .locator('[data-region="top_left"] textarea')
        .evaluateAll((inputs) => inputs.map((input) => (input as HTMLTextAreaElement).value)),
    )
    .toEqual(["Review the evidence together.", "Set the context before responding."]);

  const actions = canvas.getByLabel("Selected block actions");
  await actions.getByRole("button", { name: "Add text box", exact: true }).click();
  await canvas.getByLabel("Text box 3", { exact: true }).fill("Temporary text box");
  await actions.getByRole("button", { name: "Delete text box", exact: true }).click();
  await expect(canvas.getByLabel("Text box 3", { exact: true })).toHaveCount(0);

  const titleHandle = canvas.getByRole("button", { name: /Move Slide title/ });
  await page.getByRole("tab", { name: "Layout", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Selected text element" })
    .selectOption({ label: "Slide title" });
  await page.getByRole("combobox", { name: "Position on slide" }).selectOption("middle_center");
  const xField = page.getByLabel("Horizontal position (%)", { exact: true });
  const yField = page.getByLabel("Vertical position (%)", { exact: true });
  const widthField = page.getByLabel("Text box width (%)", { exact: true });
  const heightField = page.getByLabel("Text box height (%)", { exact: true });
  for (const field of [xField, yField, widthField, heightField]) {
    expect(await field.evaluate((input) => (input as HTMLInputElement).validity.valid)).toBe(true);
  }
  const beforeX = Number(await xField.inputValue());
  await titleHandle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(xField).toHaveValue(String(beforeX + 1));
  await expect(titleHandle).toBeFocused();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(xField).toHaveValue(String(beforeX + 6));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(xField).toHaveValue(String(beforeX + 1));
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(xField).toHaveValue(String(beforeX + 6));

  // Pointer gestures commit one edit and Escape cancels transient placement.
  const moveBounds = (await titleHandle.boundingBox())!;
  await page.mouse.move(moveBounds.x + 10, moveBounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(moveBounds.x + 65, moveBounds.y + 35, { steps: 5 });
  await page.mouse.up();
  expect(Number(await xField.inputValue())).toBeGreaterThan(beforeX + 6);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(xField).toHaveValue(String(beforeX + 6));
  const cancelBounds = (await titleHandle.boundingBox())!;
  await page.mouse.move(cancelBounds.x + 10, cancelBounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(cancelBounds.x + 40, cancelBounds.y + 30);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(xField).toHaveValue(String(beforeX + 6));

  const resizeHandle = canvas.getByRole("button", { name: /Resize Slide title/ });
  const beforeWidth = Number(await widthField.inputValue());
  await resizeHandle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(widthField).toHaveValue(String(beforeWidth + 1));
  await expect(resizeHandle).toBeFocused();
  const resizeBounds = (await resizeHandle.boundingBox())!;
  await page.mouse.move(resizeBounds.x + 5, resizeBounds.y + 5);
  await page.mouse.down();
  await page.mouse.move(resizeBounds.x + 35, resizeBounds.y + 20, { steps: 5 });
  await page.mouse.up();
  expect(Number(await widthField.inputValue())).toBeGreaterThan(beforeWidth + 1);
  await widthField.fill("999");
  expect(await widthField.evaluate((input) => (input as HTMLInputElement).validity.valid)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Show layout guides")).toBeChecked();
  await page.getByLabel("Show layout guides").uncheck();
  await page.getByLabel("Show layout guides").check();

  async function setFrame(label: string, frame: [number, number, number, number]) {
    await page.getByRole("combobox", { name: "Selected text element" }).selectOption({ label });
    // Shrink first, then place and grow, so every intermediate edit stays within bounds.
    await widthField.fill("12");
    await heightField.fill("6");
    await xField.fill(String(frame[0]));
    await yField.fill(String(frame[1]));
    await widthField.fill(String(frame[2]));
    await heightField.fill(String(frame[3]));
  }
  await setFrame("Slide title", [8, 10, 84, 24]);
  await setFrame("Text box 1", [8, 44, 40, 32]);
  await setFrame("Text box 2", [52, 44, 40, 32]);
  await xField.fill("999");
  await expect(xField).toHaveValue("60");
  await yField.fill("999");
  await expect(yField).toHaveValue("68");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(yField).toHaveValue("44");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(xField).toHaveValue("52");
  await page
    .getByRole("combobox", { name: "Selected text element" })
    .selectOption({ label: "Slide title" });
  await heightField.fill("6");
  await expect(canvas.getByRole("status", { name: "Text overflows frame" })).toBeVisible();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const overflowHeading = page
    .getByRole("dialog", { name: "Presentation preview" })
    .getByRole("heading", { name: "Training and recovery" });
  await expect(overflowHeading).toHaveAttribute("tabindex", "0");
  expect(
    await overflowHeading.evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true);
  await overflowHeading.focus();
  await page.keyboard.press("ArrowDown");
  await expect
    .poll(() => overflowHeading.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expectAccessibleSlide(page);
  await page.getByRole("button", { name: "Close preview", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(heightField).toHaveValue("24");
  await page
    .getByRole("combobox", { name: "Selected text element" })
    .selectOption({ label: "Text box 2" });
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await expectReadableSlide(canvas.locator("[data-layout]"));
  await page.screenshot({ path: test.info().outputPath("bounded-layout-editor.png") });

  const savedResponse = await page.request.get(`${apiUrl}/v1/presentations/${presentationId}`);
  expect(savedResponse.ok()).toBeTruthy();
  const saved = (await savedResponse.json()).presentation;
  expect(saved.draft.schemaVersion).toBe(2);
  expect(saved.draft.blocks[0].textElements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "title",
        text: "Training and recovery",
        region: "top_center",
        frame: { x: 8, y: 10, width: 84, height: 24 },
      }),
      expect.objectContaining({
        role: "body",
        text: "Set the context before responding.",
        region: "middle_right",
        frame: { x: 52, y: 44, width: 40, height: 32 },
      }),
    ]),
  );

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Presentation preview" });
  await expect(preview.getByRole("heading", { name: "Training and recovery" })).toBeVisible();
  await expect(preview.getByText("Set the context before responding.")).toBeVisible();
  const previewSlide = preview.locator("article[data-layout]");
  const arrangement = await renderedArrangement(previewSlide);
  const previewAppearance = await previewSlide.evaluate((article) => {
    const titleStyle = getComputedStyle(article.querySelector("h1")!);
    const bodyStyle = getComputedStyle(article.querySelector("p")!);
    return {
      background: getComputedStyle(article).backgroundImage,
      title: [titleStyle.fontWeight, titleStyle.color],
      body: [bodyStyle.fontWeight, bodyStyle.color],
    };
  });
  await expectReadableSlide(previewSlide);
  await expectAccessibleSlide(page);
  await page.getByRole("button", { name: "Close preview", exact: true }).click();

  const questionId = randomUUID();
  const publishDraft = {
    ...saved.draft,
    blocks: [
      ...saved.draft.blocks,
      {
        id: randomUUID(),
        kind: "question",
        question: {
          id: questionId,
          type: "single_select",
          prompt: "What should the audience review first?",
          choices: [
            { id: randomUUID(), label: "The evidence", isCorrect: true },
            { id: randomUUID(), label: "The conclusion", isCorrect: false },
          ],
          purpose: "diagnostic",
          confidence: "off",
          delivery: "main",
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 30,
          basePoints: 1_000,
          explanation: "Review the evidence before choosing an intervention.",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  };
  const updated = await page.request.put(`${apiUrl}/v1/presentations/${presentationId}/draft`, {
    data: {
      draft: publishDraft,
      expectedRevision: saved.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(updated.status()).toBe(200);
  const updatedRecord = (await updated.json()).presentation;
  expect(updatedRecord.draftRevision).toBeGreaterThan(saved.draftRevision);
  await page.reload();
  await expect(canvas.getByLabel("Slide title", { exact: true })).toHaveValue(
    "Training and recovery",
  );
  const publishedResponse = page.waitForResponse(
    (response) =>
      response.url() === `${apiUrl}/v1/presentations/${presentationId}/publish` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const published = await publishedResponse;
  expect(published.status()).toBe(200);
  expect((await published.json()).version.content.blocks[0].textElements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "title",
        text: "Training and recovery",
        region: "top_center",
        frame: { x: 8, y: 10, width: 84, height: 24 },
      }),
      expect.objectContaining({
        role: "body",
        text: "Set the context before responding.",
        region: "middle_right",
        frame: { x: 52, y: 44, width: 40, height: 32 },
      }),
    ]),
  );

  await page.goto(`/presentation/${presentationId}/host`);
  await page.getByRole("button", { name: "Start live session", exact: true }).click();
  await expect(page).toHaveURL(/\/presentation-session\/[^/]+\/host$/);
  const sessionId = new URL(page.url()).pathname.split("/")[2]!;
  const session = await page.request.get(`${apiUrl}/v1/presentation-sessions/${sessionId}`);
  expect(session.status()).toBe(200);
  const code = (await session.json()).snapshot.code as string;
  const participantContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const participant = await participantContext.newPage();
    await participant.goto(`/join?code=${code}`);
    await participant.getByLabel("Nickname", { exact: true }).fill("Layout audience");
    await participant.getByRole("button", { name: "Join a Presentation", exact: true }).click();
    await expect(participant).toHaveURL(`/presentation-session/${sessionId}/play`);
    await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
    const hostSlide = page.locator("article[data-layout]");
    const participantSlide = participant.locator("article[data-layout]");
    await expect(hostSlide.getByRole("heading", { name: "Training and recovery" })).toBeVisible();
    await expect(
      participantSlide.getByRole("heading", { name: "Training and recovery" }),
    ).toBeVisible();
    expect(await renderedArrangement(hostSlide)).toEqual(arrangement);
    expect(await renderedArrangement(participantSlide)).toEqual(arrangement);
    for (const liveSlide of [hostSlide, participantSlide]) {
      expect(
        await liveSlide.evaluate((article) => {
          const titleStyle = getComputedStyle(article.querySelector("h1")!);
          const bodyStyle = getComputedStyle(article.querySelector("p")!);
          return {
            background: getComputedStyle(article).backgroundImage,
            title: [titleStyle.fontWeight, titleStyle.color],
            body: [bodyStyle.fontWeight, bodyStyle.color],
          };
        }),
      ).toEqual(previewAppearance);
    }
    await expectReadableSlide(hostSlide);
    await expectReadableSlide(participantSlide);
    await expectAccessibleSlide(page);
    await expectAccessibleSlide(participant);

    // Existing sessions retain the same content after a reload, and both live views reflow.
    await participant.reload();
    await expect(
      participantSlide.getByRole("heading", { name: "Training and recovery" }),
    ).toBeVisible();
    for (const livePage of [page, participant]) {
      await livePage.setViewportSize({ width: 390, height: 844 });
      const liveSlide = livePage.locator("article[data-layout]");
      expect(await renderedArrangement(liveSlide)).toEqual(arrangement);
      await expectReadableSlide(liveSlide, true);
      expect(
        await livePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
    }
  } finally {
    await participantContext.close();
  }
});

test("slide regions reflow into one reading column on narrow screens @mobile", async ({ page }) => {
  await signIn(page);
  const presentationId = await createPresentation(page);
  const initial = await page.request.get(`${apiUrl}/v1/presentations/${presentationId}`);
  expect(initial.status()).toBe(200);
  const record = (await initial.json()).presentation;
  const textElements = [
    {
      id: randomUUID(),
      role: "title",
      text: "AudienceTakeaway".repeat(11).slice(0, 160),
      region: "bottom_left",
      order: 0,
    },
    ...Array.from({ length: 7 }, (_, index) => ({
      id: randomUUID(),
      role: "body",
      text:
        index === 0
          ? "Review the evidence before making a decision. ".repeat(95).slice(0, 4_000)
          : `Reading step ${index + 1}: Discuss the audience's next action.`,
      region: index < 3 ? "top_right" : index < 6 ? "middle_left" : "bottom_right",
      order: index % 3,
    })),
  ];
  const saved = await page.request.put(`${apiUrl}/v1/presentations/${presentationId}/draft`, {
    data: {
      draft: {
        ...record.draft,
        blocks: [{ ...record.draft.blocks[0], textElements }],
      },
      expectedRevision: record.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(saved.status()).toBe(200);
  await page.goto(`/presentation/${presentationId}`);
  await page.getByRole("button", { name: "Hide inspector" }).click();
  await page.getByRole("button", { name: "Collapse map" }).click();
  const slide = page.locator("#presentation-canvas [data-layout]");
  await expect(slide).toBeVisible();
  await expect
    .poll(() =>
      slide
        .locator("[data-region]")
        .first()
        .evaluate((region) => {
          const container = region.parentElement;
          return container
            ? getComputedStyle(container).gridTemplateColumns.trim().split(/\s+/).length
            : 0;
        }),
    )
    .toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const expected = [...textElements.slice(1, 7), textElements[0]!, textElements[7]!].map(
    ({ region, text }) => ({ region, text }),
  );
  expect((await renderedArrangement(slide)).map(({ region, text }) => ({ region, text }))).toEqual(
    expected,
  );
  await expectReadableSlide(slide, true);
  await expectAccessibleSlide(page);
  // Preview is hidden in the compact toolbar; open it at a wider width, then reflow it.
  await page.setViewportSize({ width: 900, height: 844 });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const previewSlide = page
    .getByRole("dialog", { name: "Presentation preview" })
    .locator("article[data-layout]");
  expect(
    (await renderedArrangement(previewSlide)).map(({ region, text }) => ({ region, text })),
  ).toEqual(expected);
  await expectReadableSlide(previewSlide, true);
  await expectAccessibleSlide(page);
});

test("cached v1 recovery slides restore and autosave as v2", async ({ page }) => {
  await signIn(page);
  const presentationId = await createPresentation(page);
  const initial = await page.request.get(`${apiUrl}/v1/presentations/${presentationId}`);
  expect(initial.ok()).toBeTruthy();
  const record = (await initial.json()).presentation;
  const slideId = record.draft.blocks[0].id;
  const legacyDraft = {
    ...record.draft,
    schemaVersion: 1,
    blocks: [
      {
        id: slideId,
        kind: "content",
        layout: "quote",
        title: "Recovered local title",
        body: "These edits were saved locally before the layout upgrade.",
        mediaId: null,
        mediaAlt: null,
        speakerNotes: "Preserve the local facilitator note.",
        citations: [{ locator: "Page 2", excerpt: "Source excerpt" }],
      },
    ],
  };
  await page.evaluate(
    (snapshot) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("openround-builder-recovery", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("drafts")) {
            request.result.createObjectStore("drafts", { keyPath: "key" });
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("drafts", "readwrite");
          transaction.objectStore("drafts").put(snapshot);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error);
          };
        };
      }),
    {
      key: `presentation:${presentationId}`,
      revision: record.draftRevision,
      savedAt: new Date().toISOString(),
      draft: legacyDraft,
    },
  );

  await page.goto(`/presentation/${presentationId}`);
  const savedResponse = page.waitForResponse(
    (response) =>
      response.url() === `${apiUrl}/v1/presentations/${presentationId}/draft` &&
      response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Restore local copy", exact: true }).click();
  const canvas = page.locator("#presentation-canvas");
  await expect(canvas.getByLabel("Slide title", { exact: true })).toHaveValue(
    legacyDraft.blocks[0]!.title,
  );
  await expect(canvas.getByLabel("Text box 1", { exact: true })).toHaveValue(
    legacyDraft.blocks[0]!.body,
  );
  const saved = await savedResponse;
  expect(saved.status()).toBe(200);
  expect((await saved.json()).presentation.draft).toMatchObject({
    schemaVersion: 2,
    blocks: [
      {
        id: slideId,
        layout: "quote",
        speakerNotes: legacyDraft.blocks[0]!.speakerNotes,
        citations: legacyDraft.blocks[0]!.citations,
        textElements: [
          { id: `${slideId}:title`, role: "title", text: legacyDraft.blocks[0]!.title },
          { id: `${slideId}:body`, role: "body", text: legacyDraft.blocks[0]!.body },
        ],
      },
    ],
  });
  await expect(page.getByRole("button", { name: "Restore local copy", exact: true })).toHaveCount(
    0,
  );
});
