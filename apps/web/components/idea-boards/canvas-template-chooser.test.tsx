import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CANVAS_TEMPLATE_IDS, getCanvasTemplate, supportedLocales } from "@openround/contracts";
import { canvasTemplateMessages } from "../../lib/i18n/canvas-template-messages";
import { CanvasTemplateChooser } from "./canvas-template-chooser";
const locale = vi.hoisted(() => ({ value: "en-CA" as (typeof supportedLocales)[number] }));
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: locale.value }) }));

describe("starter chooser", () => {
  it.each(supportedLocales)(
    "localizes picker controls and identifies the authored language in %s",
    (value) => {
      locale.value = value;
      const html = renderToStaticMarkup(
        <CanvasTemplateChooser value={null} onChange={() => undefined} />,
      );
      const copy = canvasTemplateMessages(value);
      expect(html).toContain(copy.choose);
      expect(html).toContain(copy.blank);
      expect(html).toContain(copy.english);
      expect(html).toContain('lang="en"');
      expect(html).toContain('aria-pressed="true"');
      expect(html).not.toContain(copy.previewHelp);
    },
  );
  it.each(CANVAS_TEMPLATE_IDS)(
    "previews all authored sections and note prompts before creating %s",
    (id) => {
      locale.value = "en-CA";
      const html = renderToStaticMarkup(
        <CanvasTemplateChooser value={id} onChange={() => undefined} />,
      );
      const template = getCanvasTemplate(id);
      expect(html).toContain(canvasTemplateMessages("en-CA").previewHelp);
      for (const section of template.sections) {
        expect(html).toContain(section.title);
        expect(html).toContain(section.guidance);
        for (const prompt of section.prompts) expect(html).toContain(prompt);
      }
    },
  );
});
