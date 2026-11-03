import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { PresentationDraft } from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
test.use({ actionTimeout: 30_000 });

async function savedDraft(page: Page, id: string): Promise<PresentationDraft> {
  const response = await page.request.get(`${apiUrl}/v1/presentations/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()).presentation.draft;
}

async function overlayHitTest(control: Locator, sceneNode: Locator) {
  const nodeBounds = await sceneNode.boundingBox();
  return control.evaluate((element, node) => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    const target = document.elementFromPoint(x, y);
    return {
      overlapsSceneNode: Boolean(
        node && x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height,
      ),
      receivesPointer: element === target || element.contains(target),
    };
  }, nodeBounds);
}

test("dense native slides keep mobile map and inspector controls above their nodes @mobile", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInBeta(page);
  const title = `Dense native overlay ${randomUUID().slice(0, 8)}`;
  const nodes = Array.from({ length: 31 }, (_, index) => ({
    id: `dense-node-${index}`,
    type: "text" as const,
    role: index === 0 ? ("title" as const) : ("body" as const),
    text:
      index === 0 ? title : index === 30 ? "Dense slide content\n".repeat(40) : `Object ${index}`,
    frame: { x: 8, y: 8, width: 84, height: 20 },
  }));
  const highNode = nodes[30]!;
  const created = await page.request.post(`${apiUrl}/v1/presentations`, { data: { title } });
  expect(created.status()).toBe(201);
  const presentation = (await created.json()).presentation;
  const saved = await page.request.put(`${apiUrl}/v1/presentations/${presentation.id}/draft`, {
    data: {
      draft: {
        ...presentation.draft,
        schemaVersion: 4,
        blocks: [
          {
            id: randomUUID(),
            kind: "content",
            layout: "title_body",
            textElements: [],
            mediaId: null,
            mediaAlt: null,
            speakerNotes: "",
            scene: {
              schemaVersion: 1,
              aspectRatio: "16:9",
              nodes,
              // Put the high visual layer in view without changing its stored stacking position.
              readingOrder: [highNode.id, ...nodes.slice(0, 30).map((node) => node.id)],
            },
          },
        ],
      },
      expectedRevision: presentation.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(saved.status()).toBe(200);
  await page.goto(`/presentation/${presentation.id}`);
  const layeredText = page.locator(`[data-native-scene] [data-node-id="${highNode.id}"]`);
  await expect(layeredText).toHaveCSS("z-index", "31");
  await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
  const slide = page
    .getByRole("complementary", { name: "Presentation map", exact: true })
    .getByRole("button", { name: new RegExp(title) });
  await expect
    .poll(
      () => overlayHitTest(slide, layeredText),
      "Map controls stay above overlapping scene nodes",
    )
    .toEqual({ overlapsSceneNode: true, receivesPointer: true });
  await slide.click();
  await page.getByRole("button", { name: "Collapse map", exact: true }).click();
  await page.getByRole("button", { name: "Open inspector", exact: true }).click();
  const notes = page.getByLabel("Speaker notes", { exact: true });
  await expect
    .poll(
      () => overlayHitTest(notes, layeredText),
      "Inspector controls stay above overlapping scene nodes",
    )
    .toEqual({ overlapsSceneNode: true, receivesPointer: true });
  await notes.click();
  await expect(notes).toBeFocused();
  await notes.pressSequentially("Overlay controls remain accessible");
  await expect
    .poll(async () => {
      const block = (await savedDraft(page, presentation.id)).blocks[0];
      return block?.kind === "content" ? block.speakerNotes : "";
    })
    .toBe("Overlay controls remain accessible");
});

for (const suffix of ["", " @mobile"]) {
  test(`native slides create, recover, publish and present through real services${suffix}`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const identifier = randomUUID().slice(0, 8);
    const title = `Native project update ${identifier}`;
    const firstTitle = "Project decision";
    const secondTitle = "Agreed next step";
    const body = "Choose an owner and review the result next week.";
    const privateNote = `Private native facilitation cue ${identifier}`;
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 920;
    const created = await page.request.post(`${apiUrl}/v1/presentations`, {
      data: { title, description: "A synthetic native scene authoring journey." },
    });
    expect(created.status()).toBe(201);
    const presentation = (await created.json()).presentation;
    const cleared = await page.request.put(`${apiUrl}/v1/presentations/${presentation.id}/draft`, {
      data: {
        draft: { ...presentation.draft, blocks: [] },
        expectedRevision: presentation.draftRevision,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(cleared.status()).toBe(200);
    await page.goto(`/presentation/${presentation.id}`);
    // On phones, the existing map and inspector are overlays. Open one at a time.
    if (narrow) await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
    await page.getByRole("button", { name: "Add native slide", exact: true }).click();
    if (narrow) await page.getByRole("button", { name: "Collapse map", exact: true }).click();
    await page.getByLabel("Native slide title", { exact: true }).fill(firstTitle);
    await page.getByRole("button", { name: "Add native text", exact: true }).click();
    await page.getByLabel("Node text", { exact: true }).fill(body);
    await page.getByRole("button", { name: "Add native shape", exact: true }).click();
    await page.getByLabel("Shape label", { exact: true }).fill("Decision owner");
    await page.getByLabel("Object width (%)", { exact: true }).fill("24");
    await page.getByLabel("Object height (%)", { exact: true }).fill("18");
    await page.getByLabel("Object x (%)", { exact: true }).fill("64");
    await page.getByLabel("Object y (%)", { exact: true }).fill("60");
    await page
      .getByRole("button", { name: "Move Decision owner. Use arrow keys to nudge.", exact: true })
      .press("ArrowRight");
    await expect(page.getByLabel("Object x (%)", { exact: true })).toHaveValue("65");
    await page.getByRole("button", { name: "Add native connector", exact: true }).click();
    await page.getByLabel("Connector label", { exact: true }).fill("Decision path");
    await page
      .getByRole("combobox", { name: "Connect to", exact: true })
      .selectOption({ label: "Decision owner" }, { timeout: 10_000 });
    await page.getByRole("button", { name: "Read object earlier", exact: true }).click();
    if (narrow) await page.getByRole("button", { name: "Open inspector", exact: true }).click();
    await page.getByLabel("Speaker notes", { exact: true }).fill(privateNote);
    if (narrow) await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
    await expect
      .poll(async () => {
        const draft = await savedDraft(page, presentation.id);
        const block = draft.blocks[0];
        return block?.kind === "content" ? block.scene?.nodes.length : 0;
      })
      .toBe(4);
    await expect
      .poll(async () => {
        const block = (await savedDraft(page, presentation.id)).blocks[0];
        return block?.kind === "content" ? block.speakerNotes : "";
      })
      .toBe(privateNote);
    const originalDraft = await savedDraft(page, presentation.id);
    const original = originalDraft.blocks[0];
    if (original?.kind !== "content" || !original.scene) throw new Error("Expected native slide");
    expect(originalDraft.schemaVersion).toBe(4);
    expect(original.textElements).toEqual([]);
    expect(original.mediaId).toBeNull();
    const shape = original.scene.nodes.find((node) => node.type === "shape")!;
    const connector = original.scene.nodes.find((node) => node.type === "connector")!;
    expect(shape).toMatchObject({ frame: { x: 65, y: 60, width: 24, height: 18 } });
    expect(original.scene.readingOrder.indexOf(connector.id)).toBeLessThan(
      original.scene.readingOrder.indexOf(shape.id),
    );

    await page.reload();
    if (narrow) {
      await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
      await page.getByRole("button", { name: "Collapse map", exact: true }).click();
    }
    await expect(page.getByLabel("Native slide title", { exact: true })).toHaveValue(firstTitle);
    await expect(page.getByRole("heading", { name: firstTitle, exact: true })).toHaveCSS(
      "text-align",
      "left",
    );
    await expect(page.getByRole("img", { name: "Decision owner", exact: true })).toBeVisible();
    await expect(page.getByLabel("Speaker notes", { exact: true })).toHaveValue(privateNote);
    await page.screenshot({ path: testInfo.outputPath("native-editor.png"), fullPage: true });
    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    await page.getByLabel("Native slide title", { exact: true }).fill(secondTitle);
    await expect
      .poll(async () => {
        const block = (await savedDraft(page, presentation.id)).blocks[1];
        return block?.kind === "content"
          ? block.scene?.nodes.find((node) => node.type === "text" && node.role === "title")?.text
          : "";
      })
      .toBe(secondTitle);
    const copied = (await savedDraft(page, presentation.id)).blocks[1];
    if (copied?.kind !== "content" || !copied.scene) throw new Error("Expected native copy");
    const originalIds = new Set(original.scene.nodes.map((node) => node.id));
    expect(copied.scene.nodes.every((node) => !originalIds.has(node.id))).toBe(true);
    const copiedIds = new Set(copied.scene.nodes.map((node) => node.id));
    for (const node of copied.scene.nodes) {
      if (node.type === "connector") {
        expect(copiedIds.has(node.from.nodeId)).toBe(true);
        expect(copiedIds.has(node.to.nodeId)).toBe(true);
      }
    }
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByLabel("Native slide title", { exact: true })).toHaveValue(firstTitle);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.getByLabel("Native slide title", { exact: true })).toHaveValue(secondTitle);
    const publishing = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${presentation.id}/publish`,
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    expect((await publishing).status()).toBe(200);

    const hosted = await page.request.post(`${apiUrl}/v1/presentation-sessions`, {
      data: { presentationId: presentation.id },
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
    });
    const guest = await guestContext.newPage();
    try {
      await guest.goto(`/join?code=${lobby.code}`);
      await guest.getByLabel("Nickname", { exact: true }).fill("Native deck attendee");
      await guest.getByRole("button", { name: "Join a Presentation", exact: true }).click();
      await expect(guest).toHaveURL(`/presentation-session/${sessionId}/play`);
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      await expect(guest.getByRole("heading", { name: firstTitle, exact: true })).toBeVisible();
      await expect(guest.getByRole("heading", { name: firstTitle, exact: true })).toHaveCSS(
        "text-align",
        "left",
      );
      await expect(guest.getByText(body, { exact: true })).toBeVisible();
      await expect(guest.getByRole("img", { name: "Decision owner", exact: true })).toBeVisible();
      await guest.screenshot({ path: testInfo.outputPath("native-audience.png"), fullPage: true });
      const token = await guest.evaluate(
        (id) => sessionStorage.getItem(`openround:presentation-participant:${id}`),
        sessionId,
      );
      const snapshotResponse = await guest.request.get(
        `${apiUrl}/v1/presentation-sessions/${sessionId}/participant`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(snapshotResponse.status()).toBe(200);
      const { snapshot } = await snapshotResponse.json();
      expect(snapshot.currentBlock.scene).toEqual(original.scene);
      expect(snapshot.currentBlock).not.toHaveProperty("speakerNotes");
      expect(snapshot.standing).toBeNull();
      expect(JSON.stringify(snapshot)).not.toContain(privateNote);
      expect(await guest.content()).not.toContain(privateNote);
      await page.reload();
      await guest.reload();
      await expect(guest.getByRole("heading", { name: firstTitle, exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(guest.getByRole("heading", { name: secondTitle, exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
      await expect(guest.getByRole("heading", { name: "Thanks for participating" })).toBeVisible();
      expect(await guest.locator("body").innerText()).not.toMatch(/\b(?:rank|points)\b/i);
      await page.getByRole("link", { name: "Open session report", exact: true }).click();
      await expect(page.getByRole("heading", { name: firstTitle, exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: secondTitle, exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Facilitation timeline" })).toBeVisible();
      await expect(page.getByText("Leaderboard", { exact: true })).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });
}
