import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { operatorTotpCode } from "../../packages/control-plane/src/index.js";
import { testEmail } from "../e2e/test-email.js";
import {
  apiOrigin,
  controlOrigin,
  cookieNames,
  localAdminHarness,
  signIn,
  signInAdmin,
} from "./fixtures.mjs";

test("sensitive feature changes preserve the review until fresh authentication and explicit apply", async ({
  page,
  context,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const fixture = await localAdminHarness(context);
  const credentials = await fixture.provision();
  await signInAdmin(page, credentials);
  const before = await fixture.state();
  const previousSession = await fixture.cookie(cookieNames.session);
  const previousCsrf = await fixture.cookie(cookieNames.csrf);
  await page
    .getByRole("navigation", { name: "Operator areas" })
    .getByRole("button", { name: "Features", exact: true })
    .click();
  const availability = page.getByRole("combobox", {
    name: "Availability for Session summaries",
    exact: true,
  });
  const chosenAvailability =
    (await availability.inputValue()) === "enabled" ? "disabled" : "enabled";
  await availability.selectOption(chosenAvailability);
  await expect(page.getByText("You have unsaved changes", { exact: true })).toBeVisible();
  await fixture.ageSession();
  expect((await fixture.state()).authenticated).toBe(true);

  let documentNavigations = 0;
  const commands: { body: Record<string, unknown>; csrf: string | undefined }[] = [];
  const signIns: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documentNavigations += 1;
    if (request.method() === "POST" && request.url() === `${controlOrigin}/api/commands`)
      commands.push({
        body: request.postDataJSON(),
        csrf: request.headers()["x-operator-csrf"],
      });
    if (request.method() === "POST" && request.url() === `${controlOrigin}/auth/password`)
      signIns.push(request.postDataJSON());
  });
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  const review = page.getByRole("dialog");
  const reason = "Synthetic feature change after fresh identity verification";
  await review.getByLabel("Reason", { exact: true }).fill(reason);
  const rejected = page.waitForResponse(
    (response) => response.url() === `${controlOrigin}/api/commands`,
  );
  await review.getByRole("button", { name: "Apply command", exact: true }).click();
  const staleResponse = await rejected;
  expect(staleResponse.status()).toBe(403);
  expect(await staleResponse.json()).toMatchObject({
    error: { code: "REAUTHENTICATION_REQUIRED" },
  });
  await expect(
    review.getByRole("heading", { name: "Verify your identity", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sign in to the admin console", exact: true }),
  ).toHaveCount(0);
  await expect(availability).toHaveValue(chosenAvailability);
  await expect(review.getByLabel("Username", { exact: true })).toHaveValue(credentials.username);
  await expect(review.getByLabel("Username", { exact: true })).toHaveAttribute("readonly", "");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("admin-feature-reauthentication-desktop.png"),
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("admin-feature-reauthentication-mobile.png"),
    fullPage: false,
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  expect(commands).toHaveLength(1);
  expect(commands[0]!.body).toMatchObject({ action: "features.update", reason });
  expect(commands[0]!.csrf).toBe(previousCsrf);
  expect(
    (await fixture.state()).auditActions.filter((action) => action === "features.update"),
  ).toHaveLength(before.auditActions.filter((action) => action === "features.update").length);

  await review.getByRole("button", { name: "Back to review", exact: true }).click();
  await expect(review.getByLabel("Reason", { exact: true })).toHaveValue(reason);
  await review.getByRole("button", { name: "Apply command", exact: true }).click();
  await expect(
    review.getByRole("heading", { name: "Verify your identity", exact: true }),
  ).toBeVisible();
  await review.getByLabel("Password", { exact: true }).fill("Incorrect synthetic password");
  await review.getByLabel("Authenticator code", { exact: true }).fill("000000");
  await review.getByRole("button", { name: "Verify identity", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /password|authenticator/i }),
  ).toBeVisible();
  await expect(review.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(review.getByLabel("Authenticator code", { exact: true })).toHaveValue("");
  await expect(availability).toHaveValue(chosenAvailability);

  await review.getByLabel("Password", { exact: true }).fill(credentials.password);
  // A fresh counter avoids replaying the authenticator code used for initial sign-in.
  await review
    .getByLabel("Authenticator code", { exact: true })
    .fill(operatorTotpCode(credentials.totpSecret, new Date(Date.now() + 30_000)));
  const renewed = page.waitForResponse((response) => response.url() === `${controlOrigin}/api/me`);
  await review.getByRole("button", { name: "Verify identity", exact: true }).click();
  expect((await renewed).status()).toBe(200);
  await expect(
    page.getByText("Identity verified. Review and apply your change.", { exact: true }),
  ).toBeVisible();
  await expect(review.getByLabel("Reason", { exact: true })).toHaveValue(reason);
  await expect(availability).toHaveValue(chosenAvailability);
  await expect(review.getByLabel("Password", { exact: true })).toHaveCount(0);
  expect(signIns).toHaveLength(2);
  expect(signIns.every((attempt) => attempt.username === credentials.username)).toBe(true);
  expect(await fixture.cookie(cookieNames.session)).not.toBe(previousSession);
  expect(await fixture.cookie(cookieNames.csrf)).not.toBe(previousCsrf);
  expect((await fixture.state({}, previousSession)).authenticated).toBe(false);
  // Returning to review can submit the expired command again, but successful
  // verification itself must never replay an operational change.
  expect(commands).toHaveLength(2);
  expect(documentNavigations).toBe(0);

  await review.getByRole("button", { name: "Apply command", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Command completed" })).toBeVisible();
  await expect(page.getByText("Policy is up to date", { exact: true })).toBeVisible();
  expect(commands).toHaveLength(3);
  expect(commands[1]!.body).toEqual(commands[0]!.body);
  expect(commands[2]!.body).toEqual(commands[0]!.body);
  expect(commands[2]!.csrf).toBe(await fixture.cookie(cookieNames.csrf));
  const after = await fixture.state();
  const featureEvents = after.auditEvents.filter((event) => event.action === "features.update");
  expect(featureEvents).toHaveLength(
    before.auditEvents.filter((event) => event.action === "features.update").length + 1,
  );
  expect(featureEvents.filter((event) => event.reason === reason)).toEqual([
    { action: "features.update", actorId: before.operator!.id, reason },
  ]);
  expect(documentNavigations).toBe(0);
  await page
    .getByRole("searchbox", { name: "Search features", exact: true })
    .fill("session summar");
  await page.screenshot({
    path: testInfo.outputPath("admin-feature-policy-applied-desktop.png"),
    fullPage: true,
  });
});

test("admin sign-in explains a throttled attempt", async ({ page, context }) => {
  const fixture = await localAdminHarness(context);
  const credentials = await fixture.provision();
  await page.route(`${controlOrigin}/auth/password`, async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many attempts" } }),
    });
  });
  await page.goto(controlOrigin);
  await page.getByLabel("Username", { exact: true }).fill(credentials.username);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page
    .getByLabel("Authenticator code", { exact: true })
    .fill(operatorTotpCode(credentials.totpSecret));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Too many sign-in attempts" })).toHaveText(
    "Too many sign-in attempts. Wait up to 15 minutes, then use a fresh authenticator code.",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Authenticator code", { exact: true })).toHaveValue("");
  expect(await fixture.cookie(cookieNames.session)).toBeUndefined();
});

test("a direct credit grant preserves its payload and reason through fresh authentication", async ({
  page,
  context,
}, testInfo) => {
  const fixture = await localAdminHarness(context);
  const credentials = await fixture.provision();
  await signIn(page, testEmail("direct-credit-reauth", testInfo));
  const navigation = await (await page.request.get(`${apiOrigin}/v1/auth/navigation`)).json();
  const organizationId = navigation.organizations[0].id as string;
  await signInAdmin(page, credentials);
  await page
    .getByRole("navigation", { name: "Operator areas" })
    .getByRole("button", { name: "Credits", exact: true })
    .click();
  const grant = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Grant event credits", exact: true }) });
  const reason = "Synthetic direct grant after fresh identity verification";
  await grant
    .getByRole("combobox", { name: "Organization", exact: true })
    .selectOption(organizationId);
  await grant.getByLabel("Credits", { exact: true }).fill("3");
  await grant.getByLabel("Reason", { exact: true }).fill(reason);
  const before = await fixture.state({ organizationId });
  const previousCsrf = await fixture.cookie(cookieNames.csrf);
  await fixture.ageSession();
  const commands: { body: Record<string, unknown>; csrf: string | undefined }[] = [];
  let documentNavigations = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documentNavigations += 1;
    if (request.method() === "POST" && request.url() === `${controlOrigin}/api/commands`)
      commands.push({ body: request.postDataJSON(), csrf: request.headers()["x-operator-csrf"] });
  });
  const rejected = page.waitForResponse(
    (response) => response.url() === `${controlOrigin}/api/commands`,
  );
  await grant.getByRole("button", { name: "Grant credits", exact: true }).click();
  const staleResponse = await rejected;
  expect(staleResponse.status()).toBe(403);
  expect(await staleResponse.json()).toMatchObject({
    error: { code: "REAUTHENTICATION_REQUIRED" },
  });
  const review = page.getByRole("dialog");
  await expect(
    review.getByRole("heading", { name: "Verify your identity", exact: true }),
  ).toBeVisible();
  await expect(review.getByLabel("Username", { exact: true })).toHaveValue(credentials.username);
  await expect(grant.getByLabel("Reason", { exact: true })).toHaveValue(reason);
  await expect(grant.getByLabel("Credits", { exact: true })).toHaveValue("3");
  expect(commands).toHaveLength(1);
  expect(commands[0]!.body).toMatchObject({
    action: "credits.grant",
    organizationId,
    quantity: 3,
    reason,
  });
  const rejectedState = await fixture.state({ organizationId });
  expect(rejectedState.balance).toEqual(before.balance);
  expect(rejectedState.ledgerEntries).toBe(before.ledgerEntries);

  await review.getByLabel("Password", { exact: true }).fill(credentials.password);
  await review
    .getByLabel("Authenticator code", { exact: true })
    .fill(operatorTotpCode(credentials.totpSecret, new Date(Date.now() + 30_000)));
  const renewed = page.waitForResponse((response) => response.url() === `${controlOrigin}/api/me`);
  await review.getByRole("button", { name: "Verify identity", exact: true }).click();
  expect((await renewed).status()).toBe(200);
  await expect(
    review.getByRole("heading", { name: "Review credits.grant", exact: true }),
  ).toBeVisible();
  await expect(review.getByLabel("Reason", { exact: true })).toHaveValue(reason);
  const payload = JSON.parse((await review.locator("pre").textContent())!);
  expect(payload).toEqual({ action: "credits.grant", organizationId, quantity: 3 });
  expect(commands).toHaveLength(1);
  const verifiedState = await fixture.state({ organizationId });
  expect(verifiedState.balance).toEqual(before.balance);
  expect(verifiedState.ledgerEntries).toBe(before.ledgerEntries);
  expect(documentNavigations).toBe(0);

  await review.getByRole("button", { name: "Apply command", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Command completed" })).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]!.body).toEqual(commands[0]!.body);
  expect(commands[0]!.csrf).toBe(previousCsrf);
  expect(commands[1]!.csrf).toBe(await fixture.cookie(cookieNames.csrf));
  expect(commands[1]!.csrf).not.toBe(previousCsrf);
  const after = await fixture.state({ organizationId });
  expect(after.balance).toMatchObject({ balance: (before.balance?.balance ?? 0) + 3 });
  expect(after.ledgerEntries).toBe(before.ledgerEntries + 1);
  expect(after.auditEvents.filter((event) => event.action === "credits.grant")).toHaveLength(
    before.auditEvents.filter((event) => event.action === "credits.grant").length + 1,
  );
  expect(after.auditEvents.filter((event) => event.reason === reason)).toEqual([
    { action: "credits.grant", actorId: before.operator!.id, reason },
  ]);
  expect(documentNavigations).toBe(0);
});
