import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExperiencePresetIdSchema, RoundCategorySchema } from "@openround/contracts";
import { withEnglishLocale } from "../test-utils/english-locale";
import { ExperiencePicker } from "./experience-picker";

vi.mock("next/navigation", () => ({ usePathname: () => "/quiz/test" }));

function picker(
  category: "science" | "safety_compliance",
  presetId: "midnight" | "signal",
  showCategory = true,
) {
  return renderToStaticMarkup(
    withEnglishLocale(
      <ExperiencePicker
        category={category}
        presetId={presetId}
        onCategoryChange={() => undefined}
        onPresetChange={() => undefined}
        showCategory={showCategory}
      />,
    ),
  );
}

describe("Round experience gallery", () => {
  it("offers every preset as an accessible native radio and every topic independently", () => {
    const html = picker("science", "midnight");
    expect(html.match(/type="radio"/g)).toHaveLength(ExperiencePresetIdSchema.options.length);
    expect(html.match(/<option /g)).toHaveLength(RoundCategorySchema.options.length);
    expect(html).toContain("<legend>Experience preset</legend>");
    expect(html).toMatch(/aria-label="Midnight"[^>]*checked=""/);
    expect(html).not.toMatch(/aria-label="Observatory"[^>]*checked=""/);
    expect(html).toContain('value="science" selected=""');
    expect(html).toContain("Use recommended Observatory");
    expect(html).toContain('aria-label="Midnight experience preview"');
    expect(html).toContain("What will we explore together?");
  });

  it("uses the chosen palette for its card and sample while keeping the published topic hidden during launch", () => {
    const html = picker("safety_compliance", "signal", false);
    expect(html).not.toContain("<select");
    expect(html).toMatch(/aria-label="Signal"[^>]*checked=""/);
    expect(html).toContain("--experience-canvas:#FFF8D8");
    expect(html).toContain('data-pattern="signals"');
    expect(html).toContain("Recommended for Safety / compliance.");
    expect(html).not.toContain("Use recommended");
  });
});
