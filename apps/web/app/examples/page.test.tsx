import { describe, expect, it } from "vitest";
import ExamplesPage from "./page";
import { PublicExamplesPage } from "../../components/public-examples-page";

describe("public examples route context", () => {
  it("accepts the public format and use-case links without starting a template copy", async () => {
    for (const type of ["round", "presentation", "survey", "board"]) {
      const page = await ExamplesPage({
        searchParams: Promise.resolve({ type, useCase: "meetings", example: "meeting-priorities" }),
      });
      expect(page.type).toBe(PublicExamplesPage);
      expect(page.props).toEqual({
        initialKind: type,
        initialUseCase: "meetings",
        initialExampleId: "meeting-priorities",
      });
    }
  });

  it("ignores unknown and repeated filter values", async () => {
    for (const query of [
      { type: "constructor", useCase: "unknown" },
      { type: ["round", "survey"], useCase: ["meetings"], example: ["meeting-priorities"] },
    ]) {
      const page = await ExamplesPage({ searchParams: Promise.resolve(query) });
      expect(page.props).toEqual({
        initialKind: "all",
        initialUseCase: "all",
        initialExampleId: undefined,
      });
    }
  });
});
