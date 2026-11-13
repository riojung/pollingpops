import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { supportedLocales } from "@openround/contracts";
import { instantiatePresentationTemplate } from "../../lib/presentation-templates";
import { loadPresentationTemplateLocale } from "../../lib/presentation-template-locales";
import { presentationTemplateCopy } from "../../lib/i18n/presentation-template-copy";
import { nativeAudienceCopy } from "../presentation/native-audience-copy";
import {
  PresentationTemplatePreview,
  PresentationTemplateSlide,
  PresentationTemplateThumbnail,
} from "./presentation-template-preview";

vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "ko-KR" }) }));

beforeAll(async () => {
  await Promise.all(supportedLocales.map(loadPresentationTemplateLocale));
});

describe("template creation-language rendering", () => {
  it.each(supportedLocales)(
    "%s marks captured native and facilitated thumbnail copy without changing the draft",
    (locale) => {
      for (const id of ["native-startup-pitch", "review"] as const) {
        const draft = instantiatePresentationTemplate(id, locale);
        const before = JSON.stringify(draft);
        const markup = renderToStaticMarkup(
          <PresentationTemplateThumbnail templateId={id} locale={locale} />,
        );
        expect(markup).toContain(`lang="${locale}"`);
        expect(markup).toContain(`<h1 lang="${locale}"`);
        expect(JSON.stringify(draft)).toBe(before);
      }
    },
  );

  it("keeps French slide text in French after the interface switches to Korean", () => {
    for (const id of ["native-startup-pitch", "review"] as const) {
      const draft = instantiatePresentationTemplate(id, "fr-FR");
      const snapshot = JSON.stringify(draft);
      const markup = renderToStaticMarkup(
        <PresentationTemplatePreview draft={draft} contentLocale="fr-FR" onClose={() => {}} />,
      );
      expect(markup).toMatch(/<h1 lang="fr-FR"[^>]*>/u);
      if (id === "native-startup-pitch") {
        expect(markup).toMatch(/role="img" aria-label="[^"]+" lang="fr-FR"/u);
        expect(markup).toContain('data-template-notes="true"');
        const opening = draft.blocks[0];
        expect(opening?.kind === "content" && opening.speakerNotes).toBeTruthy();
      }
      expect(markup).toContain(presentationTemplateCopy("ko-KR")("Close preview"));
      expect(JSON.stringify(draft)).toBe(snapshot);
    }
    const draft = instantiatePresentationTemplate("review", "fr-FR");
    const question = draft.blocks.find((block) => block.kind === "question")!;
    const markup = renderToStaticMarkup(
      <PresentationTemplateSlide block={question} contentLocale="fr-FR" />,
    );
    expect(markup).toMatch(/<article[^>]*lang="fr-FR"/u);
    expect(markup).toContain(
      `<p lang="ko-KR">${presentationTemplateCopy("ko-KR")("Audience activity")}</p>`,
    );
    expect(markup).toContain(question.kind === "question" ? question.question.prompt : "");
  });

  it("marks authored table and chart labels in French while retaining Korean system labels", () => {
    const draft = instantiatePresentationTemplate("native-startup-pitch", "fr-FR");
    const table = draft.blocks[4]!;
    const chart = draft.blocks[2]!;
    const tableMarkup = renderToStaticMarkup(
      <PresentationTemplateSlide block={table} contentLocale="fr-FR" />,
    );
    expect(tableMarkup).toMatch(/<caption lang="fr-FR">/u);
    expect(tableMarkup).toMatch(/<th lang="fr-FR"/u);
    expect(tableMarkup).toMatch(/<td lang="fr-FR"/u);
    const chartMarkup = renderToStaticMarkup(
      <PresentationTemplateSlide block={chart} contentLocale="fr-FR" />,
    );
    expect(chartMarkup).toContain('<figcaption lang="fr-FR">');
    expect(chartMarkup).toContain(
      `<th lang="ko-KR" scope="col">${nativeAudienceCopy("ko-KR")("Category")}</th>`,
    );
    expect(chartMarkup).toContain('<th lang="fr-FR" scope="row">');
  });

  it("retains an explicit authored text language over the captured creation language", () => {
    const draft = instantiatePresentationTemplate("native-startup-pitch", "fr-FR");
    const block = draft.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("Expected native content");
    const title = block.scene.nodes[0]!;
    if (title.type !== "text") throw new Error("Expected text title");
    title.lang = "es";
    const before = JSON.stringify(draft);
    const markup = renderToStaticMarkup(
      <PresentationTemplateSlide block={block} contentLocale="fr-FR" />,
    );
    expect(markup).toMatch(/<h1 lang="es"[^>]*>/u);
    expect(markup).toMatch(/<p lang="fr-FR"[^>]*>/u);
    expect(JSON.stringify(draft)).toBe(before);
  });
});
