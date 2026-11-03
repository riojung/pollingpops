import { randomUUID } from "node:crypto";
import { expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import type { CanvasBoardView } from "@openround/contracts";
import { signInCreator } from "../support/creator-auth";
import { testEmail } from "../e2e/test-email";

export const api = "http://127.0.0.1:4400";
export const web = "http://127.0.0.1:3400";

export async function account(page: Page) {
  const response = await page.request.get(`${api}/v1/auth/me`);
  expect(response.ok()).toBe(true);
  return response.json();
}
export async function organization(page: Page, testInfo: TestInfo) {
  await signInCreator(page, testEmail("canvas-owner", testInfo));
  const setup = await page.request.post(`${api}/v1/customer/setup`, {
    headers: { "x-idempotency-key": randomUUID() },
    data: {
      accountType: "organization",
      name: "Canvas Company",
      workspaceName: "Facilitator workspace",
      segment: "workplace",
    },
  });
  expect(setup.status(), await setup.text()).toBe(201);
  const owner = await account(page);
  const seed = await page.request.post(`${api}/__test/business/seed`, {
    data: {
      organizationId: owner.workspace.organization.id,
      actorId: owner.creator.userId,
      creatorLicenseQuantity: 2,
    },
  });
  expect(seed.ok()).toBe(true);
  return { owner, organizationId: owner.workspace.organization.id as string };
}
export async function teammate(
  owner: Page,
  browser: Browser,
  organizationId: string,
  testInfo: TestInfo,
) {
  const context = await browser.newContext({ baseURL: web, reducedMotion: "reduce" });
  const page = await context.newPage();
  const email = testEmail("canvas-editor", testInfo);
  await signInCreator(page, email);
  const invitation = await owner.request.post(
    `${api}/v1/organizations/${organizationId}/invitations`,
    {
      headers: { "x-idempotency-key": randomUUID() },
      data: { email, role: "member", workspaceName: "Teammate workspace" },
    },
  );
  expect(invitation.status()).toBe(201);
  await page.goto((await invitation.json()).inviteUrl);
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await page.getByRole("link", { name: "Open your workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  return { context, page, email, identity: await account(page) };
}
export async function snapshot(page: Page, id: string): Promise<CanvasBoardView> {
  const response = await page.request.get(`${api}/v1/canvas-boards/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).board;
}
export async function saveText(page: Page, text: string) {
  await openInspector(page);
  await page.getByRole("textbox", { name: "Text", exact: true }).fill(text);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
}
export async function newTeamCanvas(page: Page) {
  await page.goto("/boards");
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await page.getByRole("button", { name: "Team canvas", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Board title", exact: true })
    .fill("Shared planning canvas");
  await page.getByRole("button", { name: "Create board", exact: true }).click();
  await expect(page).toHaveURL(/\/canvas\/[0-9a-f-]+$/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  return id;
}
export async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

export async function canvasAction(page: Page, label: string) {
  const actions = page.getByRole("button", { name: label, exact: true, includeHidden: true });
  const action = actions.filter({ visible: true });
  if (!(await action.isVisible())) {
    const more = page.getByRole("button", { name: "More board actions", exact: true });
    if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
  }
  await expect(action).toBeVisible();
  for (const button of await actions.all()) if (await button.isVisible()) return button;
  throw new Error(`Canvas action is not visible: ${label}`);
}

export async function openInspector(
  page: Page,
  tab:
    | "Objects"
    | "Properties"
    | "Arrange"
    | "Board"
    | "Facilitation"
    | "Workshop controls" = "Properties",
) {
  const presentation = page.getByRole("button", {
    name: "Presentation",
    exact: true,
    includeHidden: true,
  });
  if (
    (await presentation.count()) > 0 &&
    (await presentation.getAttribute("aria-expanded")) === "true"
  )
    await (await canvasAction(page, "Presentation")).click();
  const more = page.getByRole("button", {
    name: "More board actions",
    exact: true,
    includeHidden: true,
  });
  if ((await more.getAttribute("aria-expanded")) === "true" && (await more.isVisible()))
    await more.click();
  const insert = page.getByRole("button", { name: "Insert", exact: true });
  if ((await insert.getAttribute("aria-expanded")) === "true") await insert.click();
  const drawer = page.getByTestId("canvas-inspector");
  const inspector = page.getByRole("complementary", { name: "Inspector", exact: true });
  if ((await drawer.getAttribute("data-open")) !== "true")
    await (await canvasAction(page, "Object outline")).click();
  await expect(inspector).toBeVisible();
  await inspector.getByRole("tab", { name: tab, exact: true }).click();
  return inspector;
}

export async function closeInspector(page: Page) {
  const drawer = page.getByTestId("canvas-inspector");
  if ((await drawer.getAttribute("data-open")) !== "true") return;
  const close = drawer.getByRole("button", { name: "Close inspector", exact: true });
  await expect(close).toBeVisible();
  await close.click();
  await expect(drawer).toHaveAttribute("data-open", "false");
}

export async function openInsert(page: Page, label: string) {
  const insert = page.getByRole("button", { name: "Insert", exact: true });
  if ((await insert.getAttribute("aria-expanded")) !== "true") await insert.click();
  await page
    .getByRole("group", { name: "Insert", exact: true })
    .getByRole("button", { name: label, exact: true })
    .click();
}

export async function openPresentation(page: Page) {
  if (
    (await page
      .getByRole("button", { name: "Presentation", exact: true, includeHidden: true })
      .count()) === 0
  )
    return;
  const presentation = await canvasAction(page, "Presentation");
  if ((await presentation.getAttribute("aria-expanded")) !== "true") await presentation.click();
}
