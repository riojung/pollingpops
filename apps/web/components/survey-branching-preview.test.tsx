import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactModule from "react";
import { describe, expect, it, vi } from "vitest";
import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { surveyBranchingFixture } from "../../../packages/contracts/test/support/survey-branching-fixture";
import { surveyBranchingCopy } from "../lib/i18n/survey-branching-copy";
import { SurveyBranchingPreview } from "./survey-branching-preview";

const mocked = vi.hoisted(() => ({ page: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useState: () => [mocked.page, vi.fn()],
}));

describe("retained conditional Survey inspection", () => {
  it.each(supportedLocales)(
    "reviews hidden authored pages and conditions without collecting answers in %s",
    (locale) => {
      mocked.page = 1;
      const draft = surveyBranchingFixture();
      const before = structuredClone(draft);
      const markup = renderToStaticMarkup(<SurveyBranchingPreview draft={draft} locale={locale} />);
      const copy = surveyBranchingCopy(locale);
      expect(markup).toContain(copy.condition);
      expect(markup).toContain("Show follow-up?");
      expect(markup).toContain("<strong>Yes</strong>");
      expect(markup).toContain(`data-survey-page="${draft.pages[1]!.id}"`);
      expect(markup).toContain('disabled=""');
      expect(markup).not.toContain('type="submit"');
      expect(markup).not.toContain("Show detailed feedback? →");
      expect(draft).toEqual(before);
    },
  );

  it("explains an unconditional page and keeps fallback copy independent", () => {
    mocked.page = 0;
    const markup = renderToStaticMarkup(
      <SurveyBranchingPreview draft={surveyBranchingFixture()} locale="en-CA" />,
    );
    expect(markup).toContain(surveyBranchingCopy().always);
    expect(markup).toContain("Page 1 of 4");
    expect(markup).not.toContain("<aside");
    for (const value of ["toString", "__proto__", "unknown"])
      expect(surveyBranchingCopy(value as SupportedLocale)).toEqual(surveyBranchingCopy());
    const copy = surveyBranchingCopy("ko-KR");
    copy.condition = "Caller edit";
    expect(surveyBranchingCopy("ko-KR").condition).not.toBe(copy.condition);
  });
});
