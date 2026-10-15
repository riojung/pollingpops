import { describe, expect, it } from "vitest";
import {
  ProductFeatureRulesSchema,
  productFeatureCatalog,
  productFeatureKeys,
} from "../src/index.js";

describe("operator product feature policy", () => {
  it("preserves inherited entries and explicit plan assignments independently", () => {
    expect(ProductFeatureRulesSchema.parse({})).toEqual({});
    expect(
      ProductFeatureRulesSchema.parse({
        sessionSummaries: { enabled: true, plans: ["free", "team"] },
        surveys: { enabled: false, plans: [] },
      }),
    ).toEqual({
      sessionSummaries: { enabled: true, plans: ["free", "team"] },
      surveys: { enabled: false, plans: [] },
    });
  });
  it.each([
    { imaginaryFeature: { enabled: true, plans: ["pro"] } },
    { sessionSummaries: { enabled: "true", plans: ["pro"] } },
    { sessionSummaries: { enabled: true, plans: ["enterprise"] } },
    { sessionSummaries: { enabled: true, plans: ["free", "free"] } },
    { sessionSummaries: { enabled: true, plans: ["pro"], workspaceIds: [] } },
  ])("rejects unknown policy fields and ambiguous assignments: %j", (input) => {
    expect(ProductFeatureRulesSchema.safeParse(input).success).toBe(false);
  });
  it("publishes a complete catalog with resolvable, acyclic dependencies", () => {
    expect(new Set(productFeatureCatalog.map(({ key }) => key))).toEqual(
      new Set(productFeatureKeys),
    );
    expect(productFeatureCatalog).toHaveLength(productFeatureKeys.length);
    const catalog = new Map(productFeatureCatalog.map((entry) => [entry.key, entry]));
    const visit = (key: (typeof productFeatureKeys)[number], path = new Set<string>()) => {
      expect(path.has(key), `Dependency cycle at ${key}`).toBe(false);
      const definition = catalog.get(key);
      expect(definition, `Missing definition for ${key}`).toBeDefined();
      for (const dependency of definition!.dependencies) visit(dependency, new Set([...path, key]));
    };
    for (const key of productFeatureKeys) visit(key);
  });
});
