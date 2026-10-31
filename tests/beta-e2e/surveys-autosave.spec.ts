import { json } from "node:stream/consumers";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
async function openSurvey(page: Page) {
  await signInBeta(page);
  await page.goto("/surveys/new");
  await page.getByLabel("Search templates").fill("Training feedback");
  await page.getByRole("button", { name: "Use this starter", exact: true }).click();
  await expect(page).toHaveURL(/\/surveys\/[0-9a-f-]+$/);
  await expect(page.getByLabel("Title", { exact: true })).toBeEnabled();
  return page.url().split("/surveys/")[1]!;
}
async function storedSurvey(page: Page, id: string) {
  const response = await page.request.get(`${api}/v1/surveys/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).survey;
}

async function cancelExit(page: Page, action: () => Promise<unknown>, editorUrl: string) {
  const appeared = page.waitForEvent("dialog");
  const attempted = action();
  const dialog = await appeared;
  expect(dialog.type()).toBe("confirm");
  expect(dialog.message()).toBe("Changes are not fully saved. Leave this editor anyway?");
  await dialog.dismiss();
  await attempted;
  await expect(page).toHaveURL(editorUrl);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Synthetic local work");
}

function exitLinks(page: Page, mobile: boolean): Locator[] {
  const nav = page.getByRole("navigation", {
    name: mobile ? "Workspace sections" : "Workspace",
    exact: true,
  });
  return [
    page.getByRole("link", { name: "All Surveys", exact: true }),
    ...[
      "Home",
      "Library",
      "Sessions",
      "Assignments",
      "Results",
      "Discover",
      "Groups",
      "Workspace",
    ].map((name) => nav.getByRole("link", { name, exact: true })),
    page.locator(mobile ? "header .brand" : "aside .brand"),
    page.locator('header a[aria-label="Open account and workspace settings"]'),
    ...(!mobile
      ? [
          page.locator('header a[href="/activity"]'),
          page.locator('header a[href="/help"]'),
          page.locator('header a[href="/account"]').first(),
        ]
      : []),
  ];
}

for (const surface of ["", "@mobile "]) {
  test(`${surface}Survey guards every workspace link during the autosave debounce window`, async ({
    page,
  }) => {
    const id = await openSurvey(page);
    const editorUrl = page.url();
    // Freeze the browser timer so slow CI cannot accidentally complete the 700 ms
    // debounce before exercising each navigation surface.
    // Pin wall time first so transport latency cannot put the pause target in the past.
    const pauseTime = new Date();
    await page.clock.setFixedTime(pauseTime);
    await page.clock.pauseAt(pauseTime);
    await page.getByLabel("Title", { exact: true }).fill("Synthetic local work");
    for (const link of exitLinks(page, Boolean(surface))) {
      await expect(link).toBeVisible();
      await cancelExit(page, () => link.click(), editorUrl);
    }
    await page.locator('summary[aria-label="Create"]').click();
    for (const href of ["/create", "/create/presentation", "/surveys/new"])
      await cancelExit(page, () => page.locator(`a[href="${href}"]`).click(), editorUrl);
    await page.locator('summary[aria-label="Create"]').click();
    expect((await storedSurvey(page, id)).draft.title).not.toBe("Synthetic local work");

    // Confirming discard navigates exactly once, rather than prompting on both
    // the old page-local handler and the shared link handler.
    let prompts = 0;
    page.on("dialog", async (dialog) => {
      prompts++;
      await dialog.accept();
    });
    await page.getByRole("link", { name: "All Surveys", exact: true }).click();
    await expect(page).toHaveURL(/\/library\?type=surveys$/);
    expect(prompts).toBe(1);
  });

  for (const failure of ["error", "conflict"] as const) {
    test(`${surface}Survey ${failure} guards workspace exits until a successful save or explicit discard`, async ({
      page,
    }) => {
      const id = await openSurvey(page);
      const editorUrl = page.url();
      await page.route(`${api}/v1/surveys/${id}`, async (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        await route.fulfill({
          status: failure === "conflict" ? 409 : 400,
          contentType: "application/json",
          headers: {
            "access-control-allow-origin": new URL(editorUrl).origin,
            "access-control-allow-credentials": "true",
          },
          body: JSON.stringify({
            error: {
              code: failure === "conflict" ? "STALE_DRAFT" : "VALIDATION_ERROR",
              message: "Synthetic save failure",
            },
          }),
        });
      });
      await page.getByLabel("Title", { exact: true }).fill("Synthetic local work");
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        "Synthetic save failure",
      );
      for (const link of exitLinks(page, Boolean(surface)))
        await cancelExit(page, () => link.click(), editorUrl);

      const search = page.getByRole("searchbox", { name: "Search your workspace library" });
      await search.fill("Synthetic search");
      await cancelExit(page, () => search.press("Enter"), editorUrl);
      if (!surface) {
        await cancelExit(
          page,
          () => page.getByRole("button", { name: "Sign out", exact: true }).click(),
          editorUrl,
        );
        expect((await page.request.get(`${api}/v1/auth/me`)).ok()).toBe(true);
      }

      // Remove the fault and save/reload explicitly. Settled navigation must not
      // inherit a stale blocker after the controller acknowledges the draft.
      await page.unroute(`${api}/v1/surveys/${id}`);
      if (failure === "conflict") {
        page.once("dialog", (dialog) => dialog.accept());
        await page.getByRole("button", { name: "Reload latest version", exact: true }).click();
        await expect(page.getByLabel("Title", { exact: true })).not.toHaveValue(
          "Synthetic local work",
        );
      } else {
        await page.getByRole("button", { name: "Retry save", exact: true }).click();
        await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
        expect((await storedSurvey(page, id)).draft.title).toBe("Synthetic local work");
      }
      let prompts = 0;
      page.on("dialog", async (dialog) => {
        prompts++;
        await dialog.dismiss();
      });
      await search.press("Enter");
      await expect(page).toHaveURL(/\/library\?type=surveys&q=Synthetic\+search$/);
      await expect(page.getByRole("tab", { name: /^Surveys/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(
        page.getByRole("searchbox", { name: "Search surveys", exact: true }),
      ).toHaveValue("Synthetic search");
      expect(prompts).toBe(0);
    });
  }

  test(`${surface}Survey autosave preserves word separators while editing text fields`, async ({
    page,
  }) => {
    const id = await openSurvey(page);
    const fields = [
      page.getByLabel("Title", { exact: true }),
      page.getByRole("textbox", { name: "Description", exact: true }),
      page.getByRole("textbox", { name: "Question", exact: true }).first(),
    ];
    for (const field of fields) await field.fill("Training ");
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    for (const field of fields) {
      await expect(field).toHaveValue("Training ");
      await field.focus();
      await field.press("End");
      await field.pressSequentially("feedback");
    }
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    for (const field of fields) await expect(field).toHaveValue("Training feedback");
    const stored = await storedSurvey(page, id);
    expect(stored.draft.title).toBe("Training feedback");
    expect(stored.draft.description).toBe("Training feedback");
    expect(stored.draft.items[0].question.prompt).toBe("Training feedback");
    await page.reload();
    for (const field of fields) await expect(field).toHaveValue("Training feedback");
  });

  test(`${surface}Survey autosave persists edits and publication drains the latest saved revision`, async ({
    page,
  }) => {
    const id = await openSurvey(page);
    await page.getByLabel("Title", { exact: true }).fill("Synthetic autosaved Survey");
    await page
      .getByRole("textbox", { name: "Description", exact: true })
      .fill("Synthetic self-paced feedback.");
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    expect((await storedSurvey(page, id)).draft.description).toBe("Synthetic self-paced feedback.");
    await page.reload();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
      "Synthetic autosaved Survey",
    );

    await page.getByLabel("Title", { exact: true }).fill("Synthetic latest publication");
    const published = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/surveys/${id}/publish`,
    );
    await page.getByRole("button", { name: "Publish Survey", exact: true }).click();
    const response = await published;
    expect(response.ok()).toBeTruthy();
    const saved = (await response.json()).survey;
    expect(saved.draft.title).toBe("Synthetic latest publication");
    expect(response.request().postDataJSON().expectedRevision).toBe(saved.revision);
    await expect(
      page.getByRole("button", { name: "Create sharing link", exact: true }),
    ).toBeEnabled();

    await page.getByLabel("Title", { exact: true }).fill("Synthetic unpublished changes");
    await expect(
      page.getByRole("button", { name: "Create sharing link", exact: true }),
    ).toBeDisabled();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    const changed = await storedSurvey(page, id);
    expect(changed.publishedRevision).toBeLessThan(changed.revision);
    await expect(
      page.getByRole("button", { name: "Create sharing link", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Publish Survey", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Create sharing link", exact: true }),
    ).toBeEnabled();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `test-results-beta/survey-autosave-${test.info().project.name}.png`,
      fullPage: true,
    });
  });

  test(`${surface}Survey autosave retries lost acknowledgements exactly without discarding newer typing`, async ({
    page,
  }) => {
    const id = await openSurvey(page);
    const bodies: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let accepted!: () => void;
    const firstAccepted = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    await page.route(`${api}/v1/surveys/${id}`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      bodies.push(route.request().postData()!);
      if (bodies.length <= 3) {
        // Commit to the real test API, but lose the response on all bounded automatic retries.
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        if (bodies.length === 1) {
          accepted();
          await held;
        }
        await route.abort("failed");
      } else await route.continue();
    });
    try {
      await page.getByLabel("Title", { exact: true }).fill("Synthetic accepted first");
      await firstAccepted;
      await expect(page.getByLabel("Title", { exact: true })).toBeEnabled();
      await page.getByLabel("Title", { exact: true }).fill("Synthetic newer edits");
      release();
      await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
      await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Synthetic newer edits");
      await expect(
        page.getByRole("button", { name: "Publish Survey", exact: true }),
      ).toBeDisabled();
      expect(bodies).toHaveLength(3);
      expect(new Set(bodies).size).toBe(1);
      expect(await storedSurvey(page, id)).toMatchObject({
        revision: 1,
        draft: { title: "Synthetic accepted first" },
      });
      await page.getByRole("button", { name: "Retry save", exact: true }).click();
      await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
      expect(bodies).toHaveLength(5);
      expect(bodies[3]).toBe(bodies[0]);
      expect(JSON.parse(bodies[4]!)).toMatchObject({
        expectedRevision: 1,
        draft: { title: "Synthetic newer edits" },
      });
      expect(await storedSurvey(page, id)).toMatchObject({
        revision: 2,
        draft: { title: "Synthetic newer edits" },
      });
      await page.reload();
      await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Synthetic newer edits");
    } finally {
      release();
      await page.unroute(`${api}/v1/surveys/${id}`);
    }
  });

  test(`${surface}Survey conflicts preserve local edits and require confirmation before loading another editor's version`, async ({
    page,
    context,
  }) => {
    const id = await openSurvey(page);
    const other = await context.newPage();
    try {
      await other.goto(page.url());
      await expect(other.getByLabel("Title", { exact: true })).toBeEnabled();
      await page.getByLabel("Title", { exact: true }).fill("Synthetic other editor version");
      await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
      await other.getByLabel("Title", { exact: true }).fill("Synthetic local work to keep");
      await expect(other.getByRole("main").getByRole("alert")).toContainText("Autosave is paused");
      await expect(other.getByLabel("Title", { exact: true })).toHaveValue(
        "Synthetic local work to keep",
      );
      await expect(
        other.getByRole("button", { name: "Publish Survey", exact: true }),
      ).toBeDisabled();
      expect((await storedSurvey(page, id)).draft.title).toBe("Synthetic other editor version");
      expect((await new AxeBuilder({ page: other }).analyze()).violations).toEqual([]);

      const download = other.waitForEvent("download");
      await other.getByRole("button", { name: "Download local draft", exact: true }).click();
      const copy = await download;
      expect(copy.suggestedFilename()).toBe(`polling-pops-survey-${id}-local-draft.json`);
      const data = await json(await copy.createReadStream());
      expect(data.title).toBe("Synthetic local work to keep");
      expect(data).not.toHaveProperty("workspaceId");

      other.once("dialog", (dialog) => dialog.dismiss());
      await other.getByRole("button", { name: "Reload latest version", exact: true }).click();
      await expect(other.getByLabel("Title", { exact: true })).toHaveValue(
        "Synthetic local work to keep",
      );
      other.once("dialog", (dialog) => dialog.accept());
      await other.getByRole("button", { name: "Reload latest version", exact: true }).click();
      await expect(other.getByLabel("Title", { exact: true })).toHaveValue(
        "Synthetic other editor version",
      );
      await expect(other.getByRole("main").getByRole("alert")).toHaveCount(0);
    } finally {
      await other.close();
    }
  });
}
