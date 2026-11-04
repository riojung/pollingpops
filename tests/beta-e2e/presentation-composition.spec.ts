import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type {
  PresentationDraft,
  PresentationScene,
  PresentationSceneNode,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import {
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
} from "./presentation-e01-support";

test.use({ actionTimeout: 30_000 });

function fixture() {
  const slide = e01Slide("Launch briefing");
  const title = slide.scene!.nodes[0]!;
  if (title.type !== "text") throw new Error("Expected a title");
  title.frame = { x: 7, y: 5, width: 86, height: 15 };
  const body: PresentationSceneNode = {
    id: randomUUID(),
    type: "text",
    role: "body",
    text: "Plan the launch",
    frame: { x: 20, y: 42, width: 20, height: 18 },
  };
  const shape: PresentationSceneNode = {
    id: randomUUID(),
    type: "shape",
    shape: "rounded_rectangle",
    label: "Review the plan",
    color: "blue",
    frame: { x: 55, y: 42, width: 20, height: 18 },
  };
  const edge: PresentationSceneNode = {
    id: randomUUID(),
    type: "connector",
    from: { nodeId: body.id, anchor: "right" },
    to: { nodeId: shape.id, anchor: "left" },
    label: "Review follows planning",
    color: "blue",
  };
  slide.scene = {
    schemaVersion: 3,
    aspectRatio: "16:9",
    design: { theme: "paper", font: "sans", spacing: "relaxed" },
    nodes: [title, body, shape, edge],
    readingOrder: [title.id, body.id, shape.id, edge.id],
  };
  slide.speakerNotes = "PRIVATE composition facilitator cue";
  return { slide, title, body, shape, edge };
}

function scene(draft: PresentationDraft): PresentationScene {
  const block = draft.blocks[0];
  if (block?.kind !== "content" || !block.scene) throw new Error("Expected a native slide");
  return block.scene;
}

function framed(value: PresentationScene, id: string) {
  const node = value.nodes.find((node) => node.id === id);
  if (!node || node.type === "connector") throw new Error("Expected a framed object");
  return node;
}

async function select(page: Page, label: string) {
  await page
    .getByRole("group", { name: "Slide objects · reading order", exact: true })
    .getByRole("button", { name: label, exact: true })
    .click();
}

for (const suffix of ["", " @mobile"]) {
  test(`stored groups rotate, scale, duplicate and deliver explicit video links${suffix}`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const original = fixture();
    const hidden = { ...e01Slide("HIDDEN composition planning"), hidden: true as const };
    const record = await createE01Deck(page, [original.slide, hidden], 7);
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    const objects = page.getByRole("group", { name: "Slide objects · reading order", exact: true });
    await select(page, "2. Plan the launch");
    await objects
      .getByRole("checkbox", { name: "Include Review the plan in selection", exact: true })
      .check();
    await page.getByRole("button", { name: "Group selected objects", exact: true }).click();
    await expect
      .poll(async () => {
        const draft = (await readE01Record(page, record.id)).draft;
        return {
          document: draft.schemaVersion,
          version: scene(draft).schemaVersion,
          members: scene(draft).groups?.[0]?.nodeIds,
        };
      })
      .toEqual({ document: 8, version: 4, members: [original.body.id, original.shape.id] });
    await select(page, "2. Plan the launch");
    await expect(
      objects.getByRole("checkbox", { name: "Include Review the plan in selection", exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole("button", { name: "Group selected objects", exact: true }),
    ).toBeDisabled();
    const grouped = scene((await readE01Record(page, record.id)).draft);
    await page.getByRole("button", { name: "Move selection right", exact: true }).click();
    await expect
      .poll(async () => {
        const value = scene((await readE01Record(page, record.id)).draft);
        return [framed(value, original.body.id).frame.x, framed(value, original.shape.id).frame.x];
      })
      .toEqual([21, 56]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () => scene((await readE01Record(page, record.id)).draft))
      .toEqual(grouped);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await page.getByLabel("Last selected angle (degrees)", { exact: true }).fill("15");
    await expect
      .poll(async () => {
        const value = scene((await readE01Record(page, record.id)).draft);
        return [
          framed(value, original.body.id).rotation,
          framed(value, original.shape.id).rotation,
        ];
      })
      .toEqual([15, 15]);
    const rotated = scene((await readE01Record(page, record.id)).draft);
    expect(rotated.readingOrder).toEqual(grouped.readingOrder);
    expect(rotated.nodes.find((node) => node.id === original.edge.id)).toEqual(original.edge);
    const canvas = page.locator("[data-native-scene]");
    const bodyView = canvas.locator(`[data-node-id="${original.body.id}"]`);
    await expect(bodyView).toHaveAttribute("data-rotation", "15");
    if (narrow) await expect(bodyView).toHaveCSS("transform", "none");
    else await expect(bodyView).not.toHaveCSS("transform", "none");
    await page.getByRole("button", { name: "Grow selection 5%", exact: true }).click();
    await expect
      .poll(
        async () =>
          framed(scene((await readE01Record(page, record.id)).draft), original.body.id).frame.width,
      )
      .toBeCloseTo(21, 7);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () => scene((await readE01Record(page, record.id)).draft))
      .toEqual(rotated);
    await select(page, "1. Slide title");
    const beforeRefusal = await readE01Record(page, record.id);
    await page.getByLabel("Last selected angle (degrees)", { exact: true }).fill("90");
    await expect(
      page.getByRole("alert").filter({ hasText: /rotated selection would leave the slide/ }),
    ).toBeVisible();
    expect((await readE01Record(page, record.id)).draftRevision).toBe(beforeRefusal.draftRevision);
    await select(page, "2. Plan the launch");
    await page.getByLabel("Last selected angle (degrees)", { exact: true }).fill("30");
    await expect
      .poll(
        async () =>
          framed(scene((await readE01Record(page, record.id)).draft), original.body.id).rotation,
      )
      .toBe(30);

    const providerRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith("https://example.com/")) providerRequests.push(request.url());
    });
    await page.getByLabel("Video title", { exact: true }).fill("Launch walkthrough");
    await page
      .getByLabel("Video HTTPS link", { exact: true })
      .fill("http://example.com/launch-video");
    await page
      .getByLabel("Captions or transcript HTTPS link", { exact: true })
      .fill("https://example.com/launch-transcript");
    await page.getByRole("button", { name: "Add external video link", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /HTTPS link/ })).toBeVisible();
    expect(scene((await readE01Record(page, record.id)).draft).nodes).toHaveLength(4);
    await page
      .getByLabel("Video HTTPS link", { exact: true })
      .fill("https://example.com/launch-video");
    await page.getByRole("button", { name: "Add external video link", exact: true }).click();
    await expect
      .poll(async () => scene((await readE01Record(page, record.id)).draft).nodes.length)
      .toBe(5);
    const saved = (await readE01Record(page, record.id)).draft;
    expect(saved.schemaVersion).toBe(8);
    expect(scene(saved).groups).toEqual(rotated.groups);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
    const video = preview.getByRole("link", { name: /^External video: Launch walkthrough/ });
    await expect(video).toHaveAttribute("href", "https://example.com/launch-video");
    await expect(video).toHaveAttribute("target", "_blank");
    await expect(video).toHaveAttribute("rel", /noopener/);
    await expect(video).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(preview.getByRole("link", { name: /^Captions \/ transcript:/ })).toHaveAttribute(
      "href",
      "https://example.com/launch-transcript",
    );
    await expect(preview.locator("iframe,video")).toHaveCount(0);
    expect(providerRequests).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    await page.reload();
    if (narrow) {
      await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
      await page.getByRole("button", { name: "Collapse map", exact: true }).click();
    }
    expect((await readE01Record(page, record.id)).draft).toEqual(saved);
    const duplicate = page
      .getByLabel("Selected block actions", { exact: true })
      .getByRole("button", { name: "Duplicate", exact: true });
    await duplicate.click();
    await expect
      .poll(async () => (await readE01Record(page, record.id)).draft.blocks.length)
      .toBe(3);
    const copied = (await readE01Record(page, record.id)).draft.blocks[1];
    if (copied?.kind !== "content" || !copied.scene)
      throw new Error("Expected the copied native slide");
    const sourceIds = new Set([
      ...scene(saved).nodes.map((node) => node.id),
      ...scene(saved).groups!.map((group) => group.id),
    ]);
    expect(
      [
        ...copied.scene.nodes.map((node) => node.id),
        ...copied.scene.groups!.map((group) => group.id),
      ].some((id) => sourceIds.has(id)),
    ).toBe(false);
    expect(
      copied.scene.groups![0]!.nodeIds.every((id) =>
        copied.scene!.nodes.some((node) => node.id === id),
      ),
    ).toBe(true);
    const readyToPublish = await readE01Record(page, record.id);
    const published = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
      { data: { expectedDraftRevision: readyToPublish.draftRevision } },
    );
    expect(published.status(), await published.text()).toBe(200);
    const version = (await published.json()).version;
    expect(version.content.schemaVersion).toBe(8);
    expect(version.content.blocks).toHaveLength(2);
    expect(JSON.stringify(version.content)).not.toContain("HIDDEN");
    expect(version.content.blocks[0].speakerNotes).toBe("PRIVATE composition facilitator cue");
    const hosted = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
      data: { presentationId: record.id },
    });
    expect(hosted.status()).toBe(201);
    const { snapshot: lobby, controlToken } = await hosted.json();
    await page.evaluate(
      ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
      { id: lobby.sessionId as string, token: controlToken as string },
    );
    await page.goto(`/presentation-session/${lobby.sessionId}/host`);
    const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
    const context = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      reducedMotion: "reduce",
    });
    try {
      const audience = await context.newPage();
      await audience.goto(`/join?code=${lobby.code}`);
      await audience.getByLabel("Nickname", { exact: true }).fill("Composition audience");
      await audience.getByRole("button", { name: "Join a Presentation", exact: true }).click();
      await expect(audience).toHaveURL(`/presentation-session/${lobby.sessionId}/play`);
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      const delivered = audience.locator("[data-native-scene]");
      await expect(delivered.locator(`[data-node-id="${original.body.id}"]`)).toHaveAttribute(
        "data-rotation",
        "30",
      );
      await expect(
        delivered.getByRole("link", { name: /^External video: Launch walkthrough/ }),
      ).toHaveAttribute("href", "https://example.com/launch-video");
      await expect(delivered).not.toContainText("PRIVATE");
      expect((await new AxeBuilder({ page: audience }).analyze()).violations).toEqual([]);
      await page.bringToFront();
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
      await expect(
        audience.getByRole("heading", { name: "Thanks for participating", exact: true }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

test("pointer snap guides are transient, Alt bypasses snapping and Escape cancels the gesture", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signInBeta(page);
  const original = fixture();
  const record = await createE01Deck(page, [original.slide], 7);
  await enterE01Editor(page, record.id, false);
  const stage = page.locator("[data-native-scene]");
  const move = stage.getByRole("button", {
    name: "Move Plan the launch. Use arrow keys to nudge.",
    exact: true,
  });
  await move.scrollIntoViewIfNeeded();
  const bounds = (await stage.boundingBox())!;
  const button = (await move.boundingBox())!;
  const start = { x: button.x + button.width / 2, y: button.y + button.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + bounds.width * 0.145, start.y);
  await expect(page.locator("[data-native-snap-guides]")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator("[data-native-snap-guides]")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        framed(scene((await readE01Record(page, record.id)).draft), original.body.id).frame.x,
    )
    .toBeCloseTo(35, 5);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => scene((await readE01Record(page, record.id)).draft))
    .toEqual(original.slide.scene);
  await move.scrollIntoViewIfNeeded();
  const refreshed = (await move.boundingBox())!;
  await page.keyboard.down("Alt");
  await page.mouse.move(refreshed.x + refreshed.width / 2, refreshed.y + refreshed.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    refreshed.x + refreshed.width / 2 + bounds.width * 0.145,
    refreshed.y + refreshed.height / 2,
  );
  await expect(page.locator("[data-native-snap-guides]")).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  // Firefox quantizes pointer clientX to whole CSS pixels. Compare in rendered stage
  // pixels so fractional drag targets allow at most one pixel of event rounding.
  const stagePixelsPerPercent = bounds.width / 100;
  await expect
    .poll(async () => {
      const actualX = framed(scene((await readE01Record(page, record.id)).draft), original.body.id)
        .frame.x;
      return Math.abs(actualX - 34.5) * stagePixelsPerPercent;
    })
    .toBeLessThanOrEqual(1);
  const beforeCancel = await readE01Record(page, record.id);
  const unsnappedX = framed(scene(beforeCancel.draft), original.body.id).frame.x;
  expect(
    Math.abs(unsnappedX - 35) * stagePixelsPerPercent,
    "Alt bypass remains more than one rendered pixel away from the snapped 35% position",
  ).toBeGreaterThan(1);
  const cancelButton = (await move.boundingBox())!;
  await page.mouse.move(
    cancelButton.x + cancelButton.width / 2,
    cancelButton.y + cancelButton.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(cancelButton.x + 30, cancelButton.y + 30);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator("[data-native-snap-guides]")).toHaveCount(0);
  expect((await readE01Record(page, record.id)).draft).toEqual(beforeCancel.draft);
});
