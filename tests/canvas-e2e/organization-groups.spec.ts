import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { api, fits, organization, teammate } from "./support";

async function accessible(page: Page) {
  await fits(page);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
}

async function group(page: Page, id: string) {
  const response = await page.request.get(`${api}/v1/groups/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).group;
}

for (const suffix of ["", " @mobile"]) {
  test(`organization groups coordinate across workspaces with explicit access${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    if (!suffix) await page.setViewportSize({ width: 1440, height: 1080 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    const { owner, organizationId } = await organization(page, info);
    const colleague = await teammate(page, browser, organizationId, info);
    await colleague.page.setViewportSize(page.viewportSize()!);
    try {
      expect(colleague.identity.creator.workspaceId).not.toBe(owner.creator.workspaceId);
      const localName = "Local practice cohort";
      const workspaceGroup = await page.request.post(`${api}/v1/groups`, {
        data: { name: localName, scope: "workspace", purpose: "cohort" },
      });
      expect(workspaceGroup.status(), await workspaceGroup.text()).toBe(201);
      const localId = (await workspaceGroup.json()).group.id;
      const created = await page.request.post(`${api}/v1/starters/new-hire-knowledge-check/use`, {
        data: {},
      });
      expect(created.status(), await created.text()).toBe(201);
      const { quiz } = await created.json();
      const published = await page.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, {
        data: { expectedDraftRevision: quiz.draftRevision },
      });
      expect(published.status(), await published.text()).toBe(200);
      const { version } = await published.json();
      const shared = await page.request.post(`${api}/v1/library/shares`, {
        data: {
          requestId: randomUUID(),
          artifactType: "round",
          artifactId: quiz.id,
          versionId: version.id,
          audience: "organization",
          recipientIds: [],
          permission: "use",
          message: "Published reference for the launch group.",
          dueAt: null,
        },
      });
      expect(shared.status(), await shared.text()).toBe(201);
      const publication = (await shared.json()).share;

      await page.goto("/groups");
      await page.getByRole("button", { name: "Create group", exact: true }).click();
      const creation = page.getByRole("dialog", { name: "Create group", exact: true });
      await creation
        .getByRole("combobox", { name: "Group scope", exact: true })
        .selectOption("organization");
      await creation
        .getByRole("combobox", { name: "Purpose", exact: true })
        .selectOption("project");
      const name = "Company launch team";
      await creation.getByRole("textbox", { name: "Group name", exact: true }).fill(name);
      await creation
        .getByRole("textbox", { name: "Description", exact: true })
        .fill("Coordinate launch preparation across workspaces.");
      await accessible(page);
      const saving = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/v1/groups",
      );
      await creation.getByRole("button", { name: "Create group", exact: true }).click();
      const response = await saving;
      expect(response.status(), await response.text()).toBe(201);
      const id = (await response.json()).group.id;
      await expect(creation).not.toBeVisible();
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();

      const scopes = page.getByRole("navigation", { name: "Group scope", exact: true });
      await scopes.getByRole("button", { name: "My workspace", exact: true }).click();
      await expect(page.getByRole("button", { name: new RegExp(localName) })).toBeVisible();
      await expect(page.getByRole("button", { name: new RegExp(name) })).toHaveCount(0);
      await scopes.getByRole("button", { name: "Organization", exact: true }).click();
      await expect(page.getByRole("button", { name: new RegExp(localName) })).toHaveCount(0);
      await page.getByRole("combobox", { name: "Purpose", exact: true }).selectOption("cohort");
      await expect(page.getByRole("button", { name: new RegExp(name) })).toHaveCount(0);
      await page.getByRole("combobox", { name: "Purpose", exact: true }).selectOption("project");
      await page.getByRole("button", { name: new RegExp(name) }).click();
      const sections = page.getByRole("navigation", { name: "Group sections", exact: true });
      await sections.getByRole("button", { name: "Members", exact: true }).click();
      await page
        .locator("details")
        .filter({
          has: page.getByRole("combobox", {
            name: "Organization member",
            exact: true,
            includeHidden: true,
          }),
        })
        .locator("summary")
        .click();
      await page
        .getByRole("combobox", { name: "Organization member", exact: true })
        .selectOption(colleague.identity.creator.userId);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect
        .poll(async () =>
          (await group(page, id)).members.map((member: { userId: string }) => member.userId),
        )
        .toContain(colleague.identity.creator.userId);
      await sections.getByRole("button", { name: "Content", exact: true }).click();
      await page
        .locator("details")
        .filter({
          has: page.getByRole("combobox", {
            name: "Choose an organization publication",
            exact: true,
            includeHidden: true,
          }),
        })
        .locator("summary")
        .click();
      await page
        .getByRole("combobox", { name: "Choose an organization publication", exact: true })
        .selectOption(publication.id);
      await page.getByRole("button", { name: "Add publication", exact: true }).click();
      await expect(page.locator(`a[href="/library/shared/${publication.id}"]`)).toBeVisible();
      await accessible(page);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.screenshot({
        path: info.outputPath("organization-group-content.png"),
        fullPage: Boolean(suffix),
      });
      await page.evaluate(() => {
        localStorage.setItem("openround:color-mode", "dark");
        window.dispatchEvent(new Event("openround:color-mode-change"));
      });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
      await accessible(page);
      await page.screenshot({
        path: info.outputPath("organization-group-dark.png"),
        fullPage: Boolean(suffix),
      });

      await colleague.page.goto("/groups");
      await expect(colleague.page.getByRole("button", { name: new RegExp(name) })).toBeVisible();
      await expect(colleague.page.getByRole("button", { name: new RegExp(localName) })).toHaveCount(
        0,
      );
      await colleague.page.getByRole("button", { name: new RegExp(name) }).click();
      await expect(
        colleague.page.getByRole("button", { name: "Group settings", exact: true }),
      ).toHaveCount(0);
      const colleagueSections = colleague.page.getByRole("navigation", {
        name: "Group sections",
        exact: true,
      });
      await expect(
        colleagueSections.getByRole("button", { name: "Schedule", exact: true }),
      ).toHaveCount(0);
      await colleagueSections.getByRole("button", { name: "Discussion", exact: true }).click();
      const update = "The launch checklist is ready for review.";
      await colleague.page
        .getByRole("textbox", { name: "Post an update", exact: true })
        .fill(update);
      await colleague.page.getByRole("button", { name: "Post update", exact: true }).click();
      await expect(colleague.page.getByText(update, { exact: true })).toBeVisible();
      await accessible(colleague.page);
      await colleagueSections.getByRole("button", { name: "Content", exact: true }).click();
      await colleague.page.locator(`a[href="/library/shared/${publication.id}"]`).click();
      await expect(colleague.page).toHaveURL(new RegExp(`/library/shared/${publication.id}`));
      expect((await colleague.page.request.get(`${api}/v1/quizzes/${quiz.id}`)).status()).toBe(404);
      await expect(
        colleague.page.getByRole("button", { name: "Use a copy", exact: true }),
      ).toBeVisible();
      await colleague.page.getByRole("button", { name: "Use a copy", exact: true }).click();
      await expect(colleague.page).toHaveURL(/\/quiz\/[0-9a-f-]+$/);
      const copiedId = new URL(colleague.page.url()).pathname.split("/").at(-1)!;
      expect(copiedId).not.toBe(quiz.id);

      await page.getByRole("button", { name: "Group settings", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "Group settings", exact: true });
      await settings
        .getByRole("textbox", { name: "Description", exact: true })
        .fill("Launch preparation and published company references.");
      await settings.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(settings).not.toBeVisible();
      await page.getByRole("button", { name: "Archive group", exact: true }).click();
      await expect.poll(async () => (await group(page, id)).status).toBe("archived");
      await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("archived");
      await page.getByRole("button", { name: new RegExp(name) }).click();
      await expect(page.getByRole("button", { name: "Add publication", exact: true })).toHaveCount(
        0,
      );
      await accessible(page);
      await page.getByRole("button", { name: "Restore group", exact: true }).click();
      await expect.poll(async () => (await group(page, id)).status).toBe("active");

      const promoted = await page.request.patch(
        `${api}/v1/groups/${id}/members/${colleague.identity.creator.userId}`,
        { data: { role: "owner" } },
      );
      expect(promoted.status(), await promoted.text()).toBe(200);
      await colleague.page.goto("/groups");
      await expect(colleague.page.getByRole("heading", { name, exact: true })).toBeVisible();
      await colleague.page
        .getByRole("navigation", { name: "Group sections", exact: true })
        .getByRole("button", { name: "Members", exact: true })
        .click();
      const ownMembership = colleague.page
        .getByRole("listitem")
        .filter({ hasText: colleague.email });
      const removal = colleague.page.waitForResponse(
        (response) =>
          response.request().method() === "DELETE" &&
          new URL(response.url()).pathname ===
            `/v1/groups/${id}/members/${colleague.identity.creator.userId}`,
      );
      colleague.page.once("dialog", (dialog) => void dialog.accept());
      await ownMembership.getByRole("button", { name: "Remove member", exact: true }).click();
      const removed = await removal;
      expect(removed.status()).toBe(204);
      await expect(colleague.page.getByRole("button", { name: new RegExp(name) })).toHaveCount(0);
      await expect(colleague.page.getByRole("heading", { name, exact: true })).toHaveCount(0);
      await expect(colleague.page.locator("main").getByRole("alert")).toHaveCount(0);
      await expect(colleague.page.getByText("Changes saved", { exact: true })).toBeVisible();
      expect((await colleague.page.request.get(`${api}/v1/groups/${id}`)).status()).toBe(404);
      expect((await colleague.page.request.get(`${api}/v1/groups/${localId}`)).status()).toBe(404);
      // Group collection membership never replaces the publication's org-wide grant.
      expect(
        (await colleague.page.request.get(`${api}/v1/library/shares/${publication.id}`)).status(),
      ).toBe(200);
    } finally {
      await colleague.context.close();
    }
  });
}
