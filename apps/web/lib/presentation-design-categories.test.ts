import { describe, expect, it } from "vitest";
import { PRESENTATION_DESIGNS } from "./presentation-designs";
import {
  PRESENTATION_DESIGN_CATEGORIES,
  matchesPresentationDesignCategory,
  type PresentationDesignCategory,
} from "./presentation-design-categories";

describe("Presentation design categories", () => {
  it("offers ten categories while retaining all 30 searchable designs", () => {
    expect(PRESENTATION_DESIGN_CATEGORIES).toHaveLength(10);
    expect(new Set(PRESENTATION_DESIGN_CATEGORIES).size).toBe(10);
    expect(PRESENTATION_DESIGNS).toHaveLength(30);
    expect(new Set(PRESENTATION_DESIGNS.map((design) => design.id)).size).toBe(30);
    expect(new Set(PRESENTATION_DESIGNS.map((design) => JSON.stringify(design.design))).size).toBe(
      30,
    );
  });

  it.each(PRESENTATION_DESIGN_CATEGORIES)("has collections in the %s category", (category) => {
    expect(
      PRESENTATION_DESIGNS.filter((design) => matchesPresentationDesignCategory(design, category))
        .length,
    ).toBeGreaterThan(0);
  });

  it.each(["minimal", "editorial", "bold", "technical"] as const)(
    "preserves the exact %s visual-style matches",
    (category) => {
      expect(
        PRESENTATION_DESIGNS.filter((design) =>
          matchesPresentationDesignCategory(design, category),
        ).map((design) => design.id),
      ).toEqual(
        PRESENTATION_DESIGNS.filter((design) => design.style === category).map(
          (design) => design.id,
        ),
      );
    },
  );

  it.each<[PresentationDesignCategory, string[]]>([
    ["corporate", ["studio", "atlas", "ledger", "folio", "horizon", "slate", "linen", "summit"]],
    ["creative", ["signal", "monograph", "prism", "mosaic", "atelier"]],
    ["academic", ["archive", "workshop", "scholar", "campus"]],
    ["nature", ["botanica", "beacon", "meadow"]],
    ["playful", ["canvas", "workshop", "ribbon", "mosaic", "confetti"]],
    ["geometric", ["studio", "blueprint", "prism", "circuit", "mosaic", "facet"]],
  ])("uses explicit overlapping %s memberships", (category, expected) => {
    expect(
      PRESENTATION_DESIGNS.filter((design) =>
        matchesPresentationDesignCategory(design, category),
      ).map((design) => design.id),
    ).toEqual(expected);
  });
});
