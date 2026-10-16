import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { operatorTotpCode } from "../../packages/control-plane/src/index.js";
import { testEmail } from "../e2e/test-email.js";
import {
  apiOrigin,
  controlOrigin,
  cookieNames,
  expectNoBusinessAccess,
  localAdminHarness,
  operatorStatus,
  productOrigin,
  signIn,
  signInAdmin,
} from "./fixtures.mjs";

test("customer sign-in never provisions or discovers console access", async ({
  page,
  context,
}, testInfo) => {
  const fixture = await localAdminHarness(context);
  const before = (await fixture.state()).operator;
  await page.goto(productOrigin);
  await expectNoBusinessAccess(page);
  expect(await operatorStatus(page)).toBe(403);
  const denied = await page.request.post(`${controlOrigin}/auth/local`, {
    headers: { origin: controlOrigin },
  });
  expect(denied.status()).toBeGreaterThanOrEqual(400);
  await signIn(page, "admin@pollingpops.local");
  await expectNoBusinessAccess(page);
  const navigation = await (await page.request.get(`${apiOrigin}/v1/auth/navigation`)).json();
  expect(navigation.organizations).toEqual(
    expect.arrayContaining([expect.objectContaining({ role: "owner" })]),
  );
  expect(navigation.operatorConsoleOrigin).toBeNull();
  expect(await operatorStatus(page)).toBe(403);
  expect(await fixture.cookie(cookieNames.session)).toBeUndefined();
  expect((await fixture.state()).operator).toEqual(before);
  await page.screenshot({
    path: testInfo.outputPath("customer-without-admin-menu.png"),
    fullPage: true,
  });
});

test("admin signs in directly with password and TOTP and remains independent of product logout", async ({
  page,
  context,
}, testInfo) => {
  const fixture = await localAdminHarness(context);
  const credentials = await fixture.provision();
  expect((await page.request.get(`${apiOrigin}/v1/auth/me`)).status()).toBe(401);
  await page.goto(controlOrigin);
  await expect(
    page.getByRole("heading", { name: "Sign in to the admin console", exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("admin-signin-mobile.png"), fullPage: true });
  await page.getByLabel("Username", { exact: true }).fill(credentials.username);
  await page.getByLabel("Password", { exact: true }).fill("Incorrect password attempt");
  await page
    .getByLabel("Authenticator code", { exact: true })
    .fill(operatorTotpCode(credentials.totpSecret));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /sign-in failed|username|authenticator/i }),
  ).toBeVisible();
  expect(await fixture.cookie(cookieNames.session)).toBeUndefined();
  await signInAdmin(page, credentials);
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  expect(await fixture.cookie(cookieNames.csrf)).toBeTruthy();
  expect((await fixture.state()).operator).toMatchObject({
    name: "Development administrator",
    role: "founder",
    active: true,
  });
  expect((await page.request.get(`${apiOrigin}/v1/auth/me`)).status()).toBe(401);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath("admin-console-desktop.png"), fullPage: true });

  const product = await context.newPage();
  await signIn(product, testEmail("separate-customer", testInfo));
  await expectNoBusinessAccess(product);
  const creator = (await (await product.request.get(`${apiOrigin}/v1/auth/me`)).json()).creator;
  await page.getByRole("button", { name: "Organizations", exact: true }).click();
  const workspace = page.locator(".workspace").filter({ hasText: creator.workspaceId });
  await workspace.getByRole("button", { name: "Restrict new joins", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic independent administration verification");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Apply command", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "Allow new joins", exact: true }),
  ).toBeVisible();
  expect((await fixture.state({ workspaceId: creator.workspaceId })).restriction).toMatchObject({
    blocked: true,
  });
  await product.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(product).toHaveURL(`${productOrigin}/`);
  expect(await operatorStatus(page)).toBe(200);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toBeVisible();
  const token = (await fixture.cookie(cookieNames.session))!;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  expect(await fixture.cookie(cookieNames.session)).toBeUndefined();
  expect((await fixture.state({}, token)).authenticated).toBe(false);
});

test("switching customer accounts cannot replace or revoke an administrator session", async ({
  page,
  context,
}, testInfo) => {
  const fixture = await localAdminHarness(context);
  await signInAdmin(page, await fixture.provision());
  const token = await fixture.cookie(cookieNames.session);
  const product = await context.newPage();
  await signIn(product, testEmail("independent-customer-one", testInfo));
  await signIn(product, testEmail("independent-customer-two", testInfo));
  await expectNoBusinessAccess(product);
  expect(await fixture.cookie(cookieNames.session)).toBe(token);
  expect(await operatorStatus(page)).toBe(200);
});

test("durable administrator revocation immediately denies the standalone console", async ({
  page,
  context,
}) => {
  const fixture = await localAdminHarness(context);
  await signInAdmin(page, await fixture.provision());
  await fixture.revoke();
  expect((await fixture.state()).operator).toMatchObject({ active: false });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toHaveCount(0);
  expect(await operatorStatus(page)).toBe(401);
  await page.goto(productOrigin);
  await expectNoBusinessAccess(page);
});
