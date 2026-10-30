import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CanvasObjectSchema } from "@openround/contracts";
import { CanvasExportDialog } from "./canvas-export-dialog";
import { canvasId, canvasObject } from "./canvas-test-fixtures";
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
const render = (frame = false, disabled = false) =>
  renderToStaticMarkup(
    <CanvasExportDialog
      boardId={canvasId}
      objects={[CanvasObjectSchema.parse({ ...canvasObject, type: frame ? "frame" : "sticky" })]}
      selectedIds={[canvasObject.id]}
      viewportRegion={null}
      onClose={() => undefined}
      disabled={disabled}
    />,
  );
describe("explicit canvas export dialog", () => {
  it("offers board, viewport and frame regions and both file formats", () => {
    const html = render();
    expect(html).toContain("Export board");
    expect(html).toContain("aria-describedby=");
    expect(html).toContain('<option value="viewport" disabled="">Current view</option>');
    expect(html).toContain('<option value="frame" disabled="">Selected frame</option>');
    expect(html).toContain("PNG");
    expect(html).toContain("SVG");
    expect(html).toContain("Download");
    expect(html).toContain("Links appear as plain text");
  });
  it("enables the selected frame only when one is available and preserves cancellation while disabled", () => {
    expect(render(true)).toContain('<option value="frame">Selected frame</option>');
    const html = render(true, true);
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/);
    expect(html).toMatch(/<button type="button"[^>]*>Cancel<\/button>/);
  });
});
