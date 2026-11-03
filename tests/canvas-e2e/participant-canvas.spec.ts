import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
  type TestInfo,
} from "@playwright/test";
import { CANVAS_SCHEMA_VERSION } from "../../packages/contracts/src/canvas-boards";
import {
  IdeaBoardCanvasSchema,
  type IdeaBoardCanvas,
} from "../../packages/contracts/src/idea-board-canvas";
import { participantCanvasCopy } from "../../apps/web/lib/i18n/participant-canvas-messages";
import { canvasToolCopy } from "../../apps/web/lib/i18n/canvas-tool-messages";
import { guidedWorkshopCopy } from "../../apps/web/lib/i18n/guided-workshop-messages";
import { canvasFacilitationCopy } from "../../apps/web/lib/i18n/canvas-facilitation-messages";
import boardCopy from "../../apps/web/lib/i18n/domains/idea-boards/en-CA";
import { api, web, fits, openInspector, organization, snapshot } from "./support";

const copy = participantCanvasCopy("en-CA");
const tools = canvasToolCopy("en-CA");
const guided = guidedWorkshopCopy("en-CA");
const header = (page: Page) => page.locator("main > header");
const editor = (page: Page) => page.getByRole("dialog", { name: copy.title, exact: true });
const palette = (dialog: Locator) =>
  dialog.getByRole("group", { name: tools.toolbar, exact: true });
const mainSurface = (dialog: Locator) =>
  dialog.getByTestId("canvas-surface").filter({ visible: true }).first();
const localObjects = (dialog: Locator) =>
  mainSurface(dialog).locator(
    'g[data-canvas-object]:not([data-canvas-object^="context:"]):not([data-canvas-object^="idea:"])',
  );

async function workshop(owner: Page, testInfo: TestInfo) {
  await owner.emulateMedia({ reducedMotion: "reduce" });
  await organization(owner, testInfo);
  const created = await owner.request.post(`${api}/v1/idea-boards`, {
    data: {
      schemaVersion: 1,
      idempotencyKey: randomUUID(),
      title: "Participant canvas workshop",
      description: "Compose a practical next step",
      moderationEnabled: true,
      ideasVisible: true,
      windowDays: 7,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const sourceId = (await created.json()).board.id as string;
  await owner.goto(`/boards/${sourceId}`);
  await owner.getByRole("button", { name: "Add canvas view", exact: true }).click();
  await expect(owner).toHaveURL(/\/canvas\/[0-9a-f-]+$/);
  const id = new URL(owner.url()).pathname.split("/").at(-1)!;
  await openInspector(owner, "Workshop controls");
  await owner.getByRole("button", { name: "Open collection", exact: true }).click();
  const contextId = randomUUID();
  const seeded = await owner.request.post(`${api}/v1/canvas-boards/${id}/commands`, {
    data: {
      schemaVersion: CANVAS_SCHEMA_VERSION,
      operationId: randomUUID(),
      command: {
        type: "batch",
        operations: [
          {
            type: "create",
            object: {
              id: contextId,
              type: "sticky",
              text: "Shared workshop reference",
              visibility: "published",
              x: 0,
              y: 0,
              width: 240,
              height: 160,
            },
          },
        ],
      },
    },
  });
  expect(seeded.status(), await seeded.text()).toBe(200);
  return { sourceId, id, contextId };
}

async function join(page: Page, sourceId: string) {
  await page.goto(`/board/${sourceId}`);
  await page.getByRole("button", { name: "Join board", exact: true }).click();
  await expect(page.getByRole("region", { name: "Published canvas", exact: true })).toContainText(
    "Shared workshop reference",
  );
  await expect(
    header(page).getByRole("button", { name: copy.startIdea, exact: true }),
  ).toBeEnabled();
}

function observeGuest(page: Page, sourceId: string) {
  const submissions: Array<{
    schemaVersion: 1;
    idempotencyKey: string;
    body: string;
    roundNumber: number;
    canvas: IdeaBoardCanvas;
    attachments?: Array<{ mediaId: string }>;
    links?: Array<{ url: string }>;
  }> = [];
  const canvasWrites: string[] = [];
  const reads: Array<
    Promise<{ headers: Record<string, string> | null; error: unknown; upload: boolean }>
  > = [];
  function capture(request: Request) {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === `/v1/idea-boards/${sourceId}/ideas`)
      submissions.push(request.postDataJSON());
    if (request.method() !== "GET" && /\/v1\/canvas-boards\/[^/]+\/commands$/.test(url.pathname))
      canvasWrites.push(request.url());
    const upload = url.pathname.startsWith("/__test/canvas/storage/");
    if (url.origin === api && (/^\/v1\/(idea-boards|canvas-boards)\//.test(url.pathname) || upload))
      reads.push(
        request.allHeaders().then(
          (headers) => ({ headers, error: null, upload }),
          (error: unknown) => ({ headers: null, error, upload }),
        ),
      );
  }
  page.on("request", capture);
  return {
    submissions,
    canvasWrites,
    async stopAndVerify() {
      page.off("request", capture);
      for (const result of await Promise.all(reads)) {
        expect(result.error, "Guest headers remain readable until verification").toBeNull();
        expect(result.headers!.cookie).toBeUndefined();
        if (result.upload) expect(result.headers!.authorization).toBeUndefined();
      }
      expect(
        canvasWrites,
        "Participant tools never mutate the facilitator's shared canvas",
      ).toEqual([]);
    },
  };
}

async function beginIdea(page: Page, continuing = false) {
  await header(page)
    .getByRole("button", { name: continuing ? copy.continueIdea : copy.startIdea, exact: true })
    .click();
  const dialog = editor(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: copy.ideaTitle, exact: true })).toBeFocused();
  await expect(mainSurface(dialog)).toBeVisible();
  return dialog;
}

async function addText(dialog: Locator, text: string, type = tools.sticky) {
  await palette(dialog).getByRole("button", { name: type, exact: true }).click();
  const input = dialog.getByRole("textbox", { name: tools.editText, exact: true });
  await expect(input).toBeFocused();
  await input.fill(text);
  await dialog.getByRole("button", { name: tools.saveText, exact: true }).click();
  await expect(input).toHaveCount(0);
  return localObjects(dialog).filter({ hasText: text });
}

async function participation(page: Page) {
  const panel = page.getByRole("complementary", { name: guided.participantPanel, exact: true });
  if (!(await panel.isVisible()))
    await header(page)
      .getByRole("button", { name: / — Open participation panel$/ })
      .click();
  await expect(panel).toBeVisible();
  return panel;
}

async function privateImageStatus(page: Page, sourceId: string, mediaId: string) {
  const token = await page.evaluate(
    (id) => localStorage.getItem(`pollingpops:idea-board:${id}`),
    sourceId,
  );
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  return page.request.get(`${api}/v1/idea-boards/${sourceId}/media/${mediaId}/content`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

test("participants compose private native canvas ideas and retain approved geometry across workshop rounds", async ({
  page: owner,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const { sourceId, id, contextId } = await workshop(owner, testInfo);
  // Retain creator cookies deliberately: guest writes and image reads must still omit them.
  const guest = await owner.context().newPage();
  const observer = observeGuest(guest, sourceId);
  const publicContext = await browser.newContext({ baseURL: web, reducedMotion: "reduce" });
  const other = await publicContext.newPage();
  try {
    await join(guest, sourceId);
    await join(other, sourceId);
    const dialog = await beginIdea(guest);
    const note = await addText(dialog, "PRIVATE native planning note");
    const noteId = (await note.getAttribute("data-canvas-object"))!;
    await expect(dialog.getByRole("textbox", { name: copy.ideaTitle, exact: true })).toHaveValue(
      "PRIVATE native planning note",
    );
    const beforeMove = await note.getAttribute("transform");
    const box = (await note.boundingBox())!;
    await guest.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30, { steps: 5 });
    await guest.mouse.up();
    await expect(note).not.toHaveAttribute("transform", beforeMove!);
    const quick = dialog.getByRole("toolbar", { name: copy.tools, exact: true });
    await quick.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(note).toHaveAttribute("transform", beforeMove!);
    await quick.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(note).not.toHaveAttribute("transform", beforeMove!);
    await note.click();
    const beforeWidth = Number(await note.locator("rect").first().getAttribute("width"));
    const handle = (await note.locator("[data-canvas-resize]").boundingBox())!;
    await guest.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2 + 20, {
      steps: 5,
    });
    await guest.mouse.up();
    await expect
      .poll(async () => Number(await note.locator("rect").first().getAttribute("width")))
      .toBeGreaterThan(beforeWidth);
    await addText(dialog, "PRIVATE native text annotation", tools.text);
    const priorIds = await localObjects(dialog).evaluateAll((objects) =>
      objects.map((object) => object.getAttribute("data-canvas-object")),
    );
    await palette(dialog).getByRole("button", { name: tools.rectangle, exact: true }).click();
    await expect(localObjects(dialog)).toHaveCount(3);
    const shapeId = (
      await localObjects(dialog).evaluateAll((objects) =>
        objects.map((object) => object.getAttribute("data-canvas-object")),
      )
    ).find((objectId) => !priorIds.includes(objectId))!;
    const shape = dialog.getByTestId(`canvas-object-${shapeId}`);
    await dialog.getByRole("button", { name: "Fit board", exact: true }).click();
    const source = (await note.boundingBox())!;
    const target = (await shape.boundingBox())!;
    expect(
      source.x + source.width <= target.x ||
        target.x + target.width <= source.x ||
        source.y + source.height <= target.y ||
        target.y + target.height <= source.y,
      "The note and rectangle occupy separate cells before connecting them",
    ).toBe(true);
    await palette(dialog).getByRole("button", { name: tools.select, exact: true }).click();
    await note.click();
    await palette(dialog).getByRole("button", { name: tools.connector, exact: true }).click();
    const sourcePort = dialog.locator(`[data-canvas-object="${noteId}"][data-canvas-port="right"]`);
    await expect(sourcePort).toBeVisible();
    await expect(sourcePort).toBeInViewport({ ratio: 1 });
    const port = (await sourcePort.boundingBox())!;
    await guest.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 6 });
    await guest.mouse.up();
    await expect(localObjects(dialog)).toHaveCount(4);
    await palette(dialog).getByRole("button", { name: tools.pen, exact: true }).click();
    const surface = mainSurface(dialog);
    const stage = (await surface.boundingBox())!;
    await guest.mouse.move(stage.x + 80, stage.y + stage.height * 0.7);
    await guest.mouse.down();
    await guest.mouse.move(stage.x + 115, stage.y + stage.height * 0.7 + 15, { steps: 4 });
    await guest.mouse.move(stage.x + 145, stage.y + stage.height * 0.7, { steps: 4 });
    await guest.mouse.up();
    await expect(localObjects(dialog)).toHaveCount(5);

    const png = await guest.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 40;
      canvas.height = 30;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#146b56";
      context.fillRect(0, 0, 40, 30);
      return canvas.toDataURL("image/png").split(",")[1]!;
    });
    await quick.getByRole("button", { name: copy.addImage, exact: true }).click();
    const imageDialog = guest.getByRole("dialog", { name: copy.addImage, exact: true });
    await imageDialog
      .getByRole("textbox", { name: "Image description", exact: true })
      .fill("PRIVATE participant image");
    await imageDialog.getByLabel("Choose image", { exact: true }).setInputFiles({
      name: "participant.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    const [ticket] = await Promise.all([
      guest.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url() === `${api}/v1/idea-boards/${sourceId}/media` &&
          response.status() === 201,
      ),
      imageDialog.getByRole("button", { name: copy.addToCanvas, exact: true }).click(),
    ]);
    const mediaId = (await ticket.json()).mediaId as string;
    await expect(imageDialog).toHaveCount(0);
    await dialog.getByRole("button", { name: "Fit board", exact: true }).click();
    await expect(
      dialog.getByRole("img", { name: "PRIVATE participant image", exact: true }),
    ).toBeVisible();
    await quick.getByRole("button", { name: copy.addLink, exact: true }).click();
    const linkDialog = guest.getByRole("dialog", { name: copy.addLink, exact: true });
    await linkDialog
      .getByRole("textbox", { name: "Website or social post URL", exact: true })
      .fill("https://example.test/participant-proposal");
    await linkDialog
      .getByRole("textbox", { name: "Link caption (optional)", exact: true })
      .fill("PRIVATE proposal reference");
    await linkDialog.getByRole("button", { name: copy.addToCanvas, exact: true }).click();
    await expect(linkDialog).toHaveCount(0);
    await expect(localObjects(dialog)).toHaveCount(7);
    const linkId = (await localObjects(dialog)
      .filter({ hasText: "PRIVATE proposal reference" })
      .getAttribute("data-canvas-object"))!;
    await dialog
      .getByRole("button", {
        name: `${canvasFacilitationCopy("en-CA").edit}: ${boardCopy["boards.addLink"]}`,
        exact: true,
      })
      .click();
    const editLinkDialog = guest.getByRole("dialog", {
      name: `${canvasFacilitationCopy("en-CA").edit}: ${boardCopy["boards.addLink"]}`,
      exact: true,
    });
    await expect(
      editLinkDialog.getByRole("textbox", { name: "Website or social post URL", exact: true }),
    ).toHaveValue("https://example.test/participant-proposal");
    await editLinkDialog
      .getByRole("textbox", { name: "Website or social post URL", exact: true })
      .fill("https://example.test/corrected-proposal");
    await editLinkDialog
      .getByRole("textbox", { name: "Link caption (optional)", exact: true })
      .fill("PRIVATE corrected proposal reference");
    await editLinkDialog.getByRole("button", { name: copy.saveLink, exact: true }).click();
    await expect(editLinkDialog).toHaveCount(0);
    await expect(dialog.getByTestId(`canvas-object-${linkId}`)).toContainText(
      "PRIVATE corrected proposal reference",
    );
    await expect(localObjects(dialog)).toHaveCount(7);
    await dialog
      .getByRole("textbox", { name: copy.ideaTitle, exact: true })
      .fill("Participant's spatial proposal");
    await dialog.getByRole("button", { name: "Fit board", exact: true }).click();
    await expect
      .poll(async () => (await new AxeBuilder({ page: guest }).analyze()).violations)
      .toEqual([]);
    await guest.screenshot({ path: testInfo.outputPath("participant-private-canvas-desktop.png") });
    await dialog.getByRole("button", { name: copy.backToWorkshop, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      header(guest).getByRole("button", { name: copy.continueIdea, exact: true }),
    ).toBeFocused();
    expect(observer.submissions).toEqual([]);
    expect((await snapshot(owner, id)).sourceBoard?.totalIdeas).toBe(0);
    await expect(other.getByText("PRIVATE native planning note", { exact: true })).toHaveCount(0);
    expect((await privateImageStatus(other, sourceId, mediaId)).status()).toBe(404);

    await beginIdea(guest, true);
    await expect(localObjects(dialog)).toHaveCount(7);
    const [submitted] = await Promise.all([
      guest.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url() === `${api}/v1/idea-boards/${sourceId}/ideas`,
      ),
      dialog.getByRole("button", { name: copy.submitIdea, exact: true }).click(),
    ]);
    expect(submitted.status(), await submitted.text()).toBe(200);
    await expect(dialog).toHaveCount(0);
    expect(observer.submissions).toHaveLength(1);
    const payload = observer.submissions[0]!;
    const canvas = IdeaBoardCanvasSchema.parse(payload.canvas);
    expect(payload).toMatchObject({
      schemaVersion: 1,
      idempotencyKey: expect.any(String),
      body: "Participant's spatial proposal",
      roundNumber: 1,
      attachments: [{ mediaId }],
      links: [{ url: "https://example.test/corrected-proposal" }],
    });
    expect(new Set(canvas.objects.map((object) => object.type))).toEqual(
      new Set(["sticky", "text", "rect", "connector", "pen", "image", "link"]),
    );
    expect(canvas.objects.find((object) => object.id === noteId)?.width).toBeGreaterThan(
      beforeWidth,
    );
    expect(canvas.objects.find((object) => object.id === linkId)).toMatchObject({
      type: "link",
      url: "https://example.test/corrected-proposal",
      text: "PRIVATE corrected proposal reference",
    });
    expect(
      canvas.objects.some((object) => object.id === contextId || object.id.startsWith("context:")),
    ).toBe(false);
    for (const object of canvas.objects) {
      expect(object).not.toHaveProperty("visibility");
      expect(object).not.toHaveProperty("version");
    }
    const pending = (await snapshot(owner, id)).sourceBoard!.ideas[0]!;
    expect(pending).toMatchObject({ status: "pending", canvas });
    await expect(
      (await participation(guest)).getByText("Awaiting review", { exact: true }),
    ).toBeVisible();
    await expect(other.getByText("PRIVATE native planning note", { exact: true })).toHaveCount(0);
    expect((await privateImageStatus(other, sourceId, mediaId)).status()).toBe(404);
    await openInspector(owner, "Workshop controls");
    await owner
      .getByRole("listitem")
      .filter({ hasText: "Participant's spatial proposal" })
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    await expect
      .poll(async () => (await snapshot(owner, id)).sourceBoard!.ideas[0]?.status)
      .toBe("approved");
    const published = await snapshot(owner, id);
    expect(published.objects).toHaveLength(2);
    expect(published.objects.find((object) => object.type === "idea_ref")).toMatchObject({
      id: pending.id,
      x: canvas.x,
      y: canvas.y,
      width: canvas.width,
      height: canvas.height,
      idea: { canvas },
    });
    const protectedScene = other.getByTestId(`canvas-object-${pending.id}`);
    await expect(protectedScene).toContainText("PRIVATE native planning note");
    await expect(
      protectedScene.getByTestId(`canvas-object-idea:${pending.id}:${noteId}`),
    ).toHaveCount(1);
    expect((await privateImageStatus(other, sourceId, mediaId)).status()).toBe(200);
    await expect(other.getByRole("button", { name: tools.saveText, exact: true })).toHaveCount(0);

    await owner.getByRole("button", { name: "Start voting", exact: true }).click();
    const panel = await participation(guest);
    await panel
      .getByRole("checkbox", { name: "Participant's spatial proposal", exact: true })
      .check();
    await panel.getByRole("button", { name: "Submit votes", exact: true }).click();
    await expect(
      panel.getByText("Your votes are saved. Your ballot cannot be changed.", { exact: true }),
    ).toBeVisible();
    await owner.getByRole("button", { name: "Close board", exact: true }).click();
    await owner.getByRole("button", { name: guided.reopenCollection, exact: true }).click();
    const reopen = owner.getByRole("dialog", { name: guided.reopenTitle, exact: true });
    await expect(
      reopen.getByRole("combobox", { name: guided.reopenWindow, exact: true }),
    ).toHaveValue("7");
    await reopen.getByRole("button", { name: guided.confirmReopen, exact: true }).click();
    await expect(reopen).toHaveCount(0);
    await expect(header(guest).getByText("Round 2", { exact: true })).toBeVisible();
    const second = await beginIdea(guest);
    await addText(second, "PRIVATE second-round canvas idea");
    const [roundTwo] = await Promise.all([
      guest.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url() === `${api}/v1/idea-boards/${sourceId}/ideas`,
      ),
      second.getByRole("button", { name: copy.submitIdea, exact: true }).click(),
    ]);
    expect(roundTwo.status(), await roundTwo.text()).toBe(200);
    expect(observer.submissions).toHaveLength(2);
    expect(observer.submissions[1]).toMatchObject({
      roundNumber: 2,
      body: "PRIVATE second-round canvas idea",
    });
    expect(observer.submissions[1]!.canvas.objects).toHaveLength(1);
    const retained = (await snapshot(owner, id)).sourceBoard!;
    expect(retained).toMatchObject({
      roundNumber: 2,
      totalIdeas: 2,
      roundHistory: [{ ballotCount: 1, results: [{ ideaId: pending.id, voteCount: 1 }] }],
    });
    expect(retained.ideas.find((idea) => idea.id === pending.id)?.canvas).toEqual(canvas);
    await expect(other.getByText("PRIVATE second-round canvas idea", { exact: true })).toHaveCount(
      0,
    );
    await expect(protectedScene).toContainText("PRIVATE native planning note");
  } finally {
    try {
      await observer.stopAndVerify();
    } finally {
      await Promise.all([guest.close(), publicContext.close()]);
    }
  }
});

for (const prefix of ["", "@mobile "]) {
  test(`${prefix}large idea previews keep fit and navigation zoom limits consistent`, async ({
    page: owner,
    browserName,
  }, testInfo) => {
    const { sourceId } = await workshop(owner, testInfo);
    const guest = await owner.context().newPage();
    try {
      if (prefix) await guest.setViewportSize({ width: 320, height: 844 });
      await join(guest, sourceId);
      const token = await guest.evaluate(
        (id) => localStorage.getItem(`pollingpops:idea-board:${id}`),
        sourceId,
      );
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      const submitted = await guest.request.post(`${api}/v1/idea-boards/${sourceId}/ideas`, {
        headers: { authorization: `Bearer ${token}`, cookie: "" },
        data: {
          schemaVersion: 1,
          idempotencyKey: randomUUID(),
          roundNumber: 1,
          body: "Large private idea preview",
          canvas: {
            schemaVersion: 1,
            x: 0,
            y: 0,
            width: 10_000,
            height: 10_000,
            objects: [
              {
                id: randomUUID(),
                type: "frame",
                x: 0,
                y: 0,
                width: 10_000,
                height: 10_000,
                text: "Full composition",
              },
            ],
          },
        },
      });
      expect(submitted.status(), await submitted.text()).toBe(200);
      await guest.reload();
      await expect(
        guest.getByRole("region", { name: "Published canvas", exact: true }),
      ).toBeVisible();
      await expect(
        header(guest).getByRole("button", { name: copy.startIdea, exact: true }),
      ).toBeVisible();
      const panel = await participation(guest);
      await panel.getByRole("button", { name: copy.openPreview, exact: true }).click();
      const dialog = guest.getByRole("dialog", { name: copy.previewTitle, exact: true });
      const surface = mainSurface(dialog);
      const zoom = async () =>
        Number(
          (await surface.locator(":scope > g").first().getAttribute("transform"))!.match(
            /scale\(([\d.e+-]+)\)/,
          )![1],
        );
      await dialog.getByRole("button", { name: "Fit board", exact: true }).click();
      const fitted = await zoom();
      expect(fitted).toBeGreaterThan(0.005);
      expect(fitted).toBeLessThan(0.15);
      const out = dialog.getByRole("button", { name: guided.zoomOut, exact: true });
      await expect(out).toBeEnabled();
      await out.click();
      await expect.poll(zoom).toBeLessThan(fitted);
      const afterButton = await zoom();
      await surface.focus();
      await surface.press("-");
      await expect.poll(zoom).toBeLessThan(afterButton);
      // Playwright's mobile WebKit transport does not support mouse-wheel events.
      if (!prefix || browserName !== "webkit") {
        const afterKey = await zoom();
        const bounds = (await surface.boundingBox())!;
        await guest.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await guest.mouse.wheel(0, 20);
        await expect.poll(zoom).toBeLessThan(afterKey);
      }
      for (let step = 0; step < 30 && (await out.isEnabled()); step++) await out.click();
      await expect(out).toBeDisabled();
      expect(await zoom()).toBe(0.005);
      await surface.focus();
      await surface.press("-");
      expect(await zoom()).toBe(0.005);
      await dialog.getByRole("button", { name: guided.zoomIn, exact: true }).click();
      await expect.poll(zoom).toBeGreaterThan(0.005);
      await expect
        .poll(async () => (await new AxeBuilder({ page: guest }).analyze()).violations)
        .toEqual([]);
      await dialog.getByRole("button", { name: tools.close, exact: true }).click();
      await expect(dialog).toHaveCount(0);
    } finally {
      await guest.close();
    }
  });
}

test("private canvas submission retries the exact unknown-outcome intent inside the editor", async ({
  page: owner,
}, testInfo) => {
  const { sourceId, id } = await workshop(owner, testInfo);
  const guest = await owner.context().newPage();
  const observer = observeGuest(guest, sourceId);
  const posts: string[] = [];
  let releaseFirst = () => {};
  const firstResponse = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await guest.route(`${api}/v1/idea-boards/${sourceId}/ideas`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts.push(route.request().postData()!);
    if (posts.length === 1) {
      await firstResponse;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "access-control-allow-origin": web, "access-control-allow-credentials": "true" },
        body: JSON.stringify({
          error: { code: "UNAVAILABLE", message: "Synthetic uncommitted submission outage" },
        }),
      });
    } else await route.continue();
  });
  try {
    await join(guest, sourceId);
    const dialog = await beginIdea(guest);
    await addText(dialog, "PRIVATE retry-safe canvas idea");
    const title = dialog.getByRole("textbox", { name: copy.ideaTitle, exact: true });
    const sticky = palette(dialog).getByRole("button", { name: tools.sticky, exact: true });
    await dialog.getByRole("button", { name: copy.submitIdea, exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    await expect(title).toBeDisabled();
    await expect(sticky).toBeDisabled();
    await expect(dialog.getByRole("status").filter({ hasText: copy.submitting })).toBeVisible();
    await expect(dialog.getByText(copy.canvasFrozen, { exact: true })).toHaveCount(0);
    releaseFirst();
    const retry = dialog.getByRole("button", { name: boardCopy["boards.retry"], exact: true });
    await expect(dialog.getByRole("alert")).toContainText(boardCopy["boards.error"]);
    await expect(retry).toBeEnabled();
    await expect(title).toHaveValue("PRIVATE retry-safe canvas idea");
    await expect(title).toBeDisabled();
    await expect(sticky).toBeDisabled();
    await expect(
      localObjects(dialog).filter({ hasText: "PRIVATE retry-safe canvas idea" }),
    ).toHaveCount(1);
    expect((await snapshot(owner, id)).sourceBoard?.totalIdeas).toBe(0);
    const [accepted] = await Promise.all([
      guest.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url() === `${api}/v1/idea-boards/${sourceId}/ideas`,
      ),
      retry.click(),
    ]);
    expect(accepted.status(), await accepted.text()).toBe(200);
    await expect(dialog).toHaveCount(0);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toBe(posts[0]);
    const payload = JSON.parse(posts[0]!);
    expect(payload).toMatchObject({
      schemaVersion: 1,
      idempotencyKey: expect.any(String),
      roundNumber: 1,
      body: "PRIVATE retry-safe canvas idea",
    });
    const canvas = IdeaBoardCanvasSchema.parse(payload.canvas);
    expect(canvas.objects).toHaveLength(1);
    expect(observer.submissions).toHaveLength(2);
    const current = (await snapshot(owner, id)).sourceBoard!;
    expect(current.totalIdeas).toBe(1);
    expect(current.ideas[0]).toMatchObject({ status: "pending", body: payload.body, canvas });
  } finally {
    releaseFirst();
    try {
      await guest.unrouteAll({ behavior: "wait" });
      await observer.stopAndVerify();
    } finally {
      await guest.close();
    }
  }
});

test("@mobile private participant canvas keeps native tools and drafts accessible at 320 and 390 pixels", async ({
  page: owner,
  browserName,
}, testInfo) => {
  const { sourceId, id } = await workshop(owner, testInfo);
  const guest = await owner.context().newPage();
  const observer = observeGuest(guest, sourceId);
  try {
    await guest.setViewportSize({ width: 320, height: 844 });
    await join(guest, sourceId);
    const dialog = await beginIdea(guest);
    await addText(dialog, "PRIVATE mobile canvas draft");
    await dialog.getByRole("button", { name: "Fit board", exact: true }).tap();
    const zoom = dialog.getByRole("button", { name: /^\d+% — Reset zoom$/ });
    const beforeZoom = await zoom.textContent();
    await dialog.getByRole("button", { name: guided.zoomOut, exact: true }).tap();
    await expect(zoom).not.toHaveText(beforeZoom!);
    await palette(dialog).getByRole("button", { name: tools.pan, exact: true }).tap();
    const surface = mainSurface(dialog);
    const transform = surface.locator(":scope > g").first();
    const beforePan = await transform.getAttribute("transform");
    const bounds = (await surface.boundingBox())!;
    const x = bounds.x + bounds.width / 2,
      y = bounds.y + bounds.height * 0.55;
    if (browserName === "chromium") {
      const touch = await guest.context().newCDPSession(guest);
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, id: 1 }],
      });
      try {
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + 35, y: y + 20, id: 1 }],
        });
        await expect(transform).not.toHaveAttribute("transform", beforePan!);
      } finally {
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await touch.detach();
      }
    } else {
      await guest.mouse.move(x, y);
      await guest.mouse.down();
      await guest.mouse.move(x + 35, y + 20, { steps: 4 });
      await guest.mouse.up();
      await expect(transform).not.toHaveAttribute("transform", beforePan!);
    }
    for (const width of [320, 390]) {
      await guest.setViewportSize({ width, height: 844 });
      await dialog.getByRole("button", { name: "Fit board", exact: true }).tap();
      for (const colorScheme of ["light", "dark"] as const) {
        await guest.emulateMedia({ colorScheme });
        await expect(guest.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
        await fits(guest);
        await expect
          .poll(() =>
            dialog.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              return (
                bounds.x === 0 &&
                bounds.y === 0 &&
                Math.abs(bounds.width - innerWidth) <= 1 &&
                Math.abs(bounds.height - innerHeight) <= 1 &&
                element.scrollWidth <= element.clientWidth + 1
              );
            }),
          )
          .toBe(true);
        await expect(
          dialog.getByRole("button", { name: copy.submitIdea, exact: true }),
        ).toBeInViewport({ ratio: 1 });
        await expect(
          dialog.getByRole("textbox", { name: copy.ideaTitle, exact: true }),
        ).toHaveValue("PRIVATE mobile canvas draft");
        await expect
          .poll(async () => (await new AxeBuilder({ page: guest }).analyze()).violations)
          .toEqual([]);
        await guest.screenshot({
          path: testInfo.outputPath(`participant-private-canvas-${width}-${colorScheme}.png`),
        });
      }
    }
    await dialog.getByRole("button", { name: copy.backToWorkshop, exact: true }).tap();
    await expect(dialog).toHaveCount(0);
    await expect(
      header(guest).getByRole("button", { name: copy.continueIdea, exact: true }),
    ).toBeFocused();
    await beginIdea(guest, true);
    await expect(
      localObjects(dialog).filter({ hasText: "PRIVATE mobile canvas draft" }),
    ).toHaveCount(1);
    await dialog.getByRole("button", { name: copy.backToWorkshop, exact: true }).focus();
    await guest.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(observer.submissions).toEqual([]);
    expect((await snapshot(owner, id)).sourceBoard?.totalIdeas).toBe(0);
  } finally {
    try {
      await observer.stopAndVerify();
    } finally {
      await guest.close();
    }
  }
});
