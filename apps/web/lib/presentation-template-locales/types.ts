/** Authored copy only. IDs, scoring, scene geometry and numeric data live in the English sources. */
export interface PresentationTemplateLocaleCatalog {
  presenterNotes: string;
  facilitatedScenario: string;
  pollExplanation: string;
  scaleExplanation: string;
  native: {
    title: string;
    description: string;
    scenarioLabel: string;
    slides: { title: string; body: string; notes: string }[];
  }[];
  /** Column copy, then table/chart labels, in source reading order. Numeric-only cells are retained. */
  nativeData: Record<string, string[]>;
  facilitated: {
    title: string;
    description: string;
    blocks: string[][];
  }[];
}
