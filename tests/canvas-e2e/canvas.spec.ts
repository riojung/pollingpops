import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";
import { CANVAS_SCHEMA_VERSION } from "../../packages/contracts/src/canvas-boards";
import { guidedWorkshopCopy } from "../../apps/web/lib/i18n/guided-workshop-messages";
import { participantCanvasCopy } from "../../apps/web/lib/i18n/participant-canvas-messages";
import { canvasToolCopy } from "../../apps/web/lib/i18n/canvas-tool-messages";
import {
  account,
  canvasAction,
  closeInspector,
  openInspector,
  openPresentation,
  api,
  web,
  fits,
  organization,
  teammate,
  snapshot,
  saveText,
  newTeamCanvas,
} from "./support";

async function selectObject(page: Page, name: string) {
  const inspector = await openInspector(page, "Objects");
  await inspector.getByRole("button", { name, exact: true }).click();
  await openInspector(page, "Properties");
}

async function submitCanvasIdea(page: Page, body: string) {
  const copy = participantCanvasCopy("en-CA"),
    tools = canvasToolCopy("en-CA");
  await expect(
    page.getByRole("region", { name: "Published canvas", exact: true }).first(),
  ).toBeVisible();
  await page
    .locator("main > header")
    .getByRole("button", { name: copy.startIdea, exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: copy.title, exact: true });
  await editor.getByRole("textbox", { name: copy.ideaTitle, exact: true }).fill(body);
  await editor.getByRole("button", { name: tools.sticky, exact: true }).click();
  const text = editor.getByRole("textbox", { name: tools.editText, exact: true });
  await text.fill(body);
  await editor.getByRole("button", { name: tools.saveText, exact: true }).click();
  await expect(text).toHaveCount(0);
  await editor.getByRole("button", { name: copy.submitIdea, exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page
    .locator("main > header")
    .getByRole("button", { name: /Your participation.*Open participation panel/ })
    .click();
}

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
    await sharing.getByRole("button", { name: "Send invitations", exact: true }).click();
    const invitationRow = sharing
      .getByRole("listitem")
      .filter({ hasText: editor.email })
      .filter({
        has: owner.getByRole("button", { name: "Revoke invitation", exact: true }),
      });
    const invitationLink = invitationRow.getByRole("link", {
      name: "Participant link",
      exact: true,
    });
    await expect(invitationLink).toHaveAttribute("href", /\/canvas\/invitations\//);
    await invitationRow.getByRole("button", { name: "Revoke invitation", exact: true }).click();
    await expect(invitationRow).toHaveCount(0);
    await expect(invitationLink).toHaveCount(0);
    await sharing
      .getByRole("button", { name: "Start a new invitation batch", exact: true })
      .click();
    await sharing
      .getByRole("textbox", { name: "Teammate's verified email", exact: true })
      .fill(editor.email);
    await sharing.getByRole("button", { name: "Send invitations", exact: true }).click();
    await expect(invitationLink).toHaveAttribute("href", /\/canvas\/invitations\//);
    await editor.page.goto(new URL((await invitationLink.getAttribute("href"))!, web).href);
    await editor.page.getByRole("button", { name: "Accept board invitation", exact: true }).click();
    await expect(editor.page).toHaveURL(`${web}/canvas/${id}`);
    await expect(editor.page.getByTestId(`canvas-object-${ownerNote.id}`)).toBeVisible();
    expect((await account(editor.page)).creator.workspaceId).toBe(
      editor.identity.creator.workspaceId,
    );
    await expect(editor.page.getByRole("button", { name: "Share board", exact: true })).toHaveCount(
      0,
    );
    await sharing.getByRole("button", { name: "Close sharing", exact: true }).click();

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

    await selectObject(owner, "A clear shared outcome");
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
    await selectObject(editor.page, "Owner updates one note");
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
    await openInspector(owner, "Arrange");
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
    await selectObject(editor.page, "Editor updates another note");
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
  const copy = guidedWorkshopCopy("en-CA");
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
  await openInspector(owner, "Workshop controls");
  await expect(
    owner.getByRole("button", { name: "Switch workspace and open workshop", exact: true }),
  ).toBeVisible();
  await owner.getByRole("button", { name: "Open collection", exact: true }).click();
  // This page deliberately has creator cookies: every guest read/write must still omit them.
  const guest = await owner.context().newPage();
  const publicContext = await browser.newContext({ baseURL: web });
  const otherGuest = await publicContext.newPage();
  const reads: Array<Promise<{ headers: Record<string, string> | null; error: unknown }>> = [];
  function captureGuestRequest(request: Request) {
    const path = new URL(request.url()).pathname;
    if (/\/v1\/(idea-boards|canvas-boards)\//.test(path))
      reads.push(
        request.allHeaders().then(
          (headers) => ({ headers, error: null }),
          (error: unknown) => ({ headers: null, error }),
        ),
      );
  }
  guest.on("request", captureGuestRequest);
  try {
    await guest.goto(`/board/${sourceId}`);
    await guest.getByRole("button", { name: "Join board", exact: true }).click();
    await submitCanvasIdea(guest, "A protected guest proposal");
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
    await openInspector(owner, "Workshop controls");
    const startVoting = owner.getByRole("button", { name: "Start voting", exact: true });
    await expect(startVoting).toBeDisabled();
    await expect(startVoting).toHaveAccessibleDescription(copy.votingNeedsApproved);
    await owner.getByRole("button", { name: copy.reviewBeforeVoting, exact: true }).click();
    await expect(
      owner.getByRole("heading", { name: "Awaiting review", exact: true }),
    ).toBeFocused();
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

    const reopen = owner.getByRole("button", { name: copy.reopenCollection, exact: true });
    const dialog = owner.getByRole("dialog", { name: copy.reopenTitle, exact: true });
    await reopen.click();
    await expect(
      dialog.getByRole("combobox", { name: copy.reopenWindow, exact: true }),
    ).toHaveValue("7");
    await dialog.getByRole("combobox", { name: copy.reopenWindow, exact: true }).selectOption("1");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(reopen).toBeFocused();
    expect((await snapshot(owner, id)).sourceBoard).toMatchObject({
      status: "closed",
      roundNumber: 1,
    });

    const reopenRequests: string[] = [];
    await owner.route(`${api}/v1/canvas-boards/${id}/commands`, async (route) => {
      const request = route.request();
      const body = request.postDataJSON();
      if (
        request.method() === "POST" &&
        body.command.type === "workshop" &&
        body.command.command.type === "reopen"
      ) {
        reopenRequests.push(request.postData()!);
        if (reopenRequests.length === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            headers: {
              "access-control-allow-origin": web,
              "access-control-allow-credentials": "true",
            },
            body: JSON.stringify({
              error: { code: "UNAVAILABLE", message: "Synthetic workshop outage" },
            }),
          });
          return;
        }
      }
      await route.continue();
    });
    await reopen.click();
    const window = dialog.getByRole("combobox", { name: copy.reopenWindow, exact: true });
    await expect(window).toHaveValue("7");
    await dialog.getByRole("button", { name: copy.confirmReopen, exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(copy.reopenError);
    await expect(window).toBeDisabled();
    expect((await snapshot(owner, id)).sourceBoard).toMatchObject({
      status: "closed",
      roundNumber: 1,
    });
    await dialog.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(reopenRequests).toHaveLength(2);
    expect(reopenRequests[1]).toBe(reopenRequests[0]);
    expect(JSON.parse(reopenRequests[0]!)).toMatchObject({
      operationId: expect.any(String),
      command: { type: "workshop", command: { type: "reopen", roundNumber: 1, windowDays: 7 } },
    });
    const reopened = (await snapshot(owner, id)).sourceBoard!;
    expect(reopened).toMatchObject({
      status: "collecting",
      roundNumber: 2,
      totalIdeas: 1,
      roundHistory: [
        { roundNumber: 1, ballotCount: 1, results: [{ ideaId: card.ideaId, voteCount: 1 }] },
      ],
    });
    await expect(guest.getByText("Round 2", { exact: true })).toBeVisible();
    await expect(
      guest
        .locator("main > header")
        .getByRole("button", { name: participantCanvasCopy("en-CA").startIdea, exact: true }),
    ).toBeVisible();
    await expect(
      guest.getByText("Your votes are saved. Your ballot cannot be changed.", { exact: true }),
    ).toHaveCount(0);
    const history = guest.locator("details").filter({
      has: guest.locator("summary").filter({ hasText: copy.votingHistory }),
    });
    await history.locator("summary").click();
    const firstRound = history.getByRole("article").filter({
      has: guest.getByRole("heading", { name: "Round 1", exact: true }),
    });
    await expect(firstRound).toContainText("1 ballot");
    await expect(
      firstRound.getByRole("list", { name: copy.votingResults, exact: true }),
    ).toContainText("A protected guest proposal");
    await expect(firstRound.getByText("1 vote", { exact: true })).toBeVisible();

    await startVoting.click();
    const secondBallot = guest.getByRole("checkbox", {
      name: "A protected guest proposal",
      exact: true,
    });
    await expect(secondBallot).not.toBeChecked();
    await secondBallot.check();
    await guest.getByRole("button", { name: "Submit votes", exact: true }).click();
    await expect(
      guest.getByText("Your votes are saved. Your ballot cannot be changed.", { exact: true }),
    ).toBeVisible();
    await owner.getByRole("button", { name: "Close board", exact: true }).click();
    await expect(guest.getByText("1 votes", { exact: true })).toBeVisible();
    await expect(guest.getByText("2 votes", { exact: true })).toHaveCount(0);
    await expect(firstRound).toContainText("1 ballot");
    await expect(firstRound.getByText("1 vote", { exact: true })).toBeVisible();
    expect((await snapshot(owner, id)).sourceBoard).toMatchObject({
      roundNumber: 2,
      ideas: [{ id: card.ideaId, voteCount: 1 }],
      roundHistory: reopened.roundHistory,
    });
    await owner
      .getByRole("button", { name: "Switch workspace and open workshop", exact: true })
      .click();
    await expect(owner).toHaveURL(`${web}/boards/${sourceId}`);
    await expect(owner.getByRole("button", { name: "Delete board", exact: true })).toBeVisible();
    await expect(owner.getByText("Round 2", { exact: true })).toBeVisible();
    await expect(owner.locator("summary").filter({ hasText: copy.votingHistory })).toBeVisible();
  } finally {
    guest.off("request", captureGuestRequest);
    try {
      for (const result of await Promise.all(reads)) {
        expect(result.error, "Guest request headers remain readable before cleanup").toBeNull();
        expect(result.headers!.cookie).toBeUndefined();
      }
    } finally {
      await Promise.all([publicContext.close(), guest.close()]);
    }
  }
});

test("@mobile guided guest canvas fills the screen and preserves read-only navigation and private intake", async ({
  page: owner,
  browserName,
}, testInfo) => {
  const copy = guidedWorkshopCopy("en-CA");
  await owner.emulateMedia({ reducedMotion: "reduce" });
  await organization(owner, testInfo);
  const created = await owner.request.post(`${api}/v1/idea-boards`, {
    data: {
      schemaVersion: 1,
      idempotencyKey: randomUUID(),
      title: "Mobile guided workshop",
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
  const publicId = randomUUID();
  const privateId = randomUUID();
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
              id: publicId,
              type: "sticky",
              text: "Shared workshop map",
              visibility: "published",
              x: 100,
              y: 100,
              width: 240,
              height: 180,
            },
          },
          {
            type: "create",
            object: {
              id: privateId,
              type: "sticky",
              text: "Private facilitator notes",
              visibility: "team",
              x: 600,
              y: 100,
              width: 240,
              height: 180,
            },
          },
        ],
      },
    },
  });
  expect(seeded.status(), await seeded.text()).toBe(200);
  const objects = (await snapshot(owner, id)).objects;
  const guest = await owner.context().newPage();
  const canvasWrites: string[] = [];
  guest.on("request", (request) => {
    if (request.method() === "POST" && request.url() === `${api}/v1/canvas-boards/${id}/commands`)
      canvasWrites.push(request.postData()!);
  });
  try {
    await guest.setViewportSize({ width: 320, height: 844 });
    await guest.goto(`/board/${sourceId}`);
    await guest.getByRole("button", { name: "Join board", exact: true }).tap();
    const canvas = guest.locator('section[aria-label="Published canvas"]');
    const surface = canvas.getByTestId("canvas-surface");
    const navigation = canvas.getByRole("toolbar", { name: copy.navigation, exact: true });
    const panel = guest.getByRole("complementary", { name: copy.participantPanel, exact: true });
    const panelTrigger = guest.getByRole("button", {
      name: `${copy.participantPanel} Submit idea — ${copy.openParticipantPanel}`,
      exact: true,
    });
    await expect(surface).toBeVisible();
    await expect(panelTrigger).toHaveAttribute("aria-expanded", "false");
    await expect(panelTrigger).toContainText(copy.participantPanel);
    await expect(panel).toBeHidden();
    await expect(guest.getByTestId(`canvas-object-${publicId}`)).toBeVisible();
    await expect(guest.getByTestId(`canvas-object-${privateId}`)).toHaveCount(0);
    await expect(guest.getByText("Private facilitator notes", { exact: true })).toHaveCount(0);
    const fullCanvas = (await surface.boundingBox())!;
    expect(fullCanvas.x).toBeCloseTo(0, 0);
    expect(fullCanvas.width).toBe(320);
    expect(fullCanvas.height).toBeGreaterThan(400);
    await fits(guest);

    const zoom = navigation.getByRole("button", { name: /^\d+% — Reset zoom$/ });
    const initialZoom = await zoom.textContent();
    await expect(zoom).toHaveAccessibleName(`${initialZoom} — ${copy.resetZoom}`);
    await navigation.getByRole("button", { name: copy.zoomIn, exact: true }).tap();
    await expect(zoom).not.toHaveText(initialZoom!);
    await zoom.tap();
    await expect(zoom).toHaveText("100%");
    await expect(zoom).toHaveAccessibleName(`100% — ${copy.resetZoom}`);
    const transform = surface.locator(":scope > g").first();
    const beforePan = await transform.getAttribute("transform");
    const x = fullCanvas.x + 90;
    const y = fullCanvas.y + 100;
    if (browserName === "chromium") {
      const touch = await guest.context().newCDPSession(guest);
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, id: 1 }],
      });
      try {
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + 60, y: y + 30, id: 1 }],
        });
        await expect(transform).not.toHaveAttribute("transform", beforePan!);
      } finally {
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await touch.detach();
      }
    } else {
      await guest.mouse.move(x, y);
      await guest.mouse.down();
      await guest.mouse.move(x + 60, y + 30, { steps: 4 });
      await guest.mouse.up();
      await expect(transform).not.toHaveAttribute("transform", beforePan!);
    }
    const afterPan = await transform.getAttribute("transform");
    await surface.focus();
    await surface.press("ArrowRight");
    await expect(transform).not.toHaveAttribute("transform", afterPan!);

    const outlineTrigger = navigation.getByRole("button", { name: "Object outline", exact: true });
    await outlineTrigger.tap();
    const outline = canvas.getByRole("complementary", { name: "Object outline", exact: true });
    await expect(
      outline.getByRole("heading", { name: "Object outline", exact: true }),
    ).toBeFocused();
    await expect(outline.getByRole("listitem")).toHaveCount(1);
    const selected = outline.getByRole("button", {
      name: "Select Shared workshop map",
      exact: true,
    });
    await selected.tap();
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    await navigation.getByRole("button", { name: copy.fitSelection, exact: true }).tap();
    await expect(outline).toBeHidden();
    await expect(outlineTrigger).toBeFocused();
    await navigation.getByRole("button", { name: copy.focusMode, exact: true }).tap();
    const focused = guest.getByRole("dialog", { name: "Published canvas", exact: true });
    await expect(focused).toHaveAttribute("aria-modal", "true");
    const focusBounds = (await focused.boundingBox())!;
    expect(focusBounds).toEqual({ x: 0, y: 0, width: 320, height: 844 });
    await navigation.getByRole("button", { name: copy.exitFocusMode, exact: true }).press("Tab");
    await expect(surface).toBeFocused();
    await surface.press("Shift+Tab");
    await expect(
      navigation.getByRole("button", { name: copy.exitFocusMode, exact: true }),
    ).toBeFocused();
    await guest.keyboard.press("Escape");
    await expect(focused).toHaveCount(0);
    await expect(
      navigation.getByRole("button", { name: copy.focusMode, exact: true }),
    ).toBeFocused();

    await panelTrigger.tap();
    await expect(
      guest.getByRole("button", {
        name: `${copy.participantPanel} Submit idea — ${copy.closeParticipantPanel}`,
        exact: true,
      }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(
      panel.getByRole("heading", { name: copy.participantPanel, exact: true }),
    ).toBeFocused();
    const canvasCopy = participantCanvasCopy("en-CA");
    await expect(panel.getByRole("textbox", { name: "Your idea", exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: canvasCopy.startIdea, exact: true }).tap();
    const editor = guest.getByRole("dialog", { name: canvasCopy.title, exact: true });
    const draft = editor.getByRole("textbox", { name: canvasCopy.ideaTitle, exact: true });
    await draft.fill("A private draft survives canvas navigation");
    await editor.getByRole("button", { name: canvasCopy.backToWorkshop, exact: true }).tap();
    await expect(editor).toHaveCount(0);
    await expect(panel).toBeHidden();
    const continueDraft = guest
      .locator("main > header")
      .getByRole("button", { name: canvasCopy.continueIdea, exact: true });
    await expect(continueDraft).toBeFocused();
    await continueDraft.tap();
    await expect(draft).toHaveValue("A private draft survives canvas navigation");
    await editor.getByRole("button", { name: canvasCopy.backToWorkshop, exact: true }).tap();
    for (const mode of ["light", "dark"] as const) {
      await guest.emulateMedia({ colorScheme: mode });
      await expect(guest.locator("html")).toHaveAttribute("data-color-mode", mode);
      await fits(guest);
      await expect
        .poll(async () => (await new AxeBuilder({ page: guest }).analyze()).violations)
        .toEqual([]);
      await guest.screenshot({ path: testInfo.outputPath(`guided-guest-${mode}-canvas.png`) });
      await panelTrigger.tap();
      await expect(
        panel.getByRole("button", { name: canvasCopy.continueIdea, exact: true }),
      ).toBeVisible();
      await fits(guest);
      await expect
        .poll(async () => (await new AxeBuilder({ page: guest }).analyze()).violations)
        .toEqual([]);
      await guest.screenshot({
        path: testInfo.outputPath(`guided-guest-${mode}-participation.png`),
      });
      await panel.getByRole("button", { name: copy.closeParticipantPanel, exact: true }).tap();
      await expect(panelTrigger).toBeFocused();
    }
    await expect(guest.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "Start voting", exact: true })).toHaveCount(0);
    expect(canvasWrites).toEqual([]);
    expect((await snapshot(owner, id)).objects).toEqual(objects);
  } finally {
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
  await openInspector(page, "Arrange");
  await expect(page.getByRole("button", { name: "Duplicate selected", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Duplicate selected", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await snapshot(page, id)).objects.length).toBe(2);
  const second = (await snapshot(page, id)).objects.find((object) => object.id !== first.id)!;
  await saveText(page, "A connected idea");
  await page.getByRole("button", { name: "Connector", exact: true }).focus();
  await page.keyboard.press("Space");
  await openInspector(page, "Objects");
  await page
    .getByRole("complementary", { name: "Inspector", exact: true })
    .getByRole("button", { name: first.text, exact: true })
    .focus();
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
  await openInspector(page, "Arrange");
  await page.getByRole("button", { name: "Delete selected", exact: true }).click();
  await expect.poll(async () => (await snapshot(page, id)).objects.length).toBe(2);
  await page.setViewportSize({ width: 640, height: 900 });
  await fits(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  page.once("dialog", (dialog) => dialog.accept());
  await openInspector(page, "Board");
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
  const search = page
    .getByRole("toolbar", { name: "Idea boards", exact: true })
    .getByRole("searchbox", { name: "Search boards", exact: true });
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
  await closeInspector(page);
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
    await openInspector(page, "Board");
    const workspace = page
      .getByRole("tabpanel", { name: "Board", exact: true })
      .locator("p > span[lang]")
      .first();
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
        workspace: getComputedStyle(
          document.querySelector('aside [role="tabpanel"]:not([hidden]) p > span[lang]')!,
        ).color,
      };
    });
    await writeFile(
      testInfo.outputPath(`canvas-theme-${mode}-before-contrast.json`),
      JSON.stringify(theme, null, 2),
    );
    // Require inherited foregrounds to agree with the requested theme before checking contrast.
    await expect(workspace).toHaveCSS("color", theme.expectedMuted);
    await closeInspector(page);
    await openPresentation(page);
    await expect(
      page.getByRole("region", { name: "Presentation", exact: true }).getByRole("status"),
    ).toHaveCSS("color", theme.expectedText);
    await expect(page.locator("footer label")).toHaveCSS("color", theme.expectedMuted);
    await (await canvasAction(page, "Presentation")).click();
    const more = page.getByRole("button", { name: "More board actions", exact: true });
    if ((await more.getAttribute("aria-expanded")) === "true") await more.click();
    await fits(page);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await fits(page);
      for (const name of ["Canvas tools", "Canvas zoom"]) {
        const buttons = page.getByRole("group", { name, exact: true }).getByRole("button");
        await expect(buttons.first()).toBeVisible();
        for (const button of await buttons.all()) {
          await button.scrollIntoViewIfNeeded();
          await expect(button).toBeInViewport({ ratio: 1 });
        }
      }
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`canvas-mobile-${mode}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await fits(page);
  const outline = await canvasAction(page, "Object outline");
  await outline.tap();
  await expect(outline).toHaveAttribute("aria-expanded", "true");
  await closeInspector(page);
  const beforeInspectorZoom = await zoom.textContent();
  await page.getByRole("button", { name: "Canvas zoom +", exact: true }).tap();
  await expect(zoom).not.toHaveText(beforeInspectorZoom!);
  await expect(
    page.getByRole("button", { name: "Object outline", exact: true, includeHidden: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(page.getByTestId(`canvas-object-${note.id}`)).toContainText(
    "A mobile planning note",
  );
});
