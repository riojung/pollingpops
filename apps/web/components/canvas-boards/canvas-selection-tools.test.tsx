import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CanvasObjectSchema, type CanvasObject } from "@openround/contracts";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { englishMessages } from "../../lib/i18n/messages/en-CA";
import { CanvasSelectionTools } from "./canvas-selection-tools";
import { canvasBoard, canvasObject } from "./canvas-test-fixtures";
const messages = { ...englishMessages, ...english };
vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    locale: "en-CA",
    t: (key: keyof typeof messages, values: Record<string, string> = {}) =>
      (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? name),
  }),
}));
function render(objects: CanvasObject[], ids: string[]) {
  return renderToStaticMarkup(
    <CanvasSelectionTools
      board={{ ...canvasBoard, objects }}
      ids={ids}
      disabled={false}
      onPlan={async () => false}
      onAll={() => undefined}
      onClear={() => undefined}
    />,
  );
}
function button(html: string, label: string) {
  const found = html
    .match(/<button\b[^>]*>[\s\S]*?<\/button>/g)
    ?.find((control) => control.includes(`aria-label="${label}"`));
  if (!found) throw new Error("Control missing: " + label);
  return found;
}
describe("bulk canvas controls", () => {
  it.each([
    { label: "Duplicate selected", x: 99_980, y: 99_980 },
    { label: "Frame selection", x: -99_990, y: -99_990 },
  ])("keeps the panel usable when $label would exceed the coordinate bounds", ({ label, x, y }) => {
    const edge = CanvasObjectSchema.parse({ ...canvasObject, x, y });
    let html = "";
    expect(() => {
      html = render([edge], [edge.id]);
    }).not.toThrow();
    expect(button(html, label)).toContain("disabled");
    expect(button(html, label)).toContain("geometry or data limits");
    expect(button(html, "Delete selected")).not.toContain("disabled");
    expect(button(html, "Lock selection")).not.toContain("disabled");
    expect(button(html, "Clear selection")).not.toContain("disabled");
  });
  it("keeps neighbouring valid boundary actions enabled", () => {
    const edge = CanvasObjectSchema.parse({ ...canvasObject, x: -99_976, y: -99_960 });
    const html = render([edge], [edge.id]);
    expect(button(html, "Frame selection")).not.toContain("disabled");
    expect(button(html, "Duplicate selected")).not.toContain("disabled");
  });
  it("accepts fractional horizontal and vertical moves in the native form", () => {
    const html = render([canvasObject], [canvasObject.id]);
    expect(html.match(/type="number" step="any"/g)).toHaveLength(2);
  });
  it("disables over-budget hierarchy actions and explains the atomic cap", () => {
    const frame = CanvasObjectSchema.parse({ ...canvasObject, type: "frame" });
    const children = Array.from({ length: 50 }, (_, index) =>
      CanvasObjectSchema.parse({
        ...canvasObject,
        id: "00000000-0000-4000-8000-" + String(index + 100).padStart(12, "0"),
        parentId: frame.id,
      }),
    );
    const html = render([frame, ...children], [frame.id]);
    expect(button(html, "Duplicate selected")).toContain("disabled");
    expect(button(html, "Delete selected")).toContain("disabled");
    expect(html).toContain("exceeds 50 object changes");
  });
  it("provides an unlock-only action for an eligible editor without enabling locked content changes", () => {
    const locked = { ...canvasObject, locked: true };
    const html = render([locked], [locked.id]);
    expect(button(html, "Unlock selection")).not.toContain("disabled");
    expect(button(html, "Duplicate selected")).toContain("disabled");
    expect(html).toContain("Separately locked children stay locked");
  });
  it("uses compact labelled action groups and collapses secondary fields and help", () => {
    const html = render([canvasObject], [canvasObject.id]);
    expect(html).toContain('role="group" aria-label="Quick actions"');
    expect(html).toContain('role="group" aria-label="Arrange"');
    expect(html).toContain("<summary>Move selection</summary>");
    expect(html).toContain("<summary>Parent frame</summary>");
    expect(html).toContain("<summary>Help</summary>");
    expect(html).not.toMatch(/<details[^>]* open/);
    for (const mode of [
      "left",
      "center",
      "right",
      "top",
      "middle",
      "bottom",
      "horizontal",
      "vertical",
    ] as const)
      expect(button(html, english[`canvas.productivity.${mode}`])).toContain('aria-hidden="true"');
    expect(html).not.toContain('aria-label="Unlock selection"');
    expect(html).not.toContain('aria-label="Ungroup selection"');
  });
  it("keeps applicable ungroup and unlock controls without a duplicate lock control", () => {
    const grouped = CanvasObjectSchema.parse({
      ...canvasObject,
      geometricGroupId: "00000000-0000-4000-8000-000000000199",
    });
    expect(button(render([grouped], [grouped.id]), "Ungroup selection")).not.toContain("disabled");
    const locked = CanvasObjectSchema.parse({ ...canvasObject, locked: true });
    const html = render([locked], [locked.id]);
    expect(button(html, "Unlock selection")).not.toContain("disabled");
    expect(html).not.toContain('aria-label="Lock selection"');
  });
});
