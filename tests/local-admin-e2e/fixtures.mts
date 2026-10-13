import { request, expect, type BrowserContext, type Page } from "@playwright/test";

export const controlOrigin = "http://127.0.0.1:3302";
export const productOrigin = "http://127.0.0.1:3300";
export const apiOrigin = "http://127.0.0.1:4300";
export const adminEmail = "admin@pollingpops.local";
export const cookieNames = {
  session: "pollingpops-operator-local",
  csrf: "pollingpops-operator-csrf-local",
};
export const businessAreas = {
  organizations: "Tenant management",
  billing: "Billing",
  credits: "Credits and promotions",
  operations: "Operations",
  support: "Support",
  integrations: "Integrations",
  audit: "Audit",
};
interface FixtureState {
  operator: { id: string; name: string; role: string; active: boolean } | null;
  authenticated: boolean;
  sessionExists: boolean;
  balance: { balance: number } | null;
  ledgerEntries: number;
  restriction: { blocked: boolean } | null;
  auditActions: string[];
  issuerConfigured: boolean;
  mfaConfigured: boolean;
}

export async function localAdminHarness(context: BrowserContext) {
  // This request context has no browser cookie jar. Forward only cookies that
  // the browser actually sent; a missing product bridge cannot be repaired here.
  const transport = await request.newContext({ baseURL: apiOrigin });
  context.on("close", () => void transport.dispose());
  const cookie = async (name: string) =>
    (await context.cookies(controlOrigin)).find((entry) => entry.name === name)?.value;
  const cookieHeader = async () =>
    (await context.cookies(controlOrigin)).map(({ name, value }) => `${name}=${value}`).join("; ");
  await context.route(`${controlOrigin}/api/**`, async (route) => {
    const browserRequest = route.request();
    const url = new URL(browserRequest.url());
    const headers = await browserRequest.allHeaders();
    const response = await transport.post("/__test/local-admin/control", {
      headers: { cookie: headers.cookie ?? "" },
      data: {
        path: url.pathname,
        method: browserRequest.method(),
        origin: headers.origin ?? null,
        csrf: headers["x-operator-csrf"] ?? null,
        ...(url.searchParams.has("organizationId")
          ? { organizationId: url.searchParams.get("organizationId") }
          : {}),
        ...(url.pathname === "/api/commands" ? { command: browserRequest.postDataJSON() } : {}),
      },
    });
    await route.fulfill({ response });
  });
  const state = async (
    input: { organizationId?: string; workspaceId?: string } = {},
    previousSessionToken?: string,
  ): Promise<FixtureState> => {
    const response = await transport.post("/__test/local-admin/state", {
      headers: {
        cookie: previousSessionToken
          ? `${cookieNames.session}=${previousSessionToken}`
          : await cookieHeader(),
      },
      data: input,
    });
    if (!response.ok()) throw new Error(`Local admin state failed (${response.status()})`);
    return response.json();
  };
  const revoke = async () => {
    const response = await transport.post("/__test/local-admin/revoke", {
      headers: { cookie: await cookieHeader() },
      data: {},
    });
    if (!response.ok()) throw new Error(`Local admin revocation failed (${response.status()})`);
  };
  return { cookie, state, revoke };
}

export async function signIn(page: Page, email: string) {
  await page.goto(`${productOrigin}/signin`);
  await page.getByRole("button", { name: "Workplace learning", exact: true }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel(/I accept the Terms/).check();
  const requested = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/v1/auth/magic-link"),
  );
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  const result = await requested;
  expect(result.status()).toBe(202);
  const link = await page.getByRole("link", { name: "Continue to dashboard" }).getAttribute("href");
  expect(new URL(link!).hostname).toBe("127.0.0.1");
  expect(new URL(link!).port).toBe("4300");
  await page.getByRole("link", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(new RegExp(`^${productOrigin}/dashboard`));
}

export async function expectNoBusinessAccess(page: Page) {
  await expect(page.getByRole("link", { name: "Business admin sign in", exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator("summary").filter({ hasText: "Business ·" })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Business administration", exact: true }),
  ).toHaveCount(0);
}

export async function operatorStatus(page: Page) {
  return page.evaluate(
    async (origin) => (await fetch(`${origin}/api/navigation`, { credentials: "include" })).status,
    controlOrigin,
  );
}
