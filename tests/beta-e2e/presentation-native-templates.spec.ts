import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  PresentationDraft,
  PresentationHostSnapshot,
} from "../../packages/contracts/src/index.ts";
import nativeContent from "../../apps/web/lib/presentation-native-template-content.json";
import { signInBeta } from "./sign-in";
import { e01ApiUrl, readE01Record } from "./presentation-e01-support";

test.use({ actionTimeout: 30_000 });

const scenarioLabels: Record<string, string> = {
  "native-startup-pitch": "Startup pitch",
  "native-client-proposal": "Client proposal",
  "native-project-update": "Project update",
  "native-quarterly-strategy": "Quarterly strategy",
  "native-portfolio-case-study": "Portfolio case study",
  "native-event-talk": "Event talk",
  "native-product-demo": "Product demo",
  "native-customer-onboarding": "Customer onboarding",
  "native-practical-workshop": "Practical workshop",
  "native-lesson-explainer": "Lesson and explainer",
  "native-research-findings": "Research findings",
  "native-business-decision-brief": "Business decision brief",
};

function ids(draft: PresentationDraft) {
  return draft.blocks.flatMap((block) =>
    block.kind === "content"
      ? [
          block.id,
          ...(block.scene?.nodes.map((node) => node.id) ?? []),
          ...(block.scene?.groups?.map((group) => group.id) ?? []),
        ]
      : [block.id, block.question.id],
  );
}

async function openNativeGallery(page: Page, scenario: string) {
  await page.goto("/create/presentation?start=template");
  await page
    .getByRole("searchbox", { name: "Search presentation templates", exact: true })
    .fill(scenario);
}

async function collapseOverlays(page: Page, narrow: boolean) {
  if (!narrow) return;
  await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
  await page.getByRole("button", { name: "Collapse map", exact: true }).click();
}

async function expectCompleteChartPlot(preview: Locator, label: string) {
  const frame = preview.locator('[data-node-type="chart"]');
  const figure = frame.locator('figure[data-native-data="chart"]');
  const plot = figure.locator('svg[aria-hidden="true"]');
  await expect(plot).toBeVisible();
  expect(
    await figure.evaluate((element) => element.scrollTop),
    `${label}: chart starts at the top`,
  ).toBe(0);
  const [plotBounds, frameBounds] = await Promise.all([plot.boundingBox(), frame.boundingBox()]);
  expect(plotBounds).not.toBeNull();
  expect(frameBounds).not.toBeNull();
  expect(plotBounds!.x, `${label}: SVG left`).toBeGreaterThanOrEqual(frameBounds!.x - 1);
  expect(plotBounds!.y, `${label}: SVG top`).toBeGreaterThanOrEqual(frameBounds!.y - 1);
  expect(plotBounds!.x + plotBounds!.width, `${label}: SVG right`).toBeLessThanOrEqual(
    frameBounds!.x + frameBounds!.width + 1,
  );
  expect(plotBounds!.y + plotBounds!.height, `${label}: SVG bottom`).toBeLessThanOrEqual(
    frameBounds!.y + frameBounds!.height + 1,
  );
  const status = preview.getByRole("status");
  const currentSlide = await status.innerText();
  const overflows = await figure.evaluate((element) => element.scrollHeight > element.clientHeight);
  await figure.focus();
  await expect(figure).toBeFocused();
  await figure.press("End");
  await expect(status).toHaveText(currentSlide);
  if (overflows) {
    await expect.poll(() => figure.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  }
  await figure.press("Home");
  await expect.poll(() => figure.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(status).toHaveText(currentSlide);
  await preview.getByRole("button", { name: "Close preview", exact: true }).focus();
}

for (const suffix of ["", " @mobile"]) {
  test(`native scenarios create independent drafts, retry accepted saves and preserve published content${suffix}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    await openNativeGallery(page, "startup pitch");
    const card = page.locator('[data-template-id="native-startup-pitch"]');
    const previewButton = card.getByRole("button", { name: "Preview structure", exact: true });
    await previewButton.click();
    const preview = page.getByRole("dialog", {
      name: "Presentation template preview",
      exact: true,
    });
    await expect(preview.locator("[data-native-scene]")).toHaveCount(1);
    await expect(
      preview.getByRole("heading", {
        name: "A repair request should become an owned next step",
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("End");
    await expect(preview.getByRole("status")).toHaveText("Slide 8 of 8");
    await expect(preview.getByRole("button", { name: "Next slide", exact: true })).toBeDisabled();
    await page.keyboard.press("Home");
    await expect(preview.getByRole("status")).toHaveText("Slide 1 of 8");
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(previewButton).toBeFocused();
    const saving = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        /\/v1\/presentations\/[^/]+\/draft$/.test(new URL(response.url()).pathname),
    );
    await card.getByRole("button", { name: "Use presentation template", exact: true }).click();
    const saved = await saving;
    expect(saved.status(), await saved.text()).toBe(200);
    expect(saved.request().postDataJSON().schemaVersion).toBe(2);
    const first = (await saved.json()).presentation;
    await expect(page).toHaveURL(`/presentation/${first.id}`);
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 700;
    await collapseOverlays(page, narrow);
    const original = (await readE01Record(page, first.id)).draft;
    expect(original.schemaVersion).toBe(8);
    expect(original.blocks).toHaveLength(8);
    expect(
      original.blocks.every(
        (block) => block.kind === "content" && block.scene?.schemaVersion === 4,
      ),
    ).toBe(true);
    await page
      .getByLabel("Native slide title", { exact: true })
      .fill("Pitch tailored for our workshop");
    await expect
      .poll(async () => {
        const block = (await readE01Record(page, first.id)).draft.blocks[0];
        const title =
          block?.kind === "content"
            ? block.scene?.nodes.find((node) => node.type === "text" && node.role === "title")
            : null;
        return title?.type === "text" ? title.text : "";
      })
      .toBe("Pitch tailored for our workshop");
    const publishing = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${first.id}/publish`,
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const published = await publishing;
    expect(published.status(), await published.text()).toBe(200);
    const version = (await published.json()).version;
    expect(version.content.schemaVersion).toBe(8);
    expect(version.content.blocks).toHaveLength(8);
    expect(
      version.content.blocks.every((block: { kind: string }) => block.kind === "content"),
    ).toBe(true);
    await page
      .getByLabel("Native slide title", { exact: true })
      .fill("Unpublished headline after the review");
    await expect
      .poll(async () => {
        const block = (await readE01Record(page, first.id)).draft.blocks[0];
        const title =
          block?.kind === "content"
            ? block.scene?.nodes.find((node) => node.type === "text" && node.role === "title")
            : null;
        return title?.type === "text" ? title.text : "";
      })
      .toBe("Unpublished headline after the review");
    // A new session still freezes the published version, even after the author changes the draft.
    const hosted = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
      data: { presentationId: first.id },
    });
    expect(hosted.status(), await hosted.text()).toBe(201);
    const { snapshot: lobby, controlToken } = await hosted.json();
    try {
      const advanced = await page.request.post(
        `${e01ApiUrl}/v1/presentation-sessions/${lobby.sessionId}/advance`,
        { data: { expectedRevision: lobby.revision } },
      );
      expect(advanced.status(), await advanced.text()).toBe(200);
      const snapshot = (await advanced.json()).snapshot;
      expect(snapshot.currentBlock.scene).toEqual(version.content.blocks[0].scene);
      expect(snapshot.presentationVersionId).toBe(version.id);
    } finally {
      const current = await page.request.get(
        `${e01ApiUrl}/v1/presentation-sessions/${lobby.sessionId}`,
      );
      expect(current.status(), await current.text()).toBe(200);
      let snapshot = (await current.json()).snapshot as PresentationHostSnapshot;
      // Deletion intentionally rejects active sessions. Finish this content-only fixture
      // through normal host commands before releasing it; each step keeps revision fencing.
      for (
        let remaining = snapshot.blockCount + 1;
        snapshot.phase !== "finished" && remaining > 0;
        remaining--
      ) {
        const advanced = await page.request.post(
          `${e01ApiUrl}/v1/presentation-sessions/${lobby.sessionId}/command`,
          {
            data: {
              sessionId: lobby.sessionId,
              controlToken,
              commandId: randomUUID(),
              expectedRevision: snapshot.revision,
              action: "advance",
            },
          },
        );
        expect(advanced.status(), await advanced.text()).toBe(200);
        snapshot = (await advanced.json()).snapshot;
      }
      expect(snapshot.phase).toBe("finished");
      const removed = await page.request.delete(
        `${e01ApiUrl}/v1/presentation-sessions/${lobby.sessionId}`,
      );
      expect(removed.status()).toBe(204);
    }
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /^Saved$/ })
        .first(),
    ).toBeVisible();
    await openNativeGallery(page, "startup pitch");
    await previewButton.click();
    await expect(
      preview.getByRole("heading", {
        name: "A repair request should become an owned next step",
        exact: true,
      }),
    ).toBeVisible();
    expect(await preview.innerText()).not.toMatch(
      /Pitch tailored|Unpublished headline|Replace HarborTask/,
    );
    await page.keyboard.press("Escape");

    const attempts: string[] = [];
    let loseAcknowledgement = true;
    let acknowledgementDiscarded = false;
    let shells = 0;
    const countShells = (request: { method(): string; url(): string }) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/presentations")
        shells += 1;
    };
    page.on("request", countShells);
    const draftRoute = `${e01ApiUrl}/v1/presentations/*/draft`;
    await page.route(draftRoute, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      attempts.push(route.request().postData()!);
      // Persist through the real API; discard only its first acknowledgement.
      const response = await route.fetch();
      expect(response.status(), await response.text()).toBe(200);
      if (loseAcknowledgement) {
        await route.abort("failed");
        acknowledgementDiscarded = true;
      } else await route.fulfill({ response });
    });
    try {
      await card.getByRole("button", { name: "Use presentation template", exact: true }).click();
      await expect.poll(() => acknowledgementDiscarded).toBe(true);
      await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible();
      await expect(page).toHaveURL(/\/create\/presentation\?start=template$/);
      expect(shells).toBe(1);
      expect(attempts).toHaveLength(1);
      loseAcknowledgement = false;
      await card.getByRole("button", { name: "Use presentation template", exact: true }).click();
      await expect(page).toHaveURL(/\/presentation\/[0-9a-f-]{36}$/);
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toBe(attempts[0]);
      expect(JSON.parse(attempts[1]!).schemaVersion).toBe(2);
      expect(shells).toBe(1);
      const secondId = new URL(page.url()).pathname.split("/").at(-1)!;
      expect(secondId).not.toBe(first.id);
      const second = (await readE01Record(page, secondId)).draft;
      expect(ids(original).some((id) => ids(second).includes(id))).toBe(false);
      expect(second.blocks).toHaveLength(8);
      const secondBlock = second.blocks[0];
      expect(secondBlock?.kind === "content" ? secondBlock.scene?.nodes[0] : null).toMatchObject({
        type: "text",
        text: "A repair request should become an owned next step",
      });
      const history = await page.request.get(`${e01ApiUrl}/v1/presentations/${secondId}/history`);
      expect(history.status()).toBe(200);
      expect((await history.json()).history).toHaveLength(2);
      await collapseOverlays(page, narrow);
      await page.screenshot({
        path: testInfo.outputPath("native-template-independent-copy.png"),
        fullPage: true,
      });
    } finally {
      await page.unroute(draftRoute);
      page.off("request", countShells);
    }
  });

  test(`all twelve native scenarios preview complete original decks with readable shared data${suffix}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    await page.goto("/create/presentation?start=template");
    await expect(page.locator('[data-template-collection="native"]')).toHaveCount(12);
    await expect(page.locator('[data-template-collection="facilitated"]')).toHaveCount(9);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        ["POST", "PUT"].includes(request.method()) &&
        /^\/v1\/presentations(?:\/[^/]+\/draft)?$/.test(new URL(request.url()).pathname)
      )
        writes.push(request.url());
    });
    for (const [templateIndex, template] of nativeContent.entries()) {
      await page.emulateMedia({ colorScheme: templateIndex % 2 ? "dark" : "light" });
      await page
        .getByRole("searchbox", { name: "Search presentation templates", exact: true })
        .fill(scenarioLabels[template.id]!);
      const card = page.locator(`[data-template-id="${template.id}"]`);
      const trigger = card.getByRole("button", { name: "Preview structure", exact: true });
      await trigger.click();
      const preview = page.getByRole("dialog", {
        name: "Presentation template preview",
        exact: true,
      });
      const firstChart = template.slides.findIndex((block) => block.illustrativeChart);
      const representative =
        firstChart >= 0
          ? firstChart
          : template.slides.findIndex((block) => block.illustrativeTable);
      for (const [index, copy] of template.slides.entries()) {
        await expect(preview.locator("[data-native-scene]")).toHaveCount(1);
        await expect(preview.getByRole("status")).toHaveText(`Slide ${index + 1} of 8`);
        await expect(preview.getByRole("heading", { name: copy.title, exact: true })).toBeVisible();
        if (copy.illustrativeTable)
          await expect(
            preview.getByRole("table", { name: copy.illustrativeTable.caption, exact: true }),
          ).toBeVisible();
        if (copy.illustrativeChart) {
          await expect(
            preview.getByText(copy.illustrativeChart.summary, { exact: true }),
          ).toBeVisible();
          if ((page.viewportSize()?.width ?? 0) > 700)
            await expectCompleteChartPlot(preview, `${template.id}, slide ${index + 1}`);
          await expect(
            preview.getByRole("table", {
              name: `${copy.illustrativeChart.title} · chart data`,
              exact: true,
            }),
          ).toBeVisible();
        }
        if (index === representative) {
          if (templateIndex === 0)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await page.screenshot({
            path: testInfo.outputPath(`${template.id}-data-preview.png`),
            fullPage: true,
          });
        }
        if (index < template.slides.length - 1) await page.keyboard.press("ArrowRight");
      }
      await expect(preview.getByRole("button", { name: "Next slide", exact: true })).toBeDisabled();
      expect(await preview.innerText()).not.toContain(template.slides[0]!.notes);
      await page.keyboard.press("Home");
      await expect(preview.getByRole("status")).toHaveText("Slide 1 of 8");
      await page.keyboard.press("Escape");
      await expect(preview).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    expect(writes).toEqual([]);
  });
}
