import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { specialistLocale } from "./option-b-specialist-support";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const accountUrl = `${api}/v1/auth/me`;
const planNotice = "This workspace’s plan does not include checkpoint-set exports.";
const policyNotice = "Checkpoint-set exports are disabled by your Polling Pops operator.";
const germanPolicyNotice =
  "Ihr Polling Pops-Betreiber hat den Export von Checkpoint-Sets deaktiviert.";
const exportLabels = ["Export JSON", "Export CSV", "Export QTI 3"];

for (const suffix of ["", " @mobile"]) {
  test(`Rounds explains checkpoint-set export restrictions${suffix}`, async ({ page }) => {
    await signInBeta(page, undefined, { returnTo: "/home" });
    await specialistLocale(page, "en-CA");
    const webOrigin = new URL(page.url()).origin;
    const accountResponse = await page.request.get(accountUrl);
    expect(accountResponse.ok()).toBe(true);
    const { creator, entitlements } = await accountResponse.json();
    expect(creator.role).toBe("owner");
    expect(entitlements.csvExport).toBe(true);

    const title = `Export availability ${randomUUID()}`;
    const created = await page.request.post(`${api}/v1/quizzes`, { data: { title } });
    expect(created.status()).toBe(201);
    const { quiz } = await created.json();
    const jsonExport = `/v1/quizzes/${quiz.id}/export.json`;

    let planDenied = true;
    await page.route(accountUrl, async (route) => {
      if (!planDenied) return route.continue();
      const response = await route.fetch();
      const account = await response.json();
      return route.fulfill({
        response,
        json: {
          ...account,
          entitlements: { ...account.entitlements, csvExport: false },
          csvExportUnavailableReason: "plan_limit",
        },
      });
    });
    const exportRequests: string[] = [];
    let policyDenied = true;
    await page.route(
      (url) =>
        url.origin === api &&
        /^\/v1\/quizzes\/[^/]+\/export\.(json|csv|qti\.zip)$/.test(url.pathname),
      (route) => {
        exportRequests.push(route.request().url());
        if (!policyDenied) return route.continue();
        return route.fulfill({
          status: 402,
          headers: {
            "access-control-allow-origin": webOrigin,
            "access-control-allow-credentials": "true",
          },
          json: {
            error: {
              code: "ENTITLEMENT_LIMIT",
              message: "Checkpoint-set export is unavailable for this workspace",
              requestId: "synthetic-checkpoint-export-denied",
              details: {
                unavailableReason: "operator_policy",
                actorId: creator.userId,
                workspaceId: creator.workspaceId,
              },
            },
          },
        });
      },
    );
    const downloads: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));

    await page.goto(`/dashboard?q=${encodeURIComponent(title)}`);
    const main = page.getByRole("main");
    const list = main.getByRole("region", { name: "Round library", exact: true });
    const card = list.getByRole("article").filter({
      has: page.getByRole("heading", { name: title, exact: true }),
    });
    const openActions = () => card.getByText("More", { exact: true }).click();
    const exportButton = (name: string) => card.getByRole("button", { name, exact: true });
    const exportActions = card.getByText(/^Export (JSON|CSV|QTI 3)$/);

    await expect(main.getByRole("heading", { name: "Rounds", level: 1 })).toBeVisible();
    await expect(card).toBeVisible();
    const planMessage = main.getByText(planNotice, { exact: true });
    await expect(planMessage).toBeVisible();
    await expect(planMessage).toHaveAttribute("lang", "en-CA");
    expect((await planMessage.boundingBox())!.y).toBeLessThan((await list.boundingBox())!.y);
    await openActions();
    await expect(exportActions).toHaveCount(0);
    await card.getByRole("button", { name: "Organize", exact: true }).click();
    await expect(card.getByRole("textbox", { name: "Tags, separated by commas" })).toBeVisible();
    await card.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(exportRequests).toEqual([]);

    planDenied = false;
    await page.reload();
    await openActions();
    for (const label of exportLabels) await expect(exportButton(label)).toBeVisible();
    await expect(planMessage).toHaveCount(0);
    const response = page.waitForResponse(
      (candidate) => new URL(candidate.url()).pathname === jsonExport,
    );
    await exportButton("Export JSON").click();
    expect((await response).status()).toBe(402);
    const exportAlert = main.getByRole("alert");
    await expect(exportAlert).toHaveText(policyNotice);
    await expect(exportAlert).toHaveAttribute("lang", "en-CA");
    await expect(card.getByRole("link", { name: "Edit", exact: true })).toHaveAttribute(
      "href",
      `/quiz/${quiz.id}`,
    );
    try {
      await page.locator('summary[role="button"][aria-label^="EN:"]').click();
      const savedLanguage = page.waitForResponse(
        (candidate) =>
          candidate.url() === `${api}/v1/account/locale` && candidate.request().method() === "PUT",
      );
      await page.getByRole("radio", { name: /Deutsch/ }).click();
      expect((await savedLanguage).ok()).toBe(true);
      await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
      await expect(main).toHaveAttribute("lang", "en-CA");
      await expect(exportAlert).toHaveText(germanPolicyNotice);
      await expect(exportAlert).toHaveAttribute("lang", "de-DE");
      expect(exportRequests).toEqual([
        `${api}${jsonExport}?expectedWorkspaceId=${creator.workspaceId}`,
      ]);
      expect(downloads).toEqual([]);

      policyDenied = false;
      const download = page.waitForEvent("download");
      await exportButton("Export JSON").click();
      expect((await download).suggestedFilename()).toBe(`polling-pops-round-${quiz.id}.json`);
      await expect(exportAlert).toHaveCount(0);
    } finally {
      await specialistLocale(page, "en-CA");
    }
  });
}
