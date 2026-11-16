import { beforeAll, describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  supportedLocales,
  type PresentationDraft,
} from "@openround/contracts";
import {
  allPresentationTemplates,
  allPresentationTemplatesForLocale,
  instantiatePresentationTemplate,
  presentationTemplateForLocale,
  presentationTemplates,
} from "./presentation-templates";
import {
  instantiateNativePresentationTemplate,
  nativePresentationTemplateThumbnail,
  nativePresentationTemplates,
  nativePresentationTemplatesForLocale,
} from "./presentation-native-templates";
import {
  isPresentationTemplateLocaleLoaded,
  loadPresentationTemplateLocale,
  presentationTemplateLocaleCatalog,
} from "./presentation-template-locales";
import { presentationReadiness } from "./presentation-builder";

beforeAll(async () => {
  await Promise.all(supportedLocales.map(loadPresentationTemplateLocale));
});

function structure(draft: PresentationDraft) {
  const questionIds = draft.blocks.flatMap((block) =>
    block.kind === "question" ? [block.question.id] : [],
  );
  return {
    schemaVersion: draft.schemaVersion,
    experiencePreset: draft.experiencePreset,
    blocks: draft.blocks.map((block) => {
      if (block.kind === "question") {
        const question = { ...block.question, id: "", prompt: "", explanation: "" };
        return {
          kind: block.kind,
          ...question,
          linkedRecheckQuestionId: !question.linkedRecheckQuestionId
            ? null
            : questionIds.indexOf(question.linkedRecheckQuestionId),
          ...("choices" in question
            ? { choices: question.choices.map((choice) => ({ isCorrect: choice.isCorrect })) }
            : {}),
          ...("minLabel" in question ? { minLabel: "", maxLabel: "" } : {}),
        };
      }
      return {
        kind: block.kind,
        layout: block.layout,
        textElements: block.textElements.map(({ id: _id, text: _text, ...element }) => element),
        scene: block.scene && {
          schemaVersion: block.scene.schemaVersion,
          aspectRatio: block.scene.aspectRatio,
          design: block.scene.design,
          readingOrder: block.scene.readingOrder.map((id) =>
            block.scene!.nodes.findIndex((node) => node.id === id),
          ),
          nodes: block.scene.nodes.map((node) => ({
            type: node.type,
            frame: "frame" in node ? node.frame : null,
            ...("role" in node ? { role: node.role } : {}),
            ...(node.type === "table"
              ? {
                  columns: node.headers.length,
                  rows: node.rows.map((row) => row.length),
                  figures: node.rows.flat().filter((value) => /^[\d\s$%,.–—:+/()-]+$/u.test(value)),
                }
              : {}),
            ...(node.type === "chart"
              ? {
                  chartType: node.chartType,
                  categoryCount: node.categories.length,
                  values: node.series.map((series) => series.values),
                }
              : {}),
          })),
        },
      };
    }),
  };
}

function textLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textLeaves);
  if (value && typeof value === "object") return Object.values(value).flatMap(textLeaves);
  return [];
}

const sourceSnapshot = JSON.stringify({ nativePresentationTemplates, presentationTemplates });

describe("authored creation-locale presentation catalogs", () => {
  it("loads the selected catalog without requiring a translated catalog for English", async () => {
    expect(isPresentationTemplateLocaleLoaded("en-CA")).toBe(true);
    expect(presentationTemplateLocaleCatalog("en-CA")).toBeNull();
    await expect(loadPresentationTemplateLocale("fr-FR")).resolves.toBeUndefined();
    for (const locale of supportedLocales)
      expect(isPresentationTemplateLocaleLoaded(locale)).toBe(true);
  });

  it.each(supportedLocales)(
    "%s creates all 21 complete drafts with matching gallery copy",
    (locale) => {
      const templates = allPresentationTemplatesForLocale(locale);
      expect(templates).toHaveLength(21);
      expect(templates.map((template) => template.id)).toEqual(
        allPresentationTemplates.map((t) => t.id),
      );
      for (const template of templates) {
        const draft = instantiatePresentationTemplate(template.id, locale);
        const second = instantiatePresentationTemplate(template.id, locale);
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
        const firstIds = new Set(textLeaves(draft).filter((value) => uuid.test(value)));
        expect(
          textLeaves(second)
            .filter((value) => uuid.test(value))
            .some((id) => firstIds.has(id)),
        ).toBe(false);
        const parsed = PresentationContentSchema.safeParse(draft);
        expect(
          parsed.success,
          `${locale}/${template.id}: ${JSON.stringify(parsed.error?.issues)}`,
        ).toBe(true);
        expect(presentationReadiness(draft), `${locale}/${template.id}`).toEqual([]);
        expect(draft.title).toBe(template.title);
        expect(draft.description).toBe(template.description);
        expect(structure(draft), `${locale}/${template.id}`).toEqual(
          structure(instantiatePresentationTemplate(template.id)),
        );
        if (locale !== "en-CA") {
          const original = allPresentationTemplates.find((t) => t.id === template.id)!;
          expect(template.title).not.toBe(original.title);
          expect(template.description).not.toBe(original.description);
          expect(template.scenarioLabel).not.toBe(original.scenarioLabel);
        }
      }
    },
  );

  it.each(supportedLocales.filter((locale) => locale !== "en-CA"))(
    "%s has every authored field and no implicit English catalog fallback",
    (locale) => {
      const catalog = presentationTemplateLocaleCatalog(locale)!;
      expect(Object.isFrozen(catalog)).toBe(true);
      expect(Object.isFrozen(catalog.native[0]!.slides[0])).toBe(true);
      expect(catalog.native).toHaveLength(12);
      expect(catalog.facilitated).toHaveLength(9);
      expect(textLeaves(catalog).every((text) => text.trim().length > 0)).toBe(true);
      for (const [index, source] of nativePresentationTemplates.entries()) {
        const copy = catalog.native[index]!;
        expect(copy.slides).toHaveLength(source.blocks.length);
        for (const [slideIndex, slide] of source.blocks.entries()) {
          const translated = copy.slides[slideIndex]!;
          for (const field of ["title", "body", "notes"] as const) {
            expect(translated[field], `${locale}/${source.id}/${slideIndex}/${field}`).not.toBe(
              slide[field],
            );
            expect(translated[field].length).toBeGreaterThan(field === "title" ? 2 : 5);
          }
        }
      }
      for (const [index, source] of presentationTemplates.entries()) {
        expect(catalog.facilitated[index]!.blocks).toHaveLength(source.blocks.length);
        for (const [blockIndex, block] of source.blocks.entries()) {
          const copy = catalog.facilitated[index]!.blocks[blockIndex]!;
          const expected =
            block.kind === "check" ? 1 + block.labels.length + (block.correct === null ? 0 : 1) : 3;
          expect(copy.length).toBeGreaterThanOrEqual(expected);
          expect(copy[0]).not.toBe(block.kind === "content" ? block.title : block.prompt);
        }
      }
      const expectedData: Record<string, string[]> = {};
      for (const [templateIndex, template] of nativePresentationTemplates.entries()) {
        for (const [slideIndex, slide] of template.blocks.entries()) {
          const table = slide.illustrativeTable;
          const chart = slide.illustrativeChart;
          const values = [
            ...(slide.columns ?? []),
            ...(table ? [table.caption, ...table.headers, ...table.rows.flat()] : []),
            ...(chart
              ? [
                  chart.title,
                  chart.summary,
                  ...chart.categories,
                  ...chart.series.map((series) => series.name),
                ]
              : []),
          ].filter((value) => !/^[\d\s$%,.–—:+/()-]+$/u.test(value));
          if (values.length) expectedData[`${templateIndex}.${slideIndex}`] = values;
        }
      }
      expect(Object.keys(catalog.nativeData).sort()).toEqual(Object.keys(expectedData).sort());
      for (const [key, source] of Object.entries(expectedData)) {
        expect(catalog.nativeData[key], `${locale}/${key}`).toHaveLength(source.length);
        for (const [index, original] of source.entries())
          if (original.length > 15) expect(catalog.nativeData[key]![index]).not.toBe(original);
      }
      // Data traversal throws on either a missing translation or unused extra copy.
      expect(() => nativePresentationTemplatesForLocale(locale)).not.toThrow();
    },
  );

  it.each(supportedLocales)(
    "%s keeps drafts, thumbnails and catalog clones independent",
    (locale) => {
      const first = instantiateNativePresentationTemplate(
        "native-startup-pitch",
        undefined,
        locale,
      );
      const second = instantiateNativePresentationTemplate(
        "native-startup-pitch",
        undefined,
        locale,
      );
      const originalTitle = second.title;
      first.title = "A local draft edit";
      expect(second.title).toBe(originalTitle);
      const tableOne = first.blocks
        .flatMap((block) => (block.kind === "content" ? (block.scene?.nodes ?? []) : []))
        .find((node) => node.type === "table");
      const tableTwo = second.blocks
        .flatMap((block) => (block.kind === "content" ? (block.scene?.nodes ?? []) : []))
        .find((node) => node.type === "table");
      if (tableOne?.type !== "table" || tableTwo?.type !== "table")
        throw new Error("Expected a table");
      tableOne.rows[0]![0] = "My own table entry";
      expect(tableTwo.rows[0]![0]).not.toBe("My own table entry");
      const gallery = allPresentationTemplatesForLocale(locale);
      gallery[0]!.title = "A gallery edit";
      expect(allPresentationTemplatesForLocale(locale)[0]!.title).toBe(originalTitle);
      const thumbnail = nativePresentationTemplateThumbnail("native-startup-pitch", locale);
      const again = nativePresentationTemplateThumbnail("native-startup-pitch", locale);
      expect(again).toEqual(thumbnail);
      const slide = second.blocks[0]!;
      expect(slide.kind === "content" && slide.scene?.nodes[0]).toMatchObject({
        text: nativePresentationTemplatesForLocale(locale)[0]!.blocks[0]!.title,
      });
      expect(thumbnail.scene?.nodes[0]).toMatchObject({
        text: nativePresentationTemplatesForLocale(locale)[0]!.blocks[0]!.title,
      });
      expect(JSON.stringify({ nativePresentationTemplates, presentationTemplates })).toBe(
        sourceSnapshot,
      );
    },
  );

  it.each(supportedLocales)(
    "%s selects only the requested definition and returns independent copies",
    (locale) => {
      const templates = allPresentationTemplatesForLocale(locale);
      for (const expected of templates) {
        const selected = presentationTemplateForLocale(expected.id, locale);
        const second = presentationTemplateForLocale(expected.id, locale);
        expect(selected).toEqual(expected);
        expect(second).toEqual(expected);
        expect(selected).not.toBe(second);
        const firstBlock = selected.blocks[0]!;
        const secondBlock = second.blocks[0]!;
        if (firstBlock.kind !== "content" || secondBlock.kind !== "content")
          throw new Error("Expected opening content");
        firstBlock.title = "My selected copy";
        expect(secondBlock.title).not.toBe(firstBlock.title);
        expect(presentationTemplateForLocale(expected.id, locale)).toEqual(expected);
      }
    },
  );

  it("does not inspect unrelated native or facilitated blocks for a selection or thumbnail", () => {
    const unrelated = [nativePresentationTemplates[1]!, presentationTemplates[1]!];
    const descriptors = unrelated.map((template) =>
      Object.getOwnPropertyDescriptor(template, "blocks")!,
    );
    try {
      unrelated.forEach((template) =>
        Object.defineProperty(template, "blocks", {
          configurable: true,
          get() {
            throw new Error("An unrelated deck was inspected");
          },
        }),
      );
      expect(() => presentationTemplateForLocale("native-startup-pitch", "fr-FR")).not.toThrow();
      expect(() =>
        nativePresentationTemplateThumbnail("native-startup-pitch", "fr-FR"),
      ).not.toThrow();
      expect(() => presentationTemplateForLocale("meeting", "fr-FR")).not.toThrow();
      expect(() => instantiatePresentationTemplate("meeting", "fr-FR")).not.toThrow();
    } finally {
      unrelated.forEach((template, index) =>
        Object.defineProperty(template, "blocks", descriptors[index]!),
      );
    }
  });

  it("retains the exact historical English copy and derives locale changes without rewriting drafts", () => {
    const before = instantiatePresentationTemplate("training", "ja-JP");
    const saved = JSON.stringify(before);
    allPresentationTemplatesForLocale("de-DE");
    nativePresentationTemplateThumbnail("native-startup-pitch", "zh-TW");
    expect(JSON.stringify(before)).toBe(saved);
    expect(allPresentationTemplatesForLocale()).toEqual(allPresentationTemplates);
    expect(allPresentationTemplatesForLocale("en-CA")).toEqual(allPresentationTemplates);
  });

  it.each(["ja-JP", "ko-KR", "zh-CN", "zh-TW"] as const)(
    "%s uses localized presenter notes and natural sentence punctuation",
    (locale) => {
      const templates = nativePresentationTemplatesForLocale(locale);
      const draft = instantiateNativePresentationTemplate(
        "native-startup-pitch",
        undefined,
        locale,
      );
      const block = draft.blocks[1]!;
      if (block.kind !== "content") throw new Error("Expected content");
      const source = templates[0]!.blocks[1]!;
      const lead = block.scene?.nodes.find((node) => node.type === "text" && node.role === "body");
      if (!lead || lead.type !== "text") throw new Error("Expected body");
      expect(source.body.startsWith(lead.text)).toBe(true);
      if (locale !== "ko-KR") expect(lead.text).toMatch(/[。！？]$/u);
      expect(block.speakerNotes).not.toContain("Presenter notes:");
      expect(block.speakerNotes).toContain(
        presentationTemplateLocaleCatalog(locale)!.presenterNotes,
      );
      expect(block.speakerNotes).toContain(source.body);
      expect(block.speakerNotes).toContain(source.notes);
    },
  );
});
