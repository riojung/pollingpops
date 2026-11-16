import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { e01Slide, type E01Record } from "../beta-e2e/presentation-e01-support";
import { api, fits, organization, teammate } from "./support";

for (const suffix of ["", " @mobile"]) {
  test(`organization publications and direct shares stay separate from private workspaces${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    const { owner } = await organization(page, info);
    const member = await teammate(page, browser, owner.workspace.organization.id, info);
    if (suffix) await member.page.setViewportSize({ width: 390, height: 844 });
    try {
      expect(member.identity.creator.workspaceId).not.toBe(owner.creator.workspaceId);
      const title = `Company orientation ${randomUUID().slice(0, 8)}`;
      const created = await page.request.post(`${api}/v1/presentations`, { data: { title } });
      expect(created.status()).toBe(201);
      const initial = (await created.json()).presentation as E01Record;
      const slide = e01Slide("Our shared operating principles");
      slide.speakerNotes = "PRIVATE_LIBRARY_SPEAKER_NOTES";
      const saved = await page.request.put(`${api}/v1/presentations/${initial.id}/draft`, {
        data: {
          draft: { ...initial.draft, schemaVersion: 14, blocks: [slide] },
          expectedRevision: initial.draftRevision,
          mutationId: randomUUID(),
          schemaVersion: 2,
        },
      });
      expect(saved.status(), await saved.text()).toBe(200);
      const record = (await saved.json()).presentation as E01Record;
      const published = await page.request.post(`${api}/v1/presentations/${record.id}/publish`, {
        data: { expectedDraftRevision: record.draftRevision },
      });
      expect(published.status(), await published.text()).toBe(200);
      const versionId = (await published.json()).version.id as string;

      await page.goto("/library?type=presentations");
      await page.getByRole("button", { name: "Share with organization", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Share a published version", exact: true });
      await dialog
        .getByRole("combobox", { name: "Who can access", exact: true })
        .selectOption("people");
      await dialog
        .getByRole("searchbox", { name: "Verified organization members", exact: true })
        .fill(member.email);
      await dialog.getByRole("checkbox", { name: member.email, exact: true }).check();
      await dialog.getByRole("combobox", { name: "Permission", exact: true }).selectOption("use");
      await dialog
        .getByRole("textbox", { name: "Message (optional)", exact: true })
        .fill("Review our operating principles before the workshop.");
      const yesterday = new Date(Date.now() - 86_400_000);
      const localDeadline = new Date(yesterday.getTime() - yesterday.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16);
      await dialog.getByLabel("Review by (optional)", { exact: true }).fill(localDeadline);
      const accepted = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/v1/library/shares",
      );
      await dialog.getByRole("button", { name: "Share published version", exact: true }).click();
      const shareResponse = await accepted;
      expect(shareResponse.status(), await shareResponse.text()).toBe(201);
      const direct = (await shareResponse.json()).share;
      await expect(
        page.getByRole("dialog", { name: "Published version shared", exact: true }),
      ).toBeVisible();
      expect(JSON.stringify(direct)).not.toContain("PRIVATE_LIBRARY_SPEAKER_NOTES");

      const privateSource = await member.page.request.get(`${api}/v1/presentations/${record.id}`);
      expect(privateSource.status()).toBe(404);
      await member.page.goto("/library?scope=shared&type=presentations");
      await expect(
        member.page.getByRole("link", { name: "Shared with me", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      const card = member.page.getByRole("article").filter({ hasText: title });
      await expect(card).toBeVisible();
      await expect(card).toContainText("Can use");
      await expect(card).toContainText("Review by");
      await expect(card).toContainText("Overdue");
      await expect(card).toContainText("Review our operating principles before the workshop.");
      const headerSearch = member.page.locator("#workspace-search");
      await headerSearch.fill("No matching company publication");
      await headerSearch.press("Enter");
      await expect(card).toHaveCount(0);
      await headerSearch.fill(title);
      await headerSearch.press("Enter");
      await expect(card).toBeVisible();
      expect(new URL(member.page.url()).searchParams.get("scope")).toBe("shared");
      await card.getByRole("link", { name: "Open", exact: true }).click();
      await expect(member.page).toHaveURL(new RegExp(`/library/shared/${direct.id}`));
      await expect(
        member.page.getByText("Our shared operating principles", { exact: true }).first(),
      ).toBeVisible();
      expect(await member.page.content()).not.toContain("PRIVATE_LIBRARY_SPEAKER_NOTES");
      await expect(member.page.getByText("Overdue", { exact: true })).toBeVisible();
      await fits(member.page);
      await member.page.screenshot({
        path: info.outputPath("shared-library-reader.png"),
        fullPage: true,
      });
      expect(
        (
          await new AxeBuilder({ page: member.page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);

      await member.page.getByRole("button", { name: "Mark reviewed", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await (await member.page.request.get(`${api}/v1/library/shares/${direct.id}`)).json())
              .share.progress,
        )
        .toBe("done");
      await expect(member.page.getByText("Overdue", { exact: true })).toHaveCount(0);
      // Let the server commit, lose the acknowledgement, then reload the reader.
      // The retry must open that same independent draft instead of making another.
      const copyUrl = `${api}/v1/library/shares/${direct.id}/copy`;
      let dropResponse = true;
      let committedCopyId = "";
      let committedRequestId = "";
      await member.page.route(copyUrl, async (route) => {
        if (route.request().method() !== "POST" || !dropResponse) {
          await route.continue();
          return;
        }
        dropResponse = false;
        committedRequestId = route.request().postDataJSON().requestId;
        const response = await route.fetch();
        expect(response.status(), await response.text()).toBe(201);
        committedCopyId = (await response.json()).artifactId;
        await route.abort("failed");
      });
      await member.page.getByRole("button", { name: "Use a copy", exact: true }).click();
      await expect(
        member.page.getByText("The change could not be confirmed. Retry the same request.", {
          exact: true,
        }),
      ).toBeVisible();
      await member.page.reload();
      await expect(
        member.page.getByRole("button", { name: "Use a copy", exact: true }),
      ).toBeVisible();
      const copied = member.page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/v1/library/shares/${direct.id}/copy`,
      );
      await member.page.getByRole("button", { name: "Use a copy", exact: true }).click();
      const copyResponse = await copied;
      expect(copyResponse.status(), await copyResponse.text()).toBe(200);
      const copyIntent = copyResponse.request().postDataJSON();
      const copy = await copyResponse.json();
      expect(copyIntent.requestId).toBe(committedRequestId);
      expect(copy.artifactId).toBe(committedCopyId);
      expect(copy.replayed).toBe(true);
      await member.page.unroute(copyUrl);
      await member.page.waitForURL((url) => url.pathname === copy.href, { waitUntil: "load" });
      expect(copy.artifactId).not.toBe(record.id);
      const independent = await member.page.request.get(
        `${api}/v1/presentations/${copy.artifactId}`,
      );
      expect(independent.status()).toBe(200);
      const independentRecord = (await independent.json()).presentation;
      expect(independentRecord.workspaceId).toBe(member.identity.creator.workspaceId);
      expect(independentRecord.currentVersionId).toBeNull();
      expect(JSON.stringify(independentRecord.draft)).not.toContain(
        "PRIVATE_LIBRARY_SPEAKER_NOTES",
      );
      const replay = await member.page.request.post(`${api}/v1/library/shares/${direct.id}/copy`, {
        data: copyIntent,
      });
      expect(replay.status()).toBe(200);
      expect((await replay.json()).artifactId).toBe(copy.artifactId);

      const organizationShare = await page.request.post(`${api}/v1/library/shares`, {
        data: {
          requestId: randomUUID(),
          artifactType: "presentation",
          artifactId: record.id,
          versionId,
          audience: "organization",
          recipientIds: [],
          permission: "view",
          message: "Organization reference material",
          dueAt: null,
        },
      });
      expect(organizationShare.status()).toBe(201);
      const reference = (await organizationShare.json()).share;
      await member.page.goto("/library?scope=organization&type=presentations");
      const organizationCard = member.page.getByRole("article").filter({ hasText: title });
      await expect(organizationCard).toBeVisible();
      await expect(organizationCard).toContainText("Can view");
      expect(
        (
          await member.page.request.post(`${api}/v1/library/shares/${reference.id}/copy`, {
            data: { requestId: randomUUID() },
          })
        ).status(),
      ).toBe(403);
      await fits(member.page);
      await member.page.screenshot({
        path: info.outputPath("organization-library.png"),
        fullPage: true,
      });
      expect(
        (
          await new AxeBuilder({ page: member.page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);

      expect((await page.request.delete(`${api}/v1/library/shares/${direct.id}`)).status()).toBe(
        204,
      );
      await member.page.goto("/library?scope=shared&type=presentations");
      await expect(member.page.getByRole("article").filter({ hasText: title })).toHaveCount(0);
      expect(
        (await member.page.request.get(`${api}/v1/library/shares/${direct.id}`)).status(),
      ).toBe(404);
      expect(
        (await member.page.request.get(`${api}/v1/presentations/${copy.artifactId}`)).status(),
      ).toBe(200);
    } finally {
      await member.context.close();
    }
  });
}
