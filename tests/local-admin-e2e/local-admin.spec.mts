import { test, expect } from "@playwright/test";
import { testEmail } from "../e2e/test-email.js";
import {
  adminEmail,
  apiOrigin,
  businessAreas,
  controlOrigin,
  cookieNames,
  expectNoBusinessAccess,
  localAdminHarness,
  operatorStatus,
  productOrigin,
  signIn,
} from "./fixtures.mjs";

test("anonymous and ordinary customer sign-in never expose business administration", async ({
  page,
  context,
}, testInfo) => {
  const fixture = await localAdminHarness(context);
  const existingOperator = (await fixture.state()).operator;
  await page.goto(productOrigin);
  await expectNoBusinessAccess(page);
  await page.screenshot({ path: testInfo.outputPath("anonymous-homepage.png"), fullPage: true });
  await page.goto(`${productOrigin}/signin`);
  await expectNoBusinessAccess(page);
  await page.screenshot({ path: testInfo.outputPath("anonymous-signin.png"), fullPage: true });
  expect(await operatorStatus(page)).toBe(401);
  const denied = await page.request.post(`${controlOrigin}/auth/local`, {
    headers: { origin: controlOrigin },
  });
  expect(denied.status()).toBeGreaterThanOrEqual(400);
  expect(await fixture.cookie(cookieNames.session)).toBeUndefined();
  expect((await fixture.state()).operator).toEqual(existingOperator);
  await signIn(page, testEmail("ordinary-customer", testInfo));
  await expectNoBusinessAccess(page);
  const navigation = await (await page.request.get(`${apiOrigin}/v1/auth/navigation`)).json();
  expect(navigation.organizations).toEqual(
    expect.arrayContaining([expect.objectContaining({ role: "owner" })]),
  );
  expect(navigation.operatorConsoleOrigin).toBeNull();
  expect(await operatorStatus(page)).toBe(401);
  expect(await fixture.cookie(cookieNames.session)).toBeUndefined();
});

test("configured admin uses normal magic-link sign-in, manages tenants, and product logout revokes access", async ({
  page,
  context,
}, testInfo) => {
  const fixture = await localAdminHarness(context);
  await signIn(page, adminEmail);
  const token = (await fixture.cookie(cookieNames.session))!;
  expect(token).toBeTruthy();
  expect(await fixture.cookie(cookieNames.csrf)).toBeTruthy();
  const initial = await fixture.state();
  expect(initial.issuerConfigured).toBe(false);
  expect(initial.mfaConfigured).toBe(false);
  expect(initial.authenticated).toBe(true);
  expect(initial.operator).toMatchObject({ name: "Local admin", role: "founder", active: true });
  const creator = (await (await page.request.get(`${apiOrigin}/v1/auth/me`)).json()).creator as {
    workspaceId: string;
  };
  const organization = (
    (await (await page.request.get(`${apiOrigin}/v1/organizations`)).json())
      .organizations as Array<{ id: string }>
  )[0]!;
  const before = await fixture.state({ organizationId: organization.id });
  await page.locator("summary").filter({ hasText: "Business · Super admin" }).click();
  for (const name of Object.values(businessAreas))
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("local-admin-product-navigation.png") });
  await page.getByRole("link", { name: "Tenant management", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toBeVisible();
  await expect(page.locator(".identity")).toContainText("Local admin");
  await expect(page.locator(".identity")).toContainText("Super admin");
  for (const area of Object.keys(businessAreas))
    await expect(
      page.getByRole("navigation", { name: "Operator areas" }).getByRole("button", {
        name: area[0]!.toUpperCase() + area.slice(1),
        exact: true,
      }),
    ).toBeVisible();
  const workspace = page.locator(".workspace").filter({ hasText: creator.workspaceId });
  await workspace.getByRole("button", { name: "Restrict new joins", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic local administration test restriction");
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
  await page.getByRole("button", { name: "Credits", exact: true }).click();
  const grant = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Grant event credits", exact: true }),
  });
  await grant.getByRole("combobox", { name: /Organization/ }).selectOption(organization.id);
  await grant.getByLabel("Credits", { exact: true }).fill("5");
  await grant
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic local administration credit grant");
  await grant.getByRole("button", { name: "Grant credits", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Command completed");
  const after = await fixture.state({ organizationId: organization.id });
  expect(after.balance!.balance).toBe(before.balance!.balance + 5);
  expect(after.ledgerEntries).toBe(before.ledgerEntries + 1);
  await page.getByRole("button", { name: "Audit", exact: true }).click();
  await expect(page.getByRole("cell", { name: "credits.grant", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("local-admin-console.png"), fullPage: true });
  await page.goto(`${productOrigin}/dashboard`);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(`${productOrigin}/`);
  await expectNoBusinessAccess(page);
  expect(await fixture.cookie(cookieNames.session)).toBeUndefined();
  expect(await fixture.cookie(cookieNames.csrf)).toBeUndefined();
  const signedOut = await fixture.state({}, token);
  expect(signedOut.authenticated).toBe(false);
  expect(signedOut.sessionExists).toBe(false);
  expect(signedOut.auditActions).toEqual(
    expect.arrayContaining([
      "operator.login",
      "workspace.admission.restrict",
      "credits.grant",
      "operator.logout",
    ]),
  );
  expect(await operatorStatus(page)).toBe(401);
});

test("switching from admin to an ordinary email revokes the prior operator session", async ({
  page,
  context,
}, testInfo) => {
  const fixture = await localAdminHarness(context);
  await signIn(page, adminEmail);
  await expect(page.locator("summary").filter({ hasText: "Business · Super admin" })).toBeVisible();
  const token = (await fixture.cookie(cookieNames.session))!;
  await signIn(page, testEmail("switch-to-ordinary", testInfo));
  await expectNoBusinessAccess(page);
  expect(await fixture.cookie(cookieNames.session)).toBeUndefined();
  expect(await fixture.cookie(cookieNames.csrf)).toBeUndefined();
  const previous = await fixture.state({}, token);
  expect(previous.authenticated).toBe(false);
  expect(previous.sessionExists).toBe(false);
  expect(await operatorStatus(page)).toBe(401);
  const navigation = await (await page.request.get(`${apiOrigin}/v1/auth/navigation`)).json();
  expect(navigation.operatorConsoleOrigin).toBeNull();
});

test("durable local operator revocation immediately removes console and product access", async ({
  page,
  context,
}) => {
  const fixture = await localAdminHarness(context);
  await signIn(page, adminEmail);
  await page.locator("summary").filter({ hasText: "Business · Super admin" }).click();
  await page.getByRole("link", { name: "Tenant management", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toBeVisible();
  await fixture.revoke();
  expect((await fixture.state()).operator).toMatchObject({ active: false });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toHaveCount(0);
  await page.goto(productOrigin);
  await expectNoBusinessAccess(page);
  expect(await operatorStatus(page)).toBe(401);
  const navigation = await (await page.request.get(`${apiOrigin}/v1/auth/navigation`)).json();
  expect(navigation.operatorConsoleOrigin).toBeNull();
});
