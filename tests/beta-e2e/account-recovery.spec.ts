import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { testEmail } from "../e2e/test-email";
import { signInBeta } from "./sign-in";
import { specialistLocale } from "./option-b-specialist-support";
import {
  expectDocumentReflow,
  expectVisibleKeyboardFocus,
  tabTo,
} from "./option-b-accessibility-support";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const corePath = "/v1/account/embed-origins";
const workspaceListPath = "/v1/workspaces";
const institutionPath = "/v1/workspace/institution-policy";
const membersPath = "/v1/workspace/members";
const ltiPath = "/v1/workspace/lti-registrations";
type SettingsRead =
  typeof corePath | typeof workspaceListPath | typeof membersPath | typeof ltiPath;
const modes = [
  { name: "light", colorScheme: "light", forcedColors: "none" },
  { name: "dark", colorScheme: "dark", forcedColors: "none" },
  { name: "high-contrast", colorScheme: "light", forcedColors: "active" },
] as const;

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { promise, release };
}

async function installReads(page: Page) {
  const held = new Map<string, Array<{ gate: ReturnType<typeof gate>; fail: boolean }>>();
  const gates: Array<ReturnType<typeof gate>> = [];
  const reads: URL[] = [];
  const mutations: string[] = [];
  await page.route(`${api}/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() !== "GET") {
      if (/^\/v1\/(?:account|billing|workspace|workspaces)(?:\/|$)/.test(path)) {
        mutations.push(`${request.method()} ${path}`);
        return route.abort();
      }
      return route.continue();
    }
    reads.push(url);
    const next = held.get(path)?.shift();
    if (next) await next.gate.promise;
    if (next?.fail) {
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "UNAVAILABLE",
            message: "Synthetic settings read unavailable",
            requestId: "synthetic-core-read",
          },
        },
      });
    }
    return route.continue();
  });
  return {
    count: (path: string) => reads.filter((read) => read.pathname === path).length,
    scopes: (path: SettingsRead) =>
      reads
        .filter((read) => read.pathname === path)
        .map((read) => read.searchParams.get("expectedWorkspaceId")),
    mutations,
    hold(path: SettingsRead, fail = false) {
      const entry = { gate: gate(), fail };
      gates.push(entry.gate);
      const queue = held.get(path) ?? [];
      queue.push(entry);
      held.set(path, queue);
      return entry.gate.release;
    },
    releaseAll: () => gates.forEach((entry) => entry.release()),
  };
}

async function quality(page: Page) {
  await expectDocumentReflow(page);
  const axe = new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]);
  // WebKit can apply the new palette to descendants after the root mode changes.
  await expect.poll(async () => (await axe.analyze()).violations).toEqual([]);
}

for (const phone of [false, true]) {
  const suffix = phone ? " @mobile" : "";
  test(`Required workspace settings recover atomically without replaying actions${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: phone ? 320 : 1440, height: phone ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await signInBeta(page, undefined, { returnTo: "/home" });
    await specialistLocale(page, "en-CA");
    const fixture = await installReads(page);
    const failCore = fixture.hold(corePath, true);
    const href = "/account?source=workspace-recovery#appearance";
    try {
      await page.goto(href);
      const load = page.locator("#account-load-state");
      await expect(load).toHaveAttribute("aria-busy", "true");
      await expect(page.locator("#settings-panel")).toHaveCount(0);
      await expect(
        page.getByRole("tablist", { name: "Settings categories", exact: true }),
      ).toHaveCount(0);
      await quality(page);
      await load.screenshot({ path: info.outputPath("settings-loading.png"), scale: "css" });
      expect(fixture.count(membersPath)).toBe(0);
      expect(fixture.count(ltiPath)).toBe(0);
      failCore();
      await expect(
        page.getByRole("heading", { name: "Workspace settings are unavailable", exact: true }),
      ).toBeVisible();
      await expect(load).toHaveAttribute("aria-busy", "false");
      await expect(
        page.getByRole("button", { name: "Save workspace name", exact: true }),
      ).toHaveCount(0);
      for (const mode of modes) {
        await page.emulateMedia({ colorScheme: mode.colorScheme, forcedColors: mode.forcedColors });
        await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode.colorScheme);
        await quality(page);
        await load.screenshot({
          path: info.outputPath(`settings-error-${mode.name}.png`),
          scale: "css",
        });
      }
      await page.emulateMedia({ colorScheme: "light", forcedColors: "none" });
      const retry = load.getByRole("button", { name: "Try again", exact: true });
      await tabTo(page, retry);
      await expectVisibleKeyboardFocus(retry);
      const recoverCore = fixture.hold(corePath);
      await page.keyboard.press("Enter");
      await expect(load).toBeFocused();
      await expect(load).toHaveAttribute("aria-busy", "true");
      await expect(page.locator("#settings-panel")).toHaveCount(0);
      expect(fixture.count(membersPath)).toBe(0);
      expect(fixture.count(ltiPath)).toBe(0);
      recoverCore();
      const settings = page.locator("#settings-panel");
      await expect(settings).toBeVisible();
      await expect(settings).toBeFocused();
      await expect(page.getByRole("tab", { name: "Appearance", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(load).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get("source")).toBe("workspace-recovery");
      expect(new URL(page.url()).hash).toBe("#appearance");
      await quality(page);
      await settings.screenshot({
        path: info.outputPath("settings-ready-appearance.png"),
        scale: "css",
      });
      await page.getByRole("tab", { name: "Privacy and data", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Delete account", exact: true }),
      ).toBeDisabled();
      expect(fixture.mutations).toEqual([]);
    } finally {
      fixture.releaseAll();
    }
  });

  test(`Legacy settings retry respects moved focus and signed-in personal fallback${suffix}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: phone ? 320 : 1440, height: phone ? 844 : 1000 });
    await signInBeta(page, undefined, { returnTo: "/home" });
    await specialistLocale(page, "en-CA");
    const fixture = await installReads(page);
    fixture.hold(corePath, true)();
    // Keep this supported deployment in its legacy layout so a deliberately
    // focused navigation link remains mounted when initialization succeeds.
    await page.route(`${api}/v1/auth/me`, async (route) => {
      const response = await route.fetch();
      const account = await response.json();
      return route.fulfill({
        response,
        json: {
          ...account,
          productFeatures: { ...account.productFeatures, workspaceShell: false },
        },
      });
    });
    try {
      await page.goto("/account#overview");
      const load = page.locator("#account-load-state");
      const retry = load.getByRole("button", { name: "Try again", exact: true });
      await expect(retry).toBeVisible();
      await tabTo(page, retry);
      const recoverCore = fixture.hold(corePath);
      await page.keyboard.press("Enter");
      await expect(load).toHaveAttribute("aria-busy", "true");
      const outside = page
        .getByRole("navigation", { name: "Account navigation", exact: true })
        .getByRole("link", { name: "Dashboard", exact: true });
      await outside.focus();
      recoverCore();
      await expect(page.locator("#settings-panel")).toBeVisible();
      await expect(outside).toBeFocused();

      const workspaceReads = () =>
        [corePath, membersPath, ltiPath].map((path) => fixture.count(path));
      await expect.poll(workspaceReads).toEqual([2, 1, 1]);
      const readsBefore = workspaceReads();
      await page.route(`${api}/v1/auth/me`, (route) =>
        route.fulfill({
          status: 401,
          json: {
            error: {
              code: "UNAUTHORIZED",
              message: "Synthetic workspace unavailable",
              requestId: "synthetic-identity-read",
            },
          },
        }),
      );
      await page.goto("/account?source=personal-fallback#overview");
      await expect(
        page.getByRole("heading", { name: "Personal account", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("tab", { name: "Appearance", exact: true })).toHaveCount(0);
      expect(workspaceReads()).toEqual(readsBefore);
      await quality(page);
      expect(fixture.mutations).toEqual([]);
    } finally {
      fixture.releaseAll();
    }
  });

  test(`People and LTI recover independently while other settings stay usable${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: phone ? 320 : 1440, height: phone ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await signInBeta(page, undefined, { returnTo: "/home" });
    await specialistLocale(page, "en-CA");
    const fixture = await installReads(page);
    const account = await page.request.get(`${api}/v1/auth/me`);
    expect(account.ok()).toBe(true);
    const { creator } = (await account.json()) as { creator: { workspaceId: string } };
    const failMembers = fixture.hold(membersPath, true);
    const failLti = fixture.hold(ltiPath, true);
    // Display the existing LTI section while routing registration GETs to the actual API.
    await page.route(
      (url) => url.origin === api && url.pathname === institutionPath,
      async (route) => {
        const response = await route.fetch();
        const policy = await response.json();
        await route.fulfill({
          response,
          json: { ...policy, capabilities: { ...policy.capabilities, lti: true } },
        });
      },
    );
    try {
      const billingStatus = page.waitForResponse(
        (response) =>
          response.url() === `${api}/v1/billing/status` && response.request().method() === "GET",
      );
      await page.goto("/account?source=section-recovery#people");
      const panel = page.locator("#settings-panel");
      const tab = (name: string) => page.getByRole("tab", { name, exact: true });
      const members = page.locator("#account-members-section");
      const membersContent = members.locator("[data-account-section-content]");
      const memberTable = members.getByRole("table");
      const invite = members.getByRole("button", { name: "Invite member", exact: true });
      const lti = page.getByRole("region", { name: "LTI 1.3 registrations", exact: true });
      const ltiContent = lti.locator("[data-account-section-content]");
      const noLti = lti.getByText(/no platform is registered/);

      await expect(tab("People")).toHaveAttribute("aria-selected", "true");
      await expect(membersContent).toHaveAttribute("aria-busy", "true");
      await expect(members.getByRole("status")).toContainText("Loading this section");
      await expect(memberTable).toHaveCount(0);
      await expect(invite).toHaveCount(0);
      await expect(page.locator("#account-load-state")).toHaveCount(0);
      await expect.poll(() => [fixture.count(membersPath), fixture.count(ltiPath)]).toEqual([1, 1]);
      failMembers();
      await expect(members.getByRole("alert")).toHaveText("This section is unavailable.");
      await expect(memberTable).toHaveCount(0);
      await expect(invite).toHaveCount(0);

      await tab("Plan and usage").click();
      await expect(panel.getByRole("heading", { name: "Pro plan", exact: true })).toBeVisible();
      expect((await billingStatus).ok()).toBe(true);
      await expect(panel.getByText("Loading billing details…", { exact: true })).toHaveCount(0);
      await tab("Privacy and data").click();
      const deleteButton = panel.getByRole("button", { name: "Delete account", exact: true });
      const confirmation = panel.getByRole("textbox", {
        name: "Type DELETE to confirm",
        exact: true,
      });
      await confirmation.fill("delete");
      await expect(deleteButton).toBeDisabled();
      await confirmation.fill("DELETE");
      await expect(deleteButton).toBeEnabled();
      await confirmation.clear();
      await expect(deleteButton).toBeDisabled();
      await tab("Security and integrations").click();
      await expect(ltiContent).toHaveAttribute("aria-busy", "true");
      await expect(noLti).toHaveCount(0);
      failLti();
      await expect(lti.getByRole("alert")).toHaveText("This section is unavailable.");
      await expect(noLti).toHaveCount(0);
      await expect(panel.getByRole("spinbutton")).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "Save embed origins", exact: true }),
      ).toBeEnabled();
      for (const mode of modes) {
        await page.emulateMedia({ colorScheme: mode.colorScheme, forcedColors: mode.forcedColors });
        await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode.colorScheme);
        await quality(page);
        await lti.screenshot({ path: info.outputPath(`lti-error-${mode.name}.png`), scale: "css" });
      }
      await page.emulateMedia({ colorScheme: "light", forcedColors: "none" });

      await tab("People").click();
      const retryMembers = members.getByRole("button", { name: "Try again", exact: true });
      const recoverMembers = fixture.hold(membersPath);
      await tabTo(page, retryMembers);
      await expectVisibleKeyboardFocus(retryMembers);
      await page.keyboard.press("Enter");
      await expect(members).toBeFocused();
      await expect(membersContent).toHaveAttribute("aria-busy", "true");
      await expect(memberTable).toHaveCount(0);
      await expect.poll(() => fixture.count(membersPath)).toBe(2);
      recoverMembers();
      await expect(memberTable).toBeVisible();
      await expect(invite).toBeEnabled();
      await expect(members).toBeFocused();
      expect(fixture.count(ltiPath)).toBe(1);
      expect(fixture.count(corePath)).toBe(1);

      await tab("Security and integrations").click();
      const retryLti = lti.getByRole("button", { name: "Try again", exact: true });
      const recoverLti = fixture.hold(ltiPath);
      await tabTo(page, retryLti);
      await page.keyboard.press("Enter");
      await expect(lti).toBeFocused();
      await expect(ltiContent).toHaveAttribute("aria-busy", "true");
      await expect(noLti).toHaveCount(0);
      const embedSave = panel.getByRole("button", { name: "Save embed origins", exact: true });
      await embedSave.focus();
      recoverLti();
      await expect(noLti).toBeVisible();
      await expect(embedSave).toBeFocused();
      await expect.poll(() => fixture.count(ltiPath)).toBe(2);
      expect(fixture.count(membersPath)).toBe(2);
      expect(fixture.count(corePath)).toBe(1);
      expect(fixture.scopes(membersPath)).toEqual([creator.workspaceId, creator.workspaceId]);
      expect(fixture.scopes(ltiPath)).toEqual([creator.workspaceId, creator.workspaceId]);
      expect(new URL(page.url()).searchParams.get("source")).toBe("section-recovery");
      expect(new URL(page.url()).hash).toBe("#security");
      expect(fixture.mutations).toEqual([]);
      await quality(page);
    } finally {
      fixture.releaseAll();
    }
  });
}

test("Workspace settings retry after a cross-tab workspace switch", async ({
  page,
  browser,
  browserName,
}, info) => {
  test.setTimeout(120_000);
  const email = testEmail("settings-editor", info);
  await signInBeta(page, email, { returnTo: "/home" });
  await specialistLocale(page, "en-CA");
  const original = await page.request.get(`${api}/v1/auth/me`);
  expect(original.ok()).toBe(true);
  const { creator: originalCreator } = (await original.json()) as {
    creator: { role: string; workspaceId: string };
  };
  expect(originalCreator.role).toBe("owner");

  const ownerContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  const otherTab = await page.context().newPage();
  try {
    const owner = await ownerContext.newPage();
    await signInBeta(owner, testEmail("settings-other-owner", info), { returnTo: "/home" });
    const invitation = await owner.request.post(`${api}/v1/workspace/invitations`, {
      data: { email, role: "editor" },
    });
    expect(invitation.status()).toBe(201);
    const { debugUrl } = (await invitation.json()) as { debugUrl: string };
    const invitationUrl = new URL(debugUrl);
    expect(invitationUrl.origin).toBe(new URL(page.url()).origin);
    const accepted = await page.request.post(`${api}/v1/invitations/accept`, {
      data: { token: invitationUrl.searchParams.get("token"), acceptPolicies: true },
    });
    expect(accepted.ok()).toBe(true);
    const { creator: invitedCreator } = (await accepted.json()) as {
      creator: { role: string; workspaceId: string };
    };
    expect(invitedCreator.role).toBe("editor");
    expect(invitedCreator.workspaceId).toBeTruthy();
    expect(invitedCreator.workspaceId).not.toBe(originalCreator.workspaceId);
    const select = (workspaceId: string) =>
      otherTab.request.post(`${api}/v1/workspaces/${workspaceId}/select`, { data: {} });
    expect((await select(originalCreator.workspaceId)).ok()).toBe(true);

    await page.bringToFront();
    const fixture = await installReads(page);
    const releaseWorkspaceList = fixture.hold(workspaceListPath);
    const resumeSessionChecks = gate();
    const releaseRenameConflict = gate();
    try {
      const scopedReads = [
        "/v1/account/theme",
        corePath,
        institutionPath,
        "/v1/auth/federated-identities",
      ].map((path) =>
        page.waitForResponse((response) => {
          const url = new URL(response.url());
          return (
            url.origin === api && url.pathname === path && response.request().method() === "GET"
          );
        }),
      );
      await page.goto("/account#overview");
      const load = page.locator("#account-load-state");
      const rename = page.getByRole("button", { name: "Save workspace name", exact: true });
      const settings = page.locator("#settings-panel");
      const navigation = page.getByRole("tablist", { name: "Settings categories", exact: true });
      const retry = load.getByRole("button", { name: "Try again", exact: true });
      const workspace = settings.getByRole("combobox", { name: "Workspace", exact: true });
      await expect(load).toHaveAttribute("aria-busy", "true");
      await expect.poll(() => fixture.count(workspaceListPath)).toBe(1);
      const originalReads = await Promise.all(scopedReads);
      for (const response of originalReads) {
        expect(response.ok()).toBe(true);
        expect(new URL(response.url()).searchParams.get("expectedWorkspaceId")).toBe(
          originalCreator.workspaceId,
        );
      }

      // Let only the workspace list resolve after the shared session switches.
      // A successful HTTP response can still disagree with the loaded authority.
      const switched = await select(invitedCreator.workspaceId);
      expect(switched.status()).toBe(200);
      expect(await switched.json()).toEqual({ activeWorkspaceId: invitedCreator.workspaceId });
      const workspaceList = page.waitForResponse(`${api}${workspaceListPath}`);
      releaseWorkspaceList();
      const listed = await workspaceList;
      expect(listed.ok()).toBe(true);
      const workspaceSnapshot = await listed.json();
      expect(workspaceSnapshot).toMatchObject({ activeWorkspaceId: invitedCreator.workspaceId });
      await expect(
        load.getByRole("heading", { name: "Workspace settings are unavailable", exact: true }),
      ).toBeVisible();
      await expect(navigation).toHaveCount(0);
      await expect(settings).toHaveCount(0);
      await expect(rename).toHaveCount(0);
      expect(fixture.count(membersPath)).toBe(0);
      expect(fixture.count(ltiPath)).toBe(0);

      await retry.click();
      await expect(navigation).toBeVisible();
      await expect(workspace).toHaveValue(invitedCreator.workspaceId);
      await expect(rename).toHaveCount(0);

      expect((await select(originalCreator.workspaceId)).status()).toBe(200);
      await page.reload();
      await expect(workspace).toHaveValue(originalCreator.workspaceId);
      await expect(rename).toBeEnabled();
      // Delay session reconciliation so the stale form encounters the settings conflict
      // before the idle-session boundary observes the switch and remounts the page.
      await page.route(
        (url) =>
          url.origin === api &&
          ["/v1/auth/session", "/v1/auth/session/activity"].includes(url.pathname),
        async (route) => {
          await resumeSessionChecks.promise;
          await route.continue();
        },
      );
      const renamePath = "/v1/workspace/settings";
      let forwardedRename = false;
      await page.route(
        (url) => url.origin === api && url.pathname === renamePath,
        async (route) => {
          if (route.request().method() !== "PATCH" || forwardedRename) return route.fallback();
          forwardedRename = true;
          const response = await route.fetch();
          await releaseRenameConflict.promise;
          await route.fulfill({ response });
        },
      );
      const draftName = "Stale rename attempt";
      await settings.getByRole("textbox", { name: "Workspace name", exact: true }).fill(draftName);
      await rename.focus();
      await expect(rename).toBeFocused();
      expect((await select(invitedCreator.workspaceId)).status()).toBe(200);
      const renameResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.origin === api &&
          url.pathname === renamePath &&
          response.request().method() === "PATCH"
        );
      });
      await rename.press("Enter");
      const saving = settings.getByRole("button", { name: "Saving…", exact: true });
      await expect(saving).toBeDisabled();
      if (browserName === "chromium") {
        await expect(saving).not.toBeFocused();
      }
      releaseRenameConflict.release();
      const conflict = await renameResponse;
      expect(conflict.status()).toBe(409);
      expect(await conflict.json()).toMatchObject({ error: { code: "CONFLICT" } });
      expect(new URL(conflict.url()).searchParams.get("expectedWorkspaceId")).toBe(
        originalCreator.workspaceId,
      );
      expect(conflict.request().postDataJSON()).toEqual({ name: draftName });
      await expect(load).toBeFocused();
      await expect(settings).toHaveCount(0);
      await retry.click();
      await expect(workspace).toHaveValue(invitedCreator.workspaceId);
      await expect(rename).toHaveCount(0);
      const after = await otherTab.request.get(`${api}${workspaceListPath}`);
      expect(after.ok()).toBe(true);
      expect(await after.json()).toEqual(workspaceSnapshot);
      expect(fixture.mutations).toEqual([]);
    } finally {
      releaseRenameConflict.release();
      resumeSessionChecks.release();
      fixture.releaseAll();
    }
  } finally {
    await otherTab.close();
    await ownerContext.close();
  }
});
