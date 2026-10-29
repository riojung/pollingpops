import { setTimeout as waitForCooldown } from "node:timers/promises";
import { expect, type Page, type Response } from "@playwright/test";

const verifiedAccounts = new Set<string>();
const pinCooldowns = new Map<string, number>();

function accountKey(page: Page, email: string) {
  return `${new URL(page.url()).origin}\n${email.trim().toLowerCase()}`;
}

export interface CreatorAuthOptions {
  segment?: "education" | "workplace";
  signinUrl?: string;
  returnTo?: string;
  verificationUrl?: (response: Response) => Promise<string>;
  signInPin?: (response: Response) => Promise<string>;
}

// Exercise the real checkbox keyboard path, including Firefox's native activation.
export async function acceptCreatorPolicies(page: Page) {
  const policyConsent = page.getByLabel(/I accept the Terms/);
  await expect(policyConsent).toBeEnabled();
  await expect(policyConsent).not.toBeChecked();
  await policyConsent.focus();
  await expect(policyConsent).toBeFocused();
  await policyConsent.press("Space");
  await expect(policyConsent).toBeChecked();
}

export async function expectAnonymousCreator(page: Page, apiOrigin: string) {
  expect(
    (await page.context().cookies()).filter((cookie) => cookie.name === "openround_creator"),
  ).toEqual([]);
  expect((await page.request.get(`${apiOrigin}/v1/auth/me`)).status()).toBe(401);
}

function waitForAuthResponse(page: Page, pathname: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === pathname,
  );
}

function signinPath(options: CreatorAuthOptions) {
  const path = options.signinUrl ?? "/signin";
  return options.returnTo
    ? `${path}${path.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(options.returnTo)}`
    : path;
}

async function debugCredential(response: Response, field: "debugUrl" | "debugPin") {
  // Only the guarded local/test response is read; the product never displays credentials.
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(response.url()).hostname);
  const result = await response.json();
  expect(result.accepted).toBe(true);
  expect(typeof result[field]).toBe("string");
  return result[field] as string;
}

async function waitForEmailAccess(page: Page) {
  const address = page.getByRole("textbox", { name: "Email address", exact: true });
  const anotherEmail = page.getByRole("button", { name: "Use another email", exact: true });
  await expect(address.or(anotherEmail).first()).toBeEnabled();
}

export async function verifyCreatorEmail(
  page: Page,
  email: string,
  options: CreatorAuthOptions = {},
) {
  await page.context().clearCookies({ name: "openround_creator" });
  await page.goto(signinPath(options));
  await waitForEmailAccess(page);
  const createAccount = page.getByRole("button", { name: "Create account", exact: true });
  if (!(await createAccount.isVisible()))
    await page.getByRole("button", { name: "Use another email", exact: true }).click();
  await createAccount.click();
  const form = page.getByRole("form", { name: "Create account", exact: true });
  const segment = options.segment ?? "workplace";
  const segmentChoice = form.getByRole("button", {
    name: segment === "education" ? "Education" : "Workplace learning",
    exact: true,
  });
  await segmentChoice.click();
  await expect(segmentChoice).toHaveAttribute("aria-pressed", "true");
  await form.getByLabel("Email address").fill(email);
  await acceptCreatorPolicies(page);
  const sendVerification = form.getByRole("button", {
    name: "Send verification email",
    exact: true,
  });
  await expect(sendVerification).toBeEnabled();
  const [response] = await Promise.all([
    waitForAuthResponse(page, "/v1/auth/email-verification"),
    sendVerification.click(),
  ]);
  expect(response.status()).toBe(202);
  expect(response.request().postDataJSON()).toMatchObject({
    email: email.trim().toLowerCase(),
    segment,
    acceptPolicies: true,
  });
  const apiOrigin = new URL(response.url()).origin;
  await expectAnonymousCreator(page, apiOrigin);
  await expect(page.getByRole("link", { name: "Continue to dashboard", exact: true })).toHaveCount(
    0,
  );
  const verificationUrl = options.verificationUrl
    ? await options.verificationUrl(response)
    : await debugCredential(response, "debugUrl");
  await page.goto(verificationUrl);
  await expect(page).toHaveURL(
    (url) => url.pathname === "/signin" && url.searchParams.get("verified") === "1",
  );
  await expect(page.getByRole("status")).toContainText("Email verified. Sign in to request a PIN.");
  await expectAnonymousCreator(page, apiOrigin);
  verifiedAccounts.add(accountKey(page, email));
  return { apiOrigin, verificationUrl };
}

export async function requestCreatorPin(
  page: Page,
  email: string,
  options: CreatorAuthOptions = {},
) {
  const key = accountKey(page, email);
  const remainingCooldown = (pinCooldowns.get(key) ?? 0) - Date.now();
  if (remainingCooldown > 0) await waitForCooldown(remainingCooldown);
  // A verification redirect never submits this separate sign-in request.
  await waitForEmailAccess(page);
  const emailAddress = page.getByRole("textbox", { name: "Email address", exact: true });
  if (!(await emailAddress.isVisible()))
    await page.getByRole("button", { name: "Use another email", exact: true }).click();
  const form = page.getByRole("form", { name: "Sign in by email", exact: true });
  if (!(await form.isVisible()))
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await form.getByLabel("Email address").fill(email);
  await acceptCreatorPolicies(page);
  const sendPin = form.getByRole("button", { name: "Send sign-in PIN", exact: true });
  await expect(sendPin).toBeEnabled();
  const [response] = await Promise.all([
    waitForAuthResponse(page, "/v1/auth/pin/request"),
    sendPin.click(),
  ]);
  expect(response.status()).toBe(202);
  expect(response.request().postDataJSON()).toMatchObject({
    email: email.trim().toLowerCase(),
    acceptPolicies: true,
  });
  const challenge = (await response.json()) as {
    challengeId: string;
    expiresInSeconds: number;
    resendAfterSeconds: number;
  };
  expect(challenge.challengeId).toBeTruthy();
  expect(challenge.expiresInSeconds).toBe(600);
  expect(challenge.resendAfterSeconds).toBe(60);
  pinCooldowns.set(key, Date.now() + challenge.resendAfterSeconds * 1_000);
  const pin = options.signInPin
    ? await options.signInPin(response)
    : await debugCredential(response, "debugPin");
  expect(pin).toMatch(/^\d{6}$/);
  await expect(page.getByText(pin, { exact: true })).toHaveCount(0);
  await expectAnonymousCreator(page, new URL(response.url()).origin);
  return { pin, challengeId: challenge.challengeId };
}

export async function submitCreatorPin(page: Page, pin: string) {
  const form = page.getByRole("form", { name: "Verify sign-in PIN", exact: true });
  await form.getByLabel("Sign-in PIN", { exact: true }).fill(pin);
  const destination = page.waitForURL(
    (url) => url.pathname !== "/signin" && url.pathname !== "/auth/locale",
    { waitUntil: "load" },
  );
  const [response] = await Promise.all([
    waitForAuthResponse(page, "/v1/auth/pin/verify"),
    form.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  // The app navigates immediately after consuming JSON. Fence the loaded page
  // without reading a response body that Chromium may already have discarded.
  await destination;
  expect(
    (await page.context().cookies()).some((cookie) => cookie.name === "openround_creator"),
  ).toBe(true);
}

export async function signInCreator(page: Page, email: string, options: CreatorAuthOptions = {}) {
  await page.goto(signinPath(options));
  if (verifiedAccounts.has(accountKey(page, email))) {
    await page.context().clearCookies({ name: "openround_creator" });
  } else {
    await verifyCreatorEmail(page, email, options);
  }
  const { pin } = await requestCreatorPin(page, email, options);
  await submitCreatorPin(page, pin);
}
