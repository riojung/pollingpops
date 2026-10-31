import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  account,
  api,
  web,
  fits,
  organization,
  teammate,
  snapshot,
  saveText,
  newTeamCanvas,
} from "./support";

test("separate licensed workspaces coauthor a shared board and lose live access after revocation", async ({
  page: owner,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  await owner.emulateMedia({ reducedMotion: "reduce" });
  const { owner: ownerIdentity, organizationId } = await organization(owner, testInfo);
  const editor = await teammate(owner, browser, organizationId, testInfo);
  try {
    expect(editor.identity.creator.workspaceId).not.toBe(ownerIdentity.creator.workspaceId);
    const id = await newTeamCanvas(owner);
    let editorStreams = 0;
    await editor.page.route(`${api}/v1/canvas-boards/${id}/events`, async (route) => {
      editorStreams += 1;
      if (editorStreams === 1) {
        await route.fulfill({
          headers: {
            "content-type": "application/x-ndjson",
            "access-control-allow-origin": web,
            "access-control-allow-credentials": "true",
          },
          body: JSON.stringify({ type: "canvas.ready", boardId: id }) + "\n",
        });
      } else await route.continue();
    });
    await owner.getByRole("button", { name: "Sticky note", exact: true }).click();
    await saveText(owner, "A clear shared outcome");
    const ownerNote = (await snapshot(owner, id)).objects.find(
      (object) => object.text === "A clear shared outcome",
    )!;
    expect(ownerNote).toBeTruthy();

    await owner.getByRole("button", { name: "Share board", exact: true }).click();
    const sharing = owner.getByRole("dialog", { name: "Share board", exact: true });
    await sharing
      .getByRole("textbox", { name: "Teammate's verified email", exact: true })
      .fill(editor.email);
    await sharing.getByRole("combobox", { name: "Board role", exact: true }).selectOption("editor");
    await sharing.getByRole("button", { name: "Invite teammate", exact: true }).click();
    const invitationLink = sharing.getByRole("textbox", { name: "Participant link", exact: true });
    await expect(invitationLink).toHaveValue(/\/canvas\/invitations\//);
    const invitationRow = sharing.getByRole("listitem").filter({ hasText: editor.email });
    await invitationRow.getByRole("button", { name: "Revoke invitation", exact: true }).click();
    await expect(invitationRow).toHaveCount(0);
    await expect(invitationLink).toHaveCount(0);
    await sharing
      .getByRole("textbox", { name: "Teammate's verified email", exact: true })
      .fill(editor.email);
    await sharing.getByRole("button", { name: "Invite teammate", exact: true }).click();
    await expect(invitationLink).toHaveValue(/\/canvas\/invitations\//);
    await editor.page.goto(await invitationLink.inputValue());
    await editor.page.getByRole("button", { name: "Accept board invitation", exact: true }).click();
    await expect(editor.page).toHaveURL(`${web}/canvas/${id}`);
    await expect(editor.page.getByTestId(`canvas-object-${ownerNote.id}`)).toBeVisible();
    expect((await account(editor.page)).creator.workspaceId).toBe(
      editor.identity.creator.workspaceId,
    );
    await expect(editor.page.getByRole("button", { name: "Share board", exact: true })).toHaveCount(
      0,
    );
    await sharing.getByRole("button", { name: "Cancel", exact: true }).click();

    await editor.page.getByRole("button", { name: "Sticky note", exact: true }).click();
    await saveText(editor.page, "A teammate contribution");
    await expect
      .poll(async () =>
        (await snapshot(owner, id)).objects.some(
          (object) => object.text === "A teammate contribution",
        ),
      )
      .toBe(true);
    const editorNote = (await snapshot(owner, id)).objects.find(
      (object) => object.text === "A teammate contribution",
    )!;
    await expect(owner.getByTestId(`canvas-object-${editorNote.id}`)).toBeVisible();
    await expect.poll(() => editorStreams, { timeout: 20_000 }).toBeGreaterThan(1);

    await owner.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await snapshot(owner, id)).objects.find((object) => object.id === ownerNote.id)?.text,
      )
      .toBe("");
    expect(
      (await snapshot(owner, id)).objects.find((object) => object.id === editorNote.id)?.text,
    ).toBe("A teammate contribution");
    await owner.getByRole("button", { name: "Redo", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await snapshot(owner, id)).objects.find((object) => object.id === ownerNote.id)?.text,
      )
      .toBe("A clear shared outcome");

    await owner.getByRole("button", { name: "A clear shared outcome", exact: true }).click();
    await owner.getByRole("textbox", { name: "Text", exact: true }).fill("Owner updates one note");
    await editor.page
      .getByRole("textbox", { name: "Text", exact: true })
      .fill("Editor updates another note");
    await Promise.all([
      owner.getByRole("button", { name: "Save changes", exact: true }).click(),
      editor.page.getByRole("button", { name: "Save changes", exact: true }).click(),
    ]);
    await expect
      .poll(
        async () =>
          (await snapshot(owner, id)).objects.filter((object) =>
            ["Owner updates one note", "Editor updates another note"].includes(object.text),
          ).length,
      )
      .toBe(2);
    await editor.page.getByRole("button", { name: "Owner updates one note", exact: true }).click();
    await editor.page
      .getByRole("textbox", { name: "Text", exact: true })
      .fill("Reviewed teammate text");
    await saveText(owner, "Owner saved first");
    await expect(editor.page.getByTestId(`canvas-object-${ownerNote.id}`)).toContainText(
      "Owner saved first",
    );
    await expect(editor.page.getByRole("textbox", { name: "Text", exact: true })).toHaveValue(
      "Reviewed teammate text",
    );
    await editor.page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(
      editor.page.getByRole("alert").filter({ hasText: "Your change needs review" }),
    ).toBeVisible();
    expect(
      (await snapshot(owner, id)).objects.find((object) => object.id === ownerNote.id)?.text,
    ).toBe("Owner saved first");
    await editor.page.getByRole("button", { name: "Apply reviewed change", exact: true }).click();
    await expect(owner.getByTestId(`canvas-object-${ownerNote.id}`)).toContainText(
      "Reviewed teammate text",
    );
    const retainedDraft = "Keep this unsaved text after a teammate deletes the note";
    await editor.page.getByRole("textbox", { name: "Text", exact: true }).fill(retainedDraft);
    await owner.getByRole("button", { name: "Delete selected", exact: true }).click();
    await expect
      .poll(async () =>
        (await snapshot(owner, id)).objects.some((object) => object.id === ownerNote.id),
      )
      .toBe(false);
    const recovery = editor.page.getByRole("region", {
      name: "Object no longer available",
      exact: true,
    });
    await expect(recovery).toBeVisible();
    await expect(recovery.getByRole("textbox", { name: "Your draft", exact: true })).toHaveValue(
      retainedDraft,
    );
    await expect(
      recovery.getByRole("button", { name: "Copy draft text", exact: true }),
    ).toBeEnabled();
    let leavePrompt = "";
    editor.page.once("dialog", async (dialog) => {
      leavePrompt = dialog.message();
      await dialog.dismiss();
    });
    await editor.page.getByRole("link", { name: /Idea boards/ }).click();
    expect(leavePrompt).toContain("Changes are not fully saved");
    await expect(editor.page).toHaveURL(`${web}/canvas/${id}`);
    await expect(recovery.getByRole("textbox", { name: "Your draft", exact: true })).toHaveValue(
      retainedDraft,
    );
    await recovery.getByRole("button", { name: "Discard my draft", exact: true }).click();
    await expect(recovery).toHaveCount(0);
    await editor.page
      .getByRole("button", { name: "Editor updates another note", exact: true })
      .click();
    await expect(editor.page.getByRole("textbox", { name: "Text", exact: true })).toHaveValue(
      "Editor updates another note",
    );
    expect((await snapshot(owner, id)).objects.some((object) => object.id === ownerNote.id)).toBe(
      false,
    );
    for (const mode of ["light", "dark"] as const) {
      await owner.emulateMedia({ colorScheme: mode });
      await expect(owner.locator("html")).toHaveAttribute("data-color-mode", mode);
      await fits(owner);
      expect((await new AxeBuilder({ page: owner }).analyze()).violations).toEqual([]);
      await owner.screenshot({ path: testInfo.outputPath(`shared-canvas-${mode}.png`) });
    }
    await owner.reload();
    await expect(owner.getByTestId(`canvas-object-${editorNote.id}`)).toContainText(
      "Editor updates another note",
    );
    await owner.getByRole("button", { name: "Share board", exact: true }).click();
    const member = owner
      .getByRole("dialog")
      .getByRole("listitem")
      .filter({ hasText: editor.email });
    await member.getByRole("button", { name: "Revoke board access", exact: true }).click();
    await expect(editor.page.getByTestId("canvas-surface")).toHaveCount(0);
    expect((await editor.page.request.get(`${api}/v1/canvas-boards/${id}`)).status()).toBe(404);
  } finally {
    await editor.context.close();
  }
});

test("guided guests retain private intake and final ballots around the published canvas", async ({
  page: owner,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  await organization(owner, testInfo);
  const created = await owner.request.post(`${api}/v1/idea-boards`, {
    data: {
      schemaVersion: 1,
      idempotencyKey: randomUUID(),
      title: "Guided canvas workshop",
      description: "Choose a practical next step",
      identityMode: "anonymous",
      moderationEnabled: true,
      ideasVisible: true,
      voteBudget: 3,
      windowDays: 7,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const sourceId = (await created.json()).board.id as string;
  await owner.goto(`/boards/${sourceId}`);
  await owner.getByRole("button", { name: "Add canvas view", exact: true }).click();
  await expect(owner).toHaveURL(/\/canvas\/[0-9a-f-]+$/);
  const id = new URL(owner.url()).pathname.split("/").at(-1)!;
  await expect(
    owner.getByRole("button", { name: "Switch workspace and open workshop", exact: true }),
  ).toBeVisible();
  await owner.getByRole("button", { name: "Open collection", exact: true }).click();
  // This page deliberately has creator cookies: every guest read/write must still omit them.
  const guest = await owner.context().newPage();
  const publicContext = await browser.newContext({ baseURL: web });
  const otherGuest = await publicContext.newPage();
  const reads: Array<Promise<Record<string, string>>> = [];
  guest.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/v1\/(idea-boards|canvas-boards)\//.test(path)) reads.push(request.allHeaders());
  });
  try {
    await guest.goto(`/board/${sourceId}`);
    await guest.getByRole("button", { name: "Join board", exact: true }).click();
    await guest
      .getByRole("textbox", { name: "Your idea", exact: true })
      .fill("A protected guest proposal");
    await guest.getByRole("button", { name: "Submit idea", exact: true }).click();
    await expect(guest.getByText("Awaiting review", { exact: true })).toBeVisible();
    await otherGuest.goto(`/board/${sourceId}`);
    await otherGuest.getByRole("button", { name: "Join board", exact: true }).click();
    await expect(otherGuest.getByText("A protected guest proposal", { exact: true })).toHaveCount(
      0,
    );
    await owner.getByRole("button", { name: "Sticky note", exact: true }).click();
    await saveText(owner, "A facilitator canvas instruction");
    await expect(
      otherGuest.getByText("A facilitator canvas instruction", { exact: true }),
    ).toHaveCount(0);
    await owner
      .getByRole("combobox", { name: "Guest visibility", exact: true })
      .selectOption("published");
    await owner.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(
      otherGuest.getByRole("region", { name: "Published canvas", exact: true }).first(),
    ).toContainText("A facilitator canvas instruction");
    const pending = owner.getByRole("listitem").filter({ hasText: "A protected guest proposal" });
    await pending.getByRole("button", { name: "Approve", exact: true }).click();
    const published = otherGuest
      .getByRole("region", { name: "Published canvas", exact: true })
      .first();
    await expect(published).toContainText("A protected guest proposal");
    await expect(otherGuest.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(
      0,
    );
    const card = (await snapshot(owner, id)).objects.find((object) => object.type === "idea_ref")!;
    await owner.getByRole("button", { name: "Start voting", exact: true }).click();
    await expect.poll(async () => (await snapshot(owner, id)).status).toBe("frozen");
    const rejected = await owner.request.post(`${api}/v1/canvas-boards/${id}/commands`, {
      data: {
        schemaVersion: 1,
        operationId: randomUUID(),
        command: {
          type: "batch",
          operations: [
            {
              type: "update",
              id: card.id,
              expectedVersion: card.version,
              patch: { x: card.x + 50 },
            },
          ],
        },
      },
    });
    expect(rejected.status()).toBe(409);
    await guest.getByRole("checkbox").check();
    await guest.getByRole("button", { name: "Submit votes", exact: true }).click();
    await expect(
      guest.getByText("Your votes are saved. Your ballot cannot be changed.", { exact: true }),
    ).toBeVisible();
    await guest.reload();
    await expect(
      guest.getByText("Your votes are saved. Your ballot cannot be changed.", { exact: true }),
    ).toBeVisible();
    await owner.getByRole("button", { name: "Close board", exact: true }).click();
    await expect(guest.getByText("1 votes", { exact: true })).toBeVisible();
    for (const headers of await Promise.all(reads)) expect(headers.cookie).toBeUndefined();
    await owner
      .getByRole("button", { name: "Switch workspace and open workshop", exact: true })
      .click();
    await expect(owner).toHaveURL(`${web}/boards/${sourceId}`);
    await expect(owner.getByRole("button", { name: "Delete board", exact: true })).toBeVisible();
  } finally {
    await publicContext.close();
    await guest.close();
  }
});

test("keyboard editing, composition, connectors and confirmed deletion stay accessible", async ({
  page,
}, testInfo) => {
  await organization(page, testInfo);
  const id = await newTeamCanvas(page);
  await page.getByRole("button", { name: "Sticky note", exact: true }).focus();
  await page.keyboard.press("Enter");
  const text = page.getByRole("textbox", { name: "Text", exact: true });
  await text.dispatchEvent("compositionstart", { data: "共同" });
  await text.fill("共同で計画する — 함께 계획하기");
  await text.dispatchEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, isComposing: true });
  await text.dispatchEvent("compositionend", { data: "共同で計画する — 함께 계획하기" });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  const first = (await snapshot(page, id)).objects[0]!;
  expect(first.text).toBe("共同で計画する — 함께 계획하기");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await snapshot(page, id)).objects[0]?.text).toBe("");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await snapshot(page, id)).objects.length).toBe(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(async () => (await snapshot(page, id)).objects[0]?.text).toBe("");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByTestId(`canvas-object-${first.id}`)).toContainText(first.text);
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByTestId("canvas-surface").focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => (await snapshot(page, id)).objects[0]?.x).toBe(first.x + 10);
  await expect(page.getByRole("button", { name: "Duplicate selected", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Duplicate selected", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await snapshot(page, id)).objects.length).toBe(2);
  const second = (await snapshot(page, id)).objects.find((object) => object.id !== first.id)!;
  await saveText(page, "A connected idea");
  await page.getByRole("button", { name: "Connector", exact: true }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: first.text, exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(
      async () =>
        (await snapshot(page, id)).objects.filter((object) => object.type === "connector").length,
    )
    .toBe(1);
  const connector = (await snapshot(page, id)).objects.find(
    (object) => object.type === "connector",
  )!;
  if (connector.type !== "connector") throw new Error("Expected an anchored connector");
  expect(new Set([connector.from.objectId, connector.to.objectId])).toEqual(
    new Set([first.id, second.id]),
  );
  await page.getByRole("button", { name: "Delete selected", exact: true }).click();
  await expect.poll(async () => (await snapshot(page, id)).objects.length).toBe(2);
  await page.setViewportSize({ width: 640, height: 900 });
  await fits(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete canvas", exact: true }).click();
  await expect(page).toHaveURL(`${web}/boards`);
  expect((await page.request.get(`${api}/v1/canvas-boards/${id}`)).status()).toBe(404);
});

test("library search finds later-page canvases and workshops and resets pagination", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await organization(page, testInfo);
  const seeded = await page.request.post(`${api}/__test/canvas/library`, { data: { count: 51 } });
  expect(seeded.ok(), await seeded.text()).toBe(true);
  const canvases = (await seeded.json()).boards as Array<{ id: string; title: string }>;
  const workshops: Array<{ id: string; title: string }> = [];
  for (let index = 0; index < 51; index++) {
    const workshop = await page.request.post(`${api}/v1/idea-boards`, {
      data: { title: `Workshop ${randomUUID()}`, idempotencyKey: randomUUID() },
    });
    expect(workshop.status(), await workshop.text()).toBe(201);
    workshops.push((await workshop.json()).board);
  }
  const firstCanvases = await (await page.request.get(`${api}/v1/canvas-boards?scope=all`)).json();
  const firstWorkshops = await (await page.request.get(`${api}/v1/idea-boards?limit=50`)).json();
  expect(firstCanvases.boards).toHaveLength(50);
  expect(firstWorkshops.boards).toHaveLength(50);
  const visibleCanvases = new Set(firstCanvases.boards.map((board: { id: string }) => board.id));
  const visibleWorkshops = new Set(firstWorkshops.boards.map((board: { id: string }) => board.id));
  const laterCanvas = canvases.find((board) => !visibleCanvases.has(board.id))!;
  const laterWorkshop = workshops.find((board) => !visibleWorkshops.has(board.id))!;
  const initialTitle = firstCanvases.boards[0].title as string;
  await page.goto("/boards");
  await expect(page.getByRole("link", { name: initialTitle, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: laterCanvas.title, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: laterWorkshop.title, exact: true })).toHaveCount(0);
  const search = page.getByRole("searchbox", { name: "Search boards", exact: true });
  async function find(title: string, endpoint: string) {
    const request = page.waitForRequest((candidate) => {
      const url = new URL(candidate.url());
      return url.pathname === endpoint && url.searchParams.get("search") === title.toUpperCase();
    });
    await search.fill(`  ${title.toUpperCase()}  `);
    expect(new URL((await request).url()).searchParams.has("cursor")).toBe(false);
    await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
  }
  await find(laterCanvas.title, "/v1/canvas-boards");
  await expect(page.getByRole("link", { name: laterWorkshop.title, exact: true })).toHaveCount(0);
  await find(laterWorkshop.title, "/v1/idea-boards");
  await expect(page.getByRole("link", { name: laterCanvas.title, exact: true })).toHaveCount(0);
  await search.fill("");
  await expect(page.getByRole("link", { name: initialTitle, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load more boards", exact: true }).click();
  await expect(page.getByRole("link", { name: laterCanvas.title, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: laterWorkshop.title, exact: true })).toBeVisible();
  await find(laterCanvas.title, "/v1/canvas-boards");
  await expect(page.getByRole("link", { name: laterWorkshop.title, exact: true })).toHaveCount(0);
});

test("@mobile canvas retains keyboard alternatives, touch navigation and readable layouts", async ({
  page,
  browserName,
}, testInfo) => {
  test.setTimeout(150_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await organization(page, testInfo);
  const id = await newTeamCanvas(page);
  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  await saveText(page, "A mobile planning note");
  const note = (await snapshot(page, id)).objects.find(
    (object) => object.text === "A mobile planning note",
  )!;
  await page.getByRole("spinbutton", { name: "Horizontal position", exact: true }).fill("400");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page, id)).objects.find((object) => object.id === note.id)?.x)
    .toBe(400);
  await page.getByRole("button", { name: "Object outline", exact: true }).click();
  await page.getByRole("button", { name: "Fit board", exact: true }).click();
  const surface = page.getByTestId("canvas-surface");
  const zoom = page.getByRole("group", { name: "Canvas zoom", exact: true }).locator("output");
  const beforeZoom = await zoom.textContent();
  if (browserName === "chromium") {
    await surface.scrollIntoViewIfNeeded();
    const box = (await surface.boundingBox())!;
    const touch = await page.context().newCDPSession(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + Math.min(box.height / 2, 200);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: cx - 30, y: cy, id: 1 },
        { x: cx + 30, y: cy, id: 2 },
      ],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: cx - 60, y: cy + 20, id: 1 },
        { x: cx + 60, y: cy + 20, id: 2 },
      ],
    });
    try {
      // Keep both contacts down until the browser has dispatched the gesture's move frame.
      await expect(zoom).not.toHaveText(beforeZoom!);
    } finally {
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await touch.detach();
    }
  } else {
    await page.getByRole("button", { name: "Canvas zoom +", exact: true }).tap();
    await expect(zoom).not.toHaveText(beforeZoom!);
  }
  expect((await snapshot(page, id)).objects).toHaveLength(1);
  await page.getByRole("button", { name: "Fit board", exact: true }).tap();
  for (const mode of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: mode });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
    const theme = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const rgb = (token: string) => {
        const hex = root.getPropertyValue(token).trim();
        if (!/^#[0-9a-f]{6}$/i.test(hex))
          throw new Error("Expected the canvas theme's six-digit color token");
        return `rgb(${[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
      };
      return {
        expectedText: rgb("--ui-text"),
        expectedMuted: rgb("--ui-text-muted"),
        presentation: getComputedStyle(
          document.querySelector('section[aria-label="Presentation"] [role="status"]')!,
        ).color,
        footer: getComputedStyle(document.querySelector("footer label")!).color,
        workspace: getComputedStyle(document.querySelector("header p span[lang]")!).color,
      };
    });
    await writeFile(
      testInfo.outputPath(`canvas-theme-${mode}-before-contrast.json`),
      JSON.stringify(theme, null, 2),
    );
    // Require inherited foregrounds to agree with the requested theme before checking contrast.
    await expect(
      page.getByRole("region", { name: "Presentation", exact: true }).getByRole("status"),
    ).toHaveCSS("color", theme.expectedText);
    await expect(page.locator("footer label")).toHaveCSS("color", theme.expectedMuted);
    await expect(page.locator("header p span[lang]")).toHaveCSS("color", theme.expectedMuted);
    await fits(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`canvas-mobile-${mode}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await fits(page);
  await page.reload();
  await expect(page.getByTestId(`canvas-object-${note.id}`)).toContainText(
    "A mobile planning note",
  );
});
