import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { CANVAS_SCHEMA_VERSION } from "../../packages/contracts/src/canvas-boards";
import { expect, test, type Page } from "@playwright/test";
import { api, fits, organization, web } from "./support";

async function source(page: Page, workspaceId: string) {
  const created = await page.request.post(`${api}/v1/canvas-boards`, {
    data: {
      schemaVersion: CANVAS_SCHEMA_VERSION,
      operationId: randomUUID(),
      workspaceId,
      title: "Creator checkpoint source",
      boardType: "team",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const boardId = (await created.json()).board.id as string;
  const body = "Synthetic private canvas checkpoint — 承認";
  const inserted = await page.request.post(`${api}/v1/canvas-boards/${boardId}/commands`, {
    data: {
      schemaVersion: CANVAS_SCHEMA_VERSION,
      operationId: randomUUID(),
      command: {
        type: "batch",
        operations: [
          {
            type: "create",
            object: {
              id: randomUUID(),
              type: "sticky",
              x: 80,
              y: 80,
              width: 280,
              height: 180,
              text: body,
            },
          },
        ],
      },
    },
  });
  expect(inserted.status(), await inserted.text()).toBe(200);
  const versionId = randomUUID(),
    name = "Saved manual plan";
  const saved = await page.request.post(
    `${api}/v1/canvas-boards/${boardId}/facilitation/commands`,
    {
      data: {
        schemaVersion: 1,
        operationId: randomUUID(),
        command: { type: "version_create", versionId, name },
      },
    },
  );
  expect(saved.status(), await saved.text()).toBe(200);
  return { boardId, versionId, body, name };
}
async function target(page: Page, kind: "round" | "presentation") {
  const collection = kind === "round" ? "quizzes" : "presentations";
  const created = await page.request.post(`${api}/v1/${collection}`, {
    data: { title: "Creator destination", description: "" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const response = await created.json(),
    id = (kind === "round" ? response.quiz : response.presentation).id as string;
  return {
    id,
    path: `${api}/v1/${collection}/${id}/canvas-snapshot-links`,
    document: `${api}/v1/${collection}/${id}`,
    url: `/${kind === "round" ? "quiz" : "presentation"}/${id}`,
  };
}
async function choose(page: Page, data: Awaited<ReturnType<typeof source>>) {
  const panel = page.getByRole("region", { name: "Canvas snapshots", exact: true });
  await panel.getByRole("button", { name: "Link saved canvas", exact: true }).click();
  await panel
    .getByRole("combobox", { name: "Canvas board", exact: true })
    .selectOption(data.boardId);
  await panel
    .getByRole("combobox", { name: "Saved version", exact: true })
    .selectOption(data.versionId);
  return panel;
}

for (const kind of ["round", "presentation"] as const) {
  test(`${kind} creator links an exact saved canvas through target-authorized preview and removes it`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const { owner } = await organization(page, testInfo);
    const data = await source(page, owner.creator.workspaceId),
      destination = await target(page, kind);
    const requests: string[] = [];
    let dropped = false;
    await page.route(destination.path, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      requests.push(route.request().postData()!);
      const response = await route.fetch();
      expect(response.status(), await response.text()).toBe(200);
      if (kind === "round" && !dropped) {
        dropped = true;
        await route.abort("connectionreset");
      } else await route.fulfill({ response });
    });
    await page.goto(destination.url);
    const panel = await choose(page, data);
    await panel.getByRole("button", { name: "Link snapshot", exact: true }).click();
    if (kind === "round") {
      const retry = panel.getByRole("button", { name: "Retry same request", exact: true });
      await expect(retry).toBeEnabled();
      expect(requests).toHaveLength(1);
      await retry.click();
      await expect(retry).toHaveCount(0);
      expect(requests).toHaveLength(2);
      expect(requests[1]).toBe(requests[0]);
    }
    await expect(panel.getByRole("heading", { name: data.name, exact: true })).toBeVisible();
    const list = await page.request.get(destination.path);
    expect(list.status(), await list.text()).toBe(200);
    const links = (await list.json()).links;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ boardId: data.boardId, versionId: data.versionId });
    const previewResponse = page.waitForResponse(`${destination.path}/${links[0].id}/preview`);
    await panel.getByRole("button", { name: "Preview snapshot", exact: true }).click();
    expect((await previewResponse).status()).toBe(200);
    const preview = panel.getByRole("region", { name: "Preview snapshot", exact: true });
    await expect(preview.getByText(data.body, { exact: true }).first()).toBeVisible();
    expect(
      await page.evaluate(() =>
        JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
      ),
    ).not.toContain(data.body);
    const document = await page.request.get(destination.document);
    expect(document.status(), await document.text()).toBe(200);
    expect(await document.text()).not.toContain(data.body);
    expect(await document.text()).not.toContain(data.versionId);
    await preview.screenshot({ path: testInfo.outputPath(`${kind}-canvas-snapshot-preview.png`) });

    if (kind === "presentation") {
      // A fresh denied target authorization must remove an already visible scene.
      await page.route(`${destination.path}/${links[0].id}/preview`, (route) =>
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "FORBIDDEN", message: "Synthetic revoked target access" },
          }),
        }),
      );
      await expect(preview).toHaveCount(0);
      await expect(panel.getByText(data.body, { exact: true })).toHaveCount(0);
      await expect(panel.getByRole("alert")).toBeVisible();
    } else {
      const deleted = await page.request.delete(`${api}/v1/canvas-boards/${data.boardId}`);
      expect(deleted.status(), await deleted.text()).toBe(204);
      await expect(preview).toHaveCount(0);
      await expect(panel.getByText(data.body, { exact: true })).toHaveCount(0);
      await expect(panel.getByRole("heading", { name: data.name, exact: true })).toHaveCount(0);
      return;
    }
    await panel.getByRole("button", { name: "Remove link", exact: true }).click();
    await expect(panel.getByRole("heading", { name: data.name, exact: true })).toHaveCount(0);
    expect((await (await page.request.get(destination.path)).json()).links).toEqual([]);
  });
}

test("authorized snapshot preview retains its canvas and outline through repeated event outages", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const { owner } = await organization(page, testInfo);
  const data = await source(page, owner.creator.workspaceId),
    destination = await target(page, "round");
  await page.goto(destination.url);
  const panel = await choose(page, data);
  await panel.getByRole("button", { name: "Link snapshot", exact: true }).click();
  await expect(panel.getByRole("heading", { name: data.name, exact: true })).toBeVisible();
  const list = await page.request.get(destination.path);
  expect(list.status(), await list.text()).toBe(200);
  const linkId = (await list.json()).links[0].id as string;
  const previewPath = `${destination.path}/${linkId}/preview`;
  const authorizedReads: number[] = [];
  let eventFailures = 0,
    deniedReads = 0,
    denyPreview = false;
  const cors = { "access-control-allow-origin": web, "access-control-allow-credentials": "true" };
  await page.route(`${api}/v1/canvas-boards/${data.boardId}/events`, async (route) => {
    eventFailures++;
    await route.fulfill({
      status: 503,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Synthetic event outage" } }),
    });
  });
  await page.route(previewPath, async (route) => {
    if (denyPreview) {
      deniedReads++;
      await route.fulfill({
        status: 403,
        headers: cors,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "FORBIDDEN", message: "Synthetic target revocation" },
        }),
      });
      return;
    }
    // Preserve real target/source authorization and the actual sanitized snapshot response.
    const response = await route.fetch();
    expect(response.status(), await response.text()).toBe(200);
    await route.fulfill({ response });
    authorizedReads.push(performance.now());
  });
  await panel.getByRole("button", { name: "Preview snapshot", exact: true }).click();
  const preview = panel.getByRole("region", { name: "Preview snapshot", exact: true });
  const scene = preview.getByRole("region", { name: data.name, exact: true });
  await expect(scene.getByText(data.body, { exact: true })).toBeVisible();
  const originalScene = await scene.elementHandle();
  expect(originalScene).not.toBeNull();
  const surface = scene.getByTestId("canvas-surface");
  await surface.scrollIntoViewIfNeeded();
  const viewport = surface.locator(":scope > g[transform]");
  const initialTransform = await viewport.getAttribute("transform");
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 35, { steps: 5 });
  await page.mouse.up();
  await expect(viewport).not.toHaveAttribute("transform", initialTransform!);
  const pannedTransform = (await viewport.getAttribute("transform"))!;
  await expect.poll(() => eventFailures).toBeGreaterThanOrEqual(3);
  await expect.poll(() => authorizedReads.length).toBeGreaterThanOrEqual(3);
  expect(await scene.evaluate((node, original) => node === original, originalScene)).toBe(true);
  await expect(viewport).toHaveAttribute("transform", pannedTransform);

  const outline = scene.getByRole("button", { name: "Object outline", exact: true });
  await outline.click();
  await expect(outline).toHaveAttribute("aria-expanded", "true");
  const outlineList = scene.getByRole("list");
  await expect(outlineList.getByText(data.body, { exact: true })).toBeVisible();
  const originalOutline = await outlineList.elementHandle();
  expect(originalOutline).not.toBeNull();
  const openedAt = performance.now(),
    failuresAtOpen = eventFailures,
    readsAtOpen = authorizedReads.length;
  // Observe real successful reauthorization beyond the five-second freshness lease,
  // rather than sleeping and assuming a reconnect or poll happened.
  await expect.poll(() => authorizedReads.some((at) => at - openedAt > 5000)).toBe(true);
  expect(eventFailures).toBeGreaterThanOrEqual(failuresAtOpen + 3);
  expect(authorizedReads.length).toBeGreaterThanOrEqual(readsAtOpen + 3);
  expect(await scene.evaluate((node, original) => node === original, originalScene)).toBe(true);
  expect(await outlineList.evaluate((node, original) => node === original, originalOutline)).toBe(
    true,
  );
  await expect(outline).toHaveAttribute("aria-expanded", "true");
  await expect(outlineList.getByText(data.body, { exact: true })).toBeVisible();
  await preview.screenshot({
    path: testInfo.outputPath("authorized-preview-during-event-outage.png"),
  });
  await outline.click();
  await expect(
    scene.getByTestId("canvas-surface").locator(":scope > g[transform]"),
  ).toHaveAttribute("transform", pannedTransform);

  denyPreview = true;
  await expect.poll(() => deniedReads).toBeGreaterThanOrEqual(1);
  await expect(preview).toHaveCount(0);
  await expect(panel.getByText(data.body, { exact: true })).toHaveCount(0);
  expect(await originalScene!.evaluate((node) => node.isConnected)).toBe(false);
  await expect(panel.getByRole("alert")).toBeVisible();
});

test("@mobile 320px creator snapshot picker and preview remain accessible in light and dark themes", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 320, height: 760 });
  const { owner } = await organization(page, testInfo);
  const data = await source(page, owner.creator.workspaceId),
    destination = await target(page, "round");
  await page.goto(destination.url);
  const panel = await choose(page, data);
  for (const mode of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: mode });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
    await fits(page);
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321);
    for (const button of await panel.getByRole("button").all())
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      (
        await new AxeBuilder({ page })
          .include('section[aria-label="Canvas snapshots"]')
          .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await panel.screenshot({ path: testInfo.outputPath(`snapshot-picker-320-${mode}.png`) });
  }
  await panel.getByRole("button", { name: "Link snapshot", exact: true }).click();
  await panel.getByRole("button", { name: "Preview snapshot", exact: true }).click();
  const preview = panel.getByRole("region", { name: "Preview snapshot", exact: true });
  await expect(preview.getByText(data.body, { exact: true }).first()).toBeVisible();
  await fits(page);
  await preview.getByRole("button", { name: "Object outline", exact: true }).click();
  await expect(preview.getByRole("list").getByText(data.body, { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "Close preview", exact: true }).click();
  await expect(preview).toHaveCount(0);
});
