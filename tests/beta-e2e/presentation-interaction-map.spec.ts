import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  MediaAccessSchema,
  MediaUploadTicketSchema,
  PresentationSceneDraftSchema,
  type PresentationSceneNode,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import {
  closeE01Overlays,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  openE01Navigator,
  readE01Record,
  selectE01Block,
} from "./presentation-e01-support";

test.skip(
  process.env.BETA_E2E_VISUAL_IMPORTS !== "true",
  "Requires the opt-in loopback storage and synthetic clean-scanner fixture for real image uploads.",
);

const externalHref = "https://example.com/synthetic-interaction-brief";
const imageLabel = "Synthetic evidence diagram";
const actionIds = [
  "local",
  "broadcast",
  "navigation",
  "external",
  "dialog",
  "hotspot",
  "missing-image",
  "outside-image",
] as const;
const labels = [
  "Show evidence",
  "Show evidence",
  "Go to evidence summary",
  "Read the evidence brief",
  "Inspect the reasoning",
  "Inspect the diagram",
  "Inspect missing image",
  "Inspect outside image",
];
const kinds = [
  "Reveal panel",
  "Reveal panel",
  "Slide link",
  "External link",
  "Detail dialog",
  "Image hotspot",
  "Image hotspot",
  "Image hotspot",
];

async function uploadFixtureImage(page: Page) {
  // A deterministic 16-by-9 two-colour PNG, uploaded through the normal asset/scanner API.
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAGElEQVR4nGNQjliKFYmWBWNFDKMaBoUGAD21j3EPCkrmAAAAAElFTkSuQmCC",
    "base64",
  );
  const requested = await page.request.post(`${e01ApiUrl}/v1/media`, {
    data: {
      fileName: "synthetic-interaction-map.png",
      mimeType: "image/png",
      sizeBytes: bytes.length,
      altText: imageLabel,
    },
  });
  expect(requested.status()).toBe(201);
  const ticket = MediaUploadTicketSchema.parse(await requested.json());
  const uploaded = await page.request.put(ticket.uploadUrl, {
    headers: { "content-type": "image/png" },
    data: bytes,
  });
  expect(uploaded.ok()).toBe(true);
  const completed = await page.request.post(`${e01ApiUrl}/v1/media/${ticket.mediaId}/complete`);
  expect(completed.status()).toBe(200);
  const access = MediaAccessSchema.parse(await completed.json());
  expect(access.media.scanStatus).toBe("clean");
  expect(access.downloadUrl).toBeDefined();
  return { mediaId: ticket.mediaId, storageOrigin: new URL(access.downloadUrl!).origin };
}

function fixture(mediaId: string) {
  const opening = e01Slide("Opening context");
  const current = e01Slide("Interaction map evidence");
  const target = e01Slide("Evidence summary");
  const hidden = { ...e01Slide("Hidden planning context"), hidden: true as const };
  const title = {
    ...current.scene!.nodes[0]!,
    frame: { x: 5, y: 3, width: 90, height: 14 },
  } as PresentationSceneNode;
  const actions: PresentationSceneNode[] = [
    {
      id: "local",
      type: "reveal",
      scope: "local",
      label: labels[0]!,
      body: "Local evidence for this viewer.",
      frame: { x: 5, y: 21, width: 20, height: 19 },
    },
    {
      id: "broadcast",
      type: "reveal",
      scope: "broadcast",
      label: labels[1]!,
      body: "Evidence the facilitator reveals to everyone live.",
      frame: { x: 28, y: 21, width: 20, height: 19 },
    },
    {
      id: "navigation",
      type: "navigation",
      label: labels[2]!,
      targetBlockId: target.id.toUpperCase(),
      frame: { x: 5, y: 44, width: 20, height: 19 },
    },
    {
      id: "external",
      type: "link",
      label: labels[3]!,
      href: externalHref,
      frame: { x: 28, y: 44, width: 20, height: 19 },
    },
    {
      id: "dialog",
      type: "dialog",
      scope: "local",
      label: labels[4]!,
      detailTitle: "Evidence reasoning",
      body: "Supporting reasoning for the synthetic example.",
      frame: { x: 5, y: 74, width: 20, height: 19 },
    },
    {
      id: "hotspot",
      type: "hotspot",
      scope: "local",
      imageNodeId: "diagram",
      label: labels[5]!,
      detailTitle: "Diagram detail",
      body: "The selected region of the synthetic diagram.",
      frame: { x: 58, y: 32, width: 16, height: 18 },
    },
    {
      id: "missing-image",
      type: "hotspot",
      scope: "local",
      imageNodeId: null,
      label: labels[6]!,
      detailTitle: "Unlinked detail",
      body: "This draft hotspot needs an image.",
      frame: { x: 28, y: 74, width: 20, height: 19 },
    },
    {
      id: "outside-image",
      type: "hotspot",
      scope: "local",
      imageNodeId: "diagram",
      label: labels[7]!,
      detailTitle: "Misplaced detail",
      body: "This draft hotspot needs to be inside its image.",
      frame: { x: 58, y: 74, width: 16, height: 18 },
    },
  ];
  const image: PresentationSceneNode = {
    id: "diagram",
    type: "image",
    mediaId,
    altText: imageLabel,
    frame: { x: 53, y: 21, width: 42, height: 43 },
  };
  current.scene = PresentationSceneDraftSchema.parse({
    schemaVersion: 6,
    aspectRatio: "16:9",
    // Storage/painting order deliberately differs from semantic action order.
    nodes: [title, image, ...[...actions].reverse()],
    readingOrder: [title.id, "local", image.id, ...actionIds.slice(1)],
  });
  return { opening, current, target, hidden, mediaId, actions, image };
}

async function keyboardActivate(button: Locator, key = "Enter") {
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  await expect(button).toBeFocused();
  await button.press(key);
}

async function expectHorizontalFit(page: Page, elements: Locator[]) {
  const documentSize = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
  }));
  expect(documentSize.width, JSON.stringify(documentSize)).toBeLessThanOrEqual(
    documentSize.viewport + 1,
  );
  for (const element of elements) {
    await expect(element).toBeVisible();
    const bounds = await element.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(documentSize.viewport + 1);
    expect(bounds!.width).toBeGreaterThan(0);
    expect(bounds!.height).toBeGreaterThan(0);
  }
}

async function expectPassiveCues(
  canvas: Locator,
  actions: PresentationSceneNode[],
  image: PresentationSceneNode,
) {
  const stage = canvas.locator('[data-native-scene="true"]');
  const cues = stage.locator('[data-native-interaction-cues="true"]');
  await expect(cues).toBeVisible();
  await expect(cues).toHaveAttribute("aria-hidden", "true");
  await expect(cues).toHaveAttribute("focusable", "false");
  await expect(cues).toHaveAttribute("viewBox", "0 0 1600 900");
  await expect(cues).toHaveCSS("pointer-events", "none");
  await expect(cues.locator("button, a, [tabindex]")).toHaveCount(0);
  const [stageBounds, cueBounds] = await Promise.all([stage.boundingBox(), cues.boundingBox()]);
  expect(stageBounds).not.toBeNull();
  expect(cueBounds).not.toBeNull();
  // The authored stage's one-pixel border surrounds the overlay's coordinate plane.
  for (const key of ["x", "y", "width", "height"] as const)
    expect(Math.abs(cueBounds![key] - stageBounds![key])).toBeLessThanOrEqual(2);
  expect(cueBounds!.x).toBeGreaterThanOrEqual(stageBounds!.x);
  expect(cueBounds!.y).toBeGreaterThanOrEqual(stageBounds!.y);
  expect(cueBounds!.x + cueBounds!.width).toBeLessThanOrEqual(stageBounds!.x + stageBounds!.width);
  expect(cueBounds!.y + cueBounds!.height).toBeLessThanOrEqual(
    stageBounds!.y + stageBounds!.height,
  );
  await expect(cues.locator("[data-interaction-cue-node]")).toHaveCount(actions.length);
  for (const node of [...actions, image]) {
    if (node.type === "connector") throw new Error("Expected a framed cue");
    const outline = cues.locator(
      node.type === "image"
        ? `[data-interaction-cue-image="${node.id}"]`
        : `[data-interaction-cue-node="${node.id}"]`,
    );
    for (const [attribute, expected] of Object.entries({
      x: node.frame.x * 16,
      y: node.frame.y * 9,
      width: node.frame.width * 16,
      height: node.frame.height * 9,
    }))
      expect(Number(await outline.getAttribute(attribute))).toBeCloseTo(expected, 5);
    await expect(outline).toHaveCSS("pointer-events", "none");
  }
  const connection = cues.locator('[data-interaction-cue-connection="true"]');
  await expect(connection).toHaveCount(1);
  await expect(connection).not.toHaveCSS("stroke-dasharray", "none");
  // A real hit test and pointer selection prove the outlines do not cover the authored object.
  const local = stage.locator('[data-node-id="local"]');
  await local.scrollIntoViewIfNeeded();
  expect(
    await local.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return hit === element || element.contains(hit);
    }),
  ).toBe(true);
  await local.click();
  await expect(canvas.getByRole("combobox", { name: "Canvas object", exact: true })).toHaveValue(
    "local",
  );
}

for (const suffix of ["", " @mobile"]) {
  test(`interaction map selects and explains actions without changing the deck${suffix}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const media = await uploadFixtureImage(page);
    const slides = fixture(media.mediaId);
    const record = await createE01Deck(
      page,
      [slides.opening, slides.current, slides.target, slides.hidden],
      13,
    );
    const before = await readE01Record(page, record.id);
    // Setup has completed. Every editor action below uses real API/media reads and no writes.
    const writes: string[] = [];
    const externalRequests: string[] = [];
    const popups: string[] = [];
    const localOrigins = new Set([
      new URL(page.url()).origin,
      new URL(e01ApiUrl).origin,
      media.storageOrigin,
    ]);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
        (url.pathname.includes("/presentation-sessions") ||
          url.pathname.endsWith("/publish") ||
          /\/responses(?:\/|$)/.test(url.pathname) ||
          url.pathname === `/v1/presentations/${record.id}/draft` ||
          /^\/v1\/media(?:\/|$)/.test(url.pathname))
      )
        writes.push(`${request.method()} ${url.pathname}`);
      if (/^https?:$/.test(url.protocol) && !localOrigins.has(url.origin))
        externalRequests.push(request.url());
    });
    page.on("popup", (popup) => popups.push(popup.url()));
    const viewport = page.viewportSize()!;
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    await selectE01Block(page, "Interaction map evidence", narrow);
    await closeE01Overlays(page);
    const canvas = page.locator('[data-native-scene-canvas="true"]');
    const map = canvas.locator('[data-native-interaction-map="true"]');
    const card = map.getByRole("region", { name: "Selected interaction connection", exact: true });
    const selected = canvas.getByRole("combobox", { name: "Canvas object", exact: true });
    const inspector = page.locator("#presentation-object-inspector");
    const show = canvas.getByRole("button", { name: "Show interaction map", exact: true });
    const hide = canvas.getByRole("button", { name: "Hide interaction map", exact: true });
    const row = (index: number) =>
      map.getByRole("button", {
        name: `${index + 1} ${kinds[index]} ${labels[index]}`,
        exact: true,
      });
    const choose = async (index: number, key = "Enter") => {
      await keyboardActivate(row(index), key);
      await expect(row(index)).toHaveAttribute("aria-pressed", "true");
      await expect(selected).toHaveValue(actionIds[index]!);
      await expect(map.locator('button[aria-pressed="true"]')).toHaveCount(1);
      await expect(row(index)).toBeFocused();
    };
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await expect(map.locator("button[aria-pressed]")).toHaveCount(0);
    await expect(card).toHaveCount(0);
    await expect(canvas.locator('[data-native-interaction-cues="true"]')).toHaveCount(0);
    await keyboardActivate(show);
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await expect(map).toBeVisible();
    await expect(hide).toBeFocused();
    expect(["absolute", "fixed", "sticky"]).not.toContain(
      await hide.evaluate((element) => getComputedStyle(element).position),
    );
    await expect(map.getByRole("button", { name: /preview/i })).toHaveCount(0);
    await expect(map.getByRole("link")).toHaveCount(0);
    const rows = map.locator("button[aria-pressed]");
    await expect(rows).toHaveCount(actionIds.length);
    for (let index = 0; index < actionIds.length; index++) {
      await expect(rows.nth(index)).toHaveAccessibleName(
        `${index + 1} ${kinds[index]} ${labels[index]}`,
      );
      await expect(row(index)).toContainText(kinds[index]!);
      await expect(row(index)).toContainText(String(index + 1));
    }
    expect(
      await map.evaluate((element) => element.closest('[data-native-scene="true"]') === null),
    ).toBe(true);
    const [mapBounds, stageBounds] = await Promise.all([
      map.boundingBox(),
      canvas.locator('[data-native-scene="true"]').boundingBox(),
    ]);
    expect(mapBounds!.y + mapBounds!.height).toBeLessThanOrEqual(stageBounds!.y + 1);
    await choose(0);
    await expect(inspector).not.toBeVisible();
    await expect(card).toContainText("Each viewer opens this on their own screen.");
    await expect(card).toContainText("Show or hide the panel’s audience content.");
    await choose(1, "Space");
    await expect(row(0)).toHaveAttribute("aria-pressed", "false");
    await expect(card).toContainText(
      "Live: reveal for everyone. Preview and shared links: this screen only.",
    );
    await choose(2);
    await expect(card).toContainText("Go to “Evidence summary”.");
    await expect(card).toContainText(
      "Live: move everyone. Preview and shared links: move this reader only.",
    );
    await expect(card).not.toContainText("Choose an available target");
    await choose(3);
    await expect(card).toContainText(`Open ${externalHref} in a new tab.`);
    await choose(4);
    await expect(card).toContainText("Open the detail dialog “Evidence reasoning”.");
    await choose(5);
    await expect(card).toContainText(`Choose “Inspect the diagram” on ${imageLabel}.`);
    await expect(card).toContainText("Open the detail dialog “Diagram detail”.");
    await canvas.screenshot({ path: testInfo.outputPath("interaction-map-editor.png") });
    await page.screenshot({ path: testInfo.outputPath("interaction-map-panel.png") });
    if (!narrow) {
      await canvas.locator('[data-native-scene="true"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("interaction-cues-stage.png") });
    }
    if (narrow) await expect(canvas.locator('[data-native-interaction-cues="true"]')).toBeHidden();
    else await expectPassiveCues(canvas, slides.actions, slides.image);
    await choose(6);
    await expect(card).toContainText("Choose the image for this hotspot.");
    await expect(canvas.locator("[data-interaction-cue-image]")).toHaveCount(0);
    await expect(canvas.locator("[data-interaction-cue-connection]")).toHaveCount(0);
    await choose(7);
    await expect(card).toContainText("Keep the hotspot inside its unrotated image.");
    await expect(canvas.locator("[data-interaction-cue-image]")).toHaveCount(0);
    await expect(canvas.locator("[data-interaction-cue-connection]")).toHaveCount(0);
    const edit = map.getByRole("button", { name: "Edit interaction", exact: true });
    await keyboardActivate(edit);
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("tab", { name: "Content", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const inspected = inspector.getByRole("combobox", { name: "Selected object", exact: true });
    await expect(inspected).toHaveValue("outside-image");
    const tryIt = inspector.getByRole("button", { name: "Preview this slide", exact: true });
    await expect(tryIt).toBeDisabled();
    await closeE01Overlays(page);
    await choose(2);
    await keyboardActivate(edit);
    await expect(inspected).toHaveValue("navigation");
    await expect(
      inspector.getByRole("combobox", { name: "Target slide or activity", exact: true }),
    ).toHaveValue(slides.target.id);
    await expect(tryIt).toBeEnabled();
    await keyboardActivate(tryIt);
    const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-preview-origin", "interaction");
    await expect(
      preview.getByRole("heading", { name: "Interaction map evidence", exact: true }),
    ).toBeVisible();
    await expect(
      preview.locator("[data-native-interaction-map], [data-native-interaction-cues]"),
    ).toHaveCount(0);
    await keyboardActivate(preview.getByRole("button", { name: /^Go to evidence summary/ }));
    await expect(
      preview.getByRole("heading", { name: "Evidence summary", exact: true }),
    ).toBeVisible();
    await expect(preview.getByRole("region", { name: "Slide preview", exact: true })).toBeFocused();
    for (const key of ["Shift+Tab", "Tab"]) {
      await page.keyboard.press(key);
      expect(await preview.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    }
    await page.keyboard.press("Escape");
    await expect(preview).not.toBeVisible();
    await expect(tryIt).toBeFocused();
    await expect(inspected).toHaveValue("navigation");
    await closeE01Overlays(page);
    await keyboardActivate(hide);
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await expect(show).toBeFocused();
    await expect(selected).toHaveValue("navigation");
    await expect(canvas.locator('[data-native-interaction-cues="true"]')).toHaveCount(0);
    await keyboardActivate(show);
    await expect(row(2)).toHaveAttribute("aria-pressed", "true");
    const navigator = await openE01Navigator(page);
    await expect(
      navigator.locator("[data-native-interaction-map], [data-native-interaction-cues]"),
    ).toHaveCount(0);
    await closeE01Overlays(page);
    await page.setViewportSize({ width: 320, height: 844 });
    await closeE01Overlays(page);
    await choose(0);
    await expectHorizontalFit(page, [map, card, hide, row(0), edit]);
    await row(0).click({ trial: true });
    await edit.click({ trial: true });
    await expect(canvas.locator('[data-native-interaction-cues="true"]')).toBeHidden();
    expect(
      (await new AxeBuilder({ page }).include('[data-native-interaction-map="true"]').analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("interaction-map-320.png"), fullPage: true });
    await page.setViewportSize(viewport);
    if (!narrow) {
      // Establish the wide ResizeObserver state before applying the next responsive
      // change. Otherwise a transient Hide inspector locator can disappear mid-click.
      await expect(inspector).toBeVisible();
      await expect(page.locator("#presentation-slide-navigator")).toBeVisible();
    }
    await closeE01Overlays(page);
    await expect(inspector).not.toBeVisible();
    await expect(page.locator("#presentation-slide-navigator")).not.toBeVisible();
    testInfo.annotations.push({
      type: "emulation",
      description: "200% document CSS zoom; browser device profiles are emulated.",
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    try {
      await choose(1, "Space");
      await expectHorizontalFit(page, [map, card, hide, row(1), edit]);
      await row(1).click({ trial: true });
      await edit.click({ trial: true });
      expect(
        (await new AxeBuilder({ page }).include('[data-native-interaction-map="true"]').analyze())
          .violations,
      ).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath("interaction-map-200-percent.png"),
        fullPage: false,
      });
    } finally {
      await page.evaluate(() => {
        document.documentElement.style.zoom = "";
      });
    }
    await keyboardActivate(hide);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
    expect(await readE01Record(page, record.id)).toEqual(before);
    expect(writes).toEqual([]);
    expect(externalRequests).toEqual([]);
    expect(popups).toEqual([]);
  });
}
