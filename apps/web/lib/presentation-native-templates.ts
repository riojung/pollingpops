import {
  PresentationDraftSchema,
  type SupportedLocale,
  type ContentSlideDraft,
  type PresentationDraft,
  type PresentationScene,
  type PresentationSceneChartNode,
  type PresentationSceneDesign,
  type PresentationSceneFrame,
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

/** Source-only art direction. Geometry is shared by every authored creation locale. */
export type NativeTemplateLayout =
  "cover" | "statement" | "process" | "timeline" | "comparison" | "cards" | "closing" | "data";
export type NativeTemplateVisualStyle = "editorial" | "briefing" | "workshop";

export interface NativeTemplateSlide {
  layout: NativeTemplateLayout;
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
  visualStyle: NativeTemplateVisualStyle;
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
    visualStyle: entry.visualStyle as NativeTemplateVisualStyle,
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

type Shape = Extract<PresentationSceneNode, { type: "shape" }>;
const accents: Record<PresentationSceneDesign["theme"], Shape["color"]> = {
  paper: "amber",
  midnight: "lavender",
  ocean: "sky",
  sunset: "orange",
};

/** Keep the translated heading and its explanation adjacent in narrow reading flow. */
function columnParts(text: string) {
  const boundary = text.search(/[:：?？,，、]/u);
  return boundary >= 0
    ? { label: text.slice(0, boundary + 1), body: text.slice(boundary + 1).trimStart() }
    : { label: text, body: "" };
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
  const nodes: PresentationSceneNode[] = [];
  const groups: NonNullable<PresentationScene["groups"]> = [];
  const text = (value: string, frame: PresentationSceneFrame, role: "title" | "body" = "body") => {
    const node: PresentationSceneNode = { id: createId(), type: "text", role, text: value, frame };
    nodes.push(node);
    return node.id;
  };
  const shape = (label: string, frame: PresentationSceneFrame, id = createId()) => {
    nodes.push({
      id,
      type: "shape",
      shape: "rounded_rectangle",
      color: accents[template.theme],
      label,
      frame,
    });
    return id;
  };
  const title = (frame: PresentationSceneFrame) => text(copy.title, frame, "title");

  if (hasData || hasColumns) title({ x: 7, y: 3, width: 86, height: 24 });
  if (hasData && !hasChart) text(lead, { x: 7, y: 29, width: 86, height: 20 });
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
    text(lead, { x: 7, y: 29, width: 86, height: 15 });
    const timeline = copy.layout === "timeline";
    const connected = timeline || copy.layout === "process";
    const gap = connected ? 7 : 6;
    const width = (86 - gap * (copy.columns.length - 1)) / copy.columns.length;
    // Allocate endpoints before creating nodes so connectors retain the same semantic order
    // as the step cards, including in the renderer's stacked mobile/reading view.
    const headingIds = copy.columns.map(() => createId());
    copy.columns.forEach((column, index) => {
      const parts = columnParts(column);
      const x = 7 + index * (width + gap);
      const y = 46 + index * 18;
      const heading = shape(
        parts.label,
        timeline ? { x: 7, y, width: 26, height: 14 } : { x, y: 48, width, height: 20 },
        headingIds[index],
      );
      const description = text(
        parts.body,
        timeline ? { x: 38, y, width: 55, height: 14 } : { x, y: 71, width, height: 26 },
      );
      groups.push({ id: createId(), nodeIds: [heading, description] });
      if (connected && index < copy.columns!.length - 1)
        nodes.push({
          id: createId(),
          type: "connector",
          from: { nodeId: heading, anchor: timeline ? "bottom" : "right" },
          to: { nodeId: headingIds[index + 1]!, anchor: timeline ? "top" : "left" },
          // The renderer supplies its localized Connection label and the named endpoints.
          label: "",
          color: accents[template.theme],
        });
    });
  } else if (copy.layout === "cover") {
    if (template.visualStyle === "briefing") {
      title({ x: 7, y: 7, width: 62, height: 43 });
      shape(template.scenarioLabel, { x: 74, y: 7, width: 19, height: 32 });
      text(copy.body, { x: 7, y: 57, width: 86, height: 36 });
    } else if (template.visualStyle === "workshop") {
      title({ x: 37, y: 7, width: 56, height: 39 });
      shape(template.scenarioLabel, { x: 7, y: 7, width: 24, height: 20 });
      text(copy.body, { x: 7, y: 56, width: 86, height: 37 });
    } else {
      title({ x: 7, y: 25, width: 86, height: 27 });
      shape(template.scenarioLabel, { x: 7, y: 7, width: 50, height: 11 });
      text(copy.body, { x: 7, y: 61, width: 86, height: 32 });
    }
  } else if (copy.layout === "statement") {
    title({ x: 7, y: 7, width: 86, height: 26 });
    // The first authored sentence is the takeaway, followed by its complete qualification.
    // Both source pieces stay intact; condensed translations may have no second sentence.
    const sentence = openingSentence(copy.body);
    const callout = sentence.length <= 200 ? sentence : template.scenarioLabel;
    const detail =
      sentence.length <= 200 ? copy.body.slice(sentence.length).trimStart() : copy.body;
    if (template.visualStyle === "briefing") {
      shape(callout, { x: 7, y: 38, width: 86, height: 24 });
      text(detail, { x: 7, y: 67, width: 86, height: 29 });
    } else if (template.visualStyle === "workshop") {
      shape(callout, { x: 7, y: 38, width: 33, height: 58 });
      text(detail, { x: 46, y: 38, width: 47, height: 58 });
    } else {
      shape(callout, { x: 7, y: 38, width: 52, height: 54 });
      text(detail, { x: 65, y: 38, width: 28, height: 54 });
    }
  } else if (copy.layout === "closing") {
    if (template.visualStyle === "briefing") {
      title({ x: 7, y: 7, width: 49, height: 45 });
      text(copy.body, { x: 62, y: 7, width: 31, height: 86 });
      shape(template.scenarioLabel, { x: 7, y: 67, width: 49, height: 15 });
    } else if (template.visualStyle === "workshop") {
      title({ x: 7, y: 7, width: 86, height: 26 });
      text(copy.body, { x: 7, y: 43, width: 61, height: 50 });
      shape(template.scenarioLabel, { x: 75, y: 45, width: 18, height: 35 });
    } else {
      title({ x: 7, y: 7, width: 86, height: 27 });
      text(copy.body, { x: 37, y: 43, width: 56, height: 49 });
      shape(template.scenarioLabel, { x: 7, y: 49, width: 25, height: 29 });
    }
  }
  const scene: PresentationScene = {
    schemaVersion: 4,
    aspectRatio: "16:9",
    design: {
      theme: template.theme,
      font: template.font,
      spacing: hasData || hasColumns ? "compact" : "relaxed",
    },
    ...(groups.length ? { groups } : {}),
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
      !hasChart && lead === copy.body && copy.layout !== "statement"
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
