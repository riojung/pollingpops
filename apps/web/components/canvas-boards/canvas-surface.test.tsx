import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CanvasObjectSchema } from "@openround/contracts";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { boardFixture } from "../../test-utils/idea-board";
import { CanvasSurface } from "./canvas-surface";
import { canvasObject } from "./canvas-test-fixtures";
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ t: (key: keyof typeof english) => english[key] ?? key }),
}));
describe("canvas visual privacy and normalized content", () => {
  it("renders shared diagram paths, bounded plain labels and explicit arrow styles", () => {
    const connector = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "connector",
      text: "Yes <script>bad()</script>",
      from: { objectId: null, x: 0, y: 0 },
      to: { objectId: null, x: 120, y: 60 },
      routing: "elbow",
      lineStyle: "dashed",
      lineColor: "blue",
      startMarker: "arrow",
      endMarker: "arrow",
    });
    const html = renderToStaticMarkup(
      <CanvasSurface
        objects={[connector]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onViewport={() => undefined}
      />,
    );
    expect(html).toContain('d="M0 0 L60 0 L60 60 L120 60"');
    expect(html).toContain('stroke-dasharray="8 5"');
    expect(html).toContain("marker-start=");
    expect(html).toContain("marker-end=");
    expect(html).toContain("Yes &lt;script&gt;bad()&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    const shape = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "diamond",
      width: 200,
      height: 100,
    });
    const diamond = renderToStaticMarkup(
      <CanvasSurface
        objects={[shape]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onViewport={() => undefined}
      />,
    );
    expect(diamond).toContain('d="M100 0 L200 50 L100 100 L0 50 Z"');
    expect(diamond).toContain('<foreignObject x="50" y="25" width="100" height="50"');
  });
  it("omits connector routes and labels when an endpoint's guest idea is removed", () => {
    const removed = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "idea_ref",
      text: "",
      ideaId: boardFixture.ideas[0]!.id,
      idea: { ...boardFixture.ideas[0], status: "removed", body: "Removed secret" },
    });
    const connector = CanvasObjectSchema.parse({
      ...canvasObject,
      id: "00000000-0000-4000-8000-000000000099",
      type: "connector",
      text: "Removed path label",
      from: { objectId: removed.id, x: 100, y: 100 },
      to: { objectId: null, x: 200, y: 200 },
    });
    const html = renderToStaticMarkup(
      <CanvasSurface
        objects={[removed, connector]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onViewport={() => undefined}
      />,
    );
    expect(html).not.toContain("Removed secret");
    expect(html).not.toContain("Removed path label");
    expect(html).not.toContain(`canvas-object-${connector.id}`);
  });
  it("renders plain text without executing supplied markup", () => {
    const note = CanvasObjectSchema.parse({
      ...canvasObject,
      text: '<script>alert("unsafe")</script>',
    });
    const html = renderToStaticMarkup(
      <CanvasSurface
        objects={[note]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onViewport={() => undefined}
      />,
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('data-testid="canvas-surface"');
  });
  it("does not draw pending or removed guest content from an otherwise valid snapshot", () => {
    const protectedObject = (status: "pending" | "removed" | "approved", index: number) =>
      CanvasObjectSchema.parse({
        ...canvasObject,
        id: "00000000-0000-4000-8000-00000000010" + index,
        type: "idea_ref",
        text: "",
        ideaId: boardFixture.ideas[0]!.id,
        idea: { ...boardFixture.ideas[0], status, body: status + " synthetic secret" },
      });
    const html = renderToStaticMarkup(
      <CanvasSurface
        objects={[
          protectedObject("pending", 1),
          protectedObject("removed", 2),
          protectedObject("approved", 3),
        ]}
        sourceBoardId={boardFixture.id}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onViewport={() => undefined}
      />,
    );
    expect(html).not.toContain("pending synthetic secret");
    expect(html).not.toContain("removed synthetic secret");
    expect(html).toContain("approved synthetic secret");
    expect(html).not.toContain("data-canvas-resize");
  });
});
