import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  ContentSlideDraft,
  PresentationDraft,
  PresentationParticipantSnapshot,
  PresentationScene,
  PresentationSceneNode,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import {
  selectE01Object,
  openE01Inspector,
  closeE01Overlays,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
} from "./presentation-e01-support";

test.use({ actionTimeout: 30_000 });

const tableCaption = "Regional attendance";
const chartTitle = "Attendance by region";
const finalSummary = "West recorded 20 attendees; East recorded 12.";
type TableNode = Extract<PresentationSceneNode, { type: "table" }>;
type ChartNode = Extract<PresentationSceneNode, { type: "chart" }>;

function informationFixture() {
  const visible = e01Slide("Attendance evidence");
  visible.speakerNotes = "PRIVATE information facilitator cue";
  visible.citations = [
    { locator: "PRIVATE information source", excerpt: "PRIVATE source excerpt" },
  ];
  const title = visible.scene!.nodes[0]!;
  if (title.type !== "text") throw new Error("Expected a native slide title");
  title.frame = { x: 7, y: 5, width: 86, height: 16 };
  const table: TableNode = {
    id: randomUUID(),
    type: "table",
    caption: tableCaption,
    headers: ["Region", "Count"],
    rows: [
      ["East", "10"],
      ["West", "20"],
    ],
    frame: { x: 7, y: 25, width: 38, height: 65 },
  };
  const chart: ChartNode = {
    id: randomUUID(),
    type: "chart",
    chartType: "bar",
    title: chartTitle,
    summary: "West recorded twice the attendance of East.",
    categories: ["East", "West"],
    series: [{ name: "Attendees", values: [10, 20] }],
    frame: { x: 49, y: 25, width: 44, height: 65 },
  };
  visible.scene = {
    schemaVersion: 4,
    aspectRatio: "16:9",
    design: { theme: "paper", font: "sans", spacing: "relaxed" },
    nodes: [title, table, chart],
    readingOrder: [title.id, table.id, chart.id],
  };
  const hidden: ContentSlideDraft = {
    ...e01Slide("HIDDEN information planning"),
    hidden: true,
    speakerNotes: "PRIVATE hidden information cue",
  };
  return { visible, hidden, table, chart };
}

function informationScene(draft: PresentationDraft): PresentationScene {
  const block = draft.blocks[0];
  if (block?.kind !== "content" || !block.scene) throw new Error("Expected the information slide");
  return block.scene;
}

function tableNode(draft: PresentationDraft): TableNode {
  const node = informationScene(draft).nodes.find((node) => node.type === "table");
  if (node?.type !== "table") throw new Error("Expected a table");
  return node;
}

function chartNode(draft: PresentationDraft): ChartNode {
  const node = informationScene(draft).nodes.find((node) => node.type === "chart");
  if (node?.type !== "chart") throw new Error("Expected a chart");
  return node;
}

async function selectObject(page: Page, label: string) {
  await selectE01Object(page, label);
}

async function expectNoHorizontalOverflow(page: Page) {
  const bounds = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(bounds.width, JSON.stringify(bounds)).toBeLessThanOrEqual(bounds.viewport + 1);
}

async function expectInformation(stage: Locator) {
  const table = stage.getByRole("table", { name: tableCaption, exact: true });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Note", exact: true })).toBeVisible();
  await expect(table.getByRole("cell").filter({ hasText: /^North, west$/ })).toBeVisible();
  await expect(
    table.getByRole("cell").filter({ hasText: /^Says "hello"\s+follow-up$/ }),
  ).toBeVisible();
  const chart = stage.locator('[data-native-data="chart"]');
  await expect(chart).toHaveAttribute("data-chart-type", "pie");
  await expect(chart.getByText(finalSummary, { exact: true })).toBeVisible();
  const data = chart.getByRole("table", { name: `${chartTitle} · chart data`, exact: true });
  await expect(data).toBeVisible();
  await expect(data.getByRole("rowheader", { name: "1. East", exact: true })).toBeVisible();
  await expect(data.getByRole("cell").filter({ hasText: /^12$/ })).toBeVisible();
  await expect(data.getByRole("cell").filter({ hasText: /^20$/ })).toBeVisible();
  await expect(chart.locator('svg[aria-hidden="true"][focusable="false"]')).toBeVisible();
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
  test(`information tables and charts stage, recover, retain discrete history and freeze for audiences${suffix}`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const fixture = informationFixture();
    const record = await createE01Deck(page, [fixture.visible, fixture.hidden], 8);
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    const stage = page.locator("[data-native-scene]");
    await expect(stage).toHaveCSS("background-color", "rgb(255, 253, 247)");
    await expect(stage.getByRole("table", { name: tableCaption, exact: true })).toBeVisible();
    await selectObject(page, `2. ${tableCaption}`);
    const tableEditor = page.getByRole("group", { name: "Table data editor", exact: true });
    const count = tableEditor.getByRole("textbox", { name: "Row 1, column 2", exact: true });

    // Deliberately apply twice without waiting for autosave: explicit commits must not coalesce.
    await count.fill("11");
    await tableEditor.getByRole("button", { name: "Apply table changes", exact: true }).click();
    await count.fill("12");
    await tableEditor.getByRole("button", { name: "Apply table changes", exact: true }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(count).toHaveValue("11");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(count).toHaveValue("10");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(count).toHaveValue("11");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(count).toHaveValue("12");

    const paste = tableEditor.getByRole("textbox", { name: "Paste CSV or TSV data", exact: true });
    await paste.fill('Region,Count\n"Unfinished,18');
    await tableEditor.getByRole("button", { name: "Preview pasted data", exact: true }).click();
    await expect(tableEditor.getByRole("alert")).toContainText("unfinished");
    await expect(count).toHaveValue("12");
    await paste.fill(
      'Region,Count,Note\r\n"North, west",18,"Says ""hello""\r\nfollow-up"\r\nSouth,22,Ready',
    );
    await tableEditor.getByRole("button", { name: "Preview pasted data", exact: true }).click();
    await expect(
      tableEditor.getByRole("textbox", { name: "Row 1, column 1", exact: true }),
    ).toHaveValue("North, west");
    await expect(
      tableEditor.getByRole("textbox", { name: "Row 1, column 3", exact: true }),
    ).toHaveValue('Says "hello"\nfollow-up');
    await expect(
      stage
        .getByRole("table", { name: tableCaption, exact: true })
        .getByRole("cell")
        .filter({ hasText: /^East$/ }),
    ).toBeVisible();
    await tableEditor.getByRole("button", { name: "Apply table changes", exact: true }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(count).toHaveValue("12");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(count).toHaveValue("18");

    await selectObject(page, `3. ${chartTitle}`);
    const chartEditor = page.getByRole("group", { name: "Chart data editor", exact: true });
    const value = chartEditor.getByRole("textbox", {
      name: "Category 1, series 1 value",
      exact: true,
    });
    const chartType = chartEditor.getByRole("combobox", { name: "Chart type", exact: true });
    await value.fill("=6+6");
    await chartEditor.getByRole("button", { name: "Apply chart changes", exact: true }).click();
    await expect(chartEditor.getByRole("alert")).toContainText("Formulas");
    await expect(stage.locator('[data-native-data="chart"]')).toHaveAttribute(
      "data-chart-type",
      "bar",
    );
    await value.fill("12");
    await chartEditor
      .getByRole("textbox", { name: "Chart description", exact: true })
      .fill(finalSummary);
    await chartEditor.getByRole("button", { name: "Apply chart changes", exact: true }).click();
    await chartType.selectOption("line");
    await chartEditor.getByRole("button", { name: "Apply chart changes", exact: true }).click();
    await expect(stage.locator('[data-native-data="chart"]')).toHaveAttribute(
      "data-chart-type",
      "line",
    );
    await chartType.selectOption("pie");
    await chartEditor.getByRole("button", { name: "Apply chart changes", exact: true }).click();
    for (const expected of ["line", "bar", "bar"]) {
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(chartType).toHaveValue(expected);
    }
    await expect(value).toHaveValue("10");
    for (const expected of ["bar", "line", "pie"]) {
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await expect(chartType).toHaveValue(expected);
    }
    await expect(value).toHaveValue("12");
    await expect
      .poll(async () => {
        const draft = (await readE01Record(page, record.id)).draft;
        return {
          version: draft.schemaVersion,
          sceneVersion: informationScene(draft).schemaVersion,
          table: tableNode(draft).rows,
          type: chartNode(draft).chartType,
          values: chartNode(draft).series[0]!.values,
        };
      })
      .toEqual({
        version: 8,
        sceneVersion: 4,
        table: [
          ["North, west", "18", 'Says "hello"\nfollow-up'],
          ["South", "22", "Ready"],
        ],
        type: "pie",
        values: [12, 20],
      });
    await expectInformation(stage);
    await expectNoHorizontalOverflow(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await openE01Inspector(page, "Layout");
    await page
      .getByRole("combobox", { name: "Base color theme", exact: true })
      .selectOption("midnight");
    await expect(stage).toHaveCSS("background-color", "rgb(17, 27, 46)");
    await expect(stage.getByRole("table", { name: tableCaption, exact: true })).toHaveCSS(
      "color",
      "rgb(246, 248, 255)",
    );
    if (!narrow) {
      await closeE01Overlays(page);
    }
    // CSS zoom emulates document magnification; this is not physical-device evidence.
    testInfo.annotations.push({
      type: "emulation",
      description: "200% document CSS zoom; browser device profiles are emulated.",
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expectInformation(stage);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("information-dark-emulated-200-percent.png"),
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
    const saved = (await readE01Record(page, record.id)).draft;
    expect(saved.schemaVersion).toBe(8);
    await page.reload();
    if (narrow) {
      await closeE01Overlays(page);
    }
    await expectInformation(page.locator("[data-native-scene]"));
    expect((await readE01Record(page, record.id)).draft).toEqual(saved);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
    await expectInformation(preview.locator("[data-native-scene]"));
    expect(await preview.innerText()).not.toMatch(/PRIVATE|HIDDEN/);
    await expect(preview.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
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
    expect(version.content.schemaVersion).toBe(8);
    expect(version.content.blocks.map((block: { id: string }) => block.id)).toEqual([
      fixture.visible.id,
    ]);
    expect(version.content.blocks[0].scene).toEqual(informationScene(saved));
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
      await guest.getByLabel("Nickname", { exact: true }).fill("Information audience");
      await guest.getByRole("button", { name: "Join presentation", exact: true }).click();
      await expect(guest).toHaveURL(`/presentation-session/${sessionId}/play`);
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      await expectInformation(guest.locator("[data-native-scene]"));
      const frozen = await participantSnapshot(guest, sessionId);
      expect(frozen.currentBlock).toMatchObject({
        id: fixture.visible.id,
        scene: informationScene(saved),
      });
      expect(frozen.currentBlock).not.toHaveProperty("speakerNotes");
      expect(frozen.currentBlock).not.toHaveProperty("citations");
      expect(JSON.stringify(frozen)).not.toMatch(/PRIVATE|HIDDEN/);
      expect(await guest.locator("body").innerText()).not.toMatch(/PRIVATE|HIDDEN/);
      await expectNoHorizontalOverflow(guest);
      expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);

      const latest = await readE01Record(page, record.id);
      const changed = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
        data: {
          draft: {
            ...latest.draft,
            blocks: latest.draft.blocks.map((block) => {
              if (block.kind !== "content") return block;
              if (block.id === fixture.hidden.id) {
                const { hidden: _hidden, ...shown } = block;
                void _hidden;
                return shown;
              }
              return block.scene
                ? {
                    ...block,
                    scene: {
                      ...block.scene,
                      nodes: block.scene.nodes.map((node) =>
                        node.type === "chart"
                          ? { ...node, summary: "AUTHOR-ONLY revised chart description" }
                          : node.type === "table"
                            ? { ...node, caption: "AUTHOR-ONLY revised table" }
                            : node,
                      ),
                    },
                  }
                : block;
            }),
          },
          expectedRevision: latest.draftRevision,
          mutationId: randomUUID(),
          schemaVersion: 2,
        },
      });
      expect(changed.status()).toBe(200);
      await guest.reload();
      await expectInformation(guest.locator("[data-native-scene]"));
      expect((await participantSnapshot(guest, sessionId)).currentBlock).toEqual(
        frozen.currentBlock,
      );
      expect(await guest.locator("body").innerText()).not.toMatch(/PRIVATE|HIDDEN|AUTHOR-ONLY/);
      await guest.screenshot({
        path: testInfo.outputPath("information-frozen-audience.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
      await expect(
        guest.getByRole("heading", { name: "Thanks for participating", exact: true }),
      ).toBeVisible();
    } finally {
      await guestContext.close();
    }
  });
}
