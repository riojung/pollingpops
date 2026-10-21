import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import setupBetaAuth from "../beta-e2e/auth-setup";
import { describe, expect, it } from "vitest";

const betaDirectory = new URL("../beta-e2e/", import.meta.url);

describe("beta sign-in fixture contract", () => {
  it("preserves asserted keyboard consent in the real verification and PIN journeys", async () => {
    const helper = await readFile(new URL("creator-auth.ts", import.meta.url), "utf8");
    expect(helper).toContain("await expect(policyConsent).toBeEnabled()");
    expect(helper).toContain("await expect(policyConsent).not.toBeChecked()");
    expect(helper).toContain("await policyConsent.focus()");
    expect(helper).toContain("await expect(policyConsent).toBeFocused()");
    expect(helper.match(/policyConsent\.press\("Space"\)/g)).toHaveLength(1);
    expect(helper).toContain("await expect(policyConsent).toBeChecked()");
    expect(helper.match(/await acceptCreatorPolicies\(page\)/g)).toHaveLength(2);
    expect(helper).toContain('waitForAuthResponse(page, "/v1/auth/email-verification")');
    expect(helper).toContain('waitForAuthResponse(page, "/v1/auth/pin/request")');
    expect(helper).toContain('waitForAuthResponse(page, "/v1/auth/pin/verify")');
    expect(helper).toContain('form.getByLabel("Sign-in PIN", { exact: true }).fill(pin)');
    expect(helper).toContain("await expectAnonymousCreator(page, apiOrigin)");
    expect(helper).toContain("acceptPolicies: true");
    expect(helper).toContain('{ waitUntil: "load" }');
    expect(helper).not.toMatch(/force:|waitForTimeout|\.check\(|\.evaluate\(|\bwhile\b/);
    expect(helper).not.toContain("/v1/auth/magic-link");
  });

  it("reuses only live creator sessions and keeps cached credentials outside uploaded artifacts", async () => {
    const helper = await readFile(new URL("sign-in.ts", betaDirectory), "utf8");
    const config = await readFile(
      new URL("../../playwright.beta.config.ts", import.meta.url),
      "utf8",
    );
    const setup = await readFile(new URL("auth-setup.ts", betaDirectory), "utf8");
    expect(helper).toContain("if (await validSession(page, apiOrigin, email))");
    expect(helper).toContain("page.request.get(`${apiOrigin}/v1/auth/me`)");
    expect(helper).toContain(
      'await signInCreator(page, email, { segment: "education", returnTo: "/dashboard" })',
    );
    expect(helper).toContain("mode: 0o600");
    expect(setup).toContain("const namespace = randomUUID()");
    expect(setup).toContain(
      "await mkdtemp(path.join(os.tmpdir(), `pollingpops-beta-auth-${namespace}-`))",
    );
    expect(config).toContain('globalSetup: "./tests/beta-e2e/auth-setup.ts"');
    expect(setup).toContain("await chmod(directory, 0o700)");
    expect(setup).toContain("await rm(directory, { recursive: true, force: true })");
    expect(helper).not.toMatch(/path\.join\([^\n]*(?:test-results|playwright-report)/);
  });

  it("creates an owner-only temporary session cache and removes it after the run", async () => {
    const teardown = await setupBetaAuth();
    const directory = process.env.BETA_E2E_AUTH_CACHE_DIR!;
    try {
      expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
      expect(path.basename(directory)).toMatch(/^pollingpops-beta-auth-/);
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
    } finally {
      await teardown();
    }
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
    expect(process.env.BETA_E2E_AUTH_CACHE_DIR).toBeUndefined();
  });

  it("shares the authenticated session helper across every beta feature fixture", async () => {
    const specs = (await readdir(betaDirectory)).filter((name) => name.endsWith(".spec.ts"));
    expect(specs.length).toBeGreaterThan(0);
    for (const name of specs) {
      const source = await readFile(new URL(name, betaDirectory), "utf8");
      expect(source, name).toContain('from "./sign-in"');
      expect(source, name).toContain("await signInBeta(page");
      expect(source, name).not.toContain("policyConsent");
    }
  });
});
