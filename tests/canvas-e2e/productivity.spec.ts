import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, organization, snapshot, fits } from "./support";

test("templates support atomic grouping, frame layout, locks, links and drawing", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await organization(page, testInfo);
  await page.goto("/boards");
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await page.getByRole("button", { name: "Team canvas", exact: true }).click();
  await page.getByRole("button", { name: /Possibility map/ }).click();
  await expect(page.getByRole("region", { name: "Starter preview", exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Board title", exact: true })
    .fill("Productive planning map");
  await page.getByRole("button", { name: "Create board", exact: true }).click();
  await expect(page).toHaveURL(/\/canvas\/[0-9a-f-]+$/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  const initial = await snapshot(page, id);
  expect(initial.schemaVersion).toBe(2);
  expect(initial.objects.length).toBeGreaterThan(10);
  const frames = initial.objects.filter((object) => object.type === "frame");
  expect(frames.length).toBeGreaterThanOrEqual(3);
  const notes = initial.objects
    .filter((object) => object.type === "sticky" && object.parentId === frames[0]!.id)
    .slice(0, 2);
  expect(notes).toHaveLength(2);
  for (const note of notes)
    await page.getByRole("checkbox", { name: `Select ${note.text}`, exact: true }).check();
  await page.getByRole("button", { name: "Group selection", exact: true }).click();
  await expect
    .poll(async () => {
      const objects = (await snapshot(page, id)).objects.filter((object) =>
        notes.some((note) => note.id === object.id),
      );
      return Boolean(
        objects[0]?.geometricGroupId &&
        objects[0].geometricGroupId === objects[1]?.geometricGroupId,
      );
    })
    .toBe(true);
  await page.getByRole("button", { name: "Lock selection", exact: true }).click();
  await expect
    .poll(async () =>
      (await snapshot(page, id)).objects
        .filter((object) => notes.some((note) => note.id === object.id))
        .every((object) => object.locked),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Unlock selection", exact: true }).click();
  await expect
    .poll(async () =>
      (await snapshot(page, id)).objects
        .filter((object) => notes.some((note) => note.id === object.id))
        .every((object) => !object.locked),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Frame selection", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page, id)).objects.filter((object) => object.type === "frame").length,
    )
    .toBe(frames.length + 1);
  const wrapped = await snapshot(page, id);
  const frame = wrapped.objects.find(
    (object) => object.type === "frame" && !frames.some((item) => item.id === object.id),
  )!;
  expect(
    wrapped.objects
      .filter((object) => notes.some((note) => note.id === object.id))
      .every((object) => object.parentId === frame.id),
  ).toBe(true);
  await page.getByRole("checkbox", { name: `Select ${frame.text}`, exact: true }).check();
  await page
    .locator("summary")
    .filter({ hasText: /^Move selection$/ })
    .click();
  await page.getByRole("spinbutton", { name: "Horizontal move", exact: true }).fill("80");
  await page.getByRole("spinbutton", { name: "Vertical move", exact: true }).fill("40");
  await page.getByRole("button", { name: "Move selection", exact: true }).click();
  await expect
    .poll(
      async () => (await snapshot(page, id)).objects.find((object) => object.id === frame.id)?.x,
    )
    .toBe(frame.x + 80);
  const moved = await snapshot(page, id);
  for (const object of wrapped.objects.filter(
    (object) => object.id === frame.id || object.parentId === frame.id,
  )) {
    expect(moved.objects.find((item) => item.id === object.id)).toMatchObject({
      x: object.x + 80,
      y: object.y + 40,
    });
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () => (await snapshot(page, id)).objects.find((object) => object.id === frame.id)?.x,
    )
    .toBe(frame.x);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(
      async () => (await snapshot(page, id)).objects.find((object) => object.id === frame.id)?.x,
    )
    .toBe(frame.x + 80);
  await page.getByRole("button", { name: "Link", exact: true }).click();
  const link = page.getByRole("dialog", { name: "Add link", exact: true });
  await link
    .getByRole("textbox", { name: "Link URL", exact: true })
    .fill("https://docs.example.test/guide?topic=canvas");
  await link.getByRole("textbox", { name: "Link label", exact: true }).fill("Workshop guide");
  await link.getByRole("button", { name: "Add link", exact: true }).click();
  await expect(link).toHaveCount(0);
  await expect
    .poll(async () =>
      (await snapshot(page, id)).objects.some(
        (object) => object.type === "link" && object.text === "Workshop guide",
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Freehand", exact: true }).click();
  const box = (await page.getByTestId("canvas-surface").boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 45);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 80, { steps: 3 });
  await page.mouse.move(box.x + 130, box.y + 65, { steps: 3 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await snapshot(page, id)).objects.filter((object) => object.type === "pen").length,
    )
    .toBe(1);
  for (const mode of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: mode });
    await fits(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`productivity-${mode}.png`) });
  }
  await page.reload();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  expect((await snapshot(page, id)).objects.some((object) => object.type === "pen")).toBe(true);
});

test("guided starters publish authored scaffolding while keeping guest intake private", async ({
  page: owner,
}, testInfo) => {
  test.setTimeout(180_000);
  await organization(owner, testInfo);
  await owner.goto("/boards");
  await owner.getByRole("button", { name: "New board", exact: true }).click();
  await owner.getByRole("button", { name: "Guided workshop", exact: true }).click();
  await owner.getByRole("button", { name: /Learning reflection/ }).click();
  await owner.getByRole("textbox", { name: "Board title", exact: true }).fill("Learning together");
  await owner.getByRole("button", { name: "Create board", exact: true }).click();
  await expect(owner).toHaveURL(/\/canvas\/[0-9a-f-]+$/);
  const id = new URL(owner.url()).pathname.split("/").at(-1)!;
  const board = await snapshot(owner, id);
  expect(board.boardType).toBe("workshop");
  expect(board.sourceBoard?.ideasVisible).toBe(false);
  expect(board.objects.length).toBeGreaterThan(10);
  await owner.getByRole("button", { name: "Open collection", exact: true }).click();
  const imageData = await owner.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 30;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#146b56";
    context.fillRect(0, 0, 40, 30);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  const uploads: Array<Promise<Record<string, string>>> = [];
  owner.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/__test/canvas/storage/"))
      uploads.push(request.allHeaders());
  });
  await owner.getByRole("button", { name: "Image", exact: true }).click();
  const upload = owner.getByRole("dialog", { name: "Add image", exact: true });
  await upload.getByLabel("Choose an image", { exact: true }).setInputFiles({
    name: "workshop.png",
    mimeType: "image/png",
    buffer: Buffer.from(imageData, "base64"),
  });
  await upload
    .getByRole("textbox", { name: "Image description", exact: true })
    .fill("Workshop sketch");
  await upload.getByRole("button", { name: "Upload and add", exact: true }).click();
  await expect(upload).toHaveCount(0);
  const image = (await snapshot(owner, id)).objects.find((object) => object.type === "image")!;
  expect(image).toBeTruthy();
  // Deliberately keep creator cookies in this context; guest media requests must omit them.
  const guest = await owner.context().newPage();
  try {
    await guest.goto(`/board/${board.sourceBoardId}`);
    await guest.getByRole("button", { name: "Join board", exact: true }).click();
    const canvas = guest.getByRole("region", { name: "Published canvas", exact: true }).first();
    const heading = board.objects.find((object) => object.type === "frame")!.text;
    await expect(canvas).toContainText(heading);
    await expect(canvas.getByRole("img", { name: "Workshop sketch", exact: true })).toHaveCount(0);
    const imageReads: Array<Promise<Record<string, string>>> = [];
    guest.on("request", (request) => {
      if (new URL(request.url()).pathname.includes("/guest/media/"))
        imageReads.push(request.allHeaders());
    });
    await owner
      .getByRole("combobox", { name: "Guest visibility", exact: true })
      .selectOption("published");
    await owner.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await snapshot(owner, id)).objects.find((object) => object.id === image.id)?.visibility,
      )
      .toBe("published");
    const rendered = canvas.getByRole("img", { name: "Workshop sketch", exact: true });
    await expect(rendered).toBeVisible();
    await canvas.getByRole("button", { name: "Fit board", exact: true }).click();
    await rendered.scrollIntoViewIfNeeded();
    await expect(rendered.locator("image")).toHaveAttribute("href", /^blob:/);
    for (const mode of ["light", "dark"] as const) {
      await guest.emulateMedia({ colorScheme: mode });
      await expect(guest.locator("html")).toHaveAttribute("data-color-mode", mode);
      expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
      await guest.screenshot({ path: testInfo.outputPath(`guest-image-${mode}.png`) });
    }
    await canvas.getByRole("button", { name: "Object outline", exact: true }).click();
    await expect(canvas.getByText("Workshop sketch", { exact: true })).toBeVisible();
    await canvas.getByRole("button", { name: "Object outline", exact: true }).click();
    await rendered.scrollIntoViewIfNeeded();
    await expect(rendered.locator("image")).toHaveAttribute("href", /^blob:/);
    await guest
      .getByRole("textbox", { name: "Your idea", exact: true })
      .fill("A private learning reflection");
    await guest.getByRole("button", { name: "Submit idea", exact: true }).click();
    await expect(guest.getByText("Awaiting review", { exact: true })).toBeVisible();
    await expect(canvas).not.toContainText("A private learning reflection");
    const read = await owner.request.get(`${api}/v1/canvas-boards/${id}`);
    expect(read.ok()).toBe(true);
    const current = (await read.json()).board;
    expect(
      current.sourceBoard.ideas.some(
        (idea: { body: string }) => idea.body === "A private learning reflection",
      ),
    ).toBe(true);
    await owner.getByRole("button", { name: "Delete selected", exact: true }).click();
    await expect(rendered).toHaveCount(0);
    const guestHeaders = await Promise.all(imageReads);
    expect(guestHeaders.length).toBeGreaterThan(0);
    for (const headers of guestHeaders) expect(headers.cookie).toBeUndefined();
    for (const headers of await Promise.all(uploads)) {
      expect(headers.cookie).toBeUndefined();
      expect(headers.authorization).toBeUndefined();
    }
    if (image.type !== "image") throw new Error("Expected uploaded image");
    const denied = await guest.request.get(
      `${api}/v1/canvas-boards/workshop/${board.sourceBoardId}/guest/media/${image.mediaId}`,
      {
        headers: { authorization: guestHeaders[0]!.authorization! },
      },
    );
    expect(denied.status()).toBe(404);
    await owner.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(rendered).toBeVisible();
    await canvas.getByRole("button", { name: "Fit board", exact: true }).click();
    await rendered.scrollIntoViewIfNeeded();
    await expect(rendered.locator("image")).toHaveAttribute("href", /^blob:/);
  } finally {
    await guest.close();
  }
});
