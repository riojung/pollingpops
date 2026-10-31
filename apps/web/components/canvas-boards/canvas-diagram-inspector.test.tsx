import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CanvasObjectSchema } from "@openround/contracts";
import { canvasObject } from "./canvas-test-fixtures";
import { canvasObjectDraft } from "./canvas-draft";
import { CanvasDiagramInspector } from "./canvas-diagram-inspector";
vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    locale: "en-CA",
    t: (key: string) =>
      key === "canvas.connectorFrom"
        ? "From object"
        : key === "canvas.connectorTo"
          ? "To object"
          : key,
  }),
}));
describe("diagram controls", () => {
  it("offers keyboard endpoint coordinates, bounded styles and rotations with role-based disablement", () => {
    const object = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "connector",
      from: { objectId: null, x: 10, y: 20 },
      to: { objectId: canvasObject.id, x: 30, y: 40 },
    });
    const html = renderToStaticMarkup(
      <CanvasDiagramInspector
        object={object}
        objects={[canvasObject, object]}
        draft={canvasObjectDraft(object)}
        disabled
        onChange={() => undefined}
        label={(entry) => entry.text}
      />,
    );
    for (const label of [
      "Source horizontal position",
      "Source vertical position",
      "Destination port",
      "Line style",
      "Line color",
      "Start marker",
      "End marker",
      "Route",
    ])
      expect(html).toContain(label);
    expect(html).toContain('step="any"');
    expect(html).toContain("disabled");
    expect(html).not.toContain("Destination horizontal position");
    const node = CanvasObjectSchema.parse({ ...canvasObject, type: "diamond", rotation: 30 });
    const rotation = renderToStaticMarkup(
      <CanvasDiagramInspector
        object={node}
        objects={[node]}
        draft={canvasObjectDraft(node)}
        disabled={false}
        onChange={() => undefined}
        label={() => "Decision"}
      />,
    );
    expect(rotation).toContain("Rotation in degrees");
    expect(rotation).toContain('value="30"');
    expect(rotation).toContain('min="-180"');
  });
});
