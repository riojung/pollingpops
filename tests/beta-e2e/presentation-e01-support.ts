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
  if (narrow) {
    await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
    await page.getByRole("button", { name: "Collapse map", exact: true }).click();
  }
}

export async function selectE01Block(page: Page, title: string, narrow: boolean) {
  if (narrow) await page.getByRole("button", { name: "Open map", exact: true }).click();
  await page
    .getByRole("complementary", { name: "Presentation map", exact: true })
    .getByRole("button", { name: new RegExp(title) })
    .click();
  if (narrow) await page.getByRole("button", { name: "Collapse map", exact: true }).click();
}

export async function selectE01Body(page: Page) {
  await page
    .getByRole("group", { name: "Slide objects · reading order", exact: true })
    .getByRole("button", { name: /^2\./ })
    .click();
}

export function e01Body(draft: PresentationDraft) {
  const block = draft.blocks[0];
  if (block?.kind !== "content") return "";
  const body = block.scene?.nodes.find((node) => node.type === "text" && node.role === "body");
  return body?.type === "text" ? body.text : "";
}
