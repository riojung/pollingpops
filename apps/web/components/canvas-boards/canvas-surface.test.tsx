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
