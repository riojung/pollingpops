import { describe, expect, it } from "vitest";
import { PresentationScenePrototypeSchema } from "@openround/contracts";
import { presentationSceneFixtures } from "./presentation-scene-fixtures";

describe("presentation scene task fixtures", () => {
  it("provides a ten-slide pitch and complete demo/workshop decks that satisfy the scene contract", () => {
    expect(presentationSceneFixtures.map((fixture) => [fixture.id, fixture.slides.length])).toEqual(
      [
        ["business-pitch", 10],
        ["product-demo", 5],
        ["training", 5],
      ],
    );

    const ids = new Set<string>();
    for (const fixture of presentationSceneFixtures) {
      for (const slide of fixture.slides) {
        const result = PresentationScenePrototypeSchema.safeParse(slide);
        expect(result.success, `${slide.id}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
        for (const id of [slide.id, ...slide.nodes.map((node) => node.id)]) {
          expect(ids.has(id), `Duplicate fixture ID: ${id}`).toBe(false);
          ids.add(id);
        }
      }
      expect(new Set(fixture.slides[0]!.nodes.map((node) => node.type))).toEqual(
        new Set(["text", "image", "shape", "connector"]),
      );
    }
  });
});
