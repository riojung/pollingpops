import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  ContentSlideDraft,
  PresentationDraft,
  PresentationParticipantSnapshot,
  PresentationScene,
  PresentationSceneFrame,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import {
  openE01Inspector,
  closeE01Overlays,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
} from "./presentation-e01-support";

test.use({ actionTimeout: 30_000 });

const design = { theme: "midnight", font: "serif", spacing: "compact" } as const;
const briefUrl = "https://example.com/design-brief";

function nativeSlide(draft: PresentationDraft, index = 0) {
  const block = draft.blocks[index];
  if (block?.kind !== "content" || !block.scene) throw new Error("Expected a native slide");
  return block as ContentSlideDraft & { scene: PresentationScene };
}

function frame(scene: PresentationScene, id: string): PresentationSceneFrame {
  const node = scene.nodes.find((item) => item.id === id);
  if (!node || node.type === "connector") throw new Error("Expected a framed object");
  return node.frame;
}

async function expectNoHorizontalOverflow(page: Page) {
  const measurement = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    overflowing: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        className: String(element.className),
        right: element.getBoundingClientRect().right,
      })),
  }));
  expect(measurement.scrollWidth, JSON.stringify(measurement)).toBeLessThanOrEqual(
    measurement.viewportWidth + 1,
  );
}

async function expectDesign(stage: Locator) {
  await expect(stage).toHaveAttribute("data-native-theme", "midnight");
  await expect(stage).toHaveAttribute("data-native-font", "serif");
  await expect(stage).toHaveAttribute("data-native-spacing", "compact");
  await expect(stage).toHaveCSS("background-color", "rgb(17, 27, 46)");
  await expect(stage).toHaveCSS("color", "rgb(246, 248, 255)");
  await expect(stage).toHaveCSS("font-family", /Georgia/);
  await expect(stage.getByRole("heading")).toHaveCSS("font-family", /Georgia/);
  await expect(stage.getByRole("heading")).toHaveCSS("color", "rgb(246, 248, 255)");
}

async function expectRichText(stage: Locator, bodyId: string) {
  const body = stage.locator(`[data-node-id="${bodyId}"]`);
  await expect(body).toHaveCSS("font-family", /Georgia/);
  await expect(body.locator("p").first()).toHaveCSS("font-family", /Georgia/);
  await expect(body.locator("p").first()).toHaveCSS("color", "rgb(246, 248, 255)");
  await expect(body.locator("strong")).toHaveText("Decide");
  await expect(body.locator("ul li em")).toHaveText("Assign an owner");
  const link = body.locator("ol li").getByRole("link", { name: "Review the brief", exact: true });
  await expect(link).toHaveAttribute("href", briefUrl);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(link).toHaveCSS("color", "rgb(153, 216, 255)");
}

function designFixture() {
  const visible = e01Slide("Designed audience plan", true);
  visible.speakerNotes = "PRIVATE E02 facilitator cue";
  visible.citations = [{ locator: "PRIVATE E02 source", excerpt: "PRIVATE E02 source excerpt" }];
  const body = visible.scene!.nodes.find((node) => node.type === "text" && node.role === "body");
  if (body?.type !== "text") throw new Error("Expected rich body text");
  body.text = "Decide together\nAssign an owner\nReview the brief";
  body.richText = {
    paragraphs: [
      { kind: "paragraph", runs: [{ text: "Decide", bold: true }, { text: " together" }] },
      { kind: "bullet", runs: [{ text: "Assign an owner", italic: true }] },
      { kind: "numbered", runs: [{ text: "Review the brief", href: briefUrl }] },
    ],
  };
  const hidden = { ...e01Slide("HIDDEN E02 context"), hidden: true as const };
  const ordinary: ContentSlideDraft = {
    id: randomUUID(),
    kind: "content",
    layout: "title_body",
    textElements: [
      {
        id: "ordinary-title",
        role: "title",
        text: "Ordinary follow-up",
        region: "top_center",
        order: 0,
      },
      {
        id: "ordinary-body",
        role: "body",
        text: "Keep the original slide.",
        region: "middle_center",
        order: 0,
      },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "PRIVATE E02 ordinary cue",
  };
  return { visible, hidden, ordinary, bodyId: body.id };
}

async function participantSnapshot(guest: Page, sessionId: string) {
  const token = await guest.evaluate(
    (id) => sessionStorage.getItem(`openround:presentation-participant:${id}`),
    sessionId,
  );
  expect(token).toBeTruthy();
  const response = await guest.request.get(
    `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/participant`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(response.status()).toBe(200);
  return (await response.json()).snapshot as PresentationParticipantSnapshot;
}

for (const suffix of ["", " @mobile"]) {
  test(`native design persists, applies across hidden slides and stays frozen in live delivery${suffix}`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await signInBeta(page);
    const fixture = designFixture();
    const record = await createE01Deck(
      page,
      [fixture.visible, fixture.hidden, fixture.ordinary],
      6,
    );
    const initial = record.draft;
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    // Unthemed slides retain the app's existing heading styles until explicit design opt-in.
    const legacyHeading = await page.evaluate(() => {
      const probe = document.createElement("h1");
      probe.style.cssText = "position:fixed;visibility:hidden";
      document.body.append(probe);
      const computed = getComputedStyle(probe);
      const result = {
        color: computed.color,
        font: computed.fontFamily,
        maxWidth: computed.maxWidth,
      };
      probe.remove();
      return result;
    });
    const originalHeading = page.locator("[data-native-scene]").getByRole("heading");
    await expect(originalHeading).toHaveCSS("color", legacyHeading.color);
    await expect(originalHeading).toHaveCSS("font-family", legacyHeading.font);
    await expect(originalHeading).toHaveCSS("max-width", legacyHeading.maxWidth);
    await openE01Inspector(page, "Layout");
    await page.getByRole("button", { name: "Enable slide design", exact: true }).click();
    await page.getByRole("combobox", { name: "Slide theme", exact: true }).selectOption("midnight");
    await page.getByRole("combobox", { name: "Slide font", exact: true }).selectOption("serif");
    await page
      .getByRole("combobox", { name: "Slide spacing", exact: true })
      .selectOption("compact");
    await expect
      .poll(async () => nativeSlide((await readE01Record(page, record.id)).draft).scene.design)
      .toEqual(design);
    await page.getByRole("button", { name: "Title and body", exact: true }).click();
    await expect
      .poll(async () => {
        const scene = nativeSlide((await readE01Record(page, record.id)).draft).scene;
        return scene.nodes.map((node) => (node.type === "connector" ? null : node.frame));
      })
      .toEqual([
        { x: 7, y: 7, width: 86, height: 20 },
        { x: 7, y: 33, width: 86, height: 59 },
      ]);
    const beforeApply = (await readE01Record(page, record.id)).draft;
    expect(nativeSlide(beforeApply, 1)).toEqual(initial.blocks[1]);
    expect(beforeApply.blocks[2]).toEqual(initial.blocks[2]);
    const expectedApplied: PresentationDraft = {
      ...beforeApply,
      schemaVersion: 7,
      blocks: beforeApply.blocks.map((block) =>
        block.kind === "content" && block.scene
          ? { ...block, scene: { ...block.scene, schemaVersion: 3, design } }
          : block,
      ),
    };
    await page
      .getByRole("button", { name: "Apply design to all native slides", exact: true })
      .click();
    await expect
      .poll(async () => (await readE01Record(page, record.id)).draft)
      .toEqual(expectedApplied);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, record.id)).draft)
      .toEqual(beforeApply);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, record.id)).draft)
      .toEqual(expectedApplied);
    expect(nativeSlide(expectedApplied).scene.readingOrder).toEqual(
      nativeSlide(initial).scene.readingOrder,
    );
    expect(nativeSlide(expectedApplied).scene.nodes.map((node) => node.id)).toEqual(
      nativeSlide(initial).scene.nodes.map((node) => node.id),
    );
    expect(nativeSlide(expectedApplied).speakerNotes).toBe(fixture.visible.speakerNotes);
    expect(nativeSlide(expectedApplied).citations).toEqual(fixture.visible.citations);
    const originalBody = nativeSlide(initial).scene.nodes.find(
      (node) => node.id === fixture.bodyId,
    );
    expect(
      nativeSlide(expectedApplied).scene.nodes.find((node) => node.id === fixture.bodyId),
    ).toEqual({
      ...originalBody,
      frame: { x: 7, y: 33, width: 86, height: 59 },
    });
    await expectDesign(page.locator("[data-native-scene]"));
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("design-editor.png"), fullPage: true });
    if (narrow) await closeE01Overlays(page);
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect(page.locator("#presentation-slide-navigator")).toBeHidden();
    await expect(page.locator("#presentation-object-inspector")).toBeHidden();
    await expect
      .poll(async () => (await page.locator("[data-native-scene]").boundingBox())?.width ?? 0)
      .toBeGreaterThan((page.viewportSize()?.width ?? 1280) * 0.75);
    await expectDesign(page.locator("[data-native-scene]"));
    await expectRichText(page.locator("[data-native-scene]"), fixture.bodyId);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("design-editor-dark-200-percent.png"),
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /^Saved$/ })
        .first(),
    ).toBeVisible();
    await page.reload();
    if (narrow) {
      await closeE01Overlays(page);
    }
    await openE01Inspector(page, "Layout");
    await expect(page.getByRole("combobox", { name: "Slide theme", exact: true })).toHaveValue(
      "midnight",
    );
    await expect(page.getByRole("combobox", { name: "Slide font", exact: true })).toHaveValue(
      "serif",
    );
    await expect(page.getByRole("combobox", { name: "Slide spacing", exact: true })).toHaveValue(
      "compact",
    );
    expect((await readE01Record(page, record.id)).draft).toEqual(expectedApplied);
    if (narrow) await closeE01Overlays(page);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
    await expectDesign(preview.locator("[data-native-scene]"));
    await expectRichText(preview.locator("[data-native-scene]"), fixture.bodyId);
    expect(await preview.innerText()).not.toMatch(/HIDDEN|PRIVATE/);
    await preview.getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      preview.getByRole("heading", { name: "Ordinary follow-up", exact: true }),
    ).toBeVisible();
    await expect(preview.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    const publishing = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${record.id}/publish`,
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const published = await publishing;
    expect(published.status()).toBe(200);
    const version = (await published.json()).version;
    expect(version.content.schemaVersion).toBe(7);
    expect(version.content.blocks.map((block: { id: string }) => block.id)).toEqual([
      fixture.visible.id,
      fixture.ordinary.id,
    ]);
    expect(version.content.blocks[0].scene).toEqual(nativeSlide(expectedApplied).scene);
    expect(version.content.blocks[1]).toEqual(initial.blocks[2]);
    expect(JSON.stringify(version.content)).not.toContain("HIDDEN");
    const hosted = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
      data: { presentationId: record.id },
    });
    expect(hosted.status()).toBe(201);
    const { snapshot: lobby, controlToken } = await hosted.json();
    const sessionId = lobby.sessionId as string;
    await page.evaluate(
      ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
      { id: sessionId, token: controlToken },
    );
    await page.goto(`/presentation-session/${sessionId}/host`);
    const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
    const guestContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      reducedMotion: "reduce",
      colorScheme: "dark",
    });
    const guest = await guestContext.newPage();
    try {
      await guest.goto(`/join?code=${lobby.code}`);
      await guest.getByLabel("Nickname", { exact: true }).fill("Design audience");
      await guest.getByRole("button", { name: "Join a Presentation", exact: true }).click();
      await expect(guest).toHaveURL(`/presentation-session/${sessionId}/play`);
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      const stage = guest.locator("[data-native-scene]");
      await expectDesign(stage);
      await expectRichText(stage, fixture.bodyId);
      await expect(stage.locator("button")).toHaveCount(0);
      const snapshot = await participantSnapshot(guest, sessionId);
      expect(snapshot.currentBlock).toMatchObject({
        id: fixture.visible.id,
        scene: nativeSlide(expectedApplied).scene,
      });
      expect(snapshot.currentBlock).not.toHaveProperty("speakerNotes");
      expect(snapshot.currentBlock).not.toHaveProperty("citations");
      expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE|HIDDEN/);
      expect(await guest.locator("body").innerText()).not.toMatch(/PRIVATE|HIDDEN/);
      await expectNoHorizontalOverflow(guest);
      await guest.screenshot({ path: testInfo.outputPath("design-audience.png"), fullPage: true });
      const latest = await readE01Record(page, record.id);
      const changed = structuredClone(latest.draft);
      nativeSlide(changed).scene.design = { ...design, theme: "ocean" };
      const saved = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
        data: {
          draft: changed,
          expectedRevision: latest.draftRevision,
          mutationId: randomUUID(),
          schemaVersion: 2,
        },
      });
      expect(saved.status(), await saved.text()).toBe(200);
      expect(nativeSlide((await readE01Record(page, record.id)).draft).scene.design?.theme).toBe(
        "ocean",
      );
      await guest.reload();
      await expectDesign(guest.locator("[data-native-scene]"));
      await expectRichText(guest.locator("[data-native-scene]"), fixture.bodyId);
      expect((await participantSnapshot(guest, sessionId)).currentBlock).toEqual(
        snapshot.currentBlock,
      );
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(
        guest.getByRole("heading", { name: "Ordinary follow-up", exact: true }),
      ).toBeVisible();
      await expect(guest.locator("[data-native-scene]")).toHaveCount(0);
      expect(await guest.locator("body").innerText()).not.toMatch(/PRIVATE|HIDDEN/);
      await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
      await expect(
        guest.getByRole("heading", { name: "Thanks for participating", exact: true }),
      ).toBeVisible();
    } finally {
      await guestContext.close();
    }
  });
}

test("native arrangement aligns, distributes and layers without changing reading order or IDs", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInBeta(page);
  const slide = e01Slide("Arrangement evidence");
  slide.scene!.nodes = [
    slide.scene!.nodes[0]!,
    ...[
      {
        id: "arrange-first",
        text: "First evidence",
        frame: { x: 10, y: 35, width: 20, height: 15 },
      },
      {
        id: "arrange-middle",
        text: "Middle evidence",
        frame: { x: 37, y: 45, width: 20, height: 15 },
      },
      { id: "arrange-last", text: "Last evidence", frame: { x: 70, y: 55, width: 20, height: 15 } },
    ].map((node) => ({ ...node, type: "text" as const, role: "body" as const })),
  ];
  slide.scene!.readingOrder = slide.scene!.nodes.map((node) => node.id);
  const record = await createE01Deck(page, [slide], 4);
  const original = nativeSlide(record.draft).scene;
  await enterE01Editor(page, record.id, false);
  await openE01Inspector(page, "Access");
  const objects = page.getByRole("group", { name: "Slide objects · reading order", exact: true });
  await objects.getByRole("button", { name: "2. First evidence", exact: true }).click();
  await objects
    .getByRole("checkbox", { name: "Include Middle evidence in selection", exact: true })
    .check();
  await objects
    .getByRole("checkbox", { name: "Include Last evidence in selection", exact: true })
    .check();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^3 objects selected$/ })
      .first(),
  ).toBeVisible();
  await openE01Inspector(page, "Layout");
  await page.getByRole("button", { name: "Align top", exact: true }).click();
  await expect
    .poll(async () => {
      const scene = nativeSlide((await readE01Record(page, record.id)).draft).scene;
      return ["arrange-first", "arrange-middle", "arrange-last"].map((id) => frame(scene, id).y);
    })
    .toEqual([35, 35, 35]);
  const aligned = nativeSlide((await readE01Record(page, record.id)).draft).scene;
  await page.getByRole("button", { name: "Distribute horizontally", exact: true }).click();
  await expect
    .poll(
      async () =>
        frame(nativeSlide((await readE01Record(page, record.id)).draft).scene, "arrange-middle").x,
    )
    .toBe(40);
  const distributed = nativeSlide((await readE01Record(page, record.id)).draft).scene;
  expect(frame(distributed, "arrange-first")).toEqual(frame(aligned, "arrange-first"));
  expect(frame(distributed, "arrange-last")).toEqual(frame(aligned, "arrange-last"));
  await page.getByRole("button", { name: "Send object to back", exact: true }).click();
  await expect
    .poll(async () =>
      nativeSlide((await readE01Record(page, record.id)).draft).scene.nodes.map((node) => node.id),
    )
    .toEqual(["arrange-last", original.nodes[0]!.id, "arrange-first", "arrange-middle"]);
  const layered = nativeSlide((await readE01Record(page, record.id)).draft).scene;
  expect(layered.readingOrder).toEqual(original.readingOrder);
  for (const node of distributed.nodes)
    expect(layered.nodes.find((item) => item.id === node.id)).toEqual(node);
  await expect(page.locator("[data-native-scene] [data-node-id]")).toHaveCount(4);
  expect(
    await page
      .locator("[data-native-scene] [data-node-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-node-id"))),
  ).toEqual(original.readingOrder);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("design-arrangement.png"), fullPage: true });
  for (const scene of [distributed, aligned, original]) {
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () => nativeSlide((await readE01Record(page, record.id)).draft).scene)
      .toEqual(scene);
  }
});
