import type { SupportedLocale } from "@openround/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { creationMethodCopy } from "../../lib/i18n/creation-method-copy";

const mocked = vi.hoisted(() => ({ locale: "en-CA" as SupportedLocale }));
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: mocked.locale }) }));

import { CreationMethodDetails } from "./creation-method-details";

describe("creation method details", () => {
  it.each(["en-CA", "fr-FR", "ja-JP", "ko-KR", "zh-CN", "zh-TW"] as const)(
    "renders the active locale as compact semantic details in %s",
    (locale) => {
      mocked.locale = locale;
      const copy = creationMethodCopy(locale);
      const html = renderToStaticMarkup(<CreationMethodDetails method="roundImport" />);
      expect(html).toContain(`lang="${locale}"`);
      expect(html).toContain('data-creation-method="roundImport"');
      expect(html).toContain(`<dt>${copy.labels.input}</dt>`);
      expect(html).toContain(`<dt>${copy.labels.assistance}</dt>`);
      expect(html).toContain(`<dt>${copy.labels.nextStep}</dt>`);
      expect(html).toContain(copy.methods.roundImport.input);
      expect(html.match(/<dd>/g)).toHaveLength(3);
      expect(html).not.toMatch(/<h[1-6]|<button|<input|<form/);
    },
  );

  it("includes editor-only visual import guidance for the blank Presentation method", () => {
    mocked.locale = "en-CA";
    const blank = renderToStaticMarkup(<CreationMethodDetails method="presentationBlank" />);
    const source = renderToStaticMarkup(<CreationMethodDetails method="presentationSource" />);
    expect(blank).toContain("first open a saved Presentation in the editor");
    expect(blank).toContain("flattened slide visuals");
    expect(source).not.toContain("flattened slide visuals");
  });
});
