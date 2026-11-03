import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  PresentationDraftSchema,
  type ContentSlideDraft,
  type PresentationDraft,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
test.use({ actionTimeout: 30_000 });

async function savedDraft(page: Page, id: string): Promise<PresentationDraft> {
  const response = await page.request.get(`${apiUrl}/v1/presentations/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()).presentation.draft;
}

test("retains a scanned native image when history fills its original slide during upload", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInBeta(page);
  const title = `Native upload race ${randomUUID().slice(0, 8)}`;
  function slide(count: number, slideTitle: string): ContentSlideDraft {
    const nodes = Array.from({ length: count }, (_, index) => ({
      id: randomUUID(),
      type: "text" as const,
      role: index === 0 ? ("title" as const) : ("body" as const),
      text: index === 0 ? slideTitle : `Object ${index}`,
      frame: { x: 8, y: 8, width: 84, height: 20 },
    }));
    return {
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
        readingOrder: nodes.map((node) => node.id),
      },
    };
  }
  const target = slide(49, "Original upload slide");
  const other = slide(1, "Other slide");
  const created = await page.request.post(`${apiUrl}/v1/presentations`, { data: { title } });
  expect(created.status()).toBe(201);
  let record = (await created.json()).presentation;
  record = {
    ...record,
    draft: PresentationDraftSchema.parse({
      ...record.draft,
      schemaVersion: 4,
      blocks: [target, other],
    }),
  };
  const mediaId = randomUUID();
  const uploadUrl = new URL("/native-race-upload", page.url()).href;
  const imageUrl = new URL("/native-race-image.png", page.url()).href;
  let uploadTickets = 0;
  let uploadRequests = 0;
  let scanRequests = 0;
  let releaseUpload!: () => void;
  let releaseScan!: () => void;
  const uploading = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const scanning = new Promise<void>((resolve) => {
    releaseScan = resolve;
  });
  const imageBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  // Control storage/scanner timing and draft persistence for this client race only.
  // The normal native authoring/delivery journeys below use the real draft APIs.
  await page.route(`${apiUrl}/v1/features`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), mediaUploads: true } });
  });
  await page.route(`${apiUrl}/v1/presentations/${record.id}`, (route) =>
    route.fulfill({ json: { presentation: record } }),
  );
  await page.route(`${apiUrl}/v1/presentations/${record.id}/draft`, async (route) => {
    const draft = PresentationDraftSchema.parse(route.request().postDataJSON().draft);
    record = { ...record, draft, draftRevision: record.draftRevision + 1 };
    await route.fulfill({ json: { presentation: record } });
  });
  await page.route(`${apiUrl}/v1/media`, (route) => {
    uploadTickets += 1;
    return route.fulfill({ json: { mediaId, uploadUrl, scanStatus: "pending" } });
  });
  await page.route(uploadUrl, async (route) => {
    uploadRequests += 1;
    await uploading;
    await route.fulfill({ status: 204 });
  });
  await page.route(`${apiUrl}/v1/media/${mediaId}/complete`, async (route) => {
    scanRequests += 1;
    await scanning;
    await route.fulfill({
      json: { media: { id: mediaId, scanStatus: "clean" }, downloadUrl: imageUrl },
    });
  });
  await page.route(`${apiUrl}/v1/media/${mediaId}`, (route) =>
    route.fulfill({ json: { downloadUrl: imageUrl } }),
  );
  await page.route(imageUrl, (route) =>
    route.fulfill({ contentType: "image/png", body: imageBytes }),
  );
  const targetNodes = () => {
    const block = (record.draft as PresentationDraft).blocks.find(
      (block) => block.id === target.id,
    );
    return block?.kind === "content" ? block.scene!.nodes : [];
  };
  try {
    await page.goto(`/presentation/${record.id}`);
    await page.getByRole("button", { name: "Add native shape", exact: true }).click();
    await page.getByLabel("Shape label", { exact: true }).fill("Capacity marker");
    await page.getByRole("button", { name: "Delete object", exact: true }).click();
    await expect.poll(() => targetNodes().length).toBe(49);
    await page
      .getByLabel("New image description", { exact: true })
      .fill("Uploaded reference image");
    await page.getByLabel("Add native image", { exact: true }).setInputFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: imageBytes,
    });
    await expect.poll(() => uploadRequests).toBe(1);
    for (const name of ["Add native text", "Add native shape", "Add native connector"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
    }
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => targetNodes().length).toBe(50);
    releaseUpload();
    await expect.poll(() => scanRequests).toBe(1);
    await page
      .getByRole("complementary", { name: "Presentation map", exact: true })
      .getByRole("button", { name: /Other slide/ })
      .click();
    for (const name of ["Add native text", "Add native shape", "Add native connector"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
    }
    releaseScan();
    const pending = page.getByRole("status", { name: "Uploaded image attachment", exact: true });
    await expect(pending).toContainText("waiting for space on its original slide");
    expect(targetNodes().filter((node) => node.type === "image")).toEqual([]);
    await expect(page.getByLabel("Native slide title", { exact: true })).toBeEnabled();
    await expect(page.getByLabel("Add native image", { exact: true })).toBeDisabled();
    // Redo the removal while viewing a different slide. Reuse the completed scan.
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(() => targetNodes().filter((node) => node.type === "image").length).toBe(1);
    await expect(pending).toHaveCount(0);
    expect(targetNodes()).toHaveLength(50);
    expect(targetNodes().find((node) => node.type === "image")).toMatchObject({
      mediaId,
      altText: "Uploaded reference image",
    });
    const otherBlock = (record.draft as PresentationDraft).blocks.find(
      (block) => block.id === other.id,
    );
    expect(otherBlock?.kind === "content" ? otherBlock.scene?.nodes : []).toHaveLength(1);
    expect({ uploadTickets, uploadRequests, scanRequests }).toEqual({
      uploadTickets: 1,
      uploadRequests: 1,
      scanRequests: 1,
    });
    await page
      .getByRole("complementary", { name: "Presentation map", exact: true })
      .getByRole("button", { name: /Original upload slide/ })
      .click();
    await expect(
      page.getByRole("img", { name: "Uploaded reference image", exact: true }),
    ).toBeVisible();
  } finally {
    releaseUpload();
    releaseScan();
  }
});

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
