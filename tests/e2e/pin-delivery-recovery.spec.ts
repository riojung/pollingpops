import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { setTimeout as waitForCooldown } from "node:timers/promises";
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

async function expectSignInContinuation(page: Page) {
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Account access", exact: true })).toHaveCount(0);
  await expect(page.getByText(/Need an account\?/)).toHaveCount(0);
}

async function captureAuthStage(page: Page, testInfo: TestInfo, stage: string) {
  const originalViewport = page.viewportSize();
  for (const [name, width, height] of [
    ["desktop", 1280, 900],
    ["mobile", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({ path: testInfo.outputPath(`${stage}-${name}.png`), fullPage: true });
  }
  if (originalViewport) await page.setViewportSize(originalViewport);
}

test("PIN entry precedes delivery, survives reload, and keeps a usable PIN after denied resend", async ({
  page,
}, testInfo) => {
  const email = testEmail("pin-pending", testInfo);
  const { apiOrigin } = await verifyCreatorEmail(page, email, { returnTo: "/account" });
  await expectSignInContinuation(page);
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
  await expectSignInContinuation(page);
  await input.fill(pin);
  await expect(submit).toBeDisabled();
  await expectAnonymousCreator(page, apiOrigin);
  release();
  await expect(submit).toBeEnabled();
  await expect(input).toHaveValue(pin);
  await expect(page).toHaveURL((url) => !url.searchParams.has("verified"));
  await page.reload();
  await expect(input).toHaveValue("");
  await expectSignInContinuation(page);
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
  await expectSignInContinuation(page);
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
  await expectSignInContinuation(page);
  await expect(page.getByLabel("Sign-in PIN", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resend in 60s", exact: true })).toBeDisabled();
  await expectAnonymousCreator(page, apiOrigin);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("The PIN request was interrupted");
  await expectSignInContinuation(page);
  await expect(page.getByLabel("Sign-in PIN", { exact: true })).toHaveCount(0);
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

test("verification and restored PIN keep the organization destination without restarting signup", async ({
  page,
}, testInfo) => {
  const email = testEmail("verified-organization-return", testInfo);
  const returnTo = `/organization/invite?token=${"A".repeat(43)}`;
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(new URL(request.url()).pathname);
  });
  const { apiOrigin } = await verifyCreatorEmail(page, email, {
    returnTo,
    verificationUrl: async (response) => {
      await expectSignInContinuation(page);
      return (await response.json()).debugUrl;
    },
  });
  await expectSignInContinuation(page);
  await captureAuthStage(page, testInfo, "verified");
  await page.reload();
  await expectSignInContinuation(page);
  await expect(page.getByRole("form", { name: "Sign in by email", exact: true })).toBeVisible();
  expect(posts.filter((path) => path === "/v1/auth/pin/request")).toHaveLength(0);
  await expectAnonymousCreator(page, apiOrigin);

  const requested = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/auth/pin/request") && response.request().method() === "POST",
  );
  await startPinRequest(page, email);
  const response = await requested;
  expect(response.status()).toBe(202);
  expect(response.request().postDataJSON()).toMatchObject({ email, returnTo });
  const { debugPin } = await response.json();
  const pinInput = page.getByLabel("Sign-in PIN", { exact: true });
  await expect(pinInput).toBeVisible();
  await expectSignInContinuation(page);
  await captureAuthStage(page, testInfo, "pin");

  // A stale signup entry URL must not discard a live, accepted sign-in challenge.
  const staleSignup = new URL(page.url());
  staleSignup.searchParams.set("mode", "signup");
  staleSignup.searchParams.set("accountType", "organization");
  await page.goto(staleSignup.href);
  await expect(pinInput).toBeVisible();
  await expectSignInContinuation(page);
  await expect(page).toHaveURL((url) => url.searchParams.get("returnTo") === returnTo);
  await page.reload();
  await expect(pinInput).toHaveValue("");
  await expectSignInContinuation(page);
  expect(posts.filter((path) => path === "/v1/auth/pin/request")).toHaveLength(1);
  await submitCreatorPin(page, debugPin);
  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === returnTo);
  await expect(
    page.getByRole("heading", { name: "Organization invitation", exact: true }),
  ).toBeVisible();
  const workspaces = await (await page.request.get(`${apiOrigin}/v1/workspaces`)).json();
  expect(workspaces.workspaces).toHaveLength(1);
  expect(posts.filter((path) => path === "/v1/auth/email-verification")).toHaveLength(1);
  expect(posts.filter((path) => path === "/v1/auth/magic-link")).toHaveLength(0);
  expect(posts.filter((path) => path === "/v1/customer/setup")).toHaveLength(0);
});

test("an initial throttled request keeps sign-in recovery through reload without inventing a PIN handle", async ({
  page,
}, testInfo) => {
  const email = testEmail("pin-initial-throttled", testInfo);
  const { apiOrigin } = await verifyCreatorEmail(page, email, { returnTo: "/account" });
  // A real request from another tab already started this email's server cooldown.
  const otherTab = await page.request.post(`${apiOrigin}/v1/auth/pin/request`, {
    headers: { origin: new URL(page.url()).origin },
    data: { email, acceptPolicies: true, returnTo: "/account" },
  });
  expect(otherTab.status()).toBe(202);
  let requests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/v1/auth/pin/request"))
      requests += 1;
  });
  const denied = page.waitForResponse(
    (response) => response.url().endsWith("/v1/auth/pin/request") && response.status() === 429,
  );
  await startPinRequest(page, email);
  expect(Number((await denied).headers()["retry-after"])).toBeGreaterThan(0);
  await expect(page.getByRole("status")).toContainText("use the original tab");
  await expectSignInContinuation(page);
  await expect(page.getByLabel("Sign-in PIN", { exact: true })).toHaveCount(0);
  await page.reload();
  await expectSignInContinuation(page);
  await expect(page.getByRole("status")).toContainText("use the original tab");
  await expect(page.getByLabel("Sign-in PIN", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Resend in \d+s$/ })).toBeDisabled();
  expect(requests).toBe(1);
  await expectAnonymousCreator(page, apiOrigin);
});

test("Use another email explicitly clears the accepted challenge and returns to fresh account access", async ({
  page,
}, testInfo) => {
  const email = testEmail("pin-change-identity", testInfo);
  const { apiOrigin } = await verifyCreatorEmail(page, email, { returnTo: "/account" });
  const requested = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/auth/pin/request") && response.request().method() === "POST",
  );
  await startPinRequest(page, email);
  const { debugPin } = await (await requested).json();
  const form = page.getByRole("form", { name: "Verify sign-in PIN", exact: true });
  await form.getByLabel("Sign-in PIN", { exact: true }).fill(debugPin);
  await expect(form.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await expectSignInContinuation(page);
  await page.getByRole("button", { name: "Use another email", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeVisible();
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue("");
  await expect(page.getByLabel(/I accept the Terms/)).not.toBeChecked();
  await expect(page.getByLabel("Sign-in PIN", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(
    (url) => !url.searchParams.has("verified") && url.searchParams.get("returnTo") === "/account",
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeVisible();
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Sign-in PIN", { exact: true })).toHaveCount(0);
  await expectAnonymousCreator(page, apiOrigin);
});

test("an already verified email does not create another workspace or restart onboarding", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const email = testEmail("verified-signup-repeat", testInfo);
  const { apiOrigin } = await verifyCreatorEmail(page, email, { returnTo: "/account" });
  const requested = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/auth/pin/request") && response.request().method() === "POST",
  );
  await startPinRequest(page, email);
  const { debugPin } = await (await requested).json();
  await submitCreatorPin(page, debugPin);
  const original = await (await page.request.get(`${apiOrigin}/v1/auth/me`)).json();
  const session = (await page.context().cookies()).find(
    (cookie) => cookie.name === "openround_creator",
  )!;
  // Keep a separate read-only session to compare the existing identity after the anonymous attempt.
  await page.context().clearCookies({ name: session.name });
  await page.goto("/signin?mode=signup&returnTo=%2Faccount");
  const form = page.getByRole("form", { name: "Create account", exact: true });
  await form.getByLabel("Email address", { exact: true }).fill(email);
  await acceptCreatorPolicies(page);
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(new URL(request.url()).pathname);
  });
  const verification = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/auth/email-verification") &&
      response.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Send verification email", exact: true }).click();
  let response = await verification;
  let verificationRequests = 1;
  if (response.status() === 429) {
    const retryAfterSeconds = Number(response.headers()["retry-after"]);
    expect(retryAfterSeconds).toBeGreaterThan(0);
    // Repeated signup preserves the real verification cooldown for every mailbox.
    await waitForCooldown(retryAfterSeconds * 1000 + 100);
    const retry = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith("/v1/auth/email-verification") &&
        candidate.request().method() === "POST",
    );
    await form.getByRole("button", { name: "Send verification email", exact: true }).click();
    response = await retry;
    verificationRequests += 1;
  }
  expect(response.status()).toBe(202);
  expect(await response.json()).toEqual({ accepted: true });
  await expect(page.getByRole("status")).toContainText("Verification email requested");
  await expectSignInContinuation(page);
  await expectAnonymousCreator(page, apiOrigin);
  const headers = { cookie: `${session.name}=${session.value}` };
  const retained = await (await page.request.get(`${apiOrigin}/v1/auth/me`, { headers })).json();
  expect(retained.creator.userId).toBe(original.creator.userId);
  expect(retained.creator.workspaceId).toBe(original.creator.workspaceId);
  const workspaces = await (
    await page.request.get(`${apiOrigin}/v1/workspaces`, { headers })
  ).json();
  expect(workspaces.workspaces).toHaveLength(1);
  expect(posts.filter((path) => path === "/v1/auth/email-verification")).toHaveLength(
    verificationRequests,
  );
  expect(posts.filter((path) => path === "/v1/auth/pin/request")).toHaveLength(0);
  expect(posts.filter((path) => path === "/v1/customer/setup")).toHaveLength(0);
});

for (const scenario of [
  {
    name: "organization entry switched to Personal uses the personal default",
    initial: "organization",
    selected: "personal",
    destination: "/home?welcome=1",
  },
  {
    name: "personal entry switched to Organization keeps organization setup",
    initial: "personal",
    selected: "organization",
    destination: "/account/setup?type=organization",
  },
  {
    name: "an invitation return survives switching to Personal",
    initial: "organization",
    selected: "personal",
    explicitReturn: `/organization/invite?token=${"B".repeat(43)}`,
    destination: `/organization/invite?token=${"B".repeat(43)}`,
  },
  {
    name: "an explicit local return survives switching to Organization",
    initial: "personal",
    selected: "organization",
    explicitReturn: "/account?from=signup#privacy",
    destination: "/account?from=signup#privacy",
  },
] as const) {
  test(`account-type selection uses the correct destination: ${scenario.name}`, async ({
    page,
  }, testInfo) => {
    const email = testEmail(`type-${scenario.initial}-${scenario.selected}`, testInfo);
    const query = new URLSearchParams({ mode: "signup", accountType: scenario.initial });
    const explicitReturn = "explicitReturn" in scenario ? scenario.explicitReturn : undefined;
    if (explicitReturn) query.set("returnTo", explicitReturn);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(new URL(request.url()).pathname);
    });
    await page.goto(`/signin?${query}`);
    const signup = page.getByRole("form", { name: "Create account", exact: true });
    const choice = (type: "personal" | "organization") =>
      signup.getByRole("button", {
        name: type === "personal" ? "Personal workspace" : "Organization workspace",
        exact: true,
      });
    await expect(choice(scenario.initial)).toHaveAttribute("aria-pressed", "true");
    await choice(scenario.selected).click();
    await expect(choice(scenario.selected)).toHaveAttribute("aria-pressed", "true");
    await signup.getByLabel("Email address", { exact: true }).fill(email);
    await acceptCreatorPolicies(page);
    const verification = page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/auth/email-verification") &&
        response.request().method() === "POST",
    );
    await signup.getByRole("button", { name: "Send verification email", exact: true }).click();
    const response = await verification;
    expect(response.status()).toBe(202);
    const body = response.request().postDataJSON();
    const signupReturn =
      explicitReturn ??
      (scenario.selected === "organization" ? "/account/setup?type=organization" : undefined);
    if (signupReturn) expect(body.returnTo).toBe(signupReturn);
    else expect(body).not.toHaveProperty("returnTo");
    const apiOrigin = new URL(response.url()).origin;
    const { debugUrl } = await response.json();
    await expectAnonymousCreator(page, apiOrigin);
    await page.goto(debugUrl);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/signin" &&
        url.searchParams.get("verified") === "1" &&
        url.searchParams.get("returnTo") === scenario.destination,
    );
    await page.reload();
    await expectSignInContinuation(page);
    expect(posts.filter((path) => path === "/v1/auth/pin/request")).toHaveLength(0);
    const requested = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith("/v1/auth/pin/request") && candidate.request().method() === "POST",
    );
    await startPinRequest(page, email);
    const pinResponse = await requested;
    expect(pinResponse.status()).toBe(202);
    expect(pinResponse.request().postDataJSON()).toMatchObject({
      email,
      returnTo: scenario.destination,
    });
    const { debugPin } = await pinResponse.json();
    await submitCreatorPin(page, debugPin);
    await expect(page).toHaveURL(
      (url) => `${url.pathname}${url.search}${url.hash}` === scenario.destination,
    );
    if (scenario.destination === "/account/setup?type=organization")
      await expect(
        page.getByRole("textbox", { name: "Organization name", exact: true }),
      ).toBeVisible();
    const identity = await (await page.request.get(`${apiOrigin}/v1/auth/me`)).json();
    expect(identity.creator.email).toBe(email);
    expect(identity.workspace.accountType).toBe("personal");
    const workspaces = await (await page.request.get(`${apiOrigin}/v1/workspaces`)).json();
    expect(workspaces.workspaces).toHaveLength(1);
    expect(posts.filter((path) => path === "/v1/auth/email-verification")).toHaveLength(1);
    expect(posts.filter((path) => path === "/v1/customer/setup")).toHaveLength(0);
  });
}
