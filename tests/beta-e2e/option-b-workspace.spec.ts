import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInBeta } from "./sign-in";
import { createE01Deck, e01ApiUrl, e01Slide } from "./presentation-e01-support";

for (const suffix of ["", " @mobile"]) {
  test(`Option B prioritizes live work and retains dismissible first-session guidance${suffix}`, async ({
    page,
  }, info) => {
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    await signInBeta(page, undefined, { returnTo: "/home" });
    await page.route(`${e01ApiUrl}/v1/home/summary`, async (route) =>
      route.fulfill({
        json: {
          generatedAt: "2026-11-09T12:00:00Z",
          recentArtifacts: [
            {
              id: "draft-one",
              artifactType: "round",
              title: "An unfinished draft",
              description: "",
              status: "draft",
              itemCount: 1,
              updatedAt: "2026-11-09T11:00:00Z",
              editHref: "/library",
              actionHref: "/library",
              actionLabel: "Continue editing",
            },
          ],
          recentBoards: [],
          recentSurveys: [],
          sessions: [
            {
              id: "room-one",
              artifactType: "round",
              artifactId: "draft-one",
              title: "Your audience is waiting",
              status: "active",
              phase: "lobby",
              code: "1234567",
              participantCount: 12,
              progressLabel: "Lobby",
              createdAt: "2026-11-09T12:00:00Z",
              href: "/sessions",
            },
          ],
          assignments: [],
          resultHighlights: [],
          groupSchedule: [],
          totals: { artifacts: 1, activeSessions: 1, activeAssignments: 0, upcomingGroupItems: 0 },
        },
      }),
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your audience is waiting" })).toBeVisible();
    const live = await page
      .getByRole("heading", { name: "Your audience is waiting" })
      .boundingBox();
    const recent = await page
      .getByRole("heading", { name: "Recent work", exact: true })
      .boundingBox();
    expect(live!.y).toBeLessThan(recent!.y);
    await expect(page.getByRole("heading", { name: "Finish your first session" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open Sessions", exact: true }).first(),
    ).toHaveAttribute("href", "/sessions");
    await page.getByRole("button", { name: "Dismiss getting started" }).click();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your audience is waiting" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Finish your first session" })).toHaveCount(0);
    if (narrow) {
      await page.setViewportSize({ width: 320, height: 844 });
      const navigation = page.getByRole("navigation", { name: "Workspace sections" });
      await navigation.locator("summary").click();
      await expect(navigation.getByRole("link", { name: "Results", exact: true })).toBeVisible();
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath("option-b-home.png"), fullPage: true });
  });

  test(`Option B Library shows real slide artwork and Quick poll opens one private draft${suffix}`, async ({
    page,
  }, info) => {
    await signInBeta(page, undefined, { returnTo: "/library?type=presentations" });
    const slide = e01Slide("Recognizable customer update");
    const record = await createE01Deck(page, [slide]);
    const list = await page.request.get(`${e01ApiUrl}/v1/presentations`);
    const summary = (await list.json()).presentations.find(
      (item: { id: string }) => item.id === record.id,
    );
    expect(summary.previewBlock.id).toBe(slide.id);
    expect(summary.previewBlock.speakerNotes).toBe("");
    await page.goto("/library?type=presentations");
    const thumbnail = page.locator(`[data-slide-thumbnail="${slide.id}"]`);
    await thumbnail.scrollIntoViewIfNeeded();
    await expect(thumbnail).toBeVisible();
    await expect(thumbnail).toContainText("Recognizable customer update");
    const card = page.locator("article").filter({ has: thumbnail });
    const cardBox = await card.boundingBox();
    const editBox = await card.getByRole("link", { name: "Edit", exact: true }).boundingBox();
    expect(editBox!.y + editBox!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height);
    await page.screenshot({ path: info.outputPath("option-b-library.png"), fullPage: true });
    await page.getByRole("button", { name: "List view", exact: true }).click();
    const listBox = await card.boundingBox();
    expect(listBox!.width).toBeGreaterThan((page.viewportSize()!.width - 280) * 0.7);
    await expect(card.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await expect(page.getByRole("tab", { name: /^Presentations/ })).toHaveAttribute(
      "tabindex",
      "0",
    );
    await page.getByRole("tab", { name: /^Presentations/ }).focus();
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: /^Rounds/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page).toHaveURL(/\/library$/);
    await page.goto("/create");
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/quizzes")
        writes.push(request.url());
    });
    await page.getByRole("button", { name: /^Ask a quick poll/ }).click();
    await expect(page).toHaveURL(/\/quiz\/[^/?]+(?:\?insert=poll)?$/);
    const quizId = new URL(page.url()).pathname.split("/").pop();
    await expect
      .poll(async () => {
        const response = await page.request.get(`${e01ApiUrl}/v1/quizzes/${quizId}`);
        return (await response.json()).quiz.draft.questions[0]?.type;
      })
      .toBe("poll");
    expect(writes).toHaveLength(1);
    await expect(page.getByRole("textbox", { name: "Question prompt" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await page.screenshot({ path: info.outputPath("option-b-quick-poll.png"), fullPage: true });
  });
}
