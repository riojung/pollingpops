import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { LocalReturnPathSchema } from "../../packages/contracts/src/index.ts";
import { signInCreator, type CreatorAuthOptions } from "../support/creator-auth";

// This account receives the beta server's explicitly seeded, allowlisted workspace.
export const betaEmail = "ux-beta-e2e@example.com";

type CreatorCookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
const sessions = new Map<string, CreatorCookies>();

async function validSession(page: Page, apiOrigin: string, email: string) {
  const response = await page.request.get(`${apiOrigin}/v1/auth/me`);
  if (!response.ok()) return false;
  const account = (await response.json()) as { creator: { email: string } };
  return account.creator.email === email.trim().toLowerCase();
}

export async function signInBeta(
  page: Page,
  email = betaEmail,
  options: Pick<CreatorAuthOptions, "returnTo"> = {},
) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("Beta sign-in requires a configured Playwright baseURL");
  // Resolve the cache scope without loading a document that cached sessions would discard.
  const webOrigin = new URL(baseURL).origin;
  const destination = LocalReturnPathSchema.safeParse(options.returnTo ?? "/dashboard");
  if (!destination.success) throw new Error("Beta sign-in requires a local return path");
  const returnTo = destination.data;
  const apiOrigin = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
  const key = createHash("sha256").update(`${webOrigin}\n${apiOrigin}\n${email}`).digest("hex");
  const cacheDirectory = process.env.BETA_E2E_AUTH_CACHE_DIR;
  const cachePath = cacheDirectory ? path.join(cacheDirectory, `${key}.json`) : undefined;
  let cookies = sessions.get(key);
  if (!cookies && cachePath) {
    try {
      cookies = JSON.parse(await readFile(cachePath, "utf8")) as CreatorCookies;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (cookies?.length) {
    await page.context().addCookies(cookies);
    // A restarted API invalidates old sessions. Reuse only a real, live creator session.
    if (await validSession(page, apiOrigin, email)) {
      sessions.set(key, cookies);
      await page.goto(returnTo, { waitUntil: "load" });
      await expect(page).not.toHaveURL(/\/signin/);
      return;
    }
    await page.context().clearCookies({ name: "openround_creator" });
  }

  // Keep fresh and reused sessions on the same requested route. Existing callers retain
  // the dashboard default; route-specific fixtures can avoid discarding its prefetch work.
  await signInCreator(page, email, { segment: "education", returnTo });
  cookies = (await page.context().cookies()).filter(
    (cookie) => cookie.name === "openround_creator",
  );
  expect(cookies).toHaveLength(1);
  expect(await validSession(page, apiOrigin, email)).toBe(true);
  sessions.set(key, cookies);
  // Never write bearer credentials into the repository or uploaded Playwright artifacts.
  if (cachePath) await writeFile(cachePath, JSON.stringify(cookies), { mode: 0o600 });
}
