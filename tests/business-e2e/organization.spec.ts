import { expect, test, type Page } from "@playwright/test";
import { testEmail } from "../e2e/test-email";

const api = "http://127.0.0.1:4300";
async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Workplace learning", exact: true }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();
}

test("organization owner invites billing-only administrator and funds a premium Round with one event credit", async ({
  page: owner,
  browser,
}, testInfo) => {
  const ownerEmail = testEmail("business-owner", testInfo);
  const financeEmail = testEmail("business-finance", testInfo);
  await signIn(owner, ownerEmail);
  await expect(owner).toHaveURL(/\/dashboard/);
  const ownerIdentity = (await (await owner.request.get(`${api}/v1/auth/me`)).json()).creator as {
    userId: string;
  };
  await owner.goto("/account");
  await owner.getByRole("link", { name: "Organization and billing", exact: true }).click();
  await expect(owner.getByRole("heading", { name: "Organization", exact: true })).toBeVisible();
  await owner.getByLabel("Organization name", { exact: true }).fill("Browser business launch");
  await owner.getByRole("button", { name: "Create organization", exact: true }).click();
  await expect(owner.getByRole("combobox", { name: "Organization", exact: true })).toHaveValue(
    /.+/,
  );
  await expect(
    owner.getByRole("combobox", { name: "Organization", exact: true }).locator("option:checked"),
  ).toHaveText("Browser business launch");
  const organizationId = await owner
    .getByRole("combobox", { name: "Organization", exact: true })
    .inputValue();
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
  await expect(finance.getByText(financeEmail, { exact: true })).toBeVisible();
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
  await audience.getByLabel("Nickname", { exact: true }).fill("Audience member");
  await audience.getByRole("button", { name: "Join Round", exact: true }).click();
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
