import { signInCreator } from "../support/creator-auth";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { testEmail } from "../e2e/test-email";

const api = "http://127.0.0.1:4300";
async function signIn(page: Page, email: string) {
  await signInCreator(page, email);
}

async function createLegacyOrganization(page: Page, name: string) {
  const response = await page.request.post(`${api}/v1/organizations`, {
    headers: { "x-idempotency-key": randomUUID() },
    data: { name },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { organization: { id: string } }).organization;
}

async function expectSectionAtTop(page: Page, section: string, maxTop = 60) {
  await expect
    .poll(async () =>
      page
        .locator(section)
        .evaluate((element) => ({
          top: element.getBoundingClientRect().top,
          scroll: window.scrollY,
        }))
        .then(({ top, scroll }) => top >= 0 && top <= maxTop && scroll > 200),
    )
    .toBe(true);
}

test("organization workspace links scroll to delayed sections and preserve later manual scrolling", async ({
  page,
}, testInfo) => {
  await signIn(page, testEmail("business-section-scroll", testInfo));
  const firstId = (await createLegacyOrganization(page, "First scrolling organization")).id;
  const secondId = (await createLegacyOrganization(page, "Second scrolling organization")).id;
  await page.reload();

  let releaseCollection!: () => void;
  const collectionGate = new Promise<void>((resolve) => {
    releaseCollection = resolve;
  });
  let collectionStarted!: () => void;
  const collectionPending = new Promise<void>((resolve) => {
    collectionStarted = resolve;
  });
  await page.route(`${api}/v1/organizations`, async (route) => {
    if (route.request().method() === "GET") {
      collectionStarted();
      await collectionGate;
    }
    await route.continue();
  });
  const organizationNavigation = page
    .getByRole("complementary")
    .getByRole("region", { name: "Organization management", exact: true });
  await organizationNavigation.getByRole("link", { name: "Billing", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/organization\\?organizationId=${firstId}#billing$`));
  await collectionPending;
  await expect(page.locator("#billing")).toHaveCount(0);
  releaseCollection();
  await expectSectionAtTop(page, "#billing");
  await page.unroute(`${api}/v1/organizations`);

  // An ordinary financial refresh must not reapply the already-served fragment.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  const refreshed = page.waitForResponse((response) =>
    response.url().endsWith(`/organizations/${firstId}/billing`),
  );
  await page
    .getByRole("button", { name: "Refresh billing", exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await (await refreshed).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Native history updates from the organization picker keep the same fragment,
  // but must wait for the new organization's sections rather than scroll old data.
  let releaseDetails!: () => void;
  const detailsGate = new Promise<void>((resolve) => {
    releaseDetails = resolve;
  });
  let detailsStarted!: () => void;
  const detailsPending = new Promise<void>((resolve) => {
    detailsStarted = resolve;
  });
  await page.route(`${api}/v1/organizations/${secondId}/**`, async (route) => {
    if (route.request().method() === "GET") {
      detailsStarted();
      await detailsGate;
    }
    await route.continue();
  });
  await page.getByRole("combobox", { name: "Organization", exact: true }).selectOption(secondId);
  await detailsPending;
  await expect(page).toHaveURL(new RegExp(`/organization\\?organizationId=${secondId}#billing$`));
  await expect(page.locator("#billing")).toHaveCount(0);
  releaseDetails();
  await expectSectionAtTop(page, "#billing");
  await page.unroute(`${api}/v1/organizations/${secondId}/**`);

  // Existing hash-only section links still work once the sections have mounted.
  await page
    .getByRole("navigation", { name: "Organization management sections" })
    .getByRole("link", { name: "Members", exact: true })
    .click();
  await expect(page).toHaveURL(/#members$/);
  await expectSectionAtTop(page, "#members");
});

test("organization owner invites billing-only administrator and funds a premium Round with one event credit", async ({
  page: owner,
  browser,
}, testInfo) => {
  // This journey signs the same account in twice and honors the real PIN resend cooldown.
  test.setTimeout(150_000);
  const ownerEmail = testEmail("business-owner", testInfo);
  const financeEmail = testEmail("business-finance", testInfo);
  await signIn(owner, ownerEmail);
  await expect(owner).toHaveURL(/\/home\?welcome=1$/);
  const ownerIdentity = (await (await owner.request.get(`${api}/v1/auth/me`)).json()).creator as {
    userId: string;
  };
  const organizationId = (await createLegacyOrganization(owner, "Browser business launch")).id;
  await owner.reload();
  const organizationNavigation = owner
    .getByRole("complementary")
    .getByRole("region", { name: "Organization management", exact: true });
  await expect(
    organizationNavigation.getByRole("link", { name: "Members", exact: true }),
  ).toBeVisible();
  await organizationNavigation.getByRole("link", { name: "Organization", exact: true }).click();
  await expect(owner.getByRole("heading", { name: "Organization", exact: true })).toBeVisible();
  await expect(owner.getByRole("combobox", { name: "Organization", exact: true })).toHaveValue(
    /.+/,
  );
  await expect(
    owner.getByRole("combobox", { name: "Organization", exact: true }).locator("option:checked"),
  ).toHaveText("Browser business launch");
  await expect(owner.getByRole("combobox", { name: "Organization", exact: true })).toHaveValue(
    organizationId,
  );
  await owner.getByLabel("New workspace name", { exact: true }).fill("Training department");
  await owner.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(owner.getByText("Training department", { exact: true })).toBeVisible();
  const workspaceList = (await (
    await owner.request.get(`${api}/v1/organizations/${organizationId}/workspaces`)
  ).json()) as { workspaces: Array<{ id: string; name: string }> };
  const workspace = workspaceList.workspaces.find(
    (candidate) => candidate.name === "Training department",
  )!;
  const seeded = await owner.request.post(`${api}/__test/business/seed`, {
    data: { organizationId, actorId: ownerIdentity.userId, credits: 3 },
  });
  expect(seeded.ok()).toBe(true);
  await owner.getByRole("button", { name: "Refresh billing", exact: true }).click();
  await expect(
    owner.getByText("Event credits available", { exact: true }).locator(".."),
  ).toContainText("3");

  const financeContext = await browser.newContext();
  const finance = await financeContext.newPage();
  await signIn(finance, financeEmail);
  const financeIdentity = (await (await finance.request.get(`${api}/v1/auth/me`)).json())
    .creator as { userId: string };
  await owner.getByLabel("Invite by email", { exact: true }).fill(financeEmail);
  await owner
    .getByRole("combobox", { name: "Organization role", exact: true })
    .selectOption("billing");
  const invitationResponse = owner.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/organizations/${organizationId}/invitations`),
  );
  await owner.getByRole("button", { name: "Send invitation", exact: true }).click();
  const invitation = (await (await invitationResponse).json()) as { inviteUrl: string };
  await finance.goto(invitation.inviteUrl);
  await finance.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await finance.getByRole("link", { name: "Open organization", exact: true }).click();
  await expect(
    finance.getByText("Your organization role: billing administrator.", { exact: true }),
  ).toBeVisible();
  await expect(
    finance.getByRole("heading", { name: "Members and roles", exact: true }),
  ).toHaveCount(0);
  await expect(finance.getByRole("button", { name: "Create workspace", exact: true })).toHaveCount(
    0,
  );
  expect(
    (
      await owner.request.post(`${api}/__test/business/seed`, {
        data: {
          organizationId,
          actorId: ownerIdentity.userId,
          billingOnlyUserId: financeIdentity.userId,
        },
      })
    ).ok(),
  ).toBe(true);
  // A fresh email login with no workspace membership must still reach organization billing.
  await finance.request.post(`${api}/v1/auth/logout`, { data: {} });
  await signIn(finance, financeEmail);
  await expect(finance).toHaveURL(/\/organization/);
  await finance
    .getByRole("combobox", { name: "Organization", exact: true })
    .selectOption(organizationId);
  await expect(
    finance.getByRole("heading", { name: "Billing and event credits", exact: true }),
  ).toBeVisible();
  expect((await finance.request.get(`${api}/v1/quizzes`)).status()).toBe(401);
  await finance.goto("/account");
  await expect(
    finance.getByRole("heading", { name: "Personal account", exact: true }),
  ).toBeVisible();
  await expect(finance.getByRole("main").getByText(financeEmail, { exact: true })).toBeVisible();
  await finance.getByRole("tab", { name: "Privacy and data", exact: true }).click();
  await expect(
    finance.getByRole("button", { name: "Delete personal account", exact: true }),
  ).toBeDisabled();

  expect(
    (await owner.request.post(`${api}/v1/workspaces/${workspace.id}/select`, { data: {} })).ok(),
  ).toBe(true);
  await owner.goto("/dashboard");
  await owner.getByLabel("Checkpoint set title").fill("Business launch check");
  await owner.getByRole("button", { name: "Create checkpoint set", exact: true }).click();
  await owner.getByRole("button", { name: "True or false", exact: true }).click();
  await owner
    .getByRole("textbox", { name: "Checkpoint prompt", exact: true })
    .fill("This room uses one event credit.");
  await expect(owner.getByRole("status")).toContainText("Saved");
  await owner.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(owner.getByText("published", { exact: true })).toBeVisible();
  await owner.getByRole("link", { name: "Dashboard", exact: true }).click();
  await owner.getByRole("button", { name: "Host", exact: true }).click();
  await owner.getByLabel(/Use one credit for this room/).check();
  const audienceLimit = owner.getByRole("spinbutton", { name: /Maximum participants/ });
  await expect(audienceLimit).toHaveAttribute("max", "100");
  await audienceLimit.fill("80");
  await owner.getByRole("button", { name: "Create live session", exact: true }).click();
  await expect(owner).toHaveURL(/\/host\/(?!setup\/)[^/]+$/);
  const code = (await owner.locator(".session-code").textContent())!.trim();
  const reserved = await (
    await owner.request.get(`${api}/v1/organizations/${organizationId}/billing`)
  ).json();
  expect(reserved.balance).toMatchObject({ balance: 3, reserved: 1, available: 2 });
  const audienceContext = await browser.newContext();
  const audience = await audienceContext.newPage();
  await audience.goto(`/join?code=${code}`);
  await audience
    .getByRole("textbox", { name: /^Nickname(?: \(optional\))?$/ })
    .fill("Audience member");
  await audience.getByRole("button", { name: /^Join round$/i }).click();
  await expect(audience).toHaveURL(/\/play\//);
  const consumed = await (
    await owner.request.get(`${api}/v1/organizations/${organizationId}/billing`)
  ).json();
  expect(consumed.balance).toMatchObject({ balance: 2, reserved: 0, available: 2 });
  const authoring = await (await owner.request.get(`${api}/v1/auth/me`)).json();
  expect(authoring.entitlements.authoringJobsPerMonth).toBe(3);
  await audienceContext.close();
  await financeContext.close();
});

test("organization entry explains sign-in and disabled deployments without creation controls", async ({
  page,
}) => {
  await page.goto("/organization");
  await expect(
    page.getByRole("heading", { name: "Sign in to manage your organization" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create organization", exact: true })).toHaveCount(
    0,
  );
  await page.route(`${api}/v1/auth/navigation`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        user: null,
        organizationManagementEnabled: false,
        organizations: [],
        operatorConsoleOrigin: null,
      },
    });
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Organization management is unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create organization", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("Request failed (404)", { exact: true })).toHaveCount(0);
});

test("organization users receive separate licensed workspaces and an administrator cannot overbook licenses", async ({
  page: owner,
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const ownerEmail = testEmail("licensed-owner", testInfo);
  const memberEmail = testEmail("licensed-member", testInfo);
  const companyName = "ABC Sales Company";
  await signIn(owner, ownerEmail);
  const personal = await (await owner.request.get(`${api}/v1/auth/me`)).json();
  expect(personal.workspace.accountType).toBe("personal");
  expect(personal.entitlements.plan).toBe("free");

  await owner.goto("/account/setup?type=organization");
  await owner.getByLabel("Organization name", { exact: true }).fill(companyName);
  await owner.getByLabel("Your workspace name", { exact: true }).fill("Sales administrator");
  await owner
    .getByRole("combobox", { name: "Workspace type", exact: true })
    .selectOption("workplace");
  const setupResponse = owner.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/v1/customer/setup"),
  );
  await owner
    .getByRole("button", { name: "Create organization and workspace", exact: true })
    .click();
  const setupResult = await setupResponse;
  expect(setupResult.status()).toBe(201);
  await expect(owner).toHaveURL(/\/account#overview$/);
  const setup = await (await owner.request.get(`${api}/v1/auth/me`)).json();
  const organizationId = setup.workspace.organization.id as string;
  const ownerWorkspaceId = setup.creator.workspaceId as string;
  expect(ownerWorkspaceId).not.toBe(personal.creator.workspaceId);

  const seeded = await owner.request.post(`${api}/__test/business/seed`, {
    data: { organizationId, actorId: personal.creator.userId, creatorLicenseQuantity: 2 },
  });
  expect(seeded.ok()).toBe(true);
  await owner.goto(`/organization?organizationId=${organizationId}#members`);
  const people = owner.locator("#members");
  await expect(
    people.getByRole("heading", { name: "Members and roles", exact: true }),
  ).toBeVisible();
  const availability = people.getByLabel("User license availability");
  await expect(availability.getByText("Assigned", { exact: true }).locator("..")).toContainText(
    "1",
  );
  await expect(availability.getByText("Available", { exact: true }).locator("..")).toContainText(
    "1",
  );
  await expect(owner.getByRole("button", { name: "Assign license", exact: true })).toHaveCount(0);

  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  try {
    await signIn(member, memberEmail);
    const memberPersonal = await (await member.request.get(`${api}/v1/auth/me`)).json();
    await people.getByLabel("Invite by email", { exact: true }).fill(memberEmail);
    await people
      .getByRole("combobox", { name: "Organization role", exact: true })
      .selectOption("member");
    await people.getByLabel("User workspace name", { exact: true }).fill("Sales user workspace");
    const invitationResponse = owner.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/organizations/${organizationId}/invitations`),
    );
    await people.getByRole("button", { name: "Send invitation", exact: true }).click();
    const sentInvitation = await invitationResponse;
    expect(sentInvitation.status()).toBe(201);
    const invitation = await sentInvitation.json();
    await expect(
      availability.getByText("Reserved invitations", { exact: true }).locator(".."),
    ).toContainText("1");
    await expect(
      people.getByRole("button", { name: "Send invitation", exact: true }),
    ).toBeDisabled();
    const excess = await owner.request.post(
      `${api}/v1/organizations/${organizationId}/invitations`,
      {
        headers: { "x-idempotency-key": randomUUID() },
        data: {
          email: testEmail("licensed-overbook", testInfo),
          role: "member",
          workspaceName: "Overbooked workspace",
        },
      },
    );
    expect(excess.status()).toBe(409);
    expect((await excess.json()).error.code).toBe("LICENSE_LIMIT");

    await member.goto(invitation.inviteUrl);
    const acceptanceResponse = member.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/v1/organization-invitations/accept"),
    );
    await member.getByRole("button", { name: "Accept invitation", exact: true }).click();
    const acceptance = await acceptanceResponse;
    expect(acceptance.status()).toBe(200);
    const accepted = await acceptance.json();
    const memberWorkspaceId = (accepted.workspaceId ?? accepted.activeWorkspaceId) as string;
    expect(memberWorkspaceId).toBeTruthy();
    expect(memberWorkspaceId).not.toBe(ownerWorkspaceId);
    expect(memberWorkspaceId).not.toBe(memberPersonal.creator.workspaceId);
    await member.getByRole("link", { name: "Open your workspace", exact: true }).click();
    await expect(member).toHaveURL(/\/home$/);
    const context = await (await member.request.get(`${api}/v1/auth/me`)).json();
    expect(context.creator.workspaceId).toBe(memberWorkspaceId);
    expect(context.workspace).toMatchObject({
      accountType: "organization",
      name: "Sales user workspace",
      organization: { id: organizationId, name: companyName, role: "member" },
    });
    expect(context.entitlements.plan).toBe("team");
    const workspaceChip = member
      .locator('header a[href="/account"]')
      .filter({ hasText: companyName });
    await expect(workspaceChip).toContainText("Sales user workspace");
    await expect(member.getByRole("complementary").getByText(/Member · Team/)).toBeVisible();
    expect(
      (await member.request.get(`${api}/v1/organizations/${organizationId}/members`)).status(),
    ).toBe(403);
    expect(
      (
        await member.request.post(`${api}/v1/workspaces/${ownerWorkspaceId}/select`, { data: {} })
      ).status(),
    ).toBe(404);

    await owner.reload();
    await expect(availability.getByText("Assigned", { exact: true }).locator("..")).toContainText(
      "2",
    );
    await expect(
      availability.getByText("Reserved invitations", { exact: true }).locator(".."),
    ).toContainText("0");
    const memberRow = people
      .getByRole("listitem")
      .filter({ has: owner.getByText(memberEmail, { exact: true }) });
    owner.once("dialog", (dialog) => void dialog.accept());
    await memberRow.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(availability.getByText("Available", { exact: true }).locator("..")).toContainText(
      "1",
    );
    expect(
      (
        await member.request.post(`${api}/v1/workspaces/${memberWorkspaceId}/select`, { data: {} })
      ).status(),
    ).toBe(404);
    const retained = await (
      await owner.request.get(`${api}/v1/organizations/${organizationId}/workspaces`)
    ).json();
    expect(
      retained.workspaces.some((workspace: { id: string }) => workspace.id === memberWorkspaceId),
    ).toBe(true);
  } finally {
    await memberContext.close();
  }
});
