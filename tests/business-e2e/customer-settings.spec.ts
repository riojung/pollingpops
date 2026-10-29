import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { signInCreator } from "../support/creator-auth";
import { testEmail } from "../e2e/test-email";

const api = "http://127.0.0.1:4300";
const categories = [
  "Overview",
  "People",
  "Appearance",
  "Plan and usage",
  "Security and integrations",
  "Privacy and data",
] as const;

async function selectCategory(page: Page, name: (typeof categories)[number]) {
  const tab = page.getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toBeVisible();
}

async function setAppearance(page: Page, mode: "Light" | "Dark") {
  await page.getByRole("button", { name: /^Appearance:/ }).click();
  await page.getByRole("radio", { name: mode, exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode.toLowerCase());
}

async function expectAccessibleSettings(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
    "Settings fit the viewport without horizontal scrolling",
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test("personal Free settings provide named workspaces and accessible, selectable categories", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInCreator(page, testEmail("customer-settings-free", testInfo));
  const account = await (await page.request.get(`${api}/v1/auth/me`)).json();
  expect(account.workspace.accountType).toBe("personal");
  expect(account.entitlements.plan).toBe("free");
  await page.goto("/account");
  const navigation = page.getByRole("tablist", { name: "Settings categories", exact: true });
  await expect(navigation.getByRole("tab")).toHaveCount(categories.length);
  for (const name of categories)
    await expect(navigation.getByRole("tab", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const workspaceChip = page
    .locator('header a[href="/account"]')
    .filter({ hasText: account.workspace.name });
  await expect(workspaceChip).toContainText(account.workspace.name);
  await expect(workspaceChip).not.toContainText("Workplace workspace");

  const catalogResponse = page.waitForResponse((response) =>
    response.url().endsWith("/v1/billing/catalog"),
  );
  await page.getByRole("button", { name: "Explore Pro", exact: true }).click();
  await expect(page).toHaveURL(/\/account#plan$/);
  await expect(page.getByRole("tab", { name: "Plan and usage", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect((await catalogResponse).status()).toBe(200);
  await expect(
    page.getByRole("combobox", { name: "Personal subscription", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Online checkout is not configured for this installation. Contact its administrator.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("tabpanel").getByRole("button", { name: "Explore Pro", exact: true }),
  ).toBeDisabled();
  await selectCategory(page, "Overview");

  const renamed = "Alex's personal workspace";
  await page.getByRole("textbox", { name: "Workspace name", exact: true }).fill(renamed);
  const savedName = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" && response.url().endsWith("/v1/workspace/settings"),
  );
  await page.getByRole("button", { name: "Save workspace name", exact: true }).click();
  expect((await savedName).status()).toBe(200);
  await expect(page.getByRole("status")).toContainText("Workspace name saved");
  await expect(
    page.locator('header a[href="/account"]').filter({ hasText: renamed }),
  ).toBeVisible();
  expect((await (await page.request.get(`${api}/v1/auth/me`)).json()).workspace.name).toBe(renamed);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Exercise the actual roving tab keyboard behavior, not just mouse selection.
  const overview = navigation.getByRole("tab", { name: "Overview", exact: true });
  await overview.focus();
  await overview.press("ArrowRight");
  const people = navigation.getByRole("tab", { name: "People", exact: true });
  await expect(people).toBeFocused();
  await expect(people).toHaveAttribute("aria-selected", "true");
  await people.press("End");
  const data = navigation.getByRole("tab", { name: "Privacy and data", exact: true });
  await expect(data).toBeFocused();
  await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeDisabled();
  await data.press("Home");
  await expect(overview).toBeFocused();
  await expect(overview).toHaveAttribute("aria-selected", "true");

  await selectCategory(page, "Appearance");
  for (const name of ["Candy Pop", "Ocean", "Forest"])
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Brand display name", exact: true })).toHaveValue(
    renamed,
  );
  await expect(
    page.getByRole("textbox", { name: "Brand display name", exact: true }),
  ).toBeDisabled();
  const advanced = page
    .locator("details")
    .filter({ has: page.getByText("Custom colors", { exact: true }) });
  await expect(advanced).toHaveJSProperty("open", false);
  await expect(page.getByLabel(/^Background colour/)).toBeHidden();
  await page.getByText("Custom colors", { exact: true }).click();
  await expect(page.getByLabel(/^Background colour/)).toBeVisible();
  await expect(page.getByLabel(/^Background colour/)).toBeDisabled();
  await page.getByText("Custom colors", { exact: true }).click();

  await selectCategory(page, "Security and integrations");
  await expect(
    page.getByRole("heading", { name: "Identity and integration policy", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Website 1", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add website", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Website 1", exact: true })
    .fill("https://slides.example.org");
  await page.getByRole("button", { name: "Add website", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Website 2", exact: true })
    .fill("https://lms.example.org");
  const savedOrigins = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && response.url().endsWith("/v1/account/embed-origins"),
  );
  await page.getByRole("button", { name: "Save embed origins", exact: true }).click();
  expect((await savedOrigins).status()).toBe(200);
  expect(
    (await (await page.request.get(`${api}/v1/account/embed-origins`)).json()).origins,
  ).toEqual(["https://slides.example.org", "https://lms.example.org"]);
  await page.getByRole("button", { name: "Remove website 1", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Website 1", exact: true })).toHaveValue(
    "https://lms.example.org",
  );
  const removedOrigin = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && response.url().endsWith("/v1/account/embed-origins"),
  );
  await page.getByRole("button", { name: "Save embed origins", exact: true }).click();
  expect((await removedOrigin).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Website 1", exact: true })).toHaveValue(
    "https://lms.example.org",
  );
  await expect(page.getByRole("textbox", { name: "Website 2", exact: true })).toHaveCount(0);

  await setAppearance(page, "Light");
  for (const name of categories) {
    await selectCategory(page, name);
    await expectAccessibleSettings(page);
  }
  await selectCategory(page, "Overview");
  await capture(page, testInfo, "personal-overview-desktop-light");
  await selectCategory(page, "Appearance");
  await capture(page, testInfo, "personal-appearance-desktop-light");
  await setAppearance(page, "Dark");
  await expectAccessibleSettings(page);
  await selectCategory(page, "Security and integrations");
  await expectAccessibleSettings(page);

  await page.setViewportSize({ width: 320, height: 900 });
  await setAppearance(page, "Light");
  await selectCategory(page, "Overview");
  await expectAccessibleSettings(page);
  await capture(page, testInfo, "personal-overview-mobile-light");
  await selectCategory(page, "Appearance");
  await expectAccessibleSettings(page);
  await setAppearance(page, "Dark");
  await expectAccessibleSettings(page);
  await capture(page, testInfo, "personal-appearance-mobile-dark");
  await selectCategory(page, "Security and integrations");
  await expectAccessibleSettings(page);
  await selectCategory(page, "Privacy and data");
  await expectAccessibleSettings(page);
});

test("a real invited viewer cannot select or mutate administrative settings", async ({
  page: owner,
  browser,
}, testInfo) => {
  await signInCreator(owner, testEmail("customer-settings-inviter", testInfo));
  const ownerAccount = await (await owner.request.get(`${api}/v1/auth/me`)).json();
  const viewerContext = await browser.newContext({ reducedMotion: "reduce" });
  const viewer = await viewerContext.newPage();
  try {
    const email = testEmail("customer-settings-viewer", testInfo);
    await signInCreator(viewer, email);
    const invitation = await owner.request.post(`${api}/v1/workspace/invitations`, {
      data: { email, role: "viewer" },
    });
    expect(invitation.status()).toBe(201);
    const invitationUrl = (await invitation.json()).debugUrl as string;
    expect(new URL(invitationUrl).hostname).toBe("127.0.0.1");
    const token = new URL(invitationUrl).searchParams.get("token");
    const accepted = await viewer.request.post(`${api}/v1/invitations/accept`, {
      data: { token, acceptPolicies: true },
    });
    expect(accepted.status()).toBe(200);
    const account = await (await viewer.request.get(`${api}/v1/auth/me`)).json();
    expect(account.creator.role).toBe("viewer");
    expect(account.creator.workspaceId).toBe(ownerAccount.creator.workspaceId);
    for (const fragment of ["people", "appearance", "security"]) {
      await viewer.goto(`/account#${fragment}`);
      await expect(viewer.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(viewer.getByRole("tab")).toHaveCount(3);
      await expect(viewer.getByRole("tab", { name: "People", exact: true })).toHaveCount(0);
      await expect(viewer.getByRole("tab", { name: "Appearance", exact: true })).toHaveCount(0);
      await expect(
        viewer.getByRole("tab", { name: "Security and integrations", exact: true }),
      ).toHaveCount(0);
    }
    expect(
      (
        await viewer.request.patch(`${api}/v1/workspace/settings`, {
          data: { name: "Unauthorized rename" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await viewer.request.put(`${api}/v1/account/embed-origins`, {
          data: { origins: ["https://unauthorized.example.org"] },
        })
      ).status(),
    ).toBe(403);
    await viewer.setViewportSize({ width: 320, height: 900 });
    await setAppearance(viewer, "Dark");
    await expectAccessibleSettings(viewer);
    await capture(viewer, testInfo, "viewer-settings-mobile-dark");
  } finally {
    await viewerContext.close();
  }
});

test("licensed organization users have usable presets and role-aware settings in their own workspace", async ({
  page: owner,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  await owner.setViewportSize({ width: 1280, height: 960 });
  await owner.emulateMedia({ reducedMotion: "reduce" });
  await signInCreator(owner, testEmail("customer-settings-org-owner", testInfo));
  const personal = await (await owner.request.get(`${api}/v1/auth/me`)).json();
  await owner.goto("/account/setup?type=organization");
  await owner
    .getByRole("textbox", { name: "Organization name", exact: true })
    .fill("Settings Company");
  await owner
    .getByRole("textbox", { name: "Your workspace name", exact: true })
    .fill("Settings administrator");
  const setupResponse = owner.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/v1/customer/setup"),
  );
  await owner
    .getByRole("button", { name: "Create organization and workspace", exact: true })
    .click();
  const response = await setupResponse;
  expect(response.status()).toBe(201);
  await expect(owner).toHaveURL(/\/account#overview$/);
  const setup = await (await owner.request.get(`${api}/v1/auth/me`)).json();
  const organizationId = setup.workspace.organization.id as string;
  const seed = await owner.request.post(`${api}/__test/business/seed`, {
    data: { organizationId, actorId: personal.creator.userId, creatorLicenseQuantity: 2 },
  });
  expect(seed.ok()).toBe(true);
  // The loopback fixture changed billing behind the mounted page. Refresh the
  // authenticated account state before exercising the visible plan controls.
  await owner.reload();
  await selectCategory(owner, "Appearance");
  await expect(owner.getByRole("button", { name: "Ocean", exact: true })).toBeEnabled();
  await expect(owner.getByRole("textbox", { name: "Brand display name", exact: true })).toHaveValue(
    "Settings Company",
  );
  await owner.getByRole("button", { name: "Ocean", exact: true }).click();
  await expect(owner.getByRole("button", { name: "Ocean", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(owner.getByLabel(/^Background colour/)).toBeHidden();
  const savedTheme = owner.waitForResponse(
    (result) => result.request().method() === "PUT" && result.url().endsWith("/v1/account/theme"),
  );
  await owner.getByRole("button", { name: "Save theme", exact: true }).click();
  expect((await savedTheme).status()).toBe(200);
  expect((await (await owner.request.get(`${api}/v1/account/theme`)).json()).theme).toMatchObject({
    organizationName: "Settings Company",
    primaryColor: "#17334A",
    accentColor: "#006B80",
  });
  await setAppearance(owner, "Light");
  await expectAccessibleSettings(owner);
  await capture(owner, testInfo, "organization-appearance-desktop-light");

  const memberContext = await browser.newContext({ reducedMotion: "reduce" });
  const member = await memberContext.newPage();
  try {
    const email = testEmail("customer-settings-org-member", testInfo);
    await signInCreator(member, email);
    const invitation = await owner.request.post(
      `${api}/v1/organizations/${organizationId}/invitations`,
      {
        headers: { "x-idempotency-key": randomUUID() },
        data: { email, role: "member", workspaceName: "Settings user workspace" },
      },
    );
    expect(invitation.status()).toBe(201);
    await member.goto((await invitation.json()).inviteUrl);
    await member.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await member.getByRole("link", { name: "Open your workspace", exact: true }).click();
    await expect(member).toHaveURL(/\/home$/);
    await member.goto("/account#people");
    await expect(member.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(member.getByRole("tab", { name: "People", exact: true })).toHaveCount(0);
    await expect(
      member.getByRole("tab", { name: "Security and integrations", exact: true }),
    ).toHaveCount(0);
    await expect(member.getByRole("tab")).toHaveCount(4);
    await expect(
      member.locator('header a[href="/account"]').filter({ hasText: "Settings Company" }),
    ).toContainText("Settings user workspace");
    await expect(
      member.getByRole("complementary").getByText("Member · Team plan", { exact: true }),
    ).toBeVisible();
    await selectCategory(member, "Plan and usage");
    await expect(
      member.getByRole("link", { name: "Open organization billing", exact: true }),
    ).toHaveCount(0);
    await expect(member.getByRole("button", { name: "Manage billing", exact: true })).toHaveCount(
      0,
    );
    await selectCategory(member, "Appearance");
    await expect(member.getByRole("button", { name: "Forest", exact: true })).toBeEnabled();
    await expect(
      member.getByRole("textbox", { name: "Brand display name", exact: true }),
    ).toHaveValue("Settings Company");
    await member.setViewportSize({ width: 320, height: 900 });
    await setAppearance(member, "Dark");
    await expectAccessibleSettings(member);
    await capture(member, testInfo, "organization-member-appearance-mobile-dark");
    await selectCategory(member, "Overview");
    await expectAccessibleSettings(member);
    await capture(member, testInfo, "organization-member-overview-mobile-dark");
  } finally {
    await memberContext.close();
  }
});
