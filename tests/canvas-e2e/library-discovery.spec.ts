import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIResponse, type Page, type TestInfo } from "@playwright/test";
import { e01Slide } from "../beta-e2e/presentation-e01-support";
import { api, fits, organization, teammate } from "./support";

async function result(response: Promise<APIResponse>, status = 200) {
  const value = await response;
  expect(value.status()).toBe(status);
  return value.json();
}

async function appearance(page: Page, info: TestInfo, name: string, mobile: boolean) {
  for (const width of mobile ? [320, 390] : [1440]) {
    await page.setViewportSize({ width, height: mobile ? 844 : 1000 });
    for (const mode of ["light", "dark", "high-contrast"] as const) {
      const colorScheme = mode === "dark" ? "dark" : "light";
      await page.emulateMedia({
        colorScheme,
        forcedColors: mode === "high-contrast" ? "active" : "none",
      });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
      // WebKit can publish the root mode before offscreen descendants inherit its palette.
      // Wait for actual text colors; retain the full contrast audit below.
      const foreground =
        colorScheme === "dark"
          ? "rgb(232, 235, 240)"
          : mode === "high-contrast"
            ? /rgb\((?:0, 0, 0|48, 54, 64)\)/
            : "rgb(48, 54, 64)";
      for (const text of [
        page.locator("[data-library-discovery] label > span").first(),
        page.locator('[data-library-discovery] p[role="status"] strong'),
        page.locator("[data-library-item] article").first().locator("span").first(),
      ])
        await expect(text).toHaveCSS("color", foreground);
      const message = page.locator("[data-library-share-message]").first();
      if (await message.count()) await expect(message).toHaveCSS("color", foreground);
      for (const control of await page.locator("[data-library-discovery] select").all()) {
        const bounds = await control.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
      }
      await fits(page);
      expect(
        (
          await new AxeBuilder({ page })
            .include("[data-library-discovery]")
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await page.screenshot({
        path: info.outputPath(`${name}-${width}-${mode}.png`),
        fullPage: true,
      });
    }
  }
  await page.emulateMedia({ colorScheme: "light", forcedColors: "none" });
}

for (const mobile of [false, true]) {
  const suffix = mobile ? " @mobile" : "";
  test(`All content searches complete mixed metadata and preserves paginated results on retry${suffix}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await page.setViewportSize({ width: mobile ? 390 : 1440, height: 1000 });
    await organization(page, info);
    const { quiz } = await result(
      page.request.post(`${api}/v1/quizzes`, {
        data: { title: "Alpha launch check", description: "A synthetic Round for discovery." },
      }),
      201,
    );
    const { presentation } = await result(
      page.request.post(`${api}/v1/presentations`, {
        data: { title: "Bravo workshop plan" },
      }),
      201,
    );
    const { survey } = await result(
      page.request.post(`${api}/v1/surveys`, {
        data: { idempotencyKey: randomUUID(), title: "Charlie event pulse" },
      }),
      201,
    );
    const original = await result(
      page.request.get(`${api}/v1/library/items?sort=title_asc&limit=2`),
    );
    expect(original.facets.total).toBe(3);
    expect(original.facets.kinds).toEqual({ round: 1, presentation: 1, survey: 1 });
    expect(original.items.map((item: { id: string }) => item.id)).toEqual([
      quiz.id,
      presentation.id,
    ]);
    expect(
      original.items.every(
        (item: Record<string, unknown>) => !("draft" in item) && !("previewBlock" in item),
      ),
    ).toBe(true);

    let failNextPage = true;
    await page.route("**/v1/library/items*", async (route) => {
      const url = new URL(route.request().url());
      url.searchParams.set("limit", "2");
      if (url.searchParams.has("cursor") && failNextPage) {
        failNextPage = false;
        await route.fulfill({
          status: 503,
          json: { error: { code: "TEMPORARY", message: "Synthetic page retry" } },
        });
      } else await route.continue({ url: url.toString() });
    });
    await page.goto("/library?sort=title_asc");
    const root = page.locator("[data-library-discovery]");
    const rows = root.locator("[data-library-item]");
    await expect(rows).toHaveCount(2);
    await expect(root.getByText("Results: 3", { exact: true })).toBeVisible();
    await expect(root.locator("#library-discovery-summary")).toContainText("Loaded: 2");
    await root.getByRole("button", { name: "Load more", exact: true }).click();
    await expect(root.getByRole("alert")).toContainText("Your current results are kept");
    await expect(root.locator("[data-library-pagination]")).toBeFocused();
    await expect(rows).toHaveCount(2);
    await root
      .locator("[data-library-pagination]")
      .getByRole("button", { name: "Retry", exact: true })
      .click();
    await expect(rows).toHaveCount(3);
    await expect(root.locator("#library-discovery-summary")).toContainText("Loaded: 3");
    await expect(root.locator("[data-library-pagination]")).toBeFocused();
    await expect(root.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0);
    await appearance(page, info, "all-content", mobile);

    await page.goto("/library?sort=title_asc");
    await expect(rows).toHaveCount(2);
    const search = root.getByRole("searchbox", { name: "Search all content", exact: true });
    await search.fill("Charlie");
    await search.press("Enter");
    await expect(page).toHaveURL(/q=Charlie/);
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Charlie event pulse");
    await page.reload();
    await expect(search).toHaveValue("Charlie");
    await expect(rows).toHaveCount(1);
    await root
      .getByRole("combobox", { name: "Library content type", exact: true })
      .selectOption("round");
    await expect(
      root.getByRole("heading", { name: "No matching content", exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Charlie event pulse");
    await page.goBack();
    await expect(rows).toHaveCount(2);
    await expect(search).toHaveValue("");

    await result(
      page.request.put(`${api}/v1/library/favorites/survey/${survey.id}`, {
        data: { favorite: true },
      }),
    );
    await root.getByRole("button", { name: "Favorites", exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Charlie event pulse");
    await root.getByRole("link", { name: "Surveys", exact: true }).click();
    await expect(page).toHaveURL(/type=surveys/);
    await expect(page.getByRole("tab", { name: /^Surveys/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("link", { name: "All content", exact: true })).toBeVisible();
  });

  test(`Organization discovery keeps permissions and follow-up separate from workspace access${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    const { owner, organizationId } = await organization(page, info);
    const member = await teammate(page, browser, organizationId, info);
    await member.page.setViewportSize({ width: mobile ? 390 : 1440, height: 1000 });
    try {
      const created = await result(
        page.request.post(`${api}/v1/starters/new-hire-knowledge-check/use`, { data: {} }),
        201,
      );
      const round = created.quiz;
      const { version } = await result(
        page.request.post(`${api}/v1/quizzes/${round.id}/publish`, {
          data: { expectedDraftRevision: round.draftRevision },
        }),
      );
      const { presentation } = await result(
        page.request.post(`${api}/v1/presentations`, { data: { title: "Company reference deck" } }),
        201,
      );
      const saved = await result(
        page.request.put(`${api}/v1/presentations/${presentation.id}/draft`, {
          data: {
            draft: {
              ...presentation.draft,
              schemaVersion: 14,
              blocks: [e01Slide("A published company reference")],
            },
            expectedRevision: presentation.draftRevision,
            mutationId: randomUUID(),
            schemaVersion: 2,
          },
        }),
      );
      const publication = await result(
        page.request.post(`${api}/v1/presentations/${presentation.id}/publish`, {
          data: { expectedDraftRevision: saved.presentation.draftRevision },
        }),
      );
      const share = async (
        artifactType: string,
        artifactId: string,
        versionId: string,
        audience: "organization" | "people",
        permission: "view" | "use",
        message: string,
      ) =>
        (
          await result(
            page.request.post(`${api}/v1/library/shares`, {
              data: {
                requestId: randomUUID(),
                artifactType,
                artifactId,
                versionId,
                audience,
                permission,
                recipientIds: audience === "people" ? [member.identity.creator.userId] : [],
                message,
                dueAt: null,
              },
            }),
            201,
          )
        ).share;
      const company = await share(
        "round",
        round.id,
        version.id,
        "organization",
        "view",
        "Reference material for the company",
      );
      await share(
        "presentation",
        presentation.id,
        publication.version.id,
        "organization",
        "use",
        "Reusable deck",
      );
      const direct = await share(
        "presentation",
        presentation.id,
        publication.version.id,
        "people",
        "use",
        "Please review this specific follow-up",
      );

      await member.page.goto("/library?scope=organization");
      const root = member.page.locator("[data-library-discovery]");
      const rows = root.locator("[data-library-item]");
      await expect(rows).toHaveCount(2);
      await expect(root.getByText("Results: 2", { exact: true })).toBeVisible();
      await expect(root.locator(`[data-library-item="${direct.id}"]`)).toHaveCount(0);
      await root.getByRole("combobox", { name: "Permission", exact: true }).selectOption("view");
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText("Can view");
      await expect(rows.getByRole("button", { name: "Use a copy", exact: true })).toHaveCount(0);
      expect((await member.page.request.get(`${api}/v1/quizzes/${round.id}`)).status()).toBe(404);
      await appearance(member.page, info, "organization-discovery", mobile);

      const clear = root.getByRole("button", { name: "Clear filters", exact: true });
      await clear.focus();
      await clear.press("Enter");
      await expect(
        root.getByRole("searchbox", { name: "Search shared content", exact: true }),
      ).toBeFocused();
      await expect(member.page).toHaveURL(/scope=organization$/);
      await expect(rows).toHaveCount(2);

      await root.getByRole("link", { name: "Shared with me", exact: true }).click();
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText("Please review this specific follow-up");
      await rows.getByRole("button", { name: "Mark reviewed", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await result(member.page.request.get(`${api}/v1/library/shares/${direct.id}`))).share
              .progress,
        )
        .toBe("done");
      await root
        .getByRole("combobox", { name: "Review progress", exact: true })
        .selectOption("done");
      await expect(rows).toHaveCount(1);
      await root
        .getByRole("combobox", { name: "Review progress", exact: true })
        .selectOption("new");
      await expect(rows).toHaveCount(0);
      const noMatches = root.getByRole("heading", { name: "No matching content", exact: true });
      const emptyClear = noMatches
        .locator("..")
        .getByRole("button", { name: "Clear filters", exact: true });
      await emptyClear.focus();
      await emptyClear.press("Enter");
      await expect(
        root.getByRole("searchbox", { name: "Search shared content", exact: true }),
      ).toBeFocused();
      await expect(member.page).toHaveURL(/scope=shared$/);
      await expect(rows).toHaveCount(1);
      await root
        .getByRole("combobox", { name: "Review progress", exact: true })
        .selectOption("done");
      await expect(rows).toHaveCount(1);
      expect(
        (await member.page.request.get(`${api}/v1/presentations/${presentation.id}`)).status(),
      ).toBe(404);
      expect((await result(member.page.request.get(`${api}/v1/library/items`))).items).toEqual([]);
      expect(owner.creator.workspaceId).not.toBe(member.identity.creator.workspaceId);
      expect((await page.request.delete(`${api}/v1/library/shares/${direct.id}`)).status()).toBe(
        204,
      );
      await member.page.reload();
      await expect(rows).toHaveCount(0);
      expect(
        (await member.page.request.get(`${api}/v1/library/shares/${direct.id}`)).status(),
      ).toBe(404);
      expect(
        (await member.page.request.get(`${api}/v1/library/shares/${company.id}`)).status(),
      ).toBe(200);
    } finally {
      await member.context.close();
    }
  });
}
