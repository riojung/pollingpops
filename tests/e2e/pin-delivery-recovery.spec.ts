import { expect, test, type Page } from "@playwright/test";
import {
  acceptCreatorPolicies,
  expectAnonymousCreator,
  submitCreatorPin,
  verifyCreatorEmail,
} from "../support/creator-auth";
import { testEmail } from "./test-email";

async function startPinRequest(page: Page, email: string) {
  const form = page.getByRole("form", { name: "Sign in by email", exact: true });
  await form.getByLabel("Email address").fill(email);
  await acceptCreatorPolicies(page);
  await form.getByRole("button", { name: "Send sign-in PIN", exact: true }).click();
}

test("PIN entry precedes delivery, survives reload, and keeps a usable PIN after denied resend", async ({
  page,
}, testInfo) => {
  const email = testEmail("pin-pending", testInfo);
  const { apiOrigin } = await verifyCreatorEmail(page, email, { returnTo: "/account" });
  await page.clock.install();
  let release!: () => void;
  let received!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    received = resolve;
  });
  let pin = "";
  let challengeId = "";
  let requests = 0;
  await page.route(`${apiOrigin}/v1/auth/pin/request`, async (route) => {
    requests += 1;
    const response = await route.fetch();
    const body = await response.json();
    expect(response.status()).toBe(202);
    pin = body.debugPin;
    challengeId = body.challengeId;
    received();
    await gate;
    await route.fulfill({ response });
  });
  await startPinRequest(page, email);
  await ready;
  const form = page.getByRole("form", { name: "Verify sign-in PIN", exact: true });
  const input = form.getByLabel("Sign-in PIN", { exact: true });
  const submit = form.getByRole("button", { name: "Sign in", exact: true });
  await expect(input).toBeEnabled();
  await input.fill(pin);
  await expect(submit).toBeDisabled();
  await expectAnonymousCreator(page, apiOrigin);
  release();
  await expect(submit).toBeEnabled();
  await expect(input).toHaveValue(pin);
  await expect(page).toHaveURL((url) => !url.searchParams.has("verified"));
  await page.reload();
  await expect(input).toHaveValue("");
  expect(requests).toBe(1);
  // A browser-only clock advance exposes the resend control without weakening
  // the server's real cooldown. The backend must deny this early resend.
  await page.clock.fastForward(61_000);
  await page.unroute(`${apiOrigin}/v1/auth/pin/request`);
  let deny!: () => void;
  let denied!: () => void;
  const denialGate = new Promise<void>((resolve) => {
    deny = resolve;
  });
  const denialReady = new Promise<void>((resolve) => {
    denied = resolve;
  });
  await page.route(`${apiOrigin}/v1/auth/pin/request`, async (route) => {
    requests += 1;
    const response = await route.fetch();
    expect(response.status()).toBe(429);
    expect(Number(response.headers()["retry-after"])).toBeGreaterThan(0);
    denied();
    await denialGate;
    await route.fulfill({ response });
  });
  await input.fill("000000");
  await page.getByRole("button", { name: "Send a new PIN", exact: true }).click();
  await denialReady;
  await input.fill(pin);
  deny();
  await expect(page.getByRole("status")).toContainText("You can still use the PIN");
  await expect(input).toHaveValue(pin);
  await expect(submit).toBeEnabled();
  await expectAnonymousCreator(page, apiOrigin);
  const verifying = page.waitForRequest((request) => request.url().endsWith("/v1/auth/pin/verify"));
  await submitCreatorPin(page, pin);
  expect((await verifying).postDataJSON()).toEqual({ challengeId, pin });
  await expect(page).toHaveURL(/\/account$/);
  expect(requests).toBe(2);
});

test("an interrupted initial PIN request stays actionable and retries only after explicit resend", async ({
  page,
}, testInfo) => {
  const email = testEmail("pin-interrupted", testInfo);
  const { apiOrigin } = await verifyCreatorEmail(page, email, { returnTo: "/account" });
  await page.clock.install();
  let requests = 0;
  await page.route(`${apiOrigin}/v1/auth/pin/request`, async (route) => {
    requests += 1;
    await route.abort("connectionfailed");
  });
  await startPinRequest(page, email);
  await expect(page.getByRole("status")).toContainText("The PIN request was interrupted");
  const input = page.getByLabel("Sign-in PIN", { exact: true });
  await expect(input).toBeEnabled();
  await input.fill("012345");
  const form = page.getByRole("form", { name: "Verify sign-in PIN", exact: true });
  await expect(form.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resend in 60s", exact: true })).toBeDisabled();
  await expectAnonymousCreator(page, apiOrigin);
  await page.clock.fastForward(60_000);
  expect(requests).toBe(1);
  await page.unroute(`${apiOrigin}/v1/auth/pin/request`);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/auth/pin/request") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send a new PIN", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(202);
  const { debugPin } = await response.json();
  await submitCreatorPin(page, debugPin);
  await expect(page).toHaveURL(/\/account$/);
});
