import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createE01Deck, e01ApiUrl, e01Slide, readE01Record } from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 30_000 });

async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
}

for (const suffix of ["", " @mobile"]) {
  test(`private review workspace keeps navigation compact and slides readable${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const run = randomUUID().slice(0, 8);
    const title =
      `Project handoff review ${run}: a deliberately long presentation title that keeps context, decisions, evidence and next steps readable on every screen`.slice(
        0,
        160,
      );
    const bodies = Array.from(
      { length: 11 },
      (_, index) =>
        `Review evidence for slide ${index + 1}. Confirm the next owner, the decision and the date before moving on.`,
    );
    const slides = bodies.map((body, index) => {
      const slide = e01Slide(
        index === 0
          ? "A focused plan for the next quarter"
          : `Review slide ${index + 1}: evidence and next steps`,
      );
      const bodyNode = slide.scene!.nodes.find(
        (node) => node.type === "text" && node.role === "body",
      );
      if (bodyNode?.type !== "text") throw new Error("Expected a text body in the review fixture");
      bodyNode.text = body;
      return slide;
    });
    const initial = await createE01Deck(page, slides, 14);
    const saved = await page.request.put(`${e01ApiUrl}/v1/presentations/${initial.id}/draft`, {
      data: {
        draft: { ...initial.draft, title },
        expectedRevision: initial.draftRevision,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(saved.status()).toBe(200);
    const record = await readE01Record(page, initial.id);
    const published = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
      { data: { expectedDraftRevision: record.draftRevision } },
    );
    expect(published.status()).toBe(200);
    const versionId = (await published.json()).version.id as string;
    const token = randomBytes(32).toString("base64url");
    const shared = await page.request.post(`${e01ApiUrl}/v1/presentations/${record.id}/shares`, {
      data: {
        requestId: randomUUID(),
        versionId,
        token,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(shared.status()).toBe(201);
    const shareId = (await shared.json()).share.id as string;
    const reviewPath = `/presentation-review/${shareId}`;
    const accessPath = `/v1/shared-presentations/${shareId}/access`;
    const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
    const narrow = (viewport?.width ?? 1280) <= 760;
    const context = await browser.newContext({
      baseURL: info.project.use.baseURL,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    const reader = await context.newPage();
    const requested: string[] = [];
    const mutations: string[] = [];
    let accessRequests = 0;
    reader.on("request", (request) => {
      requested.push(request.url());
      if (new URL(request.url()).pathname === accessPath) accessRequests++;
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) mutations.push(request.url());
    });
    try {
      await reader.goto(`${reviewPath}#token=${token}`);
      await expect(reader).toHaveURL((url) => url.pathname === reviewPath && !url.hash);
      const header = reader.getByRole("banner");
      const heading = header.getByRole("heading", { name: title, exact: true });
      await expect(heading).toBeVisible();
      await expect(header).toContainText("Published version 1");
      await expect(header.getByText("Private review", { exact: true })).toBeVisible();
      const headerBox = (await header.boundingBox())!;
      const headingBox = (await heading.boundingBox())!;
      expect(headerBox.y).toBe(0);
      expect(headerBox.height).toBeLessThanOrEqual(narrow ? 240 : 140);
      expect(headingBox.y).toBeGreaterThanOrEqual(headerBox.y);
      expect(headingBox.y + headingBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height);

      const current = reader.getByRole("region", {
        name: "Current presentation page",
        exact: true,
      });
      const stage = current.locator('article[data-native-scene="true"]');
      const counter = current.getByRole("status").filter({ hasText: /^Page \d+ of \d+$/ });
      const toggle = reader.getByRole("button", { name: "Slides", exact: true });
      const map = reader.locator("#review-page-outline");
      await expect(toggle).toHaveAttribute("aria-controls", "review-page-outline");
      await expect(toggle).toHaveAttribute("aria-expanded", String(!narrow));
      await expect(map).toHaveAttribute("aria-label", "Presentation pages");
      if (narrow) await expect(map).toBeHidden();
      else await expect(map).toBeVisible();
      await expect(counter).toHaveText("Page 1 of 11");
      await expect(map.locator('button[aria-current="page"]')).toHaveAttribute(
        "aria-label",
        "1. A focused plan for the next quarter",
      );
      await expect(stage).toBeVisible();
      const initialStage = (await stage.boundingBox())!;
      expect((await current.boundingBox())!.y).toBeLessThan(narrow ? 340 : 250);
      expect(initialStage.width).toBeGreaterThan(narrow ? (viewport?.width ?? 390) - 80 : 640);
      await noOverflow(reader);
      await reader.screenshot({
        path: info.outputPath(`review-workspace-${narrow ? "mobile" : "desktop"}-light.png`),
        fullPage: true,
      });

      await toggle.focus();
      await toggle.press("Enter");
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", String(narrow));
      if (narrow) {
        await expect(map).toBeVisible();
        await expect(map.getByRole("button")).toHaveCount(11);
      } else {
        await expect(map).toBeHidden();
        await expect
          .poll(async () => (await stage.boundingBox())!.width)
          .toBeGreaterThan(initialStage.width + 160);
      }
      await expect(counter).toHaveText("Page 1 of 11");
      expect(accessRequests).toBe(0);
      await toggle.press("Space");
      await expect(toggle).toHaveAttribute("aria-expanded", String(!narrow));
      await expect(counter).toHaveText("Page 1 of 11");
      expect(accessRequests).toBe(0);

      const readable = current.locator("details").filter({ hasText: "Readable text" });
      const readableToggle = readable.locator("summary");
      await expect(readable).not.toHaveAttribute("open", "");
      await expect(readable.getByText(bodies[0]!, { exact: true })).toBeHidden();
      await readableToggle.focus();
      await readableToggle.press("Enter");
      await expect(readable).toHaveAttribute("open", "");
      await expect(readable.getByText(bodies[0]!, { exact: true })).toBeVisible();
      await readableToggle.press("Space");
      await expect(readable).not.toHaveAttribute("open", "");
      expect(accessRequests).toBe(0);

      const nextAccess = reader.waitForResponse(
        (response) => new URL(response.url()).pathname === accessPath,
      );
      await current.getByRole("button", { name: "Next page", exact: true }).click();
      const verified = await nextAccess;
      expect(verified.status()).toBe(200);
      expect(verified.request().headers().authorization).toBe(`Bearer ${token}`);
      await expect(counter).toHaveText("Page 2 of 11");
      await expect(map.locator('button[aria-current="page"]')).toHaveAttribute(
        "aria-label",
        "2. Review slide 2: evidence and next steps",
      );
      await expect(readable).not.toHaveAttribute("open", "");
      await readableToggle.click();
      await expect(readable.getByText(bodies[1]!, { exact: true })).toBeVisible();
      expect(accessRequests).toBe(1);

      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
      await expect(map.getByRole("button")).toHaveCount(11);
      await map
        .getByRole("button", { name: "11. Review slide 11: evidence and next steps", exact: true })
        .click();
      await expect(counter).toHaveText("Page 11 of 11");
      await expect(map.locator('button[aria-current="page"]')).toHaveAttribute(
        "aria-label",
        "11. Review slide 11: evidence and next steps",
      );
      await expect(current.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
      await expect(readable).toHaveAttribute("open", "");
      await expect(readable.getByText(bodies[10]!, { exact: true })).toBeVisible();
      expect(accessRequests).toBe(2);
      expect(
        (
          await new AxeBuilder({ page: reader })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);

      await reader.setViewportSize({ width: 320, height: 760 });
      await noOverflow(reader);
      await reader.emulateMedia({ colorScheme: "dark" });
      await expect(reader.locator("html")).toHaveAttribute("data-color-mode", "dark");
      await noOverflow(reader);
      expect((await header.boundingBox())!.height).toBeLessThanOrEqual(280);
      expect(
        (
          await new AxeBuilder({ page: reader })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await toggle.click();
      await expect(map).toBeHidden();
      await noOverflow(reader);
      await reader.screenshot({
        path: info.outputPath("review-workspace-320-dark.png"),
        fullPage: true,
      });
      expect(requested.some((url) => url.includes(token))).toBe(false);
      expect(mutations).toEqual([]);
      expect((await context.cookies()).some((cookie) => cookie.name === "openround_creator")).toBe(
        false,
      );
    } finally {
      await context.close();
    }
  });
}
