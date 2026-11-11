import {
  PresentationDraftSchema,
  type SupportedLocale,
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
import { presentationTemplateLocaleCatalog } from "./presentation-template-locales";

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

function localizeNativeTemplate(
  template: NativePresentationTemplate,
  templateIndex: number,
  locale: SupportedLocale,
): NativePresentationTemplate {
  const catalog = presentationTemplateLocaleCatalog(locale);
  if (!catalog) return structuredClone(template);
  const localized = catalog.native[templateIndex]!;
  return {
    ...template,
    title: localized.title,
    description: localized.description,
    scenarioLabel: localized.scenarioLabel,
    blocks: template.blocks.map((block, slideIndex) => {
      const copy = localized.slides[slideIndex]!;
      const extra = catalog.nativeData[`${templateIndex}.${slideIndex}`] ?? [];
      let cursor = 0;
      const text = (value: string): string => {
        // Preserve actual figures and currency tokens; every word-bearing label is authored.
        if (/^[\d\s$%,.–—:+/()-]+$/u.test(value)) return value;
        const translated = extra[cursor++];
        if (!translated)
          throw new Error(`Incomplete ${locale} template data: ${template.id}/${slideIndex}`);
        return translated;
      };
      const result = {
        ...structuredClone(block),
        ...copy,
        ...(block.columns ? { columns: block.columns.map(text) } : {}),
        ...(block.illustrativeTable
          ? {
              illustrativeTable: {
                caption: text(block.illustrativeTable.caption),
                headers: block.illustrativeTable.headers.map(text),
                rows: block.illustrativeTable.rows.map((row) => row.map(text)),
              },
            }
          : {}),
        ...(block.illustrativeChart
          ? {
              illustrativeChart: {
                ...block.illustrativeChart,
                title: text(block.illustrativeChart.title),
                summary: text(block.illustrativeChart.summary),
                categories: block.illustrativeChart.categories.map(text),
                series: block.illustrativeChart.series.map((series) => ({
                  ...series,
                  name: text(series.name),
                  values: [...series.values],
                })),
              },
            }
          : {}),
      };
      if (cursor !== extra.length)
        throw new Error(`Unexpected ${locale} template data: ${template.id}/${slideIndex}`);
      return result;
    }),
  };
}

/** Derive gallery/creation copy without mutating either catalog or any stored draft. */
export function nativePresentationTemplatesForLocale(
  locale: SupportedLocale = "en-CA",
): readonly NativePresentationTemplate[] {
  return nativePresentationTemplates.map((template, index) =>
    localizeNativeTemplate(template, index, locale),
  );
}

/** Select before deriving copy so one thumbnail or creation never rebuilds unrelated scenarios. */
export function nativePresentationTemplateForLocale(
  id: NativePresentationTemplateId,
  locale: SupportedLocale = "en-CA",
): NativePresentationTemplate {
  const index = nativePresentationTemplates.findIndex((entry) => entry.id === id);
  const template = nativePresentationTemplates[index];
  if (!template) throw new Error("Presentation template not found");
  return localizeNativeTemplate(template, index, locale);
}

function openingSentence(body: string) {
  const sentence = /^.*?(?:[.!?](?=\s|$)|[。！？])/u.exec(body)?.[0];
  return sentence ?? body;
}

function createSlide(
  template: NativePresentationTemplate,
  copy: NativeTemplateSlide,
  createId: () => string,
  locale: SupportedLocale = "en-CA",
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
      const colon = text.search(/[:：]/u);
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
        : `${copy.body}\n\n${presentationTemplateLocaleCatalog(locale)?.presenterNotes ?? "Presenter notes:"} ${copy.notes}`,
    scene,
  };
}

/** Explicit new native scenarios; ordinary and facilitated historical templates remain v2. */
export function instantiateNativePresentationTemplate(
  id: NativePresentationTemplateId,
  createId: () => string = clientUuid,
  locale: SupportedLocale = "en-CA",
): PresentationDraft {
  const template = nativePresentationTemplateForLocale(id, locale);
  return PresentationDraftSchema.parse({
    title: template.title,
    description: template.description,
    schemaVersion: 8,
    experiencePreset: {
      id: template.category === "business" ? "studio" : "focus",
      version: 1,
    },
    blocks: template.blocks.map((block) => createSlide(template, block, createId, locale)),
  });
}

/** Deterministic read-only thumbnail IDs keep server rendering and hydration identical. */
export function nativePresentationTemplateThumbnail(
  id: NativePresentationTemplateId,
  locale: SupportedLocale = "en-CA",
): ContentSlideDraft {
  const index = nativePresentationTemplates.findIndex((template) => template.id === id);
  let sequence = (index + 1) * 1_000;
  const createId = () => `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, "0")}`;
  const template = nativePresentationTemplateForLocale(id, locale);
  return createSlide(template, template.blocks[0]!, createId, locale);
}
