import {
  PresentationDraftSchema,
  type ContentSlideDraft,
  type PresentationDraft,
  type PresentationScene,
  type PresentationSceneChartNode,
  type PresentationSceneDesign,
  type PresentationSceneNode,
  type PresentationSceneTableNode,
} from "@openround/contracts";
import content from "./presentation-native-template-content.json";
import { clientUuid } from "./uuid";

const scenarioLabels = {
  "native-startup-pitch": "Startup pitch",
  "native-client-proposal": "Client proposal",
  "native-project-update": "Project update",
  "native-quarterly-strategy": "Quarterly strategy",
  "native-portfolio-case-study": "Portfolio case study",
  "native-event-talk": "Event talk",
  "native-product-demo": "Product demo",
  "native-customer-onboarding": "Customer onboarding",
  "native-practical-workshop": "Practical workshop",
  "native-lesson-explainer": "Lesson and explainer",
  "native-research-findings": "Research findings",
  "native-business-decision-brief": "Business decision brief",
} as const;

export type NativePresentationTemplateId = keyof typeof scenarioLabels;

export interface NativeTemplateSlide {
  title: string;
  body: string;
  notes: string;
  columns?: string[];
  illustrativeTable?: Pick<PresentationSceneTableNode, "caption" | "headers" | "rows">;
  illustrativeChart?: Pick<
    PresentationSceneChartNode,
    "chartType" | "title" | "summary" | "categories" | "series"
  >;
}

export interface NativePresentationTemplate {
  id: NativePresentationTemplateId;
  title: string;
  description: string;
  category: "business" | "technical" | "education";
  theme: PresentationSceneDesign["theme"];
  font: PresentationSceneDesign["font"];
  collection: "native";
  scenarioLabel: string;
  blocks: ReadonlyArray<NativeTemplateSlide & { kind: "content" }>;
}

export const nativePresentationTemplates: readonly NativePresentationTemplate[] = content.map(
  (entry) => ({
    id: entry.id as NativePresentationTemplateId,
    title: entry.title,
    description: entry.description,
    category: entry.category as NativePresentationTemplate["category"],
    theme: entry.theme as NativePresentationTemplate["theme"],
    font: entry.font as NativePresentationTemplate["font"],
    collection: "native",
    scenarioLabel: scenarioLabels[entry.id as NativePresentationTemplateId],
    blocks: (entry.slides as NativeTemplateSlide[]).map((block) => ({
      ...block,
      kind: "content",
    })),
  }),
);

export function isNativePresentationTemplateId(id: string): id is NativePresentationTemplateId {
  return Object.hasOwn(scenarioLabels, id);
}

function templateFor(id: NativePresentationTemplateId) {
  const template = nativePresentationTemplates.find((entry) => entry.id === id);
  if (!template) throw new Error("Presentation template not found");
  return template;
}

function openingSentence(body: string) {
  const sentence = /^.*?[.!?](?=\s|$)/u.exec(body)?.[0];
  return sentence ?? body;
}

function createSlide(
  template: NativePresentationTemplate,
  copy: NativeTemplateSlide,
  createId: () => string,
): ContentSlideDraft {
  const hasData = Boolean(copy.illustrativeTable || copy.illustrativeChart);
  const hasChart = Boolean(copy.illustrativeChart);
  const hasColumns = Boolean(copy.columns?.length);
  // Charts already carry a public summary and use the remaining slide for the plot and data.
  // Table/column leads stay short; complete copy and adaptation guidance remain in the notes.
  const lead = hasData || hasColumns ? openingSentence(copy.body) : copy.body;
  const nodes: PresentationSceneNode[] = [
    {
      id: createId(),
      type: "text",
      role: "title",
      text: copy.title,
      frame: { x: 7, y: 3, width: 86, height: 24 },
    },
  ];
  if (!hasChart)
    nodes.push({
      id: createId(),
      type: "text",
      role: "body",
      text: lead,
      frame: hasData
        ? { x: 7, y: 29, width: 86, height: 20 }
        : hasColumns
          ? { x: 7, y: 29, width: 86, height: 26 }
          : { x: 7, y: 33, width: 86, height: 61 },
    });
  if (copy.illustrativeTable) {
    nodes.push({
      id: createId(),
      type: "table",
      frame: { x: 7, y: 52, width: 86, height: 45 },
      caption: copy.illustrativeTable.caption,
      headers: [...copy.illustrativeTable.headers],
      rows: copy.illustrativeTable.rows.map((row) => [...row]),
    });
  } else if (copy.illustrativeChart) {
    nodes.push({
      ...copy.illustrativeChart,
      id: createId(),
      type: "chart",
      frame: { x: 7, y: 30, width: 86, height: 67 },
      categories: [...copy.illustrativeChart.categories],
      series: copy.illustrativeChart.series.map((series) => ({
        ...series,
        values: [...series.values],
      })),
    });
  } else if (copy.columns) {
    const gap = 4;
    const width = (86 - gap * (copy.columns.length - 1)) / copy.columns.length;
    copy.columns.forEach((text, index) => {
      const colon = text.indexOf(":");
      nodes.push({
        id: createId(),
        type: "text",
        role: "body",
        text,
        ...(colon > 0
          ? {
              richText: {
                paragraphs: [
                  {
                    kind: "paragraph",
                    runs: [
                      { text: text.slice(0, colon + 1), bold: true },
                      { text: text.slice(colon + 1) },
                    ],
                  },
                ],
              },
            }
          : {}),
        frame: { x: 7 + index * (width + gap), y: 59, width, height: 38 },
      });
    });
  }
  const scene: PresentationScene = {
    schemaVersion: 4,
    aspectRatio: "16:9",
    design: {
      theme: template.theme,
      font: template.font,
      spacing: hasData || hasColumns ? "compact" : "relaxed",
    },
    nodes,
    readingOrder: nodes.map((node) => node.id),
  };
  return {
    id: createId(),
    kind: "content",
    layout: "title_body",
    textElements: [],
    mediaId: null,
    mediaAlt: null,
    speakerNotes:
      !hasChart && lead === copy.body
        ? copy.notes
        : `${copy.body}\n\nPresenter notes: ${copy.notes}`,
    scene,
  };
}

/** Explicit new native scenarios; ordinary and facilitated historical templates remain v2. */
export function instantiateNativePresentationTemplate(
  id: NativePresentationTemplateId,
  createId: () => string = clientUuid,
): PresentationDraft {
  const template = templateFor(id);
  return PresentationDraftSchema.parse({
    title: template.title,
    description: template.description,
    schemaVersion: 8,
    experiencePreset: {
      id: template.category === "business" ? "studio" : "focus",
      version: 1,
    },
    blocks: template.blocks.map((block) => createSlide(template, block, createId)),
  });
}

/** Deterministic read-only thumbnail IDs keep server rendering and hydration identical. */
export function nativePresentationTemplateThumbnail(
  id: NativePresentationTemplateId,
): ContentSlideDraft {
  const index = nativePresentationTemplates.findIndex((template) => template.id === id);
  let sequence = (index + 1) * 1_000;
  const createId = () => `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, "0")}`;
  const template = templateFor(id);
  return createSlide(template, template.blocks[0]!, createId);
}
