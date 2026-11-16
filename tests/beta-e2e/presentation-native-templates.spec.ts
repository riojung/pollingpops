import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  PresentationDraft,
  PresentationHostSnapshot,
} from "../../packages/contracts/src/index.ts";
import nativeContent from "../../apps/web/lib/presentation-native-template-content.json";
import germanCatalog from "../../apps/web/lib/presentation-template-locales/de-DE.json";
import koreanCatalog from "../../apps/web/lib/presentation-template-locales/ko-KR.json";
import type { PresentationTemplateLocaleCatalog } from "../../apps/web/lib/presentation-template-locales/types";
import { presentationTemplateCopy } from "../../apps/web/lib/i18n/presentation-template-copy";
import { templateMessages } from "../../apps/web/lib/i18n/template-messages";
import { signInBeta } from "./sign-in";
import { specialistLocale } from "./option-b-specialist-support";
import {
  openE01Inspector,
  closeE01Overlays,
  e01ApiUrl,
  readE01Record,
} from "./presentation-e01-support";

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

const layoutSnapshots: Record<string, number[]> = {
  "native-startup-pitch": [1, 2, 4, 7, 8],
  "native-project-update": [1, 5, 8],
  "native-customer-onboarding": [1, 2, 5, 8],
};
// Eight layout/family cases plus the existing representative chart check stay bounded.
const accessibleLayouts: Record<string, number[]> = {
  "native-startup-pitch": [1, 2, 4, 7],
  "native-project-update": [1, 8],
  "native-customer-onboarding": [1, 2],
};
const localizedDecks = [
  "native-startup-pitch",
  "native-project-update",
  "native-customer-onboarding",
] as const;
const localeCatalogs: Record<"de-DE" | "ko-KR", PresentationTemplateLocaleCatalog> = {
  "de-DE": germanCatalog,
  "ko-KR": koreanCatalog,
};

/** Expected public copy comes from authored data, without loading the native scene factory. */
function localizedPublicText(
  slide: { title: string; body: string; layout: string },
  scenario: string,
  columns?: string[],
) {
  const text = (value: string) => ({ type: "text", text: value });
  const shape = (value: string) => ({ type: "shape", text: value });
  const firstSentence = /^.*?(?:[.!?](?=\s|$)|[。！？])/u.exec(slide.body)?.[0] ?? slide.body;
  if (columns)
    return [
      text(slide.title),
      text(firstSentence),
      ...columns.flatMap((column) => {
        const boundary = column.search(/[:：?？,，、]/u);
        return boundary < 0
          ? [shape(column), text("")]
          : [shape(column.slice(0, boundary + 1)), text(column.slice(boundary + 1).trimStart())];
      }),
    ];
  if (slide.layout === "cover") return [text(slide.title), shape(scenario), text(slide.body)];
  if (slide.layout === "closing") return [text(slide.title), text(slide.body), shape(scenario)];
  if (slide.layout === "statement")
    return [
      text(slide.title),
      shape(firstSentence.length <= 200 ? firstSentence : scenario),
      text(
        firstSentence.length <= 200
          ? slide.body.slice(firstSentence.length).trimStart()
          : slide.body,
      ),
    ];
  throw new Error(`Choose a supported representative text layout: ${slide.layout}`);
}

interface NativeFitMetric {
  id: string;
  type: string;
  characters: number;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  outsideFrame: boolean;
  stacked: boolean;
}

async function expectNativeTextAndShapeFit(preview: Locator, label: string, narrow: boolean) {
  const scene = preview.locator("[data-native-scene]");
  await scene.evaluate(async () => {
    await document.fonts.ready;
  });
  let metrics: NativeFitMetric[] = [];
  await expect
    .poll(
      async () => {
        metrics = await scene.evaluate((element) =>
          Array.from(
            element.querySelectorAll<HTMLElement>(
              '[data-node-type="text"], [data-node-type="shape"]',
            ),
          ).map((frame) => {
            const shape = frame.dataset.nodeType === "shape";
            const content = shape
              ? frame.querySelector<HTMLElement>("span")
              : (frame.firstElementChild as HTMLElement | null);
            if (!content) throw new Error("Expected native text or shape content");
            const outer = frame.getBoundingClientRect();
            const inner = content.getBoundingClientRect();
            return {
              id: frame.dataset.nodeId!,
              type: frame.dataset.nodeType!,
              characters: content.textContent?.length ?? 0,
              scrollWidth: content.scrollWidth,
              clientWidth: content.clientWidth,
              scrollHeight: content.scrollHeight,
              clientHeight: content.clientHeight,
              outsideFrame:
                inner.left < outer.left - 1 ||
                inner.top < outer.top - 1 ||
                inner.right > outer.right + 1 ||
                inner.bottom > outer.bottom + 1,
              stacked: getComputedStyle(frame).position === "relative",
            };
          }),
        );
        return metrics.filter(
          (metric) =>
            metric.outsideFrame ||
            // Shape labels use an inline span: its box is checked above. Text objects
            // must show their complete first child without an internal scrolling area.
            (metric.type === "text" &&
              (metric.scrollWidth > metric.clientWidth + 1 ||
                metric.scrollHeight > metric.clientHeight + 1)) ||
            (narrow && !metric.stacked),
        );
      },
      { message: `${label}: complete native text and shape labels fit their frames` },
    )
    .toEqual([]);
  expect(metrics.length, `${label}: text/shape measurement is populated`).toBeGreaterThan(0);
  const viewport = await scene.evaluate((element) => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    sceneWidth: element.getBoundingClientRect().width,
  }));
  expect(viewport.pageWidth, `${label}: page fits the viewport`).toBeLessThanOrEqual(
    viewport.viewportWidth,
  );
  expect(viewport.sceneWidth, `${label}: scene fits the viewport`).toBeLessThanOrEqual(
    viewport.viewportWidth,
  );
  return {
    textNodes: metrics.filter((metric) => metric.type === "text").length,
    shapeNodes: metrics.filter((metric) => metric.type === "shape").length,
    characters: metrics.reduce((count, metric) => count + metric.characters, 0),
    maxTextOverflowX: Math.max(
      0,
      ...metrics
        .filter((metric) => metric.type === "text")
        .map((metric) => metric.scrollWidth - metric.clientWidth),
    ),
    maxTextOverflowY: Math.max(
      0,
      ...metrics
        .filter((metric) => metric.type === "text")
        .map((metric) => metric.scrollHeight - metric.clientHeight),
    ),
    shapesOutsideFrame: metrics.filter((metric) => metric.type === "shape" && metric.outsideFrame)
      .length,
    ...viewport,
  };
}

async function captureNativeScene(page: Page, preview: Locator, path?: string) {
  const scene = preview.locator("[data-native-scene]");
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Native evidence requires a configured viewport");
  const sceneWidth = await scene.evaluate((element) => element.getBoundingClientRect().width);
  const initial = await preview.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollLeft: element.scrollLeft,
    // Native phone scenes retain the configured width and grow vertically in reading flow.
    // Give the dialog enough viewport height to expose that whole scene for its own capture.
    height: Math.ceil(element.scrollHeight) + 64,
  }));
  const height = Math.max(viewport.height, initial.height);
  try {
    if (height !== viewport.height) await page.setViewportSize({ ...viewport, height });
    expect(await scene.evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(
      sceneWidth,
      1,
    );
    await scene.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        scene.evaluate((element) => {
          const frame = element.getBoundingClientRect();
          const dialog = element.closest("dialog")!.getBoundingClientRect();
          return (
            frame.top >= dialog.top - 1 &&
            frame.left >= dialog.left - 1 &&
            frame.bottom <= dialog.bottom + 1 &&
            frame.right <= dialog.right + 1 &&
            frame.top >= -1 &&
            frame.bottom <= innerHeight + 1
          );
        }),
      )
      .toBe(true);
    return await scene.screenshot({ path, animations: "disabled" });
  } finally {
    if (height !== viewport.height) await page.setViewportSize(viewport);
    await preview.evaluate((element, scroll) => {
      element.scrollTop = scroll.scrollTop;
      element.scrollLeft = scroll.scrollLeft;
    }, initial);
  }
}

/** Keep a prior run's evidence intact, including when a project is rerun or retried. */
async function saveNewEvidence(name: string, data: Uint8Array | string, runId: string) {
  const directory = join("artifacts", "customer-templates");
  await mkdir(directory, { recursive: true });
  let destination = join(directory, name);
  try {
    await writeFile(destination, data, { flag: "wx" });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST"))
      throw error;
    const parsed = parse(name);
    destination = join(directory, `${parsed.name}-${runId}${parsed.ext}`);
    await writeFile(destination, data, { flag: "wx" });
  }
  return destination;
}

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
  await closeE01Overlays(page);
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
    await openE01Inspector(page, "Content");
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
    if (narrow) await closeE01Overlays(page);
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const published = await publishing;
    expect(published.status(), await published.text()).toBe(200);
    const version = (await published.json()).version;
    expect(version.content.schemaVersion).toBe(8);
    expect(version.content.blocks).toHaveLength(8);
    expect(
      version.content.blocks.every((block: { kind: string }) => block.kind === "content"),
    ).toBe(true);
    await openE01Inspector(page, "Content");
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
    const narrow = (page.viewportSize()?.width ?? 1280) <= 700;
    const runId = randomUUID();
    const fit: Array<
      Awaited<ReturnType<typeof expectNativeTextAndShapeFit>> & {
        id: string;
        slide: number;
        layout: string;
        visualStyle: string;
      }
    > = [];
    const captures: Array<{ name: string; data: Uint8Array }> = [];
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
        fit.push({
          id: template.id,
          slide: index + 1,
          layout: copy.layout,
          visualStyle: template.visualStyle,
          ...(await expectNativeTextAndShapeFit(
            preview,
            `${template.id}, slide ${index + 1} (${copy.layout})`,
            narrow,
          )),
        });
        const scene = preview.locator("[data-native-scene]");
        if (copy.columns) {
          const cards = await scene.locator('[data-node-type="shape"]').evaluateAll((headers) =>
            headers.map((header) => ({
              label: header.querySelector("span")?.textContent ?? "",
              detail: header.nextElementSibling?.firstElementChild?.textContent ?? "",
            })),
          );
          expect(cards).toHaveLength(copy.columns.length);
          for (const [columnIndex, column] of copy.columns.entries()) {
            const card = cards[columnIndex]!;
            expect(column.startsWith(card.label)).toBe(true);
            expect(column.slice(card.label.length).trim()).toBe(card.detail.trim());
          }
        }
        if (copy.layout === "statement") {
          const callout = await scene.locator('[data-node-type="shape"] span').innerText();
          const qualification = await scene.locator('[data-node-type="text"]').last().innerText();
          expect(copy.body.startsWith(callout)).toBe(true);
          expect(copy.body.slice(callout.length).trim()).toBe(qualification.trim());
        }
        if (copy.layout === "cover" || copy.layout === "closing")
          await expect(scene.locator('[data-node-type="text"]').last()).toHaveText(copy.body);
        if (index === 0) {
          const notes = preview.locator("[data-template-notes]");
          await expect(notes).not.toHaveAttribute("open");
          expect(await preview.innerText()).not.toContain(copy.notes);
          const summary = notes.locator("summary");
          await summary.click();
          await expect(notes).toHaveAttribute("open", "");
          await expect(notes.locator("div")).toContainText(copy.notes);
          await summary.click();
          await expect(notes).not.toHaveAttribute("open");
          await preview.getByRole("button", { name: "Close preview", exact: true }).focus();
        }
        if (copy.illustrativeTable)
          await expect(
            preview.getByRole("table", { name: copy.illustrativeTable.caption, exact: true }),
          ).toBeVisible();
        if (copy.illustrativeChart) {
          await expect(
            preview.getByText(copy.illustrativeChart.summary, { exact: true }),
          ).toBeVisible();
          if (!narrow) await expectCompleteChartPlot(preview, `${template.id}, slide ${index + 1}`);
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
          await captureNativeScene(
            page,
            preview,
            testInfo.outputPath(`${template.id}-data-preview.png`),
          );
        }
        if (accessibleLayouts[template.id]?.includes(index + 1))
          expect(
            (await new AxeBuilder({ page }).analyze()).violations,
            `${template.id}, slide ${index + 1}: ${template.visualStyle}/${copy.layout}`,
          ).toEqual([]);
        if (layoutSnapshots[template.id]?.includes(index + 1)) {
          captures.push({
            name: `${testInfo.project.name}-${template.id}-slide${index + 1}.png`,
            data: await captureNativeScene(page, preview),
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
    expect(fit).toHaveLength(96);
    expect(captures).toHaveLength(12);
    // Emit evidence only after every deck, fit check, guide and read-only assertion passes.
    const snapshots: string[] = [];
    for (const capture of captures)
      snapshots.push(await saveNewEvidence(capture.name, capture.data, runId));
    const receipt = JSON.stringify(
      { project: testInfo.project.name, runId, narrow, slides: fit, snapshots },
      null,
      2,
    );
    const receiptPath = await saveNewEvidence(
      `${testInfo.project.name}-native-layout-fit.json`,
      receipt,
      runId,
    );
    await testInfo.attach("native-layout-fit", {
      path: receiptPath,
      contentType: "application/json",
    });
  });

  test(`German and Korean native previews retain complete localized layouts across three visual styles${suffix}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const narrow = (page.viewportSize()?.width ?? 1280) <= 700;
    const runId = randomUUID();
    const fit: Array<
      Awaited<ReturnType<typeof expectNativeTextAndShapeFit>> & {
        locale: string;
        id: string;
        slide: number;
        layout: string;
        visualStyle: string;
      }
    > = [];
    const captures: Array<{ name: string; data: Uint8Array }> = [];
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        ["POST", "PUT"].includes(request.method()) &&
        /^\/v1\/presentations(?:\/[^/]+\/draft)?$/.test(new URL(request.url()).pathname)
      )
        writes.push(request.url());
    });
    try {
      for (const locale of ["de-DE", "ko-KR"] as const) {
        await specialistLocale(page, locale);
        await page.goto("/create/presentation?start=template");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator('[data-template-collection="native"]')).toHaveCount(12);
        const messages = templateMessages(locale);
        const copy = presentationTemplateCopy(locale);
        const catalog = localeCatalogs[locale];
        for (const id of localizedDecks) {
          const templateIndex = nativeContent.findIndex((entry) => entry.id === id);
          const definition = nativeContent[templateIndex]!;
          const template = catalog.native[templateIndex]!;
          const card = page.locator(`[data-template-id="${id}"]`);
          await expect(
            card.getByRole("heading", { name: template.title, exact: true }),
          ).toBeVisible();
          const trigger = card.getByRole("button", {
            name: messages["templateLibrary.previewStructure"],
            exact: true,
          });
          await trigger.click();
          const preview = page.getByRole("dialog", {
            name: copy("Presentation template preview"),
            exact: true,
          });
          await expect(preview).toHaveAttribute("lang", locale);
          const next = preview.getByRole("button", { name: copy("Next slide"), exact: true });
          let currentSlide = 1;
          for (const slide of layoutSnapshots[id]!) {
            while (currentSlide < slide) {
              await next.click();
              currentSlide += 1;
            }
            const source = {
              ...definition.slides[slide - 1]!,
              ...template.slides[slide - 1]!,
            };
            const columns = source.columns
              ? catalog.nativeData[`${templateIndex}.${slide - 1}`]!.slice(0, source.columns.length)
              : undefined;
            await expect(preview.getByRole("status")).toHaveText(
              copy("Slide {number} of {count}", { number: slide, count: 8 }),
            );
            await expect(preview.locator("[data-template-preview-slide]")).toHaveAttribute(
              "lang",
              locale,
            );
            const scene = preview.locator("[data-native-scene]");
            await expect(
              scene.getByRole("heading", { name: source.title, exact: true }),
            ).toHaveAttribute("lang", locale);
            fit.push({
              locale,
              id,
              slide,
              layout: source.layout,
              visualStyle: definition.visualStyle,
              ...(await expectNativeTextAndShapeFit(
                preview,
                `${locale}/${id}, slide ${slide} (${source.layout})`,
                narrow,
              )),
            });
            // Compare the full public strings, including any qualification after a callout.
            // This also proves that mobile reading flow exposes every authored text object.
            const actual = await scene
              .locator('[data-node-type="text"], [data-node-type="shape"]')
              .evaluateAll((nodes) =>
                nodes.map((node) => {
                  const shape = node.getAttribute("data-node-type") === "shape";
                  const content = shape ? node.querySelector("span") : node.firstElementChild;
                  if (!content) throw new Error("Expected authored localized content");
                  return {
                    type: node.getAttribute("data-node-type"),
                    text: content.textContent,
                    language: content.closest("[lang]")?.getAttribute("lang"),
                  };
                }),
              );
            expect(
              actual,
              `${locale}/${id}, slide ${slide}: complete content and language`,
            ).toEqual(
              localizedPublicText(source, template.scenarioLabel, columns).map((node) => ({
                ...node,
                language: locale,
              })),
            );
            if (slide === 1) {
              expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
              captures.push({
                name: `${testInfo.project.name}-${locale}-${id}-slide${slide}.png`,
                data: await captureNativeScene(page, preview),
              });
            }
          }
          await preview.getByRole("button", { name: copy("Close preview"), exact: true }).click();
          await expect(preview).toHaveCount(0);
          await expect(trigger).toBeFocused();
        }
      }
    } finally {
      // The seeded beta account is shared with other journeys; restore its original language.
      await specialistLocale(page, "en-CA");
    }
    expect(writes).toEqual([]);
    expect(fit).toHaveLength(24);
    expect(captures).toHaveLength(6);
    const snapshots: string[] = [];
    for (const capture of captures)
      snapshots.push(await saveNewEvidence(capture.name, capture.data, runId));
    const receiptPath = await saveNewEvidence(
      `${testInfo.project.name}-native-localized-fit.json`,
      JSON.stringify(
        { project: testInfo.project.name, runId, narrow, slides: fit, snapshots },
        null,
        2,
      ),
      runId,
    );
    await testInfo.attach("native-localized-fit", {
      path: receiptPath,
      contentType: "application/json",
    });
  });
}
