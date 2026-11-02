import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { testEmail } from "../e2e/test-email";
import {
  account,
  api,
  fits,
  newTeamCanvas,
  organization,
  snapshot,
  teammate,
  web,
} from "./support";

interface CapturedMail {
  email: string;
  kind: "canvas" | "idea_board";
  url: string;
}
async function prepareOrganization(page: Page, testInfo: TestInfo) {
  const authentication = await page.context().newPage();
  try {
    return await organization(authentication, testInfo);
  } finally {
    await authentication.close();
  }
}
async function mail(page: Page) {
  const response = await page.request.get(`${api}/__test/canvas/board-mail`);
  expect(response.status()).toBe(200);
  return (await response.json()).messages as CapturedMail[];
}
async function createGroup(page: Page, name: string) {
  const response = await page.request.post(`${api}/v1/groups`, {
    data: { name, description: "Synthetic board sharing group" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).group.id as string;
}
async function sharing(page: Page, id: string) {
  const response = await page.request.get(`${api}/v1/canvas-boards/${id}/sharing`);
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ groups: Array<{ groupId: string; role: string }> }>;
}
async function openShare(page: Page) {
  await page.getByRole("button", { name: "Share board", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share board", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function guidedCanvas(page: Page) {
  await page.goto("/boards");
  await page.getByRole("button", { name: "New board", exact: true }).click();
  const creation = page.getByRole("dialog", { name: "New board", exact: true });
  await creation.getByRole("button", { name: "Guided workshop", exact: true }).click();
  await creation.getByRole("button", { name: "Possibility map", exact: true }).click();
  await creation
    .getByRole("textbox", { name: "Board title", exact: true })
    .fill("Guest invitation workshop");
  await creation.getByRole("button", { name: "Create board", exact: true }).click();
  await expect(page).toHaveURL(/\/canvas\/[0-9a-f-]+$/);
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const board = await snapshot(page, id);
  expect(board.sourceBoardId).toBeTruthy();
  return { id, sourceId: board.sourceBoardId! };
}

test("selected facilitator groups and bulk collaborators keep board access separate from workspaces", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { owner, organizationId } = await prepareOrganization(page, testInfo);
  const editor = await teammate(page, browser, organizationId, testInfo);
  try {
    expect(editor.identity.creator.workspaceId).not.toBe(owner.creator.workspaceId);
    const id = await newTeamCanvas(page);
    const groupName = "Selected facilitators";
    const groupId = await createGroup(page, groupName);
    let dialog = await openShare(page);
    await dialog.getByRole("tab", { name: "Facilitator groups", exact: true }).click();
    await dialog.getByRole("checkbox", { name: new RegExp(groupName) }).check();
    await dialog.getByRole("combobox", { name: "Board role", exact: true }).selectOption("viewer");
    const request = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url() === `${api}/v1/canvas-boards/${id}/group-grants`,
    );
    await dialog.getByRole("button", { name: "Share with selected groups", exact: true }).click();
    const grantIntent = (await request).postDataJSON() as {
      operationId: string;
      groupIds: string[];
      role: string;
    };
    expect(grantIntent.groupIds).toEqual([groupId]);
    expect(grantIntent.role).toBe("viewer");
    await expect
      .poll(async () =>
        (await sharing(page, id)).groups.map((group) => ({
          groupId: group.groupId,
          role: group.role,
        })),
      )
      .toEqual([{ groupId, role: "viewer" }]);
    await expect(dialog.getByRole("listitem").filter({ hasText: groupName })).toBeVisible();
    expect((await snapshot(page, id)).grants).toEqual([]);
    await dialog.getByRole("button", { name: "Close sharing", exact: true }).click();
    await page.goto("/groups");
    await page.getByRole("button", { name: new RegExp(groupName) }).click();
    const boards = page.getByRole("region", { name: "Shared canvas boards", exact: true });
    await expect(
      boards.getByRole("heading", { name: "Shared planning canvas", exact: true }),
    ).toBeVisible();
    const boardLink = boards.getByRole("link", { name: "Open board", exact: true });
    await expect(boardLink).toHaveAttribute("href", `/canvas/${id}`);
    await boardLink.click();
    await expect(page.getByTestId("canvas-surface")).toBeVisible();
    dialog = await openShare(page);
    await dialog.getByRole("tab", { name: "Facilitator groups", exact: true }).click();
    await dialog
      .getByRole("listitem")
      .filter({ hasText: groupName })
      .getByRole("button", { name: "Revoke board access", exact: true })
      .click();
    await expect.poll(async () => (await sharing(page, id)).groups).toEqual([]);
    const replay = await page.request.post(`${api}/v1/canvas-boards/${id}/group-grants`, {
      data: grantIntent,
    });
    expect(replay.status()).toBe(200);
    expect((await sharing(page, id)).groups).toEqual([]);
    await expect(dialog.getByRole("listitem").filter({ hasText: groupName })).toHaveCount(0);
    await dialog.getByRole("tab", { name: "Collaborators", exact: true }).click();
    const outsider = testEmail("board-outsider", testInfo);
    await dialog
      .getByRole("textbox", { name: "Teammate's verified email", exact: true })
      .fill(`${editor.email},\n${outsider}`);
    await dialog.getByRole("combobox", { name: "Board role", exact: true }).selectOption("editor");
    await dialog.getByRole("button", { name: "Send invitations", exact: true }).click();
    const results = dialog.getByRole("region", { name: "Invitation results", exact: true });
    await expect(results.getByRole("listitem").filter({ hasText: editor.email })).toContainText(
      "Sent",
    );
    await expect(results.getByRole("listitem").filter({ hasText: outsider })).toContainText(
      "Could not invite",
    );
    const deliveries = (await mail(page)).filter((message) =>
      [editor.email, outsider].includes(message.email),
    );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.email).toBe(editor.email);
    expect(deliveries[0]!.kind).toBe("canvas");
    expect(new URL(deliveries[0]!.url).pathname).toMatch(/^\/canvas\/invitations\/[0-9a-f-]+$/);
    await editor.page.goto(deliveries[0]!.url);
    await editor.page.getByRole("button", { name: "Accept board invitation", exact: true }).click();
    await expect(editor.page).toHaveURL(`${web}/canvas/${id}`);
    await expect(editor.page.getByTestId("canvas-surface")).toBeVisible();
    expect((await account(editor.page)).creator.workspaceId).toBe(
      editor.identity.creator.workspaceId,
    );
    expect((await account(page)).creator.workspaceId).toBe(owner.creator.workspaceId);
    await expect(editor.page.getByRole("button", { name: "Share board", exact: true })).toHaveCount(
      0,
    );
  } finally {
    await editor.context.close();
  }
});

test("guided workshop email invites remain accountless public participation and are available on the legacy host", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { organizationId } = await prepareOrganization(page, testInfo);
  const { id, sourceId } = await guidedCanvas(page);
  const seatsBeforeResponse = await page.request.get(
    `${api}/v1/organizations/${organizationId}/seats`,
  );
  expect(seatsBeforeResponse.status()).toBe(200);
  const seatsBefore = await seatsBeforeResponse.json();
  const external = [
    testEmail("external-guest-one", testInfo),
    testEmail("external-guest-two", testInfo),
  ];
  const dialog = await openShare(page);
  await dialog.getByRole("tab", { name: "Workshop guests", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Board role", exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/public, forwardable link/)).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "Guest email addresses", exact: true })
    .fill(external.join("\n"));
  await dialog.getByRole("button", { name: "Send invitations", exact: true }).click();
  const results = dialog.getByRole("region", { name: "Invitation results", exact: true });
  for (const email of external)
    await expect(results.getByRole("listitem").filter({ hasText: email })).toContainText("Sent");
  const deliveries = (await mail(page)).filter((message) => external.includes(message.email));
  expect(deliveries).toHaveLength(2);
  for (const delivery of deliveries) {
    expect(delivery.kind).toBe("idea_board");
    expect(delivery.url).toBe(`${web}/board/${sourceId}`);
  }
  await dialog.getByRole("button", { name: "Close sharing", exact: true }).click();
  await page.getByRole("button", { name: "Open collection", exact: true }).click();
  const guestContext = await browser.newContext({ baseURL: web, reducedMotion: "reduce" });
  try {
    const guest = await guestContext.newPage();
    await guest.goto(deliveries[0]!.url);
    await expect(
      guest.getByRole("textbox", { name: "Your board nickname", exact: true }),
    ).toHaveCount(0);
    await guest.getByRole("button", { name: "Join board", exact: true }).click();
    await guest
      .getByRole("textbox", { name: "Your idea", exact: true })
      .fill("A synthetic guest contribution");
    await guest.getByRole("button", { name: "Submit idea", exact: true }).click();
    await expect(guest.getByText("Your idea was submitted.", { exact: true })).toBeVisible();
    await expect(guest.getByRole("button", { name: "Sticky note", exact: true })).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "Share board", exact: true })).toHaveCount(0);
    for (const email of external) await expect(guest.locator("body")).not.toContainText(email);
    expect((await guest.request.get(`${api}/v1/auth/me`)).status()).toBe(401);
    expect((await guest.request.get(`${api}/v1/canvas-boards/${id}`)).status()).toBe(401);
    const seatsAfterResponse = await page.request.get(
      `${api}/v1/organizations/${organizationId}/seats`,
    );
    expect(seatsAfterResponse.status()).toBe(200);
    expect(await seatsAfterResponse.json()).toEqual(seatsBefore);
    await page
      .getByRole("button", { name: "Switch workspace and open workshop", exact: true })
      .click();
    await expect(page).toHaveURL(`${web}/boards/${sourceId}`);
    await page.getByRole("button", { name: "Invite participants", exact: true }).click();
    const legacy = page.getByRole("dialog", { name: "Invite participants", exact: true });
    await expect(
      legacy.getByRole("textbox", { name: "Guest email addresses", exact: true }),
    ).toBeVisible();
    await expect(legacy.getByRole("combobox")).toHaveCount(0);
    await expect(legacy.getByText(/cannot be revoked here/)).toBeVisible();
  } finally {
    await guestContext.close();
  }
});

async function dialogFits(page: Page, dialog: Locator) {
  await fits(page);
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= -1 &&
          rect.right <= innerWidth + 1 &&
          rect.top >= -1 &&
          rect.bottom <= innerHeight + 1 &&
          element.scrollWidth <= element.clientWidth + 1
        );
      }),
    )
    .toBe(true);
  for (const control of await dialog.locator("input:visible,textarea:visible,select:visible").all())
    expect(
      await control.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
}

test("@mobile group, collaborator and guest sharing fit narrow screens in both themes", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await prepareOrganization(page, testInfo);
  await guidedCanvas(page);
  const groupName = "Mobile facilitators";
  await createGroup(page, groupName);
  const dialog = await openShare(page);
  await dialog.getByRole("tab", { name: "Facilitator groups", exact: true }).tap();
  await dialog.getByRole("checkbox", { name: new RegExp(groupName) }).check();
  await dialog.getByRole("combobox", { name: "Board role", exact: true }).selectOption("viewer");
  await dialog.getByRole("button", { name: "Share with selected groups", exact: true }).tap();
  await expect(dialog.getByRole("listitem").filter({ hasText: groupName })).toBeVisible();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const mode of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: mode });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
      for (const name of ["Facilitator groups", "Collaborators", "Workshop guests"]) {
        await dialog.getByRole("tab", { name, exact: true }).tap();
        if (name === "Collaborators")
          await dialog
            .getByRole("textbox", { name: "Teammate's verified email", exact: true })
            .fill("synthetic-colleague@example.test");
        if (name === "Workshop guests") {
          await dialog
            .getByRole("textbox", { name: "Guest email addresses", exact: true })
            .fill("synthetic-guest@example.test");
          await expect(
            dialog.getByRole("combobox", { name: "Board role", exact: true }),
          ).toHaveCount(0);
        }
        await dialogFits(page, dialog);
        await expect
          .poll(async () => (await new AxeBuilder({ page }).analyze()).violations)
          .toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(
            `sharing-${name.replaceAll(" ", "-").toLowerCase()}-${width}-${mode}.png`,
          ),
        });
      }
    }
  }
});
