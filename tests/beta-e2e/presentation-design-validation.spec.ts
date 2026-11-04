import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  PRESENTATION_SCENE_MAX_BYTES,
  PresentationDraftSchema,
  PresentationSceneDraftSchema,
  type ContentSlideDraft,
  type PresentationScene,
  type PresentationSceneNode,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import {
  createE01Deck,
  e01ApiUrl,
  enterE01Editor,
  readE01Record,
  type E01Record,
} from "./presentation-e01-support";

test.use({ actionTimeout: 30_000 });

const reducedText = "Reduced content leaves room for this change.";
const firstBodyId = "budget-body-01";
const designError =
  "This design change exceeds the slide’s limits. Shorten some text or remove an object, then try again.";
const imageError =
  "This image change exceeds the slide’s limits. Shorten some text or remove an object, then try again.";

function byteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function scene(record: E01Record): PresentationScene {
  const block = record.draft.blocks[0];
  if (block?.kind !== "content" || !block.scene) throw new Error("Expected a native slide");
  return block.scene;
}

function body(record: E01Record) {
  const node = scene(record).nodes.find((node) => node.id === firstBodyId);
  if (node?.type !== "text") throw new Error("Expected the reducible text object");
  return node;
}

function image(record: E01Record) {
  const node = scene(record).nodes.find((node) => node.type === "image");
  if (node?.type !== "image") throw new Error("Expected the synthetic image object");
  return node;
}

function budgetSlide(mode: "design" | "image-fit" | "image-focal"): ContentSlideDraft {
  const nodes: PresentationSceneNode[] = [
    {
      id: "budget-title",
      type: "text",
      role: "title",
      text: "Slide limit recovery",
      frame: { x: 7, y: 7, width: 86, height: 20 },
    },
    ...Array.from({ length: 34 }, (_, index) => ({
      id: `budget-body-${String(index + 1).padStart(2, "0")}`,
      type: "text" as const,
      role: "body" as const,
      text: `${index === 0 ? "Reduce this object" : "Budget content"} ${String(index + 1).padStart(2, "0")} `,
      frame: { x: 7, y: 33, width: 86, height: 59 },
    })),
  ];
  if (mode !== "design") {
    nodes.push({
      id: "budget-image",
      type: "image",
      mediaId: randomUUID(),
      altText: "Synthetic budget image",
      frame: { x: 53, y: 33, width: 40, height: 59 },
      ...(mode === "image-focal" ? { fit: "cover" as const, focalPoint: { x: 0, y: 0 } } : {}),
    });
  }
  const native: PresentationScene = {
    schemaVersion: mode === "image-focal" ? 3 : 1,
    aspectRatio: "16:9",
    nodes,
    readingOrder: nodes.map((node) => node.id),
  };
  let remaining = PRESENTATION_SCENE_MAX_BYTES - 1 - byteLength(native);
  for (const node of native.nodes) {
    if (node.type !== "text" || node.role !== "body") continue;
    const added = Math.min(4_000 - node.text.length, remaining);
    node.text += "x".repeat(added);
    remaining -= added;
  }
  expect(remaining).toBe(0);
  const parsed = PresentationSceneDraftSchema.parse(native);
  expect(byteLength(parsed)).toBe(131_071);
  return {
    id: randomUUID(),
    kind: "content",
    layout: "title_body",
    textElements: [],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "PRIVATE budget fixture cue",
    citations: [{ locator: "Budget fixture", excerpt: "Keep source metadata." }],
    scene: parsed,
  };
}

function observeFailures(page: Page, presentationId: string) {
  const pageErrors: string[] = [];
  const saves: string[] = [];
  const isDraftSave = (request: { method(): string; url(): string }) =>
    request.method() === "PUT" &&
    new URL(request.url()).pathname === `/v1/presentations/${presentationId}/draft`;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (isDraftSave(request)) saves.push(request.postData() ?? "");
  });
  return {
    pageErrors,
    saves,
    // The builder debounces saves for 700 ms. Observe beyond that window so an invalid
    // mutation cannot pass merely because its network request has not started yet.
    expectNoSave: () =>
      page.waitForRequest(isDraftSave, { timeout: 1_200 }).then(
        () => true,
        () => false,
      ),
  };
}

async function expectSceneIds(page: Page, original: PresentationScene) {
  expect(
    await page
      .locator("[data-native-scene] [data-node-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-node-id"))),
  ).toEqual(original.readingOrder);
}

async function shortenObject(page: Page) {
  await page
    .getByRole("group", { name: "Slide objects · reading order", exact: true })
    .getByRole("button", { name: /^2\. Reduce this object 01 / })
    .click();
  await page.getByLabel("Node text", { exact: true }).fill(reducedText);
}

test("a slide design over the byte limit shows recovery guidance and preserves the real saved draft", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInBeta(page);
  const record = await createE01Deck(page, [budgetSlide("design")], 4);
  const original = structuredClone(record.draft);
  expect(byteLength(scene(record))).toBe(131_071);
  await enterE01Editor(page, record.id, false);
  const observed = observeFailures(page, record.id);
  const attemptedSave = observed.expectNoSave();
  await page.getByRole("button", { name: "Enable slide design", exact: true }).click();
  const alert = page.getByRole("alert").filter({ hasText: designError });
  await expect(alert).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Slide theme", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  expect(await attemptedSave).toBe(false);
  expect(observed.saves).toEqual([]);
  expect(observed.pageErrors).toEqual([]);
  const unchanged = await readE01Record(page, record.id);
  expect(unchanged.draftRevision).toBe(record.draftRevision);
  expect(unchanged.draft).toEqual(original);
  await expectSceneIds(page, scene(record));
  await shortenObject(page);
  await expect.poll(async () => body(await readE01Record(page, record.id)).text).toBe(reducedText);
  const reduced = (await readE01Record(page, record.id)).draft;
  expect(reduced.schemaVersion).toBe(4);
  await page.getByRole("button", { name: "Enable slide design", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Slide theme", exact: true })).toHaveValue(
    "paper",
  );
  await expect.poll(async () => (await readE01Record(page, record.id)).draft.schemaVersion).toBe(7);
  const saved = await readE01Record(page, record.id);
  const expectedScene = {
    ...scene({ ...record, draft: reduced }),
    schemaVersion: 3,
    design: { theme: "paper", font: "sans", spacing: "relaxed" },
  };
  expect(scene(saved)).toEqual(expectedScene);
  expect(scene(saved).nodes.map((node) => node.id)).toEqual(
    scene(record).nodes.map((node) => node.id),
  );
  expect(scene(saved).readingOrder).toEqual(scene(record).readingOrder);
  expect(saved.draft).toEqual({
    ...reduced,
    schemaVersion: 7,
    blocks: [{ ...reduced.blocks[0], scene: expectedScene }],
  });
  await expect(alert).toHaveCount(0);
  expect(observed.pageErrors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("slide-design-budget-recovered.png"),
    fullPage: true,
  });
});

async function syntheticImageDeck(page: Page, mode: "image-fit" | "image-focal") {
  const created = await page.request.post(`${e01ApiUrl}/v1/presentations`, {
    data: { title: `Synthetic image limit ${randomUUID().slice(0, 8)}` },
  });
  expect(created.status()).toBe(201);
  let record = (await created.json()).presentation as E01Record & Record<string, unknown>;
  record = {
    ...record,
    draft: PresentationDraftSchema.parse({
      ...record.draft,
      schemaVersion: mode === "image-focal" ? 7 : 4,
      blocks: [budgetSlide(mode)],
    }),
    draftSchemaVersion: mode === "image-focal" ? 7 : 4,
    hasUnpublishedChanges: true,
  };
  const mediaId = image(record).mediaId;
  const imageUrl = new URL(`/budget-image-fixture-${mediaId}.png`, page.url()).href;
  const imageBytes = await readFile("apps/web/public/brand/polling-pops-social.png");
  // The synthetic cases exercise actual image event handlers and rendering, with fixtures
  // scoped to this deck and image. They do not publish or claim real asset ownership.
  await page.route(`${e01ApiUrl}/v1/presentations/${record.id}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ json: { presentation: record } });
  });
  await page.route(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const envelope = route.request().postDataJSON();
    expect(envelope.expectedRevision).toBe(record.draftRevision);
    expect(envelope.schemaVersion).toBe(2);
    const draft = PresentationDraftSchema.parse(envelope.draft);
    record = {
      ...record,
      draft,
      draftRevision: record.draftRevision + 1,
      draftSchemaVersion: draft.schemaVersion,
    };
    await route.fulfill({ json: { presentation: record } });
  });
  await page.route(`${e01ApiUrl}/v1/media/${mediaId}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ json: { downloadUrl: imageUrl } });
  });
  await page.route(imageUrl, (route) =>
    route.fulfill({ contentType: "image/png", body: imageBytes }),
  );
  return { read: () => record };
}

for (const mode of ["image-fit", "image-focal"] as const) {
  test(`synthetic ${mode} UI reports a byte limit without saving and accepts a retry after reducing content`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const fixture = await syntheticImageDeck(page, mode);
    const original = structuredClone(fixture.read());
    await enterE01Editor(page, original.id, false);
    const observed = observeFailures(page, original.id);
    const selectImage = () =>
      page
        .getByRole("group", { name: "Slide objects · reading order", exact: true })
        .getByRole("button", { name: "36. Synthetic budget image", exact: true })
        .click();
    await selectImage();
    const changeImage = () =>
      mode === "image-fit"
        ? page.getByRole("combobox", { name: "Image fit", exact: true }).selectOption("cover")
        : page.getByRole("spinbutton", { name: "Image focal X (%)", exact: true }).fill("100");
    const attemptedSave = observed.expectNoSave();
    await changeImage();
    const alert = page.getByRole("alert").filter({ hasText: imageError });
    await expect(alert).toBeVisible();
    if (mode === "image-fit")
      await expect(page.getByRole("combobox", { name: "Image fit", exact: true })).toHaveValue(
        "contain",
      );
    else
      await expect(
        page.getByRole("spinbutton", { name: "Image focal X (%)", exact: true }),
      ).toHaveValue("0");
    expect(await attemptedSave).toBe(false);
    expect(observed.saves).toEqual([]);
    expect(observed.pageErrors).toEqual([]);
    expect(fixture.read()).toEqual(original);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await expectSceneIds(page, scene(original));
    await shortenObject(page);
    await expect.poll(() => body(fixture.read()).text).toBe(reducedText);
    const reduced = structuredClone(fixture.read());
    await selectImage();
    await changeImage();
    await expect.poll(() => fixture.read().draft.schemaVersion).toBe(7);
    await expect
      .poll(() => image(fixture.read()).focalPoint)
      .toEqual(mode === "image-fit" ? { x: 50, y: 50 } : { x: 100, y: 0 });
    const saved = fixture.read();
    expect(scene(saved).schemaVersion).toBe(3);
    expect(image(saved).fit).toBe("cover");
    expect(image(saved)).toEqual({
      ...image(reduced),
      fit: "cover",
      focalPoint: mode === "image-fit" ? { x: 50, y: 50 } : { x: 100, y: 0 },
    });
    expect(scene(saved).nodes.map((node) => node.id)).toEqual(
      scene(original).nodes.map((node) => node.id),
    );
    expect(scene(saved).readingOrder).toEqual(scene(original).readingOrder);
    expect(saved.draft).toEqual({
      ...reduced.draft,
      schemaVersion: 7,
      blocks: [
        {
          ...reduced.draft.blocks[0],
          scene: {
            ...scene(reduced),
            schemaVersion: 3,
            nodes: scene(reduced).nodes.map((node) =>
              node.type === "image" ? image(saved) : node,
            ),
          },
        },
      ],
    });
    await expect(alert).toHaveCount(0);
    expect(observed.pageErrors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`${mode}-budget-recovered.png`),
      fullPage: true,
    });
  });
}
