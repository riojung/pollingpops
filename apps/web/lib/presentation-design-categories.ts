import type { PresentationDesign, PresentationDesignId } from "./presentation-designs";

export const PRESENTATION_DESIGN_CATEGORIES = [
  "minimal",
  "editorial",
  "bold",
  "technical",
  "corporate",
  "creative",
  "academic",
  "nature",
  "playful",
  "geometric",
] as const;

export type PresentationDesignCategory = (typeof PRESENTATION_DESIGN_CATEGORIES)[number];
export type PresentationDesignCategoryId = PresentationDesignCategory;

const categoryMemberships: Partial<
  Record<PresentationDesignCategory, readonly PresentationDesignId[]>
> = {
  corporate: ["studio", "atlas", "ledger", "folio", "horizon", "slate", "linen", "summit"],
  creative: ["signal", "monograph", "prism", "mosaic", "atelier"],
  academic: ["archive", "workshop", "scholar", "campus"],
  nature: ["botanica", "beacon", "meadow"],
  playful: ["canvas", "workshop", "ribbon", "mosaic", "confetti"],
  geometric: ["studio", "blueprint", "prism", "circuit", "mosaic", "facet"],
};

/** Discovery categories overlap without changing a collection's underlying visual style. */
export function matchesPresentationDesignCategory(
  design: Pick<PresentationDesign, "id" | "style">,
  category: PresentationDesignCategory,
): boolean {
  return design.style === category || categoryMemberships[category]?.includes(design.id) === true;
}
