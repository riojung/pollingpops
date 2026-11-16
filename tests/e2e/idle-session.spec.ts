import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type BrowserContext,
  type ElementHandle,
  type Locator,
  type Page,
  type Request,
  type TestInfo,
} from "@playwright/test";
import { idleSessionCopy } from "../../apps/web/lib/i18n/idle-session-messages";
import {
  AuthSessionStateSchema,
  LOCALE_COOKIE_NAME,
  type AuthSessionState,
  type SupportedLocale,
} from "../../packages/contracts/src/index.ts";
import {
  acceptCreatorPolicies,
  signInCreator,
  submitCreatorPin,
  verifyCreatorEmail,
} from "../support/creator-auth";
import { testEmail } from "./test-email";

const api = "http://127.0.0.1:4100";
// These browser protocol names stay local so Playwright's CommonJS fixture loader
// does not load app modules that resolve contracts through Next's package graph.
const SESSION_EXPIRED_EVENT = "pollingpops:session-expired";
const SESSION_SYNC_KEY = "pollingpops:session-sync:v1";
const PENDING_SESSION_LOGOUT_KEY = "pollingpops:pending-session-logout:v1";
const privateDraft = "PRIVATE_IDLE_BROWSER_UNSAVED_DRAFT";
const title = (page: Page) => page.getByLabel("Checkpoint set title", { exact: true });

async function signedInSession(page: Page, info: TestInfo, prefix: string) {
  await page.setViewportSize(
    info.project.name.includes("mobile")
      ? { width: 320, height: 740 }
      : { width: 1280, height: 800 },
  );
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await signInCreator(page, testEmail(prefix, info), { returnTo: "/dashboard" });
  await expect(title(page)).toBeVisible();
  const response = await page.request.get(`${api}/v1/auth/session`);
  expect(response.status()).toBe(200);
  return AuthSessionStateSchema.parse((await response.json()).session);
}

async function expectDefaultPolicy(page: Page, session: AuthSessionState) {
  expect(session.policy).toEqual({ idleTimeoutMinutes: 5, warningDurationSeconds: 60 });
  expect(Date.parse(session.warningAt) - Date.parse(session.lastActivityAt)).toBe(300_000);
  expect(Date.parse(session.expiresAt) - Date.parse(session.warningAt)).toBe(60_000);
  expect(Date.parse(session.absoluteExpiresAt)).toBeGreaterThanOrEqual(
    Date.parse(session.expiresAt),
  );
  const account = await (await page.request.get(`${api}/v1/auth/me`)).json();
  expect(session.workspaceId).toBe(account.creator.workspaceId);
  expect(account.workspace.sessionPolicy).toEqual(session.policy);
}

/**
 * Authentication, cookies, policy writes, and successful logout use the real API.
 * Browser session read/activity responses and deliberate logout failures are
 * controlled, so UI deadlines
 * can advance without waiting six minutes or changing the server clock. The
 * authority model never renews expired sessions or ordinary warning-phase activity;
 * backend clock tests independently enforce those rules against real persistence.
 * A modeled expiry does not advance or revoke the real server row. Only explicit
 * sign-out asserts real server revocation; expiry UI must not post a destructive logout.
 */
async function sessionAuthority(context: BrowserContext, initial: AuthSessionState) {
  let now = Date.parse(initial.serverNow);
  let state = structuredClone(initial);
  let ended = false;
  let reads = 0;
  let logouts = 0;
  let clockInstalled = false;
  const activities: { intent: "activity" | "continue"; at: number }[] = [];
  let logoutGate: Promise<void> | undefined;
  let logoutStarted: (() => void) | undefined;
  let logoutFailure: "503" | "network" | null = null;
  const readHolds = new Map<Page, { gate: Promise<void>; started: () => void }>();
  const readFailures = new Map<Page, number[]>();
  const sessionRoutes = /\/v1\/auth\/(?:session(?:\/activity)?|logout)$/;
  const pendingSessionRequests = new Set<Request>();
  let requestVersion = 0;
  const recordRequest = (request: Request) => {
    if (
      !/\/v1\/auth\/session(?:\/activity)?$/.test(request.url()) ||
      request.method() === "OPTIONS"
    )
      return;
    pendingSessionRequests.add(request);
    requestVersion += 1;
  };
  const recordCompletion = (request: Request) => {
    if (pendingSessionRequests.delete(request)) requestVersion += 1;
  };
  context.on("request", recordRequest);
  context.on("requestfinished", recordCompletion);
  context.on("requestfailed", recordCompletion);

  function responseState() {
    return { ...state, serverNow: new Date(now).toISOString() };
  }

  async function settleSessionResponses(pages: Page[]) {
    // Only a barrier for this artificial clock: initial input can renew one tab
    // and trigger reads in another. Jumping minutes while any such response is in
    // transit would exercise an unintended overdue-check path instead of warning.
    // UI readiness is still asserted through visible controls and saved values.
    let version = requestVersion;
    let quietSince = Date.now();
    await expect
      .poll(
        async () => {
          // Protocol task/microtask drains work for background tabs too. Node time
          // bounds this quiet period, independently of the controlled browser clock.
          await Promise.all(pages.map((page) => page.evaluate(() => Promise.resolve())));
          if (version !== requestVersion || pendingSessionRequests.size > 0) {
            version = requestVersion;
            quietSince = Date.now();
          }
          return pendingSessionRequests.size === 0 && Date.now() - quietSince >= 650;
        },
        { timeout: 10_000, intervals: [50, 100] },
      )
      .toBe(true);
  }

  await context.route(sessionRoutes, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/v1/auth/logout" && request.method() === "POST") {
      logouts += 1;
      logoutStarted?.();
      if (logoutGate) await logoutGate;
      if (logoutFailure === "network") {
        await route.abort("failed");
        return;
      }
      if (logoutFailure === "503") {
        await route.fulfill({
          status: 503,
          headers: {
            "access-control-allow-origin": request.headers().origin ?? "http://127.0.0.1:3100",
            "access-control-allow-credentials": "true",
          },
          json: {
            error: { code: "SERVICE_UNAVAILABLE", message: "Sign-out is temporarily unavailable." },
          },
        });
        return;
      }
      const response = await route.fetch();
      if (response.ok()) ended = true;
      await route.fulfill({ response });
      return;
    }
    if (
      (path === "/v1/auth/session" && request.method() !== "GET") ||
      (path === "/v1/auth/session/activity" && request.method() !== "POST") ||
      path === "/v1/auth/logout"
    ) {
      await route.continue();
      return;
    }
    // Browser clocks share one epoch; allow their small real-time progress too.
    now = Math.max(now, await request.frame().evaluate(() => Date.now()));
    const expired =
      ended || now >= Math.min(Date.parse(state.expiresAt), Date.parse(state.absoluteExpiresAt));
    const headers = {
      "access-control-allow-origin": new URL(request.headers().origin ?? "http://127.0.0.1:3100")
        .origin,
      "access-control-allow-credentials": "true",
    };
    if (path === "/v1/auth/session") {
      reads += 1;
      const page = request.frame().page();
      const failure = readFailures.get(page)?.shift();
      const hold = readHolds.get(page);
      if (hold) {
        hold.started();
        await hold.gate;
      }
      if (failure) {
        await route.fulfill({
          status: failure,
          headers,
          json: {
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Session verification is temporarily unavailable.",
            },
          },
        });
        return;
      }
    }
    if (expired) {
      await route.fulfill({
        status: 401,
        headers,
        json: { error: { code: "SESSION_EXPIRED", message: "Your session has expired." } },
      });
      return;
    }
    if (path.endsWith("/activity")) {
      const { intent } = request.postDataJSON() as { intent: "activity" | "continue" };
      expect(["activity", "continue"]).toContain(intent);
      activities.push({ intent, at: now });
      if (intent === "continue" || now < Date.parse(state.warningAt)) {
        const warningAt = now + state.policy.idleTimeoutMinutes * 60_000;
        state = {
          ...state,
          lastActivityAt: new Date(now).toISOString(),
          warningAt: new Date(warningAt).toISOString(),
          expiresAt: new Date(
            Math.min(warningAt + 60_000, Date.parse(state.absoluteExpiresAt)),
          ).toISOString(),
        };
      }
    }
    await route.fulfill({ headers, json: { session: responseState() } });
  });

  return {
    activities,
    get reads() {
      return reads;
    },
    get logouts() {
      return logouts;
    },
    get state() {
      return responseState();
    },
    async install(page: Page) {
      if (clockInstalled) return;
      await page.clock.install({ time: new Date(now) });
      clockInstalled = true;
    },
    async advanceTo(at: number, pages: Page[]) {
      if (readHolds.size === 0) await settleSessionResponses(pages);
      const elapsed = Math.max(0, at - now);
      now += elapsed;
      // Playwright's clock belongs to the whole BrowserContext, including tabs
      // opened after installation. Advancing each tab would multiply elapsed time.
      const contexts = new Map(pages.map((page) => [page.context(), page]));
      await Promise.all([...contexts.values()].map((page) => page.clock.fastForward(elapsed)));
    },
    async resumeAfter(at: number, page: Page) {
      now = at;
      // A wall-clock jump without timer execution models a suspended device.
      await page.clock.setSystemTime(new Date(at));
      await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    },
    holdLogout() {
      let release!: () => void;
      logoutGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        logoutStarted = resolve;
      });
      return { started, release };
    },
    failLogout(failure: "503" | "network" | null) {
      logoutFailure = failure;
    },
    holdReads(page: Page) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      readHolds.set(page, { gate, started });
      return {
        started: ready,
        release() {
          readHolds.delete(page);
          release();
        },
      };
    },
    failNextRead(page: Page, status = 503) {
      const failures = readFailures.get(page) ?? [];
      failures.push(status);
      readFailures.set(page, failures);
    },
    async stop() {
      await context.unroute(sessionRoutes);
      context.off("request", recordRequest);
      context.off("requestfinished", recordCompletion);
      context.off("requestfailed", recordCompletion);
    },
  };
}

async function privateWorkspace(page: Page, marker = privateDraft) {
  const input = title(page);
  await expect(input).toBeVisible();
  await input.fill(marker);
  await expect(input).toHaveValue(marker);
  return input;
}

async function expectPrivateViewGone(page: Page) {
  await expect(title(page)).toHaveCount(0);
  await expect(page.getByText(privateDraft, { exact: false })).toHaveCount(0);
  expect(
    await page
      .locator("input, textarea")
      .evaluateAll(
        (elements, marker) =>
          elements.some((element) => (element as HTMLInputElement).value.includes(marker)),
        privateDraft,
      ),
  ).toBe(false);
}

async function expectPrivateFieldGated(
  page: Page,
  field: ElementHandle<HTMLElement | SVGElement>,
  value: string,
) {
  await expect(page.getByTestId("idle-session-gate")).toBeVisible();
  await expect(title(page)).toBeHidden();
  await expect(
    page.getByRole("textbox", { name: "Checkpoint set title", exact: true }),
  ).toHaveCount(0);
  expect(
    await field.evaluate((element) => ({
      connected: element.isConnected,
      value: (element as HTMLInputElement).value,
      hidden: Boolean(element.closest("[hidden]")),
      inert: Boolean(element.closest("[inert]")),
    })),
  ).toEqual({ connected: true, value, hidden: true, inert: true });
  await field.evaluate((element) => (element as HTMLElement).focus());
  expect(await field.evaluate((element) => document.activeElement === element)).toBe(false);
}

async function expectPrivateFieldRestored(
  page: Page,
  field: ElementHandle<HTMLElement | SVGElement>,
  value: string,
) {
  await expect(title(page)).toBeVisible();
  await expect(title(page)).toHaveValue(value);
  expect(await title(page).evaluate((element, previous) => element === previous, field)).toBe(true);
  expect(
    await field.evaluate((element) => ({
      hidden: Boolean(element.closest("[hidden]")),
      inert: Boolean(element.closest("[inert]")),
    })),
  ).toEqual({ hidden: false, inert: false });
}

async function expectRevokedSession(page: Page) {
  await expect.poll(async () => (await page.request.get(`${api}/v1/auth/me`)).status()).toBe(401);
  expect((await page.request.get(`${api}/v1/auth/session`)).status()).toBe(401);
}

async function expectSignOutFailure(page: Page) {
  const copy = idleSessionCopy("en-CA");
  const gate = page.getByTestId("idle-session-gate");
  await expect(gate).toBeVisible();
  await expect(gate.getByRole("alert")).toHaveText(copy.signOutError);
  await expect(gate.getByRole("button", { name: copy.retrySignOut, exact: true })).toBeEnabled();
  await expectPrivateViewGone(page);
  return gate.getByRole("button", { name: copy.retrySignOut, exact: true });
}

async function firstPinAfterTimeout(page: Page, email: string) {
  // The ordinary signup helper requires no creator cookie. An expired-session
  // response deliberately leaves that cookie alone, so exercise this real PIN
  // form without clearing it or assuming the server clock advanced with the UI.
  const address = page.getByRole("textbox", { name: "Email address", exact: true });
  if (!(await address.isVisible()))
    await page.getByRole("button", { name: "Use another email", exact: true }).click();
  const form = page.getByRole("form", { name: "Sign in by email", exact: true });
  if (!(await form.isVisible()))
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await form.getByLabel("Email address", { exact: true }).fill(email);
  await acceptCreatorPolicies(page);
  const requested = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/auth/pin/request",
  );
  await form.getByRole("button", { name: "Send sign-in PIN", exact: true }).click();
  const response = await requested;
  expect(response.status()).toBe(202);
  expect(new URL(response.url()).hostname).toBe("127.0.0.1");
  const result = await response.json();
  expect(result.accepted).toBe(true);
  expect(result.debugPin).toMatch(/^\d{6}$/);
  await expect(page.getByText(result.debugPin, { exact: true })).toHaveCount(0);
  return result.debugPin as string;
}

async function expectSignIn(page: Page, returnTo = "/dashboard", reason = "session-expired") {
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/signin" &&
      url.searchParams.get("reason") === reason &&
      url.searchParams.get("returnTo") === returnTo,
  );
  await expectPrivateViewGone(page);
}

async function expectWarning(page: Page, locale: SupportedLocale = "en-CA") {
  const copy = idleSessionCopy(locale);
  const dialog = page.getByRole("alertdialog", { name: copy.warningTitle, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: copy.stay, exact: true })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: copy.signOut, exact: true })).toBeEnabled();
  return dialog;
}

async function expectWarningAccess(
  page: Page,
  dialog: Locator,
  background: Locator,
  locale: SupportedLocale,
) {
  const copy = idleSessionCopy(locale);
  const stay = dialog.getByRole("button", { name: copy.stay, exact: true });
  const signOut = dialog.getByRole("button", { name: copy.signOut, exact: true });
  await expect(stay).toBeFocused();
  // Native dialogs can traverse browser chrome at their boundary. They must never
  // place keyboard focus on a background app control or permit programmatic focus.
  for (const key of ["Tab", "Shift+Tab", "Shift+Tab", "Tab"]) {
    await page.keyboard.press(key);
    expect(
      await dialog.evaluate(
        (element) =>
          element.contains(document.activeElement) ||
          document.activeElement === document.body ||
          document.activeElement === document.documentElement,
      ),
    ).toBe(true);
    await expect(background).not.toBeFocused();
  }
  await stay.focus();
  await background.evaluate((element) => (element as HTMLElement).focus());
  await expect(stay).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  for (const control of [stay, signOut]) {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport({ ratio: 1 });
  }
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.y).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    (await new AxeBuilder({ page }).include('[data-testid="idle-session-warning"]').analyze())
      .violations,
  ).toEqual([]);
}

test("default idle warning counts down, isolates focus, and removes private content only after verified expiry", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const real = await signedInSession(page, info, "idle-expiry");
  await expectDefaultPolicy(page, real);
  const locale = info.project.name.includes("mobile") ? "ko-KR" : "en-CA";
  if (locale === "ko-KR") {
    expect(
      (await page.request.put(`${api}/v1/account/locale`, { data: { locale } })).status(),
    ).toBe(200);
    await page
      .context()
      .addCookies([{ name: LOCALE_COOKIE_NAME, value: locale, url: new URL(page.url()).origin }]);
  }
  const authority = await sessionAuthority(page.context(), real);
  await authority.install(page);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  const background = await privateWorkspace(page);
  const privateNode = await background.elementHandle();
  await authority.advanceTo(Date.parse(authority.state.warningAt) - 2_000, [page]);
  await expect(page.getByTestId("idle-session-warning")).toBeHidden();
  await authority.advanceTo(Date.parse(authority.state.warningAt) + 250, [page]);
  const dialog = await expectWarning(page, locale);
  const countdown = dialog.getByTestId("idle-session-countdown");
  expect(Number(await countdown.innerText())).toBeGreaterThanOrEqual(57);
  expect(Number(await countdown.innerText())).toBeLessThanOrEqual(60);
  await expectWarningAccess(page, dialog, background, locale);
  await page.screenshot({ path: info.outputPath(`idle-warning-${locale}.png`) });
  const expiry = Date.parse(authority.state.expiresAt);
  await authority.advanceTo(expiry - 30_000, [page]);
  expect(Number(await countdown.innerText())).toBeGreaterThanOrEqual(27);
  expect(Number(await countdown.innerText())).toBeLessThanOrEqual(30);
  const reconciliation = authority.holdReads(page);
  try {
    await authority.advanceTo(expiry + 1_000, [page]);
    await reconciliation.started;
    await expectPrivateFieldGated(page, privateNode!, privateDraft);
    expect(authority.logouts).toBe(0);
  } finally {
    reconciliation.release();
  }
  await expectSignIn(page);
  expect(await privateNode!.evaluate((element) => element.isConnected).catch(() => false)).toBe(
    false,
  );
  expect(authority.logouts).toBe(0);
});

test("only trusted activity and explicit Stay renew access; waking after expiry cannot revive it", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const freshEmail = testEmail("idle-fresh-signin", info);
  const verificationContext = await browser.newContext();
  try {
    await verifyCreatorEmail(await verificationContext.newPage(), freshEmail, {
      returnTo: "/dashboard",
    });
  } finally {
    await verificationContext.close();
  }
  const real = await signedInSession(page, info, "idle-activity");
  // Real passive authenticated reads preserve the server's recorded activity.
  const before = AuthSessionStateSchema.parse(
    (await (await page.request.get(`${api}/v1/auth/session`)).json()).session,
  );
  for (let index = 0; index < 3; index += 1)
    expect((await page.request.get(`${api}/v1/auth/me`)).status()).toBe(200);
  const after = AuthSessionStateSchema.parse(
    (await (await page.request.get(`${api}/v1/auth/session`)).json()).session,
  );
  expect(after.lastActivityAt).toBe(before.lastActivityAt);
  expect(after.expiresAt).toBe(before.expiresAt);
  const continued = await page.request.post(`${api}/v1/auth/session/activity`, {
    data: { intent: "continue" },
  });
  expect(continued.status()).toBe(200);
  const realContinued = AuthSessionStateSchema.parse((await continued.json()).session);
  expect(Date.parse(realContinued.lastActivityAt)).toBeGreaterThanOrEqual(
    Date.parse(real.lastActivityAt),
  );
  expect(realContinued.sessionId).toBe(real.sessionId);

  const authority = await sessionAuthority(page.context(), realContinued);
  await authority.install(page);
  await page.reload();
  const background = await privateWorkspace(page);
  const originalExpiry = authority.state.expiresAt;
  const activityCount = authority.activities.length;
  await page.evaluate(async (origin) => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    for (let index = 0; index < 3; index += 1) {
      const response = await fetch(`${origin}/v1/auth/me`, { credentials: "include" });
      if (!response.ok) throw new Error("Background account read failed");
    }
  }, api);
  await authority.advanceTo(Date.parse(authority.state.lastActivityAt) + 60_000, [page]);
  expect(authority.activities).toHaveLength(activityCount);
  expect(authority.state.expiresAt).toBe(originalExpiry);
  const activity = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/auth/session/activity",
  );
  await background.click();
  await background.press("ArrowLeft");
  const activityResponse = await activity;
  expect(activityResponse.request().postDataJSON()).toEqual({ intent: "activity" });
  expect(activityResponse.status()).toBe(200);
  await activityResponse.finished();
  // Fence the browser consuming the renewed lease before jumping beyond the old
  // deadline. Updating the route's authority model alone does not fence the UI.
  await page.evaluate(() => Promise.resolve());
  await expect
    .poll(() => Date.parse(authority.state.expiresAt))
    .toBeGreaterThan(Date.parse(originalExpiry));
  const warningExpiry = authority.state.expiresAt;
  await authority.advanceTo(Date.parse(authority.state.warningAt) + 250, [page]);
  const dialog = await expectWarning(page);
  const warningActivityCount = authority.activities.length;
  await page.keyboard.press("Shift");
  await page.mouse.move(10, 10);
  await authority.advanceTo(Date.parse(warningExpiry) - 40_000, [page]);
  expect(authority.state.expiresAt).toBe(warningExpiry);
  expect(authority.activities.filter((item) => item.intent === "continue")).toHaveLength(0);
  expect(authority.activities).toHaveLength(warningActivityCount);
  await dialog.getByRole("button", { name: idleSessionCopy("en-CA").stay, exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(authority.activities.filter((item) => item.intent === "continue")).toHaveLength(1);
  expect(Date.parse(authority.state.expiresAt)).toBeGreaterThan(Date.parse(warningExpiry));
  await expect(background).toHaveValue(privateDraft);
  await expect(background).toBeFocused();
  const requestsBeforeSleep = authority.activities.length;
  await authority.resumeAfter(Date.parse(authority.state.expiresAt) + 2_000, page);
  await expectSignIn(page);
  expect(authority.activities).toHaveLength(requestsBeforeSleep);
  expect(authority.logouts).toBe(0);
  await authority.stop();
  // Reauthenticate through the existing client navigation, without a hard reload
  // that could otherwise hide a permanently latched global expiration gate.
  // This identity has not requested a PIN before, so the server's real 60-second
  // issuance cooldown does not need a clock bypass or a real-time wait.
  const pin = await firstPinAfterTimeout(page, freshEmail);
  await submitCreatorPin(page, pin);
  await expect(title(page)).toBeVisible();
  await expect(title(page)).toHaveValue("");
  const fresh = AuthSessionStateSchema.parse(
    (await (await page.request.get(`${api}/v1/auth/session`)).json()).session,
  );
  expect(fresh.sessionId).not.toBe(real.sessionId);
  expect(fresh.workspaceId).not.toBe(real.workspaceId);
  expect((await (await page.request.get(`${api}/v1/auth/me`)).json()).creator.email).toBe(
    freshEmail,
  );
  await expect(page.getByTestId("idle-session-warning")).toBeHidden();

  // A private request issued under S0 may report SESSION_EXPIRED after the first
  // PIN of another identity has already installed S1. This models the provider
  // notification from that delayed 401; apiFetch's emission and the backend's
  // no-Set-Cookie response are covered independently in their focused tests.
  const freshField = await (await privateWorkspace(page, `${privateDraft}_FRESH`)).elementHandle();
  let logoutRequests = 0;
  const observeLogout = (request: Request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/auth/logout")
      logoutRequests += 1;
  };
  page.on("request", observeLogout);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received!: () => void;
  const ready = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route(`${api}/v1/auth/session`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect(AuthSessionStateSchema.parse((await response.json()).session).sessionId).toBe(
      fresh.sessionId,
    );
    received();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.evaluate(
      (eventName) => window.dispatchEvent(new Event(eventName)),
      SESSION_EXPIRED_EVENT,
    );
    await ready;
    await expectPrivateFieldGated(page, freshField!, `${privateDraft}_FRESH`);
    expect(logoutRequests).toBe(0);
  } finally {
    release();
  }
  await expectPrivateFieldRestored(page, freshField!, `${privateDraft}_FRESH`);
  expect(logoutRequests).toBe(0);
  const reconciled = await page.request.get(`${api}/v1/auth/session`);
  expect(reconciled.status()).toBe(200);
  expect(AuthSessionStateSchema.parse((await reconciled.json()).session).sessionId).toBe(
    fresh.sessionId,
  );
  expect((await (await page.request.get(`${api}/v1/auth/me`)).json()).creator.email).toBe(
    freshEmail,
  );
  await page.unroute(`${api}/v1/auth/session`);

  // A non-secret pending S0 logout can survive a suspended tab while a fresh PIN
  // installs S1. On reload it must be compared with the current server identity,
  // then discarded rather than converted into an unscoped logout of S1.
  await page.evaluate(
    ({ key, sessionId }) => {
      sessionStorage.setItem(key, JSON.stringify({ sessionId, returnTo: "/dashboard" }));
    },
    { key: PENDING_SESSION_LOGOUT_KEY, sessionId: real.sessionId },
  );
  await page.reload();
  await expect(title(page)).toBeVisible();
  expect(logoutRequests).toBe(0);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), PENDING_SESSION_LOGOUT_KEY),
  ).toBeNull();
  const staleLogout = await page.request.post(`${api}/v1/auth/logout`, {
    data: { expectedSessionId: real.sessionId },
  });
  expect(staleLogout.status()).toBe(409);
  expect(staleLogout.headers()["set-cookie"]).toBeUndefined();
  const current = await page.request.get(`${api}/v1/auth/session`);
  expect(current.status()).toBe(200);
  expect(AuthSessionStateSchema.parse((await current.json()).session).sessionId).toBe(
    fresh.sessionId,
  );
  expect((await (await page.request.get(`${api}/v1/auth/me`)).json()).creator.email).toBe(
    freshEmail,
  );
  page.off("request", observeLogout);
});

test("workspace timeout persists through reload and an invited editor cannot change it", async ({
  page: owner,
  browser,
}, info) => {
  test.setTimeout(150_000);
  const session = await signedInSession(owner, info, "idle-policy-owner");
  await expectDefaultPolicy(owner, session);
  await owner.goto("/account#security");
  const copy = idleSessionCopy("en-CA");
  await expect(owner.getByRole("heading", { name: copy.settingsTitle, exact: true })).toBeVisible();
  const minutes = owner.getByRole("spinbutton", { name: copy.minutesLabel, exact: true });
  await expect(minutes).toHaveValue("5");
  await expect(minutes).toHaveAttribute("min", "1");
  await expect(minutes).toHaveAttribute("max", "240");
  for (const invalid of [0, 241]) {
    const denied = await owner.request.patch(`${api}/v1/workspace/settings`, {
      data: { sessionPolicy: { idleTimeoutMinutes: invalid, warningDurationSeconds: 60 } },
    });
    expect(denied.status()).toBe(400);
  }
  await minutes.fill("7");
  const saved = owner.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname === "/v1/workspace/settings",
  );
  await owner.getByRole("button", { name: copy.save, exact: true }).click();
  const savedResponse = await saved;
  expect(savedResponse.status()).toBe(200);
  expect(savedResponse.request().postDataJSON()).toEqual({
    sessionPolicy: { idleTimeoutMinutes: 7, warningDurationSeconds: 60 },
  });
  await expect(owner.getByRole("status")).toContainText(copy.saved);
  await owner.reload();
  await expect(minutes).toHaveValue("7");
  expect(
    (await (await owner.request.get(`${api}/v1/auth/me`)).json()).workspace.sessionPolicy,
  ).toEqual({ idleTimeoutMinutes: 7, warningDurationSeconds: 60 });
  const revisedSession = AuthSessionStateSchema.parse(
    (await (await owner.request.get(`${api}/v1/auth/session`)).json()).session,
  );
  expect(revisedSession.policy.idleTimeoutMinutes).toBe(7);
  await minutes.scrollIntoViewIfNeeded();
  expect((await new AxeBuilder({ page: owner }).analyze()).violations).toEqual([]);
  await owner.screenshot({ path: info.outputPath("idle-workspace-policy.png"), fullPage: true });

  const editorContext = await browser.newContext({
    viewport: owner.viewportSize()!,
    reducedMotion: "reduce",
  });
  const editor = await editorContext.newPage();
  try {
    const email = testEmail("idle-policy-editor", info);
    await signInCreator(editor, email);
    const invited = await owner.request.post(`${api}/v1/workspace/invitations`, {
      data: { email, role: "editor" },
    });
    expect(invited.status()).toBe(201);
    const invitationUrl = new URL((await invited.json()).debugUrl);
    expect(invitationUrl.hostname).toBe("127.0.0.1");
    const accepted = await editor.request.post(`${api}/v1/invitations/accept`, {
      data: { token: invitationUrl.searchParams.get("token"), acceptPolicies: true },
    });
    expect(accepted.status()).toBe(200);
    const account = await (await editor.request.get(`${api}/v1/auth/me`)).json();
    expect(account.creator).toMatchObject({ role: "editor", workspaceId: session.workspaceId });
    expect(account.workspace.permissions.manageWorkspace).toBe(false);
    await editor.goto("/account#security");
    await expect(
      editor.getByRole("heading", { name: copy.settingsTitle, exact: true }),
    ).toBeVisible();
    await expect(editor.getByText(copy.readOnly, { exact: true })).toBeVisible();
    await expect(
      editor.getByRole("spinbutton", { name: copy.minutesLabel, exact: true }),
    ).toBeDisabled();
    await expect(editor.getByRole("button", { name: copy.save, exact: true })).toHaveCount(0);
    const forbidden = await editor.request.patch(`${api}/v1/workspace/settings`, {
      data: { sessionPolicy: { idleTimeoutMinutes: 9, warningDurationSeconds: 60 } },
    });
    expect(forbidden.status()).toBe(403);
    expect((await forbidden.json()).error.code).toBe("UNAUTHORIZED");
    expect(
      (await (await owner.request.get(`${api}/v1/auth/me`)).json()).workspace.sessionPolicy
        .idleTimeoutMinutes,
    ).toBe(7);
  } finally {
    await editorContext.close();
  }
});

test("same-session tabs preserve drafts through recovery and keep failed sign-out locked until revocation", async ({
  page: first,
  browserName,
}, info) => {
  test.setTimeout(120_000);
  const real = await signedInSession(first, info, "idle-tabs");
  const authority = await sessionAuthority(first.context(), real);
  await authority.install(first);
  await first.reload();
  await privateWorkspace(first, `${privateDraft}_FIRST`);
  const second = await first.context().newPage();
  try {
    await second.setViewportSize(first.viewportSize()!);
    // A suspended tab may miss both supported notification transports. This
    // tab-local shim drops only idle-session signals while the flag is true;
    // authority still comes from the same credentialed session endpoint.
    await second.addInitScript((channelName) => {
      const muted = () => (window as unknown as { idleSyncMuted?: boolean }).idleSyncMuted;
      window.addEventListener(
        "storage",
        (event) => {
          if (event.key === channelName && muted()) event.stopImmediatePropagation();
        },
        true,
      );
      if (typeof BroadcastChannel !== "undefined") {
        const NativeChannel = BroadcastChannel;
        window.BroadcastChannel = class extends NativeChannel {
          constructor(name: string) {
            super(name);
            if (name === channelName)
              this.addEventListener("message", (event) => {
                if (muted()) event.stopImmediatePropagation();
              });
          }
        };
      }
    }, SESSION_SYNC_KEY);
    await authority.install(second);
    await second.goto("/dashboard");
    const secondField = await (
      await privateWorkspace(second, `${privateDraft}_SECOND`)
    ).elementHandle();
    await authority.advanceTo(Date.parse(authority.state.warningAt) + 250, [first, second]);
    await expectWarning(first);
    await expectWarning(second);
    const oldExpiry = authority.state.expiresAt;
    const readsBeforeContinue = authority.reads;
    await first.getByRole("button", { name: idleSessionCopy("en-CA").stay, exact: true }).click();
    await expect(first.getByTestId("idle-session-warning")).toBeHidden();
    await expect(second.getByTestId("idle-session-warning")).toBeHidden();
    expect(authority.activities.filter((item) => item.intent === "continue")).toHaveLength(1);
    await expect.poll(() => authority.reads).toBeGreaterThan(readsBeforeContinue);
    expect(Date.parse(authority.state.expiresAt)).toBeGreaterThan(Date.parse(oldExpiry));
    await expect(title(first)).toHaveValue(`${privateDraft}_FIRST`);
    await expect(title(second)).toHaveValue(`${privateDraft}_SECOND`);
    await authority.advanceTo(Date.parse(oldExpiry) + 1_000, [first, second]);
    await expect(first.getByTestId("idle-session-warning")).toBeHidden();
    await expect(second.getByTestId("idle-session-warning")).toBeHidden();
    await authority.advanceTo(Date.parse(authority.state.warningAt) + 250, [first, second]);
    await expectWarning(first);
    await expectWarning(second);
    await second.evaluate(() => {
      (window as unknown as { idleSyncMuted: boolean }).idleSyncMuted = true;
    });
    const staleExpiry = authority.state.expiresAt;
    await first.getByRole("button", { name: idleSessionCopy("en-CA").stay, exact: true }).click();
    await expect(first.getByTestId("idle-session-warning")).toBeHidden();
    await expectWarning(second);
    expect(authority.activities.filter((item) => item.intent === "continue")).toHaveLength(2);
    authority.failNextRead(second);
    const reconciliation = authority.holdReads(second);
    try {
      const resumedAt = Date.parse(staleExpiry) + 2_000;
      await authority.resumeAfter(resumedAt, second);
      await reconciliation.started;
      await expectPrivateFieldGated(second, secondField!, `${privateDraft}_SECOND`);
      expect(authority.logouts).toBe(0);
      await expect(title(first)).toHaveValue(`${privateDraft}_FIRST`);
    } finally {
      reconciliation.release();
    }
    const recovery = second.getByTestId("idle-session-gate");
    await expect(recovery).toContainText(idleSessionCopy("en-CA").checkError);
    await expectPrivateFieldGated(second, secondField!, `${privateDraft}_SECOND`);
    const retry = recovery.getByRole("button", {
      name: idleSessionCopy("en-CA").retry,
      exact: true,
    });
    await expect(retry).toBeEnabled();
    const activitiesBeforeRetry = authority.activities.length;
    await second.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    for (
      let index = 0;
      index < 4 && !(await retry.evaluate((element) => element === document.activeElement));
      index += 1
    )
      // WebKit's default keyboard preference skips buttons with plain Tab.
      // Alt+Tab is its native shortcut for traversing every control.
      await second.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(retry).toBeFocused();
    const retryRead = second.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/v1/auth/session",
    );
    await second.keyboard.press("Enter");
    expect((await retryRead).status()).toBe(200);
    await expectPrivateFieldRestored(second, secondField!, `${privateDraft}_SECOND`);
    expect(authority.activities).toHaveLength(activitiesBeforeRetry);
    expect(authority.logouts).toBe(0);
    expect((await first.request.get(`${api}/v1/auth/me`)).status()).toBe(200);
    await second.evaluate(() => {
      (window as unknown as { idleSyncMuted: boolean }).idleSyncMuted = false;
    });
    await authority.advanceTo(Date.parse(authority.state.warningAt) + 250, [first, second]);
    await expectWarning(first);
    const secondWarning = await expectWarning(second);
    authority.failLogout("503");
    const logout = authority.holdLogout();
    const failedLogout = second.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/auth/logout",
    );
    try {
      await secondWarning
        .getByRole("button", { name: idleSessionCopy("en-CA").signOut, exact: true })
        .click();
      await logout.started;
      await expectPrivateViewGone(second);
      await expect(second.getByTestId("idle-session-gate")).toContainText(
        idleSessionCopy("en-CA").signingOut,
      );
    } finally {
      logout.release();
    }
    expect((await failedLogout).status()).toBe(503);
    await expectSignOutFailure(second);
    expect((await first.request.get(`${api}/v1/auth/me`)).status()).toBe(200);
    const pending = await second.evaluate(
      (key) => sessionStorage.getItem(key),
      PENDING_SESSION_LOGOUT_KEY,
    );
    expect(JSON.parse(pending!)).toEqual({ sessionId: real.sessionId, returnTo: "/dashboard" });

    await second.goto("/account#security");
    await expectSignOutFailure(second);
    await expect(
      second.getByRole("heading", { name: idleSessionCopy("en-CA").settingsTitle, exact: true }),
    ).toHaveCount(0);
    await second.goto("/dashboard");
    await expectSignOutFailure(second);
    await second.reload();
    let retrySignOut = await expectSignOutFailure(second);
    expect(authority.logouts).toBe(1);
    expect(
      (
        await new AxeBuilder({ page: second })
          .include('[data-testid="idle-session-gate"]')
          .analyze()
      ).violations,
    ).toEqual([]);
    await second.screenshot({ path: info.outputPath("idle-sign-out-failed-locked.png") });

    authority.failLogout("network");
    const networkFailure = second.waitForEvent("requestfailed", {
      predicate: (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === "/v1/auth/logout",
    });
    await retrySignOut.click();
    expect((await networkFailure).postDataJSON()).toEqual({ expectedSessionId: real.sessionId });
    retrySignOut = await expectSignOutFailure(second);
    expect(authority.logouts).toBe(2);
    expect((await first.request.get(`${api}/v1/auth/me`)).status()).toBe(200);

    authority.failLogout(null);
    const successfulLogout = second.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/auth/logout",
    );
    await retrySignOut.click();
    const revoked = await successfulLogout;
    expect(revoked.status()).toBe(200);
    expect(revoked.request().postDataJSON()).toEqual({ expectedSessionId: real.sessionId });
    expect(revoked.headers()["set-cookie"]).toBeUndefined();
    await expectSignIn(first);
    await expectSignIn(second, "/dashboard", "signed-out");
    await expectRevokedSession(first);
    expect(authority.logouts).toBe(3);
    expect(authority.activities.filter((item) => item.intent === "continue")).toHaveLength(2);
  } finally {
    await second.close();
  }
});
