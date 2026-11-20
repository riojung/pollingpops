import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";
import { specialistLocale } from "./option-b-specialist-support";
import {
  expectDocumentReflow,
  expectVisibleKeyboardFocus,
  tabTo,
} from "./option-b-accessibility-support";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const corePath = "/v1/account/embed-origins";
const ownerPath = "/v1/workspace/lti-registrations";
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

async function installFailures(page: Page, initiallyHeld = true) {
  const initial = gate();
  const retry = gate();
  const owner = gate();
  const reads: string[] = [];
  const mutations: string[] = [];
  let phase: "initial" | "owner" | "retry-ready" | "ready" = "initial";
  await page.route(`${api}/v1/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      if (/^\/v1\/(?:account|billing|workspace|workspaces)(?:\/|$)/.test(path)) {
        mutations.push(`${request.method()} ${path}`);
        return route.abort();
      }
      return route.continue();
    }
    reads.push(path);
    if (path === corePath && phase === "initial") {
      if (initiallyHeld) await initial.promise;
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
    if (path === ownerPath && phase === "owner") {
      await owner.promise;
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "UNAVAILABLE",
            message: "Synthetic owner settings read unavailable",
            requestId: "synthetic-owner-read",
          },
        },
      });
    }
    if (path === corePath && phase === "retry-ready") await retry.promise;
    return route.continue();
  });
  return {
    reads,
    mutations,
    releaseInitial: initial.release,
    releaseOwner: owner.release,
    releaseRetry: retry.release,
    retryOwner: () => {
      phase = "owner";
    },
    retryReady: () => {
      phase = "retry-ready";
    },
    ready: () => {
      phase = "ready";
    },
    releaseAll: () => {
      initial.release();
      retry.release();
      owner.release();
    },
  };
}

async function quality(page: Page) {
  await expectDocumentReflow(page);
  expect(
    (
      await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

for (const phone of [false, true]) {
  const suffix = phone ? " @mobile" : "";
  test(`Workspace settings recover atomically without replaying actions${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: phone ? 320 : 1440, height: phone ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await signInBeta(page, undefined, { returnTo: "/home" });
    await specialistLocale(page, "en-CA");
    const fixture = await installFailures(page);
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
      fixture.releaseInitial();
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
      const ownerReads = fixture.reads.filter((path) => path === ownerPath).length;
      fixture.retryOwner();
      await page.keyboard.press("Enter");
      await expect(load).toBeFocused();
      await expect(load).toHaveAttribute("aria-busy", "true");
      await expect(page.locator("#settings-panel")).toHaveCount(0);
      await expect
        .poll(() => fixture.reads.filter((path) => path === ownerPath).length)
        .toBeGreaterThan(ownerReads);
      fixture.releaseOwner();
      await expect(
        page.getByText("Synthetic owner settings read unavailable", { exact: true }),
      ).toBeVisible();
      await expect(page.locator("#settings-panel")).toHaveCount(0);
      expect(new URL(page.url()).hash).toBe("#appearance");

      await tabTo(page, retry);
      fixture.ready();
      await page.keyboard.press("Enter");
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
    const fixture = await installFailures(page, false);
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
      fixture.retryReady();
      await page.keyboard.press("Enter");
      await expect(load).toHaveAttribute("aria-busy", "true");
      const outside = page
        .getByRole("navigation", { name: "Account navigation", exact: true })
        .getByRole("link", { name: "Dashboard", exact: true });
      await outside.focus();
      fixture.releaseRetry();
      await expect(page.locator("#settings-panel")).toBeVisible();
      await expect(outside).toBeFocused();

      fixture.ready();
      const readsBefore = fixture.reads.filter(
        (path) => path === corePath || path === ownerPath,
      ).length;
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
      expect(fixture.reads.filter((path) => path === corePath || path === ownerPath)).toHaveLength(
        readsBefore,
      );
      await quality(page);
      expect(fixture.mutations).toEqual([]);
    } finally {
      fixture.releaseAll();
    }
  });
}
