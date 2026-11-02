import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CanvasObjectSchema } from "@openround/contracts";
import { canvasObject } from "./canvas-test-fixtures";
import { CanvasContextToolbar } from "./canvas-context-toolbar";

vi.mock("../locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: string) => key }),
}));
describe("contextual editing availability", () => {
  it("offers typography for link labels without an unsupported inline-edit action", () => {
    const link = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "link",
      url: "https://example.test",
      text: "Synthetic link",
    });
    const html = renderToStaticMarkup(
      <CanvasContextToolbar
        objects={[link]}
        disabled={false}
        editable
        canLock
        canDuplicate
        canDelete
        onPatch={vi.fn()}
        onConvert={vi.fn()}
        onLock={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onEditText={vi.fn()}
        onMore={vi.fn()}
      />,
    );
    expect(html).toContain('aria-label="Font family"');
    expect(html).toContain('aria-label="Font size"');
    expect(html).not.toContain('aria-label="Edit text"');
  });
});
