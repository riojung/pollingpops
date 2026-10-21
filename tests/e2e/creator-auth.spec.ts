import { expect, test } from "@playwright/test";
import {
  expectAnonymousCreator,
  requestCreatorPin,
  submitCreatorPin,
  verifyCreatorEmail,
} from "../support/creator-auth";
import { testEmail } from "./test-email";

test("a new verified account signs in to Home in its default workspace without pilot flags", async ({
  page,
}, testInfo) => {
  const email = testEmail("default-home", testInfo);
  const { apiOrigin } = await verifyCreatorEmail(page, email);
  await expect(page).toHaveURL(
    (url) => url.pathname === "/signin" && url.searchParams.get("returnTo") === "/home?welcome=1",
  );
  const { pin } = await requestCreatorPin(page, email);
  await submitCreatorPin(page, pin);
  await expect(page).toHaveURL(/\/home\?welcome=1$/);
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Checkpoint set title")).toHaveCount(0);
  const account = await (await page.request.get(`${apiOrigin}/v1/auth/me`)).json();
  expect(account).toMatchObject({
    creator: { email, role: "owner", plan: "free", segment: "workplace" },
    productFeatures: { workspaceShell: true, uxBeta: false, builderV2: false },
  });
  const workspaceList = await (await page.request.get(`${apiOrigin}/v1/workspaces`)).json();
  expect(workspaceList.activeWorkspaceId).toBe(account.creator.workspaceId);
  expect(workspaceList.workspaces).toEqual([
    expect.objectContaining({ id: account.creator.workspaceId, role: "owner" }),
  ]);
  const navigation = page
    .getByRole("navigation", { name: /^Workspace(?: sections)?$/ })
    .filter({ visible: true });
  await expect(navigation.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(navigation.getByRole("link", { name: "Library", exact: true })).toHaveAttribute(
    "href",
    "/library",
  );
  await expect(
    page.getByRole("heading", { name: "From a trusted source to useful evidence", exact: true }),
  ).toBeVisible();
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    width: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll("main, main section, main article")]
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        right: element.getBoundingClientRect().right,
      }))
      .filter((element) => element.right > innerWidth + 1),
  }));
  expect(layout.width, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
  await page.screenshot({
    path: testInfo.outputPath("default-workspace-home.png"),
    fullPage: true,
  });
  const create = page.getByRole("button", { name: "Create", exact: true });
  await create.click();
  const menu = create.locator("..");
  await expect(menu.getByRole("link", { name: /^Round\b/ })).toHaveAttribute("href", "/dashboard");
  // Default tenant navigation does not bypass separately managed capabilities.
  for (const [label, enabled] of [
    [/^Presentation\b/, account.productFeatures.presentations],
    [/^Survey\b/, account.productFeatures.surveys],
  ] as const) {
    await expect(menu.getByRole("link", { name: label })).toHaveCount(enabled ? 1 : 0);
  }
  await menu.getByRole("link", { name: /^Round\b/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByLabel("Checkpoint set title")).toBeVisible();
  await page.goto("/account");
  const workspaceSelect = page.getByRole("combobox", { name: "Workspace", exact: true });
  await expect(workspaceSelect).toHaveValue(account.creator.workspaceId);
  await expect(workspaceSelect.locator("option:checked")).toContainText(
    workspaceList.workspaces[0].name,
  );
});

test("email verification requires a separate sign-in request and the correct six-digit PIN", async ({
  page,
}, testInfo) => {
  const email = testEmail("verified-pin", testInfo);
  let pinRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/auth/pin/request")
      pinRequests += 1;
  });
  const { apiOrigin } = await verifyCreatorEmail(page, email, { returnTo: "/account" });
  expect(pinRequests).toBe(0);
  await expect(page.getByRole("form", { name: "Verify sign-in PIN" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Continue to dashboard", exact: true })).toHaveCount(
    0,
  );

  const { pin, challengeId } = await requestCreatorPin(page, email);
  expect(pinRequests).toBe(1);
  const form = page.getByRole("form", { name: "Verify sign-in PIN", exact: true });
  const pinInput = form.getByLabel("Sign-in PIN", { exact: true });
  await expect(pinInput).toHaveAttribute("inputmode", "numeric");
  await expect(pinInput).toHaveAttribute("autocomplete", "one-time-code");
  await pinInput.fill(pin === "000000" ? "111111" : "000000");
  const failed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/auth/pin/verify",
  );
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await failed).status()).toBe(401);
  await expect(
    page.getByRole("alert").filter({ hasText: "The PIN is invalid or expired" }),
  ).toBeVisible();
  await expectAnonymousCreator(page, apiOrigin);

  await submitCreatorPin(page, pin);
  await expect(page).toHaveURL(/\/account$/);
  const replay = await page.request.post(`${apiOrigin}/v1/auth/pin/verify`, {
    headers: { origin: new URL(page.url()).origin },
    data: { challengeId, pin },
  });
  expect(replay.status()).toBe(401);
  expect(replay.headers()["set-cookie"]).toBeUndefined();
});
