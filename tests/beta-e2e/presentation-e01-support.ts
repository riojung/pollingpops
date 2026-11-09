import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import {
  type ContentSlideDraft,
  type PresentationDraft,
  type PresentationSceneNode,
} from "../../packages/contracts/src/index.ts";

export const e01ApiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
export type E01Record = { id: string; draft: PresentationDraft; draftRevision: number };

export function e01Slide(title: string, rich = false): ContentSlideDraft {
  const nodes: PresentationSceneNode[] = [
    {
      id: randomUUID(),
      type: "text",
      role: "title",
      text: title,
      frame: { x: 8, y: 5, width: 84, height: 20 },
    },
    {
      id: randomUUID(),
      type: "text",
      role: "body",
      text: "Choose one action",
      frame: { x: 8, y: 35, width: 84, height: 40 },
      ...(rich
        ? {
            richText: {
              paragraphs: [
                {
                  kind: "bullet" as const,
                  runs: [{ text: "Choose one action", bold: true as const }],
                },
              ],
            },
          }
        : {}),
    },
  ];
  return {
    id: randomUUID(),
    kind: "content",
    layout: "title_body",
    textElements: [],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "PRIVATE E01 speaker cue",
    scene: {
      schemaVersion: rich ? 2 : 1,
      aspectRatio: "16:9",
      nodes,
      readingOrder: nodes.map((node) => node.id),
    },
  };
}

export async function createE01Deck(
  page: Page,
  blocks: PresentationDraft["blocks"],
  schemaVersion: PresentationDraft["schemaVersion"] = 5,
) {
  const created = await page.request.post(`${e01ApiUrl}/v1/presentations`, {
    data: { title: `E01 ${randomUUID().slice(0, 8)}` },
  });
  expect(created.status()).toBe(201);
  const record = (await created.json()).presentation as E01Record;
  const saved = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
    data: {
      draft: { ...record.draft, schemaVersion, blocks },
      expectedRevision: record.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(saved.status(), await saved.text()).toBe(200);
  return (await saved.json()).presentation as E01Record;
}

export async function readE01Record(page: Page, id: string): Promise<E01Record> {
  const response = await page.request.get(`${e01ApiUrl}/v1/presentations/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()).presentation;
}

export async function enterE01Editor(page: Page, id: string, narrow: boolean) {
  await page.goto(`/presentation/${id}`);
  if (narrow) await closeE01Overlays(page);
}

export async function closeE01Overlays(page: Page) {
  for (const name of ["Hide inspector", "Collapse map"]) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
}

export async function openE01Inspector(
  page: Page,
  section: "Content" | "Layout" | "Media" | "Notes" | "Access" | "Ready",
) {
  const trigger = page.locator('button[aria-controls="presentation-object-inspector"]');
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute("aria-expanded")) === "false") await trigger.click();
  const inspector = page.locator("#presentation-object-inspector");
  await expect(inspector).toBeVisible();
  await inspector.getByRole("tab", { name: section, exact: true }).click();
  return inspector;
}

export async function openEditorActions(page: Page) {
  const more = page.locator('summary[aria-label="More options"]');
  const disclosure = more.locator("xpath=ancestor::details[1]");
  if ((await disclosure.getAttribute("open")) === null) await more.click();
}

export async function clickEditorAction(page: Page, name: string) {
  const action = page.getByRole("button", { name, exact: true });
  if (!(await action.isVisible())) await openEditorActions(page);
  await action.click();
}

export async function openSlideIdeas(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) <= 920) await closeE01Overlays(page);
  const summary = page.locator('summary[aria-label="Slide ideas & audience activities"]');
  if ((await summary.locator("xpath=ancestor::details[1]").getAttribute("open")) === null)
    await summary.click();
}

export async function clickNativeInsert(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1280) <= 920) await closeE01Overlays(page);
  const action = page.getByRole("button", { name, exact: true });
  if (!(await action.isVisible())) await page.getByText("Insert more", { exact: true }).click();
  await action.click();
  await openE01Inspector(page, "Content");
}

export async function openE01Navigator(page: Page) {
  const trigger = page.locator('button[aria-controls="presentation-slide-navigator"]');
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute("aria-expanded")) === "false") await trigger.click();
  const navigator = page.locator("#presentation-slide-navigator");
  await expect(navigator).toBeVisible();
  return navigator;
}

export async function clickNavigatorAction(page: Page, name: string | RegExp) {
  const navigator = await openE01Navigator(page);
  const action = navigator.getByRole("button", { name, exact: typeof name === "string" });
  if (!(await action.isVisible()))
    await navigator.locator('summary[aria-label="Insert & import"]').click();
  await action.click();
  if ((page.viewportSize()?.width ?? 1280) <= 920 && (await page.getByRole("dialog").count()) === 0)
    await closeE01Overlays(page);
}

export async function selectE01Block(page: Page, title: string, narrow: boolean) {
  await openE01Navigator(page);
  await page
    .getByRole("complementary", { name: "Presentation map", exact: true })
    .getByRole("button", { name: new RegExp(title) })
    .click();
  if (narrow) await closeE01Overlays(page);
}

export async function selectE01Body(page: Page) {
  await selectE01Object(page, /^2\./);
}

export async function selectE01Object(
  page: Page,
  name: string | RegExp,
  section: "Content" | "Layout" | "Media" | "Notes" | "Access" | "Ready" = "Content",
) {
  await openE01Inspector(page, "Access");
  await page
    .getByRole("group", { name: "Slide objects · reading order", exact: true })
    .getByRole("button", { name, exact: typeof name === "string" })
    .click();
  await openE01Inspector(page, section);
}

export function e01Body(draft: PresentationDraft) {
  const block = draft.blocks[0];
  if (block?.kind !== "content") return "";
  const body = block.scene?.nodes.find((node) => node.type === "text" && node.role === "body");
  return body?.type === "text" ? body.text : "";
}
