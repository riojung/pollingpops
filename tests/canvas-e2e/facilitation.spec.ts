import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { CanvasBoardView } from "@openround/contracts";
import { api, fits, newTeamCanvas, organization, saveText, snapshot, teammate } from "./support";

async function command(page: Page, boardId: string, value: unknown): Promise<CanvasBoardView> {
  const response = await page.request.post(`${api}/v1/canvas-boards/${boardId}/commands`, {
    data: { schemaVersion: 2, operationId: randomUUID(), command: value },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).board;
}
async function seedObjects(page: Page, boardId: string, objects: Record<string, unknown>[]) {
  return command(page, boardId, {
    type: "batch",
    operations: objects.map((object) => ({
      type: "create",
      object: {
        id: randomUUID(),
        x: 100,
        y: 100,
        width: 240,
        height: 180,
        type: "sticky",
        ...object,
      },
    })),
  });
}
async function selectObject(page: Page, label: string) {
  const outline = page.getByRole("button", { name: "Object outline", exact: true });
  if ((await outline.getAttribute("aria-expanded")) === "false") await outline.click();
  await page.getByRole("button", { name: label, exact: true }).click();
}
async function openFacilitation(page: Page) {
  const toggle = page.getByRole("button", { name: "Facilitation", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  const panel = page.getByRole("region", { name: "Facilitation", exact: true });
  await expect(panel.getByRole("button", { name: "Comments", exact: true })).toBeVisible();
  return panel;
}
async function fitsHorizontally(page: Page, container: Locator) {
  await fits(page);
  const bounds = await container.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      viewport: window.innerWidth,
      content: element.scrollWidth,
      available: element.clientWidth,
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1);
  expect(bounds.content).toBeLessThanOrEqual(bounds.available + 1);
}

test("anchored comments support replies, author edits and resolution while shared viewers remain read-only", async ({
  page: owner,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  await owner.emulateMedia({ reducedMotion: "reduce" });
  const { organizationId } = await organization(owner, testInfo);
  const viewer = await teammate(owner, browser, organizationId, testInfo);
  try {
    const id = await newTeamCanvas(owner);
    await owner.getByRole("button", { name: "Sticky note", exact: true }).click();
    await saveText(owner, "Discuss this practical next step");
    const panel = await openFacilitation(owner);
    await panel.getByRole("button", { name: "Comment on selected object", exact: true }).click();
    await panel
      .getByRole("textbox", { name: "Your draft", exact: true })
      .fill("The first synthetic team comment");
    await panel.getByRole("button", { name: "Post comment", exact: true }).click();
    const thread = panel.getByRole("article");
    await expect(
      thread.getByText("The first synthetic team comment", { exact: true }),
    ).toBeVisible();
    await thread.getByRole("button", { name: "Reply", exact: true }).click();
    await panel
      .getByRole("textbox", { name: "Your draft", exact: true })
      .fill("A useful synthetic reply");
    await panel.getByRole("button", { name: "Post comment", exact: true }).click();
    await expect(thread.getByText("A useful synthetic reply", { exact: true })).toBeVisible();
    await thread.getByRole("button", { name: "Edit", exact: true }).first().click();
    await panel
      .getByRole("textbox", { name: "Your draft", exact: true })
      .fill("The revised synthetic team comment");
    await panel.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(
      thread.getByText("The revised synthetic team comment", { exact: true }),
    ).toBeVisible();
    await expect(thread.getByText("The first synthetic team comment", { exact: true })).toHaveCount(
      0,
    );
    await thread.getByRole("button", { name: "Resolve", exact: true }).click();
    await expect(thread.getByText("Resolved", { exact: true })).toBeVisible();
    await expect(thread.getByRole("button", { name: "Reply", exact: true })).toHaveCount(0);
    await panel
      .getByRole("heading", { name: "Facilitation", exact: true })
      .scrollIntoViewIfNeeded();
    await owner.screenshot({ path: testInfo.outputPath("desktop-facilitation-comments.png") });

    const invitation = await owner.request.post(`${api}/v1/canvas-boards/${id}/invitations`, {
      data: { email: viewer.email, role: "viewer", operationId: randomUUID() },
    });
    expect(invitation.status(), await invitation.text()).toBe(201);
    const accepted = await viewer.page.request.post(
      `${api}/v1/canvas-boards/invitations/${(await invitation.json()).invitation.id}/accept`,
      { data: {} },
    );
    expect(accepted.status(), await accepted.text()).toBe(200);
    await viewer.page.goto(`/canvas/${id}`);
    const readonly = await openFacilitation(viewer.page);
    await expect(
      readonly.getByText("The revised synthetic team comment", { exact: true }),
    ).toBeVisible();
    await expect(readonly.getByText("A useful synthetic reply", { exact: true })).toBeVisible();
    await expect(
      readonly.getByText("You can read comments. Editing requires board permission.", {
        exact: true,
      }),
    ).toBeVisible();
    for (const name of ["Comment on selected object", "Reply", "Edit", "Resolve", "Reopen"])
      await expect(readonly.getByRole("button", { name, exact: true })).toHaveCount(0);
    await readonly.getByRole("button", { name: "Timer", exact: true }).click();
    await expect(readonly.getByRole("button", { name: "Start timer", exact: true })).toHaveCount(0);
    await readonly.getByRole("button", { name: "Saved versions", exact: true }).click();
    await expect(readonly.getByRole("button", { name: "Save version", exact: true })).toHaveCount(
      0,
    );
  } finally {
    await viewer.context.close();
  }
});

test("hidden facilitation retains drafts, navigation protection and the original lost-ack retry", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await organization(page, testInfo);
  let facilitationReads = 0,
    presenterReads = 0;
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && /\/v1\/canvas-boards\/[^/]+\/facilitation$/.test(path))
      facilitationReads++;
    if (request.method() === "GET" && /\/v1\/canvas-boards\/[^/]+\/presenter$/.test(path))
      presenterReads++;
    if (request.method() === "POST" && path.endsWith("/facilitation/commands"))
      writes.push(request.postData()!);
  });
  const id = await newTeamCanvas(page);
  const editorUrl = page.url();
  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  await saveText(page, "Keep this anchored discussion");
  await expect.poll(() => presenterReads).toBeGreaterThan(0);
  expect(facilitationReads).toBe(0);
  const panel = await openFacilitation(page);
  const toggle = page.getByRole("button", { name: "Facilitation", exact: true });
  const surface = page.getByTestId("canvas-surface");
  await panel.getByRole("button", { name: "Comment on selected object", exact: true }).click();
  const draft = "Retain this unsent synthetic comment across the drawer toggle";
  const versionName = "Retained unsent version name";
  await panel.getByRole("textbox", { name: "Your draft", exact: true }).fill(draft);
  await panel.getByRole("button", { name: "Saved versions", exact: true }).click();
  await panel.getByRole("textbox", { name: "Version name", exact: true }).fill(versionName);
  await page.getByRole("button", { name: "Object outline", exact: true }).click();
  await expect(page.getByRole("button", { name: "Object outline", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  async function hidePanel() {
    const visibleWidth = (await surface.boundingBox())!.width;
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toHaveCount(0);
    const retained = page.locator('section[aria-label="Facilitation"]');
    await expect(retained).toHaveCount(1);
    await expect(retained).not.toBeVisible();
    await expect(retained.locator("xpath=ancestor::aside")).not.toBeVisible();
    await expect
      .poll(async () => (await surface.boundingBox())!.width)
      .toBeGreaterThan(visibleWidth + 100);
    await expect(page.getByRole("textbox", { name: "Your draft", exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Version name", exact: true })).toHaveCount(0);
    await toggle.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeFocused();
    expect(await retained.evaluate((element) => element.contains(document.activeElement))).toBe(
      false,
    );
  }
  await hidePanel();
  let prompt = "";
  page.once("dialog", async (dialog) => {
    prompt = dialog.message();
    await dialog.dismiss();
  });
  await page.getByRole("link", { name: /Idea boards/ }).click();
  expect(prompt).toContain("Changes are not fully saved");
  await expect(page).toHaveURL(editorUrl);
  await expect(page.locator('section[aria-label="Facilitation"]')).not.toBeVisible();
  expect(writes).toEqual([]);
  await toggle.click();
  await expect(panel.getByRole("textbox", { name: "Your draft", exact: true })).toHaveValue(draft);
  await expect(panel.getByRole("textbox", { name: "Version name", exact: true })).toHaveValue(
    versionName,
  );
  expect(writes).toEqual([]);
  await panel.getByRole("textbox", { name: "Version name", exact: true }).fill("");
  await panel.getByRole("button", { name: "Comments", exact: true }).click();

  let droppedAcknowledgement = false;
  await page.route(`${api}/v1/canvas-boards/${id}/facilitation/commands`, async (route) => {
    const response = await route.fetch();
    expect(response.status(), await response.text()).toBe(200);
    if (!droppedAcknowledgement) {
      droppedAcknowledgement = true;
      await route.abort("connectionreset");
    } else await route.fulfill({ response });
  });
  await panel.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Retry saving", exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  await hidePanel();
  await toggle.click();
  await expect(panel.getByRole("textbox", { name: "Your draft", exact: true })).toHaveValue(draft);
  await expect(panel.getByRole("button", { name: "Retry saving", exact: true })).toBeEnabled();
  expect(writes).toHaveLength(1);
  await panel.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Retry saving", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("textbox", { name: "Your draft", exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toBe(writes[0]);
  const original = JSON.parse(writes[0]!) as {
    operationId: string;
    command: { threadId: string; messageId: string };
  };
  expect(JSON.parse(writes[1]!).operationId).toBe(original.operationId);
  const current = await page.request.get(`${api}/v1/canvas-boards/${id}/facilitation`);
  expect(current.status(), await current.text()).toBe(200);
  const facilitation = (await current.json()).facilitation;
  expect(facilitation.threads).toHaveLength(1);
  expect(facilitation.threads[0]).toMatchObject({
    id: original.command.threadId,
    messages: [{ id: original.command.messageId, text: draft }],
  });
  expect(facilitation.threads[0].messages).toHaveLength(1);
  expect(facilitation.versions).toEqual([]);
});

test("saved layouts preserve current text and deletions and export selected-frame SVG and current-view PNG", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await organization(page, testInfo);
  const id = await newTeamCanvas(page);
  const frameId = randomUUID(),
    noteId = randomUUID(),
    removedId = randomUUID(),
    laterId = randomUUID();
  await seedObjects(page, id, [
    { id: frameId, type: "frame", text: "Export frame", x: 100, y: 100, width: 600, height: 400 },
    { id: noteId, text: "Checkpoint text", x: 140, y: 160, width: 200, height: 160 },
    {
      id: removedId,
      type: "rect",
      text: "Removed current shape",
      x: 450,
      y: 180,
      width: 160,
      height: 160,
    },
  ]);
  await page.reload();
  const original = await snapshot(page, id);
  const note = original.objects.find((object) => object.id === noteId)!;
  const removed = original.objects.find((object) => object.id === removedId)!;
  const panel = await openFacilitation(page);
  await panel.getByRole("button", { name: "Saved versions", exact: true }).click();
  await panel.getByRole("textbox", { name: "Version name", exact: true }).fill("Baseline layout");
  await panel.getByRole("button", { name: "Save version", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "Version name", exact: true })).toHaveValue("");
  await expect(panel.getByRole("heading", { name: "Baseline layout", exact: true })).toBeVisible();
  await command(page, id, {
    type: "batch",
    operations: [
      {
        type: "update",
        id: noteId,
        expectedVersion: note.version,
        patch: { x: note.x + 300, y: note.y + 80, text: "New text survives" },
      },
      { type: "delete", id: removedId, expectedVersion: removed.version },
      {
        type: "create",
        object: {
          id: laterId,
          type: "sticky",
          text: "Added later remains",
          x: 300,
          y: 400,
          width: 200,
          height: 160,
        },
      },
    ],
  });
  await expect(page.getByTestId(`canvas-object-${noteId}`)).toContainText("New text survives");
  await expect(page.getByTestId(`canvas-object-${removedId}`)).toHaveCount(0);
  await panel
    .getByRole("listitem")
    .filter({ hasText: "Baseline layout" })
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  const preview = panel.getByRole("region", { name: "Saved version", exact: true });
  await expect(preview.getByText("Checkpoint text", { exact: true })).toBeVisible();
  await expect(preview.getByText("Removed current shape", { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "Restore layout", exact: true }).click();
  await expect
    .poll(async () => {
      const objects = (await snapshot(page, id)).objects;
      const current = objects.find((object) => object.id === noteId);
      return {
        x: current?.x,
        y: current?.y,
        text: current?.text,
        removedPresent: objects.some((object) => object.id === removedId),
        laterText: objects.find((object) => object.id === laterId)?.text,
      };
    })
    .toEqual({
      x: note.x,
      y: note.y,
      text: "New text survives",
      removedPresent: false,
      laterText: "Added later remains",
    });
  await preview.getByRole("button", { name: "Close", exact: true }).click();
  await selectObject(page, "Export frame");
  const openExport = page.getByRole("button", { name: "Export", exact: true });
  await openExport.click();
  const modal = page.getByRole("dialog", { name: "Export board", exact: true });
  await expect(modal.getByRole("combobox", { name: "Area", exact: true })).toBeFocused();
  await modal.getByRole("combobox", { name: "Area", exact: true }).selectOption("frame");
  await modal.getByRole("combobox", { name: "File format", exact: true }).selectOption("svg");
  await page.screenshot({ path: testInfo.outputPath("desktop-export-dialog.png") });
  const svgDownloadPromise = page.waitForEvent("download");
  await modal.getByRole("button", { name: "Download", exact: true }).click();
  const svgDownload = await svgDownloadPromise;
  expect(svgDownload.suggestedFilename()).toBe("idea-board.svg");
  const svgPath = testInfo.outputPath("selected-frame.svg");
  await svgDownload.saveAs(svgPath);
  const svg = await readFile(svgPath, "utf8");
  expect(svg).toContain('viewBox="100 100 600 400"');
  expect(svg).toContain("New text survives");
  expect(svg).not.toContain("Removed current shape");
  expect(svg).not.toMatch(/<foreignObject|<script|<style|href="https?:/);
  await modal.getByRole("combobox", { name: "Area", exact: true }).selectOption("viewport");
  await modal.getByRole("combobox", { name: "File format", exact: true }).selectOption("png");
  const requestPromise = page.waitForRequest(
    (request) =>
      request.url() === `${api}/v1/canvas-boards/${id}/export` && request.method() === "POST",
  );
  const pngDownloadPromise = page.waitForEvent("download");
  await modal.getByRole("button", { name: "Download", exact: true }).click();
  const [pngDownload, request] = await Promise.all([pngDownloadPromise, requestPromise]);
  expect(request.postDataJSON()).toMatchObject({
    schemaVersion: 1,
    format: "svg",
    region: {
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    },
  });
  expect(Object.keys(request.postDataJSON()).sort()).toEqual([
    "background",
    "format",
    "region",
    "schemaVersion",
  ]);
  expect((await request.allHeaders()).cookie).toBeTruthy();
  const pngPath = testInfo.outputPath("current-view.png");
  await pngDownload.saveAs(pngPath);
  const png = await readFile(pngPath);
  expect(pngDownload.suggestedFilename()).toBe("idea-board.png");
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.readUInt32BE(16)).toBeGreaterThan(0);
  expect(png.readUInt32BE(16)).toBeLessThanOrEqual(4096);
  expect(png.readUInt32BE(20)).toBeGreaterThan(0);
  expect(png.readUInt32BE(20)).toBeLessThanOrEqual(4096);
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(openExport).toBeFocused();
});

test("guided guests see the timer and optionally follow published frames with immediate navigation opt-outs and cookie-free extras", async ({
  page: owner,
}, testInfo) => {
  test.setTimeout(180_000);
  await organization(owner, testInfo);
  const source = await owner.request.post(`${api}/v1/idea-boards`, {
    data: {
      schemaVersion: 1,
      idempotencyKey: randomUUID(),
      title: "Facilitated browser workshop",
      moderationEnabled: true,
      ideasVisible: true,
      windowDays: 7,
    },
  });
  expect(source.status(), await source.text()).toBe(201);
  const sourceId = (await source.json()).board.id as string;
  await owner.goto(`/boards/${sourceId}`);
  await owner.getByRole("button", { name: "Add canvas view", exact: true }).click();
  await expect(owner).toHaveURL(/\/canvas\/[0-9a-f-]+$/);
  const id = new URL(owner.url()).pathname.split("/").at(-1)!;
  await owner.getByRole("button", { name: "Open collection", exact: true }).click();
  const firstId = randomUUID(),
    secondId = randomUUID(),
    privateId = randomUUID();
  await seedObjects(owner, id, [
    {
      id: firstId,
      type: "frame",
      text: "Published first frame",
      visibility: "published",
      x: 0,
      y: 0,
      width: 600,
      height: 400,
    },
    {
      id: secondId,
      type: "frame",
      text: "Published next frame",
      visibility: "published",
      x: 1200,
      y: 200,
      width: 600,
      height: 400,
    },
    {
      id: privateId,
      type: "frame",
      text: "Private team frame",
      visibility: "team",
      x: 2600,
      y: 200,
      width: 600,
      height: 400,
    },
  ]);
  await owner.reload();
  const guest = await owner.context().newPage();
  const requests: Array<{ path: string; headers: Promise<Record<string, string>> }> = [];
  guest.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && /\/guest\/(facilitation|presenter)$/.test(path))
      requests.push({ path, headers: request.allHeaders() });
  });
  try {
    await guest.goto(`/board/${sourceId}`);
    await guest.getByRole("button", { name: "Join board", exact: true }).click();
    const published = guest.getByRole("region", { name: "Published canvas", exact: true });
    await expect(published).toBeVisible();
    await expect(guest.getByTestId(`canvas-object-${privateId}`)).toHaveCount(0);
    const panel = await openFacilitation(owner);
    await panel.getByRole("button", { name: "Timer", exact: true }).click();
    await panel.getByRole("spinbutton", { name: "Minutes", exact: true }).fill("2");
    await panel.getByRole("button", { name: "Start timer", exact: true }).click();
    await expect(guest.getByRole("timer", { name: "Workshop timer", exact: true })).toHaveText(
      /^0[12]:\d{2}$/,
    );
    await expect(guest.getByRole("status").filter({ hasText: /^Running$/ })).toBeVisible();
    await panel.getByRole("button", { name: "Pause timer", exact: true }).click();
    await expect(guest.getByRole("status").filter({ hasText: /^Paused$/ })).toBeVisible();
    await expect(guest.getByRole("button", { name: "Start timer", exact: true })).toHaveCount(0);
    await selectObject(owner, "Private team frame");
    await expect(
      owner.getByRole("button", { name: "Present selected frame to guests", exact: true }),
    ).toBeDisabled();
    await owner.getByRole("button", { name: "Present my view", exact: true }).click();
    await expect(
      owner.getByRole("status").filter({ hasText: /^You are presenting$/ }),
    ).toBeVisible();
    await expect(guest.getByRole("button", { name: "Follow presenter", exact: true })).toHaveCount(
      0,
    );
    await owner.getByRole("button", { name: "Stop presenting", exact: true }).click();
    await selectObject(owner, "Published first frame");
    await owner
      .getByRole("button", { name: "Present selected frame to guests", exact: true })
      .click();
    const follow = guest.getByRole("button", { name: "Follow presenter", exact: true });
    await expect(follow).toHaveAttribute("aria-pressed", "false");
    const surface = published.getByTestId("canvas-surface");
    const viewport = surface.locator(":scope > g[transform]");
    const initialView = await viewport.getAttribute("transform");
    await follow.click();
    const stop = guest.getByRole("button", { name: "Stop following", exact: true });
    await expect(stop).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => viewport.getAttribute("transform")).not.toBe(initialView);
    const firstView = await viewport.getAttribute("transform");
    await selectObject(owner, "Published next frame");
    await expect
      .poll(
        async () =>
          (await (await owner.request.get(`${api}/v1/canvas-boards/${id}/presenter`)).json())
            .presenter.frameId,
      )
      .toBe(secondId);
    await expect.poll(() => viewport.getAttribute("transform")).not.toBe(firstView);

    await published.getByRole("button", { name: "Fit board", exact: true }).click();
    await expect(follow).toHaveAttribute("aria-pressed", "false");
    const fittedView = await viewport.getAttribute("transform");
    const nextCue = guest.waitForResponse(
      async (response) =>
        response.url().endsWith(`/guest/presenter`) &&
        response.ok() &&
        (await response.json()).presenter.frameId === firstId,
    );
    await selectObject(owner, "Published first frame");
    await nextCue;
    await expect(viewport).toHaveAttribute("transform", fittedView!);
    await expect(follow).toHaveAttribute("aria-pressed", "false");
    await follow.click();
    await expect(stop).toBeVisible();
    await surface.scrollIntoViewIfNeeded();
    const box = (await surface.boundingBox())!;
    await guest.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 25, { steps: 3 });
    await guest.mouse.up();
    await expect(follow).toHaveAttribute("aria-pressed", "false");
    await follow.click();
    await expect(stop).toBeVisible();
    await guest.bringToFront();
    const wheelTarget = guest.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          document.addEventListener(
            "wheel",
            (event) =>
              resolve(
                event.target instanceof Element &&
                  Boolean(event.target.closest('[data-testid="canvas-surface"]')),
              ),
            { capture: true, once: true },
          );
        }),
    );
    // Keep native input inside the embedded canvas as the page scrolls around its controls.
    await surface.hover();
    await guest.mouse.wheel(0, -120);
    expect(await wheelTarget).toBe(true);
    await expect(follow).toHaveAttribute("aria-pressed", "false");
    await follow.click();
    await expect(stop).toBeVisible();
    await guest.keyboard.press("Escape");
    await expect(follow).toHaveAttribute("aria-pressed", "false");
    expect(requests.some((request) => request.path.endsWith("/facilitation"))).toBe(true);
    expect(requests.some((request) => request.path.endsWith("/presenter"))).toBe(true);
    for (const request of requests) {
      const headers = await request.headers;
      expect(headers.cookie).toBeUndefined();
      expect(headers.authorization).toMatch(/^Bearer [a-f0-9]{64}$/);
    }
  } finally {
    await guest.close();
  }
});

test("@mobile facilitation and export controls fit 320px screens in light and dark themes", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await organization(page, testInfo);
  await page.setViewportSize({ width: 320, height: 844 });
  await newTeamCanvas(page);
  await page.getByRole("button", { name: "Sticky note", exact: true }).tap();
  await saveText(page, "A narrow-screen workshop note");
  const panel = await openFacilitation(page);
  await panel.getByRole("button", { name: "Comment on selected object", exact: true }).tap();
  await panel
    .getByRole("textbox", { name: "Your draft", exact: true })
    .fill("A synthetic comment that wraps within the narrow facilitation panel.");
  await panel.getByRole("button", { name: "Post comment", exact: true }).tap();
  await expect(
    panel.getByText("A synthetic comment that wraps within the narrow facilitation panel.", {
      exact: true,
    }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Saved versions", exact: true }).tap();
  await panel.getByRole("textbox", { name: "Version name", exact: true }).fill("Mobile checkpoint");
  await panel.getByRole("button", { name: "Save version", exact: true }).tap();
  await expect(
    panel.getByRole("heading", { name: "Mobile checkpoint", exact: true }),
  ).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
    await fitsHorizontally(page, panel);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`facilitation-320-${colorScheme}.png`) });
  }
  await page.getByRole("button", { name: "Export", exact: true }).tap();
  const modal = page.getByRole("dialog", { name: "Export board", exact: true });
  await expect(modal.getByRole("combobox", { name: "Area", exact: true })).toBeVisible();
  await expect(modal.getByRole("combobox", { name: "File format", exact: true })).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
    await fitsHorizontally(page, modal);
    const download = await modal
      .getByRole("button", { name: "Download", exact: true })
      .boundingBox();
    expect(download!.width).toBeGreaterThanOrEqual(44);
    expect(download!.height).toBeGreaterThanOrEqual(44);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`export-320-${colorScheme}.png`) });
  }
  await modal.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(modal).toHaveCount(0);
});
