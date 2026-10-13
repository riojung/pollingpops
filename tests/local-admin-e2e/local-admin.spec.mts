import { test, expect } from "@playwright/test";
import { tokenHash } from "../../packages/control-plane/src/index.js";
import {
  businessAreas,
  controlOrigin,
  cookieNames,
  localAdminHarness,
  productOrigin,
} from "./fixtures.mjs";

test("local admin manages tenants and product business menus without SSO, then signs out", async ({
  page,
  context,
}, testInfo) => {
  const fixture = await localAdminHarness(context);
  expect(fixture.config.OPERATOR_OIDC_ISSUER).toBeUndefined();
  expect(fixture.config.OPERATOR_OIDC_MFA_POLICY_ENFORCED).toBe(false);
  await page.goto(productOrigin);
  await page
    .getByRole("navigation", { name: "Primary navigation", exact: true })
    .getByRole("link", { name: "Business admin sign in", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sign in as local admin", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in with operator identity" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in as local admin", exact: true }).click();
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
  const token = (await fixture.cookie(cookieNames.session))!;
  const signedIn = await fixture.auth.authenticate(token);
  expect(signedIn.operator).toMatchObject({ name: "Local admin", role: "founder" });
  await page.getByRole("button", { name: "Restrict new joins", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic local administration test restriction");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Apply command", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Allow new joins", exact: true })).toBeVisible();
  expect(
    await fixture.platform.getWorkspaceAdmissionRestriction(fixture.creator.workspaceId),
  ).toMatchObject({
    blocked: true,
  });
  await page.getByRole("button", { name: "Credits", exact: true }).click();
  const grant = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Grant event credits", exact: true }),
  });
  await grant.getByRole("combobox", { name: /Organization/ }).selectOption(fixture.organization.id);
  await grant.getByLabel("Credits", { exact: true }).fill("5");
  await grant
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic local administration credit grant");
  await grant.getByRole("button", { name: "Grant credits", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Command completed");
  expect(await fixture.platform.getCreditBalance(fixture.organization.id)).toMatchObject({
    balance: 5,
  });
  await page.screenshot({ path: testInfo.outputPath("local-admin-console.png"), fullPage: true });

  await page.goto(productOrigin);
  await page.locator("summary").filter({ hasText: "Business · Super admin" }).click();
  for (const name of Object.values(businessAreas))
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("local-admin-product-navigation.png") });
  await page.getByRole("link", { name: "Billing", exact: true }).click();
  await expect(page).toHaveURL(`${controlOrigin}/?view=billing`);
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in as local admin", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toHaveCount(0);
  expect(await fixture.cookie(cookieNames.session)).toBeUndefined();
  expect(await fixture.cookie(cookieNames.csrf)).toBeUndefined();
  expect(await fixture.platform.getOperatorSession(tokenHash(token))).toBeNull();
  await page.goto(productOrigin);
  await expect(page.locator("summary").filter({ hasText: "Business · Super admin" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: "Tenant management", exact: true })).toHaveCount(0);
  const audit = await fixture.platform.listAuditEvents(undefined, 100);
  expect(audit.map((event) => event.action)).toEqual(
    expect.arrayContaining([
      "operator.login",
      "workspace.admission.restrict",
      "credits.grant",
      "operator.logout",
    ]),
  );
});

test("durable local operator revocation immediately removes console and product access", async ({
  page,
  context,
}) => {
  const fixture = await localAdminHarness(context);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in as local admin", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toBeVisible();
  const identity = await fixture.auth.authenticate(await fixture.cookie(cookieNames.session));
  await fixture.platform.provisionOperator({
    issuer: identity.operator.issuer,
    subject: "synthetic-backup-founder",
    name: "Synthetic backup founder",
    role: "founder",
    capabilities: [],
    active: true,
  });
  await fixture.platform.provisionOperator({
    issuer: identity.operator.issuer,
    subject: identity.operator.subject,
    name: identity.operator.name,
    role: identity.operator.role,
    capabilities: identity.operator.capabilities,
    active: false,
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in as local admin", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in as local admin", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toHaveCount(0);
  await page.goto(productOrigin);
  await expect(page.locator("summary").filter({ hasText: "Business · Super admin" })).toHaveCount(
    0,
  );
});
