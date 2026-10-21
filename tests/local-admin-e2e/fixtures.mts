import { signInCreator } from "../support/creator-auth.js";
import {
  request,
  expect,
  test as base,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { operatorTotpCode } from "../../packages/control-plane/src/index.js";

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
  features: "Features and plans",
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
  auditEvents: { action: string; actorId: string; reason: string }[];
  issuerConfigured: boolean;
  mfaConfigured: boolean;
}

async function localAdminHarness(context: BrowserContext, transport: APIRequestContext) {
  const cookie = async (name: string) =>
    (await context.cookies(controlOrigin)).find((entry) => entry.name === name)?.value;
  const cookieHeader = async () =>
    (await context.cookies(controlOrigin)).map(({ name, value }) => `${name}=${value}`).join("; ");
  const forward: Parameters<BrowserContext["route"]>[1] = async (route) => {
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
        ...(url.pathname === "/auth/password"
          ? { credentials: browserRequest.postDataJSON() }
          : {}),
      },
    });
    await route.fulfill({ response });
  };
  await context.route(`${controlOrigin}/api/**`, forward);
  await context.route(`${controlOrigin}/auth/password`, forward);
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
  const ageSession = async () => {
    const response = await transport.post("/__test/local-admin/age-session", {
      headers: { cookie: await cookieHeader() },
      data: {},
    });
    if (!response.ok()) throw new Error(`Local admin session aging failed (${response.status()})`);
  };
  const provision = async (): Promise<AdminCredentials> => {
    const response = await transport.post("/__test/local-admin/provision", { data: {} });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  return { cookie, state, revoke, ageSession, provision };
}

export const test = base.extend<{ localAdmin: Awaited<ReturnType<typeof localAdminHarness>> }>({
  localAdmin: async ({ context }, use) => {
    // This request context has no browser cookie jar. Forward only cookies that
    // the browser actually sent; a missing product bridge cannot be repaired here.
    const transport = await request.newContext({ baseURL: apiOrigin });
    try {
      await use(await localAdminHarness(context, transport));
    } finally {
      // Drain forwarding before disposing its transport, and finish disposal before
      // the next test starts tracing existing request contexts.
      try {
        await context.unrouteAll({ behavior: "wait" });
      } finally {
        await transport.dispose();
      }
    }
  },
});

export interface AdminCredentials {
  username: string;
  password: string;
  totpSecret: string;
}

export async function signInAdmin(page: Page, credentials: AdminCredentials) {
  await page.goto(controlOrigin);
  await page.getByLabel("Username", { exact: true }).fill(credentials.username);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page
    .getByLabel("Authenticator code", { exact: true })
    .fill(operatorTotpCode(credentials.totpSecret));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toBeVisible();
}

export async function signIn(page: Page, email: string) {
  await signInCreator(page, email, { signinUrl: `${productOrigin}/signin` });
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
