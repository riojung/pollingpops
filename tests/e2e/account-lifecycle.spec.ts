import {
  expectAnonymousCreator,
  requestCreatorPin,
  signInCreator,
  submitCreatorPin,
  verifyCreatorEmail,
} from "../support/creator-auth";
import { expect, test } from "@playwright/test";

import { testEmail } from "./test-email";

test("creator can return to signed-in Home and sign out on a narrow screen", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const mobileSignInLink = page
    .locator(".site-mobile-actions")
    .getByRole("link", { name: "Sign in", exact: true });
  await mobileSignInLink.click();
  await page.waitForURL(/\/signin$/, { waitUntil: "load" });

  await signInCreator(page, testEmail("navigation", testInfo));
  await page.goto("/");
  const publicHeaderBrand = page
    .locator("header.site-header")
    .getByRole("link", { name: "Polling Pops", exact: true });
  await expect(publicHeaderBrand).toHaveAttribute("href", "/home");
  await publicHeaderBrand.click();
  await expect(page).toHaveURL(/\/home/);

  // Explicit classic authoring stays available for workspaces without builderV2.
  await page.goto("/dashboard");
  await page.getByLabel("Checkpoint set title").fill("Navigation quiz");
  await page.getByRole("button", { name: "Create checkpoint set" }).click();
  await expect(page).toHaveURL(/\/quiz\//);
  const creatorBrand = page.getByRole("link", { name: "Polling Pops" });
  await expect(creatorBrand).toHaveAttribute("href", "/home");
  await creatorBrand.click();
  await expect(page).toHaveURL(/\/home/);
  await expect(
    page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "Navigation quiz", exact: true }) }),
  ).toHaveCount(1);

  await page.goto("/");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Mobile navigation", exact: true })
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(mobileSignInLink).toBeVisible();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/signin/);
});

test("creator can archive, restore, export, and delete their account", async ({
  page,
}, testInfo) => {
  await signInCreator(page, testEmail("lifecycle", testInfo), { returnTo: "/dashboard" });

  await page.getByLabel("Checkpoint set title").fill("Lifecycle quiz");
  await page.getByRole("button", { name: "Create checkpoint set" }).click();
  await expect(page).toHaveURL(/\/quiz\//);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const quizCard = page.getByRole("article").filter({ hasText: "Lifecycle quiz" });
  await quizCard.getByRole("button", { name: "Archive" }).click();
  await expect(quizCard).toHaveCount(0);

  await page.getByLabel("Include archived sets").check();
  const archivedCard = page.getByRole("article").filter({ hasText: "Lifecycle quiz" });
  await expect(archivedCard.getByText("archived", { exact: true })).toBeVisible();
  await archivedCard.getByRole("button", { name: "Restore" }).click();
  await expect(archivedCard.getByText("draft", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Account", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download account export" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("polling-pops-account-export.json");
  await expect(page.getByRole("status")).toContainText("account export was downloaded");

  await page.getByLabel(/Type DELETE/).fill("DELETE");
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/signin/);
});

test("workspace owner invites a viewer with read-only access", async ({ browser }, testInfo) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signInCreator(owner, testEmail("workspace-owner", testInfo), { returnTo: "/dashboard" });
  const ownerIdentity = await (await owner.request.get("http://127.0.0.1:4100/v1/auth/me")).json();

  await owner.getByLabel("Checkpoint set title").fill("Shared safety check");
  await owner.getByRole("button", { name: "Create checkpoint set" }).click();
  await owner.getByRole("link", { name: "Dashboard" }).click();
  await owner.getByRole("link", { name: "Account", exact: true }).click();

  const viewerEmail = testEmail("workspace-viewer", testInfo);
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  // An existing account has its own workspace before accepting this invitation.
  // Verification leaves it anonymous, so its first PIN must select the invited one.
  await verifyCreatorEmail(viewer, viewerEmail);
  await owner.getByLabel("Email address").fill(viewerEmail);
  await owner.getByLabel("Role").selectOption("viewer");
  await owner.getByRole("button", { name: "Invite member" }).click();
  await expect(owner.getByRole("status")).toContainText(`Invitation sent to ${viewerEmail}`);
  const invitationUrl = await owner
    .getByRole("link", { name: "open invitation" })
    .getAttribute("href");
  expect(invitationUrl).toBeTruthy();

  await viewer.goto(invitationUrl!);
  await viewer.getByLabel(/I accept the Terms/).check();
  const accepted = viewer.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/invitations/accept",
  );
  await viewer.getByRole("button", { name: "Accept invitation" }).click();
  const invitationResponse = await accepted;
  expect(invitationResponse.status()).toBe(200);
  expect(invitationResponse.headers()["set-cookie"]).toBeUndefined();
  await expect(viewer).toHaveURL(
    (url) => url.pathname === "/signin" && url.searchParams.get("verified") === "1",
  );
  await expectAnonymousCreator(viewer, new URL(invitationResponse.url()).origin);
  const { pin } = await requestCreatorPin(viewer, viewerEmail);
  await submitCreatorPin(viewer, pin);
  await expect(viewer).toHaveURL(/\/home\?invitation=accepted/);
  await expect(viewer.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  expect(await (await viewer.request.get("http://127.0.0.1:4100/v1/auth/me")).json()).toMatchObject(
    {
      creator: {
        email: viewerEmail,
        role: "viewer",
        workspaceId: ownerIdentity.creator.workspaceId,
      },
    },
  );
  await expect(viewer.getByRole("button", { name: "Create", exact: true })).toHaveCount(0);
  await viewer.goto("/dashboard");
  await expect(viewer.getByText("Viewer access is read-only")).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Create checkpoint set" })).toHaveCount(0);
  const sharedSet = viewer.getByRole("article").filter({ hasText: "Shared safety check" });
  await expect(sharedSet.getByRole("link", { name: "View" })).toBeVisible();
  await expect(sharedSet.getByRole("button", { name: "Host" })).toHaveCount(0);

  await viewerContext.close();
  await ownerContext.close();
});
