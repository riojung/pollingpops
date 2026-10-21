import { expect, test } from "@playwright/test";
import {
  expectAnonymousCreator,
  requestCreatorPin,
  submitCreatorPin,
  verifyCreatorEmail,
} from "../support/creator-auth";
import { testEmail } from "./test-email";

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
