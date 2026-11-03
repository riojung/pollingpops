import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CanvasObjectSchema } from "@openround/contracts";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { CanvasSurface } from "./canvas-surface";

vi.mock("next/navigation", () => ({ usePathname: () => "/canvas/example" }));

describe("participant canvas reference layers", () => {
  it("keeps a high-layer workshop reference beneath private objects without changing creator ordering", () => {
    const reference = CanvasObjectSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      type: "sticky",
      version: 1,
      x: 0,
      y: 0,
      width: 200,
      height: 160,
      zIndex: 9000,
      text: "Workshop reference",
    });
    const draft = CanvasObjectSchema.parse({
      ...reference,
      id: "00000000-0000-4000-8000-000000000002",
      zIndex: 0,
      text: "Private note",
    });
    const render = (background: boolean) =>
      renderToStaticMarkup(
        withEnglishLocale(
          <CanvasSurface
            objects={[reference, draft]}
            viewport={{ x: 0, y: 0, zoom: 1 }}
            onViewport={() => {}}
            isBackgroundObject={background ? (object) => object.id === reference.id : undefined}
          />,
        ),
      );
    const participant = render(true),
      creator = render(false);
    expect(participant.indexOf(`data-canvas-object="${reference.id}"`)).toBeLessThan(
      participant.indexOf(`data-canvas-object="${draft.id}"`),
    );
    expect(creator.indexOf(`data-canvas-object="${draft.id}"`)).toBeLessThan(
      creator.indexOf(`data-canvas-object="${reference.id}"`),
    );
  });
});
